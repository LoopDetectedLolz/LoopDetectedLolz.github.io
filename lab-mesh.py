#!/usr/bin/env python3
"""Mesh on a lab group through Aruba Central, step by step, each step undoable.
The second script here that writes anything; every write needs --yes.

    python3 lab-mesh.py backup  --group G --out cfg.json                 # the group's AP config as CLI, for rollback
    python3 lab-mesh.py cluster --group G --name Lab-Mesh --key-file k --yes   # add a mesh cluster (role AUTO), keep the rest
    python3 lab-mesh.py restore --group G --from cfg.json --yes          # put the saved config back, whole
    python3 lab-mesh.py reboot  --serial S [--serial S2] --yes           # reboot APs (mesh settings need it)
    python3 lab-mesh.py status  --group G                                # roles, uptime, radios, as Central sees them

Dialect: the group's config is AOS 10 Instant CLI and POST /configuration/v1/ap_cli/{group}
replaces it whole, so cluster reads the current lines, adds
    mesh-cluster <name> wpa2-psk <key> priority 1
and writes them all back; restore writes the saved list back. Role stays AUTO: an AP that
boots with Ethernet up is a portal, with Ethernet down a point. Sources: HPE CLI bank
mesh-cluster; Central AOS 10 mesh configuration; read 2026-09-12. The key comes from a
file, never the command line, and is never printed.
"""
import argparse, json, os, sys, time, urllib.error, urllib.request, importlib.util

spec = importlib.util.spec_from_file_location("cp", os.path.join(os.path.dirname(os.path.abspath(__file__)), "client-pull.py"))
cp = importlib.util.module_from_spec(spec); spec.loader.exec_module(cp)

EP = {"cli": "/configuration/v1/ap_cli/{group}", "reboot": "/device_management/v1/device/{serial}/action/reboot",
      "status": "/device_management/v1/status/{task_id}", "aps": "/monitoring/v2/aps"}


def post(tok, path, body):
    req = urllib.request.Request(cp.BASE + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + tok["access_token"], "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60, context=cp.CTX) as r:
            raw = r.read(); return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"refused ({e.code}): {e.read()[:500].decode(errors='replace')}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("action", choices=["backup", "cluster", "restore", "reboot", "status"])
    ap.add_argument("--group"); ap.add_argument("--name", default="Lab-Mesh"); ap.add_argument("--key-file"); ap.add_argument("--out"); ap.add_argument("--from", dest="src")
    ap.add_argument("--serial", action="append", default=[]); ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    cp.CTX = cp.tls_context(); tok = cp.load_token()

    if a.action == "backup":
        lines = cp.get(tok, EP["cli"].format(group=a.group))
        if not isinstance(lines, list): sys.exit("no config came back")
        json.dump(lines, open(a.out or f"{a.group}-cli-{time.strftime('%Y%m%d-%H%M%S')}.json", "w"), indent=1)
        print(f"saved {len(lines)} lines" + (f" to {a.out}" if a.out else ""))
    elif a.action == "cluster":
        lines = cp.get(tok, EP["cli"].format(group=a.group))
        if not isinstance(lines, list): sys.exit("no config came back")
        key = open(os.path.expanduser(a.key_file)).read().strip() if a.key_file else ""
        if not (8 <= len(key) <= 63): sys.exit("the key file must hold 8 to 63 characters")
        have = [l for l in lines if l.startswith("mesh-cluster ")]
        new = [l for l in lines if not l.startswith("mesh-cluster ")]
        at = next((i for i, l in enumerate(new) if l.startswith("blacklist-time")), len(new))
        new.insert(at, f"mesh-cluster {a.name} wpa2-psk {key} priority 1")
        print(f"group {a.group}: {len(lines)} lines, {len(have)} existing mesh-cluster line(s) replaced, {len(new)} lines to write")
        print(f"  + mesh-cluster {a.name} wpa2-psk <key> priority 1")
        if not a.yes: print("dry run; add --yes to write it"); return
        out = post(tok, EP["cli"].format(group=a.group), {"clis": new})
        print("written:", json.dumps(out)[:200] or "ok")
        back = cp.get(tok, EP["cli"].format(group=a.group))
        got = [l for l in back if l.startswith("mesh-cluster ")]
        print(f"read back: {len(back)} lines, mesh-cluster present: {bool(got)}" + (" -> " + got[0].split(" wpa2-psk ")[0] + " wpa2-psk <key> ..." if got else ""))
        print("the APs need a reboot to take it: lab-mesh.py reboot --serial ... --yes")
    elif a.action == "restore":
        lines = json.load(open(a.src))
        print(f"would write {len(lines)} saved lines back to {a.group}")
        if not a.yes: print("dry run; add --yes"); return
        print("written:", json.dumps(post(tok, EP["cli"].format(group=a.group), {"clis": lines}))[:200] or "ok")
    elif a.action == "reboot":
        if not a.serial: sys.exit("--serial")
        for s in a.serial:
            print(f"reboot {s}" + ("" if a.yes else " (dry run)"))
            if a.yes: print("  ", json.dumps(post(tok, EP["reboot"].format(serial=s), {})))
    elif a.action == "status":
        page = cp.get(tok, EP["aps"], {"group": a.group, "limit": 100, "calculate_client_count": "true", "show_resource_details": "true"}) or {}
        for x in page.get("aps", []):
            print(f"  {x.get('name'):18} {x.get('status'):5} mesh_role={x.get('mesh_role')!s:8} uptime {x.get('uptime')} s  clients {x.get('client_count')}  " + ", ".join(f"{cp.band_key(r.get('band'))}:{r.get('channel')}/{r.get('tx_power')}dBm/{r.get('status')}" for r in x.get("radios") or []))


if __name__ == "__main__":
    main()
