/* Reading an Ekahau project. An .esx is a zip of JSON files and images; this
   opens the zip by hand (the central directory, then each entry through the
   browser's own deflate) and turns floor plans and access points into the
   planner's field and masts. No library, no DOM: it runs in node the same way.
   Written against the .esx layout as seen in Ekahau AI Pro exports, 2026-09;
   field names that are not there are skipped, not guessed. */
(function (root) {
  var NFN = root.NFN = root.NFN || {};
  var E = NFN.esx = {};

  function u16(v, o) { return v.getUint16(o, true); }
  function u32(v, o) { return v.getUint32(o, true); }
  function utf8(bytes) { return new TextDecoder("utf-8").decode(bytes); }

  /* list the entries: name, method, sizes, where the data starts */
  E.entries = function (buf) {
    var v = new DataView(buf), n = buf.byteLength, i, eocd = -1;
    for (i = n - 22; i >= Math.max(0, n - 70000); i--) if (u32(v, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("not a zip file");
    var count = u16(v, eocd + 10), cd = u32(v, eocd + 16), out = [], p = cd, k;
    for (k = 0; k < count; k++) {
      if (u32(v, p) !== 0x02014b50) break;
      var method = u16(v, p + 10), csize = u32(v, p + 20), usize = u32(v, p + 24),
          nl = u16(v, p + 28), el = u16(v, p + 30), cl = u16(v, p + 32), off = u32(v, p + 42),
          name = utf8(new Uint8Array(buf, p + 46, nl));
      var lnl = u16(v, off + 26), lel = u16(v, off + 28), start = off + 30 + lnl + lel;
      out.push({ name: name, method: method, csize: csize, usize: usize, start: start });
      p += 46 + nl + el + cl;
    }
    return out;
  };

  /* the bytes of one entry, inflated where needed; a promise */
  E.read = function (buf, entry) {
    var slice = buf.slice(entry.start, entry.start + entry.csize);
    if (entry.method === 0) return Promise.resolve(slice);
    if (entry.method !== 8) return Promise.reject(new Error("unsupported compression " + entry.method + " in " + entry.name));
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("this browser cannot inflate a zip; try a current Chrome, Safari or Firefox"));
    var ds = new DecompressionStream("deflate-raw"), w = ds.writable.getWriter();
    w.write(new Uint8Array(slice)); w.close();
    return new Response(ds.readable).arrayBuffer();
  };
  E.readJson = function (buf, entries, name) {
    var e = entries.filter(function (x) { return x.name === name || x.name.split("/").pop() === name; })[0];
    if (!e) return Promise.resolve(null);
    return E.read(buf, e).then(function (b) { return JSON.parse(utf8(new Uint8Array(b))); });
  };

  /* an Ekahau antenna name to one of the planner's five, by the words in it */
  E.antennaFor = function (name) {
    var s = String(name || "").toLowerCase();
    if (/omni|dipole|internal/.test(s)) return "omni";
    var bw = /(\d{2,3})\s*(?:deg|°)/.exec(s), b = bw ? parseInt(bw[1], 10) : null;
    if (/dish|grid|parabol|point.to.point|ptp/.test(s) || (b !== null && b <= 20)) return "dish";
    if (/sector|panel|patch|directional|yagi/.test(s)) return b !== null && b <= 60 ? "pnarrow" : "pwide";
    return "omni";
  };

  /* the whole project, reduced to what the planner wants: floors, and per
     floor the field size, the image entry, and the APs the surveyor owns */
  E.project = function (buf) {
    var entries = E.entries(buf);
    return Promise.all([
      E.readJson(buf, entries, "floorPlans.json"), E.readJson(buf, entries, "accessPoints.json"),
      E.readJson(buf, entries, "simulatedRadios.json"), E.readJson(buf, entries, "antennaTypes.json"),
      E.readJson(buf, entries, "project.json"),
      E.readJson(buf, entries, "wallTypes.json"), E.readJson(buf, entries, "wallSegments.json"), E.readJson(buf, entries, "wallPoints.json"),
      E.readJson(buf, entries, "requirements.json")
    ]).then(function (r) {
      var floors = (r[0] && r[0].floorPlans) || [], aps = (r[1] && r[1].accessPoints) || [],
          radios = (r[2] && r[2].simulatedRadios) || [], types = (r[3] && r[3].antennaTypes) || [],
          wallTypes = (r[5] && r[5].wallTypes) || [], wallSegs = (r[6] && r[6].wallSegments) || [], wallPts = (r[7] && r[7].wallPoints) || [],
          reqs = (r[8] && r[8].requirements) || [],
          typeById = {}, radiosByAp = {}, wtById = {}, wpById = {};
      types.forEach(function (t) { typeById[t.id] = t; });
      wallTypes.forEach(function (w) { wtById[w.id] = w; });
      wallPts.forEach(function (q) { wpById[q.id] = q; });
      /* a wall type's loss per crossing on a band: attenuation per metre times thickness */
      function wallDb(w, band) {
        var pp = (w.propagationProperties || []).filter(function (q) { return q.band === band; })[0] || (w.propagationProperties || [])[0];
        return pp ? (pp.attenuationFactor || 0) * (w.thickness || 0) : 0;
      }
      /* the default requirement, Ekahau style: primary and secondary signal, SNR, rate, on 5 GHz */
      var req = reqs.filter(function (q) { return q.isDefault; })[0] || reqs[0] || null, reqOut = null;
      if (req) {
        reqOut = { name: req.name };
        (req.criteria || []).forEach(function (cr) {
          if (cr.frequencyBand !== "FIVE") return;
          if (cr.type === "SIGNAL_STRENGTH") reqOut.primary = cr.value; if (cr.type === "SECONDARY_SIGNAL_STRENGTH") reqOut.secondary = cr.value;
          if (cr.type === "SIGNAL_TO_NOISE_RATIO") reqOut.snr = cr.value; if (cr.type === "DATA_RATE") reqOut.rate = cr.value;
        });
      }
      radios.forEach(function (rd) { (radiosByAp[rd.accessPointId] = radiosByAp[rd.accessPointId] || []).push(rd); });
      return {
        name: r[4] && r[4].name, entries: entries, requirement: reqOut,
        /* every antenna type with its measured planes, so the planner can use
           Ekahau's patterns instead of a beamwidth fit */
        antennas: types.filter(function (t) { return t.hplane && t.eplane && t.hplane.gains && t.eplane.gains; }).map(function (t) {
          return { id: t.id, name: t.name, band: t.frequencyBand, maxGain: t.maxGain, tilt: t.defaultTiltAngle || 0, directional: !!t.directional, mounting: t.defaultMounting,
                   hplane: t.hplane.gains.map(function (g) { return g.gain; }), eplane: t.eplane.gains.map(function (g) { return g.gain; }), model: t.apModel, vendor: t.apVendor };
        }),
        floors: floors.map(function (f) {
          var mpu = f.metersPerUnit || 1, image = entries.filter(function (x) { return f.imageId && x.name.indexOf(f.imageId) >= 0; })[0] || null;
          return {
            id: f.id, name: f.name, w: (f.width || 0) * mpu, d: (f.height || 0) * mpu, metersPerUnit: mpu,
            pxW: f.width || 0, pxH: f.height || 0, image: image,
            walls: wallSegs.filter(function (ws) { var q = wpById[ws.wallPoints && ws.wallPoints[0]]; return q && q.location && q.location.floorPlanId === f.id; }).map(function (ws) {
              var p1 = wpById[ws.wallPoints[0]], p2 = wpById[ws.wallPoints[1]], wt = wtById[ws.wallTypeId];
              if (!p1 || !p2) return null;
              return { x1: p1.location.coord.x * mpu, y1: p1.location.coord.y * mpu, x2: p2.location.coord.x * mpu, y2: p2.location.coord.y * mpu,
                       db: wt ? wallDb(wt, "FIVE") : 3, db24: wt ? wallDb(wt, "TWO") : 3, db6: wt ? wallDb(wt, "SIX") : 3, type: wt ? wt.name : "wall" };
            }).filter(Boolean),
            aps: aps.filter(function (a) { return a.location && a.location.floorPlanId === f.id && a.mine !== false; }).map(function (a) {
              /* the 5 GHz radio, or the first, carries the height, aim and power */
              var rs = radiosByAp[a.id] || [], five = rs.filter(function (rd) { var t = typeById[rd.antennaTypeId]; return t && /FIVE|5/.test(String(t.frequencyBand || "")); })[0] || rs[0] || {},
                  t = typeById[five.antennaTypeId], antName = t ? t.name : "",
                  ch = Array.isArray(five.channel) ? five.channel : (five.channel !== undefined ? [five.channel] : []);
              return {
                name: a.name, vendor: a.vendor, model: a.model, x: a.location.coord.x * mpu, y: a.location.coord.y * mpu,
                h: five.antennaHeight !== undefined ? five.antennaHeight : null,
                /* Ekahau's direction reads clockwise from the top of the image;
                   the planner's azimuth reads from the right hand edge */
                aim: five.antennaDirection !== undefined ? five.antennaDirection - 90 : null,
                tilt: five.antennaTilt !== undefined ? five.antennaTilt : 0,
                tx: five.transmitPower !== undefined ? five.transmitPower : null,
                channel: ch.length ? ch[0] : null, width: ch.length ? 20 * ch.length : null,
                antennaName: antName, ant: E.antennaFor(antName), antennaTypeId: five.antennaTypeId || null,
                mounting: five.antennaMounting || (t && t.defaultMounting) || null,
                external: t ? /EXTERNAL/.test(String(t.apCoupling || "")) : false
              };
            })
          };
        })
      };
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
