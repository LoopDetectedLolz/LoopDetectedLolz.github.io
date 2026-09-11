#!/usr/bin/env node
/* Model tests. No browser, no canvas: these assert the physics against figures
   that can be checked against a standard or a textbook, so a refactor that
   quietly changes a number fails here instead of on the site.
   Run: node simtest.js */
var fs = require("fs"), path = require("path");
var dir = path.join(__dirname, "theme", "sim");
["core.js", "rf.js", "phy.js", "mac.js", "channels.js", "capacity.js", "venue.js"].forEach(function (f) {
  new Function(fs.readFileSync(path.join(dir, f), "utf8")).call(globalThis);
});
var NFN = globalThis.NFN, fails = 0, n = 0;

function near(what, got, want, tol) {
  n++;
  var ok = Math.abs(got - want) <= (tol === undefined ? 0.05 : tol);
  if (!ok) { fails++; console.log("  FAIL " + what + ": got " + got + ", wanted " + want + " +/- " + (tol || 0.05)); }
  return ok;
}
function eq(what, got, want) {
  n++;
  if (got !== want) { fails++; console.log("  FAIL " + what + ": got " + JSON.stringify(got) + ", wanted " + JSON.stringify(want)); }
}

/* ── propagation ───────────────────────────────────────────────────────── */
near("free space 1 m at 5.2 GHz", NFN.rf.fspl(1, 5.2), 46.76, 0.02);
near("free space 100 m at 2.4 GHz", NFN.rf.fspl(100, 2.4), 80.05, 0.05);
near("doubling the distance costs 6 dB", NFN.rf.fspl(2, 5.2) - NFN.rf.fspl(1, 5.2), 6.02, 0.01);
near("indoor n=3 doubling costs 9 dB", NFN.rf.logDistance(20, 5.2, 3) - NFN.rf.logDistance(10, 5.2, 3), 9.03, 0.01);
near("noise floor, 20 MHz, NF 7", NFN.rf.noiseFloor(20, 7), -94.0, 0.1);
near("noise floor, 80 MHz, NF 7", NFN.rf.noiseFloor(80, 7), -87.97, 0.05);
near("F1 midpoint of a 10 km link at 5.2 GHz", NFN.rf.fresnel1(5000, 5000, 5.2), 12.01, 0.02);
near("earth bulge midpoint of 50 km, k=4/3", NFN.rf.bulge(25000, 25000, 4 / 3), 36.79, 0.02);
near("knife edge at v=0 is 6 dB", NFN.rf.knifeEdge(0), 6.02, 0.1);
near("knife edge well clear is 0 dB", NFN.rf.knifeEdge(-1.5), 0, 0.001);
near("a 65 degree lobe fits cos^n", Math.pow(Math.cos(32.5 * Math.PI / 180), NFN.rf.cosN(65)), 0.5, 0.001);

/* ── PHY rates, against the tables in the standards ───────────────────── */
near("802.11a MCS 0 is 6 Mb/s", NFN.phy.rate("a", 0, 1, 20), 6, 0.01);
near("802.11a top rate is 54 Mb/s", NFN.phy.rate("a", 7, 1, 20), 54, 0.01);
near("802.11n MCS 7, 1SS, 20 MHz is 65 Mb/s", NFN.phy.rate("n", 7, 1, 20), 65, 0.01);
near("802.11ac MCS 9, 2SS, 80 MHz is 780 Mb/s", NFN.phy.rate("ac", 9, 2, 80), 780, 0.5);
near("802.11ax MCS 11, 2SS, 160 MHz is 2402 Mb/s", NFN.phy.rate("ax", 11, 2, 160), 2402, 1.5);
near("802.11be MCS 13, 2SS, 320 MHz is 5764 Mb/s", NFN.phy.rate("be", 13, 2, 320), 5764, 3);

/* ── airtime ───────────────────────────────────────────────────────────── */
var a6 = NFN.phy.frameAirtime({ std: "a", mcs: 0, ss: 1, bw: 20, bytes: 1500, agg: 1 });
near("1500 bytes at 6 Mb/s is about 2.07 ms", a6, 2072, 2);
var a54 = NFN.phy.frameAirtime({ std: "a", mcs: 7, ss: 1, bw: 20, bytes: 1500, agg: 1 });
near("the same frame at 54 Mb/s", a54, 248, 4);
eq("a slow client costs about eight times the airtime", Math.round(a6 / a54), 8);

/* the tax: a legacy station moving 1 Mb/s against a Wi-Fi 6 station moving 1 Mb/s */
var slow = NFN.capacity.group({ n: 1, dev: "legacy", app: "web" }, { bw: 20, retry: 0.1 });
var fast = NFN.capacity.group({ n: 1, dev: "ax2", app: "web" }, { bw: 80, retry: 0.1 });
if (!(slow.airtimePerMbps > fast.airtimePerMbps * 8)) { fails++; console.log("  FAIL legacy airtime tax is not showing up"); }
n++;

/* ── MAC ───────────────────────────────────────────────────────────────── */
near("average backoff at CWmin 15", NFN.mac.avgBackoff(), 67.5, 0.01);
var tp = NFN.mac.throughput({ std: "ax", mcs: 11, ss: 2, bw: 160, bytes: 1500, agg: 64, retry: 0 }) / 1e6;
if (!(tp > 1200 && tp < 1900)) { fails++; console.log("  FAIL 2SS 160 MHz goodput out of range: " + tp.toFixed(0) + " Mb/s"); }
n++;
var noagg = NFN.mac.throughput({ std: "ax", mcs: 11, ss: 2, bw: 160, bytes: 1500, agg: 1, retry: 0 }) / 1e6;
if (!(noagg < tp / 3)) { fails++; console.log("  FAIL aggregation is not carrying its weight"); }
n++;
var bo = NFN.mac.beaconOverhead(4, 102.4, "ax");
if (!(bo > 0.005 && bo < 0.12)) { fails++; console.log("  FAIL four SSIDs of beacons out of range: " + (bo * 100).toFixed(1) + "%"); }
n++;

/* ── the plan holds together ───────────────────────────────────────────── */
var plan = NFN.capacity.plan({
  bw: 80, retry: 0.1, ssids: 3, beaconMs: 102.4, target: 0.5,
  groups: [{ n: 40, dev: "ax2", app: "video" }, { n: 60, dev: "ac1", app: "web" }]
});
eq("client count", plan.clients, 100);
if (!(plan.aps >= 1 && plan.aps < 200)) { fails++; console.log("  FAIL implausible AP count: " + plan.aps); }
n++;
if (!(plan.perAp <= plan.target + 1e-9)) { fails++; console.log("  FAIL per-AP airtime above the target"); }
n++;
eq("the AP count is whichever ceiling binds", plan.aps, Math.max(plan.apsByAirtime, plan.apsByClients));
if (["airtime", "clients", "both"].indexOf(plan.binds) < 0) { fails++; console.log("  FAIL odd binds value: " + plan.binds); }
n++;
var dense = NFN.capacity.plan({ bw: 80, retry: 0.1, ssids: 1, target: 0.5, maxPerRadio: 60,
  groups: [{ n: 300, dev: "ax2", app: "web" }] });
eq("300 light clients are capped by the client count, not the airtime", dense.binds, "clients");
eq("which gives five radios at sixty each", dense.aps, 5);
near("airtime adds up", plan.totalAirtime, plan.clientAirtime + plan.beaconAirtime, 1e-9);

/* one 802.11a/g client at the edge should visibly hurt a healthy cell */
var healthy = NFN.capacity.plan({ bw: 80, retry: 0.1, ssids: 1, target: 0.5, groups: [{ n: 30, dev: "ax2", app: "web" }] });
var hurt = NFN.capacity.plan({ bw: 80, retry: 0.1, ssids: 1, target: 0.5, groups: [{ n: 30, dev: "ax2", app: "web" }, { n: 1, dev: "legacy", app: "web" }] });
if (!(hurt.totalAirtime > healthy.totalAirtime * 1.2)) {
  fails++; console.log("  FAIL one legacy client should cost more than this: " +
    (healthy.totalAirtime * 100).toFixed(1) + "% -> " + (hurt.totalAirtime * 100).toFixed(1) + "%");
}
n++;

/* ── channels and reuse ───────────────────────────────────────────────── */
eq("2.4 GHz has three channels at 20 MHz", NFN.channels.count("2.4", 20, true), 3);
eq("5 GHz at 80 MHz without DFS", NFN.channels.count("5", 80, false), 2);
eq("5 GHz at 80 MHz with DFS", NFN.channels.count("5", 80, true), 6);
eq("6 GHz at 80 MHz", NFN.channels.count("6", 80, false), 14);
eq("nine radios on three channels is three deep", NFN.channels.reuse(9, 3), 3);
near("one neighbour at half volume adds half a load", NFN.channels.occupancy(0.2, 2, 1, 0.5), 0.3, 1e-9);

/* 2.4 GHz runs out of channels: past a point more radios make it worse */
var narrow = NFN.capacity.plan({ band: "2.4", bw: 20, retry: 0.1, ssids: 3, target: 0.5, maxPerRadio: 60,
  overlap: 0.5, groups: [{ n: 400, dev: "n1", app: "video" }] });
eq("2.4 GHz cannot absorb this", narrow.fits, false);
eq("and it says so", narrow.binds, "channels");
if (!(narrow.bestAps > 0 && narrow.bestAps < 240)) { fails++; console.log("  FAIL no sensible floor found"); }
n++;
var wide = NFN.capacity.plan({ band: "6", bw: 80, retry: 0.1, ssids: 3, target: 0.5, maxPerRadio: 60,
  overlap: 0.5, groups: [{ n: 400, dev: "ax2", app: "video" }] });
eq("6 GHz absorbs the same load", wide.fits, true);
if (!(wide.reuse === 1)) { fails++; console.log("  FAIL 14 channels should not need reuse: " + wide.reuse); }
n++;

/* co-channel load is counted, not assumed away. Two channels and a load that
   needs more radios than that, so there are real neighbours to hear. */
function five(ov) {
  return NFN.capacity.plan({ band: "5", bw: 80, retry: 0.1, ssids: 2, target: 0.6, maxPerRadio: 400,
    overlap: ov, groups: [{ n: 300, dev: "ac1", app: "video" }] });
}
var alone = five(0), crowded = five(0.8);
if (!(alone.reuse > 1)) { fails++; console.log("  FAIL this case was meant to run out of channels: reuse " + alone.reuse); }
n++;
if (!(crowded.perAp > alone.perAp)) { fails++; console.log("  FAIL hearing the neighbours should cost something"); }
n++;
if (!(crowded.coChannel > 0 && alone.coChannel < 1e-9)) { fails++; console.log("  FAIL co-channel share is not being counted"); }
n++;

/* turning DFS off takes channels away, and that shows up as radios */
var noDfs = NFN.capacity.plan({ band: "5", bw: 80, dfs: false, retry: 0.1, ssids: 3, target: 0.5,
  maxPerRadio: 60, overlap: 0.6, groups: [{ n: 300, dev: "ax2e", app: "video" }] });
var withDfs = NFN.capacity.plan({ band: "5", bw: 80, dfs: true, retry: 0.1, ssids: 3, target: 0.5,
  maxPerRadio: 60, overlap: 0.6, groups: [{ n: 300, dev: "ax2e", app: "video" }] });
eq("without DFS this does not fit on 80 MHz", noDfs.fits, false);
eq("with DFS it does", withDfs.fits, true);

/* there is no 160 MHz channel outside DFS, and saying so beats pretending there is one */
eq("no non-DFS 160 MHz channel exists", NFN.channels.count("5", 160, false), 0);
var none = NFN.capacity.plan({ band: "5", bw: 160, dfs: false, retry: 0.1, ssids: 1, target: 0.5,
  maxPerRadio: 60, overlap: 0.5, groups: [{ n: 20, dev: "ax2e", app: "web" }] });
eq("so the plan refuses rather than inventing one", none.fits, false);
eq("and blames the channels", none.binds, "channels");

/* ── aiming at a block of seats ────────────────────────────────────────── */
var sec = NFN.venue.section(20, 30, 20, "arena");
eq("a trapezoid section counts its seats", sec.seats, 500);
near("and knows how deep it is", sec.depth, 17, 0.01);
var rws = NFN.venue.rows(sec, "arena", 14, 18), dem = NFN.venue.demand(rws);
near("the first row is nearest and lowest", rws[0].slant, Math.hypot(18, 14), 0.01);
if (!(dem.near.depression > dem.far.depression)) { fails++; console.log("  FAIL the front row should sit further below the antenna"); }
n++;
if (!(dem.vNeed > 10 && dem.vNeed < 40)) { fails++; console.log("  FAIL implausible vertical demand: " + dem.vNeed.toFixed(1)); }
n++;
near("the tilt splits the two edges", dem.tilt, (dem.near.depression + dem.far.depression) / 2, 1e-9);

/* a wide antenna throws past the section, a narrow one does not reach the back */
var wide = NFN.venue.footprint(sec, "arena", 14, 18, "patch65");
var tight = NFN.venue.footprint(sec, "arena", 14, 18, "sect12");
if (!(wide.seatsCovered > tight.seatsCovered)) { fails++; console.log("  FAIL a wider beam should land on more seats"); }
n++;
eq("65 degrees covers a section that needs less", wide.vFits, true);
eq("12 degrees does not", tight.vFits, false);
if (!(tight.rowsCovered.length < sec.rows)) { fails++; console.log("  FAIL a 12 degree beam cannot cover every row"); }
n++;

/* an under seat mount sits below the back of the bowl, and negative tilt is the answer */
var low = NFN.venue.demand(NFN.venue.rows(sec, "arena", 1.0, 2));
if (!(low.far.depression < 0)) { fails++; console.log("  FAIL a low mount should be looking up at the back rows"); }
n++;

/* the crowd costs signal */
var empty = NFN.venue.signal(rws[rws.length - 1], "sect30", { full: false });
var full = NFN.venue.signal(rws[rws.length - 1], "sect30", { full: true, bodyDb: 5 });
near("a full bowl costs the body loss", empty.rssi - full.rssi, 5, 1e-9);
if (!(empty.snr > full.snr)) { fails++; console.log("  FAIL body loss should cost SNR too"); }
n++;
near("minimum SNR picks a rate", NFN.phy.mcsFor("ax", 26), 7, 0);
eq("and refuses when there is nothing to pick", NFN.phy.mcsFor("ax", 0), -1);

var sp = NFN.venue.split(sec, "arena", 14, 18, 9);
if (!sp) { fails++; console.log("  FAIL no split found for nine radios"); }
n++;
if (sp) {
  if (!(sp.blocks >= 9 && sp.blocks <= 11)) { fails++; console.log("  FAIL split does not match the radio count: " + sp.blocks); }
  n++;
  if (!(sp.antenna.v >= sp.vNeed && sp.antenna.h >= sp.hNeed)) { fails++; console.log("  FAIL the chosen antenna does not cover its block"); }
  n++;
  var deepest = sp.bands[sp.bands.length - 1];
  if (!(deepest.tilt < sp.bands[0].tilt)) { fails++; console.log("  FAIL the back band should be aimed flatter than the front"); }
  n++;
  if (!(sp.antenna.v * sp.antenna.h < 40 * 360)) { fails++; console.log("  FAIL an omni should never win the split"); }
  n++;
}

var vp = NFN.venue.plan({ venue: "arena", nearSeats: 20, farSeats: 30, rows: 20,
  mountH: 14, dist: 18, ant: "sect30", bw: 40, full: true });
eq("the plan counts the same seats", vp.section.seats, 500);
if (!(vp.clients > 0 && vp.clients < vp.section.seats)) { fails++; console.log("  FAIL take rate is not being applied"); }
n++;
if (["misses", "narrow", "wide", "tight", "good"].indexOf(vp.verdict) < 0) { fails++; console.log("  FAIL odd verdict: " + vp.verdict); }
n++;
if (!(vp.sheet.length >= 8)) { fails++; console.log("  FAIL the install sheet is thin"); }
n++;
if (!(vp.near.rssi > vp.far.rssi)) { fails++; console.log("  FAIL the back row should be weaker than the front"); }
n++;

/* ── state round trip ──────────────────────────────────────────────────── */
var st = NFN.State("capacity", { bw: NFN.f.int(80, 20, 320), std: NFN.f.pick("ax", ["a", "n", "ac", "ax", "be"]), seed: NFN.f.int(1, 1, 1e9) });
st.set("bw", 160).set("seed", 4242);
var st2 = NFN.State("capacity", { bw: NFN.f.int(80, 20, 320), std: NFN.f.pick("ax", ["a", "n", "ac", "ax", "be"]), seed: NFN.f.int(1, 1, 1e9) });
eq("hash is recognised", st2.fromHash(st.toHash()), true);
eq("width survives the round trip", st2.get("bw"), 160);
eq("seed survives the round trip", st2.get("seed"), 4242);
eq("another tool's hash is refused", st2.fromHash("#roaming/v1?bw=20"), false);
eq("junk falls back to the default", NFN.f.int(80, 20, 320).get("banana"), undefined);

/* ── the seed means what it says ───────────────────────────────────────── */
var r1 = NFN.rng(7), r2 = NFN.rng(7), same = true;
for (var i = 0; i < 50; i++) if (r1() !== r2()) same = false;
eq("the same seed gives the same sequence", same, true);
eq("different seeds do not", NFN.rng(7)() === NFN.rng(8)(), false);

console.log((fails ? "FAILED " : "ok  ") + (n - fails) + "/" + n + " model checks");
process.exit(fails ? 1 : 0);
