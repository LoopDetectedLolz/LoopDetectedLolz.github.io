/* NFN.story: what happened on a site, read from the story block that
   central-pull.py --story writes (every client's hops, every radio's noise and
   utilisation, reboots, channel moves, the audit trail, traffic). Four readings
   of the same data, none of them drawing anything:
     bins/spikes/explain   roams per bin across every client, the spikes, and what
                           changed in the minutes before each one
     graph/whatIf          the radios as a graph joined by AirMatch's measured path
                           loss, coloured where they share a channel, and the same
                           graph after one radio moves
     weather               hour-by-day utilisation and noise per radio, with the
                           hours the noise floor rose
     actual                what each AP actually carried, beside the plan */
(function () {
  "use strict";
  var S = NFN.story = {};

  S.hops = function (story) {
    var out = [];
    ((story && story.trails) || []).forEach(function (t) {
      (t.hops || []).forEach(function (h) {
        if (!h || !isFinite(h.ts)) return;
        var o = Object.assign({ mac: t.mac, client: t.name || t.mac }, h);
        /* a landing louder than -10 dBm is a placeholder, not a reading */
        if (o.rssi_dbm !== null && !(o.rssi_dbm < -10)) o.rssi_dbm = null;
        out.push(o);
      });
    });
    out.sort(function (a, b) { return a.ts - b.ts; });
    return out;
  };

  /* roams per bin; binS in seconds. A bin knows how many different clients
     moved, because twelve devices in one minute is a network event and twelve
     hops from one restless watch is not. */
  S.bins = function (hops, binS, from, to) {
    binS = binS || 600;
    if (!hops.length) return [];
    from = from === undefined ? hops[0].ts : from; to = to === undefined ? hops[hops.length - 1].ts : to;
    var t0 = Math.floor(from / binS) * binS, n = Math.max(1, Math.ceil((to - t0 + 1) / binS)), bins = [], i;
    for (i = 0; i < n; i++) bins.push({ ts: t0 + i * binS, n: 0, clients: 0, joins: 0, slow: 0, _c: {} });
    hops.forEach(function (h) {
      var k = Math.floor((h.ts - t0) / binS); if (k < 0 || k >= n) return;
      var b = bins[k]; b.n++; b._c[h.mac] = 1; if (h.join) b.joins++; if (h.latency_ms > 500) b.slow++;
    });
    bins.forEach(function (b) { b.clients = Object.keys(b._c).length; delete b._c; });
    return bins;
  };

  /* a spike is a bin where several different clients moved together: at least
     three, and more than the mean plus two deviations of the busy bins */
  S.spikes = function (bins) {
    var busy = bins.filter(function (b) { return b.n > 0; });
    if (!busy.length) return [];
    var mean = busy.reduce(function (t, b) { return t + b.clients; }, 0) / busy.length,
        sd = Math.sqrt(busy.reduce(function (t, b) { return t + (b.clients - mean) * (b.clients - mean); }, 0) / busy.length),
        thr = Math.max(3, mean + 2 * sd);
    return bins.filter(function (b) { return b.clients >= thr; }).sort(function (a, b) { return b.clients - a.clients; });
  };

  /* what changed in the window before a moment: events from beforeS before to afterS after */
  S.nearEvents = function (ts, events, beforeS, afterS) {
    beforeS = beforeS === undefined ? 600 : beforeS; afterS = afterS === undefined ? 120 : afterS;
    return (events || []).filter(function (e) { return e.ts >= ts - beforeS && e.ts <= ts + afterS; });
  };

  /* one sentence per spike, honest about what is and is not known */
  S.explain = function (spike, events, binS) {
    var near = S.nearEvents(spike.ts + (binS || 600), events, (binS || 600) + 600, 120), kinds = {};
    near.forEach(function (e) { kinds[e.kind] = (kinds[e.kind] || 0) + 1; });
    var who = spike.clients + " client" + (spike.clients === 1 ? "" : "s") + " roamed" + (spike.joins ? " (" + spike.joins + " fresh join" + (spike.joins === 1 ? "" : "s") + ")" : "") + (spike.slow ? ", " + spike.slow + " roam" + (spike.slow === 1 ? "" : "s") + " slower than half a second" : "");
    if (!near.length) return { text: who + " with nothing in the record to explain it: no reboot, channel move or configuration change within ten minutes. People moved, or something outside Central's view did.", events: near, kind: "unexplained" };
    var parts = [];
    if (kinds.reboot) parts.push(kinds.reboot + " AP" + (kinds.reboot === 1 ? "" : "s") + " came back up");
    if (kinds.channel) parts.push(kinds.channel + " channel move" + (kinds.channel === 1 ? "" : "s") + " by AirMatch");
    if (kinds.config) parts.push(kinds.config + " configuration change" + (kinds.config === 1 ? "" : "s"));
    var first = near.slice().sort(function (a, b) { return a.ts - b.ts; })[0], lead = Math.round((spike.ts - first.ts) / 60);
    return { text: who + " within minutes of " + parts.join(" and ") + (lead > 0 ? ", the first " + lead + " min before" : lead < 0 ? ", the first " + (-lead) + " min after the bin opened" : ", the same minute") + ". " + (kinds.reboot ? "A reboot moves everyone: this is the network, not the people." : kinds.channel ? "A channel move makes every client on that radio re-associate: this is the network, not the people." : "Check what the change touched."), events: near, kind: kinds.reboot ? "reboot" : kinds.channel ? "channel" : "config" };
  };

  /* the radios as a graph. Two radios on the same band interfere when they hear
     each other: loss under the threshold. They share air when they also share a
     channel, or overlap on 2.4 GHz (channels closer than five apart). */
  S.graph = function (aps, pathloss, opts) {
    opts = opts || {};
    var hearDb = opts.hearDb || 105, nodes = [], byKey = {}, edges = {}, i;
    (aps || []).forEach(function (a) {
      (a.radios || []).forEach(function (r) {
        if (!r.band || r.status === "Down") return;
        var bwN = parseInt(String(r.bw === undefined || r.bw === null ? "" : r.bw).replace(/[^0-9]/g, ""), 10),
            chN = r.channel === undefined || r.channel === null || r.channel === "" ? null : parseInt(String(r.channel), 10),
            n = { id: a.serial + "/" + r.band, serial: a.serial, ap: a.name, band: String(r.band), channel: isFinite(chN) ? chN : null, bw: isFinite(bwN) ? bwN : (String(r.band) === "2.4" ? 20 : 80), tx: r.tx_dbm, eirp: r.eirp_dbm, mac: r.mac };
        nodes.push(n); byKey[n.id] = n;
      });
    });
    (pathloss || []).forEach(function (p) {
      var a = byKey[p.from + "/" + p.band], b = byKey[p.to + "/" + p.band];
      if (!a || !b || a === b || !isFinite(+p.db)) return;
      var k = [a.id, b.id].sort().join("|"), e = edges[k] || (edges[k] = { a: a.id, b: b.id, band: a.band, losses: [] });
      e.losses.push(+p.db);
    });
    var list = Object.keys(edges).map(function (k) {
      var e = edges[k]; e.loss = e.losses.reduce(function (t, v) { return t + v; }, 0) / e.losses.length; e.hears = e.loss <= hearDb; return e;
    });
    var g = { nodes: nodes, edges: list, hearDb: hearDb };
    S.colour(g);
    return g;
  };

  S.overlap = function (a, b) {
    if (a.channel === null || b.channel === null || a.channel === undefined || b.channel === undefined) return false;
    if (a.band !== b.band) return false;
    if (a.band === "2.4") return Math.abs(a.channel - b.channel) < 5;
    /* 5 and 6 GHz: a wider channel covers its 20 MHz members; compare the spans */
    function span(n) { var w = (n.bw || 20) / 20, base = n.channel; return [base, base + 4 * (w - 1)]; }  /* centre notation: 149E covers 149..161 */
    var sa = span(a), sb = span(b);
    return sa[0] <= sb[1] && sb[0] <= sa[1];
  };

  /* mark which edges share air, and give every node the count and the worst */
  S.colour = function (g) {
    var byId = {}; g.nodes.forEach(function (n) { byId[n.id] = n; n.coch = 0; n.worst = null; });
    g.edges.forEach(function (e) {
      var a = byId[e.a], b = byId[e.b];
      e.coch = e.hears && S.overlap(a, b);
      if (e.coch) { a.coch++; b.coch++; if (a.worst === null || e.loss < a.worst) a.worst = e.loss; if (b.worst === null || e.loss < b.worst) b.worst = e.loss; }
    });
    g.cochannel = g.edges.filter(function (e) { return e.coch; }).length;
    return g;
  };

  /* the same graph after one radio moves channel (and width); a copy, not a change */
  S.whatIf = function (g, id, channel, bw) {
    var copy = { nodes: g.nodes.map(function (n) { return Object.assign({}, n); }), edges: g.edges.map(function (e) { return Object.assign({}, e); }), hearDb: g.hearDb };
    var n = copy.nodes.filter(function (x) { return x.id === id; })[0];
    if (n) { n.channel = channel; if (bw) n.bw = bw; }
    return S.colour(copy);
  };

  /* hour by day matrices for one radio's samples: mean utilisation and the noise
     floor, plus the hours the floor sat well above the radio's own median */
  S.weather = function (samples, tzOffsetMin) {
    var off = (tzOffsetMin === undefined ? -new Date().getTimezoneOffset() : tzOffsetMin) * 60, days = {}, floors = [], i;
    (samples || []).forEach(function (s) {
      if (!isFinite(s.ts)) return;
      var local = s.ts + off, day = Math.floor(local / 86400), hour = Math.floor((local % 86400) / 3600);
      var d = days[day] || (days[day] = { day: day, hours: [] });
      var h = d.hours[hour] || (d.hours[hour] = { n: 0, util: 0, noise: 0 });
      h.n++; h.util += (+s.util_pct || 0); h.noise += (+s.noise_dbm || 0);
      if (isFinite(s.noise_dbm)) floors.push(+s.noise_dbm);
    });
    floors.sort(function (a, b) { return a - b; });
    var median = floors.length ? floors[Math.floor(floors.length / 2)] : null, rows = [], busiest = { hour: null, util: -1 }, byHour = [];
    for (i = 0; i < 24; i++) byHour.push({ n: 0, util: 0 });
    Object.keys(days).sort().forEach(function (k) {
      var d = days[k], cells = [];
      for (i = 0; i < 24; i++) {
        var h = d.hours[i];
        if (!h) { cells.push(null); continue; }
        var u = h.util / h.n, nf = h.noise / h.n;
        cells.push({ util: u, noise: nf, loud: median !== null && nf >= median + 6 });
        byHour[i].n++; byHour[i].util += u;
      }
      rows.push({ day: d.day, date: new Date(d.day * 86400000 - off * 1000), cells: cells });
    });
    byHour.forEach(function (h, k) { if (h.n && h.util / h.n > busiest.util) busiest = { hour: k, util: h.util / h.n }; });
    var loud = 0; rows.forEach(function (r) { r.cells.forEach(function (c) { if (c && c.loud) loud++; }); });
    return { rows: rows, median: median, busiest: busiest, loudHours: loud };
  };

  /* what each AP actually carried: bytes per five minutes to Mb/s */
  S.actual = function (story, aps) {
    var out = [];
    (aps || []).forEach(function (a) {
      var u = story && story.usage && story.usage[a.serial], smp = (u && u.samples) || [], mbps = [];
      for (var i = 1; i < smp.length; i++) {
        var dt = smp[i].ts - smp[i - 1].ts; if (!(dt > 0)) continue;
        mbps.push(((+smp[i].tx_bytes || 0) + (+smp[i].rx_bytes || 0)) * 8 / dt / 1e6);
      }
      mbps.sort(function (x, y) { return x - y; });
      out.push({ serial: a.serial, ap: a.name, clients: a.client_count === undefined || a.client_count === null ? (u && u.clients_now) : a.client_count,
                 meanMbps: mbps.length ? mbps.reduce(function (t, v) { return t + v; }, 0) / mbps.length : null,
                 peakMbps: mbps.length ? mbps[mbps.length - 1] : null, samples: mbps.length });
    });
    var cnt = (story && story.count) || [], vals = cnt.map(function (c) { return +c.clients; }).filter(isFinite);
    return { aps: out, siteClients: vals.length ? { now: vals[vals.length - 1], peak: Math.max.apply(null, vals), mean: vals.reduce(function (t, v) { return t + v; }, 0) / vals.length } : null };
  };

  /* who roams most, who lands weakest: the clients worth a look */
  S.clients = function (story) {
    return ((story && story.trails) || []).map(function (t) {
      var hs = t.hops || [], r = hs.map(function (h) { return h.rssi_dbm; }).filter(function (v) { return v !== null && isFinite(v) && v < -10; }), lat = hs.map(function (h) { return h.latency_ms; }).filter(function (v) { return v !== null && isFinite(v); });
      r.sort(function (a, b) { return a - b; }); lat.sort(function (a, b) { return a - b; });
      return { mac: t.mac, name: t.name || t.mac, os: t.os, hops: hs.length, joins: hs.filter(function (h) { return h.join; }).length,
               weak: r.filter(function (v) { return v < -75; }).length, medianRssi: r.length ? r[Math.floor(r.length / 2)] : null,
               medianLatency: lat.length ? lat[Math.floor(lat.length / 2)] : null, slow: lat.filter(function (v) { return v > 500; }).length };
    }).sort(function (a, b) { return b.hops - a.hops; });
  };
})();
