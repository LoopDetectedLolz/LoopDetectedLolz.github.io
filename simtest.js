#!/usr/bin/env node
/* Model tests. No browser, no canvas: these assert the physics against figures
   that can be checked against a standard or a textbook, so a refactor that
   quietly changes a number fails here instead of on the site.
   Run: node simtest.js */
var fs = require("fs"), path = require("path");
var dir = path.join(__dirname, "theme", "sim");
["core.js", "rf.js", "phy.js", "mac.js", "capacity.js"].forEach(function (f) {
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
