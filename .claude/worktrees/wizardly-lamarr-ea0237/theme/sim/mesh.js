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

  /* what an obstacle is when it is dropped on the map: height and footprint.
     A tree line is porous: a link can go through the canopy at a foliage loss
     or over the top at a knife edge loss, and it takes whichever is kinder. */
  M.OBSTACLES = {
    tree:     { label: "Tree line",  h: 9,  r: 6,  foliage: true },
    building: { label: "Building",   h: 12, r: 10 },
    truck:    { label: "Truck or stage", h: 4.5, r: 5 }
  };

  /* terrain: smooth hills and dips, each a gaussian bump. Positive h lifts the
     ground under masts and under links, negative digs a hollow. Compact enough
     to ride in a link, and a hill is what a field actually has. */
  M.ground = function (x, y, terrain) {
    var z = 0, i;
    for (i = 0; i < (terrain || []).length; i++) {
      var t = terrain[i], d2 = (x - t.x) * (x - t.x) + (y - t.y) * (y - t.y), s = t.r / 2;
      z += t.h * Math.exp(-d2 / (2 * s * s));
    }
    return z;
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
  M.isAuto = function (ap) {
    if (ap.model && NFN.aps) { var m = NFN.aps.model(ap.model); if (m && m.antKind !== "ext") return false; }
    return !ap.ant || ap.ant === "auto" || !M.ANTENNAS[ap.ant];
  };

  /* what kind of box is on the mast: whether the backhaul has its own radio, and
     whether anybody can associate to it at all. A box with its own backhaul
     radio carries two antennas: ant for the backhaul, cant for the clients. */
  M.KINDS = {
    dual:   { label: "Dual radio, backhaul shares the client radio", dedicated: false, serves: true },
    tri:    { label: "Tri radio, dedicated backhaul",                dedicated: true,  serves: true },
    bridge: { label: "Bridge unit, backhaul only",                    dedicated: true,  serves: false }
  };
  M.kind = function (ap, C) {
    if (ap && ap.kind && M.KINDS[ap.kind]) return M.KINDS[ap.kind];
    if (ap && ap.model && NFN.aps) { var D = NFN.aps.describe(ap.model); if (D) return D.dedicated ? M.KINDS.tri : M.KINDS.dual; }
    return (C && C.dedicated) ? M.KINDS.tri : M.KINDS.dual;
  };
  /* the older standard on a link decides its rate table */
  var GEN = ["a", "n", "ac", "ax", "be"];
  M.stdMin = function (x, y) { return GEN[Math.min(GEN.indexOf(x) < 0 ? 3 : GEN.indexOf(x), GEN.indexOf(y) < 0 ? 3 : GEN.indexOf(y))]; };

  /* Regulatory ceilings on EIRP, dBm, outdoors, for the band the backhaul or the
     client radio sits in. Typical figures as generally published, 2026-09, not a
     regulator's text: FCC 36 dBm EIRP for UNII-1 and UNII-3 access points and
     for 6 GHz standard power under AFC; ETSI 20 dBm at 2.4 GHz, 30 dBm EIRP in
     5470 to 5725 MHz, and 14 dBm very low power outdoors at 6 GHz. Point to
     point links get more in both domains and are not modelled. Verify. */
  /* 5 GHz is not one number: FCC 15.407 gives UNII-1 and UNII-3 access points
     36 dBm EIRP but holds UNII-2A and UNII-2C (the DFS channels) to 30; ETSI
     gives 5150 to 5350 MHz 23 dBm and 5470 to 5725 MHz 30 dBm */
  M.DOMAINS = {
    us: { label: "United States, FCC", eirp: { "2.4": 36, "5": 36, "5dfs": 30, "6": 36 }, note: "36 dBm EIRP (30 on DFS channels); 6 GHz outdoors needs AFC" },
    eu: { label: "Europe, ETSI",       eirp: { "2.4": 20, "5": 23, "5dfs": 30, "6": 14 }, note: "23 dBm EIRP in 5150 to 5350 MHz, 30 dBm in 5470 to 5725 MHz; 6 GHz outdoors is very low power" }
  };
  M.domain = function (id) { return M.DOMAINS[id] || M.DOMAINS.us; };
  M.bandOf = function (fGHz) { return fGHz < 3 ? "2.4" : fGHz < 5.9 ? "5" : "6"; };
  /* the EIRP sub-band a frequency falls in: 5.25 to 5.725 GHz is the DFS block in both domains */
  M.eirpBandOf = function (fGHz) { var b = M.bandOf(fGHz); return b === "5" && fGHz >= 5.25 && fGHz < 5.725 ? "5dfs" : b; };

  /* defaults for an outdoor AP: a 5 GHz two stream backhaul at 40 MHz, an omni
     with a few dBi, a mast a few metres up. Change them in the tool. */
  M.DEF = {
    fGHz: 5.2, bw: 40, tx: 23, ant: "omni", ss: 2, std: "ax", nf: 7, retry: 0.1,
    margin: 6,              /* dB of SNR above the lowest rate before a link counts */
    fade: 0,                /* dB kept in hand on every link for weather and the day it all goes wrong */
    domain: "us",
    profile: "aruba", maxHops: 4,
    clientTx: 20, clientAnt: 4, clientTarget: -67, clientBw: 20, clientF: 5.2,
    dedicated: false,       /* a second radio for the backhaul, or the client radio doing both */
    /* ground reflection: magnitude of the bounce off rough ground. Off by default
       for planning: at these ranges the fade moves with a metre of mast height or
       ground, so it is a thing to show and to budget for, not to route on */
    tworay: false, rho: 0.5,
    /* field rotation: compass bearing of the map's +x axis, so 0 means east is to
       the right and north is up the screen */
    north: 0
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
  M.angDiff = function (a, b) { var d = ((a - b) % 360 + 540) % 360 - 180; return Math.abs(d); };

  /* Nobody picks a mesh parent by hand: Aruba, Cisco and Mist all let the point
     choose by their own metric, and an installer's aim only decides who sounds
     loudest. So when a directional antenna is pinned at one AP and the tree
     bonds the point to another, that is worth saying. Returns the index of the
     AP the aim points at when it is not the parent, else -1. aps are resolved. */
  M.aimedElsewhere = function (T, aps, i, C) {
    var a = aps[i], ant = M.apAntenna(a, C);
    if (!a || a.gw || a.down || T.depth[i] <= 0 || !(ant.h < 360) || a.aim === undefined || a.aim === null) return -1;
    var best = -1, bd = Math.min(45, ant.h / 2 + 5), j;
    for (j = 0; j < aps.length; j++) {
      if (j === i || aps[j].down) continue;
      var d = M.angDiff(a.aim, M.bearing(a, aps[j]));
      if (d < bd) { bd = d; best = j; }
    }
    return best >= 0 && best !== T.parent[i] ? best : -1;
  };
  /* screen azimuth (0 is +x, clockwise on the map) to a compass bearing, given
     the compass bearing of the map's +x axis */
  M.compass = function (azDeg, north) { return ((azDeg + 90 + (north || 0)) % 360 + 360) % 360; };
  M.fromCompass = function (bearing, north) { return wrap(bearing - 90 - (north || 0)); };

  /* the backhaul antenna and the client antenna. On a dual radio box they are
     the same physical antenna; a box with its own backhaul radio carries two. */
  M.apAntenna = function (ap, C) { return M.antenna(ap.ant || (C && C.ant) || "omni"); };
  M.clientAntenna = function (ap, C) { return M.kind(ap, C).dedicated ? M.antenna(ap.cant || "omni") : M.apAntenna(ap, C); };
  M.apBand = function (ap, C) { return ap.band === undefined || ap.band === null ? C.fGHz : ap.band; };
  M.apBw = function (ap, C) { return ap.bw === undefined || ap.bw === null ? C.bw : ap.bw; };

  /* transmit power after the regulatory ceiling: EIRP is the power plus the
     antenna's gain, and the law sets a number on that, so a bigger antenna
     means less power into it. Returns what actually goes out. */
  M.apTx = function (ap, C, gainDbi, fGHz) {
    var want = ap.tx === undefined ? C.tx : ap.tx;
    if (ap.txCap !== undefined && ap.txCap !== null) want = Math.min(want, ap.txCap);
    if (gainDbi === undefined) return want;
    var lim = M.domain(C.domain).eirp[M.eirpBandOf(fGHz === undefined ? M.apBand(ap, C) : fGHz)];
    return lim === undefined ? want : Math.min(want, lim - gainDbi);
  };
  M.eirpClamped = function (ap, C, gainDbi, fGHz) { return M.apTx(ap, C, gainDbi, fGHz) < (ap.tx === undefined ? C.tx : ap.tx) - 1e-9; };

  /* dBi from this AP toward an azimuth (degrees, 0 is +x) and an elevation
     (degrees, positive is up). The aim is the antenna's azimuth; the built-in
     tilt and the AP's own down-tilt point its boresight down. which is "bh"
     for the backhaul antenna or "cl" for the client one. */
  /* a measured plane: 72 gains at 5 degree steps, absolute dBi, the way an
     Ekahau antenna type stores them; linear interpolation between steps */
  function planeAt(gains, deg) {
    var a = ((deg % 360) + 360) % 360, i = Math.floor(a / 5) % 72, j = (i + 1) % 72, t = (a - i * 5) / 5;
    return gains[i] + (gains[j] - gains[i]) * t;
  }
  M.gainToward = function (ap, azDeg, elDeg, C, which) {
    var cl = which === "cl" && M.kind(ap, C).dedicated,
        id = cl ? (ap.cant || "omni") : (ap.ant || (C && C.ant) || "omni"),
        a = M.antenna(id),
        aim = cl ? (ap.caim === undefined || ap.caim === null ? 0 : ap.caim) : (ap.aim === undefined || ap.aim === null ? 0 : ap.aim),
        tilt = a.tilt + (cl ? (ap.ctilt || 0) : (ap.tilt || 0));
    if (a.hp && a.ep) {
      /* measured planes: the loss off the azimuth peak and the loss off the
         elevation peak are added, the textbook way of combining two cuts into
         a 3D estimate when the maker publishes only the cuts. Ekahau's E plane
         reads 0 at the horizon, 90 straight up, 270 straight down; a positive
         tilt turns the boresight down. */
      var gAz = planeAt(a.hp, azDeg - aim), gEl = planeAt(a.ep, elDeg + tilt),
          g = a.g - (a.g - gAz) - (a.g - gEl);
      return Math.max(g, a.floorDb);
    }
    var P = pats(id), dAz = wrap(azDeg - aim) * D, dEl = wrap(elDeg + tilt) * D;
    return a.g + 10 * Math.log10(Math.max(P.floor, P.h(dAz) * P.v(dEl)));
  };
  /* register a measured antenna: gains in dBi at 5 degree steps in each plane */
  M.registerPattern = function (id, label, maxGain, hplane, eplane, tilt, directional) {
    if (!hplane || hplane.length !== 72 || !eplane || eplane.length !== 72) return null;
    var hMin = Math.min.apply(null, hplane), hMax = Math.max.apply(null, hplane), eMin = Math.min.apply(null, eplane),
        above = hplane.filter(function (g) { return g >= hMax - 3; }).length * 5;
    M.ANTENNAS[id] = { label: label, g: maxGain, h: directional === false || (directional === undefined && hMax - hMin < 3) ? 360 : Math.max(10, above), v: 60, tilt: tilt || 0, f2b: Math.max(0, hMax - hMin),
                       hp: hplane, ep: eplane, floorDb: Math.min(hMin, eMin) - 3, measured: true, hidden: true };
    return id;
  };

  /* an unset aim points at the nearest other live AP, which is what an installer
     does with a patch when nobody has told them otherwise. An unset client aim
     points at the middle of the field, or at the crowds if there are any. */
  M.aims = function (aps, st) {
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
  M.clientAims = function (aps, st) {
    var cx = (st && st.w || 200) / 2, cy = (st && st.d || 140) / 2, cr = st && st.crowds && st.crowds.length ? st.crowds : null;
    if (cr) { var sx = 0, sy = 0, sn = 0; cr.forEach(function (c) { sx += c.x * c.n; sy += c.y * c.n; sn += c.n; }); if (sn) { cx = sx / sn; cy = sy / sn; } }
    return aps.map(function (a) {
      if (a.caim !== undefined && a.caim !== null && isFinite(a.caim)) return a.caim;
      return M.bearing(a, { x: cx, y: cy });
    });
  };
  M.resolve = function (aps, st) {
    var aims = M.aims(aps, st), caims = M.clientAims(aps, st), terrain = st && st.terrain, C = cfg(st);
    return aps.map(function (a, i) {
      var o = {}, k; for (k in a) o[k] = a[k];
      o.aim = aims[i]; o.caim = caims[i]; o.i = i;
      o.z = M.ground(a.x, a.y, terrain);          /* ground under the mast */
      /* a real box: its built in antennas, its streams and its power ceiling
         on the band the backhaul uses, and on the band the clients use */
      if (a.model && NFN.aps) {
        var D = NFN.aps.describe(a.model);
        if (D) {
          var bb = M.bandOf(M.apBand(o, C)), cb = M.bandOf(C.clientF);
          if (D.model.antKind !== "ext") { o.ant = NFN.aps.antennaFor(a.model, bb); o.cant = NFN.aps.antennaFor(a.model, cb) || o.cant; }
          o.ss = D.ssFor(bb); o.txCap = D.txMax(bb); o.std = D.std;
          if (!D.model.radios[bb]) o.noBand = true;
        }
      }
      return o;
    });
  };

  /* signal at a phone held at chest height, x and y on the field, from the
     client antenna */
  M.rssiAt = function (ap, x, y, C, land) {
    var Cc = cfg(C), n = M.land(land).n, d = Math.max(1, Math.hypot(ap.x - x, ap.y - y)),
        d3 = Math.hypot(d, ap.h - 1.2), az = M.bearing(ap, { x: x, y: y }),
        el = Math.atan2(1.2 - ap.h, d) / D, g = M.gainToward(ap, az, el, Cc, "cl"),
        f = Cc.clientF, wl = Cc.walls ? M.wallsCrossed(ap.x, ap.y, x, y, Cc.walls).db : 0;
    return M.apTx(ap, Cc, M.clientAntenna(ap, Cc).g, f) + g - NFN.rf.logDistance(d3, f, n) - wl;
  };

  /* the footprint at the target level, as a radius per azimuth. This is the
     antenna's real shape on the ground, which for a patch is not a circle. */
  M.contour = function (ap, C, land, steps) {
    var Cc = cfg(C), n = M.land(land).n, out = [], k, N = steps || 72, f = Cc.clientF,
        tx = M.apTx(ap, Cc, M.clientAntenna(ap, Cc).g, f);
    for (k = 0; k < N; k++) {
      var az = k * 360 / N,
          budget = tx + M.gainToward(ap, az, 0, Cc, "cl") - Cc.clientTarget - NFN.rf.fspl(1, f);
      out.push({ az: az, r: Math.pow(10, budget / (10 * n)) });
    }
    return out;
  };

  /* walls, the indoor obstacle: a segment with a loss per crossing in dB, the
     way Ekahau does it (attenuation per metre times thickness). A link or a
     client path loses the sum of the walls it crosses. */
  M.wallsCrossed = function (ax, ay, bx, by, walls) {
    var loss = 0, n = 0, i;
    for (i = 0; i < (walls || []).length; i++) {
      var w = walls[i], d1x = bx - ax, d1y = by - ay, d2x = w.x2 - w.x1, d2y = w.y2 - w.y1, den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-9) continue;
      var t = ((w.x1 - ax) * d2y - (w.y1 - ay) * d2x) / den, u = ((w.x1 - ax) * d1y - (w.y1 - ay) * d1x) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) { loss += w.db; n++; }
    }
    return { db: loss, n: n };
  };

  /* ── one link ──────────────────────────────────────────────────────────── */

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

  /* foliage, the early ITU (CCIR Report 236-2) model: 0.2 f^0.3 d^0.6 dB with f in MHz and d metres
     through the canopy, the short path form. 12 m of trees at 5 GHz is 12 dB. */
  M.foliage = function (dM, fGHz) { return dM <= 0 ? 0 : 0.2 * Math.pow(fGHz * 1000, 0.3) * Math.pow(dM, 0.6); };

  /* A measurement for a pair is either a number, the RSSI in dBm read off an
     AP, or { pl: dB }, the path loss between the two radios as AirMatch reports
     it (Central: /airmatch/telemetry/v1/nbr_pathloss_radio). Loss is the better
     of the two to carry because it does not care what power the AP was running
     when it was read. AirMatch's figure is EIRP minus the RSSI the neighbour
     heard, and an RSSI already has the receiving antenna in it, so the received
     power it implies is transmit power plus the transmitter's gain minus the
     loss: the receiver's gain is not added again. */
  M.measuredPrx = function (mv, tx, ga, gb) {
    if (mv === undefined || mv === null) return null;
    if (typeof mv === "number") return isFinite(mv) ? mv : null;
    if (typeof mv === "object" && isFinite(mv.pl)) return tx + ga - mv.pl;
    return null;
  };

  /* a, b carry x, y, h (mast above ground) and z (ground under the mast, from
     resolve). meas is a measurement for this pair (see measuredPrx), which
     replaces the model when given; calib is a dB correction learned from other
     measured links. */
  M.link = function (a, b, c, obstacles, terrain, meas, calib, walls) {
    var C = cfg(c), dx = b.x - a.x, dy = b.y - a.y, wallLoss = M.wallsCrossed(a.x, a.y, b.x, b.y, walls || C.walls),
        d = Math.max(0.5, Math.hypot(dx, dy)),
        za = (a.z === undefined ? M.ground(a.x, a.y, terrain) : a.z) + a.h,
        zb = (b.z === undefined ? M.ground(b.x, b.y, terrain) : b.z) + b.h,
        d3 = Math.hypot(d, zb - za),
        fa = M.apBand(a, C), fb = M.apBand(b, C), f = fa,
        bw = Math.min(M.apBw(a, C), M.apBw(b, C)),
        fspl = NFN.rf.fspl(d3, f),
        worst = { loss: 0, by: null, v: -Infinity }, i;
    if (Math.abs(fa - fb) > 0.01) {
      return { d: d, d3: d3, fspl: fspl, diffraction: 0, blockedBy: "band", obstacle: -1, band: fa, bw: bw,
               tx: 0, tworay: 0, ga: 0, gb: 0, prx: -Infinity, noise: 0, snr: -Infinity, mcs: -1, phyMbps: 0, goodput: 0,
               f1: 0, clearance: Infinity, fresnelBad: false, ok: false, foliage: 0, measured: false, clamped: false };
    }

    /* line of sight above the ground at t along the path, ground included */
    function los(t) { return za + (zb - za) * t - NFN.rf.bulge(d * t, d * (1 - t)); }
    function gnd(t) { return M.ground(a.x + dx * t, a.y + dy * t, terrain); }

    /* the ground: sample the path, the Fresnel zone is widest in the middle but a
       mast much lower than the other end, or a rise between them, moves the pinch */
    var clearMin = Infinity, f1mid = NFN.rf.fresnel1(d / 2, d / 2, f);
    for (i = 1; i < 16; i++) {
      var t = i / 16, d1 = d * t, d2 = d - d1,
          hh = los(t) - gnd(t), f1 = NFN.rf.fresnel1(d1, d2, f),
          ratio = hh / Math.max(1e-6, f1),
          v = NFN.rf.vParam(-hh, d1, d2, f), loss = NFN.rf.knifeEdge(v);
      if (ratio < clearMin) clearMin = ratio;
      if (loss > worst.loss) worst = { loss: loss, by: "ground", v: v };
    }

    /* obstacles: anything whose footprint the path crosses is a knife edge at its
       height standing on the ground there; a tree line also offers the way
       through at a foliage loss, and the link takes the kinder of the two */
    var fol = 0;
    (obstacles || []).forEach(function (o, idx) {
      var t = ((o.x - a.x) * dx + (o.y - a.y) * dy) / (d * d);
      if (t <= 0.02 || t >= 0.98) return;
      var px = a.x + dx * t, py = a.y + dy * t, off = Math.hypot(o.x - px, o.y - py);
      if (off > o.r) return;
      var d1 = d * t, d2 = d - d1, top = gnd(t) + o.h, hh = los(t),
          v = NFN.rf.vParam(top - hh, d1, d2, f), loss = NFN.rf.knifeEdge(v), by = "obstacle";
      if ((M.OBSTACLES[o.type] || {}).foliage && hh < top) {
        var through = 2 * Math.sqrt(Math.max(0, o.r * o.r - off * off)), fl = M.foliage(through, f);
        if (fl < loss) { loss = fl; by = "foliage"; }
      }
      if (loss > worst.loss) worst = { loss: loss, by: by, idx: idx, v: v };
    });
    if (worst.by === "foliage") fol = worst.loss;

    /* the weaker transmitter sets the rate: a link is only as fast as its slow
       direction. Each end's gain is what its antenna gives toward the other,
       and the regulator caps power plus gain at both ends. */
    var elAB = Math.atan2(zb - za, d) / D,
        ga = M.gainToward(a, M.bearing(a, b), elAB, C, "bh"),
        gb = M.gainToward(b, M.bearing(b, a), -elAB, C, "bh"),
        txa = M.apTx(a, C, M.apAntenna(a, C).g, f), txb = M.apTx(b, C, M.apAntenna(b, C).g, f),
        tx = Math.min(txa, txb),
        clamped = M.eirpClamped(a, C, M.apAntenna(a, C).g, f) || M.eirpClamped(b, C, M.apAntenna(b, C).g, f),
        ray = C.tworay ? M.twoRay(d, za, zb, f, C.rho) : 0,
        model = tx + ga + gb - fspl - worst.loss - wallLoss.db + ray,
        mPrx = M.measuredPrx(meas, tx, ga, gb),
        prx = (mPrx !== null ? mPrx : model + (calib || 0)) - C.fade,
        nf = NFN.rf.noiseFloor(bw, C.nf), snr = prx - nf,
        ss = Math.min(a.ss || C.ss, b.ss || C.ss), std = M.stdMin(a.std || C.std, b.std || C.std),
        /* the margin is a gate, not a handicap: a link counts once its SNR clears the
           lowest rate by C.margin, and then it runs at the rate its SNR earns. Held
           against a real point on 2026-09-13: MCS 7 at SNR 25 to 30 on 80 MHz, which
           SNRMIN gives and SNRMIN minus a margin does not. */
        mcs = (a.noBand || b.noBand) || snr < NFN.phy.SNRMIN[0] + C.margin ? -1 : NFN.phy.mcsFor(std, snr),
        phy = mcs >= 0 ? NFN.phy.rate(std, mcs, ss, bw) : 0,
        good = mcs >= 0 ? NFN.mac.throughput({ std: std, mcs: mcs, ss: ss, bw: bw, bytes: 1500, agg: 64, retry: C.retry }) / 1e6 : 0;
    return {
      d: d, d3: d3, fspl: fspl, diffraction: worst.loss, blockedBy: worst.loss > 0.5 ? worst.by : null,
      obstacle: worst.by === "obstacle" || worst.by === "foliage" ? worst.idx : -1, foliage: fol,
      band: f, bw: bw, ss: ss, std: std, tx: tx, clamped: clamped, tworay: ray, ga: ga, gb: gb, walls: wallLoss.n, wallDb: wallLoss.db,
      model: model, measured: mPrx !== null, calib: calib || 0,
      /* the loss the budget assumed, in AirMatch's terms (EIRP to RSSI, so the
         receiver's gain comes off the propagation loss), and the loss read */
      plModel: fspl + worst.loss + wallLoss.db - ray - gb, plMeas: meas && typeof meas === "object" && isFinite(meas.pl) ? meas.pl : null,
      prx: prx, noise: nf, snr: snr, mcs: mcs, phyMbps: phy, goodput: good,
      f1: f1mid, clearance: clearMin,
      /* 60% of the first Fresnel zone is the rule of thumb for "clear" */
      fresnelBad: clearMin < 0.6,
      ok: mcs >= 0
    };
  };

  /* the mast height that clears the Fresnel zone on a link, raising both ends
     together from where they are; null when 15 m does not do it */
  M.clearHeight = function (a, b, c, obstacles, terrain) {
    var h, a2, b2;
    for (h = 0; h <= 12; h += 0.5) {
      a2 = Object.assign({}, a, { h: a.h + h }); b2 = Object.assign({}, b, { h: b.h + h });
      var L = M.link(a2, b2, c, obstacles, terrain);
      if (!L.fresnelBad && L.diffraction < 0.5) return h;
    }
    return null;
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
  M.tree = function (apsIn, c, obstacles, site) {
    var C = cfg(c), aps = M.resolve(apsIn, site || c), auto = [], i, j;
    for (i = 0; i < aps.length; i++) {
      var a0 = apsIn[i];
      if ((a0.aim === undefined || a0.aim === null) && M.apAntenna(a0, C).h < 360) auto.push(i);
    }
    if (!auto.length) return build(aps, C, obstacles, site || c);
    var plain = aps.map(function (a, k) { var o = {}, q; for (q in a) o[q] = a[q]; if (auto.indexOf(k) >= 0) o.ant = "omni"; return o; }),
        T0 = build(plain, C, obstacles, site || c);
    auto.forEach(function (k) {
      if (T0.parent[k] >= 0) aps[k].aim = M.bearing(aps[k], aps[T0.parent[k]]);
      else if (T0.children[k].length) {
        var sx = 0, sy = 0;
        for (j = 0; j < T0.children[k].length; j++) { var b = M.bearing(aps[k], aps[T0.children[k][j]]) * D; sx += Math.cos(b); sy += Math.sin(b); }
        aps[k].aim = Math.atan2(sy, sx) / D;
      }
    });
    return build(aps, C, obstacles, site || c);
  };

  function build(aps, C, obstacles, site) {
    var terrain = site && site.terrain, meas = (site && site.meas) || {};
    /* measured links teach the model a per AP correction: the mean gap between
       what was measured and what the budget said, applied to that AP's
       unmeasured links. Two measured ends average their corrections. */
    var corr = [], cnt = [], ii, jj;
    for (ii = 0; ii < aps.length; ii++) { corr.push(0); cnt.push(0); }
    for (ii = 0; ii < aps.length; ii++) for (jj = ii + 1; jj < aps.length; jj++) {
      var mv = meas[ii + "-" + jj];
      if (mv === undefined || aps[ii].down || aps[jj].down) continue;
      var L0 = M.link(aps[ii], aps[jj], C, obstacles, terrain, undefined, 0, site && site.walls), mp = M.measuredPrx(mv, L0.tx, L0.ga, L0.gb);
      if (mp === null) continue;
      var gap = mp - L0.model;
      corr[ii] += gap; cnt[ii]++; corr[jj] += gap; cnt[jj]++;
    }
    /* a gap belongs to the pair, half to each end's surroundings */
    function calibFor(i2, j2) {
      var ci = cnt[i2] ? corr[i2] / cnt[i2] : 0, cj = cnt[j2] ? corr[j2] / cnt[j2] : 0;
      return (ci + cj) / 2;
    }
    var P = M.profile(C.profile),
        maxHops = P.maxHops === null ? Math.max(1, C.maxHops || 8) : P.maxHops,
        n = aps.length, links = [], cost = [], parent = [], depth = [], i, j;
    for (i = 0; i < n; i++) { links.push([]); cost.push(Infinity); parent.push(-1); depth.push(-1); }
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      /* a failed AP has no links: that is what failing it means */
      var L = (aps[i].down || aps[j].down) ? null : M.link(aps[i], aps[j], C, obstacles, terrain, meas[i + "-" + j], calibFor(i, j), site && site.walls);
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
    var metricFor = function (i, j) {
      var m = metric(i, j);
      if (m === -Infinity) return "no candidate";
      if (P.metric === "airtime") return (-m).toFixed(1) + " ms/Gb";
      if (P.metric === "ease") return "ease 2^" + Math.log2(Math.max(1e-9, m)).toFixed(1);
      if (P.metric === "rssi-tree") return "cost " + (-m).toFixed(1);
      return "SNR " + m.toFixed(0);
    };
    return { links: links, parent: parent, depth: depth, children: children, subtree: sub, gateways: gws,
             backup: backup, cost: cost, metricOf: metricOf, metricFor: metricFor, maxHops: maxHops, profile: P, aps: aps,
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
    var C = cfg(c), cols = 40, rows = Math.max(4, Math.round(cols * dpt / w)), hit = 0, hit2 = 0, i, j, k,
        second = C.secondary === undefined || C.secondary === null ? C.clientTarget - 10 : C.secondary;
    for (i = 0; i < cols; i++) for (j = 0; j < rows; j++) {
      var x = (i + 0.5) / cols * w, y = (j + 0.5) / rows * dpt, best = -Infinity, next = -Infinity;
      for (k = 0; k < aps.length; k++) { var r = M.rssiAt(aps[k], x, y, C, land); if (r > best) { next = best; best = r; } else if (r > next) next = r; }
      if (best >= C.clientTarget) hit++;
      /* Ekahau's secondary requirement: a second AP over a bar 10 dB under the first's */
      if (best >= C.clientTarget && next >= second) hit2++;
    }
    M.coverage.secondary = hit2 / (cols * rows);
    return hit / (cols * rows);
  };

  /* ── who is where, and when ────────────────────────────────────────────── */

  /* the day, as a share of the peak headcount by hour. Pick the shape of the
     event; the slider walks the clock. */
  M.CURVES = {
    flat:     { label: "Steady all day", f: function (h) { return 1; } },
    festival: { label: "Festival: builds to the headliner", f: function (h) { return h < 11 ? 0.05 : h < 17 ? 0.05 + 0.55 * (h - 11) / 6 : h < 21 ? 0.6 + 0.4 * (h - 17) / 4 : h < 23 ? 1 - 0.7 * (h - 21) / 2 : 0.15; } },
    match:    { label: "Match day: gates, half time, exit", f: function (h) { var a = Math.exp(-Math.pow(h - 13.5, 2) / 0.8), b = Math.exp(-Math.pow(h - 15.5, 2) / 0.3), c = Math.exp(-Math.pow(h - 17.2, 2) / 0.5); return Math.max(0.05, Math.min(1, 0.55 * a + 0.9 * b + 1.0 * c + (h > 13.5 && h < 17 ? 0.45 : 0))); } },
    market:   { label: "Market: morning peak", f: function (h) { return h < 7 ? 0.05 : h < 11 ? 0.05 + 0.95 * (h - 7) / 4 : h < 14 ? 1 - 0.6 * (h - 11) / 3 : h < 18 ? 0.4 - 0.35 * (h - 14) / 4 : 0.05; } }
  };
  M.crowdFactor = function (st) {
    if (st.tod === undefined || st.tod === null) return 1;
    var c = M.CURVES[st.curve] || M.CURVES.flat;
    return NFN.clamp(c.f(st.tod), 0, 1);
  };

  /* clients onto APs. Loose clients spread evenly over the serving APs the mesh
     reaches; a crowd is a headcount in a circle, sampled at twelve spots, each
     spot joining whichever serving AP is loudest there, or nobody if nobody
     reaches the target. */
  M.assignClients = function (aps, serveIdx, C, land, st) {
    var f = M.crowdFactor(st), n = aps.length, per = [], i, k, unserved = 0, loose = (st.clients || 0) * f;
    for (i = 0; i < n; i++) per.push(0);
    serveIdx.forEach(function (k2) { per[k2] += serveIdx.length ? loose / serveIdx.length : 0; });
    var byCrowd = [];
    (st.crowds || []).forEach(function (cr) {
      var head = cr.n * f, got = 0, lost = 0, spots = [[0, 0]], q;
      for (q = 0; q < 6; q++) spots.push([0.55 * cr.r * Math.cos(q * Math.PI / 3), 0.55 * cr.r * Math.sin(q * Math.PI / 3)]);
      for (q = 0; q < 5; q++) spots.push([0.95 * cr.r * Math.cos(q * Math.PI * 2 / 5 + 0.3), 0.95 * cr.r * Math.sin(q * Math.PI * 2 / 5 + 0.3)]);
      spots.forEach(function (sp) {
        var x = cr.x + sp[0], y = cr.y + sp[1], best = -1, br = -Infinity;
        serveIdx.forEach(function (k2) { var r = M.rssiAt(aps[k2], x, y, C, land); if (r > br) { br = r; best = k2; } });
        if (best >= 0 && br >= C.clientTarget) { per[best] += head / spots.length; got += head / spots.length; }
        else lost += head / spots.length;
      });
      unserved += lost;
      byCrowd.push({ n: head, served: got, unserved: lost });
    });
    return { per: per, unserved: unserved, factor: f, loose: loose, crowds: byCrowd,
             total: loose + (st.crowds || []).reduce(function (t, c) { return t + c.n * f; }, 0) };
  };

  /* ── channels ──────────────────────────────────────────────────────────── */

  /* One channel per portal's tree: a point has to sit on its parent's channel
     to hear it, and its children on its, so a subtree is one channel end to end.
     Portals take distinct channels round robin from what the domain allows,
     unless one is pinned. */
  M.assignChannels = function (T, aps, C, st) {
    var list = NFN.channels.list(M.bandOf(C.fGHz), C.bw, !!st.dfs, C.domain, true), used = {}, chan = [], i, next = 0;
    for (i = 0; i < aps.length; i++) chan.push(null);
    for (i = 0; i < aps.length; i++) if (T.depth[i] === 0) {
      var c = aps[i].ch !== undefined && aps[i].ch !== null ? aps[i].ch : null;
      if (c === null) { var tries = 0; while (tries++ < list.length && used[list[next % list.length]]) next++; c = list.length ? list[next % list.length] : null; next++; }
      if (c !== null) used[c] = true;
      chan[i] = c;
    }
    for (i = 0; i < aps.length; i++) if (T.depth[i] > 0) { var k = i; while (T.parent[k] >= 0) k = T.parent[k]; chan[i] = chan[k]; }
    return { chan: chan, list: list, distinct: Object.keys(used).length };
  };

  /* co-channel: two tree links on one channel whose ends can hear each other
     share the air. Each link's busy share is what it carries over what it could;
     a link loses the busy share of every contender it hears. Links that meet at
     a node are left out, because the relay halving already pays for those. */
  M.cochannel = function (T, aps, C, chan, carried) {
    var n = aps.length, out = [], i, j, cca = NFN.rf.noiseFloor(C.bw, C.nf) + 6, links = [];
    for (i = 0; i < n; i++) { out.push({ busy: 0, with: [] }); if (T.depth[i] > 0 && T.parent[i] >= 0) links.push(i); }
    function hears(x, y) { var L = x === y ? null : T.links[x][y]; return !!L && L.prx + C.fade >= cca; }
    links.forEach(function (i2) {
      var pi = T.parent[i2];
      links.forEach(function (j2) {
        if (j2 === i2 || chan[j2] !== chan[i2]) return;
        var pj = T.parent[j2];
        if (i2 === pj || j2 === pi || pi === pj) return;               /* adjacent links: the halving already counts these */
        if (hears(i2, j2) || hears(i2, pj) || hears(pi, j2) || hears(pi, pj)) {
          var Lj = T.links[j2][pj], u = Lj.goodput > 0 ? Math.min(1, (carried[j2] || 0) / Lj.goodput) : 0;
          out[i2].busy += u; out[i2].with.push(j2);
        }
      });
      out[i2].busy = Math.min(0.9, out[i2].busy);
    });
    return out;
  };

  /* ── the plan ──────────────────────────────────────────────────────────── */

  /* st: { aps:[{x,y,h,gw,...}], obstacles, terrain, crowds, meas, w, d, land,
           uplink (Mb/s), clients, dev, app, tod, curve, radio settings as in DEF } */
  M.plan = function (st) {
    var C = cfg(st), apsIn = st.aps || [], obs = st.obstacles || [],
        T = M.tree(apsIn, C, obs, st), aps = T.aps, n = aps.length, i,
        land = st.land || "open",
        radius = M.cellRadius(C, land),
        serveIdx = [], serving = [];
    for (i = 0; i < n; i++) if (T.depth[i] >= 0 && M.kind(aps[i], C).serves) { serveIdx.push(i); serving.push(aps[i]); }
    var cover = serving.length ? M.coverage(serving, C, land, st.w || 200, st.d || 140) : 0, cover2 = serving.length ? M.coverage.secondary : 0,
        dev = st.dev || "ax2", app = st.app || "web", A = NFN.capacity.app(app),
        who = M.assignClients(aps, serveIdx, C, land, st),
        clients = who.total, demand = clients * A.kbps / 1000,
        CH = M.assignChannels(T, aps, C, st),
        rows = [], delivered = 0, worstDepth = 0;

    /* two passes: capacity with the links alone, then the same with the air each
       link actually gets once its co-channel neighbours are counted */
    function pass(cci) {
      rows = []; delivered = 0; worstDepth = 0;
      var carried = [];
      for (i = 0; i < n; i++) carried.push(0);
      for (i = 0; i < n; i++) {
        var a = aps[i], K = M.kind(a, C), mine = who.per[i],
            cell = K.serves && T.depth[i] >= 0 ? NFN.capacity.group({ n: Math.max(1, Math.round(mine)), dev: dev, app: app }, { bw: C.clientBw, retry: C.retry }).goodputMbps : 0,
            r = { i: i, gw: !!a.gw, depth: T.depth[i], parent: T.parent[i], link: null,
                  kind: K, antenna: M.apAntenna(a, C), clientAntenna: M.clientAntenna(a, C), aim: a.aim, caim: a.caim, serves: K.serves,
                  channel: CH.chan[i], band: M.apBand(a, C), bw: M.apBw(a, C),
                  clients: K.serves ? mine : 0, demand: K.serves ? mine * A.kbps / 1000 : 0, cellMbps: cell,
                  backhaul: Infinity, delivered: 0, status: "ok", why: "", relays: 0, cci: cci ? cci[i].busy : 0, cciWith: cci ? cci[i].with : [] };
        r.backup = T.backup[i]; r.cost = T.cost[i];
        r.aimedAt = M.aimedElsewhere(T, aps, i, C);
        if (a.down) {
          r.status = "down"; r.backhaul = 0; r.clients = 0; r.demand = 0;
          r.why = "failed, or switched off to see what happens";
        } else if (T.depth[i] < 0) {
          r.status = "unreachable"; r.backhaul = 0;
          r.why = T.gateways ? "no link to the mesh reaches this AP within " + T.maxHops + (T.maxHops === 1 ? " hop" : " hops") : "there is no portal to reach";
        } else if (!a.gw) {
          /* walk to the gateway: every link on the way is shared by everyone behind
             it, loses the air its co-channel neighbours use, and every relay that
             has one radio doing both jobs halves what passes through it */
          var k = i, hops = 0;
          while (T.parent[k] >= 0) {
            var L = T.links[k][T.parent[k]], eff = L.goodput * (1 - (cci ? cci[k].busy : 0)), share = eff / T.subtree[k];
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
      /* what each link carries: the demand behind it, capped by what it can */
      for (i = 0; i < n; i++) if (T.depth[i] > 0) {
        var q = i, load = Math.min(rows[i].delivered, rows[i].demand);
        while (q >= 0 && T.parent[q] >= 0) { carried[q] += load; q = T.parent[q]; }
      }
      for (i = 0; i < n; i++) if (T.depth[i] > 0 && T.parent[i] >= 0) carried[i] = Math.min(carried[i], T.links[i][T.parent[i]].goodput);
      return carried;
    }
    var carried = pass(null), cci = M.cochannel(T, aps, C, CH.chan, carried);
    pass(cci);

    /* which portal each point ends up behind: two portals split the points and
       give a fallback, they do not bond. */
    var portals = [];
    for (i = 0; i < n; i++) if (aps[i].gw && !aps[i].down) {
      var cnt = 0, mb = 0, k2;
      for (k2 = 0; k2 < n; k2++) if (T.depth[k2] > 0) {
        var q2 = k2; while (T.parent[q2] >= 0) q2 = T.parent[q2];
        if (q2 === i) { cnt++; mb += Math.min(rows[k2].delivered, rows[k2].demand); }
      }
      portals.push({ i: i, points: cnt, mbps: mb + Math.min(rows[i].delivered, rows[i].demand), channel: CH.chan[i] });
    }

    /* the ceiling: demand, the mesh, or the satellite */
    var uplink = st.uplink === undefined ? 100 : st.uplink,
        meshCap = delivered,                        /* what the mesh can actually carry of the demand */
        ceiling = Math.min(demand, meshCap, uplink),
        binds = demand <= Math.min(meshCap, uplink) + 1e-9 ? "demand" : (uplink <= meshCap ? "uplink" : "mesh"),
        perClient = clients > 0 ? ceiling * 1000 / clients : 0,
        unreached = T.unreachable.length,
        fres = rows.filter(function (r) { return r.status === "fresnel"; }).length,
        starved = rows.filter(function (r) { return r.status === "starved"; }).length,
        cciHit = rows.filter(function (r) { return r.cci > 0.2; }).length,
        clamped = rows.filter(function (r) { return r.link && r.link.clamped; }).length,
        measured = rows.filter(function (r) { return r.link && r.link.measured; }).length;

    var flags = [], spof = rows.filter(function (r) { return r.depth > 0 && r.backup < 0; }).length,
        downN = rows.filter(function (r) { return r.status === "down"; }).length;
    if (!T.gateways) flags.push("No portal. Mark the AP with the uplink as a portal, or nothing gets off the site.");
    if (!CH.list.length) flags.push("There is no " + C.bw + " MHz channel in " + M.bandOf(C.fGHz) + " GHz for " + M.domain(C.domain).label + (st.dfs ? "" : " without DFS") + ". Pick a narrower channel or put DFS back in the plan.");
    if (downN) flags.push(downN + (downN === 1 ? " AP is" : " APs are") + " down. The tree below is the one the mesh falls back to.");
    if (spof) flags.push(spof + (spof === 1 ? " point has" : " points have") + " no second parent to fall back to. Lose the parent and they go dark.");
    if (unreached) flags.push(unreached + (unreached === 1 ? " AP has" : " APs have") + " no usable link to the mesh: too far, something in the way, or a different band.");
    if (fres) flags.push(fres + (fres === 1 ? " link clears" : " links clear") + " the ground on paper but not the Fresnel zone. Raise the masts or shorten the hop.");
    if (who.unserved > 0.5) flags.push(Math.round(who.unserved) + " people in the crowds have no AP above " + C.clientTarget + " dBm where they stand.");
    if (cciHit) flags.push(cciHit + (cciHit === 1 ? " link loses" : " links lose") + " more than a fifth of its air to co-channel neighbours. " + (CH.distinct < T.gateways ? "Portals share a channel; pin them apart." : "Another channel, or a narrower one so there are more, spreads them out."));
    if (clamped) flags.push(clamped + (clamped === 1 ? " link runs" : " links run") + " at less than the set power because " + M.domain(C.domain).label + " caps EIRP at " + M.domain(C.domain).eirp[M.bandOf(C.fGHz)] + " dBm in this band.");
    var misaimed = rows.filter(function (r) { return r.aimedAt >= 0; });
    if (misaimed.length) flags.push(misaimed.map(function (r) { return "AP " + (r.i + 1) + " is aimed at AP " + (r.aimedAt + 1) + " but bonds to AP " + (r.parent + 1); }).join("; ") + ". The point picks its own parent (" + T.profile.label + "); the aim only changes who is loudest. Aim at the parent shown, or move a mast so the one you want wins.");
    if (T.profile.maxChildren) {
      var over = rows.filter(function (r) { return r.depth === 0 && T.children[r.i].length > T.profile.maxChildren; }).length;
      if (over) flags.push(over + (over === 1 ? " base carries" : " bases carry") + " more than " + T.profile.maxChildren + " relays, past the vendor's recommendation.");
    }
    if (worstDepth >= 3) flags.push("Hops run " + worstDepth + " deep" + (rows.some(function (r) { return r.relays > 0; }) ? ", and shared radios are relaying. Every such relay halves what is left." : "."));
    if (starved && binds !== "uplink") flags.push(starved + (starved === 1 ? " AP gets" : " APs get") + " less from the mesh than its clients are asking for.");
    if (binds === "uplink") flags.push("The uplink is the ceiling. The mesh carries " + (meshCap >= demand - 1e-9 ? "all " + demand.toFixed(0) + " Mb/s the clients ask for" : meshCap.toFixed(0) + " of the " + demand.toFixed(0) + " Mb/s the clients ask for") + ", but " + uplink + " Mb/s is all that leaves the site. More APs will not change that number.");

    return {
      aps: rows, tree: T, portals: portals, radius: radius, coverage: cover, coverage2: cover2, land: M.land(land),
      channels: CH, who: who, spof: spof, down: downN,
      clients: clients, perAp: serveIdx.length ? clients / serveIdx.length : 0, demand: demand,
      meshMbps: meshCap, uplink: uplink, ceiling: ceiling, binds: binds,
      perClientKbps: perClient, askKbps: A.kbps,
      unreachable: unreached, fresnel: fres, starved: starved, maxDepth: T.maxDepth, cciHit: cciHit, measured: measured,
      flags: flags, cfg: C, dfs: !!st.dfs,
      assumptions: [
        "backhaul " + C.fGHz + " GHz, " + C.bw + " MHz, " + C.ss + " stream" + (C.ss === 1 ? "" : "s") + ", " + C.tx + " dBm unless an AP says otherwise, each end's gain taken toward the other from a cos^n fit to its antenna's beamwidths",
        M.domain(C.domain).label + ": EIRP capped at " + M.domain(C.domain).eirp[M.bandOf(C.fGHz)] + " dBm on the backhaul band, " + CH.list.length + " channel" + (CH.list.length === 1 ? "" : "s") + " at " + C.bw + " MHz" + (st.dfs ? " with DFS" : " without DFS") + " (typical figures, 2026-09; verify)",
        "one channel per portal's tree; links on a channel that hear each other above " + (NFN.rf.noiseFloor(C.bw, C.nf) + 6).toFixed(0) + " dBm share the air, adjacent links excepted because the relay halving already pays for them",
        "a link counts once its SNR sits " + C.margin + " dB above the lowest rate, " + (C.fade ? C.fade + " dB of fade margin held back on every link, " : "no fade margin held back, ") + "and the weaker transmitter sets its rate",
        (measured ? measured + " link" + (measured === 1 ? "" : "s") + " measured on site; the gap teaches a correction to the other links at those APs" : "no measured links; every budget is the model"),
        (C.tworay ? "ground reflection at " + C.rho + " of the direct ray in every budget, so mast height moves the fade and the tree" : "no ground reflection in the budgets; switch it on to see how far a metre of mast moves each link"),
        "rain is under 0.1 dB/km at 5 GHz and is not modelled; a tree line costs the early ITU (CCIR 236-2) foliage loss through the canopy or a knife edge over it, whichever is kinder",
        T.profile.label + ": " + T.profile.note + (T.profile.maxHops === null ? ", ceiling " + T.maxHops + " hops" : "") + (T.profile.thr ? ", links under " + T.profile.thr + " dB SNR taken last" : "") + " (shape from the vendor's documents, numbers a sketch, 2026-09; verify against your release)",
        "a point holds one parent at a time; a second portal is failover and a split of the points, not a bonded link",
        (function () {
          var shared = rows.filter(function (r) { return r.depth >= 0 && !r.kind.dedicated; }).length,
              bridges = rows.filter(function (r) { return r.depth >= 0 && !r.serves; }).length;
          return (shared ? shared + " of " + n + " APs carry clients and backhaul on one radio, so each such relay halves what passes through it" : "every AP has a dedicated backhaul radio, so relaying costs no client airtime") +
                 (bridges ? "; " + bridges + " bridge unit" + (bridges === 1 ? "" : "s") + " serve no clients" : "");
        })(),
        "every link's capacity is shared equally by the APs behind it",
        ((st.crowds || []).length ? Math.round(who.total) + " people: " + Math.round(who.loose) + " loose and spread evenly, the rest in " + st.crowds.length + " crowd" + (st.crowds.length === 1 ? "" : "s") + " joining the loudest AP where they stand" : "clients spread evenly across the APs the mesh reaches") +
          ", " + A.label.toLowerCase() + " at " + A.kbps + " kb/s each" + (who.factor < 1 ? ", at " + Math.round(who.factor * 100) + "% of the peak for this hour" : ""),
        ((st.walls || []).length ? st.walls.length + " walls, each costing its Ekahau attenuation per crossing on links and on clients; " : "") + "client cell edge at " + C.clientTarget + " dBm on a phone at chest height, a second AP at " + (C.secondary === undefined || C.secondary === null ? C.clientTarget - 10 : C.secondary) + " dBm for secondary coverage, path loss exponent " + M.land(land).n + " for " + M.land(land).label.toLowerCase() + "; a plain omni at " + C.tx + " dBm reaches " + radius.toFixed(0) + " m",
        ((st.terrain || []).length ? "ground shaped by " + st.terrain.length + " hill" + (st.terrain.length === 1 ? "" : "s") + " under masts, links and obstacles; a short mast or a rise shows up as knife edge loss at the ground" : "flat ground; a short mast shows up as knife edge loss at the ground, which stands in for the two ray fade"),
        "no interference from anybody else's network, and no MU-MIMO or OFDMA gain"
      ]
    };
  };

  /* ── advice: where the uplink should be, how high the masts ────────────── */

  /* every AP tried as the only portal, and every AP tried as one more portal
     beside the ones there are; scored the same way the antennas are */
  M.suggestPortal = function (st) {
    var aps = st.aps || [], out = { single: null, extra: null }, i;
    function withPortals(fn) { var st2 = Object.assign({}, st); st2.aps = aps.map(function (a, k) { return Object.assign({}, a, { gw: fn(a, k) }); }); return st2; }
    for (i = 0; i < aps.length; i++) {
      if (aps[i].down) continue;
      var p1 = M.plan(withPortals(function (a, k) { return k === i; })), s1 = M.score(p1);
      if (!out.single || s1 > out.single.score) out.single = { i: i, score: s1, ceiling: p1.ceiling, spof: p1.spof, unreachable: p1.unreachable, maxDepth: p1.maxDepth };
      if (!aps[i].gw) {
        var p2 = M.plan(withPortals(function (a, k) { return a.gw || k === i; })), s2 = M.score(p2);
        if (!out.extra || s2 > out.extra.score) out.extra = { i: i, score: s2, ceiling: p2.ceiling, spof: p2.spof, unreachable: p2.unreachable, maxDepth: p2.maxDepth };
      }
    }
    out.now = M.score(M.plan(st));
    return out;
  };

  /* for every tree link short of Fresnel clearance or eating diffraction, how much
     higher both masts have to go */
  M.suggestHeights = function (st, plan) {
    var out = [], C = cfg(st);
    plan.aps.forEach(function (r) {
      if (!r.link || !(r.link.fresnelBad || r.link.diffraction >= 3)) return;
      var a = plan.tree.aps[r.i], b = plan.tree.aps[r.parent], up = M.clearHeight(a, b, C, st.obstacles, st.terrain);
      out.push({ i: r.i, parent: r.parent, up: up, loss: r.link.diffraction, clearance: r.link.clearance });
    });
    return out;
  };

  /* the budget for a link the tree did not choose, and why it did not */
  M.explain = function (st, plan, i, j) {
    var T = plan.tree, L = T.links[i] && T.links[i][j], why;
    if (!L) why = "one of them is down";
    else if (L.blockedBy === "band") why = "different backhaul bands";
    else if (!L.ok) why = "SNR " + L.snr.toFixed(0) + " dB is under the " + cfg(st).margin + " dB the lowest rate needs";
    else if (T.parent[i] === j) why = "this is the link in use";
    else if (T.depth[j] < 0) why = "AP " + (j + 1) + " has no path to a portal itself";
    else if (T.depth[j] >= T.maxHops) why = "AP " + (j + 1) + " already sits at the hop ceiling";
    else {
      var k = j, loop = false; while (k >= 0) { if (k === i) loop = true; k = T.parent[k]; }
      if (loop) why = "AP " + (j + 1) + " reaches the portal through AP " + (i + 1) + ", so this would be a loop";
      else if (T.parent[i] >= 0) why = "the metric preferred AP " + (T.parent[i] + 1) + ": " + T.metricOf(i) + " against " + (T.metricFor ? T.metricFor(i, j) : "the alternative");
      else why = "not chosen";
    }
    return { link: L, why: why };
  };

  /* ── how the mesh formed, in words ────────────────────────────────────
     The tree is a picture; this is the story of it, in the order a mesh forms:
     the rule the profile plays by, the portals, then each point by the hop it
     sits at, with the candidates it heard, the one the metric took and why the
     runner-up lost, its fallback, and what the hop costs the ones behind it.
     Every number is read from the tree, none is worked out a second time, so
     the story cannot drift from the map. `names` is optional (AP names from a
     controller); "AP 3" otherwise. Steps carry a `kind` the page can style by. */
  M.narrate = function (st, plan, names) {
    var T = plan.tree, C = plan.cfg || cfg(st), P = T.profile, n = T.aps.length, i, j, steps = [];
    var nm = function (k) { return (names && names[k]) || "AP " + (k + 1); };
    var f0 = function (x) { return isFinite(x) ? x.toFixed(0) : "?"; };
    var mbs = function (x) { return !isFinite(x) ? "?" : x >= 100 ? x.toFixed(0) + " Mb/s" : x.toFixed(1) + " Mb/s"; };
    var rate = function (L) { return L.mcs >= 0 ? "MCS " + L.mcs + ", " + mbs(L.goodput) : "no rate"; };
    var row = function (k) { return plan.aps[k]; };
    var isPortal = function (k) { return T.depth[k] === 0; };
    if (!n) return { steps: [{ kind: "rule", title: "Nothing to form", text: "Put an AP on the field and mark one a portal." }] };

    /* 1. the rule */
    var how = {
      "rssi-tree": "a point adds up the cost of every link between it and a portal, a cost that doubles for every 4 dB a link weakens plus a charge for each child its parent already carries, and takes the cheapest total. One marginal link costs more than two good hops; two near-equal hops never beat one good direct link.",
      "rssi": "a point takes the strongest link to any node that already has a path, full stop. Hop count does not enter into it.",
      "ease": "a point rates each path by its weakest link's ease, 2 to the power of SNR over 3, divided by the number of hops, and takes the best.",
      "airtime": "a point sums the airtime a gigabit would take across every link on the path and takes the least. A row of APs tends to chain straight back to the portal.",
      "single": "a relay attaches to a base, one hop only. Anything that cannot hear a base is out."
    };
    steps.push({ kind: "rule", title: "The rule in force: " + P.label,
      text: (how[P.metric] || P.note) + " Links under " + (P.thr ? P.thr + " dB SNR" : "the gate") + " are taken last, a link counts only once its SNR clears the lowest rate by " + C.margin + " dB, and the tree is rebuilt each round until nobody would change parent" + (T.maxHops ? ", within " + T.maxHops + " hop" + (T.maxHops === 1 ? "" : "s") + " of a portal" : "") + "." });

    /* 2. the portals */
    var portals = [], chans = {};
    for (i = 0; i < n; i++) if (isPortal(i)) { portals.push(i); chans[row(i).channel] = 1; }
    if (!portals.length) {
      steps.push({ kind: "portal", title: "No portal", text: "Nobody is on the wire, so nothing forms. Mark the AP with the uplink as a portal." });
      return { steps: steps };
    }
    var distinct = Object.keys(chans).length;
    steps.push({ kind: "portal", title: portals.length === 1 ? nm(portals[0]) + " is the portal" : portals.map(nm).join(" and ") + " are the portals",
      text: (portals.length === 1 ? "It sits" : "They sit") + " on the wire at path cost zero, so every path ends here. " +
            portals.map(function (k) { return nm(k) + " beacons on channel " + (row(k).channel || "?") + " and carries " + (T.subtree[k] - 1) + " point" + (T.subtree[k] - 1 === 1 ? "" : "s") + " behind it"; }).join("; ") + ". " +
            (portals.length === 1 ? "" : distinct > 1 ? "The portals are on different channels. On real hardware a point scans once at boot, then parks its backhaul radio on its parent's channel and stops scanning, so a portal on another channel is invisible to it until its link drops; put portals on one channel if they are to be each other's fallback (measured on an AOS 10 point, 2026-09-13)." : "The portals share a channel, so a point can hear both and fall from one to the other.") });

    /* 3. each point, by the hop it sits at */
    var order = [];
    for (i = 0; i < n; i++) if (T.depth[i] > 0) order.push(i);
    order.sort(function (a, b) { return T.depth[a] - T.depth[b] || a - b; });
    order.forEach(function (i) {
      var p = T.parent[i], L = T.links[i][p], r = row(i), cands = [];
      for (j = 0; j < n; j++) {
        if (j === i || T.depth[j] < 0) continue;
        var Lj = T.links[i][j]; if (!Lj || !Lj.ok) continue;
        var k = j, loop = false; while (k >= 0) { if (k === i) { loop = true; break; } k = T.parent[k]; }
        if (loop) continue;
        cands.push({ j: j, L: Lj, m: T.metricFor(i, j), depth: T.depth[j] });
      }
      cands.sort(function (a, b) { return a.j === p ? -1 : b.j === p ? 1 : b.L.snr - a.L.snr; });
      var heard = cands.map(function (c) { return nm(c.j) + (isPortal(c.j) ? " (portal)" : " (" + c.depth + " hop" + (c.depth === 1 ? "" : "s") + " out)") + " at SNR " + f0(c.L.snr) + ", " + rate(c.L) + ", " + c.m; }).join("; ");
      var runner = cands.filter(function (c) { return c.j !== p; })[0], why = "";
      if (runner) {
        var dSnr = runner.L.snr - L.snr;
        if (P.metric === "rssi") why = dSnr > 0 ? " That looks wrong until you notice " + nm(runner.j) + " has no path of its own yet in the round this settled; the metric only takes links to nodes already attached." : " Strongest link wins under this rule, and " + nm(p) + " is " + f0(-dSnr) + " dB louder.";
        else if (P.metric === "single") why = " Under this rule only a base counts, and " + nm(p) + " is the loudest one.";
        else if (dSnr > 0 && runner.depth > T.depth[p]) why = " " + nm(runner.j) + " is louder by " + f0(dSnr) + " dB, but it sits " + runner.depth + " hop" + (runner.depth === 1 ? "" : "s") + " out, and its own path back costs more than the " + f0(dSnr) + " dB buys: the metric takes the cheaper total, not the louder link.";
        else if (dSnr > 0) why = " " + nm(runner.j) + " is louder by " + f0(dSnr) + " dB and no deeper, and still lost: it already carries " + T.children[runner.j].length + " child" + (T.children[runner.j].length === 1 ? "" : "ren") + " and the metric charges for each, so the load spread instead.";
        else if (runner.depth < T.depth[p]) why = " " + nm(runner.j) + " is closer to the wire but " + f0(-dSnr) + " dB quieter, and under this rule " + f0(-dSnr) + " dB of link costs more than the hop it would save.";
        else why = " " + nm(p) + " is louder by " + f0(-dSnr) + " dB and " + (T.depth[p] < runner.depth ? "closer to the wire" : "no deeper") + ", so the choice was not close.";
      }
      var text = nm(i) + " hears " + (cands.length ? cands.length + " candidate" + (cands.length === 1 ? "" : "s") + ": " + heard + "." : "nobody it could use.") +
                 " It attaches to " + nm(p) + " at SNR " + f0(L.snr) + " (" + rate(L) + ", " + T.depth[i] + " hop" + (T.depth[i] === 1 ? "" : "s") + " to the wire)." + why;
      if (r.backup >= 0) text += " If " + nm(p) + " fails it falls back to " + nm(r.backup) + " (" + T.metricFor(i, r.backup) + ").";
      else text += " There is no second parent: lose " + nm(p) + " and " + nm(i) + " goes dark.";
      if (r.relays > 0) text += " Everything behind it crosses " + r.relays + " relay" + (r.relays === 1 ? "" : "s") + " whose one radio does both jobs, in on one side and out the other, and each such relay halves what passes.";
      if (T.subtree[i] > 1) text += " It relays for " + (T.subtree[i] - 1) + " point" + (T.subtree[i] - 1 === 1 ? "" : "s") + " of its own.";
      text += " Its share of the path back is " + mbs(r.backhaul) + (r.demand > 0 ? " against " + mbs(r.demand) + " its clients ask for" : "") + ".";
      steps.push({ kind: T.depth[i] === 1 ? "hop1" : "hop", title: nm(i) + ", hop " + T.depth[i] + ": parent " + nm(p), text: text });
    });

    /* 4. the ones that never attached */
    for (i = 0; i < n; i++) {
      if (T.depth[i] >= 0) continue;
      var r2 = row(i);
      if (r2.status === "down") { steps.push({ kind: "down", title: nm(i) + " is down", text: "Switched off or failed; the tree above is the one the mesh falls back to without it." }); continue; }
      var best = null;
      for (j = 0; j < n; j++) { if (j === i) continue; var Lb = T.links[i][j]; if (Lb && T.depth[j] >= 0 && (!best || Lb.snr > best.L.snr)) best = { j: j, L: Lb }; }
      var reason = !best ? "No other AP is up." :
        best.L.blockedBy === "band" ? "The nearest, " + nm(best.j) + ", is on a different backhaul band." :
        !best.L.ok ? "The loudest thing it hears is " + nm(best.j) + " at SNR " + f0(best.L.snr) + ", " + f0(NFN.phy.SNRMIN[0] + C.margin - best.L.snr) + " dB short of the " + (NFN.phy.SNRMIN[0] + C.margin) + " the lowest rate needs with the gate." + (best.L.blockedBy ? " The path is blocked by " + best.L.blockedBy + "." : "") :
        "It hears " + nm(best.j) + " at SNR " + f0(best.L.snr) + " but every path is past the " + T.maxHops + " hop ceiling.";
      steps.push({ kind: "orphan", title: nm(i) + " never attaches", text: reason });
    }

    /* 5. the ceiling */
    var bindsText = plan.binds === "uplink" ? "The uplink binds: the mesh could carry " + mbs(plan.meshMbps) + " but only " + mbs(plan.uplink) + " leaves the site."
      : plan.binds === "mesh" ? "The mesh binds: the clients ask for " + mbs(plan.demand) + ", the uplink would take " + mbs(plan.uplink) + ", and the weakest shared hop lets " + mbs(plan.meshMbps) + " through."
      : "Demand binds: the clients ask for " + mbs(plan.demand) + " and both the mesh (" + mbs(plan.meshMbps) + ") and the uplink (" + mbs(plan.uplink) + ") have room.";
    steps.push({ kind: "ceiling", title: "What the tree delivers", text: bindsText + (plan.spof ? " " + plan.spof + " point" + (plan.spof === 1 ? " has" : "s have") + " no fallback." : "") + (plan.unreachable ? " " + plan.unreachable + " never attached." : "") });
    return { steps: steps, hops: T.maxDepth, portals: portals.length, orphans: plan.unreachable };
  };

  /* ── what the AP knows about where it is ──────────────────────────────
     Read from an AP-635 on AOS 10.8.1.0 over Central's remote console, 2026-09-14.
     `show ap gps summary` carries the fix as NMEA sentences ($GNGGA, $GNGNS,
     $GNRMC: latitude, longitude, altitude), `show ap gps ellipse` the error
     ellipse (major and minor axis in metres, angle in degrees) and a `hop` and
     `distance` for a position inherited over a ranged neighbour, `show ap range
     scanning-results` the FTM table (peer BSSID, average RTT in picoseconds,
     RSSI, standard deviation in picoseconds, channel, valid RTTs). These parse
     the pasted text; nothing here talks to an AP. */
  M.gpsParse = function (text) {
    var t = String(text || ""), out = {}, m;
    m = /\$GN(?:GGA|GNS|RMC)\s+(-?\d+\.\d+),\s*(-?\d+\.\d+)\s+(-?\d+(?:\.\d+)?)?\s*M?/i.exec(t);
    if (m) { out.lat = +m[1]; out.lon = +m[2]; if (m[3] !== undefined) out.alt = +m[3]; }
    var kv = function (k) { var r = new RegExp("^\\s*" + k + "\\s+(-?\\d+(?:\\.\\d+)?)", "mi").exec(t); return r ? +r[1] : undefined; };
    if (out.lat === undefined && kv("latitude") !== undefined) { out.lat = kv("latitude"); out.lon = kv("longitude"); }
    if (kv("major-axis") !== undefined) { out.major = kv("major-axis"); out.minor = kv("minor-axis"); out.angle = kv("angle"); }
    if (kv("hop") !== undefined) out.hop = kv("hop");
    if (kv("distance") !== undefined) out.viaDistance = kv("distance");
    m = /^\s*time\s+(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/mi.exec(t); if (m) out.time = m[1];
    m = /GPS Firmware\s+(\w+)/i.exec(t); if (m) out.chip = m[1];
    var cons = []; t.replace(/^\s*(\w+) Constellation\s+Enable/gmi, function (_, c) { cons.push(c); return _; });
    if (cons.length) out.constellations = cons;
    return isFinite(out.lat) && isFinite(out.lon) ? out : null;
  };

  /* an FTM round trip is a distance: light covers 0.29979 mm per picosecond
     and the trip is there and back. The AP-635 on 10.8.1.0 heads its columns
     "Average RTT (ps)" and "Average std (ps)", read 2026-09-25; the Open Locate
     guide's "AP testing and verification" page says nanoseconds, and the AP
     wins over the doc. If a later release prints ns, this factor moves by 1000. */
  M.ftmMetres = function (rttPs) { return rttPs * 299792458e-12 / 2; };
  M.ftmSdMetres = M.ftmMetres;
  M.ftmParse = function (text) {
    var rows = [];
    String(text || "").split("\n").forEach(function (line) {
      var m = /^\s*([0-9a-f]{2}(?::[0-9a-f]{2}){5})\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\S+)\s+(\d+)\s+(\d+)/i.exec(line);
      if (!m) return;
      var rtt = +m[2], sd = +m[4];
      rows.push({ bssid: m[1].toLowerCase(), rttPs: rtt, rssi: +m[3], sdPs: sd, channel: m[5], validRtts: +m[6], ftms: +m[7],
                  metres: M.ftmMetres(rtt), plusMinus: M.ftmSdMetres(sd) });
    });
    return rows;
  };

  /* fixes to a field: equirectangular about the centroid, north up, width and depth
     from their own spans, the same projection the kit and the KML reader use. Returns
     the field size and a point per fix, plus the error ellipses in metres. */
  M.geoPlace = function (fixes) {
    var pts = fixes.filter(function (f) { return f && isFinite(f.lat) && isFinite(f.lon); });
    if (pts.length < 1) return null;
    var lat0 = 0, lon0 = 0;
    pts.forEach(function (f) { lat0 += f.lat; lon0 += f.lon; }); lat0 /= pts.length; lon0 /= pts.length;
    var kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110574, sx = 60, sy = 40;
    var rel = pts.map(function (f) { var x = (f.lon - lon0) * kx, y = -(f.lat - lat0) * ky; sx = Math.max(sx, Math.abs(x) * 2.6 + 2 * (f.major || 0)); sy = Math.max(sy, Math.abs(y) * 2.6 + 2 * (f.major || 0)); return { x: x, y: y, f: f }; });
    var fw = NFN.clamp(Math.round(sx / 10) * 10, 60, 1200), fd = NFN.clamp(Math.round(sy / 10) * 10, 40, 800);
    return { fw: fw, fd: fd, lat0: lat0, lon0: lon0, kx: kx, ky: ky,
             points: rel.map(function (q) { return { x: NFN.clamp(fw / 2 + q.x, 2, fw - 2), y: NFN.clamp(fd / 2 + q.y, 2, fd - 2), fix: q.f }; }) };
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
    /* a crowd nobody reaches is demand nobody delivered */
    return s + 150 * p.coverage + 50 * worst - p.who.unserved * p.askKbps / 1000;
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
  M.resilience = function (st, pairs) {
    var base = M.plan(st), out = [], i, aps = st.aps || [];
    function failing(idxs) {
      var aps2 = aps.map(function (x, k) { var y = {}, q; for (q in x) y[q] = x[q]; if (idxs.indexOf(k) >= 0) y.down = true; return y; }),
          st2 = {}, k;
      for (k in st) st2[k] = st[k];
      st2.aps = aps2;
      var p = M.plan(st2), orphans = [], q2;
      for (q2 = 0; q2 < aps2.length; q2++) if (idxs.indexOf(q2) < 0 && p.aps[q2].status === "unreachable" && base.aps[q2].status !== "unreachable") orphans.push(q2);
      return { idx: idxs, orphans: orphans, meshMbps: p.meshMbps, lost: base.meshMbps - p.meshMbps,
               ceiling: p.ceiling, portalsLeft: p.tree.gateways, coverage: p.coverage };
    }
    aps.forEach(function (a, idx) {
      if (a.down) return;
      var c = failing([idx]); c.i = idx; c.gw = !!a.gw; out.push(c);
    });
    /* lose two: every pair, the worst few reported, because the pair that hurts
       is rarely the pair anyone expected */
    var pairsOut = [];
    if (pairs && aps.length <= 14) {
      var live = []; aps.forEach(function (a, k) { if (!a.down) live.push(k); });
      for (i = 0; i < live.length; i++) for (var j = i + 1; j < live.length; j++) {
        var c2 = failing([live[i], live[j]]); c2.gw = !!(aps[live[i]].gw || aps[live[j]].gw); pairsOut.push(c2);
      }
      pairsOut.sort(function (u, v) { return (v.orphans.length - u.orphans.length) || (v.lost - u.lost); });
    }
    return { base: base, cases: out, pairs: pairsOut.slice(0, 6), pairsTried: pairsOut.length };
  };

  /* what one more portal buys: every point tried as a second portal, judged by
     the orphans across the whole lose-one sweep and the ceiling that remains */
  M.secondPortal = function (st) {
    var aps = st.aps || [], best = null, i, base = M.resilience(st),
        baseOrphans = base.cases.reduce(function (t, c) { return t + c.orphans.length; }, 0);
    for (i = 0; i < aps.length; i++) {
      if (aps[i].gw || aps[i].down) continue;
      var st2 = Object.assign({}, st); st2.aps = aps.map(function (a, k) { return k === i ? Object.assign({}, a, { gw: true }) : a; });
      var R = M.resilience(st2), orphans = R.cases.reduce(function (t, c) { return t + c.orphans.length; }, 0),
          worst = R.cases.reduce(function (t, c) { return Math.min(t, c.ceiling); }, Infinity);
      if (!best || orphans < best.orphans || (orphans === best.orphans && worst > best.worstCeiling)) best = { i: i, orphans: orphans, worstCeiling: worst };
    }
    return { now: baseOrphans, nowWorst: base.cases.reduce(function (t, c) { return Math.min(t, c.ceiling); }, Infinity), best: best };
  };

  /* ── a walk across the field ───────────────────────────────────────────── */
  M.walk = function (st, plan, pts, step) {
    var out = [], dist = 0, i, s = step || 5;
    if (!pts || pts.length < 2) return out;
    for (i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y), k, N = Math.max(1, Math.ceil(L / s));
      for (k = 0; k < N || (i === pts.length - 2 && k === N); k++) {
        var t = Math.min(1, k / N), x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, c = M.client(st, plan, { x: x, y: y });
        out.push({ x: x, y: y, dist: dist + L * t, ap: c.ap, rssi: c.rssi, alone: c.ok ? c.alone : 0, crowd: c.ok ? c.crowd : 0, ok: c.ok });
      }
      dist += L;
    }
    return out;
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
                         Math.max(plan.uplink - plan.demand, plan.uplink / (plan.clients + 1)), Math.max(ap.cellMbps - ap.demand, ap.cellMbps / (ap.clients + 1))),
        bind = alone === link ? "the client's own link" : alone === bh ? "the backhaul behind that AP" : "the uplink";
    return { ap: best, rssi: bestR, snr: snr, mcs: mcs, std: dev.std, bw: bw,
             phyMbps: mcs >= 0 ? NFN.phy.rate(dev.std, mcs, dev.ss, bw) : 0, linkMbps: link,
             alone: alone, crowd: crowd, binds: bind, hops: ap.depth,
             ok: mcs >= 0, why: mcs < 0 ? "too far from any AP to hold a rate" : "" };
  };
})(typeof window !== "undefined" ? window : globalThis);
