/* Mesh: access points on a field, the links between them, and the one number
   none of it gets past. Every link is a real budget over real geometry: free
   space at the 3D distance, the worst knife edge on the path, and the ground
   itself when a mast is too short for the Fresnel zone. The tree is built from
   the gateways outward on airtime cost, and the capacity reaching each AP is
   split among everyone behind it. Then the uplink caps the lot. No canvas. */
(function (root) {
  var NFN = root.NFN = root.NFN || {};
  var M = NFN.mesh = {};

  /* what the ground between the masts is like. n is the path loss exponent for
     the client cell; the backhaul between masts is line of sight or it is not. */
  M.LAND = {
    open:  { label: "Open field",        n: 2.3, note: "a car park or a fairground: nearly free space" },
    trees: { label: "Scattered trees",   n: 2.8, note: "foliage between the AP and the phone" },
    town:  { label: "Streets and stalls", n: 3.2, note: "tents, trucks and people in the way" }
  };
  M.land = function (id) { return M.LAND[id] || M.LAND.open; };

  /* what an obstacle is when it is dropped on the map: height and footprint */
  M.OBSTACLES = {
    tree:     { label: "Tree line",  h: 9,  r: 6 },
    building: { label: "Building",   h: 12, r: 10 },
    truck:    { label: "Truck or stage", h: 4.5, r: 5 },
    hill:     { label: "Rise in the ground", h: 6, r: 20 }
  };

  /* antennas, the universal five. g is dBi, h and v the half power beamwidths in
     degrees, tilt the built-in down-tilt, f2b how far down the back is. Patterns
     are the cos^n fit to the beamwidth that rf.js uses everywhere else. */
  M.ANTENNAS = {
    omni:    { label: "Omni",                g: 5,  h: 360, v: 40, tilt: 0,  f2b: 0 },
    dtomni:  { label: "Down-tilt omni",      g: 5,  h: 360, v: 30, tilt: 12, f2b: 0 },
    pwide:   { label: "Wide patch",          g: 8,  h: 90,  v: 70, tilt: 0,  f2b: 20 },
    pnarrow: { label: "Narrow patch",        g: 12, h: 45,  v: 45, tilt: 0,  f2b: 25 },
    dish:    { label: "Highly directional",  g: 18, h: 15,  v: 15, tilt: 0,  f2b: 30 }
  };
  M.antenna = function (id) { return M.ANTENNAS[id] || M.ANTENNAS.omni; };
  M.isAuto = function (ap) { return !ap.ant || ap.ant === "auto" || !M.ANTENNAS[ap.ant]; };

  /* what kind of box is on the mast: whether the backhaul has its own radio, and
     whether anybody can associate to it at all */
  M.KINDS = {
    dual:   { label: "Dual radio, backhaul shares the client radio", dedicated: false, serves: true },
    tri:    { label: "Tri radio, dedicated backhaul",                dedicated: true,  serves: true },
    bridge: { label: "Bridge unit, backhaul only",                    dedicated: true,  serves: false }
  };
  M.kind = function (ap, C) {
    if (ap && ap.kind && M.KINDS[ap.kind]) return M.KINDS[ap.kind];
    return (C && C.dedicated) ? M.KINDS.tri : M.KINDS.dual;
  };

  /* defaults for an outdoor AP: a 5 GHz two stream backhaul at 40 MHz, an omni
     with a few dBi, a mast a few metres up. Change them in the tool. */
  M.DEF = {
    fGHz: 5.2, bw: 40, tx: 23, ant: "omni", ss: 2, std: "ax", nf: 7, retry: 0.1,
    margin: 6,              /* dB of SNR above the lowest rate before a link counts */
    profile: "aruba", maxHops: 4,
    clientTx: 20, clientAnt: 4, clientTarget: -67, clientBw: 20, clientF: 5.2,
    dedicated: false,       /* a second radio for the backhaul, or the client radio doing both */
    /* ground reflection: magnitude of the bounce off rough ground. Off by default
       for planning: at these ranges the fade moves with a metre of mast height or
       ground, so it is a thing to show and to budget for, not to route on */
    tworay: false, rho: 0.5
  };

  /* How a vendor's mesh picks a parent, as far as a planner needs. The shapes
     come from the vendors' own documents, read 2026-09-11; the numbers inside
     them (dB per child, the ease curve) are sketches, because nobody publishes
     those. Verify against the release you run.
       Aruba AOS 8, ap mesh-radio-profile: metric-algorithm distributed-tree-rssi
       (default) picks "based on link-RSSI and node cost based on the number of
       children"; best-link-rssi picks "the parent with the strongest RSSI,
       regardless of the number of children". Path cost adds the link cost, the
       parent's path cost and the parent's node cost; a link under link-threshold
       (default 12) is penalised so "a less direct, higher quality link may be
       preferred over the marginal link". hop-count default 8, children 64.
       Cisco AWPP: adjusted ease = min(ease at each hop) / hop count, ease a
       steep spreading function of SNR; their worked example takes two hops at
       436906 over a direct link at 262144.
       Mist: single hop only, relay to base, failover to another base, no more
       than 4 relays per base recommended.
       802.11s: the airtime link metric, summed along the path. */
  M.PROFILES = {
    aruba:     { label: "Aruba: distributed-tree-rssi", metric: "rssi-tree", maxHops: null, thr: 12, nodeCost: 4,
                 note: "path cost summed to the portal: a steep cost per link by its SNR, plus a cost per child the parent carries; marginal links last" },
    arubabest: { label: "Aruba: best-link-rssi", metric: "rssi", maxHops: null, thr: 12,
                 note: "strongest link that has a path, however many children the parent has" },
    cisco:     { label: "Cisco AWPP: adjusted ease", metric: "ease", maxHops: null, thr: 12,
                 note: "the weakest link on the path sets the ease, divided by the hop count" },
    mist:      { label: "Mist: base and relay", metric: "rssi", maxHops: 1, thr: 12, maxChildren: 4,
                 note: "a relay must hear a base directly; one hop, no chaining" },
    s11:       { label: "802.11s airtime metric", metric: "airtime", maxHops: null, thr: 0,
                 note: "airtime summed along the path, which happily takes one slow direct link over two fast hops" }
  };
  M.profile = function (id) { return M.PROFILES[id] || M.PROFILES.aruba; };
  /* Cisco's spreading function is not published; this doubles the ease every
     3 dB and knocks a marginal link down hard, which reproduces the shape of
     their example: two good hops beat one middling direct link */
  M.ease = function (snr, thr) { return Math.pow(2, snr / 3) * (snr < thr ? 0.05 : 1); };
  /* Aruba's link cost is not published either. This doubles every 4 dB the link
     weakens from 50 dB, so one marginal link costs more than two good hops but
     two near-equal hops do not beat one good direct link; a link under the
     threshold costs a fortune, which is the documented "penalised to filter
     marginal links" */
  M.linkCostRssi = function (snr, thr) { return Math.pow(2, (50 - snr) / 4) + (snr < thr ? 200 : 0); };
  function cfg(c) { var o = {}, k; for (k in M.DEF) o[k] = M.DEF[k]; for (k in (c || {})) if (c[k] !== undefined) o[k] = c[k]; return o; }
  M.cfg = cfg;

  /* ── antennas pointing somewhere ───────────────────────────────────────── */
  var PAT = {};
  function pats(id) {
    if (!PAT[id]) {
      var a = M.antenna(id);
      PAT[id] = {
        h: a.h >= 360 ? function () { return 1; } : NFN.rf.patternFront(a.h, a.f2b),
        v: a.h >= 360 ? NFN.rf.patternOmni(a.v) : NFN.rf.patternFront(a.v, a.f2b),
        floor: a.f2b ? Math.pow(10, -a.f2b / 10) : 0.02
      };
    }
    return PAT[id];
  }
  var D = Math.PI / 180;
  function wrap(deg) { return ((deg + 180) % 360 + 360) % 360 - 180; }
  M.bearing = function (a, b) { return Math.atan2(b.y - a.y, b.x - a.x) / D; };
  M.apAntenna = function (ap, C) { return M.antenna(ap.ant || (C && C.ant) || "omni"); };
  M.apTx = function (ap, C) { return ap.tx === undefined ? C.tx : ap.tx; };

  /* dBi from this AP toward an azimuth (degrees, 0 is +x) and an elevation
     (degrees, positive is up). The aim is the antenna's azimuth; the built-in
     tilt points its boresight down. */
  M.gainToward = function (ap, azDeg, elDeg, C) {
    var id = ap.ant || (C && C.ant) || "omni", a = M.antenna(id), P = pats(id),
        dAz = wrap(azDeg - (ap.aim === undefined || ap.aim === null ? 0 : ap.aim)) * D,
        dEl = wrap(elDeg + a.tilt) * D;
    return a.g + 10 * Math.log10(Math.max(P.floor, P.h(dAz) * P.v(dEl)));
  };

  /* an unset aim points at the nearest other live AP, which is what an installer
     does with a patch when nobody has told them otherwise */
  M.aims = function (aps) {
    return aps.map(function (a, i) {
      if (a.aim !== undefined && a.aim !== null && isFinite(a.aim)) return a.aim;
      var best = -1, bd = Infinity, j;
      for (j = 0; j < aps.length; j++) {
        if (j === i || aps[j].down) continue;
        var dd = Math.hypot(aps[j].x - a.x, aps[j].y - a.y);
        if (dd < bd) { bd = dd; best = j; }
      }
      return best < 0 ? 0 : M.bearing(a, aps[best]);
    });
  };
  M.resolve = function (aps) {
    var aims = M.aims(aps);
    return aps.map(function (a, i) { var o = {}, k; for (k in a) o[k] = a[k]; o.aim = aims[i]; return o; });
  };

  /* signal at a phone held at chest height, x and y on the field */
  M.rssiAt = function (ap, x, y, C, land) {
    var Cc = cfg(C), n = M.land(land).n, d = Math.max(1, Math.hypot(ap.x - x, ap.y - y)),
        d3 = Math.hypot(d, ap.h - 1.2), az = M.bearing(ap, { x: x, y: y }),
        el = Math.atan2(1.2 - ap.h, d) / D;
    return M.apTx(ap, Cc) + M.gainToward(ap, az, el, Cc) - NFN.rf.logDistance(d3, Cc.clientF, n);
  };

  /* the footprint at the target level, as a radius per azimuth. This is the
     antenna's real shape on the ground, which for a patch is not a circle. */
  M.contour = function (ap, C, land, steps) {
    var Cc = cfg(C), n = M.land(land).n, out = [], k, N = steps || 72;
    for (k = 0; k < N; k++) {
      var az = k * 360 / N,
          budget = M.apTx(ap, Cc) + M.gainToward(ap, az, 0, Cc) - Cc.clientTarget - NFN.rf.fspl(1, Cc.clientF);
      out.push({ az: az, r: Math.pow(10, budget / (10 * n)) });
    }
    return out;
  };

  /* ── one link ──────────────────────────────────────────────────────────── */

  /* height of the line of sight above flat ground, t of the way from a to b,
     less the earth bulge, which is centimetres at these distances and stays in
     so the same code holds up on a long link */
  function losAt(a, b, t, d) {
    return a.h + (b.h - a.h) * t - NFN.rf.bulge(d * t, d * (1 - t));
  }

  /* two ray ground reflection: the direct path and the bounce arrive with a
     phase set by their length difference, and the bounce flips phase. rho is
     how much of it comes back off rough ground; 1 is a mirror, 0 is no bounce.
     Raising a mast moves the fade, which is the whole point of drawing it. */
  M.twoRay = function (d, h1, h2, fGHz, rho) {
    var lam = NFN.rf.lambda(fGHz),
        dd = Math.hypot(d, h1 + h2) - Math.hypot(d, h1 - h2),
        ph = 2 * Math.PI * dd / lam + Math.PI,
        r = rho === undefined ? 0.5 : rho,
        re = 1 + r * Math.cos(ph), im = r * Math.sin(ph);
    return 20 * Math.log10(Math.max(1e-3, Math.hypot(re, im)));
  };

  M.link = function (a, b, c, obstacles) {
    var C = cfg(c), dx = b.x - a.x, dy = b.y - a.y,
        d = Math.max(0.5, Math.hypot(dx, dy)),
        d3 = Math.hypot(d, b.h - a.h),
        f = C.fGHz, fspl = NFN.rf.fspl(d3, f),
        worst = { loss: 0, by: null, v: -Infinity }, i;

    /* the ground: sample the path, the Fresnel zone is widest in the middle but a
       mast much lower than the other end moves the pinch toward it */
    var clearMin = Infinity, f1mid = NFN.rf.fresnel1(d / 2, d / 2, f);
    for (i = 1; i < 12; i++) {
      var t = i / 12, d1 = d * t, d2 = d - d1,
          los = losAt(a, b, t, d), f1 = NFN.rf.fresnel1(d1, d2, f),
          ratio = los / Math.max(1e-6, f1),
          v = NFN.rf.vParam(-los, d1, d2, f), loss = NFN.rf.knifeEdge(v);
      if (ratio < clearMin) clearMin = ratio;
      if (loss > worst.loss) worst = { loss: loss, by: "ground", v: v };
    }

    /* obstacles: anything whose footprint the path crosses is a knife edge at its
       height, and the worst one on the path is the one that counts */
    (obstacles || []).forEach(function (o, idx) {
      var t = ((o.x - a.x) * dx + (o.y - a.y) * dy) / (d * d);
      if (t <= 0.02 || t >= 0.98) return;
      var px = a.x + dx * t, py = a.y + dy * t, off = Math.hypot(o.x - px, o.y - py);
      if (off > o.r) return;
      var d1 = d * t, d2 = d - d1, los = losAt(a, b, t, d),
          v = NFN.rf.vParam(o.h - los, d1, d2, f), loss = NFN.rf.knifeEdge(v);
      if (loss > worst.loss) worst = { loss: loss, by: "obstacle", idx: idx, v: v };
    });

    /* the weaker transmitter sets the rate: a link is only as fast as its slow
       direction. Each end's gain is what its antenna gives toward the other. */
    var tx = Math.min(M.apTx(a, C), M.apTx(b, C)),
        elAB = Math.atan2(b.h - a.h, d) / D,
        ga = M.gainToward(a, M.bearing(a, b), elAB, C),
        gb = M.gainToward(b, M.bearing(b, a), -elAB, C),
        ray = C.tworay ? M.twoRay(d, a.h, b.h, f, C.rho) : 0,
        prx = tx + ga + gb - fspl - worst.loss + ray,
        nf = NFN.rf.noiseFloor(C.bw, C.nf), snr = prx - nf,
        mcs = NFN.phy.mcsFor(C.std, snr - C.margin),
        phy = mcs >= 0 ? NFN.phy.rate(C.std, mcs, C.ss, C.bw) : 0,
        good = mcs >= 0 ? NFN.mac.throughput({ std: C.std, mcs: mcs, ss: C.ss, bw: C.bw, bytes: 1500, agg: 64, retry: C.retry }) / 1e6 : 0;
    return {
      d: d, d3: d3, fspl: fspl, diffraction: worst.loss, blockedBy: worst.loss > 0.5 ? worst.by : null,
      obstacle: worst.by === "obstacle" ? worst.idx : -1,
      tx: tx, tworay: ray, ga: ga, gb: gb,
      prx: prx, noise: nf, snr: snr, mcs: mcs, phyMbps: phy, goodput: good,
      f1: f1mid, clearance: clearMin,
      /* 60% of the first Fresnel zone is the rule of thumb for "clear" */
      fresnelBad: clearMin < 0.6,
      ok: mcs >= 0
    };
  };

  /* ── the tree ──────────────────────────────────────────────────────────── */

  /* Dijkstra from every gateway at once on airtime cost, the way a mesh that
     picks by link quality behaves rather than the one that just counts hops. A
     small per-hop tax breaks ties toward fewer hops. */
  M.linkCost = function (L) { return 1000 / L.goodput + 1; };   /* ms per gigabit, plus a hop */

  /* An unset aim on a patch has to point at the parent, and the parent depends
     on the aim. So: build the tree once with every auto-aimed patch standing in
     as an omni, which finds the parent the geometry wants; turn each such point
     toward that parent and each such portal toward its children; build again
     with the real patterns. Two passes is what an installer does with a phone
     and a colleague shouting. */
  M.tree = function (apsIn, c, obstacles) {
    var C = cfg(c), aps = M.resolve(apsIn), auto = [], i, j;
    for (i = 0; i < aps.length; i++) {
      var a0 = apsIn[i];
      if ((a0.aim === undefined || a0.aim === null) && M.apAntenna(a0, C).h < 360) auto.push(i);
    }
    if (!auto.length) return build(aps, C, obstacles);
    var plain = aps.map(function (a, k) { var o = {}, q; for (q in a) o[q] = a[q]; if (auto.indexOf(k) >= 0) o.ant = "omni"; return o; }),
        T0 = build(plain, C, obstacles);
    auto.forEach(function (k) {
      if (T0.parent[k] >= 0) aps[k].aim = M.bearing(aps[k], aps[T0.parent[k]]);
      else if (T0.children[k].length) {
        var sx = 0, sy = 0;
        for (j = 0; j < T0.children[k].length; j++) { var b = M.bearing(aps[k], aps[T0.children[k][j]]) * D; sx += Math.cos(b); sy += Math.sin(b); }
        aps[k].aim = Math.atan2(sy, sx) / D;
      }
    });
    return build(aps, C, obstacles);
  };

  function build(aps, C, obstacles) {
    var P = M.profile(C.profile),
        maxHops = P.maxHops === null ? Math.max(1, C.maxHops || 8) : P.maxHops,
        n = aps.length, links = [], cost = [], parent = [], depth = [], i, j;
    for (i = 0; i < n; i++) { links.push([]); cost.push(Infinity); parent.push(-1); depth.push(-1); }
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      /* a failed AP has no links: that is what failing it means */
      var L = (aps[i].down || aps[j].down) ? null : M.link(aps[i], aps[j], C, obstacles);
      links[i][j] = L; links[j][i] = L;
    }
    var gws = 0;
    for (i = 0; i < n; i++) if (aps[i].gw && !aps[i].down) { cost[i] = 0; depth[i] = 0; gws++; }

    /* does k sit under root in the current tree, so root cannot hang off it */
    function under(k, root) { var g = 0; while (k >= 0 && g++ < n + 1) { if (k === root) return true; k = parent[k]; } return false; }
    function kids(j) { var c = 0, q; for (q = 0; q < n; q++) if (parent[q] === j) c++; return c; }
    /* Aruba style path cost of j: its link, its parent's path cost, its parent's node cost */
    function pathCost(j) {
      var c = 0, k = j, g = 0;
      while (parent[k] >= 0 && g++ < n + 1) { c += M.linkCostRssi(links[k][parent[k]].snr, P.thr) + P.nodeCost * (kids(parent[k]) - 1); k = parent[k]; }
      return c;
    }
    /* the least ease on the way from j to its portal */
    function pathEase(j) {
      var e = Infinity, k = j, g = 0;
      while (parent[k] >= 0 && g++ < n + 1) { e = Math.min(e, M.ease(links[k][parent[k]].snr, P.thr)); k = parent[k]; }
      return e;
    }
    /* how good j looks to i as a parent, higher is better; -Infinity is no */
    function metric(i, j) {
      var L = links[i][j];
      if (!L || !L.ok || depth[j] < 0 || depth[j] >= maxHops || under(j, i)) return -Infinity;
      if (P.metric === "rssi") return (P.maxChildren && !under(i, j) && kids(j) - (parent[i] === j ? 1 : 0) >= P.maxChildren ? -1000 : 0) + L.snr - (L.snr < P.thr ? 40 : 0);
      if (P.metric === "rssi-tree") return -(M.linkCostRssi(L.snr, P.thr) + pathCost(j) + P.nodeCost * (kids(j) - (parent[i] === j ? 1 : 0)));
      if (P.metric === "ease") return Math.min(M.ease(L.snr, P.thr), pathEase(j)) / (depth[j] + 1);
      return -(cost[j] + M.linkCost(L));                    /* airtime: less is more */
    }
    function redepth() {
      var q, k, g;
      for (q = 0; q < n; q++) {
        if (aps[q].gw && !aps[q].down) { depth[q] = 0; cost[q] = 0; continue; }
        depth[q] = -1; cost[q] = Infinity;
        for (k = q, g = 0; parent[k] >= 0 && g <= n; k = parent[k], g++) {}
        if (k !== q && aps[k].gw && !aps[k].down && g <= n) {
          depth[q] = g;
          var cc = 0; for (k = q; parent[k] >= 0; k = parent[k]) cc += M.linkCost(links[k][parent[k]]);
          cost[q] = cc;
        }
      }
    }

    /* the way a mesh actually forms: everyone who can hear a node with a path
       attaches to the best one by the metric, then keeps looking; the picture
       settles in a few rounds. A point re-evaluates every round, so a
       neighbour that came up later can still win. */
    var round, changed;
    for (round = 0; round < n + 4; round++) {
      changed = false;
      for (i = 0; i < n; i++) {
        if ((aps[i].gw && !aps[i].down) || aps[i].down) continue;
        var best = -1, bm = -Infinity;
        for (j = 0; j < n; j++) {
          if (j === i) continue;
          var mm = metric(i, j);
          /* a sitting parent keeps its seat unless somebody is clearly better,
             which is every vendor's hysteresis in one line */
          if (j === parent[i] && mm > -Infinity) mm = P.metric === "ease" ? mm * 1.2 : P.metric === "rssi" ? mm + 1 : mm * 0.9;
          if (mm > bm) { bm = mm; best = j; }
        }
        if (best !== parent[i]) { parent[i] = best; changed = true; redepth(); }
      }
      if (!changed) break;
    }
    for (i = 0; i < n; i++) if (depth[i] < 0) parent[i] = -1;
    redepth();
    var children = [], sub = [];
    for (i = 0; i < n; i++) { children.push([]); sub.push(1); }
    for (i = 0; i < n; i++) if (parent[i] >= 0) children[parent[i]].push(i);
    /* subtree sizes, deepest first so a parent sees finished children */
    var order = [];
    for (i = 0; i < n; i++) order.push(i);
    order.sort(function (p, q) { return depth[q] - depth[p]; });
    order.forEach(function (k) { if (parent[k] >= 0) sub[parent[k]] += sub[k]; });

    /* a second parent for each point: the best other neighbour by the same
       metric that does not itself depend on this point, within the hop ceiling.
       No backup is a single point of failure, and the table says so. */
    var backup = [];
    for (i = 0; i < n; i++) {
      var bk = -1, bkm = -Infinity;
      if (depth[i] > 0) for (j = 0; j < n; j++) {
        if (j === i || j === parent[i]) continue;
        var m2 = metric(i, j);
        if (m2 > bkm) { bkm = m2; bk = j; }
      }
      backup.push(bk);
    }
    /* what the table shows for the chosen link, in the metric's own units */
    var metricOf = function (i) {
      if (depth[i] <= 0 || parent[i] < 0) return depth[i] === 0 ? "portal" : "";
      var L = links[i][parent[i]];
      if (P.metric === "airtime") return cost[i].toFixed(1) + " ms/Gb";
      if (P.metric === "ease") return "ease 2^" + (Math.log2(Math.max(1e-9, Math.min(M.ease(L.snr, P.thr), pathEase(parent[i])) / depth[i]))).toFixed(1);
      if (P.metric === "rssi-tree") return "cost " + pathCost(i).toFixed(1) + " at SNR " + L.snr.toFixed(0);
      return "SNR " + L.snr.toFixed(0);
    };
    return { links: links, parent: parent, depth: depth, children: children, subtree: sub, gateways: gws,
             backup: backup, cost: cost, metricOf: metricOf, maxHops: maxHops, profile: P, aps: aps,
             maxDepth: depth.reduce(function (m, x) { return Math.max(m, x); }, 0),
             /* a failed AP is down, not unreachable: the two are different problems */
             unreachable: depth.map(function (x, k) { return x < 0 && !aps[k].down ? k : -1; }).filter(function (x) { return x >= 0; }) };
  }

  /* ── coverage ──────────────────────────────────────────────────────────── */

  /* the reference cell: a plain omni at the default power, for the legend */
  M.cellRadius = function (c, land) {
    var C = cfg(c);
    return NFN.rf.cellRadius({ txDbm: C.tx, antDbi: M.ANTENNAS.omni.g, targetDbm: C.clientTarget,
                               fGHz: C.clientF, n: M.land(land).n, rxAntDbi: 0 });
  };

  /* share of the field where some serving AP puts the target level on a phone,
     by sampling: cheap, and honest about the holes between footprints. aps here
     are the live, reached, client-serving ones with aims resolved. */
  M.coverage = function (aps, c, land, w, dpt) {
    var C = cfg(c), cols = 40, rows = Math.max(4, Math.round(cols * dpt / w)), hit = 0, i, j, k;
    for (i = 0; i < cols; i++) for (j = 0; j < rows; j++) {
      var x = (i + 0.5) / cols * w, y = (j + 0.5) / rows * dpt, inside = false;
      for (k = 0; k < aps.length && !inside; k++) if (M.rssiAt(aps[k], x, y, C, land) >= C.clientTarget) inside = true;
      if (inside) hit++;
    }
    return hit / (cols * rows);
  };

  /* ── the plan ──────────────────────────────────────────────────────────── */

  /* st: { aps:[{x,y,h,gw}], obstacles:[{x,y,h,r}], w, d, land, uplink (Mb/s),
           clients, dev, app, radio settings as in DEF } */
  M.plan = function (st) {
    var C = cfg(st), apsIn = st.aps || [], obs = st.obstacles || [],
        T = M.tree(apsIn, C, obs), aps = T.aps, n = aps.length, i,
        land = st.land || "open",
        radius = M.cellRadius(C, land),
        serving = aps.filter(function (a, k) { return T.depth[k] >= 0 && M.kind(a, C).serves; }),
        cover = serving.length ? M.coverage(serving, C, land, st.w || 200, st.d || 140) : 0,
        clients = st.clients || 0, dev = st.dev || "ax2", app = st.app || "web",
        A = NFN.capacity.app(app),
        demand = clients * A.kbps / 1000,
        reach = serving.length,
        perAp = reach > 0 ? clients / reach : 0,
        demandAp = perAp * A.kbps / 1000,
        /* what one radio can hand its own clients, before the backhaul has a say */
        cell = reach > 0 ? NFN.capacity.group({ n: Math.max(1, Math.round(perAp)), dev: dev, app: app },
                                              { bw: C.clientBw, retry: C.retry }).goodputMbps : 0,
        rows = [], delivered = 0, worstDepth = 0;

    for (i = 0; i < n; i++) {
      var a = aps[i], K = M.kind(a, C),
          r = { i: i, gw: !!a.gw, depth: T.depth[i], parent: T.parent[i], link: null,
                kind: K, antenna: M.apAntenna(a, C), aim: a.aim, serves: K.serves,
                clients: K.serves ? perAp : 0, demand: K.serves ? demandAp : 0,
                backhaul: Infinity, delivered: 0, status: "ok", why: "", relays: 0 };
      r.backup = T.backup[i]; r.cost = T.cost[i];
      if (a.down) {
        r.status = "down"; r.backhaul = 0; r.clients = 0; r.demand = 0;
        r.why = "failed, or switched off to see what happens";
      } else if (T.depth[i] < 0) {
        r.status = "unreachable"; r.backhaul = 0;
        r.why = T.gateways ? "no link to the mesh reaches this AP within " + T.maxHops + (T.maxHops === 1 ? " hop" : " hops") : "there is no portal to reach";
      } else if (!a.gw) {
        /* walk to the gateway: every link on the way is shared by everyone behind
           it, and every relay that has one radio doing both jobs hears the parent
           and repeats to the child on the same medium, so it halves what passes */
        var k = i, hops = 0;
        while (T.parent[k] >= 0) {
          var L = T.links[k][T.parent[k]], share = L.goodput / T.subtree[k];
          if (hops === 0) r.link = L;
          r.backhaul = Math.min(r.backhaul, share);
          k = T.parent[k]; hops++;
          if (T.parent[k] >= 0 && !M.kind(aps[k], C).dedicated) r.relays++;
        }
        if (r.relays) r.backhaul /= Math.pow(2, r.relays);
        r.delivered = K.serves ? Math.min(r.backhaul, cell) : 0;
        if (r.link && r.link.fresnelBad) r.status = "fresnel";
        else if (r.delivered < r.demand) r.status = "starved";
        r.why = r.status === "fresnel" ? "the mast is too low for the Fresnel zone: line of sight on paper, loss on the air"
              : r.status === "starved" ? "the backhaul delivers " + r.delivered.toFixed(0) + " Mb/s against " + r.demand.toFixed(0) + " asked"
              : "";
        worstDepth = Math.max(worstDepth, T.depth[i]);
      } else {
        r.backhaul = Infinity; r.delivered = K.serves ? cell : 0;
      }
      if (r.status !== "unreachable" && r.status !== "down") delivered += Math.min(r.delivered, r.demand);
      rows.push(r);
    }

    /* which portal each point ends up behind: two portals split the points and
       give a fallback, they do not bond. */
    var portals = [];
    for (i = 0; i < n; i++) if (aps[i].gw && !aps[i].down) {
      var cnt = 0, mb = 0, k2;
      for (k2 = 0; k2 < n; k2++) if (T.depth[k2] > 0) {
        var q = k2; while (T.parent[q] >= 0) q = T.parent[q];
        if (q === i) { cnt++; mb += Math.min(rows[k2].delivered, rows[k2].demand); }
      }
      portals.push({ i: i, points: cnt, mbps: mb + Math.min(rows[i].delivered, rows[i].demand) });
    }

    /* the ceiling: demand, the mesh, or the satellite */
    var uplink = st.uplink === undefined ? 100 : st.uplink,
        meshCap = delivered,                        /* what the mesh can actually carry of the demand */
        ceiling = Math.min(demand, meshCap, uplink),
        binds = demand <= Math.min(meshCap, uplink) + 1e-9 ? "demand" : (uplink <= meshCap ? "uplink" : "mesh"),
        perClient = clients > 0 ? ceiling * 1000 / clients : 0,
        unreached = T.unreachable.length,
        fres = rows.filter(function (r) { return r.status === "fresnel"; }).length,
        starved = rows.filter(function (r) { return r.status === "starved"; }).length;

    var flags = [], spof = rows.filter(function (r) { return r.depth > 0 && r.backup < 0; }).length,
        downN = rows.filter(function (r) { return r.status === "down"; }).length;
    if (!T.gateways) flags.push("No portal. Mark the AP with the uplink as a portal, or nothing gets off the site.");
    if (downN) flags.push(downN + (downN === 1 ? " AP is" : " APs are") + " down. The tree below is the one the mesh falls back to.");
    if (spof) flags.push(spof + (spof === 1 ? " point has" : " points have") + " no second parent to fall back to. Lose the parent and they go dark.");
    if (unreached) flags.push(unreached + (unreached === 1 ? " AP has" : " APs have") + " no usable link to the mesh: too far, or something is in the way.");
    if (fres) flags.push(fres + (fres === 1 ? " link clears" : " links clear") + " the ground on paper but not the Fresnel zone. Raise the masts or shorten the hop.");
    if (T.profile.maxChildren) {
      var over = rows.filter(function (r) { return r.depth === 0 && T.children[r.i].length > T.profile.maxChildren; }).length;
      if (over) flags.push(over + (over === 1 ? " base carries" : " bases carry") + " more than " + T.profile.maxChildren + " relays, past the vendor's recommendation.");
    }
    if (worstDepth >= 3) flags.push("Hops run " + worstDepth + " deep" + (C.dedicated ? "." : ", and the client radio is carrying the backhaul. Every hop past the first halves what is left."));
    if (starved && binds !== "uplink") flags.push(starved + (starved === 1 ? " AP gets" : " APs get") + " less from the mesh than its clients are asking for.");
    if (binds === "uplink") flags.push("The uplink is the ceiling. The mesh carries " + (meshCap >= demand - 1e-9 ? "all " + demand.toFixed(0) + " Mb/s the clients ask for" : meshCap.toFixed(0) + " of the " + demand.toFixed(0) + " Mb/s the clients ask for") + ", but " + uplink + " Mb/s is all that leaves the site. More APs will not change that number.");

    return {
      aps: rows, tree: T, portals: portals, radius: radius, coverage: cover, land: M.land(land),
      spof: spof, down: downN,
      clients: clients, perAp: perAp, demand: demand, cellMbps: cell,
      meshMbps: meshCap, uplink: uplink, ceiling: ceiling, binds: binds,
      perClientKbps: perClient, askKbps: A.kbps,
      unreachable: unreached, fresnel: fres, starved: starved, maxDepth: T.maxDepth,
      flags: flags,
      assumptions: [
        "backhaul " + C.fGHz + " GHz, " + C.bw + " MHz, " + C.ss + " stream" + (C.ss === 1 ? "" : "s") + ", " + C.tx + " dBm unless an AP says otherwise, each end's gain taken toward the other from a cos^n fit to its antenna's beamwidths",
        "a link counts once its SNR sits " + C.margin + " dB above the lowest rate, and the weaker transmitter sets its rate",
        (C.tworay ? "ground reflection at " + C.rho + " of the direct ray in every budget, so mast height moves the fade and the tree" : "no ground reflection in the budgets; switch it on to see how far a metre of mast moves each link"),
        T.profile.label + ": " + T.profile.note + (T.profile.maxHops === null ? ", ceiling " + T.maxHops + " hops" : "") + (T.profile.thr ? ", links under " + T.profile.thr + " dB SNR taken last" : "") + " (shape from the vendor's documents, numbers a sketch, 2026-09; verify against your release)",
        "a point holds one parent at a time; a second portal is failover and a split of the points, not a bonded link",
        (function () {
          var shared = rows.filter(function (r) { return r.depth >= 0 && !r.kind.dedicated; }).length,
              bridges = rows.filter(function (r) { return r.depth >= 0 && !r.serves; }).length;
          return (shared ? shared + " of " + n + " APs carry clients and backhaul on one radio, so each such relay halves what passes through it" : "every AP has a dedicated backhaul radio, so relaying costs no client airtime") +
                 (bridges ? "; " + bridges + " bridge unit" + (bridges === 1 ? "" : "s") + " serve no clients" : "");
        })(),
        "every link's capacity is shared equally by the APs behind it",
        "clients spread evenly across the APs the mesh reaches, " + A.label.toLowerCase() + " at " + A.kbps + " kb/s each",
        "client cell edge at " + C.clientTarget + " dBm on a phone at chest height, path loss exponent " + M.land(land).n + " for " + M.land(land).label.toLowerCase() + "; a plain omni at " + C.tx + " dBm reaches " + radius.toFixed(0) + " m",
        "flat ground; a short mast shows up as knife edge loss at the ground, which stands in for the two ray fade",
        "no interference from anybody else's network, and no MU-MIMO or OFDMA gain"
      ]
    };
  };

  /* ── picking the antennas ──────────────────────────────────────────────
     The customer knows where a mast can go and how tall it is. What goes on top
     is the question, and it has a search-shaped answer: start everyone on an
     omni, then for each undecided AP try every antenna and keep whichever makes
     the whole site score best, until a pass changes nothing. The score is in
     megabits: what the clients get, headroom on the links, coverage of the
     field, a penalty for orphans, Fresnel trouble and single points of failure,
     and a small tax on directional antennas so an omni wins whenever the gain
     is not needed. Aims stay automatic unless the user pinned one. */
  M.score = function (p) {
    var s = 0, worst = 1;
    p.aps.forEach(function (r) {
      if (r.status === "unreachable") { s -= 1000; return; }
      if (r.status === "down") return;
      if (!r.gw) {
        s += Math.min(r.backhaul, 2 * Math.max(r.demand, 1));
        if (r.link && r.link.fresnelBad) s -= 30;
        if (r.backup < 0) s -= 20;
      }
      if (r.serves) {
        s += Math.min(r.delivered, r.demand);
        if (r.demand > 0) worst = Math.min(worst, r.delivered / r.demand);
      }
      s -= r.antenna.h >= 360 ? 0 : r.antenna.h <= 15 ? 8 : 3;
    });
    return s + 150 * p.coverage + 50 * worst;
  };

  M.suggest = function (st) {
    var aps = st.aps || [], idx = [], i, j;
    for (i = 0; i < aps.length; i++) if (M.isAuto(aps[i]) && !aps[i].down) idx.push(i);
    var cur = aps.map(function (a) { return M.isAuto(a) ? "omni" : a.ant; });
    function withAnts(ants) {
      var st2 = {}, k;
      for (k in st) st2[k] = st[k];
      st2.aps = aps.map(function (a, q) { var o = {}, z; for (z in a) o[z] = a[z]; o.ant = ants[q]; return o; });
      return st2;
    }
    function tryAnts(ants) { var p = M.plan(withAnts(ants)); return { s: M.score(p), p: p, ants: ants }; }
    var best = tryAnts(cur), ids = Object.keys(M.ANTENNAS), pass, changed;
    if (idx.length) for (pass = 0; pass < 3; pass++) {
      changed = false;
      for (i = 0; i < idx.length; i++) for (j = 0; j < ids.length; j++) {
        if (ids[j] === best.ants[idx[i]]) continue;
        var trial = best.ants.slice(); trial[idx[i]] = ids[j];
        var r = tryAnts(trial);
        if (r.s > best.s + 1e-6) { best = r; changed = true; }
      }
      if (!changed) break;
    }
    /* one line per decided AP on why, against the omni it would otherwise wear */
    var reasons = idx.map(function (k) {
      var a = M.antenna(best.ants[k]), row = best.p.aps[k], kids = best.p.tree.children[k].length, why;
      if (row.status === "unreachable") why = "nothing on the catalogue reaches the mesh from here; move the mast or raise it";
      else if (a.h >= 360) why = a.label.toLowerCase() + (kids ? ": it feeds " + kids + " point" + (kids === 1 ? "" : "s") + " and its footprint matters more than gain" : row.gw ? ": the portal, and nothing directional beat it" : ": the link holds without gain and the footprint stays round");
      else {
        var alt = best.ants.slice(); alt[k] = "omni";
        var po = M.plan(withAnts(alt)), ro = po.aps[k];
        why = a.label.toLowerCase() + (row.link ? " toward AP " + (row.parent + 1) + ": " + row.link.goodput.toFixed(0) + " Mb/s on the link against " +
              (ro.link ? ro.link.goodput.toFixed(0) + " Mb/s" : "no link at all") + " with an omni over " + row.link.d.toFixed(0) + " m" : " toward its " + kids + " point" + (kids === 1 ? "" : "s"));
        if (row.serves && po.coverage > best.p.coverage + 0.02) why += "; it costs " + Math.round((po.coverage - best.p.coverage) * 100) + " points of field coverage, which the link is worth";
      }
      return { i: k, ant: best.ants[k], why: why };
    });
    return { ants: best.ants, plan: best.p, score: best.s, reasons: reasons, decided: idx };
  };

  /* ── N-1: fail each AP in turn ─────────────────────────────────────────── */
  M.resilience = function (st) {
    var base = M.plan(st), out = [], i;
    (st.aps || []).forEach(function (a, idx) {
      if (a.down) return;
      var aps2 = st.aps.map(function (x, k) { var y = {}, q; for (q in x) y[q] = x[q]; if (k === idx) y.down = true; return y; }),
          st2 = {}, k;
      for (k in st) st2[k] = st[k];
      st2.aps = aps2;
      var p = M.plan(st2), orphans = [];
      for (i = 0; i < aps2.length; i++) if (i !== idx && p.aps[i].status === "unreachable" && base.aps[i].status !== "unreachable") orphans.push(i);
      out.push({ i: idx, gw: !!a.gw, orphans: orphans, meshMbps: p.meshMbps, lost: base.meshMbps - p.meshMbps,
                 ceiling: p.ceiling, portalsLeft: p.tree.gateways, coverage: p.coverage });
    });
    return { base: base, cases: out };
  };

  /* ── a client standing somewhere ───────────────────────────────────────── */
  M.client = function (st, plan, cl) {
    var C = cfg(st), dev = NFN.capacity.device(st.dev || "ax2"),
        A = NFN.capacity.app(st.app || "web"), best = -1, bestR = -Infinity, i;
    plan.tree.aps.forEach(function (a, k) {
      var r = plan.aps[k];
      if (r.status === "down" || r.status === "unreachable" || !r.serves) return;
      var rssi = M.rssiAt(a, cl.x, cl.y, C, st.land || "open");
      if (rssi > bestR) { bestR = rssi; best = k; }
    });
    if (best < 0) return { ap: -1, why: "no live AP on the site" };
    var bw = Math.min(dev.bw, C.clientBw), nf = NFN.rf.noiseFloor(bw, C.nf), snr = bestR - nf,
        mcs = NFN.phy.mcsFor(dev.std, snr), ap = plan.aps[best],
        link = mcs >= 0 ? NFN.mac.throughput({ std: dev.std, mcs: mcs, ss: dev.ss, bw: bw, bytes: A.bytes, agg: A.agg, retry: C.retry }) / 1e6 : 0,
        bh = ap.gw ? Infinity : ap.backhaul,
        alone = Math.min(link, bh, plan.uplink),
        /* with everyone else on: whatever headroom their demand leaves, or a fair
           share once the pipe is full, whichever is kinder */
        crowd = Math.min(link, Math.max(bh - ap.demand, bh / (ap.clients + 1)),
                         Math.max(plan.uplink - plan.demand, plan.uplink / (plan.clients + 1))),
        bind = alone === link ? "the client's own link" : alone === bh ? "the backhaul behind that AP" : "the uplink";
    return { ap: best, rssi: bestR, snr: snr, mcs: mcs, std: dev.std, bw: bw,
             phyMbps: mcs >= 0 ? NFN.phy.rate(dev.std, mcs, dev.ss, bw) : 0, linkMbps: link,
             alone: alone, crowd: crowd, binds: bind, hops: ap.depth,
             ok: mcs >= 0, why: mcs < 0 ? "too far from any AP to hold a rate" : "" };
  };
})(typeof window !== "undefined" ? window : globalThis);
