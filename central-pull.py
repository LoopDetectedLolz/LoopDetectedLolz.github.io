#!/usr/bin/env python3
"""Pull one group's access points and the loss AirMatch measured between them
out of Aruba Central, and write a site.json the mesh planner can import.

    python3 central-pull.py --group Burns-Home --out site.json
    python3 central-pull.py --group Burns-Home --story 48 --out site.json    # plus two days of what happened
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
import argparse, json, os, platform, re, ssl, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

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
    # the story: what every client did, what every radio heard, and what changed
    "clients":   "/monitoring/v1/clients/wireless",
    "trail":     "/monitoring/v1/clients/wireless/{mac}/mobility_trail",
    "rf":        "/monitoring/v3/aps/{serial}/rf_summary",
    "rf_events": "/airmatch/telemetry/v1/rf_events/{radio_mac}",
    "audit":     "/auditlogs/v1/events",
    "count":     "/monitoring/v1/clients/count",
    "usage":     "/monitoring/v3/aps/bandwidth_usage",
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
    q = urllib.parse.urlencode({"client_id": cid.strip(), "client_secret": sec.strip(), "grant_type": "refresh_token", "refresh_token": tok["refresh_token"]})
    req = urllib.request.Request(BASE + ENDPOINTS["refresh"] + "?" + q, data=b"", method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
            new = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"refresh refused ({e.code}): {e.read()[:300].decode(errors='replace')}\n"
                 "a refresh token is single use and lasts about two weeks; if it was already spent, download a new token file")
    if "access_token" not in new:
        sys.exit("refresh returned no access token: " + json.dumps(new)[:300])
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
    """Monitoring gives a radio's band as a code (0 or blank 2.4 GHz, 1 5 GHz,
    3 6 GHz); AirMatch says 5GHz or 5ghz. Everything becomes 2.4, 5 or 6."""
    b = str(b if b is not None else "").strip().lower()
    if b in ("", "0", "2.4", "2.4ghz", "2"): return "2.4"
    if b in ("1", "5", "5ghz"): return "5"
    if b in ("3", "6", "6ghz"): return "6"
    if b.startswith("2"): return "2.4"
    if b.startswith("6"): return "6"
    if b.startswith("5"): return "5"
    return b


def channel_width(ch):
    """Monitoring writes the channel Aruba style: 149E is 149 at 80 MHz, 36+ or
    40- is 40 MHz, 5S is 160 MHz, a bare number is 20. Returns (channel, MHz)."""
    t = str(ch if ch is not None else "").strip()
    m = re.match(r"^(\d+)([ES+\-]?)$", t)
    if not m:
        return None, None
    return int(m.group(1)), {"E": 80, "S": 160, "+": 40, "-": 40}.get(m.group(2), 20)


def width_mhz(bw):
    """AirMatch says CBW80; the planner wants 80."""
    m = re.search(r"(\d+)", str(bw if bw is not None else ""))
    return int(m.group(1)) if m else None


def streams(ss):
    """'2x2:2' is two streams."""
    m = re.search(r":(\d+)$", str(ss if ss is not None else ""))
    if m:
        return int(m.group(1))
    m = re.match(r"^(\d+)", str(ss if ss is not None else ""))
    return int(m.group(1)) if m else None


def model_id(m):
    """Monitoring says 735, the QuickSpecs and the planner say AP-735."""
    m = str(m if m is not None else "").strip()
    return m if not m or m.upper().startswith("AP-") else "AP-" + m


def noise(v):
    """Monitoring reports the noise floor as a positive number of dB below zero."""
    return -abs(v) if isinstance(v, (int, float)) else None


def story(tok, group, out_aps, radio_ap, hours):
    """Everything that happened on the site over the window, for the timeline,
    the interference graph, the RF weather and plan against actual."""
    now = int(time.time()); t0 = now - int(hours * 3600)
    by_serial = {a["serial"]: a for a in out_aps}
    # every client's hops
    trails, offset, clients = [], 0, []
    while True:
        page = get(tok, ENDPOINTS["clients"], {"group": group, "limit": 200, "offset": offset, "calculate_total": "true"}) or {}
        rows = page.get("clients", []); clients.extend(rows); offset += len(rows)
        if not rows or offset >= (page.get("total") or 0): break
    for c in clients:
        mac = norm_mac(c.get("macaddr")); hops, off = [], 0
        while True:
            page = get(tok, ENDPOINTS["trail"].format(mac=mac), {"calculate_total": "true", "limit": 100, "offset": off, "from_timestamp": t0, "to_timestamp": now}, quiet=True) or {}
            part = page.get("trails", []); hops.extend(part); off += len(part)
            if not part or off >= (page.get("total") or 0) or off >= 3000: break
        if not hops: continue
        hs = []
        for t in hops:
            ch, bw = channel_width(t.get("channel")); lat = t.get("latency"); rssi = t.get("rssi")
            hs.append({"ts": int(t["ts"] / 1000) if t.get("ts", 0) > 1e12 else t.get("ts"), "ap": t.get("ap_name"), "serial": t.get("ap_serial"), "prev": t.get("previous_ap_name"),
                       "type": t.get("roaming_type"), "latency_ms": int(lat) if str(lat or "").lstrip("-").isdigit() else None, "band": band_key(t.get("band")), "channel": ch, "bw": bw,
                       "rssi_dbm": rssi if isinstance(rssi, (int, float)) and rssi < 0 else None, "join": not t.get("previous_ap_name")})
        hs.sort(key=lambda h: h["ts"] or 0)
        trails.append({"mac": mac, "name": c.get("name"), "os": c.get("os_type"), "hops": hs})
    print(f"  {len(clients)} clients, {sum(len(t['hops']) for t in trails)} hops over {hours:g} h")
    # what every radio heard: noise floor and utilisation in five minute samples; the API hands back
    # a bounded window per call, so walk it in three hour steps
    rf = {}
    for a in out_aps:
        for r in a["radios"]:
            if r.get("status") == "Down" or not r.get("band"): continue
            samples, cur = [], t0
            while cur < now:
                end = min(now, cur + 3 * 3600)
                page = get(tok, ENDPOINTS["rf"].format(serial=a["serial"]), {"band": r["band"], "radio_number": {"5": 0, "2.4": 1, "6": 2}.get(r["band"], 0), "from_timestamp": cur, "to_timestamp": end}, quiet=True) or {}
                for smp in page.get("samples", []) or []:
                    samples.append({"ts": smp.get("timestamp"), "noise_dbm": smp.get("noise_floor"), "util_pct": smp.get("utilization")})
                cur = end
            rf[r["mac"]] = {"ap": a["name"], "serial": a["serial"], "band": r["band"], "samples": samples}
    print(f"  {len(rf)} radios with {sum(len(v['samples']) for v in rf.values())} five minute samples")
    # what changed: reboots from uptime, channel moves from AirMatch, people from the audit trail
    events = []
    for a in out_aps:
        up = a.get("uptime_s")
        if isinstance(up, (int, float)) and now - up >= t0:
            events.append({"ts": int(now - up), "kind": "reboot", "ap": a["name"], "text": f"{a['name']} came up" + (f" ({a['reboot_reason']})" if a.get("reboot_reason") else "")})
    for rm, (eth, band) in radio_ap.items():
        for e in get(tok, ENDPOINTS["rf_events"].format(radio_mac=rm), quiet=True) or []:
            if not e or not isinstance(e, dict) or (e.get("timestamp") or 0) < t0: continue
            apn = next((x["name"] for x in out_aps if x["mac"] == eth), eth)
            events.append({"ts": e.get("timestamp"), "kind": "channel", "ap": apn, "band": band, "text": f"{apn} {band} GHz moved from {e.get('channel')} to {e.get('new_channel')} at {width_mhz(e.get('new_bandwidth'))} MHz ({str(e.get('type') or '').replace('AIRMATCH_', '').lower()})"})
    au = get(tok, ENDPOINTS["audit"], {"limit": 200, "offset": 0, "start_time": t0, "end_time": now}, quiet=True) or {}
    for e in au.get("events", []) or []:
        events.append({"ts": e.get("ts"), "kind": "config", "ap": e.get("target") if e.get("target") not in (None, "-") else None, "text": f"{e.get('classification') or 'change'}: {e.get('description')}", "user": e.get("user")})
    events.sort(key=lambda e: e["ts"] or 0)
    print(f"  {len(events)} events: " + ", ".join(f"{k} {sum(1 for e in events if e['kind'] == k)}" for k in ("reboot", "channel", "config")))
    # plan against actual: the site's client count over time and each AP's traffic
    count = [{"ts": x.get("timestamp"), "clients": x.get("client_count")} for x in (get(tok, ENDPOINTS["count"], {"group": group, "from_timestamp": now - min(int(hours * 3600), 3 * 3600), "to_timestamp": now}, quiet=True) or {}).get("samples", []) or []]
    usage = {}
    for a in out_aps:
        smp = (get(tok, ENDPOINTS["usage"], {"serial": a["serial"], "from_timestamp": now - min(int(hours * 3600), 3 * 3600), "to_timestamp": now}, quiet=True) or {}).get("samples", []) or []
        usage[a["serial"]] = {"ap": a["name"], "clients_now": a.get("client_count"), "samples": [{"ts": x.get("timestamp"), "tx_bytes": x.get("tx_data_bytes"), "rx_bytes": x.get("rx_data_bytes")} for x in smp]}
    return {"hours": hours, "from": t0, "to": now, "trails": trails, "rf": rf, "events": events, "count": count, "usage": usage}


def main():
    global DRY, CTX
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--group", required=True, help="Central group name, as shown in Network Structure")
    ap.add_argument("--site", help="site name, for its address and position (default: the group name)")
    ap.add_argument("--out", default="site.json")
    ap.add_argument("--dry-run", action="store_true", help="print the calls and make none")
    ap.add_argument("--keys", action="store_true", help="print every field name the AP list and AP detail records carry, with a sample value for any that looks like a position, then stop (GET only, writes nothing)")
    ap.add_argument("--story", type=float, default=0, metavar="HOURS", help="also pull what happened: every client's hops, every radio's noise and utilisation, reboots, channel moves and the audit trail over this window")
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
        page = get(tok, ENDPOINTS["aps"], {"group": args.group, "limit": 100, "offset": offset, "calculate_total": "true", "calculate_client_count": "true", "show_resource_details": "true"}) or {}
        rows = page.get("aps", [])
        aps.extend(rows)
        offset += len(rows)
        if not rows or offset >= (page.get("total") or 0):
            break
    print(f"  {len(aps)} access points")

    if args.keys:
        # what the tenant actually returns, so "does the API carry an AP position" is read, not remembered
        def walk(o, pre, into):
            if isinstance(o, dict):
                for k, v in o.items(): walk(v, pre + k + ".", into)
            elif isinstance(o, list) and o and isinstance(o[0], dict): walk(o[0], pre + "[].", into)
            else: into[pre[:-1]] = o
        for a in aps:
            flat = {}
            walk(a, "", flat); walk(get(tok, ENDPOINTS["ap"].format(serial=a["serial"]), quiet=True) or {}, "detail.", flat)
            geo = {k: v for k, v in flat.items() if re.search(r"lat|lon|gps|gnss|geo|alt|position|locat|ftm|range", k, re.I)}
            print(f"  {a.get('name')}: {len(flat)} fields; position-like: " + (", ".join(f"{k}={v!r}" for k, v in geo.items()) if geo else "none"))
        print("  all field names, once:")
        names = set()
        for a in aps:
            flat = {}; walk(a, "", flat); names.update(flat)
        print("   " + ", ".join(sorted(names)))
        return
    for a in aps:
        d = get(tok, ENDPOINTS["ap"].format(serial=a["serial"]), quiet=True) or {}
        radios = []
        for r in a.get("radios", []) or []:
            det = next((x for x in d.get("radios", []) or [] if norm_mac(x.get("macaddr")) == norm_mac(r.get("macaddr"))), {})
            ch, bw = channel_width(r.get("channel"))
            radios.append({
                "mac": norm_mac(r.get("macaddr")), "band": band_key(r.get("band")), "channel": ch, "bw": bw, "channel_raw": r.get("channel"),
                "tx_dbm": r.get("tx_power"), "ss": streams(r.get("spatial_stream")), "status": r.get("status"), "mode": r.get("mode"),
                "noise_dbm": noise(det.get("noise_floor")), "utilization": r.get("utilization"),
            })
        row = {
            "name": a.get("name"), "serial": a.get("serial"), "mac": norm_mac(a.get("macaddr")), "model": model_id(a.get("model")),
            "status": a.get("status"), "mesh_role": a.get("mesh_role"), "ip": a.get("ip_address"), "site": a.get("site"),
            "firmware": a.get("firmware_version"), "radios": radios,
            "uptime_s": a.get("uptime"), "client_count": a.get("client_count"), "reboot_reason": d.get("last_reboot_reason"),
            # the wired side, as far as Classic sees it: the AP's own ports. The switch and its
            # PoE budget live in New Central on a tenant like this one and are not here.
            "uplink": d.get("current_uplink_inuse"),
            "ethernets": [{"name": e.get("name"), "speed_mbps": int(e["link_speed"]) if str(e.get("link_speed", "")).isdigit() else None, "duplex": e.get("duplex_mode"), "up": e.get("operational_state") == "Up"} for e in (d.get("ethernets") or [])],
        }
        out_aps.append(row)
        by_eth[row["mac"]] = row

    # 3. AirMatch: what each radio is running (EIRP, width) and which AP it belongs to
    radio_ap = {}
    for r in get(tok, ENDPOINTS["radios"]) or []:
        eth = norm_mac(r.get("ap_eth_mac"))
        if eth not in by_eth:
            continue
        rm = norm_mac(r.get("radio_mac") or r.get("mac"))  # the Swagger says radio_mac, the gateway sends mac
        if not rm:
            continue
        radio_ap[rm] = (eth, band_key(r.get("band")))
        # the monitoring radio MAC and AirMatch's radio MAC are usually the same;
        # when they differ the band picks the radio
        rs = by_eth[eth]["radios"]
        x = next((x for x in rs if x["mac"] == rm), None) or next((x for x in rs if x["band"] == band_key(r.get("band")) and "radio_mac" not in x), None)
        if x:
            x.update({"eirp_dbm": r.get("eirp_dbm", r.get("eirp")), "bw": width_mhz(r.get("bandwidth")) or x.get("bw"), "chains": r.get("num_chains"), "radio_mac": rm,
                      "channel": r.get("channel") or x.get("channel"), "static_channel": bool(r.get("is_static_chan")), "static_eirp": bool(r.get("is_static_eirp"))})
    print(f"  {len(radio_ap)} radios known to AirMatch")

    # 4. the loss AirMatch measured between our radios, both directions kept
    pathloss, strangers = [], 0
    for rm, (eth, band) in radio_ap.items():
        # the path wants 2.4ghz, 5ghz or 6ghz, lower case, and says so in a 400 otherwise
        for n in get(tok, ENDPOINTS["pathloss"].format(radio_mac=rm, band=band + "ghz"), quiet=True) or []:
            nb = norm_mac(n.get("nbr_mac"))
            if nb not in radio_ap:
                strangers += 1  # somebody else's AP, or a radio we cannot place
                continue
            pathloss.append({
                "from": by_eth[eth]["serial"], "to": by_eth[radio_ap[nb][0]]["serial"], "band": band,
                "db": n.get("pathloss"), "avg_db": n.get("avg"), "channel": n.get("channel"), "bw": width_mhz(n.get("bandwidth")), "ts": n.get("timestamp"),
            })
    print(f"  {len(pathloss)} measured paths between these APs" + (f", {strangers} to radios that are not in the group" if strangers else ""))

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

    st = story(tok, args.group, out_aps, radio_ap, args.story) if args.story and not DRY else None
    doc = {"source": "aruba-central-classic", "base": BASE, "group": args.group, "pulled": time.strftime("%Y-%m-%dT%H:%M:%S"),
           "site": site, "aps": out_aps, "pathloss": pathloss, "story": st,
           "note": "Loss is AirMatch's neighbour path loss in dB between radios (db is the latest, avg_db the running mean). Positions are VisualRF floor placements; APs report no GNSS position through this API. Field shapes checked against a live CA tenant on 2026-09-12."}
    if DRY:
        print("dry run only; nothing written")
        return
    with open(args.out, "w") as f:
        json.dump(doc, f, indent=1)
    print(f"wrote {args.out} after {CALLS} calls")


if __name__ == "__main__":
    main()
