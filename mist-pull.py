#!/usr/bin/env python3
"""Pull one Juniper Mist site's access points and what they hear of each other,
and write the same site.json central-pull.py writes, for the mesh planner.

    python3 mist-pull.py --site "Main Street" --out site.json
    python3 mist-pull.py --site "Main Street" --dry-run      # list the calls, make none

Nothing here writes to Mist: every request is a GET and the code refuses any
other method. Credentials stay in the environment:

    export MIST_TOKEN=...                       # Org > Settings > API Tokens, or a user token
    export MIST_ORG_ID=...                      # from the org URL, or leave unset to pick the only org the token sees
    export MIST_BASE=https://api.mist.com       # your cloud: api.mist.com, api.gc1.mist.com, api.eu.mist.com, api.ac2.mist.com

Endpoints are the Mist API reference (api.mist.com/api/v1/docs) as remembered
in 2026-09 and are marked to verify: this script has not yet been run against
a live org. Where a shape is uncertain the parser is tolerant and says what it
found. TLS is verified; on a Mac whose outbound TLS is inspected the script
trusts the keychains the way a browser does, or set MIST_CA_FILE to a PEM.
"""
import argparse, json, math, os, platform, re, ssl, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

BASE = os.environ.get("MIST_BASE", "https://api.mist.com").rstrip("/")

# verify these against api.mist.com/api/v1/docs for your org
ENDPOINTS = {
    "self":       "/api/v1/self",
    "sites":      "/api/v1/orgs/{org_id}/sites",
    "devices":    "/api/v1/sites/{site_id}/devices?type=ap",
    "stats":      "/api/v1/sites/{site_id}/stats/devices?type=ap",
    "maps":       "/api/v1/sites/{site_id}/maps",
    "neighbors":  "/api/v1/sites/{site_id}/rrm/neighbors?band={band}",
}

DRY = False
CALLS = 0
CTX = None


def tls_context():
    ca = os.environ.get("MIST_CA_FILE")
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


def get(path, quiet=False):
    """One GET. Anything else is a bug in this file, not a feature."""
    global CALLS
    if DRY:
        print(f"  would GET {path}")
        return None
    tok = os.environ.get("MIST_TOKEN")
    if not tok:
        sys.exit("set MIST_TOKEN")
    req = urllib.request.Request(BASE + path, headers={"Authorization": "Token " + tok, "Accept": "application/json"})
    assert req.get_method() == "GET"
    try:
        CALLS += 1
        time.sleep(0.1)
        with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        if not quiet:
            print(f"  {e.code} on {path}: {e.read()[:300].decode(errors='replace')}", file=sys.stderr)
        return None


def norm_mac(m):
    m = re.sub(r"[^0-9a-f]", "", str(m or "").lower())
    return ":".join(m[i:i + 2] for i in range(0, 12, 2)) if len(m) == 12 else m


def band_key(b):
    b = str(b if b is not None else "").lower().replace("band_", "").replace("ghz", "")
    return {"24": "2.4", "2.4": "2.4", "5": "5", "6": "6"}.get(b, b)


def width_mhz(bw):
    m = re.search(r"(\d+)", str(bw if bw is not None else ""))
    return int(m.group(1)) if m else None


def find_lists(obj, want):
    """Walk any JSON and yield every dict that has the keys in want; the RRM
    neighbour shape is the least certain thing in this file."""
    if isinstance(obj, dict):
        if all(k in obj for k in want):
            yield obj
        for v in obj.values():
            yield from find_lists(v, want)
    elif isinstance(obj, list):
        for v in obj:
            yield from find_lists(v, want)


def main():
    global DRY, CTX
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--site", required=True, help="site name as shown in Mist, or its id")
    ap.add_argument("--out", default="site.json")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    DRY = args.dry_run
    CTX = tls_context()
    print(("DRY RUN: " if DRY else "") + f"site {args.site} from {BASE}")

    org = os.environ.get("MIST_ORG_ID")
    if not org and not DRY:
        me = get(ENDPOINTS["self"]) or {}
        orgs = sorted({p.get("org_id") for p in me.get("privileges", []) if p.get("org_id")})
        if len(orgs) != 1:
            sys.exit(f"the token sees {len(orgs)} orgs; set MIST_ORG_ID")
        org = orgs[0]
    org = org or "<org_id>"

    # 1. the site
    site = {"name": args.site}
    for s in get(ENDPOINTS["sites"].format(org_id=org)) or []:
        if s.get("name", "").lower() == args.site.lower() or s.get("id") == args.site:
            ll = s.get("latlng") or {}
            site.update({"site_id": s.get("id"), "address": s.get("address"), "latitude": ll.get("lat"), "longitude": ll.get("lng"),
                         "country": s.get("country_code"), "rftemplate_id": s.get("rftemplate_id")})
    sid = site.get("site_id") or "<site_id>"
    if site.get("latitude") is not None:
        print(f"  site {site['name']} at {site['latitude']}, {site['longitude']}")

    # 2. the APs: the config from devices, the running channel, power and noise from stats
    devices = get(ENDPOINTS["devices"].format(site_id=sid)) or []
    stats = {norm_mac(x.get("mac")): x for x in (get(ENDPOINTS["stats"].format(site_id=sid)) or [])}
    maps = {m.get("id"): m for m in (get(ENDPOINTS["maps"].format(site_id=sid), quiet=True) or [])}
    print(f"  {len(devices)} access points")
    out_aps, by_mac, placed = [], {}, 0
    for d in devices:
        mac = norm_mac(d.get("mac"))
        st = stats.get(mac, {})
        radios = []
        for bk, rs in (st.get("radio_stat") or {}).items():
            radios.append({
                "mac": norm_mac(rs.get("mac")), "band": band_key(bk), "channel": rs.get("channel"), "bw": width_mhz(rs.get("bandwidth")),
                "tx_dbm": rs.get("power"), "eirp_dbm": rs.get("power"), "noise_dbm": rs.get("noise_floor"), "utilization": rs.get("util_all"),
                "status": "Down" if rs.get("disabled") else "Up",
            })
        mesh = d.get("mesh") or st.get("mesh") or {}
        role = mesh.get("role") if isinstance(mesh, dict) else None
        row = {
            "name": d.get("name"), "serial": d.get("serial"), "mac": mac, "model": d.get("model"),
            "status": "Up" if st.get("status") == "connected" else (st.get("status") or "unknown"),
            "mesh_role": {"base": "portal", "relay": "point"}.get(role, role or "Unknown"), "ip": st.get("ip"), "site": site["name"],
            "firmware": st.get("version"), "radios": radios,
        }
        # a device on a map with a real-world anchor has a position: x, y in pixels, ppm pixels per metre, north up unless the map says otherwise (verify)
        mp = maps.get(d.get("map_id") or st.get("map_id"))
        x, y = d.get("x", st.get("x")), d.get("y", st.get("y"))
        if mp and isinstance(mp.get("latlng"), dict) and mp.get("ppm") and x is not None and y is not None:
            ppm, o = float(mp["ppm"]), math.radians(float(mp.get("orientation") or 0))
            ex, ny = x / ppm, -y / ppm
            east, north = ex * math.cos(o) - ny * math.sin(o), ex * math.sin(o) + ny * math.cos(o)
            lat0, lon0 = float(mp["latlng"]["lat"]), float(mp["latlng"]["lng"])
            row.update({"lat": lat0 + north / 110574, "lon": lon0 + east / (111320 * math.cos(math.radians(lat0))), "floor": mp.get("name")})
            placed += 1
        out_aps.append(row)
        by_mac[mac] = row
        for r in radios:
            if r["mac"]:
                by_mac[r["mac"]] = row

    # 3. what each AP hears of the others: RRM neighbours, RSSI per band (shape to verify)
    heard, strangers = [], 0
    for band in ("24", "5", "6"):
        res = get(ENDPOINTS["neighbors"].format(site_id=sid, band=band), quiet=True)
        if not res:
            continue
        for rep in find_lists(res, ("mac", "neighbors")):
            me_row = by_mac.get(norm_mac(rep.get("mac")))
            for nb in rep.get("neighbors") or []:
                other = by_mac.get(norm_mac(nb.get("mac") or nb.get("bssid")))
                if not me_row or not other or other is me_row:
                    strangers += 1
                    continue
                if nb.get("rssi") is None:
                    continue
                heard.append({"from": me_row["serial"], "to": other["serial"], "band": band_key(band), "rssi": nb.get("rssi"), "channel": nb.get("channel"), "ts": nb.get("timestamp")})
    print(f"  {len(heard)} neighbour readings between these APs" + (f", {strangers} to radios not in the site" if strangers else ""))
    if placed:
        print(f"  {placed} placed on a map with a real-world anchor")
    else:
        print("  no anchored map positions; the planner will lay them out for you to drag")

    doc = {"source": "juniper-mist", "base": BASE, "group": site["name"], "pulled": time.strftime("%Y-%m-%dT%H:%M:%S"),
           "site": site, "aps": out_aps, "pathloss": heard,
           "note": "Neighbour readings are RRM RSSI in dBm at the reporting AP, not a path loss; the planner takes either. Positions come from devices placed on a map that has a real-world anchor. Endpoint and field shapes are to verify against api.mist.com/api/v1/docs; not yet run against a live org."}
    if DRY:
        print("dry run only; nothing written")
        return
    with open(args.out, "w") as f:
        json.dump(doc, f, indent=1)
    print(f"wrote {args.out} after {CALLS} calls")


if __name__ == "__main__":
    main()
