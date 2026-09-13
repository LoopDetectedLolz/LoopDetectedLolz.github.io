#!/usr/bin/env python3
"""The QA bot. Uses the lab tools the way a stranger would, and recomputes every
number it reads with formulas of its own, in Python, from the standards.

    python3 qa.py                 # everything: build both lab pages, serve them, drive them, report
    python3 qa.py --only mesh     # one tool: capacity | venue | mesh | story | games | qam
    python3 qa.py --headed        # watch it
    python3 qa.py --keep          # leave the server up afterwards for a look

Needs playwright. If the sandboxed session installed it under .qa/pylib, run
    PYTHONPATH=.qa/pylib python3 qa.py
otherwise  python3 -m pip install --user playwright && playwright install chromium

Two kinds of check, both counted:
  math   a number on screen or in the model against an independent recomputation
         (free space, noise floor, PHY rates, Fresnel, MOS, the plan's own sums)
  use    what a visitor does: switch tools, click, drag, fail an AP, import every
         fixture, export and re-import, reload from the link, phone width, and
         read every sentence for anything that would make them stop trusting it
Exit code 1 when anything fails. A failure prints what was seen and what was expected.
"""
import argparse, glob, http.server, json, math, os, re, shutil, socket, sys, threading, time

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("playwright missing: PYTHONPATH=.qa/pylib python3 qa.py, or python3 -m pip install --user playwright && playwright install chromium")

# ── independent physics, from the standards, no reuse of theme/sim ──────────
C_LIGHT = 299792458.0
def fspl_db(d_m, f_ghz): return 20 * math.log10(max(d_m, 1e-9)) + 20 * math.log10(f_ghz * 1e9) - 147.55
def noise_dbm(bw_mhz, nf_db): return -174 + 10 * math.log10(bw_mhz * 1e6) + nf_db
def fresnel1_m(d1, d2, f_ghz): return math.sqrt((C_LIGHT / (f_ghz * 1e9)) * d1 * d2 / (d1 + d2))
NSD = {"a": {20: 48}, "n": {20: 52, 40: 108}, "ac": {20: 52, 40: 108, 80: 234, 160: 468},
       "ax": {20: 234, 40: 468, 80: 980, 160: 1960}, "be": {20: 234, 40: 468, 80: 980, 160: 1960, 320: 3920}}
TSYM = {"a": 4.0, "n": 4.0, "ac": 4.0, "ax": 13.6, "be": 13.6}
MCS = [(1, .5), (2, .5), (2, .75), (4, .5), (4, .75), (6, 2 / 3), (6, .75), (6, 5 / 6), (8, .75), (8, 5 / 6), (10, .75), (10, 5 / 6), (12, .75), (12, 5 / 6)]
def phy_mbps(std, mcs, ss, bw):
    if std == "a": return None
    b, r = MCS[mcs]; return ss * NSD[std][bw] * b * r / TSYM[std]
def mos_g107(loss_frac, delay_ms=0):
    ie = 10 + (95 - 10) * loss_frac / (loss_frac + 0.20)
    idd = 0 if delay_ms < 177.3 else 0.024 * delay_ms + 0.11 * (delay_ms - 177.3)
    R = 93.2 - ie - idd
    return 1 if R < 0 else 4.5 if R > 100 else 1 + 0.035 * R + R * (R - 60) * (100 - R) * 7e-6
# U-NII-1 through U-NII-3 plus U-NII-4, which the FCC opened in 2020 (169, 173 and 177 at
# 20 MHz, so 167 and 175 at 40 and 171 at 80); the channel 173 post is the site's own
# statement of that, and the tool's list has to agree with it
US_5 = {20: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165, 169, 173, 177],
        40: [38, 46, 54, 62, 102, 110, 118, 126, 134, 142, 151, 159, 167, 175], 80: [42, 58, 106, 122, 138, 155, 171], 160: [50, 114]}
US_5_NODFS = {20: [36, 40, 44, 48, 149, 153, 157, 161, 165, 169, 173, 177], 40: [38, 46, 151, 159, 167, 175], 80: [42, 155, 171], 160: []}
def us_channels_5(bw, dfs): return (US_5 if dfs else US_5_NODFS)[bw]

# ── the report ───────────────────────────────────────────────────────────────
RES = []
def check(kind, name, ok, seen=None, want=None):
    RES.append((kind, name, bool(ok), seen, want))
    if not ok: print(f"  FAIL [{kind}] {name}: saw {seen!r}, wanted {want!r}")
def near(kind, name, a, b, tol): check(kind, name, a is not None and b is not None and abs(a - b) <= tol, a, b)
def section(t): print(f"\n{t}")
BAD_TEXT = re.compile(r"undefined|NaN|\[object|Infinity|null\b|\{\{|\}\}")
DASHES = re.compile("[\u2014\u2013]")

# ── serve the lab pages ourselves ────────────────────────────────────────────
def build_pages():
    import lab
    out = {}
    for w in ("tools", "games", "qam"):
        lab.WIDGET = w
        lab.build()
        # the pages sit beside lab.html because they reference theme/ and demo/ relatively
        dst = os.path.join(ROOT, "lab-qa-" + w + ".html")
        shutil.copyfile(os.path.join(ROOT, "lab.html"), dst); out[w] = "/lab-qa-" + w + ".html"
    return out

def serve():
    # lab's own handler, because the lab page polls /__lab_mtime for its reload and a
    # plain file server answers that with a 404 every 700 ms, which the bot then reads
    # as a page error
    import lab
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), lab.H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{port}"

def page_errors(pg):
    errs = []
    def on_console(m):
        # a 404's console text never names the resource; the location does
        where = (m.location or {}).get("url", "") if hasattr(m, "location") else ""
        if m.type == "error" and "fonts.g" not in m.text and "ERR_FAILED" not in m.text and "favicon" not in m.text + where:
            errs.append(m.text + (" (" + where.rsplit("/", 1)[-1] + ")" if where else ""))
    pg.on("console", on_console)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    return errs

def open_lab(b, url, width=1280, hash_=""):
    pg = b.new_page(viewport={"width": width, "height": 900})
    pg.route("**/fonts.googleapis.com/**", lambda r: r.abort()); pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    errs = page_errors(pg)
    pg.goto(url + hash_, wait_until="load"); pg.wait_for_timeout(700)
    return pg, errs

def text_hygiene(pg, scope, label):
    txt = pg.evaluate(f"(()=>{{const e=document.querySelector({scope!r});return e?e.innerText:''}})()")
    m = BAD_TEXT.search(txt)
    check("use", f"{label}: no leaked programmer text", not m, m.group(0) + " near: " + txt[max(0, m.start() - 40):m.start() + 40].replace("\n", " ") if m else None, "clean")
    d = DASHES.search(txt)
    check("use", f"{label}: no em or en dashes", not d, txt[max(0, d.start() - 30):d.start() + 30].replace("\n", " ") if d else None, "none")

def open_all_details(pg, scope):
    pg.evaluate(f"document.querySelectorAll({scope!r} + ' details').forEach(d=>d.open=true)")
    pg.wait_for_timeout(300)

def tap_targets(pg, scope, label):
    # offsetHeight is the layout box; getBoundingClientRect would include the 120 ms
    # press animation (scale 0.97) on a pill the bot clicked a moment ago
    small = pg.evaluate(f"""[...document.quererySelectorAll({scope!r}+' button, '+{scope!r}+' select, '+{scope!r}+' summary')].filter(e=>e.offsetHeight>0&&e.offsetWidth>0&&e.offsetHeight<38).map(e=>(e.id||e.textContent.trim().slice(0,20))+' '+e.offsetHeight+'px')""".replace("quererySelectorAll", "querySelectorAll"))
    check("use", f"{label}: every control at least 38 px tall", len(small) == 0, small[:6], [])

# ── the mesh planner ────────────────────────────────────────────────────────
def qa_mesh(b, base, page_url):
    section("Mesh on a field")
    pg, errs = open_lab(b, base + page_url, hash_="#mesh/v1")
    root = "#tool-mesh"
    check("use", "the link opened the mesh tool", pg.evaluate("!document.getElementById('tool-mesh').hidden"), None, True)
    p = pg.evaluate("document.getElementById('tools')._mesh()")
    cfg, aps = p["cfg"], p["aps"]
    # the plan's own arithmetic
    near("math", "ceiling is the least of demand, mesh and uplink", p["ceiling"], min(p["demand"], p["meshMbps"], p["uplink"]), 1e-6)
    check("math", "the binding ceiling is named", p["binds"] in ("demand", "mesh", "uplink"), p["binds"], "demand|mesh|uplink")
    big = pg.inner_text("#m-big").strip()
    want = (f"{p['ceiling']/1000:.1f} Gb/s" if p["ceiling"] >= 1000 else f"{p['ceiling']:.0f} Mb/s" if p["ceiling"] >= 10 else f"{p['ceiling']:.1f} Mb/s" if p["ceiling"] >= 1 else f"{round(p['ceiling']*1000)} kb/s")
    check("math", "the big number is the ceiling", big == want, big, want)
    # every link against the standards
    T = p["tree"]; nf = noise_dbm(cfg["bw"], cfg["nf"]); n = len(aps); checked = 0
    for i in range(n):
        for j in range(i + 1, n):
            L = T["links"][i][j]
            if not L or not L.get("ok"): continue
            checked += 1
            model = L["tx"] + L["ga"] + L["gb"] - fspl_db(L["d3"], L["band"]) - L["diffraction"] - L["wallDb"] + L["tworay"]
            if not L["measured"]:
                near("math", f"link {i+1}-{j+1}: budget = tx + gains - free space - diffraction - walls + bounce - fade", L["prx"], model + L["calib"] - cfg["fade"], 0.05)
            near("math", f"link {i+1}-{j+1}: SNR = received - noise floor for {L['bw']} MHz", L["snr"], L["prx"] - noise_dbm(L["bw"], cfg["nf"]), 0.05)
            if L["mcs"] >= 0 and L["std"] != "a":
                near("math", f"link {i+1}-{j+1}: PHY rate matches 802.11{L['std']} MCS {L['mcs']} {L['ss']}x{L['bw']}", L["phyMbps"], phy_mbps(L["std"], L["mcs"], L["ss"], L["bw"]), 0.6)
            check("math", f"link {i+1}-{j+1}: goodput under the PHY rate", 0 < L["goodput"] < L["phyMbps"], L["goodput"], f"< {L['phyMbps']:.0f}")
            near("math", f"link {i+1}-{j+1}: first Fresnel zone at mid path", L["f1"], fresnel1_m(L["d"] / 2, L["d"] / 2, L["band"]), 0.02)
    check("use", "at least one usable link to check", checked > 0, checked, "> 0")
    # the tree is a tree
    for i in range(n):
        d, k, hops = T["depth"][i], i, 0
        while T["parent"][k] >= 0 and hops <= n: k = T["parent"][k]; hops += 1
        if d >= 0: check("math", f"AP {i+1}: depth {d} is its hop count to a portal", hops == d and T["depth"][k] == 0, hops, d)
        check("math", f"AP {i+1}: inside the hop ceiling", d <= T["maxHops"], d, f"<= {T['maxHops']}")
    # channels are legal
    chs = [r["channel"] for r in aps if r["channel"] is not None and r["depth"] == 0]
    if cfg["fGHz"] < 5.9 and cfg["fGHz"] > 3 and cfg["domain"] == "us":
        legal = us_channels_5(cfg["bw"], p["dfs"])
        for c in chs: check("math", f"portal channel {c} is a US {cfg['bw']} MHz channel{'' if p['dfs'] else ' outside DFS'}", c in legal, c, legal)
    # the table and the flags say what the plan says
    rows = pg.locator("#m-rows tr").count()
    check("use", "one table row per AP", rows == n, rows, n)
    flags = pg.inner_text("#m-flags")
    if p["spof"]: check("use", "single points of failure are flagged", "no second parent" in flags, flags[:120], "mentions no second parent")
    if p["unreachable"]: check("use", "unreachable APs are flagged", "no usable link" in flags, flags[:120], "mentions no usable link")
    check("use", "no page errors after load", not errs, errs[:3], [])
    # use it: add an AP by clicking the map, fail it, remove it
    pg.select_option("#m-add", "ap"); box = pg.locator("#m-map").bounding_box()
    pg.mouse.click(box["x"] + box["width"] * 0.15, box["y"] + box["height"] * 0.85); pg.wait_for_timeout(600)
    n2 = len(pg.evaluate("document.getElementById('tools')._meshState.get('ap')"))
    check("use", "a tap in add mode places an AP", n2 == n + 1, n2, n + 1)
    check("use", "the new AP is selected and its panel shows", pg.evaluate("!document.getElementById('m-selap').hidden"), None, True)
    pg.click("#m-fail"); pg.wait_for_timeout(500)
    p2 = pg.evaluate("document.getElementById('tools')._mesh()")
    check("use", "Fail marks it down and the flag says so", p2["down"] >= 1 and "down" in pg.inner_text("#m-flags"), p2["down"], ">= 1")
    pg.click("#m-rmap"); pg.wait_for_timeout(400)
    check("use", "Remove takes it away", len(pg.evaluate("document.getElementById('tools')._meshState.get('ap')")) == n, None, n)
    # drag the first AP and see it move
    pg.select_option("#m-add", "move")
    a0 = pg.evaluate("document.getElementById('tools')._meshState.get('ap')[0]")
    node = pg.locator("#m-map g[data-kind='ap'][data-i='0']")
    # raw mouse events do not scroll, and bounding_box is viewport relative, so a node
    # below the fold gets a drag that lands on nothing
    if node.count(): node.scroll_into_view_if_needed(); pg.wait_for_timeout(200)
    nb = node.bounding_box() if node.count() else None
    if nb:
        cx, cy = nb["x"] + nb["width"] / 2, nb["y"] + nb["height"] / 2
        pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 60, cy + 30, steps=8); pg.mouse.up(); pg.wait_for_timeout(500)
        a1 = pg.evaluate("document.getElementById('tools')._meshState.get('ap')[0]")
        check("use", "dragging an AP moves it", abs(a1["x"] - a0["x"]) + abs(a1["y"] - a0["y"]) > 1, (round(a1["x"]), round(a1["y"])), f"away from ({round(a0['x'])}, {round(a0['y'])})")
    else:
        check("use", "an AP node is drawn to drag", False, None, "g[data-kind=ap]")
    # the link is the argument: reload from the hash and get the same plan
    h = pg.evaluate("location.hash"); c1 = pg.evaluate("document.getElementById('tools')._mesh().ceiling")
    pg.goto(base + page_url + h, wait_until="load"); pg.wait_for_timeout(700)
    near("use", "reloading the link gives the same ceiling", pg.evaluate("document.getElementById('tools')._mesh().ceiling"), c1, 1e-6)
    # every fixture opens
    open_all_details(pg, root)
    for inp, fx, note in (("#m-central", "demo/mesh-central.json", "#m-centralnote"), ("#m-central", "demo/mesh-mist.json", "#m-centralnote"), ("#m-esx", "demo/mesh-test.esx", "#m-esxnote"), ("#m-kml", "demo/mesh-test.kml", "#m-kmlnote")):
        pg.set_input_files(inp, os.path.join(ROOT, fx)); pg.wait_for_timeout(1200)
        t = pg.inner_text(note)
        check("use", f"{fx} opens", t and "Could not" not in t and "Nothing" not in t, t[:90], "a note that is not an error")
    pg.set_input_files("#m-central", os.path.join(ROOT, "demo/mesh-central.json")); pg.wait_for_timeout(1200)
    p3 = pg.evaluate("document.getElementById('tools')._mesh()"); ms = pg.evaluate("document.getElementById('tools')._meshState.get('ms')")
    for key, v in ms.items():
        if isinstance(v, dict):
            i, j = map(int, key.split("-")); L = p3["tree"]["links"][i][j]
            if L: near("math", f"measured loss {key}: received = tx + own gain - loss - fade (AirMatch's loss already has the far antenna in it)", L["prx"], L["tx"] + L["ga"] - v["pl"] - p3["cfg"]["fade"], 0.05)
    vrows = pg.locator("#m-verify tr").count()
    check("use", "planned against measured lists every measured pair", vrows == len(ms), vrows, len(ms))
    for r in pg.locator("#m-verify tr").all():
        cells = [c.strip() for c in r.inner_text().split("\t")]
        nums = [float(re.sub(r"[^0-9.+-]", "", c)) for c in cells[3:6]]
        near("math", f"verify row {cells[0][:30]}: gap = measured - planned", nums[2], nums[1] - nums[0], 1.01)
    # the roams from the story, on the map, once both tools hold the same site
    pg.evaluate("localStorage.setItem('nfn-story', JSON.stringify(" + json.dumps(json.load(open(os.path.join(ROOT, "demo/mesh-story.json")))) + "))")
    pg.set_input_files("#m-central", os.path.join(ROOT, "demo/mesh-story.json")); pg.wait_for_timeout(1200)
    pg.check("#m-roams"); pg.wait_for_timeout(800)
    arcs = pg.evaluate("document.querySelectorAll('#m-map path[marker-end]').length")
    check("use", "roams from the story draw as arrows between the named APs", arcs > 0, arcs, "> 0")
    check("use", "the roams toggle is in the link", "rm=1" in pg.evaluate("location.hash"), None, "rm=1")
    pg.uncheck("#m-roams"); pg.wait_for_timeout(300)
    pg.set_input_files("#m-central", os.path.join(ROOT, "demo/mesh-central.json")); pg.wait_for_timeout(1200)
    p3 = pg.evaluate("document.getElementById('tools')._mesh()")
    # export and configuration
    with pg.expect_download() as dl: pg.click("#m-json")
    j = json.load(open(dl.value.path()))
    check("use", "the JSON export carries every AP", len((j.get("site") or j).get("aps", [])) == len(p3["aps"]), len((j.get("site") or j).get("aps", [])), len(p3["aps"]))
    with pg.expect_download() as dl: pg.click("#m-central-dl")
    cen = json.load(open(dl.value.path()))
    check("math", "Central config: ARM, radio profile, one ap_settings per AP", len(cen["calls"]) == 2 + len(p3["aps"]), len(cen["calls"]), 2 + len(p3["aps"]))
    check("use", "Central config: no placeholder left unmarked", all("<" in c["path"] or "/ap_settings/" in c["path"] for c in cen["calls"]), None, "every path has a <placeholder>")
    with pg.expect_download() as dl: pg.click("#m-mist-dl")
    mist = json.load(open(dl.value.path()))
    check("math", "Mist config: template, site, mesh, one device per AP", len(mist["calls"]) == 3 + len(p3["aps"]), len(mist["calls"]), 3 + len(p3["aps"]))
    intent = pg.inner_text("#m-intent")
    check("use", "the intent names the band, width and every AP", "GHz" in intent and intent.count("\n") >= 4 + len(p3["aps"]), intent.count("\n"), f">= {4 + len(p3['aps'])}")
    # the story of the tree, read from the tree
    story = pg.evaluate("document.getElementById('tools')._narrate()")
    kinds = [q["kind"] for q in story["steps"]]
    check("use", "the mesh story has a rule, portals, a step per point and a ceiling", kinds[0] == "rule" and kinds[-1] == "ceiling" and len([k for k in kinds if k.startswith("hop") or k in ("orphan", "down")]) == len([r for r in p3["aps"] if not r["gw"]]), kinds, "rule, portal, hop..., ceiling")
    check("use", "and it is on the page", pg.locator("#m-story li").count() == len(story["steps"]), pg.locator("#m-story li").count(), len(story["steps"]))
    # 3D, then back
    pg.click("#tool-mesh .m-view[data-view='3d']"); pg.wait_for_timeout(800)
    check("use", "3D view draws the field", pg.evaluate("document.querySelectorAll('#m-map *').length") > 20, pg.evaluate("document.querySelectorAll('#m-map *').length"), "> 20 elements")
    check("use", "3D is in the link", "view=3d" in pg.evaluate("location.hash"), None, "view=3d")
    pg.click("#tool-mesh .m-view[data-view='plan']"); pg.wait_for_timeout(400)
    text_hygiene(pg, root, "mesh"); tap_targets(pg, root, "mesh")
    check("use", "no page errors after using it", not errs, errs[:3], [])
    pg.close()
    # a phone
    pg, errs = open_lab(b, base + page_url, width=390, hash_="#mesh/v1")
    check("use", "phone: no sideways scroll", pg.evaluate("document.documentElement.scrollWidth") <= 390, pg.evaluate("document.documentElement.scrollWidth"), "<= 390")
    check("use", "phone: the big number is on screen without scrolling far", pg.locator("#m-big").bounding_box()["y"] < 2600, None, "< 2600 px")
    pg.close()

# ── the capacity planner ────────────────────────────────────────────────────
def qa_capacity(b, base, page_url):
    section("How many access points")
    pg, errs = open_lab(b, base + page_url, hash_="#capacity/v1")
    p = pg.evaluate("document.getElementById('tools')._plan()")
    check("math", "APs is a whole number of at least 1", isinstance(p["aps"], int) or p["aps"] == int(p["aps"]) and p["aps"] >= 1, p["aps"], ">= 1, integer")
    check("math", "APs is the larger of the airtime and client counts (when it fits)", (not p["fits"]) or p["aps"] == max(p["apsByAirtime"], p["apsByClients"]), p["aps"], max(p["apsByAirtime"], p["apsByClients"]))
    check("math", "the binding ceiling is named", p["binds"] in ("airtime", "clients", "channels", "both"), p["binds"], "airtime|clients|channels|both")
    near("math", "total airtime = clients + beacons", p["totalAirtime"], p["clientAirtime"] + p["beaconAirtime"], 1e-6)
    check("math", "occupancy per AP sits under the target when it fits", (not p["fits"]) or p["perAp"] <= p["target"] + 1e-6, p["perAp"], f"<= {p['target']}")
    shown = pg.inner_text("#t-aps").strip()
    check("use", "the headline AP count matches the plan", str(p["aps"]) in shown, shown, str(p["aps"]))
    # more clients, never fewer APs
    pg.evaluate("(()=>{const t=document.getElementById('t-target');t.value=String(Math.max(+t.min,+t.value-20));t.dispatchEvent(new Event('input',{bubbles:true}));t.dispatchEvent(new Event('change',{bubbles:true}))})()"); pg.wait_for_timeout(500)
    p2 = pg.evaluate("document.getElementById('tools')._plan()")
    check("math", "a lower airtime target never needs fewer APs", p2["aps"] >= p["aps"], p2["aps"], f">= {p['aps']}")
    open_all_details(pg, "#tool-capacity"); text_hygiene(pg, "#tool-capacity", "capacity"); tap_targets(pg, "#tool-capacity", "capacity")
    check("use", "no page errors", not errs, errs[:3], [])
    pg.close()

# ── the seating block tool ─────────────────────────────────────────────────
def qa_venue(b, base, page_url):
    section("Aiming at a seating block")
    pg, errs = open_lab(b, base + page_url, hash_="#venue/v1")
    v = pg.evaluate("document.getElementById('tools')._venue()")
    fp = v["fp"]; rows = fp["rows"]; st = pg.evaluate("(()=>{const s=document.getElementById('tools');return {h:+document.getElementById('v-h').value,d:+document.getElementById('v-d').value}})()")
    r0, rl = rows[0], rows[-1]
    near("math", "first row depression = atan(height / run)", r0["depression"], math.degrees(math.atan2(st["h"] - r0["rise"], r0["x"])), 0.05)
    near("math", "first row slant = hypot(run, height)", r0["slant"], math.hypot(r0["x"], st["h"] - r0["rise"]), 0.01)
    check("math", "the back row is lower in angle than the front", rl["depression"] < r0["depression"], rl["depression"], f"< {r0['depression']}")
    check("math", "the tilt sits between the first and last row angles", min(r0["depression"], rl["depression"]) - 0.01 <= fp["tilt"] <= max(r0["depression"], rl["depression"]) + 0.01, fp["tilt"], (rl["depression"], r0["depression"]))
    check("math", "the antenna covers a contiguous run of rows", 0 <= fp["firstRow"] <= fp["lastRow"] < len(rows), (fp["firstRow"], fp["lastRow"]), f"within 0..{len(rows)-1}")
    check("math", "front signal is stronger than back", v["near"]["rssi"] > v["far"]["rssi"], (v["near"]["rssi"], v["far"]["rssi"]), "near > far")
    near("math", "SNR = RSSI - noise at the back", v["far"]["snr"], v["far"]["rssi"] - v["far"]["noise"], 0.01)
    check("use", "the verdict is a word the page styles by", v["verdict"] in ("good", "wide", "narrow", "tight", "misses"), v["verdict"], "one of the verdict keys")
    check("use", "and the reason is a sentence", isinstance(v.get("why"), str) and len(v["why"]) > 10, str(v.get("why"))[:60], "text")
    open_all_details(pg, "#tool-venue"); text_hygiene(pg, "#tool-venue", "venue"); tap_targets(pg, "#tool-venue", "venue")
    check("use", "no page errors", not errs, errs[:3], [])
    pg.close()

# ── the simulator ──────────────────────────────────────────────────────────
def qa_qam(b, base, page_url):
    section("The simulator")
    pg, errs = open_lab(b, base + page_url)
    pg.wait_for_timeout(1500)
    d = pg.evaluate("document.getElementById('qam')._dbg()")
    lb = d["lb"]
    # the link budget: free space at 1 m is 46.76 dB at 5.2 GHz, the noise floor is thermal + 7 dB
    near("math", "free space at 1 m and 5.2 GHz is 46.76 dB", fspl_db(1, 5.2), 46.76, 0.02)
    bw = pg.evaluate("+document.getElementById('qam-bw').value")
    near("math", f"noise floor for {bw} MHz with a 7 dB figure", lb["nf"], noise_dbm(bw, 7), 0.05)
    near("math", "SNR = received - noise floor", lb["snr"], lb["prx"] - lb["nf"], 0.01)
    # the rates table against the standard
    pg.click("#qam-table-t"); pg.wait_for_timeout(400)
    std = pg.evaluate("document.getElementById('qam-std').value"); ss = pg.evaluate("+document.getElementById('qam-ss').value")
    rows = pg.locator("#qam-table tr[data-m]").all()
    check("use", "the rates table has a row per MCS", len(rows) >= 8, len(rows), ">= 8")
    for r in rows[:14]:
        cells = [c.strip() for c in r.inner_text().split("\t")]
        m = int(cells[0]); shown = float(cells[4])
        want = phy_mbps(std, m, ss, bw)
        if want: near("math", f"802.11{std} MCS {m} {ss}x{bw} MHz is {want:.1f} Mb/s in the table", shown, want, 0.06)
    pg.click("#qam-table-t")
    # the well known figure
    near("math", "2 streams of MCS 11 on 160 MHz 802.11ax is 2402 Mb/s", phy_mbps("ax", 11, 2, 160), 2402, 1)
    # frames actually complete and the CRC decides
    pg.wait_for_timeout(6000); d2 = pg.evaluate("document.getElementById('qam')._dbg()")
    check("use", "frames complete while nobody touches anything", d2["frames"] >= 1, d2["frames"], ">= 1")
    check("use", "a clean link needs no retries", d2["retries"] == 0, d2["retries"], 0)
    # the voice flow and its MOS
    pg.select_option("#qam-traffic", "voice"); pg.wait_for_timeout(9000)
    app = pg.inner_text("#qam-app")
    mm = re.search(r"MOS\s*([0-9.]+)", app)
    if mm:
        mos = float(mm.group(1)); clean = mos_g107(0)
        check("math", f"a clean call's MOS is the E-model ceiling for Ie 10 ({clean:.2f})", abs(mos - clean) <= 0.15 or mos >= 4.0, mos, f"about {clean:.2f}")
    # live feed: a reading parks the sliders and sets the PHY from the top rate
    out = pg.evaluate("""document.getElementById('qam')._mon({source:'qa',ts:Date.now()/1000,client:{name:'QA phone'},ap:{name:'QA-AP',model:'AP-735'},radio:{band:'5',channel:149,bw:80,noise_dbm:-93,util_pct:5},link:{rssi_dbm:-60,snr_db:33,speed_mbps:1201,max_mbps:1201,retry_pct:0}})""")
    check("math", "1201 Mb/s tops out as 802.11ax, 2 streams, 80 MHz", (out["std"], out["ss"], out["bw"]) == ("ax", 2, 80), (out["std"], out["ss"], out["bw"]), ("ax", 2, 80))
    check("math", "at the top rate the MCS is 11", out["mcs"] == 11, out["mcs"], 11)
    check("use", "the distance slider is parked while a feed drives", pg.evaluate("document.getElementById('qam-dist').disabled"), None, True)
    pg.wait_for_timeout(1500)
    near("math", "the feed's SNR reaches the budget", pg.evaluate("document.getElementById('qam')._dbg().lb.snr"), 33, 0.6)
    # the journey: three hops, scrubbed, each hop's SNR against its own AP's floor
    trail = [{"ts": 1700000000, "ap": "A", "serial": "S1", "prev": None, "type": None, "latency_ms": None, "band": "5", "channel": 36, "bw": 80, "rssi_dbm": None, "join": True},
             {"ts": 1700000600, "ap": "B", "serial": "S2", "prev": "A", "type": "802.11", "latency_ms": 25, "band": "5", "channel": 149, "bw": 80, "rssi_dbm": -64, "join": False},
             {"ts": 1700001200, "ap": "B", "serial": "S2", "prev": "B", "type": "802.11", "latency_ms": 640, "band": "2.4", "channel": 6, "bw": 20, "rssi_dbm": -79, "join": False}]
    aps = {"S1": {"name": "A", "model": "AP-635", "radios": {"5": {"noise_dbm": -92}}}, "S2": {"name": "B", "model": "AP-735", "radios": {"5": {"noise_dbm": -90}, "2.4": {"noise_dbm": -96}}}}
    out = pg.evaluate("document.getElementById('qam')._mon(" + json.dumps({"source": "qa", "ts": 1700001200, "client": {"name": "QA phone"}, "ap": {"name": "B", "serial": "S2"}, "radio": {"band": "2.4", "channel": 6, "bw": 20, "noise_dbm": -96}, "link": {"rssi_dbm": -79, "snr_db": 17, "speed_mbps": 43, "max_mbps": 287}, "trail": trail, "aps": aps}) + ")")
    check("use", "a reading with a trail shows the journey", out["hops"] == 3 and not pg.evaluate("document.getElementById('qam-journey').hidden"), out["hops"], 3)
    j = pg.evaluate("document.getElementById('qam')._journey(1)")
    near("math", "hop 1: SNR = -64 dBm against AP B's -90 floor", j["snr"], 26, 0.01)
    check("math", "hop 1: width follows the hop's channel (80 MHz)", j["bw"] == 80, j["bw"], 80)
    j2 = pg.evaluate("document.getElementById('qam')._journey(2)")
    near("math", "hop 2: SNR = -79 against the 2.4 GHz floor of -96", j2["snr"], 17, 0.01)
    check("use", "hop 2: a 640 ms roam is called out", "640 ms" in j2["cap"], j2["cap"][-80:], "640 ms")
    pg.evaluate("document.getElementById('qam')._mon(" + json.dumps({"source": "qa", "ts": 1700001200, "client": {"name": "QA phone"}, "ap": {"name": "B", "serial": "S2"}, "radio": {"band": "2.4", "channel": 6, "bw": 20, "noise_dbm": -96}, "link": {"rssi_dbm": -79, "snr_db": 17, "speed_mbps": 43, "max_mbps": 287}, "trail": trail, "aps": aps, "marks": [{"ts": 1700001170, "note": "kitchen"}]}) + ")")
    check("use", "a mark from the wrist is a flag on the strip", pg.evaluate("document.querySelectorAll('#qam-jsvg path[fill=\"#F5A524\"]').length") == 1, None, 1)
    check("use", "the hop nearest a mark names it", "kitchen" in pg.evaluate("document.getElementById('qam')._journey(2)")["cap"], None, "kitchen in the caption")
    stats = pg.inner_text("#qam-jstats")
    check("use", "the journey stats count the join, the band flip and the slow roam", "1 fresh join" in stats and "1 band flip" in stats and "1 slower than half a second" in stats, stats[:160], "1 fresh join, 1 band flip, 1 slower")
    pg.evaluate("document.getElementById('qam')._mon(null)")
    check("use", "back to the sliders frees them", not pg.evaluate("document.getElementById('qam-dist').disabled"), None, True)
    check("use", "and hides the journey", pg.evaluate("document.getElementById('qam-journey').hidden"), None, True)
    text_hygiene(pg, "#qam", "simulator"); tap_targets(pg, "#qam", "simulator")
    check("use", "no page errors", not errs, errs[:3], [])
    pg.close()

# ── what happened ───────────────────────────────────────────────────────────
def qa_story(b, base, page_url):
    section("What happened")
    pg, errs = open_lab(b, base + page_url, hash_="#story/v1")
    check("use", "the link opened the story tool", pg.evaluate("!document.getElementById('tool-story').hidden"), None, True)
    pg.click("#s-demo"); pg.wait_for_timeout(1500)
    s = pg.evaluate("document.getElementById('tool-story')._story()")
    fx = json.load(open(os.path.join(ROOT, "demo/mesh-story.json")))
    check("math", "every hop in the file is counted", s["hops"] == sum(len(t["hops"]) for t in fx["story"]["trails"]), s["hops"], sum(len(t["hops"]) for t in fx["story"]["trails"]))
    check("math", "two spikes: the channel move and the reboot", s["spikes"] == 2, s["spikes"], 2)
    stats = pg.inner_text("#s-stats")
    check("use", "the stats tiles show clients, hops, spikes, weak landings, events", all(w in stats.lower() for w in ("clients", "hops", "spikes", "weak", "events")), stats.replace("\n", " ")[:80], "five tiles")
    sp = pg.inner_text("#s-spikes")
    check("use", "each spike is pinned on its cause", "channel move" in sp and "came up" in sp, sp[:160], "mentions a channel move and a reboot")
    bars = pg.locator("#s-time rect[data-bin]").count()
    check("use", "the timeline has a bar per busy bin", bars > 10, bars, "> 10")
    pg.locator("#s-time rect[data-bin]").first.click(); pg.wait_for_timeout(300)
    check("use", "tapping a bar names who moved", len(pg.inner_text("#s-binout")) > 20, pg.inner_text("#s-binout")[:80], "a sentence")
    g = s["graph"]
    check("math", "one node per live radio", len(g["nodes"]) == sum(1 for a in fx["aps"] for r in a["radios"] if r.get("status") != "Down"), len(g["nodes"]), "live radios")
    check("math", "the demo's 5 GHz radios share 149: two co-channel pairs", g["cochannel"] == 2, g["cochannel"], 2)
    check("math", "edge loss is the mean of both directions", all(abs(e["loss"] - sum(e["losses"]) / len(e["losses"])) < 1e-9 for e in g["edges"]), None, "means")
    # what-if: move the middle 5 GHz radio away, pairs fall to zero
    pg.select_option("#s-wradio", fx["aps"][1]["serial"] + "/5"); pg.wait_for_timeout(200)
    opts = pg.evaluate("[...document.getElementById('s-wch').options].map(o=>o.value)")
    other = [o for o in opts if o not in ("149",)][0]
    pg.select_option("#s-wch", other); pg.wait_for_timeout(300)
    wout = pg.inner_text("#s-wout")
    check("use", "the what-if says how the pairs change", "2 co-channel pairs becomes 0" in wout, wout[:120], "2 becomes 0")
    check("use", "the what-if is in the link", "radio=" in pg.evaluate("location.hash") and "ch=" in pg.evaluate("location.hash"), pg.evaluate("location.hash")[:60], "radio= and ch=")
    check("use", "six weather blocks, one per radio", pg.locator("#s-weather svg").count() == 6, pg.locator("#s-weather svg").count(), 6)
    check("use", "the microwave hour is outlined", pg.evaluate("document.querySelectorAll('#s-weather rect[stroke=\"#F5A524\"]').length") == 1, pg.evaluate("document.querySelectorAll('#s-weather rect[stroke=\"#F5A524\"]').length"), 1)
    rows = pg.locator("#s-actual tr").count()
    check("use", "one actual row per AP", rows == len(fx["aps"]), rows, len(fx["aps"]))
    for r in pg.locator("#s-actual tr").all():
        cells = [c.strip() for c in r.inner_text().split("\t")]
        def val(t):
            m = re.match(r"([0-9.]+) (kb/s|Mb/s|Gb/s)", t); return float(m.group(1)) * {"kb/s": 1e-3, "Mb/s": 1, "Gb/s": 1e3}[m.group(2)] if m else None
        mean, peak = val(cells[2]), val(cells[3])
        check("math", f"{cells[0]}: peak at least the mean", mean is not None and peak is not None and peak >= mean * 0.99, (mean, peak), "peak >= mean")
    cable = pg.locator("#s-cable tr").count()
    check("use", "follow the cable: one row per AP", cable == len(fx["aps"]), cable, len(fx["aps"]))
    check("use", "follow the cable: a 100 Mb/s uplink is called slow", "slow port" in pg.inner_text("#s-cable"), None, "slow port")
    check("use", "follow the cable: the switch is not claimed", "not in Classic" in pg.inner_text("#s-cable"), None, "says the switch is not in view")
    top = pg.locator("#s-clients tr").first.inner_text()
    check("use", "the restless watch tops the client list", "Demo-Watch" in top, top[:40], "Demo-Watch")
    open_all_details(pg, "#tool-story"); text_hygiene(pg, "#tool-story", "story"); tap_targets(pg, "#tool-story", "story")
    check("use", "no page errors", not errs, errs[:3], [])
    pg.close()
    pg, errs = open_lab(b, base + page_url, width=390, hash_="#story/v1")
    pg.click("#s-demo"); pg.wait_for_timeout(1200)
    check("use", "phone: no sideways scroll with a story loaded", pg.evaluate("document.documentElement.scrollWidth") <= 390, pg.evaluate("document.documentElement.scrollWidth"), "<= 390")
    pg.close()

# ── the games ──────────────────────────────────────────────────────────────
def qa_games(b, base, page_url):
    section("Academy games")
    pg, errs = open_lab(b, base + page_url, hash_="#games/v1?g=guess&seed=7&i=0")
    check("use", "the page wears the Academy theme", pg.evaluate("document.body.classList.contains('acad')"), None, True)
    lv = pg.evaluate("document.getElementById('games')._games.level()")
    g = lv["guess"]
    near("math", "guess round 1 is 2 m in free space at 5.2 GHz: the truth is the budget", g["rssi"], 20 + 5 + 2 - fspl_db(2, 5.2), 0.05)
    r = pg.evaluate("document.getElementById('games')._games.guess(" + str(round(g["rssi"])) + ")")
    check("math", "a guess within a dB scores 3", r["score"] == 3 and r["streak"] == 1, r, "score 3, streak 1")
    say = pg.inner_text("#gu-say")
    check("use", "the reveal shows the working", "free space" in say and "dBm" in say, say[:100], "the budget spelled out")
    pg.click("#gu-next"); pg.wait_for_timeout(200)
    g2 = pg.evaluate("document.getElementById('games')._games.level().guess")
    near("math", "round 2 is 4 m: 6 dB under round 1", g["rssi"] - g2["rssi"], 6.02, 0.05)
    r2 = pg.evaluate("document.getElementById('games')._games.guess(" + str(round(g2["rssi"]) + 9) + ")")
    check("math", "9 dB off scores nothing and ends the streak", r2["score"] == 3 and r2["streak"] == 0, r2, "score still 3, streak 0")
    # fix the link: the level starts failing; the best path found by the model gets 100
    pg.click(".gm-tile[data-g='fix']"); pg.wait_for_timeout(200)
    f = pg.evaluate("document.getElementById('games')._games.level().fix")
    j0 = pg.evaluate("NFN.games.fix.judge(" + json.dumps(f["start"]) + ")")
    check("math", "fix: the level starts with SNR under what the rate needs", not j0["ok"] and j0["snr"] < j0["need"], (round(j0["snr"]), j0["need"]), "snr < need")
    near("math", "fix: SNR = tx + gain + 2 - log distance(n=3) - walls - noise floor", j0["snr"], 20 + 2 + 2 - (fspl_db(1, 5.2) + 30 * math.log10(f["start"]["d"])) - sum({"drywall": 3, "wood": 5, "cinder": 6, "brick": 12}[w] for w in f["start"]["walls"]) - noise_dbm(f["start"]["bw"], 7), 0.1)
    best = pg.evaluate("NFN.games.fix.best(" + json.dumps(f) + ")")
    for m in best["path"]: pg.evaluate("document.getElementById('games')._games.fix(" + json.dumps(m) + ")")
    sc = pg.evaluate("document.getElementById('games')._games.fixScore()")
    check("math", "fix: the model's best path scores 100", sc["points"] == 100, sc["points"], 100)
    air = pg.inner_text("#fx-air")
    check("use", "fix: the airtime tile shows the microseconds", air.strip() == str(round(sc["airtimeUs"])), air, round(sc["airtimeUs"]))
    check("use", "fix: moves are spent", all(pg.evaluate("[...document.querySelectorAll('#fx-moveset .gm-move')].map(b=>b.disabled)")), None, "all disabled after scoring")
    # the channel puzzle
    pg.click(".gm-tile[data-g='chan']"); pg.wait_for_timeout(200)
    cl = pg.evaluate("document.getElementById('games')._games.level().chan")
    check("math", "chan: the deck is the US 5 GHz list for the width", cl["channels"] == us_channels_5(cl["bw"], cl["dfs"]), cl["channels"], us_channels_5(cl["bw"], cl["dfs"]))
    for e in cl["edges"][:4]:
        check("math", f"chan: {e['a']}~{e['b']} hears iff loss under 95", e["hears"] == (e["loss"] <= 95), (round(e["loss"]), e["hears"]), "consistent")
    same = {n["id"]: cl["channels"][0] for n in cl["nodes"]}
    chk = pg.evaluate("document.getElementById('games')._games.chan(" + json.dumps(same) + ")")
    check("math", "chan: everyone on one channel conflicts on every hearing pair", len(chk["conflicts"]) == sum(1 for e in cl["edges"] if e["hears"]), len(chk["conflicts"]), sum(1 for e in cl["edges"] if e["hears"]))
    check("use", "chan: conflicts are drawn orange", pg.evaluate("document.querySelectorAll('#ch-scene line[stroke=\"#F5A524\"]').length") == len(chk["conflicts"]), None, len(chk["conflicts"]))
    pg.click("#ch-show"); pg.click("#ch-check"); pg.wait_for_timeout(200)
    check("use", "chan: the shown answer scores 100", "100 points" in pg.inner_text("#ch-say"), pg.inner_text("#ch-say")[:80], "100 points")
    check("use", "the game and seeds live in the link", "g=chan" in pg.evaluate("location.hash") and "cseed=" in pg.evaluate("location.hash"), pg.evaluate("location.hash")[:60], "g=chan and cseed=")
    text_hygiene(pg, "#games", "games"); tap_targets(pg, "#games", "games")
    check("use", "no page errors", not errs, errs[:3], [])
    pg.close()
    pg, errs = open_lab(b, base + page_url, width=390)
    check("use", "phone: no sideways scroll", pg.evaluate("document.documentElement.scrollWidth") <= 390, pg.evaluate("document.documentElement.scrollWidth"), "<= 390")
    pg.close()

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", choices=["capacity", "venue", "mesh", "qam", "story", "games"])
    ap.add_argument("--headed", action="store_true"); ap.add_argument("--keep", action="store_true")
    a = ap.parse_args()
    pages = build_pages(); httpd, base = serve()
    print(f"serving {base} (pages built from the lab widgets)")
    t0 = time.time()
    with sync_playwright() as pw:
        exe = None
        for cand in glob.glob(os.path.expanduser("~/Library/Caches/ms-playwright/chromium*/chrome-*/Chromium.app/Contents/MacOS/Chromium")) + glob.glob(os.path.expanduser("~/Library/Caches/ms-playwright/chromium_headless_shell*/*/chrome-headless-shell")):
            exe = cand; break
        try:
            b = pw.chromium.launch(headless=not a.headed)
        except Exception:
            b = pw.chromium.launch(headless=not a.headed, executable_path=exe)
        try:
            if a.only in (None, "mesh"): qa_mesh(b, base, pages["tools"])
            if a.only in (None, "capacity"): qa_capacity(b, base, pages["tools"])
            if a.only in (None, "venue"): qa_venue(b, base, pages["tools"])
            if a.only in (None, "story"): qa_story(b, base, pages["tools"])
            if a.only in (None, "games"): qa_games(b, base, pages["games"])
            if a.only in (None, "qam"): qa_qam(b, base, pages["qam"])
        except Exception as e:
            check("use", "the bot itself ran to the end", False, repr(e)[:300], "no exception")
        b.close()
    fails = [r for r in RES if not r[2]]
    maths = [r for r in RES if r[0] == "math"]; uses = [r for r in RES if r[0] == "use"]
    print(f"\n{'FAIL' if fails else 'ok'}  {len(RES) - len(fails)}/{len(RES)} checks ({len(maths)} math, {len(uses)} use) in {time.time() - t0:.0f} s" + (f", {len(fails)} failed" if fails else ""))
    if a.keep:
        print(f"left {base} up; ctrl-c to stop"); 
        try:
            while True: time.sleep(3600)
        except KeyboardInterrupt: pass
    httpd.shutdown()
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
