/* PHY: what a rate actually is, and how long a frame sits on the air.
   Rates are computed from the constellation, the coding rate and the subcarrier
   count, not looked up, so the table matching the standard's table is a result
   rather than a copy. 2 streams of MCS 11 on 160 MHz comes out at 2402 Mb/s. */
(function (root) {
  var NFN = root.NFN = root.NFN || {};
  var PHY = NFN.phy = {};

  /* [label, bits per subcarrier, coding rate] */
  PHY.MCS = [
    ["BPSK 1/2", 1, 1 / 2], ["QPSK 1/2", 2, 1 / 2], ["QPSK 3/4", 2, 3 / 4],
    ["16-QAM 1/2", 4, 1 / 2], ["16-QAM 3/4", 4, 3 / 4], ["64-QAM 2/3", 6, 2 / 3],
    ["64-QAM 3/4", 6, 3 / 4], ["64-QAM 5/6", 6, 5 / 6], ["256-QAM 3/4", 8, 3 / 4],
    ["256-QAM 5/6", 8, 5 / 6], ["1024-QAM 3/4", 10, 3 / 4], ["1024-QAM 5/6", 10, 5 / 6],
    ["4096-QAM 3/4", 12, 3 / 4], ["4096-QAM 5/6", 12, 5 / 6]
  ];

  /* 802.11a/g has its own eight rates rather than an MCS index */
  PHY.AG = [["BPSK 1/2", 1, 1 / 2], ["BPSK 3/4", 1, 3 / 4], ["QPSK 1/2", 2, 1 / 2],
            ["QPSK 3/4", 2, 3 / 4], ["16-QAM 1/2", 4, 1 / 2], ["16-QAM 3/4", 4, 3 / 4],
            ["64-QAM 2/3", 6, 2 / 3], ["64-QAM 3/4", 6, 3 / 4]];

  PHY.STD = {
    a:  { name: "802.11a/g", wifi: "", tsym: 4,    nsd: { 20: 48 },
          widths: [20], mcs: PHY.AG, ssMax: 1, pre: function () { return 20; } },
    n:  { name: "802.11n",   wifi: "Wi-Fi 4", tsym: 4,    nsd: { 20: 52, 40: 108 },
          widths: [20, 40], mcs: PHY.MCS.slice(0, 8), ssMax: 4, pre: function (s) { return 32 + 4 * PHY.nLtf(s); } },
    ac: { name: "802.11ac",  wifi: "Wi-Fi 5", tsym: 4,    nsd: { 20: 52, 40: 108, 80: 234, 160: 468 },
          widths: [20, 40, 80, 160], mcs: PHY.MCS.slice(0, 10), ssMax: 8, pre: function (s) { return 36 + 4 * PHY.nLtf(s); } },
    ax: { name: "802.11ax",  wifi: "Wi-Fi 6/6E", tsym: 13.6, nsd: { 20: 234, 40: 468, 80: 980, 160: 1960 },
          widths: [20, 40, 80, 160], mcs: PHY.MCS.slice(0, 12), ssMax: 8, pre: function (s) { return 36 + 7.2 * PHY.nLtf(s); } },
    be: { name: "802.11be",  wifi: "Wi-Fi 7", tsym: 13.6, nsd: { 20: 234, 40: 468, 80: 980, 160: 1960, 320: 3920 },
          widths: [20, 40, 80, 160, 320], mcs: PHY.MCS, ssMax: 8, pre: function (s) { return 40 + 7.2 * PHY.nLtf(s); } }
  };

  /* Long training fields are not one per stream: the preamble carries 1, 2, 4,
     6 or 8 of them, so 3 streams send 4 and 5 streams send 6 (802.11-2020
     Tables 19-13 and 21-13, and the HE-LTF count in 27.3.11.10 follows suit). */
  PHY.nLtf = function (ss) { return ss <= 2 ? ss : ss <= 4 ? 4 : ss <= 6 ? 6 : 8; };

  /* 802.11ac leaves a few MCS, width and stream combinations out of the table
     because the coded bits per symbol do not divide evenly among the encoders
     (Tables 21-30 to 21-61). Ask for one and the radio runs the next one down,
     so a 1SS phone at 20 MHz tops out at MCS 8, 78 Mb/s, not a 86.7 that does
     not exist. 802.11n at 40 MHz and everything from ax onward have no holes. */
  PHY.EXCLUDED = { ac: { 20: { 9: [1, 2, 4, 5, 7, 8] }, 80: { 6: [3, 7], 9: [6] }, 160: { 9: [3] } } };
  PHY.valid = function (std, mcs, ss, bw) {
    var t = PHY.EXCLUDED[std], w = t && t[bw], m = w && w[mcs];
    return !(m && m.indexOf(ss) >= 0);
  };
  PHY.usable = function (std, mcs, ss, bw) {
    var s = S(std), m = Math.min(mcs, s.mcs.length - 1);
    while (m > 0 && !PHY.valid(std, m, ss, bw)) m--;
    return m;
  };

  function S(std) { return PHY.STD[std] || PHY.STD.ax; }

  PHY.bitsPerSymbol = function (std, mcs, ss, bw) {
    var s = S(std), m = s.mcs[PHY.usable(std, mcs, ss, bw)], nsd = s.nsd[bw] || s.nsd[20];
    return ss * nsd * m[1] * m[2];
  };

  /* Mb/s, because bits per symbol divided by microseconds already is */
  PHY.rate = function (std, mcs, ss, bw) {
    return PHY.bitsPerSymbol(std, mcs, ss, bw) / S(std).tsym;
  };

  PHY.preamble = function (std, ss) { return S(std).pre(ss); };

  /* What wraps each packet before it is a frame on a secured WLAN: a QoS data
     header with its FCS (26 + 4; the HT Control field that would make it 34 is
     absent from A-MPDU subframes), the LLC/SNAP header the IP packet rides in,
     and the CCMP header plus MIC (8 + 8). 54 bytes is about 1 percent of a
     1500-byte frame and about 10 percent of the airtime of a 200-byte voice
     frame, which is why voice is costed the way it is. A management frame is
     just its header and FCS with the body in the clear. 802.11-2020 9.3.2.1,
     9.7, 12.5.3. */
  PHY.OVERHEAD = { data: 30, llc: 8, ccmp: 16, mgmt: 28 };
  PHY.perMpdu = function (opts) {
    if (opts.kind === "mgmt") return PHY.OVERHEAD.mgmt;
    return PHY.OVERHEAD.data + PHY.OVERHEAD.llc + (opts.secure === false ? 0 : PHY.OVERHEAD.ccmp);
  };

  /* Microseconds on the air for one transmission. agg is the number of MPDUs in
     the A-MPDU: aggregation is most of why a modern link gets anywhere near its
     PHY rate, so leaving it out would make every capacity number wrong. bytes is
     the packet handed down (the IP datagram); the 802.11 wrapping is added here. */
  PHY.frameAirtime = function (opts) {
    var std = opts.std || "ax", ss = opts.ss || 1, bw = opts.bw || 80,
        bytes = opts.bytes === undefined ? 1500 : opts.bytes,
        agg = Math.max(1, opts.agg || 1),
        bps = PHY.bitsPerSymbol(std, opts.mcs || 0, ss, bw),
        MAC = PHY.perMpdu(opts),
        DELIM = agg > 1 ? 4 : 0,       /* A-MPDU delimiter per subframe */
        bits = 16 + 8 * agg * (bytes + MAC + DELIM) + 6;   /* service + payload + tail */
    return PHY.preamble(std, ss) + Math.ceil(bits / bps) * S(std).tsym;
  };

  /* Minimum SNR to hold each rate, the typical figures a vendor quotes rather
     than anything from a standard. Used for a readout; nothing decodes by it. */
  PHY.SNRMIN = [3, 6, 9, 12, 16, 20, 22, 25, 29, 31, 34, 37, 40, 43];
  PHY.mcsFor = function (std, snr) {
    var max = PHY.maxMcs(std), m = -1, i;
    for (i = 0; i <= max && i < PHY.SNRMIN.length; i++) if (snr >= PHY.SNRMIN[i]) m = i;
    return m;
  };

  PHY.label = function (std, mcs) {
    var s = S(std); return (s.mcs[Math.min(mcs, s.mcs.length - 1)] || ["?"])[0];
  };
  PHY.maxMcs = function (std) { return S(std).mcs.length - 1; };
})(typeof window !== "undefined" ? window : globalThis);
