#!/usr/bin/env python3
"""Read and moderate the comments and Academy questions on networkfieldnotes.com.

The token never goes in this file. Export it first:

    export NFN_ADMIN_TOKEN='the string you gave wrangler secret put ADMIN_TOKEN'

Usage:
    python3 comments.py list                  # newest 300, every post, hidden ones included
    python3 comments.py list --slug vsx-upgrade-hitless
    python3 comments.py list --new            # only what arrived in the last 7 days
    python3 comments.py list --held           # Academy questions waiting for you
    python3 comments.py approve 42            # a held question goes public (reply --to does this too)
    python3 comments.py reply --to 42 --body "Because distance doubles."   # threaded under 42, approves it if held
    python3 comments.py reply --slug vsx-upgrade-hitless --body "Good catch, fixed."
    python3 comments.py hide 42
    python3 comments.py show 42
    python3 comments.py delete 42
    python3 comments.py export comments.json

The daily Cowork monitor does the same things with plain SQL through the Cloudflare connector; this is the
way to do them by hand.
"""
import os, sys, json, ssl, argparse, datetime, urllib.request, urllib.error

def _ctx():
    """macOS pythons from python.org do not use the system trust store, so urllib cannot
    verify a perfectly good certificate. certifi carries its own CA bundle."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()

API = os.environ.get("NFN_COMMENTS_API", "https://api.networkfieldnotes.com").rstrip("/")
TOKEN = os.environ.get("NFN_ADMIN_TOKEN", "")


def call(path, payload=None):
    if not TOKEN or TOKEN.strip().lower().startswith("the admin"):
        sys.exit("Set NFN_ADMIN_TOKEN to the real value you gave 'wrangler secret put ADMIN_TOKEN',\n"
                 "not the placeholder text.")
    req = urllib.request.Request(
        API + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"authorization": "Bearer " + TOKEN, "content-type": "application/json",
                 # Cloudflare's browser integrity check 403s the default Python-urllib signature
                 "user-agent": "nfn-comments/1.1 (+https://networkfieldnotes.com)"},
        method="POST" if payload is not None else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=30, context=_ctx()) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        if e.code == 403 and "1010" in body:
            sys.exit("Cloudflare blocked this request on its user agent, not the Worker. "
                     "Something stripped the user-agent header this script sets.")
        if e.code == 401:
            sys.exit("401: NFN_ADMIN_TOKEN does not match the ADMIN_TOKEN secret on the Worker.")
        sys.exit("%s %s: %s" % (e.code, e.reason, body[:400]))
    except urllib.error.URLError as e:
        if isinstance(e.reason, ssl.SSLCertVerificationError):
            sys.exit("This python cannot verify certificates. Either 'pip3 install certifi', or run\n"
                     "  /Applications/Python\\ 3.*/Install\\ Certificates.command\n"
                     "Underlying error: %s" % e.reason)
        sys.exit("Could not reach %s: %s" % (API, e.reason))


def fetch(slug=None, state=None):
    q = []
    if slug: q.append("slug=" + slug)
    if state: q.append("state=" + state)
    return call("/v1/admin/comments" + ("?" + "&".join(q) if q else ""))["comments"]


def show_rows(rows, days=None):
    if days:
        cut = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)).isoformat()
        rows = [c for c in rows if c["created_at"] > cut]
    if not rows:
        print("Nothing to show.")
        return
    for c in rows:
        flags = []
        kind, state = c.get("kind", "comment"), c.get("state", "live" if c["visible"] else "hidden")
        if kind != "comment":
            flags.append(kind + (" to #%s" % c["parent_id"] if c.get("parent_id") else ""))
        elif c.get("parent_id"):
            flags.append("reply to #%s" % c["parent_id"])
        if state != "live":
            flags.append(state.upper())
        if c["is_author"]:
            flags.append("author")
        head = "#%-5s %s  %s" % (c["id"], c["created_at"][:16].replace("T", " "), c["slug"])
        who = c["name"] or ("Dustin" if c["is_author"] else "Anonymous")
        if c.get("email"):
            who += " <%s>" % c["email"]
        if flags:
            who += "  [%s]" % ", ".join(flags)
        print("\n" + head + "\n" + who)
        for line in c["body"].splitlines():
            print("    " + line)
    print("\n%d row%s." % (len(rows), "" if len(rows) == 1 else "s"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list"); p.add_argument("--slug"); p.add_argument("--new", action="store_true"); p.add_argument("--held", action="store_true")
    for name in ("hide", "show", "delete", "approve"):
        q = sub.add_parser(name); q.add_argument("id", type=int)
    r = sub.add_parser("reply")
    to = r.add_mutually_exclusive_group(required=True)
    to.add_argument("--to", type=int, help="the id of the question or comment this answers (threaded)")
    to.add_argument("--slug", help="a post's slug, for an unthreaded reply on a field note")
    r.add_argument("--body", required=True); r.add_argument("--name", default="Dustin")
    e = sub.add_parser("export"); e.add_argument("path")

    a = ap.parse_args()
    if a.cmd == "list":
        show_rows(fetch(a.slug, "held" if a.held else None), days=7 if a.new else None)
    elif a.cmd in ("hide", "show", "delete", "approve"):
        call("/v1/admin/comments", {"action": a.cmd, "id": a.id})
        print("%s: #%d" % (a.cmd, a.id))
    elif a.cmd == "reply":
        body = {"action": "reply", "body": a.body, "name": a.name}
        if a.to:
            body["parent_id"] = a.to
        else:
            body["slug"] = a.slug
        out = call("/v1/admin/comments", body)
        print("posted as author, id %s%s" % (out.get("id"), " under #%d" % a.to if a.to else ""))
    elif a.cmd == "export":
        rows = fetch()
        with open(a.path, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=2)
        print("wrote %d rows to %s" % (len(rows), a.path))


if __name__ == "__main__":
    main()
