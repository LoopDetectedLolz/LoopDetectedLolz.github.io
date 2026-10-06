# Comments, Academy questions, progress and save codes

Moved out of CLAUDE.md on 2026-10-05 so it only loads when someone works on this part. The rules in CLAUDE.md still apply.

## Comments, Academy questions and save codes

`comments/` holds a Cloudflare Worker and its D1 schemas (`schema.sql`, `schema-sandbox.sql`, `schema-academy.sql`); `theme/widgets/comments.html` is the field-note widget and `theme/widgets/qa.html` the Academy one; `comments.py` reads and moderates from the shell. Off until `COMMENTS_API` and `TURNSTILE_SITEKEY` are filled in at the top of `build-blog.py`, and a post opts out with `comments: off` in its front matter. Emptying `COMMENTS_API` removes every comment box, question box and code box, which is the switch to pull if it turns into a spam sink. Deploy steps, the migration and the moderation commands are in `comments/README.md`.

Field notes: anonymous comments, visible immediately, Turnstile plus a five per hour per address-hash rate limit, moderation after the fact. The public endpoint never returns the email or the IP hash.

Academy lessons, meaning any slug matching `^(academy|nac)-\d{2}-` (the Worker decides, never the page): the box is "Ask about this lesson". A question is held until Dustin approves it, never keeps an email, and comes back with a save code when the asker had none. Approved questions show with Dustin's answer threaded under them (`parent_id`), and the asker sees their own held question marked as waiting, through their code. Turnstile renders with `data-appearance="interaction-only"`, so most readers never see it.

**The monitor contract.** A Cowork scheduled task, `academy-qa-monitor`, runs at 7:30 every morning, reads D1 through the Cloudflare connector, drafts answers, and writes only what Dustin approves, with these statements and nothing else. Keep the columns and values they rely on: `kind` (comment, question, answer), `state` (held, live, hidden), `visible` always equal to `state = 'live'`, `parent_id`, `code_hash`.

```sql
UPDATE comments SET state = 'live', visible = 1, body = ? WHERE id = ? AND kind = 'question' AND state = 'held';
INSERT INTO comments (slug, name, email, body, is_author, visible, ip_hash, ua, created_at, kind, state, parent_id, code_hash)
VALUES (?, 'Dustin', '', ?, 1, 1, '', 'author', ?, 'answer', 'live', ?, '');   -- kind 'comment' for a reply on a field note
UPDATE comments SET state = 'hidden', visible = 0 WHERE id = ?;
```

`node comments/qatest.mjs` against a local `wrangler dev` runs those statements along with the rest of the Worker; its header has the setup.

## Academy progress and save codes

Progress lives in the reader's browser first (`localStorage`, `nfn:progress`), shaped and merged by `theme/progress-core.js`, which the Worker imports as well, so both sides merge the same way: dates keep the earliest, self-check ticks OR together, seen-answer times keep the latest, and a merge can never undo anything. `theme/progress.js` is the browser side (`window.NFNProgress`) and `theme/progress.css` its look; `progress_scripts()` in `build-blog.py` inlines all three on Academy lessons, `academy.html` and `sandbox.html`, and nowhere else. What counts: a lesson read (the Three questions heading in view after 30 seconds on the page), "I ran this lab" (the progress card's button, or `{{labdone}}` on its own line in a lesson), the self-check, the lesson's game (any widget that calls `NFNProgress.mark("game")` when its last level finishes is a game, and the build detects that), and CX Sandbox labs (`cxsim.html` calls `NFNProgress.lab(id)` when a lab passes).

A save code is four words from `comments/words.js`: 1,024 words, so about 1.1 trillion codes. It only exists once a reader asks a question, taps Get a code, or accepts the single offer after their first read lesson. The Worker stores only an HMAC of it keyed with `CODE_SALT` (never change that once codes exist), takes it only in POST bodies, allows five new codes and ten misses an hour per address hash, writes a record at most once a minute, and its daily cron deletes codes nobody has used for a year. The code panel's QR is `academy.html#code=<words>`, drawn in the browser by `theme/vendor/qrcode.js` (qrcode-generator 2.0.4, MIT), which loads only when someone taps Show QR. `node progresstest.js` proves the merge laws and the word list's rules.
