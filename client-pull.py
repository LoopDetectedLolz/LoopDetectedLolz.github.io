#!/usr/bin/env python3
"""Read one wireless client's link from Aruba Central and hand it to the
simulator: once, as a snapshot file, or continuously, as a local relay the
page polls.

    python3 client-pull.py --client "Dustin's iPhone" --out reading.json     # one reading, open it on the Live chip
    python3 client-pull.py --client aa:bb:cc:dd:ee:ff --serve 8830          # poll every 30 s, serve /latest.json on localhost
    python3 client-pull.py --client iPhone --trail 24 --out reading.json     # plus the last day's roams: the journey
    python3 client-pull.py --list                                             # who is on, to pick a name
    python3 client-pull.py --client x --dry-run

The simulator never calls Central. This does, from the laptop, GET only (the
code refuses any other method), with the same token file central-pull.py uses:

    export CENTRAL_TOKEN_FILE=~/.config/nfn/central-token.json
    export CENTRAL_BASE=https://apigw-ca.central.arubanetworks.com
    export CENTRAL_CLIENT_ID=... CENTRAL_CLIENT_SECRET=...   # to refresh an expired token

The relay listens on 127.0.0.1 only and answers GET /latest.json with
Access-Control-Allow-Origin: * so the page on any origin can read it. A page
on https can read http://127.0.0.1 in Chrome and Edge (localhost is trusted);
Safari may refuse, so use the snapshot there.

What a reading holds: the client's signal, SNR, current and top rate, band,
channel and width, health and usage from /monitoring/v1/clients/wireless/{mac}
and the serving AP's radio utilisation and noise floor from
/monitoring/v1/aps/{serial}. Classic Central has no per-client retry count and
no call quality through this API (UCC is configuration only), so retry_pct and
mos are null here; a Mist reading can fill them. Field shapes were checked on
a live CA tenant on 2026-09-12 for the AP side; the client side follows the
Swagger and is marked to verify on first run.
"""
import argparse, http.server, json, os, platform, re, ssl, subprocess, sys, threading, time, urllib.error, urllib.parse, urllib.request

BASE = os.environ.get("CENTRAL_BASE", "https://apigw-ca.central.arubanetworks.com").rstrip("/")
TOKEN_FILE = os.path.expanduser(os.environ.get("CENTRAL_TOKEN_FILE", "~/.config/nfn/central-token.json"))

ENDPOINTS = {
    "refresh": "/oauth2/token",
    "clients": "/monitoring/v1/clients/wireless",
    "client":  "/monitoring/v1/clients/wireless/{mac}",
    "ap":      "/monitoring/v1/aps/{serial}",
    "trail":   "/monitoring/v1/clients/wireless/{mac}/mobility_trail",
}

DRY = False
CTX = None


def tls_context():
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
        sys.exit(f"refresh refused ({e.code}): {e.read()[:300].decode(errors='replace')}")
    tok.update(new)
    try:
        with open(TOKEN_FILE, "w") as f:
            json.dump(tok, f)
    except OSError:
        pass
    return tok


def get(tok, path, params=None, quiet=False):
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    if DRY:
        print(f"  would GET {path}" + (f"  {params}" if params else ""))
        return None
    for attempt in range(2):
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok.get("access_token", ""), "Accept": "application/json"})
        assert req.get_method() == "GET"
        try:
            time.sleep(0.15)
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
    b = str(b if b is not None else "").strip().lower()
    if b in ("", "0", "2.4", "2.4ghz", "2"): return "2.4"
    if b in ("1", "5", "5ghz"): return "5"
    if b in ("3", "6", "6ghz"): return "6"
    return b


def channel_width(ch):
    """The AP API says 116E; the client API says 116 (80 MHz). Both read."""
    t = str(ch if ch is not None else "").strip()
    m = re.match(r"^(\d+)\s*\((\d+)\s*MHz\)$", t, re.I)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.match(r"^(\d+)([ES+\-]?)$", t)
    return (int(m.group(1)), {"E": 80, "S": 160, "+": 40, "-": 40}.get(m.group(2), 20)) if m else (None, None)


def find_client(tok, who, group=None):
    """A MAC goes straight to the detail call; a name is looked up in the list."""
    if re.match(r"^([0-9a-f]{2}[:\-]){5}[0-9a-f]{2}$", who.lower()):
        return norm_mac(who), None
    params = {"limit": 200, "offset": 0, "calculate_total": "true"}
    if group:
        params["group"] = group
    rows = (get(tok, ENDPOINTS["clients"], params) or {}).get("clients", [])
    hit = [c for c in rows if who.lower() in (c.get("name") or "").lower() or who.lower() in (c.get("username") or "").lower() or who.lower() in (c.get("ip_address") or "")]
    if not hit:
        return None, rows
    return norm_mac(hit[0]["macaddr"]), rows


AP_CACHE = {}


def ap_info(tok, serial):
    """An AP's name, model and per band noise floor and power, cached for the run."""
    if not serial:
        return {}
    if serial not in AP_CACHE:
        ap = get(tok, ENDPOINTS["ap"].format(serial=serial), quiet=True) or {}
        radios = {}
        for r in ap.get("radios", []) or []:
            nf = r.get("noise_floor")
            radios[band_key(r.get("band"))] = {"noise_dbm": -abs(nf) if isinstance(nf, (int, float)) else None, "tx_dbm": r.get("tx_power"), "util_pct": r.get("utilization"), "mac": norm_mac(r.get("macaddr"))}
        AP_CACHE[serial] = {"serial": serial, "name": ap.get("name"), "model": (lambda m: m if not m or m.upper().startswith("AP-") else "AP-" + m)(str(ap.get("model") or "")), "radios": radios}
    return AP_CACHE[serial]


def trail(tok, mac, hours):
    """The client's roams over the window, oldest first, one row per hop: where it
    landed, where it came from, how long the roam took, what it heard. An entry
    with no previous AP is a fresh association and its RSSI is 0 or missing."""
    now = int(time.time())
    rows, offset = [], 0
    while True:
        page = get(tok, ENDPOINTS["trail"].format(mac=mac), {"calculate_total": "true", "limit": 100, "offset": offset, "from_timestamp": now - int(hours * 3600), "to_timestamp": now}) or {}
        part = page.get("trails", [])
        rows.extend(part)
        offset += len(part)
        if not part or offset >= (page.get("total") or 0) or offset >= 5000:
            break
    out = []
    for t in rows:
        ch, bw = channel_width(t.get("channel"))
        lat = t.get("latency")
        rssi = t.get("rssi")
        out.append({
            "ts": int(t["ts"] / 1000) if t.get("ts", 0) > 1e12 else t.get("ts"),
            "ap": t.get("ap_name"), "serial": t.get("ap_serial"), "prev": t.get("previous_ap_name"),
            "type": t.get("roaming_type"), "latency_ms": int(lat) if str(lat or "").lstrip("-").isdigit() else None,
            "band": band_key(t.get("band")), "channel": ch, "bw": bw, "bssid": norm_mac(t.get("bssid")),
            "rssi_dbm": rssi if isinstance(rssi, (int, float)) and rssi < 0 else None,
            "join": not t.get("previous_ap_name"),
        })
    out.sort(key=lambda r: r["ts"] or 0)
    return out


def reading(tok, mac, hours=0):
    c = get(tok, ENDPOINTS["client"].format(mac=mac)) or {}
    if not c:
        return None
    serial = c.get("associated_device")
    ap = get(tok, ENDPOINTS["ap"].format(serial=serial), quiet=True) or {} if serial else {}
    band = band_key(c.get("band"))
    ch, bw = channel_width(c.get("channel"))
    radio = next((r for r in ap.get("radios", []) or [] if norm_mac(r.get("macaddr")) == norm_mac(c.get("radio_mac"))), None) \
        or next((r for r in ap.get("radios", []) or [] if band_key(r.get("band")) == band), {})
    nf = radio.get("noise_floor")
    nf = -abs(nf) if isinstance(nf, (int, float)) else None
    sig = c.get("signal_db")
    snr = c.get("snr")
    if not isinstance(snr, (int, float)) and isinstance(sig, (int, float)) and nf is not None:
        snr = sig - nf
    tr = trail(tok, mac, hours) if hours else []
    aps = {}
    for t in tr:
        if t["serial"] and t["serial"] not in aps:
            aps[t["serial"]] = ap_info(tok, t["serial"])
    if serial and serial not in aps:
        aps[serial] = ap_info(tok, serial)
    return {
        "source": "aruba-central-classic", "kind": "client", "ts": int(time.time()),
        "trail": tr, "trail_hours": hours, "aps": aps,
        "client": {"mac": mac, "name": c.get("name"), "username": c.get("username"), "ip": c.get("ip_address"), "os": c.get("os_type"), "network": c.get("network")},
        "ap": {"serial": serial, "name": ap.get("name"), "model": (lambda m: m if not m or m.upper().startswith("AP-") else "AP-" + m)(str(ap.get("model") or ""))},
        "radio": {"band": band, "channel": ch, "bw": bw, "channel_raw": c.get("channel"), "tx_dbm": radio.get("tx_power"), "noise_dbm": nf, "util_pct": radio.get("utilization")},
        "link": {"rssi_dbm": sig, "snr_db": snr, "speed_mbps": c.get("speed"), "max_mbps": c.get("maxspeed"), "health": c.get("health"), "usage_bytes": c.get("usage"), "retry_pct": None},
        "mos": None,
        "note": "Classic Central: a minute's averages; no per-client retries or call quality through this API.",
    }


def serve(port, every, tok, mac, hours=0):
    """The relay: poll on a timer, answer GET /latest.json to anyone on this machine."""
    state = {"latest": None, "err": None}

    def poll():
        while True:
            try:
                r = reading(tok, mac, hours)
                if r:
                    state["latest"], state["err"] = r, None
                    print(f"  {time.strftime('%H:%M:%S')} {r['client'].get('name') or mac}: {r['link'].get('rssi_dbm')} dBm, SNR {r['link'].get('snr_db')}, {r['link'].get('speed_mbps')} of {r['link'].get('max_mbps')} Mb/s on {r['ap'].get('name')}")
                else:
                    state["err"] = "client not found; is it still associated?"
                    print("  " + state["err"])
            except Exception as e:  # keep serving the last good reading
                state["err"] = str(e)
                print("  poll failed: " + state["err"], file=sys.stderr)
            time.sleep(every)

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.split("?")[0] != "/latest.json":
                self.send_response(404); self.end_headers(); return
            body = json.dumps(state["latest"] or {"error": state["err"] or "no reading yet"}).encode()
            self.send_response(200 if state["latest"] else 503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    threading.Thread(target=poll, daemon=True).start()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    print(f"  serving http://127.0.0.1:{port}/latest.json every {every} s (ctrl-c to stop); point the simulator's Live chip at it")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


def main():
    global DRY, CTX
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--client", help="client name, user name, IP, or MAC")
    ap.add_argument("--group", help="narrow the name lookup to a Central group")
    ap.add_argument("--list", action="store_true", help="list wireless clients and stop")
    ap.add_argument("--out", help="write one reading here and stop")
    ap.add_argument("--serve", type=int, metavar="PORT", help="poll and serve /latest.json on 127.0.0.1:PORT")
    ap.add_argument("--every", type=int, default=30, help="seconds between polls when serving (default 30)")
    ap.add_argument("--trail", type=float, default=0, metavar="HOURS", help="also pull the client's roaming trail over this many hours (the journey)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    DRY = args.dry_run
    CTX = tls_context()
    tok = {} if DRY else load_token()

    if args.list:
        params = {"limit": 200, "offset": 0}
        if args.group:
            params["group"] = args.group
        for c in (get(tok, ENDPOINTS["clients"], params) or {}).get("clients", []):
            print(f"  {c.get('macaddr')}  {(c.get('name') or '-')[:28]:28} {(c.get('os_type') or '-')[:14]:14} {c.get('signal_db')} dBm  {c.get('speed')} Mb/s  on {c.get('associated_device')}")
        return
    if not args.client:
        sys.exit("say which client: --client <name or MAC>, or --list to see who is on")
    if DRY:
        get(tok, ENDPOINTS["clients"], {"limit": 200}); get(tok, ENDPOINTS["client"].format(mac="<mac>")); get(tok, ENDPOINTS["ap"].format(serial="<serial>"))
        print("dry run only")
        return
    mac, rows = find_client(tok, args.client, args.group)
    if not mac:
        print(f"no client matching {args.client!r} among {len(rows or [])} on the air; try --list")
        sys.exit(1)
    if args.serve:
        serve(args.serve, max(10, args.every), tok, mac, args.trail)
        return
    r = reading(tok, mac, args.trail)
    if not r:
        sys.exit("no reading for that client")
    out = args.out or "reading.json"
    with open(out, "w") as f:
        json.dump(r, f, indent=1)
    print(f"wrote {out}: {r['client'].get('name') or mac} at {r['link'].get('rssi_dbm')} dBm, SNR {r['link'].get('snr_db')} dB, {r['link'].get('speed_mbps')} of {r['link'].get('max_mbps')} Mb/s on {r['ap'].get('name')}"
          + (f"; {len(r['trail'])} hops over {args.trail:g} h across {len(r['aps'])} APs" if args.trail else ""))


if __name__ == "__main__":
    main()
