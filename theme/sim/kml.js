/* Reading what Google Earth saves. A KML is XML, a KMZ is a zip of one plus
   its images. What comes across is what somebody drew: placemarks become
   masts, extruded polygons become buildings, a path becomes the walk, and a
   ground overlay becomes the picture under the map with its own bounds. The
   photographed city and the terrain never leave Google Earth, so they cannot
   come here; say so rather than pretend. No DOM: a small tag reader, so it
   runs in node the same way. */
(function (root) {
  var NFN = root.NFN = root.NFN || {};
  var K = NFN.kml = {};

  function blocks(xml, tag) {
    var out = [], re = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "g"), m;
    while ((m = re.exec(xml))) out.push(m[1]);
    return out;
  }
  function text(xml, tag) {
    var m = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">").exec(xml);
    return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : null;
  }
  function coords(xml) {
    var c = text(xml, "coordinates"); if (!c) return [];
    return c.trim().split(/\s+/).map(function (t) { var b = t.split(","); return { lon: parseFloat(b[0]), lat: parseFloat(b[1]), alt: b[2] !== undefined ? parseFloat(b[2]) : 0 }; })
            .filter(function (q) { return isFinite(q.lon) && isFinite(q.lat); });
  }

  /* every placemark, with its geometry kind and points */
  K.parse = function (xml) {
    var out = { placemarks: [], overlays: [] };
    blocks(xml, "Placemark").forEach(function (pm) {
      var name = text(pm, "name") || "", desc = text(pm, "description") || "", extrude = (text(pm, "extrude") || "0") === "1",
          mode = text(pm, "altitudeMode") || "clampToGround";
      if (/<Point>/.test(pm)) out.placemarks.push({ kind: "point", name: name, desc: desc, pts: coords(blocks(pm, "Point")[0] || ""), mode: mode });
      else if (/<LineString>/.test(pm)) out.placemarks.push({ kind: "line", name: name, desc: desc, pts: coords(blocks(pm, "LineString")[0] || ""), mode: mode });
      else if (/<Polygon>/.test(pm)) {
        var outer = blocks(pm, "outerBoundaryIs")[0] || blocks(pm, "Polygon")[0] || "";
        out.placemarks.push({ kind: "polygon", name: name, desc: desc, pts: coords(outer), extrude: extrude, mode: mode });
      }
    });
    blocks(xml, "GroundOverlay").forEach(function (go) {
      var box = blocks(go, "LatLonBox")[0] || "", href = text(go, "href");
      if (!box || !href) return;
      out.overlays.push({ name: text(go, "name") || "", href: href, north: parseFloat(text(box, "north")), south: parseFloat(text(box, "south")),
                          east: parseFloat(text(box, "east")), west: parseFloat(text(box, "west")), rotation: parseFloat(text(box, "rotation") || "0") });
    });
    return out;
  };

  /* metres on a flat field from degrees: an equirectangular projection about
     the middle of everything drawn, north up, x east, y south */
  K.project = function (parsed, margin) {
    var all = [], m = margin === undefined ? 20 : margin;
    parsed.placemarks.forEach(function (p) { all = all.concat(p.pts); });
    parsed.overlays.forEach(function (o) { all.push({ lat: o.north, lon: o.west }, { lat: o.south, lon: o.east }); });
    if (!all.length) return null;
    var lat0 = 0, lon0 = 0; all.forEach(function (q) { lat0 += q.lat; lon0 += q.lon; }); lat0 /= all.length; lon0 /= all.length;
    var kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
    function xy(q) { return { x: (q.lon - lon0) * kx, y: -(q.lat - lat0) * ky, alt: q.alt || 0 }; }
    var pts = all.map(xy), minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (q) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); });
    var ox = minX - m, oy = minY - m;
    return {
      lat0: lat0, lon0: lon0, w: Math.max(20, maxX - minX + 2 * m), d: Math.max(20, maxY - minY + 2 * m),
      toField: function (q) { var p = xy(q); return { x: p.x - ox, y: p.y - oy, alt: p.alt }; }
    };
  };

  /* the planner's objects: which drawn thing becomes what is decided by the
     geometry first and the name second */
  K.toSite = function (parsed) {
    var pr = K.project(parsed); if (!pr) return null;
    var aps = [], obstacles = [], crowds = [], path = null, notes = [];
    parsed.placemarks.forEach(function (p) {
      var nm = p.name.toLowerCase(), f;
      if (p.kind === "point" && p.pts.length) {
        f = pr.toField(p.pts[0]);
        if (/crowd|stage|audience|people/.test(nm)) crowds.push({ x: f.x, y: f.y, r: 30, n: /(\d{2,5})/.test(p.name) ? parseInt(/(\d{2,5})/.exec(p.name)[1], 10) : 200 });
        else if (/tree|wood|copse|hedge/.test(nm)) obstacles.push({ x: f.x, y: f.y, type: "tree", h: 9, r: 8 });
        else {
          var h = /(\d+(?:\.\d+)?)\s*m\b/.exec(p.name), hm = h ? parseFloat(h[1]) : (p.mode === "relativeToGround" && f.alt > 0 ? f.alt : 3);
          aps.push({ x: f.x, y: f.y, h: Math.max(0.5, Math.min(15, hm)), gw: /portal|uplink|gateway|fib|satellite/.test(nm), name: p.name });
        }
      } else if (p.kind === "polygon" && p.pts.length >= 3) {
        var cx = 0, cy = 0, n = p.pts.length - (p.pts[0].lat === p.pts[p.pts.length - 1].lat && p.pts[0].lon === p.pts[p.pts.length - 1].lon ? 1 : 0), i, fp = [], area = 0;
        for (i = 0; i < n; i++) { f = pr.toField(p.pts[i]); fp.push(f); cx += f.x; cy += f.y; }
        cx /= n; cy /= n;
        for (i = 0; i < n; i++) { var a = fp[i], b = fp[(i + 1) % n]; area += a.x * b.y - b.x * a.y; }
        area = Math.abs(area) / 2;
        var r = Math.sqrt(area / Math.PI), alt = Math.max.apply(null, p.pts.map(function (q) { return q.alt || 0; })),
            hgt = p.extrude && alt > 0 ? alt : (/(\d+(?:\.\d+)?)\s*m\b/.test(p.name) ? parseFloat(/(\d+(?:\.\d+)?)\s*m\b/.exec(p.name)[1]) : 10);
        if (/crowd|stage|audience|people/.test(nm)) crowds.push({ x: cx, y: cy, r: Math.max(5, Math.min(150, r)), n: /(\d{2,5})/.test(p.name) ? parseInt(/(\d{2,5})/.exec(p.name)[1], 10) : Math.round(area / 2) });
        else obstacles.push({ x: cx, y: cy, type: /tree|wood|copse|hedge/.test(nm) ? "tree" : /truck|stage|stand|tent/.test(nm) ? "truck" : "building", h: Math.max(1, Math.min(30, hgt)), r: Math.max(2, Math.min(60, r)) });
      } else if (p.kind === "line" && p.pts.length >= 2 && !path) {
        path = p.pts.map(function (q) { return pr.toField(q); }).map(function (q) { return { x: q.x, y: q.y }; });
      }
    });
    if (aps.length && !aps.some(function (a) { return a.gw; })) aps[0].gw = true;
    var overlay = null;
    if (parsed.overlays.length) {
      var o = parsed.overlays[0], nw = pr.toField({ lat: o.north, lon: o.west }), se = pr.toField({ lat: o.south, lon: o.east });
      overlay = { href: o.href, x: nw.x, y: nw.y, w: se.x - nw.x, d: se.y - nw.y, rotation: o.rotation || 0 };
      if (Math.abs(overlay.rotation) > 0.5) notes.push("the overlay is rotated " + overlay.rotation.toFixed(0) + " degrees in Google Earth; it is laid flat here");
    }
    if (parsed.placemarks.some(function (p) { return p.kind === "polygon" && !p.extrude; })) notes.push("flat polygons were taken as buildings 10 m high unless their name says a height, like \"barn 6 m\"");
    notes.push("Google Earth's own 3D buildings and terrain do not export; only what you drew comes across");
    return { w: pr.w, d: pr.d, aps: aps, obstacles: obstacles, crowds: crowds, path: path, overlay: overlay, notes: notes, lat0: pr.lat0, lon0: pr.lon0 };
  };

  /* a .kml or .kmz as an ArrayBuffer: a promise of the site */
  K.open = function (buf) {
    var head = new Uint8Array(buf, 0, 4), isZip = head[0] === 0x50 && head[1] === 0x4b;
    if (!isZip) return Promise.resolve({ site: K.toSite(K.parse(new TextDecoder("utf-8").decode(new Uint8Array(buf)))), image: null });
    var E = NFN.esx, entries = E.entries(buf), doc = entries.filter(function (e) { return /\.kml$/i.test(e.name); })[0];
    if (!doc) return Promise.reject(new Error("no .kml inside the .kmz"));
    return E.read(buf, doc).then(function (b) {
      var site = K.toSite(K.parse(new TextDecoder("utf-8").decode(new Uint8Array(b))));
      if (!site || !site.overlay) return { site: site, image: null };
      var img = entries.filter(function (e) { return e.name === site.overlay.href || e.name.split("/").pop() === site.overlay.href.split("/").pop(); })[0];
      if (!img) return { site: site, image: null };
      return E.read(buf, img).then(function (ib) { return { site: site, image: ib }; });
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
