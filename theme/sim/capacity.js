/* Capacity: the calculation every design argument is secretly about.
   Offered load becomes airtime through the real frame time, airtime becomes
   access points. Nothing here is a rule of thumb; the rules of thumb fall out. */
(function (root) {
  var NFN = root.NFN = root.NFN || {};
  var CAP = NFN.capacity = {};

  /* A device class is a PHY configuration, not a number typed into a box, so the
     airtime comes from the same code the rest of the simulator uses. */
  CAP.DEVICES = [
    { id: "edge",   label: "Sticky client at the cell edge", std: "ax", mcs: 0,  ss: 1, bw: 20 },
    { id: "legacy", label: "Legacy 802.11a/g",               std: "a",  mcs: 0,  ss: 1, bw: 20 },
    { id: "iot",    label: "Scanner or IoT, 1SS 20 MHz",     std: "n",  mcs: 3,  ss: 1, bw: 20 },
    { id: "n1",     label: "Wi-Fi 4 handheld, 1SS 20 MHz",   std: "n",  mcs: 7,  ss: 1, bw: 20 },
    { id: "ac1",    label: "Wi-Fi 5 phone, 1SS 80 MHz",      std: "ac", mcs: 9,  ss: 1, bw: 80 },
    { id: "ac2",    label: "Wi-Fi 5 laptop, 2SS 80 MHz",     std: "ac", mcs: 9,  ss: 2, bw: 80 },
    { id: "ax2",    label: "Wi-Fi 6 phone, 2SS 80 MHz",      std: "ax", mcs: 11, ss: 2, bw: 80 },
    { id: "ax2e",   label: "Wi-Fi 6E laptop, 2SS 160 MHz",   std: "ax", mcs: 11, ss: 2, bw: 160 },
    { id: "be2",    label: "Wi-Fi 7 laptop, 2SS 160 MHz",    std: "be", mcs: 13, ss: 2, bw: 160 }
  ];

  /* kbps is what the client offers in both directions together. Frame size and
     aggregation matter as much as the bitrate: voice is small frames that cannot
     wait to be aggregated, which is why it costs far more airtime than it looks. */
  CAP.APPS = [
    { id: "voice",  label: "Voice call",        kbps: 90,   bytes: 200,  agg: 1 },
    { id: "video",  label: "Video call",        kbps: 2500, bytes: 1200, agg: 8 },
    { id: "stream", label: "Streaming video",   kbps: 5000, bytes: 1500, agg: 32 },
    { id: "web",    label: "Web and email",     kbps: 500,  bytes: 1500, agg: 16 },
    { id: "file",   label: "File transfer",     kbps: 8000, bytes: 1500, agg: 64 },
    { id: "scan",   label: "Barcode or telemetry", kbps: 40, bytes: 300, agg: 1 }
  ];

  CAP.device = function (id) { return CAP.DEVICES.filter(function (d) { return d.id === id; })[0] || CAP.DEVICES[6]; };
  CAP.app = function (id) { return CAP.APPS.filter(function (a) { return a.id === id; })[0] || CAP.APPS[3]; };

  /* one group: n clients of a device class running an application */
  CAP.group = function (g, opt) {
    var d = CAP.device(g.dev), a = CAP.app(g.app),
        bw = Math.min(opt.bw || d.bw, d.bw),              /* a client cannot use more width than it has */
        cfg = { std: d.std, mcs: d.mcs, ss: d.ss, bw: bw, bytes: a.bytes,
                agg: opt.agg === false ? 1 : a.agg, retry: opt.retry },
        phy = NFN.phy.rate(d.std, d.mcs, d.ss, bw),        /* Mb/s on the label */
        goodput = NFN.mac.throughput(cfg) / 1e6,           /* Mb/s a station actually gets */
        offered = g.n * a.kbps / 1000,                     /* Mb/s this group asks for */
        airtime = goodput > 0 ? offered / goodput : 1;
    return {
      n: g.n, dev: d, app: a, bw: bw, label: d.label + " on " + a.label.toLowerCase(),
      phyMbps: phy, goodputMbps: goodput,
      offeredMbps: offered, airtime: airtime,
      efficiency: phy > 0 ? goodput / phy : 0,
      airtimePerMbps: offered > 0 ? airtime / offered : 0,
      txopUs: NFN.mac.txopWithRetries(cfg)
    };
  };

  /* the whole plan */
  CAP.plan = function (st) {
    var opt = { bw: st.bw, retry: st.retry, agg: st.agg },
        groups = (st.groups || []).filter(function (g) { return g.n > 0; }).map(function (g) { return CAP.group(g, opt); }),
        client = groups.reduce(function (t, g) { return t + g.airtime; }, 0),
        beacons = NFN.mac.beaconOverhead(st.ssids, st.beaconMs, "ax"),
        total = client + beacons,
        target = NFN.clamp(st.target || 0.5, 0.1, 0.95),
        perRadio = st.maxPerRadio || 60,
        clientsTotal = (st.groups || []).reduce(function (t, g) { return t + (g.n > 0 ? g.n : 0); }, 0),
        /* airtime is not the only ceiling: association tables, probe handling and
           the roaming mess all get worse long before a radio is busy, so a client
           count per radio is the constraint that usually actually binds */
        byCount = Math.max(1, Math.ceil(clientsTotal / perRadio)),
        band = st.band || "5",
        chans = NFN.channels.count(band, st.bw, st.dfs),
        overlap = st.overlap === undefined ? 0.4 : st.overlap;

    /* Splitting the load across more radios only helps while there are channels
       left to put them on. Past that, every new radio is another neighbour on
       somebody's channel, so the medium gets busier rather than quieter. Walk
       the whole range, find where it actually bottoms out, and say so. */
    function occupancyAt(a) {
      return NFN.channels.occupancy(client / a + beacons, a, chans, overlap);
    }
    var byAir = 0, best = 1, bestOcc = Infinity, MAXAP = 240;
    for (var a = 1; chans > 0 && a <= MAXAP; a++) {
      var o = occupancyAt(a);
      if (o < bestOcc - 1e-12) { bestOcc = o; best = a; }
      if (!byAir && o <= target) byAir = a;          /* airtime alone, before the client count has a say */
    }
    var fits = chans > 0 && byAir > 0,
        aps = fits ? Math.max(byAir, byCount) : Math.max(best, byCount),
        r = NFN.channels.reuse(aps, chans),
        own = client / aps + beacons,
        per = occupancyAt(aps);

    groups.sort(function (a, b) { return b.airtime - a.airtime; });
    var worst = groups[0],
        clients = groups.reduce(function (t, g) { return t + g.n; }, 0),
        offered = groups.reduce(function (t, g) { return t + g.offeredMbps; }, 0);

    return {
      groups: groups, clients: clients, offeredMbps: offered,
      clientAirtime: client, beaconAirtime: beacons, totalAirtime: total,
      target: target, aps: aps, apsByAirtime: byAir, apsByClients: byCount,
      binds: !fits ? "channels" : (byCount > byAir ? "clients" : (byAir > byCount ? "airtime" : "both")),
      fits: fits, band: band, channels: chans, reuse: r, overlap: overlap,
      ownAirtime: own, coChannel: per - own, bestAps: best, bestOccupancy: bestOcc,
      perRadio: perRadio, clientsPerAp: clientsTotal / aps,
      perAp: per, headroom: 1 - per / target,
      worst: worst,
      /* the number that ends arguments: airtime per megabit, worst group against best */
      spread: groups.length > 1 ? (function () {
        var s = groups.slice().filter(function (g) { return g.offeredMbps > 0; })
                 .sort(function (a, b) { return a.airtimePerMbps - b.airtimePerMbps; });
        return s.length > 1 ? { best: s[0], worst: s[s.length - 1], ratio: s[s.length - 1].airtimePerMbps / s[0].airtimePerMbps } : null;
      })() : null,
      assumptions: [
        st.ssids + " SSID" + (st.ssids === 1 ? "" : "s") + " beaconing every " + (st.beaconMs || 102.4) + " ms, costing " + (beacons * 100).toFixed(1) + "% of a radio before any client speaks",
        Math.round((st.retry === undefined ? 0.1 : st.retry) * 100) + "% of transmissions retried",
        (st.agg === false ? "aggregation off" : "A-MPDU on, per application profile"),
        "target ceiling " + Math.round(target * 100) + "% airtime per radio",
        chans === 0
          ? NFN.channels.band(band).label + " has no " + st.bw + " MHz channel at all " + (st.dfs ? "in this domain" : "once DFS is left out")
          : NFN.channels.band(band).label + " at " + st.bw + " MHz, " + chans + " channel" + (chans === 1 ? "" : "s") +
            (st.dfs ? " including DFS" : ", DFS left out") + ", so " + r + " cell" + (r === 1 ? "" : "s") + " per channel",
        "a radio hears " + Math.round(overlap * 100) + "% of what its co-channel neighbours transmit",
        "downlink and uplink counted together",
        "at most " + perRadio + " clients per radio",
        "no MU-MIMO or OFDMA gain, and no interference from anybody else's network"
      ]
    };
  };
})(typeof window !== "undefined" ? window : globalThis);
