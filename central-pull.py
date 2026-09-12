#!/usr/bin/env python3
"""Pull one group's access points and the loss AirMatch measured between them
out of Aruba Central, and write a site.json the mesh planner can import.

    python3 central-pull.py --group Burns-Home --out site.json
    python3 central-pull.py --group Burns-Home --dry-run     # list the calls, make none

The planner never calls Central. This script does, from the laptop, with
credentials that stay in the environment and in the token file Central gave
you. Nothing here writes to Central: every request is a GET and the code
refuses any other method.

Credentials. In Classic Central: Organization > Platform Integration > API
Gateway > System Apps & Tokens. Add an app, then Download Token. Point at it:

    export CENTRAL_TOKEN_FILE=~/.config/nfn/central-token.json
    export CENTRAL_BASE=https://apigw-ca.central.arubanetworks.com   # your cluster's gateway
    export CENTRAL_CLIENT_ID=...       # only needed to refresh an expired token
    export CENTRAL_CLIENT_SECRET=...

The token file holds access_token and refresh_token. Access tokens live two
hours; with the client id and secret set the script refreshes and rewrites
the file, otherwise download a fresh one.

TLS is verified. If your laptop inspects outbound TLS the python.org build
will not trust the inspecting certificate; on a Mac the script then trusts
the keychains the way Chrome does, or set CENTRAL_CA_FILE to a PEM.

Endpoints were read from the CA cluster's own Swagger on 2026-09-12. Another
cluster serves the same paths from its own gateway host.
"""
import argparse, json, os, platform, ssl, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request

BASE = os.environ.get("CENTRAL_BASE", "https://apigw-ca.central.arubanetworks.com").rstrip("/")
TOKEN_FILE = os.path.expanduser(os.environ.get("CENTRAL_TOKEN_FILE", "~/.config/nfn/central-token.json"))

# read from the tenant's Swagger (apigw-<cluster>/swagger/apps/nms/), 2026-09-12
ENDPOINTS = {
    "refresh":   "/oauth2/token",
    "sites":     "/central/v2/sites",
    "aps":       "/monitoring/v2/aps",
    "ap":        "/monitoring/v1/aps/{serial}",
    "radios":    "/airmatch/telemetry/v1/reporting_radio_all",
    "pathloss":  "/airmatch/telemetry/v1/nbr_pathloss_radio/{radio_mac}/{band}",
    # VisualRF only knows an AP's position once it sits on a floor plan
    "campus":    "/visualrf_api/v1/campus",
    "campus1":   "/visualrf_api/v1/campus/{campus_id}",
    "building":  "/visualrf_api/v1/building/{building_id}",
    "floor_aps": "/visualrf_api/v1/floor/{floor_id}/access_point_location",
}

DRY = False
CALLS = 0


def tls_context():
    """Verification stays on. python.org's Python trusts only its own bundle, so a
    laptop whose TLS is inspected on the way out (a corporate proxy) fails with
    'self-signed certificate in certificate chain' while Chrome sails through.
    CENTRAL_CA_FILE names a PEM to trust; otherwise, on a Mac, trust what the
    keychains trust, which is what Chrome does; otherwise the default bundle."""
    ca = os.environ.get("CENTRAL_CA_FILE")
    if ca:
        return ssl.create_default_context(cafile=os.path.expanduser(ca))
    if platform.system() == "Darwin":
        pem = b""
        for kc in ("/System/Library/Keychains/SystemRootCertificates.keychain", "/Library/Keychains/System.keychain",
                   os.path.expanduser("~/Library/Keychains/login.keychain-db")):
            try:
                pem += subprocess.run(["security", "find-certificate", "-a", "-p", kc], capture_output=True, timeout=20).stdout
            except (OSError, subprocess.TimeoutExpired):
                pass
        if b"BEGIN CERTIFICATE" in pem:
            ctx = ssl.create_default_context()
            ctx.load_verify_locations(cadata=pem.decode("ascii", "ignore"))
            return ctx
    return ssl.create_default_context()


CTX = None


def load_token():
    try:
        with open(TOKEN_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        sys.exit(f"no token file at {TOKEN_FILE}; download one from API Gateway > System Apps & Tokens and set CENTRAL_TOKEN_FILE")


def refresh(tok):
    cid, sec = os.environ.get("CENTRAL_CLIENT_ID"), os.environ.get("CENTRAL_CLIENT_SECRET")
    if not (cid and sec and tok.get("refresh_token")):
        sys.exit("token expired; set CENTRAL_CLIENT_ID and CENTRAL_CLIENT_SECRET to refresh it, or download a new token file")
    q = urllib.parse.urlencode({"client_id": cid, "client_secret": sec, "grant_type": "refresh_token", "refresh_token": tok["refresh_token"]})
    req = urllib.request.Request(BASE + ENDPOINTS["refresh"] + "?" + q, data=b"", method="POST")
    with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
        new = json.load(r)
    tok.update(new)
    try:
        with open(TOKEN_FILE, "w") as f:
            json.dump(tok, f)
    except OSError:
        print("  refreshed, but could not rewrite the token file", file=sys.stderr)
    return tok


def get(tok, path, params=None, quiet=False):
    """One GET. Anything else is a bug in this file, not a feature."""
    global CALLS
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    if DRY:
        print(f"  would GET {path}" + (f"  {params}" if params else ""))
        return None
    for attempt in range(2):
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok.get("access_token", ""), "Accept": "application/json"})
        assert req.get_method() == "GET"
        try:
            CALLS += 1
            time.sleep(0.15)  # the classic gateway allows about 7 calls a second
            with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code == 401 and attempt == 0:
                refresh(tok)
                continue
            if not quiet:
                print(f"  {e.code} on {path}: {e.read()[:300].decode(errors='replace')}", file=sys.stderr)
            return None
    return None


def norm_mac(m):
    return (m or "").lower().replace("-", ":")


def band_key(b):
    b = str(b or "").lower()
    if b.startswith("2"): return "2.4"
    if b.startswith("6"): return "6"
    if b.startswith("5"): return "5"
    return b


def main():
    global DRY, CTX
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--group", required=True, help="Central group name, as shown in Network Structure")
    ap.add_argument("--site", help="site name, for its address and position (default: the group name)")
    ap.add_argument("--out", default="site.json")
    ap.add_argument("--dry-run", action="store_true", help="print the calls and make none")
    args = ap.parse_args()
    DRY = args.dry_run
    CTX = tls_context()
    tok = {} if DRY else load_token()

    print(("DRY RUN: " if DRY else "") + f"group {args.group} from {BASE}")

    # 1. the site, for where it is
    site = {"name": args.site or args.group}
    sites = get(tok, ENDPOINTS["sites"], {"limit": 100, "offset": 0}) or {}
    for s in sites.get("sites", []):
        if s.get("site_name", "").lower() == site["name"].lower():
            site.update({k: s.get(k) for k in ("site_id", "address", "city", "state", "country", "zipcode", "latitude", "longitude") if s.get(k) is not None})
    if "latitude" in site:
        print(f"  site {site['name']} at {site['latitude']}, {site['longitude']}")

    # 2. the access points in the group, radios and all
    aps, offset = [], 0
    while True:
        page = get(tok, ENDPOINTS["aps"], {"group": args.group, "limit": 100, "offset": offset, "calculate_total": "true", "show_resource_details": "true"}) or {}
        rows = page.get("aps", [])
        aps.extend(rows)
        offset += len(rows)
        if not rows or offset >= (page.get("total") or 0):
            break
    print(f"  {len(aps)} access points")

    out_aps, by_eth = [], {}
    for a in aps:
        d = get(tok, ENDPOINTS["ap"].format(serial=a["serial"]), quiet=True) or {}
        radios = []
        for r in a.get("radios", []) or []:
            det = next((x for x in d.get("radios", []) or [] if norm_mac(x.get("macaddr")) == norm_mac(r.get("macaddr"))), {})
            radios.append({
                "mac": norm_mac(r.get("macaddr")), "band": band_key(r.get("band")), "channel": r.get("channel"),
                "tx_dbm": r.get("tx_power"), "ss": r.get("spatial_stream"), "status": r.get("status"), "mode": r.get("mode"),
                "noise_dbm": det.get("noise_floor"), "utilization": r.get("utilization"),
            })
        row = {
            "name": a.get("name"), "serial": a.get("serial"), "mac": norm_mac(a.get("macaddr")), "model": a.get("model"),
            "status": a.get("status"), "mesh_role": a.get("mesh_role"), "ip": a.get("ip_address"), "site": a.get("site"),
            "firmware": a.get("firmware_version"), "radios": radios,
        }
        out_aps.append(row)
        by_eth[row["mac"]] = row

    # 3. AirMatch: what each radio is running (EIRP, width) and which AP it belongs to
    radio_ap = {}
    for r in get(tok, ENDPOINTS["radios"]) or []:
        eth = norm_mac(r.get("ap_eth_mac"))
        if eth not in by_eth:
            continue
        rm = norm_mac(r.get("radio_mac"))
        radio_ap[rm] = (eth, band_key(r.get("band")))
        # the monitoring radio MAC and AirMatch's radio MAC are usually the same;
        # when they differ the band picks the radio
        rs = by_eth[eth]["radios"]
        x = next((x for x in rs if x["mac"] == rm), None) or next((x for x in rs if x["band"] == band_key(r.get("band")) and "radio_mac" not in x), None)
        if x:
            x.update({"eirp_dbm": r.get("eirp_dbm", r.get("eirp")), "bw": r.get("bandwidth"), "chains": r.get("num_chains"), "radio_mac": rm})
    print(f"  {len(radio_ap)} radios known to AirMatch")

    # 4. the loss AirMatch measured between our radios, both directions kept
    pathloss = []
    for rm, (eth, band) in radio_ap.items():
        for n in get(tok, ENDPOINTS["pathloss"].format(radio_mac=rm, band=band), quiet=True) or []:
            nb = norm_mac(n.get("nbr_mac"))
            if nb not in radio_ap:
                continue  # somebody else's AP, or a BSSID we cannot place
            pathloss.append({
                "from": by_eth[eth]["serial"], "to": by_eth[radio_ap[nb][0]]["serial"], "band": band,
                "db": n.get("pathloss"), "channel": n.get("channel"), "bw": n.get("bandwidth"), "ts": n.get("timestamp"),
            })
    print(f"  {len(pathloss)} measured paths between these APs")

    # 5. positions, only where VisualRF has the AP on a floor plan
    placed = 0
    for c in (get(tok, ENDPOINTS["campus"], quiet=True) or {}).get("campus", []) or []:
        for b in (get(tok, ENDPOINTS["campus1"].format(campus_id=c["campus_id"]), quiet=True) or {}).get("buildings", []) or []:
            for fl in (get(tok, ENDPOINTS["building"].format(building_id=b["building_id"]), quiet=True) or {}).get("floors", []) or []:
                for x in (get(tok, ENDPOINTS["floor_aps"].format(floor_id=fl["floor_id"]), quiet=True) or {}).get("access_points", []) or []:
                    row = by_eth.get(norm_mac(x.get("ap_eth_mac")))
                    if row and x.get("latitude") is not None:
                        row.update({"lat": x["latitude"], "lon": x["longitude"], "floor": fl.get("floor_name")})
                        placed += 1
    if placed:
        print(f"  {placed} placed on a floor plan")
    else:
        print("  no floor plans, so no AP positions; the planner will lay them out for you to drag")

    doc = {"source": "aruba-central-classic", "base": BASE, "group": args.group, "pulled": time.strftime("%Y-%m-%dT%H:%M:%S"),
           "site": site, "aps": out_aps, "pathloss": pathloss,
           "note": "Loss is AirMatch's neighbour path loss in dB between radios. Positions are VisualRF floor placements; APs report no GNSS position through this API."}
    if DRY:
        print("dry run only; nothing written")
        return
    with open(args.out, "w") as f:
        json.dump(doc, f, indent=1)
    print(f"wrote {args.out} after {CALLS} calls")


if __name__ == "__main__":
    main()
