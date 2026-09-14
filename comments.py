#!/usr/bin/env python3
"""Read and moderate the comments on networkfieldnotes.com.

The token never goes in this file. Export it first:

    export NFN_ADMIN_TOKEN='the string you gave wrangler secret put ADMIN_TOKEN'

Usage:
    python3 comments.py list                  # newest 300, every post, hidden ones included
    python3 comments.py list --slug vsx-upgrade-hitless
    python3 comments.py list --new            # only what arrived in the last 7 days
    python3 comments.py hide 42
    python3 comments.py show 42
    python3 comments.py delete 42
    python3 comments.py reply --slug vsx-upgrade-hitless --body "Good catch, fixed."
    python3 comments.py export comments.json
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
                 "user-agent": "nfn-comments/1.0 (+https://networkfieldnotes.com)"},
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


def fetch(slug=None):
    return call("/v1/admin/comments" + ("?slug=" + slug if slug else ""))["comments"]


def show_rows(rows, days=None):
    if days:
        cut = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)).isoformat()
        rows = [c for c in rows if c["created_at"] > cut]
    if not rows:
        print("Nothing to show.")
        return
    for c in rows:
        flags = []
        if not c["visible"]:
            flags.append("HIDDEN")
        if c["is_author"]:
            flags.append("author")
        head = "#%-5s %s  %s" % (c["id"], c["created_at"][:16].replace("T", " "), c["slug"])
        who = c["name"] or "Anonymous"
        if c["email"]:
            who += " <%s>" % c["email"]
        if flags:
            who += "  [%s]" % ", ".join(flags)
        print("\n" + head + "\n" + who)
        for line in c["body"].splitlines():
            print("    " + line)
    print("\n%d comment%s." % (len(rows), "" if len(rows) == 1 else "s"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list"); p.add_argument("--slug"); p.add_argument("--new", action="store_true")
    for name in ("hide", "show", "delete"):
        q = sub.add_parser(name); q.add_argument("id", type=int)
    r = sub.add_parser("reply"); r.add_argument("--slug", required=True); r.add_argument("--body", required=True); r.add_argument("--name", default="Dustin")
    e = sub.add_parser("export"); e.add_argument("path")

    a = ap.parse_args()
    if a.cmd == "list":
        show_rows(fetch(a.slug), days=7 if a.new else None)
    elif a.cmd in ("hide", "show", "delete"):
        call("/v1/admin/comments", {"action": a.cmd, "id": a.id})
        print("%s: comment %d" % (a.cmd, a.id))
    elif a.cmd == "reply":
        out = call("/v1/admin/comments", {"action": "reply", "slug": a.slug, "body": a.body, "name": a.name})
        print("posted as author, id %s" % out.get("id"))
    elif a.cmd == "export":
        rows = fetch()
        with open(a.path, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=2)
        print("wrote %d comments to %s" % (len(rows), a.path))


if __name__ == "__main__":
    main()
