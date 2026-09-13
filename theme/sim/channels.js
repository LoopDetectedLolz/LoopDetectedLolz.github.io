/* Channels, and the reuse that falls out of counting them. US rules; other
   regulatory domains differ and the numbers below are the thing to change first.
   These counts are the whole reason 2.4 GHz cannot be fixed by adding radios. */
(function (root) {
  var NFN = root.NFN = root.NFN || {};
  var CH = NFN.channels = {};

  /* non-overlapping channels per width. dfs counts the ones that need radar
     detection, which plenty of sites turn off and then wonder where the
     capacity went. */
  CH.BANDS = {
    "2.4": {
      label: "2.4 GHz", def: 20, widths: [20, 40],
      clear: { 20: 3, 40: 1 }, dfs: { 20: 0, 40: 0 },
      note: "three channels, and one building's worth of neighbours"
    },
    "5": {
      label: "5 GHz", def: 80, widths: [20, 40, 80, 160],
      /* UNII-1 (4), UNII-3 (5), UNII-4 (3) need no radar detection */
      clear: { 20: 12, 40: 5, 80: 2, 160: 0 },
      /* UNII-2A (4) and UNII-2C (12) do */
      dfs: { 20: 16, 40: 8, 80: 4, 160: 2 },
      note: "most of the width is behind DFS"
    },
    "6": {
      label: "6 GHz", def: 80, widths: [20, 40, 80, 160, 320],
      clear: { 20: 59, 40: 29, 80: 14, 160: 7, 320: 3 }, dfs: { 20: 0, 40: 0, 80: 0, 320: 0, 160: 0 },
      note: "1200 MHz and no legacy clients in it"
    }
  };

  /* the channel numbers behind those counts, so a plan can name them. US rules;
     ETSI below. Verify against the domain you deploy in: these were written from
     the tables as generally published, 2026-09, not from a regulator's text. */
  function range(from, to, step) { var o = [], c; for (c = from; c <= to; c += step) o.push(c); return o; }
  CH.LISTS = {
    us: {
      "2.4": { 20: { clear: [1, 6, 11], dfs: [] }, 40: { clear: [3], dfs: [] } },
      "5": {
        20:  { clear: [36, 40, 44, 48, 149, 153, 157, 161, 165, 169, 173, 177], dfs: range(52, 64, 4).concat(range(100, 144, 4)) },
        /* 167, 175 and 171 are U-NII-4's share at 40 and 80, the same 2020 FCC order that gave 169 to 177 */
        40:  { clear: [38, 46, 151, 159, 167, 175], dfs: [54, 62, 102, 110, 118, 126, 134, 142] },
        80:  { clear: [42, 155, 171], dfs: [58, 106, 122, 138] },
        160: { clear: [], dfs: [50, 114] }
      },
      "6": {
        20: { clear: range(1, 233, 4), dfs: [] }, 40: { clear: range(3, 227, 8), dfs: [] },
        80: { clear: range(7, 215, 16), dfs: [] }, 160: { clear: range(15, 207, 32), dfs: [] }, 320: { clear: [31, 95, 159], dfs: [] }
      }
    },
    /* ETSI: 5150 to 5350 (36 to 64, radar detection above 5250), 5470 to 5725
       (100 to 140, radar detection), nothing above; 6 GHz is 5945 to 6425 */
    eu: {
      "2.4": { 20: { clear: [1, 5, 9, 13], dfs: [] }, 40: { clear: [3], dfs: [] } },
      "5": {
        20:  { clear: [36, 40, 44, 48], dfs: range(52, 64, 4).concat(range(100, 140, 4)) },
        40:  { clear: [38, 46], dfs: [54, 62, 102, 110, 118, 126, 134] },
        80:  { clear: [42], dfs: [58, 106, 122] },
        160: { clear: [], dfs: [50, 114] }
      },
      "6": {
        20: { clear: range(1, 93, 4), dfs: [] }, 40: { clear: range(3, 91, 8), dfs: [] },
        80: { clear: range(7, 87, 16), dfs: [] }, 160: { clear: range(15, 79, 32), dfs: [] }, 320: { clear: [31], dfs: [] }
      }
    }
  };
  CH.DOMAINS = { us: "United States, FCC", eu: "Europe, ETSI" };

  CH.band = function (b) { return CH.BANDS[b] || CH.BANDS["5"]; };

  CH.list = function (band, bw, useDfs, domain) {
    var L = (CH.LISTS[domain] || CH.LISTS.us)[band] || (CH.LISTS[domain] || CH.LISTS.us)["5"],
        w = L[bw] ? bw : Object.keys(L)[0], e = L[w];
    return e.clear.concat(useDfs ? e.dfs : []);
  };

  /* how many channels a plan actually has to play with */
  CH.count = function (band, bw, useDfs, domain) {
    if (domain && domain !== "us") return CH.list(band, bw, useDfs, domain).length;
    var b = CH.band(band), w = b.widths.indexOf(bw) >= 0 ? bw : b.widths[0];
    /* can be zero, and that is a real answer: there is no 160 MHz channel in
       5 GHz outside DFS, so a site that turns DFS off has none at all */
    return (b.clear[w] || 0) + (useDfs ? (b.dfs[w] || 0) : 0);
  };

  CH.widths = function (band) { return CH.band(band).widths; };
  CH.defaultWidth = function (band) { return CH.band(band).def; };

  /* with A radios and C channels, at least ceil(A/C) cells share each channel */
  CH.reuse = function (aps, channels) { return Math.max(1, Math.ceil(aps / Math.max(1, channels))); };

  /* what a radio's medium actually looks like once the neighbours on its own
     channel are counted. overlap is how much of a neighbour you hear: 0 is a
     perfect cell edge, 1 is the same room. */
  CH.occupancy = function (ownLoad, aps, channels, overlap) {
    var r = CH.reuse(aps, channels);
    return ownLoad * (1 + (r - 1) * NFN.clamp(overlap === undefined ? 0.4 : overlap, 0, 1));
  };
})(typeof window !== "undefined" ? window : globalThis);
