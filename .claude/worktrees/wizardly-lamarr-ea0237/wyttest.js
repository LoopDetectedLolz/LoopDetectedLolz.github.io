/* Headless checks for Wait Your Turn, lesson 5's game. node wyttest.js [path/to/theme/sim]
   Loads the engine out of the widget itself when it exists, so what is tested
   is what ships. With the site's model files alongside, it also proves the
   game's airtime and timings still match theme/sim/phy.js and mac.js. */
var fs = require("fs"), path = require("path");
var here = __dirname, simDir = process.argv[2] || path.join(here, "theme", "sim");
var src = fs.readFileSync(path.join(here, "theme", "widgets", "waityourturn.html"), "utf8");
var m = /\/\* ENGINE START[\s\S]*?\/\* ENGINE END \*\//.exec(src);
if (!m) { console.error("no engine block found"); process.exit(1); }
var W = new Function(m[0] + "; return WYT;")();
var fails = 0, n = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log("FAIL " + msg); } }
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, msg + " (" + a + " vs " + b + ")"); }

/* 1. parity with the site's model, when it is there to compare against */
if (fs.existsSync(path.join(simDir, "phy.js"))) {
  ["core.js", "phy.js", "mac.js"].forEach(function (f) { new Function(fs.readFileSync(path.join(simDir, f), "utf8"))(); });
  var P = globalThis.NFN.phy, M = globalThis.NFN.mac;
  [{ std: "ax", mcs: 11, ss: 2, bw: 80 }, { std: "ax", mcs: 2, ss: 1, bw: 80 }, { std: "ax", mcs: 7, ss: 2, bw: 20 },
   { std: "a", mcs: 0, ss: 1, bw: 20 }, { std: "a", mcs: 4, ss: 1, bw: 20 }].forEach(function (r) {
    [1, 16, 64].forEach(function (agg) { [64, 200, 1200, 1500].forEach(function (b) {
      var a = r.std === "a" ? 1 : agg;
      near(W.airtime(r, b, a, "data"), P.frameAirtime({ std: r.std, mcs: r.mcs, ss: r.ss, bw: r.bw, bytes: b, agg: a }), 1e-9, "airtime " + JSON.stringify(r) + " x" + a + " " + b + "B");
    }); });
    near(W.rate(r), P.rate(r.std, r.mcs, r.ss, r.bw), 1e-9, "rate " + JSON.stringify(r));
  });
  near(W.airtime(W.legacy(6), 250, 1, "mgmt"), P.frameAirtime({ std: "a", mcs: 0, bytes: 250, agg: 1, kind: "mgmt" }), 1e-9, "beacon airtime");
  near(W.ctrl(24, 14), M.T.ACK, 0, "ACK at 24 Mb/s matches mac.js");
  near(W.ctrl(24, 32), M.T.BA, 0, "BlockAck at 24 Mb/s matches mac.js");
  near(W.T.SIFS, M.T.SIFS, 0, "SIFS"); near(W.T.SLOT, M.T.SLOT, 0, "slot");
  near(W.EDCA.sta.BE.cwmin, M.T.CWMIN, 0, "CWmin"); near(W.EDCA.sta.BE.cwmax, M.T.CWMAX, 0, "CWmax");
  near(W.T.SIFS + 2 * W.T.SLOT, M.T.DIFS, 0, "DIFS is SIFS plus two slots");
  console.log("parity with " + simDir + ": checked");
} else console.log("no theme/sim next to this folder; parity checks skipped (pass the path as an argument)");

/* 2. the numbers the lesson quotes */
var aifs = function (p) { return W.T.SIFS + p.n * W.T.SLOT; };
near(aifs(W.EDCA.sta.BE), 43, 0, "best effort waits 43 us");
near(aifs(W.EDCA.sta.VO), 34, 0, "a client's voice waits 34 us");
near(aifs(W.EDCA.ap.VO), 25, 0, "the AP's voice waits 25 us");
near(W.ctrl(6, 14), 44, 0, "an ACK at 6 Mb/s is 44 us");
var fast = { std: "ax", mcs: 11, ss: 2, bw: 80 }, slow = W.legacy(6);
var turn = function (air, resp) { return 43 + 7.5 * 9 + air + 16 + resp; };
near(W.airtime(slow, 1500, 1), 2096, 0, "a 1500-byte frame at 6 Mb/s is 2096 us");
near(turn(W.airtime(fast, 1500, 1), 28), 218.5, 1e-9, "one packet per turn at 1201 Mb/s: 218.5 us");
near(W.airtime(fast, 1500, 64), 716.8, 1e-6, "64-deep A-MPDU at 1201 Mb/s: 716.8 us");

/* 3. the engine against its own arithmetic: one busy station alone, then the anomaly */
function alone(r, agg) {
  var s = new W.Sim({ seed: 1, ssids: 0, nodes: [{ id: "a", name: "A", rate: r, agg: agg, holds: 54 }], flows: [{ node: "a", dir: "up", type: "sat" }] });
  return s.run(2e6);
}
near(alone(fast, 64).flows[0].mbps, 64 * 12000 / turn(W.airtime(fast, 1500, 64), 32), 6, "alone, 64 deep, matches the arithmetic");
near(alone(fast, 1).flows[0].mbps, 12000 / turn(W.airtime(fast, 1500, 1), 28), 0.6, "alone, one packet a turn, matches the arithmetic");
var an = new W.Sim({ seed: 1, ssids: 0, nodes: [{ id: "a", name: "A", rate: fast, agg: 64, holds: 54 }, { id: "s", name: "S", role: "slow", rate: slow, agg: 1, holds: 6 }],
  flows: [{ node: "a", dir: "up", type: "sat" }, { node: "s", dir: "up", type: "sat" }] }).run(3e6);
ok(an.air.slow > 0.5, "the 6 Mb/s station holds more than half the air (" + an.air.slow.toFixed(2) + ")");
ok(an.flows[0].mbps < 0.35 * alone(fast, 64).flows[0].mbps, "the fast station keeps under a third of what it had alone (" + an.flows[0].mbps.toFixed(0) + " Mb/s)");

/* 4. determinism */
var r1 = new W.Sim(W.LEVELS[1].room(2)).run(35000, W.policy.human(5, 0.35, 3));
var r2 = new W.Sim(W.LEVELS[1].room(2)).run(35000, W.policy.human(5, 0.35, 3));
ok(JSON.stringify(r1) === JSON.stringify(r2), "same seed, same timing, same result");

/* 5. the levels play the way the lesson says they do */
function play(li, seed, pol) {
  var l = W.LEVELS[li], s = new W.Sim(l.room(seed)), froze = 0;
  while ((l.bell ? s.t - s.t0 < l.bell : true) && s.me.ok < (l.bell ? 1000 : l.goal)) {
    pol(s); var before = s.me.bo, ev = s.step();
    if (ev.type === "tx" && before > 0 && ev.seg.parts.every(function (p) { return p.node !== "you"; })) froze++;
  }
  return { ok: s.me.ok, froze: froze };
}
var humans = [], h;
for (h = 1; h <= 40; h++) humans.push((function (h) { return function (sd) { return W.policy.human(h * 977 + sd, 0.35, 3); }; })(h));
for (h = 1; h <= 20; h++) humans.push((function (h) { return function (sd) { return W.policy.human(h * 131 + sd, 0.7, 5); }; })(h));
W.LEVELS[0].seeds.forEach(function (sd) {
  var r = play(0, sd, W.policy.radio);
  ok(r.ok === 5 && r.froze >= 1, "level 1 seed " + sd + ": five frames and at least one freeze to show");
});
W.LEVELS[1].seeds.forEach(function (sd) {
  var worst = Infinity; humans.forEach(function (mk) { worst = Math.min(worst, play(1, sd, mk(sd)).ok); });
  ok(worst >= W.LEVELS[1].goal, "level 2 seed " + sd + ": every human timing reaches " + W.LEVELS[1].goal + " (worst " + worst + ")");
});
W.LEVELS[2].seeds.forEach(function (sd) {
  var best = play(2, sd, W.policy.radio).ok, worst = best;
  humans.forEach(function (mk) { var x = play(2, sd, mk(sd)).ok; best = Math.max(best, x); worst = Math.min(worst, x); });
  ok(best <= W.LEVELS[2].goal - 4, "level 3 seed " + sd + ": nobody gets near " + W.LEVELS[2].goal + " (best " + best + ")");
  ok(worst >= 2, "level 3 seed " + sd + ": the player still sees a couple through (worst " + worst + ")");
});

/* 6. the engineer's level: exactly one kind of answer wins, and each wrong one fails for its own reason */
var L4 = W.LEVELS[3], wins = [];
function judge(kn) { var s = new W.Sim(L4.room(L4.seeds[0], kn)); var rep = s.run(L4.evalUs); return { rep: rep, j: W.judge(rep) }; }
["normal", "voice"].forEach(function (qos) { ["flood", "filter"].forEach(function (mc) { [6, 12, 24].forEach(function (min) {
  for (var ss = 1; ss <= 8; ss++) { var r = judge({ ssids: ss, min: min, mc: mc, qos: qos }); if (r.j.all) wins.push([ss, min, mc, qos].join("/")); }
}); }); });
ok(wins.join(" ") === "1/12/filter/normal 2/12/filter/normal 3/12/filter/normal 4/12/filter/normal", "level 4 winners are min 12, filtered, four SSIDs or fewer: " + wins.join(" "));
var j6 = judge({ ssids: 4, min: 6, mc: "filter", qos: "normal" }).j;
ok(j6.scanner.home && !j6.call.ok, "at 6 Mb/s the scanner stays and the call breaks");
var j24 = judge({ ssids: 4, min: 24, mc: "filter", qos: "normal" }).j;
ok(!j24.phone.connected && !j24.phone.ok, "at 24 Mb/s the desk phone drops");
var jf = judge({ ssids: 4, min: 12, mc: "flood", qos: "normal" }).j;
ok(!jf.util.ok, "the multicast flood alone breaks the headroom");
var j8 = judge({ ssids: 8, min: 12, mc: "filter", qos: "normal" }).j;
ok(!j8.util.ok && j8.call.ok && j8.phone.ok, "eight SSIDs cost exactly the headroom");
var jv = judge({ ssids: 4, min: 12, mc: "filter", qos: "voice" });
ok(!jv.j.phone.ok && jv.rep.air.coll > 0.15, "everything as voice: collisions up (" + jv.rep.air.coll.toFixed(2) + ") and the desk phone suffers");

console.log(n + " checks, " + fails + " failed");
process.exit(fails ? 1 : 0);
