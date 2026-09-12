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
    clientTx: 20, clientAnt: 4, clientTarget: -67, clientBw: 20, clientF: 5.2,
    dedicated: false,       /* a second radio for the backhaul, or the client radio doing both */
    tworay: true, rho: 0.5, /* ground reflection: magnitude of the bounce off rough ground */
    profile: "generic", maxHops: 4
  };

  /* how a vendor's mesh behaves, as far as a planner needs: how deep it will go
     and how it picks a parent. Sketches, not documentation; verify against the
     release you run. Mist relays hang one hop off a base as of 2026-09; Aruba
     points chain, and the ceiling is yours to set. */
  M.PROFILES = {
    generic: { label: "Generic, airtime cost", maxHops: null, note: "parent by airtime cost, any depth you allow" },
    aruba:   { label: "Aruba style: portals and points", maxHops: null, note: "points chain through points; keep the hop ceiling honest" },
    mist:    { label: "Mist style: base and relay", maxHops: 1, note: "a relay must hear a base directly; one hop, no chaining" }
  };
  M.profile = function (id) { return M.PROFILES[id] || M.PROFILES.generic; };
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
    var done = [], gws = 0;
    for (i = 0; i < n; i++) { done.push(false); if (aps[i].gw && !aps[i].down) { cost[i] = 0; depth[i] = 0; gws++; } }
    for (;;) {
      var u = -1;
      for (i = 0; i < n; i++) if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i;
      if (u < 0) break;
      done[u] = true;
      if (depth[u] >= maxHops) continue;                 /* nothing may hang off the last allowed hop */
      for (j = 0; j < n; j++) {
        if (j === u || done[j] || aps[j].gw || aps[j].down) continue;
        var L2 = links[u][j];
        if (!L2 || !L2.ok) continue;
        var nc = cost[u] + M.linkCost(L2);
        if (nc < cost[j]) { cost[j] = nc; parent[j] = u; depth[j] = depth[u] + 1; }
      }
    }
    var children = [], sub = [];
    for (i = 0; i < n; i++) { children.push([]); sub.push(1); }
    for (i = 0; i < n; i++) if (parent[i] >= 0) children[parent[i]].push(i);
    /* subtree sizes, deepest first so a parent sees finished children */
    var order = [];
    for (i = 0; i < n; i++) order.push(i);
    order.sort(function (p, q) { return depth[q] - depth[p]; });
    order.forEach(function (k) { if (parent[k] >= 0) sub[parent[k]] += sub[k]; });

    /* a second parent for each point: the best other neighbour it could fall back
       to that does not itself depend on this point, within the hop ceiling. No
       backup is a single point of failure, and the table says so. */
    function under(k, root) { while (k >= 0) { if (k === root) return true; k = parent[k]; } return false; }
    var backup = [];
    for (i = 0; i < n; i++) {
      var best = -1, bestL = null;
      if (depth[i] > 0) for (j = 0; j < n; j++) {
        if (j === i || j === parent[i] || depth[j] < 0 || depth[j] >= maxHops || under(j, i)) continue;
        var L3 = links[i][j];
        if (L3 && L3.ok && (!bestL || L3.goodput > bestL.goodput)) { best = j; bestL = L3; }
      }
      backup.push(best);
    }
    return { links: links, parent: parent, depth: depth, children: children, subtree: sub, gateways: gws,
             backup: backup, cost: cost, maxHops: maxHops, profile: P, aps: aps,
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
        (C.tworay ? "ground reflection at " + C.rho + " of the direct ray, so mast height moves the fade" : "no ground reflection"),
        T.profile.label + ": " + T.profile.note + (T.profile.maxHops === null ? ", ceiling " + T.maxHops + " hops" : "") + " (behaviour sketch as of 2026-09, verify against your release)",
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
