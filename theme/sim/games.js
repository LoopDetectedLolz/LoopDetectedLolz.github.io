/* NFN.games: levels and scores for the Academy's games. Every level comes from a
   seed, every score from the models in this folder, and nothing here draws.
   Three games:
     guess   two points, a distance, maybe a wall: say the dBm. Lesson 1's own
             numbers first, then random distances, then walls.
     fix     a frame is failing; three moves to get it through with the least
             time on air. Drop the rate, narrow the channel, walk the client in,
             open a wall, put up a better antenna.
     chan    radios joined by the loss between them; give every radio a channel so
             no pair that hears the other shares air, using the fewest channels. */
(function () {
  "use strict";
  var G = NFN.games = {}, RF = NFN.rf, PHY = NFN.phy, MAC = NFN.mac;
  function pick(r, list) { return list[Math.floor(r() * list.length)]; }
  /* mulberry32's first few draws from a small seed sit near the middle; mix the
     seed and throw the first draws away so seed 11 spreads like seed 11 million */
  function rng(seed) { var r = NFN.rng((Math.imul((seed >>> 0) + 1, 2654435761) ^ 0x9E3779B9) >>> 0), i; for (i = 0; i < 6; i++) r(); return r; }
  function round(x, q) { return Math.round(x / q) * q; }

  /* ── guess the signal ──────────────────────────────────────────────────── */
  G.GUESS = { tx: 20, gt: 5, gr: 2, f: 5.2 };
  G.guess = {
    /* round i of a level with this seed. Rounds 0..3 are the lesson's 2, 4, 8, 16 m in
       free space; 4..7 random distances; 8 onward add a wall. The truth is the same
       budget the simulator uses: transmit + gains - free space - walls. */
    round: function (seed, i) {
      var r = rng((seed >>> 0) * 1000 + i), P = G.GUESS, d, wall = null, model = "free";
      if (i < 4) d = [2, 4, 8, 16][i];
      else if (i < 8) d = round(3 + r() * 57, 1);
      else { d = round(3 + r() * 27, 1); wall = pick(r, ["drywall", "glass", "wood", "cinder", "brick", "concrete"]); }
      var loss = RF.fspl(d, P.f) + (wall ? RF.WALLS[wall] : 0), rssi = P.tx + P.gt + P.gr - loss;
      return { i: i, d: d, wall: wall, wallDb: wall ? RF.WALLS[wall] : 0, f: P.f, tx: P.tx, gt: P.gt, gr: P.gr, fspl: RF.fspl(d, P.f), rssi: rssi, model: model,
               hint: i === 0 ? "Free space at 1 m and 5.2 GHz is 46.8 dB, and every doubling of distance costs 6 dB." : i < 4 ? "Twice the distance, 6 dB less." : wall ? "Walls are a flat charge on top of the distance." : "20 log of the distance: ten times the distance is 20 dB." };
    },
    /* points for a guess: 3 within a dB, 2 within 3, 1 within 6, nothing past that;
       the streak multiplies (capped at three) so a run of good answers pays */
    score: function (guess, truth, streak) {
      var err = Math.abs(guess - truth), pts = err <= 1 ? 3 : err <= 3 ? 2 : err <= 6 ? 1 : 0;
      return { err: err, points: pts * Math.min(3, 1 + (streak || 0)), streak: pts ? (streak || 0) + 1 : 0, verdict: pts === 3 ? "within a dB" : pts === 2 ? "within 3 dB" : pts === 1 ? "within 6 dB" : "off by " + err.toFixed(0) + " dB" };
    },
    ROUNDS: 12
  };

  /* ── fix the link ──────────────────────────────────────────────────────── */
  G.FIX = { tx: 20, gr: 2, f: 5.2, nf: 7, bytes: 1500, agg: 1 };
  G.fix = {
    ANT: [{ id: "omni", label: "omni", g: 2 }, { id: "patch", label: "patch", g: 8 }, { id: "panel", label: "narrow panel", g: 14 }],
    MOVES: {
      "mcs-":    { label: "Drop one MCS",         text: "a lower rate needs less SNR and costs more airtime" },
      "bw-":     { label: "Halve the width",      text: "half the channel is 3 dB less noise and half the rate" },
      "client-": { label: "Walk the client in",   text: "a fifth of the distance off is about 2 dB back" },
      "wall-":   { label: "Open a wall",          text: "the loss of the nearest wall comes straight back" },
      "ant+":    { label: "A better antenna",     text: "the next antenna up: more gain, narrower beam" }
    },
    /* a level: a link that fails at the rate it is set to. The player has 3 moves. */
    level: function (seed) {
      var r = rng(seed), P = G.FIX, walls = [], n = Math.floor(r() * 3), i;
      for (i = 0; i < n; i++) walls.push(pick(r, ["drywall", "wood", "cinder", "brick"]));
      var st = { std: pick(r, ["ac", "ax"]), ss: pick(r, [1, 2]), bw: pick(r, [40, 80]), d: round(12 + r() * 40, 1), walls: walls, ant: 0, mcs: 0 };
      /* set the rate two or three steps above what the link can hold, so it fails */
      var snr = G.fix.snr(st), holds = Math.max(0, PHY.mcsFor(st.std, snr));
      st.mcs = Math.min(PHY.maxMcs(st.std), holds + 2 + Math.floor(r() * 2));
      if (st.mcs <= holds) st.mcs = Math.min(PHY.maxMcs(st.std), holds + 1);
      return { seed: seed, start: st, moves: 3 };
    },
    snr: function (st) {
      var P = G.FIX, ant = G.fix.ANT[st.ant];
      return P.tx + ant.g + P.gr - RF.logDistance(st.d, P.f, 3) - RF.wallLoss(st.walls) - RF.noiseFloor(st.bw, P.nf);
    },
    /* does it get through, and how long does it take on air with the retries that SNR implies */
    judge: function (st) {
      var snr = G.fix.snr(st), need = PHY.SNRMIN[st.mcs], margin = snr - need,
          ok = margin >= 0,
          /* a link right at the edge retries; every dB of margin under 6 costs 5 percent */
          retry = ok ? NFN.clamp(0.3 - margin * 0.05, 0, 0.3) : 0.9,
          us = MAC.txopWithRetries({ std: st.std, mcs: st.mcs, ss: st.ss, bw: st.bw, bytes: G.FIX.bytes, agg: G.FIX.agg, retry: retry });
      return { snr: snr, need: need, margin: margin, ok: ok, retry: retry, airtimeUs: us, rateMbps: PHY.rate(st.std, st.mcs, st.ss, st.bw) };
    },
    apply: function (st, move) {
      var s = { std: st.std, ss: st.ss, bw: st.bw, d: st.d, walls: st.walls.slice(), ant: st.ant, mcs: st.mcs };
      if (move === "mcs-") { if (s.mcs === 0) return null; s.mcs--; }
      else if (move === "bw-") { if (s.bw <= 20) return null; s.bw /= 2; }
      else if (move === "client-") { if (s.d <= 3) return null; s.d = round(s.d * 0.8, 0.5); }
      else if (move === "wall-") { if (!s.walls.length) return null; s.walls.pop(); }
      else if (move === "ant+") { if (s.ant >= G.fix.ANT.length - 1) return null; s.ant++; }
      else return null;
      return s;
    },
    /* the best the level allows in the moves given: least airtime among every sequence that gets through */
    best: function (level) {
      var keys = Object.keys(G.fix.MOVES), best = null;
      function walk(st, depth, path) {
        var j = G.fix.judge(st);
        if (j.ok && (!best || j.airtimeUs < best.airtimeUs)) best = { airtimeUs: j.airtimeUs, path: path.slice(), state: st };
        if (depth === 0) return;
        keys.forEach(function (k) { var s2 = G.fix.apply(st, k); if (s2) { path.push(k); walk(s2, depth - 1, path); path.pop(); } });
      }
      walk(level.start, level.moves, []);
      return best;
    },
    /* score: 100 at the best airtime, falling with the ratio; nothing if the frame never got through */
    score: function (level, final) {
      var j = G.fix.judge(final), b = G.fix.best(level);
      if (!j.ok || !b) return { points: 0, ok: j.ok, airtimeUs: j.airtimeUs, bestUs: b ? b.airtimeUs : null, bestPath: b ? b.path : null };
      return { points: Math.round(100 * Math.min(1, b.airtimeUs / j.airtimeUs)), ok: true, airtimeUs: j.airtimeUs, bestUs: b.airtimeUs, bestPath: b.path };
    }
  };

  /* ── the channel puzzle ────────────────────────────────────────────────── */
  G.chan = {
    /* n radios scattered over a field with walls between some of them; the loss
       between each pair from log distance plus a wall or two. A pair "hears" when
       the loss is under hearDb. Channels come from the domain's list. */
    level: function (seed, n, bw, dfs) {
      var r = rng(seed), pts = [], i, j, edges = [];
      n = n || 5; bw = bw || 40;
      for (i = 0; i < n; i++) pts.push({ id: "R" + (i + 1), x: round(20 + r() * 160, 1), y: round(20 + r() * 100, 1) });
      for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
        var d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y), walls = Math.floor(r() * 3),
            loss = RF.logDistance(d, 5.2, 3) + walls * 6;
        edges.push({ a: pts[i].id, b: pts[j].id, d: d, loss: loss, hears: loss <= 95 });
      }
      return { seed: seed, nodes: pts, edges: edges, bw: bw, channels: NFN.channels.list("5", bw, !!dfs, "us"), dfs: !!dfs, hearDb: 95 };
    },
    /* assignment: { R1: 36, ... }. Pairs that hear each other and share a channel are the fault. */
    check: function (level, assign) {
      var bad = level.edges.filter(function (e) { return e.hears && assign[e.a] !== undefined && assign[e.a] !== null && assign[e.a] === assign[e.b]; }),
          used = {}, missing = level.nodes.filter(function (nd) { return assign[nd.id] === undefined || assign[nd.id] === null; }).length;
      level.nodes.forEach(function (nd) { if (assign[nd.id] !== undefined && assign[nd.id] !== null) used[assign[nd.id]] = 1; });
      return { conflicts: bad, used: Object.keys(used).length, missing: missing, solved: !bad.length && !missing };
    },
    /* the fewest channels that can do it: greedy by degree, then a check that it is a proper colouring */
    fewest: function (level) {
      var deg = {}, order, assign = {};
      level.nodes.forEach(function (nd) { deg[nd.id] = 0; });
      level.edges.forEach(function (e) { if (e.hears) { deg[e.a]++; deg[e.b]++; } });
      order = level.nodes.map(function (nd) { return nd.id; }).sort(function (a, b) { return deg[b] - deg[a]; });
      order.forEach(function (id) {
        var taken = {};
        level.edges.forEach(function (e) { if (!e.hears) return; if (e.a === id && assign[e.b] !== undefined) taken[assign[e.b]] = 1; if (e.b === id && assign[e.a] !== undefined) taken[assign[e.a]] = 1; });
        var c = level.channels.filter(function (ch) { return !taken[ch]; })[0];
        assign[id] = c === undefined ? null : c;
      });
      var chk = G.chan.check(level, assign);
      return { assign: assign, used: chk.used, solvable: chk.solved };
    },
    /* score: solved with the fewest is 100; each extra channel costs 20; unsolved is 0 */
    score: function (level, assign) {
      var chk = G.chan.check(level, assign), few = G.chan.fewest(level);
      if (!chk.solved) return { points: 0, conflicts: chk.conflicts.length, used: chk.used, fewest: few.used, solvable: few.solvable };
      return { points: Math.max(0, 100 - 20 * Math.max(0, chk.used - few.used)), conflicts: 0, used: chk.used, fewest: few.used, solvable: few.solvable };
    }
  };
})();
