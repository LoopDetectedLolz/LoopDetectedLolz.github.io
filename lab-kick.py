#!/usr/bin/env python3
"""Disconnect one wireless client from its AP through Aruba Central, to make a
roam happen on purpose in a lab. The one script here that writes anything.

    python3 lab-kick.py --client "Epson" --group Burns-Home            # shows what it would do, does nothing
    python3 lab-kick.py --client "Epson" --group Burns-Home --yes      # sends the disconnect

Guards: the client must be on an AP in the named group, one client per run,
never "all" and never by network, and nothing happens without --yes. Uses the
same token file as the pullers (CENTRAL_TOKEN_FILE). Endpoint from the CA
tenant's Device Management Swagger, 2026-09-12:
POST /device_management/v1/device/{serial}/action/disconnect_user
with {"disconnect_user_mac": "<client mac>"}.
"""
import argparse, json, os, sys, urllib.error, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
spec = importlib.util.spec_from_file_location("cp", os.path.join(os.path.dirname(os.path.abspath(__file__)), "client-pull.py"))
cp = importlib.util.module_from_spec(spec); spec.loader.exec_module(cp)

KICK = "/device_management/v1/device/{serial}/action/disconnect_user"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--client", required=True, help="client name, user, IP or MAC")
    ap.add_argument("--group", required=True, help="the AP must belong to this Central group")
    ap.add_argument("--yes", action="store_true", help="actually send it")
    a = ap.parse_args()
    cp.CTX = cp.tls_context()
    tok = cp.load_token()
    mac, rows = cp.find_client(tok, a.client, a.group)
    if not mac:
        sys.exit(f"no client matching {a.client!r} in group {a.group}")
    c = cp.get(tok, cp.ENDPOINTS["client"].format(mac=mac)) or {}
    serial = c.get("associated_device")
    if not serial:
        sys.exit("that client is not associated to an AP right now")
    apd = cp.get(tok, cp.ENDPOINTS["ap"].format(serial=serial)) or {}
    if (apd.get("group_name") or "").lower() != a.group.lower():
        sys.exit(f"refusing: {apd.get('name')} is in group {apd.get('group_name')!r}, not {a.group!r}")
    print(f"client {c.get('name') or mac} ({c.get('os_type')}) on {apd.get('name')} ({serial}), {c.get('signal_db')} dBm")
    if not a.yes:
        print(f"would POST {KICK.format(serial=serial)} with disconnect_user_mac; add --yes to send it")
        return
    req = urllib.request.Request(cp.BASE + KICK.format(serial=serial), data=json.dumps({"disconnect_user_mac": mac}).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + tok["access_token"], "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30, context=cp.CTX) as r:
            print("sent:", r.read()[:300].decode(errors="replace") or r.status)
    except urllib.error.HTTPError as e:
        print(f"refused ({e.code}): {e.read()[:300].decode(errors='replace')}")
        sys.exit(1)


if __name__ == "__main__":
    main()
