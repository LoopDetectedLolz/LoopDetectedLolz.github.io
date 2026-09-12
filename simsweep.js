#!/usr/bin/env node
/* The reliability sweep. simtest.js checks known answers; this checks that the
   model keeps its promises on sites nobody wrote down: hundreds of random
   fields, every profile, domain, band, width, kind and antenna, hills, trees,
   crowds, the clock, fade and measurements. Every plan is held to invariants
   that must be true whatever the numbers are. A failure here is a bug in the
   model, not a matter of taste.
   Run: node simsweep.js [count] [seed] */
var fs = require("fs"), path = require("path");
var dir = path.join(__dirname, "theme", "sim");
["core.js", "rf.js", "phy.js", "mac.js", "channels.js", "capacity.js", "venue.js", "mesh.js"].forEach(function (f) {
  new Function(fs.readFileSync(path.join(dir, f), "utf8")).call(globalThis);
});
var NFN = globalThis.NFN, M = NFN.mesh;
var COUNT = parseInt(process.argv[2], 10) || 400, SEED = parseInt(process.argv[3], 10) || 20260912;
var rnd = NFN.rng(SEED), fails = {}, checks = 0, failed = 0, worst = [];
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function ri(lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); }
function rf(lo, hi) { return lo + rnd() * (hi - lo); }
function fin(x) { return typeof x === "number" && isFinite(x); }
function check(name, ok, detail) {
  checks++;
  if (!ok) { failed++; fails[name] = (fails[name] || 0) + 1; if (worst.length < 12) worst.push(name + (detail !== undefined ? ": " + detail : "")); }
}

function randomSite() {
  var w = ri(6, 120) * 10, d = ri(4, 80) * 10, n = ri(1, 10), aps = [], i, portals = 0;
  for (i = 0; i < n; i++) {
    var gw = i === 0 ? rnd() < 0.9 : rnd() < 0.2; if (gw) portals++;
    aps.push({ x: rf(0, w), y: rf(0, d), h: ri(1, 30) / 2, gw: gw, down: rnd() < 0.08,
               kind: pick(["dual", "dual", "tri", "bridge"]), ant: pick(["auto", "auto", "omni", "dtomni", "pwide", "pnarrow", "dish"]),
               aim: rnd() < 0.7 ? null : rf(-180, 180), tilt: rnd() < 0.8 ? 0 : ri(-10, 45), tx: rnd() < 0.7 ? undefined : ri(0, 30),
               band: rnd() < 0.85 ? null : pick([5.2, 6.0]), bw: rnd() < 0.8 ? null : pick([20, 40, 80, 160]), ch: null,
               cant: rnd() < 0.7 ? undefined : pick(["omni", "pwide", "pnarrow"]), caim: rnd() < 0.8 ? null : rf(-180, 180) });
  }
  var obs = [], k; for (k = 0; k < ri(0, 4); k++) obs.push({ x: rf(0, w), y: rf(0, d), type: pick(["tree", "building", "truck"]), h: rf(2, 20), r: rf(3, 40) });
  var tr = []; for (k = 0; k < ri(0, 3); k++) tr.push({ x: rf(0, w), y: rf(0, d), r: rf(20, 200), h: rf(-6, 20) });
  var cr = []; for (k = 0; k < ri(0, 3); k++) cr.push({ x: rf(0, w), y: rf(0, d), r: rf(5, 80), n: ri(0, 800) });
  var meas = {}; if (n > 1 && rnd() < 0.3) { var a = ri(0, n - 1), b = ri(0, n - 1); if (a !== b) meas[Math.min(a, b) + "-" + Math.max(a, b)] = ri(-95, -40); }
  return { aps: aps, obstacles: obs, terrain: tr, crowds: cr, meas: meas, w: w, d: d,
           land: pick(["open", "trees", "town"]), domain: pick(["us", "eu"]), dfs: rnd() < 0.5, north: ri(0, 359),
           uplink: pick([10, 25, 50, 100, 200, 500, 1000]), profile: pick(Object.keys(M.PROFILES)), maxHops: ri(1, 8),
           fGHz: pick([5.2, 6.0]), bw: pick([20, 40, 80, 160]), tx: ri(0, 30), fade: ri(0, 12), ss: pick([1, 2, 4]),
           tworay: rnd() < 0.3, clients: ri(0, 2000), dev: pick(NFN.capacity.DEVICES).id, app: pick(NFN.capacity.APPS).id,
           tod: rnd() < 0.5 ? null : rf(0, 24), curve: pick(Object.keys(M.CURVES)), clientTarget: ri(-80, -55), clientBw: pick([20, 40, 80]), clientF: 5.2 };
}

function invariants(st, p, tag) {
  var T = p.tree, n = p.aps.length, i, live = st.aps.filter(function (a) { return !a.down; }).length;
  check(tag + " ceiling finite", fin(p.ceiling) && p.ceiling >= 0, p.ceiling);
  check(tag + " ceiling under uplink", p.ceiling <= st.uplink + 1e-9);
  check(tag + " ceiling under demand", p.ceiling <= p.demand + 1e-9);
  check(tag + " ceiling under mesh", p.ceiling <= p.meshMbps + 1e-9);
  check(tag + " mesh under demand", p.meshMbps <= p.demand + 1e-6, p.meshMbps + " vs " + p.demand);
  check(tag + " coverage in [0,1]", fin(p.coverage) && p.coverage >= 0 && p.coverage <= 1);
  check(tag + " unserved in range", fin(p.who.unserved) && p.who.unserved >= -1e-9 && p.who.unserved <= p.who.total + 1e-6);
  check(tag + " factor in [0,1]", p.who.factor >= 0 && p.who.factor <= 1);
  check(tag + " binds named", ["demand", "uplink", "mesh"].indexOf(p.binds) >= 0);
  for (i = 0; i < n; i++) {
    var r = p.aps[i], a = st.aps[i];
    if (a.down) { check(tag + " down is down", r.status === "down" && T.depth[i] < 0 && T.parent[i] < 0); continue; }
    if (a.gw) { check(tag + " a live portal is depth 0", T.depth[i] === 0 && T.parent[i] < 0); }
    if (T.depth[i] > 0) {
      var pa = T.parent[i];
      check(tag + " parent exists", pa >= 0 && pa < n && !st.aps[pa].down, pa);
      check(tag + " depth is parent's plus one", T.depth[i] === T.depth[pa] + 1);
      check(tag + " within the hop ceiling", T.depth[i] <= T.maxHops, T.depth[i] + ">" + T.maxHops);
      check(tag + " parent link is a usable link", !!T.links[i][pa] && T.links[i][pa].ok);
      check(tag + " point on its portal's channel", r.channel === p.aps[pa].channel);
      var k = i, g = 0; while (T.parent[k] >= 0 && g <= n) { k = T.parent[k]; g++; }
      check(tag + " path ends at a portal, no loop", g <= n && st.aps[k].gw && T.depth[k] === 0);
      check(tag + " backhaul finite and positive", fin(r.backhaul) && r.backhaul >= 0, r.backhaul);
      check(tag + " backhaul under the first link", r.backhaul <= T.links[i][pa].goodput + 1e-6);
      check(tag + " air lost in [0,0.9]", r.cci >= 0 && r.cci <= 0.9);
      check(tag + " backup is not the parent or itself", r.backup !== i && r.backup !== pa);
      if (r.backup >= 0) check(tag + " backup has a path", T.depth[r.backup] >= 0);
      if (T.profile.maxHops === 1) check(tag + " single hop profile hangs off a portal", st.aps[pa].gw);
    }
    if (T.depth[i] >= 0) {
      check(tag + " delivered under demand or cell", r.delivered <= Math.max(r.demand, r.cellMbps) + 1e-6 || !r.serves);
      check(tag + " bridge serves nobody", r.serves || (r.clients === 0 && r.delivered === 0));
      check(tag + " clients finite", fin(r.clients) && r.clients >= 0);
      if (r.channel !== null) check(tag + " channel is in the domain's list", p.channels.list.indexOf(r.channel) >= 0 || (a.gw && a.ch !== null && a.ch !== undefined), r.channel);
      else check(tag + " no channel only when the domain has none", p.channels.list.length === 0 || T.depth[i] < 0);
    }
    if (r.link) {
      var L = r.link;
      check(tag + " link numbers finite", fin(L.prx) && fin(L.snr) && fin(L.goodput) && fin(L.fspl) && fin(L.diffraction) && fin(L.clearance) || L.blockedBy === "band");
      check(tag + " diffraction not negative", L.diffraction >= 0);
      check(tag + " goodput under PHY", L.goodput <= L.phyMbps + 1e-6);
      check(tag + " weaker end sets the power", L.tx <= Math.min(M.apTx(T.aps[i], M.cfg(st)), M.apTx(T.aps[pa], M.cfg(st))) + 1e-9);
      if (L.measured) check(tag + " measured link at the measured level", Math.abs(L.prx + st.fade - st.meas[Math.min(i, pa) + "-" + Math.max(i, pa)]) < 1e-6);
    }
  }
  /* the channel picture */
  check(tag + " distinct channels at most the portals", p.channels.distinct <= Math.max(1, T.gateways));
  /* the sweep never lies about the sum */
  var sum = 0; p.aps.forEach(function (r) { if (r.status !== "down" && r.status !== "unreachable") sum += Math.min(r.delivered, r.demand); });
  check(tag + " mesh carries is the sum of the delivered demand", Math.abs(sum - p.meshMbps) < 1e-6);
}

/* symmetry and monotonicity: things that must move the right way */
function physics(st, p) {
  var C = M.cfg(st), aps = p.tree.aps, n = aps.length, i, j;
  for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
    if (aps[i].down || aps[j].down) continue;
    var L1 = M.link(aps[i], aps[j], C, st.obstacles, st.terrain), L2 = M.link(aps[j], aps[i], C, st.obstacles, st.terrain);
    check("link is symmetric in received power", Math.abs(L1.prx - L2.prx) < 1e-6 || (L1.blockedBy === "band"), (L1.prx - L2.prx).toFixed(3));
    check("link is symmetric in gains", Math.abs(L1.ga - L2.gb) < 1e-6 && Math.abs(L1.gb - L2.ga) < 1e-6);
    if (L1.blockedBy === "band" || !fin(L1.prx)) continue;
    var Lf = M.link(aps[i], aps[j], Object.assign({}, C, { fade: C.fade + 3 }), st.obstacles, st.terrain);
    check("3 dB more fade is 3 dB less signal", Math.abs((L1.prx - Lf.prx) - 3) < 1e-6);
    var Lt = M.link(Object.assign({}, aps[i], { tx: 30 }), Object.assign({}, aps[j], { tx: 30 }), Object.assign({}, C, { domain: "us" }), st.obstacles, st.terrain),
        Lt0 = M.link(aps[i], aps[j], Object.assign({}, C, { domain: "us" }), st.obstacles, st.terrain);
    check("full power never hurts", Lt.prx >= Lt0.prx - 1e-6);
    if (!st.tworay) {
      var Lu = M.link(Object.assign({}, aps[i], { h: aps[i].h + 3 }), Object.assign({}, aps[j], { h: aps[j].h + 3 }), C, st.obstacles, st.terrain);
      check("taller masts do not lose clearance", Lu.clearance >= L1.clearance - 1e-6, L1.clearance.toFixed(2) + " -> " + Lu.clearance.toFixed(2));
      check("taller masts do not add diffraction", Lu.diffraction <= L1.diffraction + 1e-6, L1.diffraction.toFixed(2) + " -> " + Lu.diffraction.toFixed(2));
    }
    var Lw = M.link(Object.assign({}, aps[i], { bw: 20 }), Object.assign({}, aps[j], { bw: 20 }), C, st.obstacles, st.terrain);
    check("20 MHz never has less SNR", Lw.snr >= L1.snr - 1e-6);
  }
  /* the EIRP cap */
  var dom = M.domain(C.domain), lim = dom.eirp[M.bandOf(C.fGHz)];
  aps.forEach(function (a) { var g = M.apAntenna(a, C).g; check("EIRP within the domain", M.apTx(a, C, g, C.fGHz) + g <= lim + 1e-9, (M.apTx(a, C, g, C.fGHz) + g) + " > " + lim); });
  /* antennas */
  aps.forEach(function (a) {
    var ant = M.apAntenna(a, C), peak = -Infinity, az;
    for (az = -180; az < 180; az += 5) peak = Math.max(peak, M.gainToward(a, az, -(a.tilt || 0) - ant.tilt, C, "bh"));
    check("no antenna beats its own gain", peak <= ant.g + 1e-6, peak + " > " + ant.g);
    check("boresight is the peak", Math.abs(M.gainToward(a, a.aim, -(a.tilt || 0) - ant.tilt, C, "bh") - ant.g) < 1e-6);
  });
}

/* the picker, the sweep, the advisors: they must never make things worse than doing nothing */
function advisors(st, p) {
  var omni = Object.assign({}, st, { aps: st.aps.map(function (a) { return Object.assign({}, a, { ant: M.isAuto(a) ? "omni" : a.ant }); }) });
  var S = M.suggest(st);
  check("picked antennas score at least the omnis", S.score >= M.score(M.plan(omni)) - 1e-6, S.score.toFixed(1) + " < " + M.score(M.plan(omni)).toFixed(1));
  check("a reason per decision", S.reasons.length === S.decided.length);
  var R = M.resilience(st, st.aps.length <= 8);
  R.cases.forEach(function (c) {
    check("failing an AP never orphans it", c.orphans.indexOf(c.i) < 0);
    check("orphans were reachable before", c.orphans.every(function (o) { return p.aps[o].status !== "unreachable"; }));
    check("portals left never grows", c.portalsLeft <= p.tree.gateways);
  });
  R.pairs.forEach(function (c, k) { if (k) check("pairs come worst first", c.orphans.length <= R.pairs[k - 1].orphans.length); });
  var H = M.suggestHeights(st, p);
  H.forEach(function (h) { check("a height suggestion is about a flagged link", p.aps[h.i].link && (p.aps[h.i].link.fresnelBad || p.aps[h.i].link.diffraction >= 3)); check("raising by the suggestion is finite", h.up === null || (fin(h.up) && h.up >= 0)); });
  if (st.aps.length >= 2) {
    var live = st.aps.map(function (a, i) { return a.down ? -1 : i; }).filter(function (i) { return i >= 0; });
    if (live.length >= 2) { var ex = M.explain(st, p, live[0], live[1]); check("explain always has a reason", typeof ex.why === "string" && ex.why.length > 3); }
  }
  var pts = [{ x: 0, y: 0 }, { x: st.w, y: st.d }], wk = M.walk(st, p, pts, 25);
  check("the walk covers the diagonal", wk.length >= 2 && Math.abs(wk[wk.length - 1].dist - Math.hypot(st.w, st.d)) < 1e-6);
  wk.forEach(function (s) { check("walk readings finite", fin(s.alone) && fin(s.crowd) && s.alone >= 0 && s.crowd >= 0 && (!s.ok || fin(s.rssi))); });
  /* the hash carries the site: what State prints, State reads back */
  var cl = M.client(st, p, { x: st.w / 2, y: st.d / 2 });
  check("client alone never beats the uplink", !cl.ok || cl.alone <= st.uplink + 1e-6);
  check("the crowd never helps the client", !cl.ok || cl.crowd <= cl.alone + 1e-6);
}

var t0 = Date.now(), slow = 0, sites = 0;
for (var s = 0; s < COUNT; s++) {
  var st = randomSite(), t1 = Date.now();
  try {
    var p = M.plan(st);
    invariants(st, p, "plan");
    physics(st, p);
    if (s % 4 === 0) advisors(st, p);
    /* the time of day is a scale on the headcount, nothing else */
    if (st.tod !== null) { var peak = M.plan(Object.assign({}, st, { tod: null })); check("the clock never adds people", p.clients <= peak.clients + 1e-6); }
    /* failing every AP one by one keeps the invariants */
    if (s % 8 === 0) st.aps.forEach(function (a, i) { var st2 = Object.assign({}, st, { aps: st.aps.map(function (b, k) { return k === i ? Object.assign({}, b, { down: true }) : b; }) }); invariants(st2, M.plan(st2), "fail"); });
  } catch (e) {
    check("plan does not throw", false, e.message + " on site " + s);
  }
  sites++;
  slow = Math.max(slow, Date.now() - t1);
}
var dt = Date.now() - t0;
console.log((failed ? "FAILED " : "ok  ") + (checks - failed) + "/" + checks + " invariant checks over " + sites + " random sites (seed " + SEED + "), " + dt + " ms, slowest site " + slow + " ms");
Object.keys(fails).sort(function (a, b) { return fails[b] - fails[a]; }).forEach(function (k) { console.log("  " + fails[k] + " x " + k); });
worst.forEach(function (w) { console.log("    e.g. " + w); });
process.exit(failed ? 1 : 0);
