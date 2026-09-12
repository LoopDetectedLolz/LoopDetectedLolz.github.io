#!/usr/bin/env node
/* Model tests. No browser, no canvas: these assert the physics against figures
   that can be checked against a standard or a textbook, so a refactor that
   quietly changes a number fails here instead of on the site.
   Run: node simtest.js */
var fs = require("fs"), path = require("path");
var dir = path.join(__dirname, "theme", "sim");
["core.js", "rf.js", "phy.js", "mac.js", "channels.js", "capacity.js", "venue.js", "mesh.js", "aps.js", "esx.js", "kml.js", "emit.js", "story.js"].forEach(function (f) {
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

/* ── mesh ──────────────────────────────────────────────────────────────── */
var ML = NFN.mesh.link({ x: 0, y: 0, h: 3 }, { x: 200, y: 0, h: 3 }, { tworay: false });
near("a 200 m link is free space at 200 m", ML.fspl, NFN.rf.fspl(200, 5.2), 0.001);
near("and 3 m masts clear the Fresnel zone", ML.clearance, 3 / NFN.rf.fresnel1(100, 100, 5.2), 0.02);
eq("so it is not flagged", ML.fresnelBad, false);
var ML2 = NFN.mesh.link({ x: 0, y: 0, h: 1 }, { x: 400, y: 0, h: 1 }, { tworay: false });
eq("1 m masts over 400 m are flagged", ML2.fresnelBad, true);
if (!(ML2.diffraction > 0.5)) { fails++; console.log("  FAIL the ground should cost something at 1 m over 400 m: " + ML2.diffraction); }
n++;
var ML3 = NFN.mesh.link({ x: 0, y: 0, h: 3 }, { x: 200, y: 0, h: 3 }, { tworay: false }, [{ x: 100, y: 0, h: 12, r: 10 }]);
if (!(ML3.diffraction > 20)) { fails++; console.log("  FAIL a 12 m building on a 3 m link should be a wall: " + ML3.diffraction); }
n++;
eq("and it names the obstacle", ML3.obstacle, 0);
var ML4 = NFN.mesh.link({ x: 0, y: 0, h: 3 }, { x: 200, y: 0, h: 3 }, { tworay: false }, [{ x: 100, y: 40, h: 12, r: 10 }]);
eq("a building beside the path costs nothing", ML4.diffraction, 0);
var ML5 = NFN.mesh.link({ x: 0, y: 0, h: 3, tx: 10 }, { x: 200, y: 0, h: 3, tx: 23 }, { tworay: false });
near("the weaker transmitter sets the link", ML5.prx, ML.prx - 13, 0.001);
near("two ray with no bounce is 0 dB", NFN.mesh.twoRay(100, 3, 3, 5.2, 0), 0, 0.001);
var tr = NFN.mesh.twoRay(150, 3, 3, 5.2, 0.5);
if (!(tr >= -6.03 && tr <= 3.53)) { fails++; console.log("  FAIL two ray at rho 0.5 is bounded by -6 and +3.5 dB: " + tr); }
n++;
/* 5 dBm into 5 dBi omnis: 200 m holds the lowest rate, 400 m holds nothing, so
   the only way along the row is hop by hop */
var chain = { aps: [{ x: 0, y: 0, h: 3, gw: true }, { x: 200, y: 0, h: 3 }, { x: 400, y: 0, h: 3 }, { x: 600, y: 0, h: 3 }],
              w: 650, d: 100, tx: 5, tworay: false, uplink: 100, clients: 120, app: "web" };
var CP = NFN.mesh.plan(chain);
eq("a chain at low power hops along", JSON.stringify(CP.tree.depth), "[0,1,2,3]");
eq("each point's parent is the one before it", JSON.stringify(CP.tree.parent), "[-1,0,1,2]");
eq("the portal carries everyone behind it", CP.tree.subtree[0], 4);
var d1 = CP.aps[1].backhaul, d3 = CP.aps[3].backhaul;
if (!(d3 < d1 / 3)) { fails++; console.log("  FAIL three hops on a shared radio should cost more than a third: " + d1 + " vs " + d3); }
n++;
var CPd = NFN.mesh.plan(Object.assign({}, chain, { dedicated: true }));
if (!(CPd.aps[3].backhaul > CP.aps[3].backhaul * 2)) { fails++; console.log("  FAIL a dedicated backhaul radio should lift the deep hop"); }
n++;
var CPm = NFN.mesh.plan(Object.assign({}, chain, { profile: "mist" }));
eq("a single hop profile strands the chain", JSON.stringify(CPm.tree.depth), "[0,1,-1,-1]");
eq("and says so", CPm.unreachable, 2);
var CPh = NFN.mesh.plan(Object.assign({}, chain, { maxHops: 2 }));
eq("the hop ceiling is honoured", JSON.stringify(CPh.tree.depth), "[0,1,2,-1]");
var CPu = NFN.mesh.plan(Object.assign({}, chain, { uplink: 20 }));
eq("the satellite is the ceiling when it is smallest", CPu.binds, "uplink");
near("and nothing gets past it", CPu.ceiling, 20, 0.001);
var CPx = NFN.mesh.plan(Object.assign({}, chain, { aps: chain.aps.map(function (a, i) { return i === 1 ? Object.assign({}, a, { down: true }) : a; }) }));
eq("failing the first point orphans the chain behind it", JSON.stringify(CPx.tree.depth), "[0,-1,-1,-1]");
eq("and the failed one is down, not unreachable", CPx.unreachable, 2);
var RS = NFN.mesh.resilience(chain);
eq("the N-1 sweep covers every live AP", RS.cases.length, 4);
eq("losing the portal orphans everyone", RS.cases[0].orphans.length, 3);
eq("losing the last point orphans nobody", RS.cases[3].orphans.length, 0);
var ring = { aps: [{ x: 0, y: 0, h: 3, gw: true }, { x: 150, y: 0, h: 3 }, { x: 150, y: 120, h: 3 }, { x: 0, y: 120, h: 3 }],
             w: 200, d: 150, tx: 20, tworay: false, uplink: 100, clients: 40 };
var RP = NFN.mesh.plan(ring);
if (!(RP.aps[2].backup >= 0)) { fails++; console.log("  FAIL a point with two neighbours should have a backup parent"); }
n++;
eq("no portal means nobody is reached", NFN.mesh.plan({ aps: [{ x: 0, y: 0, h: 3 }, { x: 50, y: 0, h: 3 }], w: 100, d: 100 }).unreachable, 2);
var CL = NFN.mesh.client(chain, CP, { x: 10, y: 5 });
eq("a client next to the portal joins the portal", CL.ap, 0);
if (!(CL.alone <= chain.uplink + 1e-9)) { fails++; console.log("  FAIL a client alone cannot beat the uplink"); }
n++;
if (!(CL.crowd <= CL.alone)) { fails++; console.log("  FAIL the crowd should not help"); }
n++;
var cov = NFN.mesh.coverage([{ x: 50, y: 50, h: 3, tx: 30, aim: 0 }], { tx: 30 }, "open", 100, 100);
near("a hot omni covers the whole field", cov, 1, 0.001);

/* antennas */
var OM = { x: 0, y: 0, h: 3, ant: "omni", aim: 0 }, NP = { x: 0, y: 0, h: 3, ant: "pnarrow", aim: 0 };
near("an omni is the same all round", NFN.mesh.gainToward(OM, 137, 0, {}), NFN.mesh.gainToward(OM, 0, 0, {}), 0.001);
near("a patch on boresight gives its full gain", NFN.mesh.gainToward(NP, 0, 0, {}), 12, 0.001);
near("half power beamwidth means 3 dB down at the edge", NFN.mesh.gainToward(NP, 22.5, 0, {}), 9, 0.05);
near("and the back is the front to back ratio", NFN.mesh.gainToward(NP, 180, 0, {}), 12 - 25, 0.001);
near("a down-tilt omni is down 3 dB at the horizon", NFN.mesh.gainToward({ x: 0, y: 0, h: 3, ant: "dtomni", aim: 0 }, 0, 0, {}),
     5 + 10 * Math.log10(Math.pow(Math.cos(12 * Math.PI / 180), NFN.rf.cosN(30))), 0.01);
var LO = NFN.mesh.link({ x: 0, y: 0, h: 3, ant: "omni", aim: 0 }, { x: 300, y: 0, h: 3, ant: "omni", aim: 180 }, { tworay: false }),
    LP = NFN.mesh.link({ x: 0, y: 0, h: 3, ant: "pnarrow", aim: 0 }, { x: 300, y: 0, h: 3, ant: "pnarrow", aim: 180 }, { tworay: false }),
    LX = NFN.mesh.link({ x: 0, y: 0, h: 3, ant: "pnarrow", aim: 90 }, { x: 300, y: 0, h: 3, ant: "pnarrow", aim: 180 }, { tworay: false });
near("two narrow patches facing each other pick up 14 dB over omnis", LP.prx - LO.prx, 14, 0.01);
if (!(LX.prx < LP.prx - 10)) { fails++; console.log("  FAIL a patch aimed sideways should lose most of its gain: " + (LP.prx - LX.prx)); }
n++;
var AA = NFN.mesh.aims([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 50 }]);
near("an unset aim points at the nearest AP", AA[0], 90, 0.001);
near("and the far one looks back", AA[1], 180, 0.001);
var CT = NFN.mesh.contour({ x: 0, y: 0, h: 3, ant: "omni", aim: 0 }, {}, "open", 8);
near("an omni's footprint is a circle", CT[0].r, CT[3].r, 0.001);
var CTp = NFN.mesh.contour({ x: 0, y: 0, h: 3, ant: "pnarrow", aim: 0 }, {}, "open", 8);
if (!(CTp[0].r > CTp[4].r * 3)) { fails++; console.log("  FAIL a patch should reach much further forward than back"); }
n++;
/* a row of APs at full power: every vendor metric hops along it, the 802.11s
   airtime sum is the one that runs everyone straight back to the portal */
var row = { aps: [{ x: 0, y: 0, h: 3, gw: true }, { x: 150, y: 0, h: 3 }, { x: 300, y: 0, h: 3 }, { x: 450, y: 0, h: 3 }],
            w: 500, d: 100, tx: 20, tworay: false, uplink: 100, clients: 120, app: "web" };
eq("Aruba distributed tree chains along the row", JSON.stringify(NFN.mesh.plan(Object.assign({}, row, { profile: "aruba" })).tree.parent), "[-1,0,1,2]");
eq("Aruba best link chains along the row", JSON.stringify(NFN.mesh.plan(Object.assign({}, row, { profile: "arubabest" })).tree.parent), "[-1,0,1,2]");
eq("Cisco ease chains along the row", JSON.stringify(NFN.mesh.plan(Object.assign({}, row, { profile: "cisco" })).tree.parent), "[-1,0,1,2]");
eq("802.11s airtime goes straight to the portal", JSON.stringify(NFN.mesh.plan(Object.assign({}, row, { profile: "s11" })).tree.parent), "[-1,0,0,0]");
eq("Mist puts everyone who can hear the base straight on it", JSON.stringify(NFN.mesh.plan(Object.assign({}, row, { profile: "mist" })).tree.depth), "[0,1,1,1]");
/* two points at equal distance from two candidates: the tree metric spreads them */
var fork = { aps: [{ x: 0, y: 0, h: 3, gw: true }, { x: 0, y: 200, h: 3, gw: true }, { x: 150, y: 100, h: 3 }, { x: 150, y: 100.5, h: 3 }],
             w: 300, d: 300, tx: 20, tworay: false, uplink: 100, clients: 40 };
var FK = NFN.mesh.plan(Object.assign({}, fork, { profile: "aruba" }));
if (!(FK.tree.parent[2] !== FK.tree.parent[3])) { fails++; console.log("  FAIL distributed-tree should split twins across two portals: " + FK.tree.parent); }
n++;
var RS2 = NFN.mesh.plan(Object.assign({}, row, { profile: "aruba" }));
eq("a marginal direct link is never chosen over a good hop", RS2.aps[3].link.d < 200, true);

/* the antenna picker: a far point gets gain, a close one stays on an omni */
var pick = { aps: [{ x: 0, y: 0, h: 3, gw: true, ant: "omni" }, { x: 120, y: 0, h: 3, ant: "auto" }, { x: 520, y: 0, h: 3, ant: "auto" }],
             w: 560, d: 120, tx: 8, tworay: false, uplink: 100, clients: 90, app: "web" };
var SG = NFN.mesh.suggest(pick);
eq("the picker decides the undecided", SG.decided.length, 2);
eq("and leaves a chosen antenna alone", SG.ants[0], "omni");
if (!(NFN.mesh.antenna(SG.ants[2]).g > NFN.mesh.antenna(SG.ants[1]).g)) { fails++; console.log("  FAIL the far point should get the bigger antenna: " + SG.ants); }
n++;
if (!(SG.score >= NFN.mesh.score(NFN.mesh.plan(Object.assign({}, pick, { aps: pick.aps.map(function (a) { return Object.assign({}, a, { ant: "omni" }); }) }))))) { fails++; console.log("  FAIL the picked set should score at least the all omni set"); }
n++;
eq("with a reason per decision", SG.reasons.length, 2);

/* a patch on a point ends up looking at its parent, not at whoever was nearest */
var look = { aps: [{ x: 0, y: 0, h: 3, gw: true }, { x: 300, y: 0, h: 3, ant: "pnarrow", aim: null }, { x: 340, y: 120, h: 3, ant: "omni" }],
             w: 400, d: 200, tx: 20, tworay: false, uplink: 100, clients: 50 };
var LK = NFN.mesh.plan(look);
eq("the patch feeds from the portal", LK.tree.parent[1], 0);
near("and is turned to face it", Math.abs(LK.tree.aps[1].aim), 180, 0.5);

var mix = { aps: [{ x: 0, y: 0, h: 3, gw: true }, { x: 200, y: 0, h: 3, kind: "tri" }, { x: 400, y: 0, h: 3, kind: "dual" }, { x: 600, y: 0, h: 3, kind: "bridge" }],
            w: 650, d: 100, tx: 5, tworay: false, uplink: 100, clients: 120, app: "web" };
var MP = NFN.mesh.plan(mix);
eq("a dedicated relay halves nothing", MP.aps[2].relays, 0);
eq("a shared relay halves once", MP.aps[3].relays, 1);
eq("a bridge unit serves no clients", MP.aps[3].clients, 0);
near("so the clients land on the three that do", MP.aps[1].clients, 40, 0.001);

/* ── the twenty: link physics ──────────────────────────────────────────── */
var A0 = { x: 0, y: 0, h: 3, ant: "omni", aim: 0 }, B0 = { x: 200, y: 0, h: 3, ant: "omni", aim: 180 };
near("compass: +x on the map is east", NFN.mesh.compass(0, 0), 90, 0.001);
near("compass: -y on the map is north", NFN.mesh.compass(-90, 0), 0, 0.001);
near("compass round trip", NFN.mesh.fromCompass(NFN.mesh.compass(37, 15), 15), 37, 0.001);
near("a 10 degree down-tilt on a patch costs at the horizon", NFN.mesh.gainToward({ x: 0, y: 0, h: 3, ant: "pnarrow", aim: 0, tilt: 10 }, 0, 0, {}),
     12 + 10 * Math.log10(Math.pow(Math.cos(10 * Math.PI / 180), NFN.rf.cosN(45))), 0.01);
eq("different bands never link", NFN.mesh.link(Object.assign({}, A0, { band: 5.2 }), Object.assign({}, B0, { band: 6.0 }), { tworay: false }).ok, false);
var LW = NFN.mesh.link(Object.assign({}, A0, { bw: 20 }), Object.assign({}, B0, { bw: 80 }), { tworay: false });
eq("the narrower end sets the width", LW.bw, 20);
near("and 20 MHz buys 6 dB of SNR over 80", LW.snr - NFN.mesh.link(A0, B0, { tworay: false, bw: 80 }).snr, 6.02, 0.05);
near("fade margin comes straight off the budget", NFN.mesh.link(A0, B0, { tworay: false }).prx - NFN.mesh.link(A0, B0, { tworay: false, fade: 6 }).prx, 6, 0.001);
var LE = NFN.mesh.link(Object.assign({}, A0, { ant: "dish", tx: 30 }), Object.assign({}, B0, { ant: "dish", aim: 180, tx: 30 }), { tworay: false, domain: "eu" });
eq("ETSI caps a dish at 30 dBm EIRP", LE.clamped, true);
near("so 30 dBm into 18 dBi becomes 12 dBm", LE.tx, 12, 0.001);
eq("FCC leaves 23 dBm into an omni alone", NFN.mesh.link(A0, B0, { tworay: false, domain: "us" }).clamped, false);
near("foliage: 12 m of trees at 5 GHz is about 12 dB", NFN.mesh.foliage(12, 5.2), 0.2 * Math.pow(5200, 0.3) * Math.pow(12, 0.6), 0.001);
var LT = NFN.mesh.link(A0, B0, { tworay: false }, [{ x: 100, y: 0, h: 9, r: 6, type: "tree" }]),
    LB = NFN.mesh.link(A0, B0, { tworay: false }, [{ x: 100, y: 0, h: 9, r: 6, type: "building" }]);
eq("a tree line is taken through the canopy", LT.blockedBy, "foliage");
if (!(LT.diffraction < LB.diffraction)) { fails++; console.log("  FAIL trees should cost less than a building of the same height: " + LT.diffraction + " vs " + LB.diffraction); }
n++;
var hill = [{ x: 100, y: 0, r: 40, h: 8 }];
near("a hill lifts the ground", NFN.mesh.ground(100, 0, hill), 8, 0.001);
var LH = NFN.mesh.link(A0, B0, { tworay: false }, [], hill);
eq("and blocks a link over 3 m masts", LH.blockedBy, "ground");
if (!(LH.diffraction > 15)) { fails++; console.log("  FAIL an 8 m hill between 3 m masts should be a wall: " + LH.diffraction); }
n++;
var upH = NFN.mesh.clearHeight(A0, B0, { tworay: false }, [], hill);
if (!(upH !== null && upH >= 5)) { fails++; console.log("  FAIL clearing an 8 m hill needs several metres more mast: " + upH); }
n++;
var LM = NFN.mesh.link(A0, B0, { tworay: false }, [], [], -70);
eq("a measured link replaces the model", LM.measured, true);
near("at the measured level", LM.prx, -70, 0.001);
var cal = { aps: [{ x: 0, y: 0, h: 3, gw: true }, { x: 150, y: 0, h: 3 }, { x: 300, y: 0, h: 3 }], w: 350, d: 100, tx: 20, tworay: false, uplink: 100, clients: 30,
            meas: { "0-1": NFN.mesh.link({ x: 0, y: 0, h: 3, aim: 0 }, { x: 150, y: 0, h: 3, aim: 180 }, { tworay: false, tx: 20 }).model - 8 } };
var PC = NFN.mesh.plan(cal), PC0 = NFN.mesh.plan(Object.assign({}, cal, { meas: {} }));
near("a link measured 8 dB under the model teaches its APs", PC.tree.links[1][2].calib, -4, 0.01);
if (!(PC.tree.links[1][2].prx < PC0.tree.links[1][2].prx)) { fails++; console.log("  FAIL the correction should lower the unmeasured neighbour link"); }
n++;
/* nobody picks a mesh parent by hand: a dish pinned at the portal still bonds
   wherever the metric says, and the plan says so when the two disagree */
var Bx = 850, Ax = Bx - 150 * Math.cos(10 * Math.PI / 180), Ay = 100 - 150 * Math.sin(10 * Math.PI / 180),
    aimSite = { aps: [{ x: 50, y: 100, h: 5, gw: true, ant: "omni" }, { x: Ax, y: Ay, h: 5, ant: "omni" }, { x: Bx, y: 100, h: 5, ant: "dish", aim: 180 }], w: 900, d: 200, tworay: false, uplink: 200, clients: 30 },
    PB = NFN.mesh.plan(Object.assign({}, aimSite, { profile: "arubabest" })), PT = NFN.mesh.plan(Object.assign({}, aimSite, { profile: "aruba" }));
if (!(PB.tree.links[2][1].prx > PB.tree.links[2][0].prx)) { fails++; console.log("  FAIL the near AP in the beam's shoulder should be louder than the far portal"); }
n++;
eq("best-link-rssi bonds the dish to the louder near AP", PB.tree.parent[2], 1);
eq("and the row says where the aim went instead", PB.aps[2].aimedAt, 0);
if (!PB.flags.some(function (f) { return /aimed at AP 1 but bonds to AP 2/.test(f); })) { fails++; console.log("  FAIL the plan should flag the aim against the parent"); }
n++;
eq("an aim that agrees with the parent is not flagged", PT.aps[2].aimedAt >= 0 && PT.aps[2].aimedAt !== PT.tree.parent[2], false);
eq("an omni has no aim to disagree", PT.aps[1].aimedAt, -1);

/* the RF intent a plan implies, and the two controllers' readings of it */
var IT_ST = { aps: [{ x: 50, y: 100, h: 5, gw: true, ant: "omni", name: "Gate" }, { x: 350, y: 100, h: 5, ant: "pwide", tx: 18 }, { x: 650, y: 100, h: 6, ant: "dish" }], w: 900, d: 200, tworay: false, uplink: 200, clients: 30, bw: 40, domain: "us", dfs: false, north: 0 },
    IT_P = NFN.mesh.plan(IT_ST), IT = NFN.emit.intent(IT_P, IT_ST);
eq("intent names the band", IT.band, "5");
eq("intent carries the width", IT.bw, 40);
eq("one portal, two points", IT.mesh.portals + "/" + IT.mesh.points, "1/2");
eq("the portal keeps its name, the rest are numbered", IT.aps[0].name + "," + IT.aps[1].name, "Gate,AP-2");
if (!IT.channels.used.every(function (c) { return IT.channels.allowed.indexOf(c) >= 0; })) { fails++; console.log("  FAIL a used channel must be in the allowed list"); }
n++;
eq("the power window spans the APs", IT.power.min + "-" + IT.power.max, "18-" + IT_P.cfg.tx);
eq("a patch has a compass aim, an omni none", (IT.aps[1].aim !== null) + "/" + (IT.aps[0].aim === null), "true/true");
eq("149 at 80 MHz is 149E", NFN.emit.arubaChannel(149, 80), "149E");
eq("36 at 40 MHz is 36+", NFN.emit.arubaChannel(36, 40), "36+");
eq("a bare 20 MHz channel", NFN.emit.arubaChannel(11, 20), "11");
var CEN = NFN.emit.central(IT), MIST = NFN.emit.mist(IT);
eq("Central: ARM first, then the radio profile, then one ap_settings per AP", CEN.calls.length, 2 + IT.aps.length);
eq("Central ARM lists the allowed channels", CEN.calls[0].body.a_channels, IT.channels.allowed.join(","));
eq("Central ARM has 80 MHz off for a 40 MHz plan", CEN.calls[0].body["80mhz_support"], false);
eq("Central per AP channel wears the width", CEN.calls[2].body.achannel, NFN.emit.arubaChannel(IT.aps[0].channel, 40));
if (!CEN.mesh_cli.some(function (l) { return /distributed-tree-rssi/.test(l); })) { fails++; console.log("  FAIL the mesh CLI should name the metric"); }
n++;
eq("Mist: template, site, mesh setting, then one device each", MIST.calls.length, 3 + IT.aps.length);
eq("Mist template channels are an array", Array.isArray(MIST.calls[0].body.band_5.channels), true);
eq("Mist portal is a base", MIST.calls[3].body.mesh.role, "base");
eq("Mist point is a relay", MIST.calls[4].body.mesh.role, "relay");
if (!(NFN.emit.text(IT).split("\n").length >= 5 + IT.aps.length)) { fails++; console.log("  FAIL the text should have a header and a line per AP"); }
n++;
/* two hops on a Mist plan is a warning, because Mist relays are one hop */
var CH_ST = Object.assign({}, IT_ST, { aps: [{ x: 50, y: 100, h: 5, gw: true }, { x: 250, y: 100, h: 5 }, { x: 450, y: 100, h: 5 }, { x: 650, y: 100, h: 5 }], tx: 8, profile: "aruba" }), CH_P = NFN.mesh.plan(CH_ST);
if (CH_P.maxDepth > 1) eq("Mist warns about a plan deeper than one hop", NFN.emit.mist(NFN.emit.intent(CH_P, CH_ST)).warnings.length, 1);

/* what happened: the story block, read four ways */
var STORY = JSON.parse(fs.readFileSync(path.join(__dirname, "demo", "mesh-story.json"), "utf8")), SS = NFN.story, S_st = STORY.story,
    S_h = SS.hops(S_st), S_b = SS.bins(S_h, 600, S_st.from, S_st.to), S_sp = SS.spikes(S_b);
eq("every hop of every client is read", S_h.length, S_st.trails.reduce(function (t, c) { return t + c.hops.length; }, 0));
if (!(S_h.every(function (h, i) { return i === 0 || h.ts >= S_h[i - 1].ts; }))) { fails++; console.log("  FAIL hops should come out in time order"); }
n++;
eq("two days in ten minute bins, plus the bin the window ends in", S_b.length, 289);
eq("the bins cover every hop", S_b.reduce(function (t, b) { return t + b.n; }, 0), S_h.length);
eq("two spikes: the channel move and the reboot", S_sp.length, 2);
var S_ex = S_sp.map(function (sp) { return SS.explain(sp, S_st.events, 600); });
if (!S_ex.some(function (e) { return e.kind === "channel"; }) || !S_ex.some(function (e) { return e.kind === "reboot"; })) { fails++; console.log("  FAIL each spike should be pinned on its cause: " + S_ex.map(function (e) { return e.kind; })); }
n++;
eq("a quiet bin has nothing to explain", SS.explain({ ts: S_st.from + 40 * 3600, clients: 1, n: 1, joins: 0, slow: 0 }, S_st.events, 600).kind, "unexplained");
var S_g = SS.graph(STORY.aps, STORY.pathloss);
eq("one node per live radio", S_g.nodes.length, STORY.aps.reduce(function (t, a) { return t + a.radios.filter(function (r) { return r.status !== "Down"; }).length; }, 0));
eq("edges only where a loss was measured on that band: two on 5 GHz, one on 2.4", S_g.edges.length, 3);
if (!S_g.edges.every(function (e) { return e.a < e.b && e.loss > 0; })) { fails++; console.log("  FAIL edges should be ordered pairs with a positive loss"); }
n++;
eq("the demo's three 5 GHz radios all sit on 149: the two pairs that hear each other share air", S_g.cochannel, 2);
var S_n5 = S_g.nodes.filter(function (x) { return x.band === "5"; }), S_w = SS.whatIf(S_g, S_n5[1].id, 36, 80);
eq("moving the middle radio to 36 clears both pairs", S_w.cochannel, 0);
eq("what-if leaves the original alone", S_g.cochannel, 2);
eq("2.4 GHz channels 1 and 3 overlap, 1 and 6 do not", SS.overlap({ band: "2.4", channel: 1 }, { band: "2.4", channel: 3 }) + "/" + SS.overlap({ band: "2.4", channel: 1 }, { band: "2.4", channel: 6 }), "true/false");
eq("an 80 MHz block on 149 covers 157", SS.overlap({ band: "5", channel: 149, bw: 80 }, { band: "5", channel: 157, bw: 20 }), true);
eq("36 at 20 MHz and 44 at 20 MHz are apart", SS.overlap({ band: "5", channel: 36, bw: 20 }, { band: "5", channel: 44, bw: 20 }), false);
var S_rf = Object.keys(S_st.rf).map(function (k) { return S_st.rf[k]; }), S_micro = S_rf.filter(function (r) { return r.ap === STORY.aps[0].name && r.band === "2.4"; })[0], S_wx = SS.weather(S_micro.samples, 0);
eq("48 hours straddle three UTC days", S_wx.rows.length, 3);
eq("the median floor is the quiet one", S_wx.median, -97);
eq("the microwave hour is the one loud hour", S_wx.loudHours, 1);
eq("the busiest hour is the evening", S_wx.busiest.hour >= 18 && S_wx.busiest.hour < 20, true);
var S_act = SS.actual(S_st, STORY.aps);
eq("one actual row per AP", S_act.aps.length, 3);
if (!S_act.aps.every(function (a) { return a.meanMbps > 0 && a.peakMbps >= a.meanMbps; })) { fails++; console.log("  FAIL mean traffic should be positive and under the peak"); }
n++;
near("bytes per five minutes become megabits per second", S_act.aps[0].meanMbps, (function () { var smp = S_st.usage[STORY.aps[0].serial].samples, t = 0, c = 0; for (var i = 1; i < smp.length; i++) { t += (smp[i].tx_bytes + smp[i].rx_bytes) * 8 / 300 / 1e6; c++; } return t / c; })(), 1e-9);
eq("the restless watch tops the client list", SS.clients(S_st)[0].name, "Demo-Watch");

/* a measured path loss, the number AirMatch reports, replaces the model too */
var LP0 = NFN.mesh.link(A0, B0, { tworay: false }, [], []), LP = NFN.mesh.link(A0, B0, { tworay: false }, [], [], { pl: LP0.plModel + 10 });
eq("a measured loss counts as a measurement", LP.measured, true);
near("the modelled loss is the budget's loss", LP0.plModel, LP0.fspl + LP0.diffraction, 0.001);
near("10 dB more loss is 10 dB less signal", LP.prx, LP0.prx - 10, 0.001);
near("the loss read is kept", LP.plMeas, LP0.plModel + 10, 0.001);
eq("an RSSI measurement has no loss to show", LM.plMeas, null);
var calP = Object.assign({}, cal, { meas: { "0-1": { pl: NFN.mesh.link({ x: 0, y: 0, h: 3, aim: 0 }, { x: 150, y: 0, h: 3, aim: 180 }, { tworay: false, tx: 20 }).plModel + 8 } } });
near("a loss 8 dB over the model teaches the same correction", NFN.mesh.plan(calP).tree.links[1][2].calib, -4, 0.01);

/* ── the twenty: the site ──────────────────────────────────────────────── */
var site = { aps: [{ x: 50, y: 100, h: 3, gw: true }, { x: 250, y: 100, h: 3 }, { x: 450, y: 100, h: 3, gw: true }, { x: 650, y: 100, h: 3 }],
             w: 700, d: 200, tx: 20, tworay: false, uplink: 200, clients: 100, app: "web" };
var SP = NFN.mesh.plan(site);
eq("two portals get two channels", SP.channels.distinct, 2);
eq("a point sits on its portal's channel", SP.aps[1].channel, SP.aps[0].channel);
eq("and the other on the other", SP.aps[3].channel, SP.aps[2].channel);
var SPp = NFN.mesh.plan(Object.assign({}, site, { aps: site.aps.map(function (a) { return a.gw ? Object.assign({}, a, { ch: 42 }) : a; }) }));
eq("pinning both portals on one channel", SPp.channels.distinct, 1);
if (!(SPp.aps[1].cci > SP.aps[1].cci)) { fails++; console.log("  FAIL sharing a channel should cost air: " + SP.aps[1].cci + " -> " + SPp.aps[1].cci); }
n++;
if (!(SPp.aps[1].backhaul < SP.aps[1].backhaul)) { fails++; console.log("  FAIL and that air should come off the backhaul"); }
n++;
var crowdSite = Object.assign({}, site, { clients: 0, crowds: [{ x: 640, y: 120, r: 30, n: 200 }] });
var SC = NFN.mesh.plan(crowdSite);
near("a crowd joins the AP standing in it", SC.aps[3].clients, 200, 1);
near("and nobody else gets them", SC.aps[1].clients, 0, 0.001);
var far = NFN.mesh.plan(Object.assign({}, site, { clients: 0, crowds: [{ x: 350, y: 195, r: 5, n: 50 }], clientTarget: -55 }));
if (!(far.who.unserved > 40)) { fails++; console.log("  FAIL a crowd nobody reaches should be counted unserved: " + far.who.unserved); }
n++;
near("the festival curve peaks at nine", NFN.mesh.crowdFactor({ tod: 21, curve: "festival" }), 1, 0.001);
var mid = NFN.mesh.plan(Object.assign({}, site, { tod: 12, curve: "festival" }));
if (!(mid.clients < 20)) { fails++; console.log("  FAIL midday at a festival should be quiet: " + mid.clients); }
n++;
var two = NFN.mesh.plan(Object.assign({}, site, { aps: site.aps.map(function (a, k) { return k === 0 ? Object.assign({}, a, { kind: "tri", ant: "pnarrow", cant: "omni", aim: 0 }) : a; }) }));
eq("a tri radio box carries a client antenna of its own", two.aps[0].clientAntenna.label, "Omni");
eq("beside its backhaul patch", two.aps[0].antenna.label, "Narrow patch");
var ct = NFN.mesh.contour(two.tree.aps[0], Object.assign({}, two.tree.aps[0].C || {}, { tx: 20 }), "open", 8);
near("so its footprint is still round", ct[0].r, ct[4].r, 0.001);

/* ── the twenty: advice ────────────────────────────────────────────────── */
var SG2 = NFN.mesh.suggestPortal(Object.assign({}, site, { aps: site.aps.map(function (a) { return Object.assign({}, a, { gw: false }); }) }));
if (!(SG2.single && SG2.single.i >= 0)) { fails++; console.log("  FAIL the portal advisor should name a mast"); }
n++;
var lowSite = Object.assign({}, site, { aps: site.aps.map(function (a) { return Object.assign({}, a, { h: 0.8 }); }) });
var SH = NFN.mesh.suggestHeights(lowSite, NFN.mesh.plan(lowSite));
if (!(SH.length > 0 && SH[0].up > 0)) { fails++; console.log("  FAIL 0.8 m masts over 200 m should be told to go up"); }
n++;
var R2 = NFN.mesh.resilience(site, true);
eq("lose two tries every pair", R2.pairsTried, 6);
if (!(R2.pairs[0].orphans.length >= R2.pairs[R2.pairs.length - 1].orphans.length)) { fails++; console.log("  FAIL pairs should be worst first"); }
n++;
var S2 = NFN.mesh.secondPortal(Object.assign({}, site, { aps: site.aps.map(function (a, k) { return Object.assign({}, a, { gw: k === 0 }); }) }));
if (!(S2.best && S2.best.orphans <= S2.now)) { fails++; console.log("  FAIL a second portal should not make the sweep worse"); }
n++;
var EX = NFN.mesh.explain(site, SP, 1, 3);
if (!(EX.link && EX.why.length > 5)) { fails++; console.log("  FAIL explain should say why 2 to 4 was not used"); }
n++;
var WK = NFN.mesh.walk(site, SP, [{ x: 50, y: 150 }, { x: 650, y: 150 }], 50);
eq("a 600 m walk at 50 m steps is thirteen readings", WK.length, 13);
eq("that starts on the first AP", WK[0].ap, 0);
eq("and ends on the last", WK[WK.length - 1].ap, 3);

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

/* ── real boxes ────────────────────────────────────────────────────────── */
eq("the catalogue has the outdoor Wi-Fi 6 family", ["AP-565", "AP-567", "AP-574", "AP-575", "AP-577", "AP-584", "AP-585", "AP-587"].every(function (k) { return !!NFN.aps.model(k); }), true);
near("an AP-575 wears its own 5 dBi omni", NFN.mesh.ANTENNAS[NFN.aps.antennaFor("AP-575", 5)].g, 5, 0.001);
eq("an AP-577 wears a 90 degree directional", NFN.mesh.ANTENNAS[NFN.aps.antennaFor("AP-577", 5)].h, 90);
eq("a connectorised box leaves the antenna to the user", NFN.aps.antennaFor("AP-574", 5), null);
var mAP = { aps: [{ x: 0, y: 0, h: 3, gw: true, model: "AP-575" }, { x: 250, y: 0, h: 3, model: "AP-575", tx: 30 }], w: 300, d: 100, tx: 30, tworay: false, uplink: 100, clients: 40 };
var MP2 = NFN.mesh.plan(mAP);
near("a model caps the power at its conducted ceiling", MP2.aps[1].link.tx, 28, 0.001);
eq("and sets the streams", MP2.aps[1].link.ss, 4);
eq("a tri band box has a radio to spare", NFN.mesh.kind({ model: "AP-675" }, {}).dedicated, true);
eq("a dual radio box has not", NFN.mesh.kind({ model: "AP-575" }, {}).dedicated, false);
var mOld = NFN.mesh.plan(Object.assign({}, mAP, { aps: mAP.aps.map(function (a) { return Object.assign({}, a, { model: "AP-375" }); }) }));
eq("a Wi-Fi 5 box rates at 802.11ac", mOld.aps[1].link.std, "ac");
eq("unverified rows say so", NFN.aps.model("AP-375").verified, false);
eq("a 5 GHz only box cannot link on 6 GHz", NFN.mesh.plan(Object.assign({}, mAP, { fGHz: 6.0 })).aps[1].status, "unreachable");

/* ── a Google Earth drawing ────────────────────────────────────────────── */
var kmlSite = NFN.kml.toSite(NFN.kml.parse(fs.readFileSync(path.join(__dirname, "demo", "mesh-test.kml"), "utf8")));
eq("two placemarks become masts", kmlSite.aps.length, 2);
eq("the one named portal is the portal", kmlSite.aps[0].gw, true);
near("a height in the name is the mast height", kmlSite.aps[0].h, 5, 0.001);
near("a relative altitude is a mast height too", kmlSite.aps[1].h, 4, 0.001);
eq("an extruded polygon is a building", kmlSite.obstacles[0].type, "building");
near("at its extruded height", kmlSite.obstacles[0].h, 8, 0.001);
eq("a crowd by name with its headcount", kmlSite.crowds[0].n, 800);
eq("a path is the walk", kmlSite.path.length, 3);
if (!(kmlSite.overlay && kmlSite.overlay.w > 300)) { fails++; console.log("  FAIL the ground overlay should carry its bounds"); }
n++;
/* 0.003 degrees of latitude is 332 m, so the field is that plus the margins */
near("degrees became metres", kmlSite.overlay.d, 0.003 * 110574, 0.5);

/* ── an Ekahau project ─────────────────────────────────────────────────── */
eq("antenna names: an internal omni", NFN.esx.antennaFor("Aruba AP-635 Internal 5 GHz"), "omni");
eq("antenna names: a 70 degree sector", NFN.esx.antennaFor("ANT-3x3-5712 sector 70 deg"), "pwide");
eq("antenna names: a 30 degree sector", NFN.esx.antennaFor("Sector 30° 5 GHz"), "pnarrow");
eq("antenna names: a dish", NFN.esx.antennaFor("PtP dish 5 GHz"), "dish");
var esxBuf = fs.readFileSync(path.join(__dirname, "demo", "mesh-test.esx")), esxAb = esxBuf.buffer.slice(esxBuf.byteOffset, esxBuf.byteOffset + esxBuf.byteLength);
eq("the zip lists its entries", NFN.esx.entries(esxAb).length, 10);
NFN.esx.project(esxAb).then(function (pj) {
  eq("the project has a floor", pj.floors.length, 1);
  near("the floor is metres wide", pj.floors[0].w, 700, 0.001);
  eq("only the surveyor's own APs come across", pj.floors[0].aps.length, 2);
  near("positions are in metres", pj.floors[0].aps[0].x, 70, 0.001);
  near("Ekahau's up is the planner's minus 90", pj.floors[0].aps[1].aim, -90, 0.001);
  eq("two 20 MHz channels is a 40 MHz radio", pj.floors[0].aps[0].width, 40);
  /* Ekahau's own pieces: measured planes, walls, the requirement */
  eq("the requirement comes across", pj.requirement.primary, -65);
  eq("with its secondary", pj.requirement.secondary, -67);
  eq("an antenna type with planes is offered", pj.antennas.length, 1);
  var pid = NFN.mesh.registerPattern("esx:t1", "test ceiling omni", 5, pj.antennas[0].hplane, pj.antennas[0].eplane, 0, false);
  near("the measured pattern peaks 30 degrees down", NFN.mesh.gainToward({ ant: pid, aim: 0 }, 0, -30, {}), 5, 0.5);
  if (!(NFN.mesh.gainToward({ ant: pid, aim: 0 }, 0, 90, {}) < NFN.mesh.gainToward({ ant: pid, aim: 0 }, 0, -30, {}) - 6)) { fails++; console.log("  FAIL straight up should be well down on the peak"); }
  n++;
  eq("a wall segment comes across in metres", pj.floors[0].walls.length, 1);
  near("brick is 33.33 dB/m times 0.3 m, the 10 dB in its name", pj.floors[0].walls[0].db, 10, 0.01);
  var wl = pj.floors[0].walls, cross = NFN.mesh.wallsCrossed(100, 175, 500, 175, wl), miss = NFN.mesh.wallsCrossed(100, 175, 250, 175, wl);
  eq("a path through the wall pays for it", cross.n, 1); near("ten dB", cross.db, 10, 0.01); eq("a path that stops short does not", miss.n, 0);
  var wsite = { aps: [{ x: 100, y: 175, h: 3, gw: true }, { x: 500, y: 175, h: 3 }], w: 700, d: 350, tx: 20, tworay: false, uplink: 100, clients: 20, walls: wl };
  var wp1 = NFN.mesh.plan(wsite), wp0 = NFN.mesh.plan(Object.assign({}, wsite, { walls: [] }));
  near("the link loses the wall's ten dB", wp0.aps[1].link.prx - wp1.aps[1].link.prx, 10, 0.01);
  if (!(wp1.coverage <= wp0.coverage)) { fails++; console.log("  FAIL a wall should not add coverage"); }
  n++;
  if (!(wp0.coverage2 <= wp0.coverage)) { fails++; console.log("  FAIL secondary coverage cannot beat primary"); }
  n++;
  finish();
}).catch(function (e) { fails++; n++; console.log("  FAIL reading the esx: " + e.message); finish(); });

function finish() {
  console.log((fails ? "FAILED " : "ok  ") + (n - fails) + "/" + n + " model checks");
  process.exit(fails ? 1 : 0);
}
