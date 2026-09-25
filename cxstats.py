#!/usr/bin/env python3
"""How the CX Sandbox is being used. Reads the anonymous events the embeds send to the Worker.

    export NFN_ADMIN_TOKEN='the ADMIN_TOKEN you gave wrangler secret put'

    python3 cxstats.py                     # last 30 days, every lab
    python3 cxstats.py --days 7
    python3 cxstats.py --lesson nac-03-mac-auth
    python3 cxstats.py --errors            # JavaScript errors the widget reported
    python3 cxstats.py export events.json  # raw rows

A "user" is one browser (the random id it made for itself). An "attempt" is one press of Check my
work. "Done" means every check passed at least once in that browser. Pass rate is done over started.
"""
import os, sys, json, ssl, argparse, collections, datetime, urllib.request, urllib.error

def _ctx():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()

API = os.environ.get("NFN_COMMENTS_API", "https://api.networkfieldnotes.com").rstrip("/")
TOKEN = os.environ.get("NFN_ADMIN_TOKEN", "")


def fetch(days):
    if not TOKEN or TOKEN.strip().lower().startswith("the admin"):
        sys.exit("Set NFN_ADMIN_TOKEN to the real value you gave 'wrangler secret put ADMIN_TOKEN',\n"
                 "not the placeholder text.")
    # Cloudflare's browser check answers 403 / error 1010 to urllib's default agent, so name ourselves
    req = urllib.request.Request(API + "/v1/admin/sandbox?days=%d" % days,
                                 headers={"authorization": "Bearer " + TOKEN, "user-agent": "nfn-cxstats/1.0"})
    try:
        with urllib.request.urlopen(req, context=_ctx(), timeout=30) as r:
            return json.load(r)["events"]
    except urllib.error.HTTPError as e:
        sys.exit("%s: %s" % (e.code, e.read().decode(errors="replace")[:300]))


def report(events, lesson=None):
    if lesson:
        events = [e for e in events if e["lesson"] == lesson]
    by_lesson = collections.defaultdict(list)
    for e in events:
        by_lesson[e["lesson"]].append(e)
    if not by_lesson:
        print("No events in that window."); return
    print("%-22s %6s %8s %9s %9s %8s %7s" % ("lab", "users", "attempts", "avg/user", "done", "pass", "errors"))
    print("-" * 76)
    for lid in sorted(by_lesson):
        ev = by_lesson[lid]
        users = {e["sid"] for e in ev if e["ev"] == "start"} | {e["sid"] for e in ev}
        attempts = [e for e in ev if e["ev"] == "check"]
        done = {e["sid"] for e in ev if e["ev"] == "done"}
        errs = [e for e in ev if e["ev"] == "err"]
        per_user = collections.Counter(e["sid"] for e in attempts)
        avg = (sum(per_user.values()) / len(per_user)) if per_user else 0
        rate = (100.0 * len(done) / len(users)) if users else 0
        print("%-22s %6d %8d %9.1f %9d %7.0f%% %7d" % (lid, len(users), len(attempts), avg, len(done), rate, len(errs)))
        top = collections.Counter((e["err"], e["cmd"]) for e in errs).most_common(5)
        for (kind, cmd), n in top:
            print("      %4d  %-10s %s" % (n, kind, cmd))
        # how many checks people typically stall on
        stalls = collections.Counter()
        last = {}
        for e in attempts:
            last[e["sid"]] = (e.get("n") or 0, e.get("total") or 0)
        for sid, (n, total) in last.items():
            if sid not in done and total:
                stalls[n] += 1
        if stalls:
            print("      stalled at %s checks passed (users): %s" % (
                ", ".join(str(k) for k in sorted(stalls)), ", ".join(str(stalls[k]) for k in sorted(stalls))))
    js = [e for e in events if e["ev"] == "jserror"]
    if js:
        print("\n%d JavaScript error(s) reported; run with --errors to see them." % len(js))


def errors(events):
    js = [e for e in events if e["ev"] == "jserror"]
    if not js:
        print("No JavaScript errors reported."); return
    for e in sorted(js, key=lambda x: x["created_at"], reverse=True):
        print("%s  %-22s %s  %s" % (e["created_at"][:19], e["lesson"], e["page"], (e["err"] + " " + e["cmd"]).strip()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", nargs="?", default="report", choices=["report", "export"])
    ap.add_argument("path", nargs="?")
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--lesson")
    ap.add_argument("--errors", action="store_true")
    a = ap.parse_args()
    events = fetch(a.days)
    if a.cmd == "export":
        if not a.path: sys.exit("export needs a path")
        json.dump(events, open(a.path, "w"), indent=1)
        print("wrote %d events to %s" % (len(events), a.path)); return
    print("CX Sandbox, last %d days, %d events, fetched %s\n" % (a.days, len(events), datetime.datetime.now().strftime("%Y-%m-%d %H:%M")))
    if a.errors:
        errors(events)
    else:
        report(events, a.lesson)


if __name__ == "__main__":
    main()
