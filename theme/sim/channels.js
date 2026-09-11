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

  CH.band = function (b) { return CH.BANDS[b] || CH.BANDS["5"]; };

  /* how many channels a plan actually has to play with */
  CH.count = function (band, bw, useDfs) {
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
