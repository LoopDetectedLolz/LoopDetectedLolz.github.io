# Comments

Anonymous comments for the blog, running on your own Cloudflare account. A Worker in front of a
D1 database, Turnstile on the form, and no third party script on the site except Turnstile itself.
Comments appear the moment they are posted; moderation happens afterwards with `comments.py`.

Nothing here is deployed automatically. These are the steps, in order, run from this folder.

## One time setup

```bash
npm install -g wrangler          # if you do not have it
wrangler login

wrangler d1 create nfn-comments  # copy the database_id it prints into wrangler.toml
wrangler d1 execute nfn-comments --remote --file=schema.sql
```

Then make the Turnstile widget: Cloudflare dashboard, Turnstile, Add widget, hostname
`networkfieldnotes.com`, widget mode Managed. It gives you a site key (public, goes in the page)
and a secret key (goes in the Worker).

```bash
wrangler secret put TURNSTILE_SECRET   # paste the Turnstile secret key
wrangler secret put ADMIN_TOKEN        # any long random string, keep it somewhere safe
wrangler secret put IP_SALT            # any other long random string, never needs to be seen again

wrangler deploy
```

Last, give it a hostname. In the dashboard, Workers and Pages, nfn-comments, Settings, Domains
and Routes, Add custom domain, `api.networkfieldnotes.com`. Cloudflare handles the DNS record and
the certificate because the zone is already there.

## Wiring it into the site

In `build-blog.py`, near the top:

```python
COMMENTS_API = "https://api.networkfieldnotes.com"
TURNSTILE_SITEKEY = "0x4AAAAAAA..."     # the public site key
```

Then `python3 build-blog.py` and push. Every post page gets the comment section. A post can opt out
with `comments: off` in its front matter.

Leaving `COMMENTS_API` empty disables comments everywhere, which is the switch to pull if the thing
ever gets buried in spam.

## Reading what comes in

```bash
export NFN_ADMIN_TOKEN='the ADMIN_TOKEN from above'

python3 comments.py list --new                 # the last seven days, hidden ones included
python3 comments.py list --slug vsx-upgrade-hitless
python3 comments.py hide 42                    # off the page, still in the database
python3 comments.py delete 42                  # gone
python3 comments.py reply --slug vsx-upgrade-hitless --body "Good catch. Fixed."
python3 comments.py export comments.json       # everything, for a backup or for me to read
```

Replies posted this way show with an Author badge and a green border.

## What is stored, and what is served

The table keeps the name, the comment, an optional email, a SHA-256 hash of the commenter's IP
address with your salt, and the user agent string. The public endpoint returns only id, name, body,
author flag and timestamp. The email and the hash never leave the admin endpoint, which needs the
bearer token.

The IP is hashed rather than stored so the rate limit works without you holding a log of who read
what. The salt makes the hashes useless to anyone who gets the database.

## Limits and costs

Free tier. Workers allow 100,000 requests a day and D1 allows 5 million row reads a day, which is
orders of magnitude above this blog. The Worker applies its own limits: five comments per hour per
address hash, twenty seconds between comments, 2,000 characters a comment, 300 comments returned
per page.

## If it misbehaves

- Comments section shows "Comments are offline": the Worker is unreachable. `wrangler tail` shows live logs.
- Every post fails the spam check: the Turnstile site key in `build-blog.py` and the secret in the Worker are from different widgets.
- Comments post but do not appear: check the slug. The widget sends the post's slug and the reader sees only `visible = 1` rows.
- Spam gets through Turnstile: lower `LIMITS.perHour` in `worker.js`, or set the widget to Interactive in the Turnstile dashboard.
