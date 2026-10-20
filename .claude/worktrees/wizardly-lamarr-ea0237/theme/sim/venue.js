/* Aiming an antenna at a block of seats.
   A seating section is a trapezoid: a near row, a far row, and the rows between.
   That is how you count one standing in it, and it is all the geometry needs. */
(function (root) {
  var NFN = root.NFN = root.NFN || {};
  var V = NFN.venue = {};
  var D = Math.PI / 180;

  /* rake in degrees, row pitch and seat width in metres, take is the share of
     seats that actually associate during a busy event */
  V.VENUES = {
    arena:    { label: "Arena bowl",      rake: 28, pitch: 0.85, seat: 0.50, take: 0.45, mount: 14, dist: 18, body: 5 },
    stadium:  { label: "Stadium",         rake: 30, pitch: 0.80, seat: 0.48, take: 0.35, mount: 20, dist: 26, body: 6 },
    theatre:  { label: "Theatre",         rake: 14, pitch: 0.95, seat: 0.55, take: 0.25, mount: 9,  dist: 12, body: 4 },
    ballroom: { label: "Ballroom, flat",  rake: 0,  pitch: 1.40, seat: 0.60, take: 0.55, mount: 6,  dist: 8,  body: 4 }
  };
  V.venue = function (id) { return V.VENUES[id] || V.VENUES.arena; };

  /* h and v are the half power beamwidths in degrees. Gain is the honest figure
     off a datasheet rather than the 41253/(h*v) ideal, which no real antenna hits. */
  V.ANTENNAS = [
    { id: "omni",    label: "Omni, ceiling mount",      g: 4,  h: 360, v: 40 },
    { id: "patch65", label: "Patch, 65 degrees",        g: 8,  h: 65,  v: 65 },
    { id: "patch45", label: "Patch, 45 degrees",        g: 10, h: 45,  v: 45 },
    { id: "sect30",  label: "Sector, 30 degrees",       g: 13, h: 30,  v: 30 },
    { id: "sect20",  label: "Narrow sector, 20 degrees", g: 15, h: 20, v: 20 },
    { id: "sect12",  label: "Very narrow, 12 degrees",  g: 18, h: 12,  v: 12 },
    { id: "under",   label: "Under seat, firing up",    g: 3,  h: 360, v: 60 }
  ];
  V.antenna = function (id) { return V.ANTENNAS.filter(function (a) { return a.id === id; })[0] || V.ANTENNAS[3]; };

  /* the trapezoid */
  V.section = function (nearSeats, farSeats, rows, ven) {
    var v = V.venue(ven), n = Math.max(1, Math.round(rows));
    return {
      rows: n, nearSeats: nearSeats, farSeats: farSeats,
      seats: Math.round(n * (nearSeats + farSeats) / 2),
      depth: n * v.pitch,
      nearW: nearSeats * v.seat, farW: farSeats * v.seat
    };
  };

  /* Per row: where it is relative to the antenna, how far away, how wide it looks.
     mountH is the antenna above the first row; dist is the horizontal run to it.
     A mount lower than the back of the section gives negative depression, which
     is a real answer and not an error: that is what an under-seat AP does. */
  V.rows = function (sec, ven, mountH, dist) {
    var v = V.venue(ven), out = [], i, n = sec.rows,
        cr = Math.cos(v.rake * D), sr = Math.sin(v.rake * D);
    for (i = 0; i < n; i++) {
      var t = n > 1 ? i / (n - 1) : 0,
          x = dist + i * v.pitch * cr,
          rise = i * v.pitch * sr,
          dh = mountH - rise,
          slant = Math.hypot(x, dh),
          seats = sec.nearSeats + (sec.farSeats - sec.nearSeats) * t,
          width = seats * v.seat;
      out.push({
        i: i, x: x, rise: rise, slant: slant, seats: seats, width: width,
        depression: Math.atan2(dh, x) / D,
        halfWidthAngle: Math.atan((width / 2) / slant) / D
      });
    }
    return out;
  };

  /* what the section demands of an antenna */
  V.demand = function (rowsArr) {
    var first = rowsArr[0], last = rowsArr[rowsArr.length - 1], i, hNeed = 0;
    for (i = 0; i < rowsArr.length; i++) hNeed = Math.max(hNeed, rowsArr[i].halfWidthAngle * 2);
    return {
      near: first, far: last,
      tilt: (first.depression + last.depression) / 2,
      vNeed: Math.abs(first.depression - last.depression),
      hNeed: hNeed
    };
  };

  /* what an antenna actually lands on, at the half power contour. That contour is
     where the signal is 3 dB down, not where coverage stops, so this is the useful
     cell rather than the last row that can hear anything. */
  V.footprint = function (sec, ven, mountH, dist, antId, tiltOverride) {
    var v = V.venue(ven), a = V.antenna(antId), rowsArr = V.rows(sec, ven, mountH, dist),
        d = V.demand(rowsArr),
        tilt = tiltOverride === undefined || tiltOverride === null ? d.tilt : tiltOverride,
        halfV = a.v / 2, halfH = a.h >= 360 ? 180 : a.h / 2,
        seatsCovered = 0, rowsCovered = [], i;
    for (i = 0; i < rowsArr.length; i++) {
      var r = rowsArr[i];
      if (Math.abs(r.depression - tilt) > halfV) continue;
      rowsCovered.push(r.i);
      var across = halfH >= 180 ? r.width : 2 * r.slant * Math.tan(halfH * D);
      seatsCovered += Math.min(r.seats, across / v.seat);
    }
    return {
      antenna: a, tilt: tilt, demand: d, rows: rowsArr,
      rowsCovered: rowsCovered,
      firstRow: rowsCovered.length ? rowsCovered[0] : -1,
      lastRow: rowsCovered.length ? rowsCovered[rowsCovered.length - 1] : -1,
      seatsCovered: Math.round(seatsCovered),
      vFits: a.v >= d.vNeed, hFits: a.h >= d.hNeed
    };
  };

  /* signal at a row. Line of sight from a catwalk is close enough to free space;
     a full bowl adds the crowd, which is the whole reason under seat works. */
  V.signal = function (row, antId, opts) {
    var a = V.antenna(antId), o = opts || {},
        f = o.fGHz || 5.2, bw = o.bw || 40,
        tx = o.txDbm === undefined ? 20 : o.txDbm,
        client = o.clientDbi === undefined ? 0 : o.clientDbi,
        body = o.full ? (o.bodyDb === undefined ? 5 : o.bodyDb) : 0,
        rssi = tx + a.g + client - NFN.rf.fspl(row.slant, f) - body,
        nf = NFN.rf.noiseFloor(bw, 7);
    return { rssi: rssi, snr: rssi - nf, noise: nf, mcs: NFN.phy.mcsFor(o.std || "ax", rssi - nf) };
  };

  /* A section almost never wants one antenna. Capacity says how many radios it
     needs, so the real question is how to carve it up and what beamwidth each
     block then asks for. Blocks split across the seats and down the rows; the
     deepest band is the fussiest because it is furthest and flattest. */
  V.split = function (sec, ven, mountH, dist, nAps) {
    var all = V.rows(sec, ven, mountH, dist), best = null, across, deep, b;
    for (across = 1; across <= 6; across++) {
      for (deep = 1; deep <= 6; deep++) {
        var blocks = across * deep;
        if (blocks < nAps || blocks > nAps + 2) continue;
        var per = Math.ceil(sec.rows / deep), bands = [], ok = true;
        for (b = 0; b < deep; b++) {
          var r0 = b * per, r1 = Math.min(sec.rows - 1, (b + 1) * per - 1);
          if (r0 > sec.rows - 1) { ok = false; break; }
          var rws = all.slice(r0, r1 + 1), dem = V.demand(rws), last = rws[rws.length - 1],
              hAng = 2 * Math.atan((last.width / across / 2) / last.slant) / D, seats = 0, k;
          for (k = 0; k < rws.length; k++) seats += rws[k].seats;
          bands.push({ from: r0, to: r1, tilt: dem.tilt, vNeed: dem.vNeed, hNeed: hAng,
                       seats: Math.round(seats / across), slant: last.slant });
        }
        if (!ok || !bands.length) continue;
        var vMax = 0, hMax = 0;
        for (b = 0; b < bands.length; b++) { vMax = Math.max(vMax, bands[b].vNeed); hMax = Math.max(hMax, bands[b].hNeed); }
        var fit = V.ANTENNAS.filter(function (a2) { return a2.id !== "under" && a2.v >= vMax && a2.h >= hMax; })
                            .sort(function (x, y) { return x.v * x.h - y.v * y.h; })[0];
        if (!fit) continue;
        var waste = (fit.v * fit.h) / Math.max(1, vMax * hMax);
        if (!best || waste < best.waste) {
          best = { across: across, deep: deep, blocks: blocks, bands: bands,
                   antenna: fit, waste: waste, vNeed: vMax, hNeed: hMax };
        }
      }
    }
    return best;
  };

  /* the whole answer for one section */
  V.plan = function (st) {
    var ven = st.venue || "arena", v = V.venue(ven),
        sec = V.section(st.nearSeats, st.farSeats, st.rows, ven),
        fp = V.footprint(sec, ven, st.mountH, st.dist, st.ant, st.tilt),
        take = st.take === undefined ? v.take : st.take,
        clients = Math.round(sec.seats * take),
        cap = NFN.capacity.plan({
          band: st.band || "5", dfs: st.dfs, overlap: st.overlap === undefined ? 0.3 : st.overlap,
          bw: st.bw || 40, retry: st.retry === undefined ? 0.15 : st.retry,
          ssids: st.ssids || 2, target: st.target || 0.5,
          maxPerRadio: st.maxPerRadio || 60,
          groups: [{ n: clients, dev: st.dev || "ax2", app: st.app || "stream" }]
        }),
        seatsPerAp = cap.aps > 0 ? sec.seats / cap.aps : sec.seats,
        ratio = seatsPerAp > 0 ? fp.seatsCovered / seatsPerAp : 0,
        near = V.signal(fp.rows[0], st.ant, st),
        far = V.signal(fp.rows[fp.rows.length - 1], st.ant, st);

    var verdict, why;
    if (!fp.rowsCovered.length) {
      verdict = "misses"; why = "This antenna's beam does not land on the section at all at that tilt.";
    } else if (!fp.vFits) {
      verdict = "narrow";
      why = "The section needs " + fp.demand.vNeed.toFixed(0) + " degrees vertically and this antenna gives " +
            fp.antenna.v + ", so rows " + (fp.firstRow + 1) + " to " + (fp.lastRow + 1) +
            " get the good signal and the rest sit outside the main lobe.";
    } else if (ratio > 1.3) {
      verdict = "wide";
      why = "One of these covers " + fp.seatsCovered + " seats, but capacity says an access point here should carry about " +
            Math.round(seatsPerAp) + ". The beam is doing more than the radio can. Narrow the pattern or split the section.";
    } else if (ratio < 0.7) {
      verdict = "tight";
      why = "One of these covers " + fp.seatsCovered + " seats against the " + Math.round(seatsPerAp) +
            " an access point could carry, so coverage rather than capacity sets the count and you will buy more radios than the load needs.";
    } else {
      verdict = "good";
      why = "One of these covers " + fp.seatsCovered + " seats and capacity says an access point here should carry about " +
            Math.round(seatsPerAp) + ". The antenna and the radio are asking for the same thing.";
    }

    return {
      venue: v, section: sec, fp: fp, clients: clients, take: take,
      capacity: cap, aps: cap.aps, seatsPerAp: seatsPerAp, ratio: ratio,
      near: near, far: far, verdict: verdict, why: why,
      split: V.split(sec, ven, st.mountH, st.dist, cap.aps),
      /* what the installer needs, in the order they need it */
      sheet: [
        "Section: " + sec.seats + " seats, " + sec.rows + " rows, " + sec.nearSeats + " across at the front and " + sec.farSeats + " at the back",
        "Antenna: " + fp.antenna.label + ", " + fp.antenna.g + " dBi, " + fp.antenna.h + " by " + fp.antenna.v + " degrees",
        "Mount: " + st.mountH.toFixed(1) + " m above the first row, " + st.dist.toFixed(1) + " m back from it",
        "Down-tilt: " + fp.tilt.toFixed(0) + " degrees",
        "Covers: rows " + (fp.firstRow + 1) + " to " + (fp.lastRow + 1) + ", about " + fp.seatsCovered + " seats",
        "Throw: " + fp.rows[0].slant.toFixed(1) + " m to the first row, " + fp.rows[fp.rows.length - 1].slant.toFixed(1) + " m to the last",
        "Signal: " + near.rssi.toFixed(0) + " dBm at the front, " + far.rssi.toFixed(0) + " dBm at the back" +
          (st.full ? ", full bowl" : ", empty bowl"),
        "Radios for this section: " + cap.aps + " at " + Math.round(take * 100) + "% take rate, " + clients + " clients"
      ].concat((function () {
        var sp = V.split(sec, ven, st.mountH, st.dist, cap.aps);
        if (!sp) return [];
        return ["", "Split " + sp.across + " across by " + sp.deep + " deep, " + sp.blocks +
                " blocks of about " + Math.round(sec.seats / sp.blocks) + " seats, " +
                sp.antenna.label + " on each"].concat(sp.bands.map(function (bd, i) {
          return "  band " + (i + 1) + ": rows " + (bd.from + 1) + " to " + (bd.to + 1) +
                 ", tilt " + bd.tilt.toFixed(0) + " degrees, needs " + bd.vNeed.toFixed(0) +
                 " by " + bd.hNeed.toFixed(0) + ", " + bd.seats + " seats a block";
        }));
      })())
    };
  };
})(typeof window !== "undefined" ? window : globalThis);
