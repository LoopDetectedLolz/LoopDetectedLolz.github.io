/* Access point catalogue: what a real box does, so a model on a mast sets the
   streams, the power ceiling, the bands and the antenna instead of a slider.
   Figures marked verified were read from HPE QuickSpecs pages on 2026-09-12
   (document ids in src); conducted power is the aggregate the QuickSpecs give,
   with the per chain figure beside it. Antenna gain is the peak the QuickSpecs
   give per band. Unverified rows are the figures commonly published for the
   Wi-Fi 5 generation and the 720 series, whose QuickSpecs are PDF only; the
   tool flags them and they are the first thing to check against a datasheet.
   Elevation beamwidth for an omni is not published: it is derived from the
   gain (about 101 divided by the directivity, the textbook omni relation). */
(function (root) {
  var NFN = root.NFN = root.NFN || {};
  var A = NFN.aps = {};

  /* antenna kinds a model can carry built in */
  A.KINDS = {
    omni:   { label: "omni, pole mount",            h: 360, tilt: 0,  f2b: 0 },
    dtomni: { label: "down-tilt omni, ceiling mount", h: 360, tilt: 30, f2b: 0 },
    dir90:  { label: "90 by 90 directional",         h: 90,  v: 90, tilt: 0, f2b: 20 },
    ext:    { label: "external connectors" }
  };

  /* radios: ss per band, tx is the aggregate conducted ceiling in dBm and
     chain the per chain figure; ant is the peak built in gain per band */
  A.MODELS = [
    /* outdoor, Wi-Fi 6 */
    { id: "AP-565", series: "560", gen: "ax", place: "outdoor", radios: { "2.4": { ss: 2, tx: 26, chain: 23 }, "5": { ss: 2, tx: 26, chain: 23 } }, antKind: "omni", ant: { "2.4": 3.2, "5": 5.4 }, src: "HPE QuickSpecs a00094642enw", verified: true },
    { id: "AP-567", series: "560", gen: "ax", place: "outdoor", radios: { "2.4": { ss: 2, tx: 26, chain: 23 }, "5": { ss: 2, tx: 26, chain: 23 } }, antKind: "dir90", ant: { "2.4": 7.0, "5": 6.7 }, src: "HPE QuickSpecs a00094642enw", verified: true },
    { id: "AP-574", series: "570", gen: "ax", place: "outdoor", radios: { "2.4": { ss: 2, tx: 25, chain: 22 }, "5": { ss: 4, tx: 28, chain: 22 } }, antKind: "ext", ant: {}, src: "HPE QuickSpecs a00056659enw", verified: true },
    { id: "AP-575", series: "570", gen: "ax", place: "outdoor", radios: { "2.4": { ss: 2, tx: 25, chain: 22 }, "5": { ss: 4, tx: 28, chain: 22 } }, antKind: "omni", ant: { "2.4": 3.4, "5": 5.0 }, src: "HPE QuickSpecs a00056659enw", verified: true },
    { id: "AP-577", series: "570", gen: "ax", place: "outdoor", radios: { "2.4": { ss: 2, tx: 25, chain: 22 }, "5": { ss: 4, tx: 28, chain: 22 } }, antKind: "dir90", ant: { "2.4": 6.8, "5": 5.6 }, src: "HPE QuickSpecs a00056659enw", verified: true },
    { id: "AP-584", series: "580", gen: "ax", place: "outdoor", radios: { "2.4": { ss: 4, tx: 29, chain: 23 }, "5": { ss: 4, tx: 28, chain: 22 } }, antKind: "ext", ant: {}, src: "HPE QuickSpecs a50004278enw", verified: true },
    { id: "AP-585", series: "580", gen: "ax", place: "outdoor", radios: { "2.4": { ss: 4, tx: 29, chain: 23 }, "5": { ss: 4, tx: 28, chain: 22 } }, antKind: "omni", ant: { "2.4": 4.4, "5": 5.8 }, note: "peak; the QuickSpecs give 3.0 and 4.5 dBi as the uncorrelated average", src: "HPE QuickSpecs a50004278enw", verified: true },
    { id: "AP-587", series: "580", gen: "ax", place: "outdoor", radios: { "2.4": { ss: 4, tx: 29, chain: 23 }, "5": { ss: 4, tx: 28, chain: 22 } }, antKind: "dir90", ant: { "2.4": 5.8, "5": 6.6 }, note: "peak; averages 5.7 and 5.2 dBi", src: "HPE QuickSpecs a50004278enw", verified: true },
    /* outdoor, Wi-Fi 6E */
    { id: "AP-674", series: "670", gen: "ax", place: "outdoor", radios: { "2.4": { ss: 2, tx: 25, chain: 22 }, "5": { ss: 2, tx: 25, chain: 22 }, "6": { ss: 2, tx: 25, chain: 22 } }, antKind: "ext", ant: {}, src: "HPE QuickSpecs a50009200enw", verified: true },
    { id: "AP-675", series: "670", gen: "ax", place: "outdoor", radios: { "2.4": { ss: 2, tx: 25, chain: 22 }, "5": { ss: 2, tx: 25, chain: 22 }, "6": { ss: 2, tx: 25, chain: 22 } }, antKind: "omni", ant: { "2.4": 3.5, "5": 5.0, "6": 5.0 }, src: "HPE QuickSpecs a50009200enw", verified: true },
    { id: "AP-677", series: "670", gen: "ax", place: "outdoor", radios: { "2.4": { ss: 2, tx: 25, chain: 22 }, "5": { ss: 2, tx: 25, chain: 22 }, "6": { ss: 2, tx: 25, chain: 22 } }, antKind: "dir90", ant: { "2.4": 5.6, "5": 6.0, "6": 7.0 }, note: "the QuickSpecs also quote 6.9, 6.5 and 6.9 dBi for the individual elements", src: "HPE QuickSpecs a50009200enw", verified: true },
    { id: "AP-679", series: "670", gen: "ax", place: "outdoor", radios: { "2.4": { ss: 2, tx: 25, chain: 22 }, "5": { ss: 2, tx: 25, chain: 22 }, "6": { ss: 2, tx: 25, chain: 22 } }, antKind: "dir90", ant: { "2.4": 6.0, "5": 12.0, "6": 13.0 }, note: "dynamic directional: wide 9 dBi or narrow 12 to 13 dBi; the narrow figure is used", src: "HPE QuickSpecs a50009200enw", verified: true },
    /* indoor, Wi-Fi 6, the ones that end up in tents */
    { id: "AP-505", series: "500", gen: "ax", place: "indoor", radios: { "2.4": { ss: 2, tx: 21, chain: 18 }, "5": { ss: 2, tx: 21, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 4.9, "5": 5.7 }, src: "HPE QuickSpecs a00067744enw", verified: true },
    { id: "AP-504", series: "500", gen: "ax", place: "indoor", radios: { "2.4": { ss: 2, tx: 21, chain: 18 }, "5": { ss: 2, tx: 21, chain: 18 } }, antKind: "ext", ant: {}, src: "HPE QuickSpecs a00067744enw", verified: true },
    { id: "AP-515", series: "510", gen: "ax", place: "indoor", radios: { "2.4": { ss: 2, tx: 21, chain: 18 }, "5": { ss: 4, tx: 24, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 4.2, "5": 7.5 }, src: "HPE QuickSpecs a00054054enw", verified: true },
    { id: "AP-535", series: "530", gen: "ax", place: "indoor", radios: { "2.4": { ss: 4, tx: 24, chain: 18 }, "5": { ss: 4, tx: 24, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 3.5, "5": 5.4 }, src: "HPE QuickSpecs a00060238enw", verified: true },
    { id: "AP-555", series: "550", gen: "ax", place: "indoor", radios: { "2.4": { ss: 4, tx: 24, chain: 18 }, "5": { ss: 8, tx: 27, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 4.3, "5": 5.8 }, dual5: true, note: "tri radio mode splits 5 GHz into two 4x4 radios at 24 dBm, 5.5 and 5.6 dBi", src: "HPE QuickSpecs a00060236enw", verified: true },
    /* indoor, Wi-Fi 6E */
    { id: "AP-615", series: "610", gen: "ax", place: "indoor", radios: { "2.4": { ss: 2, tx: 21, chain: 18 }, "5": { ss: 2, tx: 21, chain: 18 }, "6": { ss: 2, tx: 21, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 2.8, "5": 4.5, "6": 4.5 }, src: "HPE QuickSpecs a50004285enw", verified: true },
    { id: "AP-635", series: "630", gen: "ax", place: "indoor", radios: { "2.4": { ss: 2, tx: 21, chain: 18 }, "5": { ss: 2, tx: 21, chain: 18 }, "6": { ss: 2, tx: 21, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 4.6, "5": 7.0, "6": 6.3 }, src: "HPE QuickSpecs a50002582enw", verified: true },
    { id: "AP-655", series: "650", gen: "ax", place: "indoor", radios: { "2.4": { ss: 4, tx: 24, chain: 18 }, "5": { ss: 4, tx: 24, chain: 18 }, "6": { ss: 4, tx: 24, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 4.8, "5": 5.3, "6": 5.4 }, src: "HPE QuickSpecs a50004266enw", verified: true },
    /* Wi-Fi 7 */
    { id: "AP-735", series: "730", gen: "be", place: "indoor", radios: { "2.4": { ss: 2, tx: 21, chain: 18 }, "5": { ss: 2, tx: 21, chain: 18 }, "6": { ss: 2, tx: 21, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 5.1, "5": 5.5, "6": 5.3 }, gnss: true, src: "HPE QuickSpecs a50009206enw", verified: true },
    { id: "AP-734", series: "730", gen: "be", place: "indoor", radios: { "2.4": { ss: 2, tx: 21, chain: 18 }, "5": { ss: 2, tx: 21, chain: 18 }, "6": { ss: 2, tx: 21, chain: 18 } }, antKind: "ext", ant: {}, gnss: true, src: "HPE QuickSpecs a50009206enw", verified: true },
    { id: "AP-755", series: "750", gen: "be", place: "indoor", radios: { "2.4": { ss: 4, tx: 24, chain: 18 }, "5": { ss: 4, tx: 24, chain: 18 }, "6": { ss: 4, tx: 24, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 5.3, "5": 6.0, "6": 6.0 }, src: "HPE QuickSpecs a50009211enw", verified: true },
    { id: "AP-754", series: "750", gen: "be", place: "indoor", radios: { "2.4": { ss: 4, tx: 24, chain: 18 }, "5": { ss: 4, tx: 24, chain: 18 }, "6": { ss: 4, tx: 24, chain: 18 } }, antKind: "ext", ant: {}, src: "HPE QuickSpecs a50009211enw", verified: true },
    { id: "AP-725", series: "720", gen: "be", place: "indoor", radios: { "2.4": { ss: 2, tx: 24, chain: 18 }, "5": { ss: 4, tx: 24, chain: 18 }, "6": { ss: 4, tx: 24, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 4.5, "5": 5.5, "6": 5.5 }, src: "720 series QuickSpecs are PDF only; figures recalled", verified: false },
    /* Wi-Fi 5, unverified: the QuickSpecs are PDF only */
    { id: "AP-305", series: "300", gen: "ac", place: "indoor", radios: { "2.4": { ss: 2, tx: 21, chain: 18 }, "5": { ss: 4, tx: 24, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 3.8, "5": 5.3 }, src: "300 series QuickSpecs c05273540, PDF; figures recalled", verified: false },
    { id: "AP-315", series: "310", gen: "ac", place: "indoor", radios: { "2.4": { ss: 2, tx: 21, chain: 18 }, "5": { ss: 4, tx: 24, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 3.5, "5": 5.0 }, src: "310 series QuickSpecs c05272671, PDF; figures recalled", verified: false },
    { id: "AP-325", series: "320", gen: "ac", place: "indoor", radios: { "2.4": { ss: 4, tx: 24, chain: 18 }, "5": { ss: 4, tx: 24, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 5.0, "5": 5.6 }, src: "320 series datasheet, PDF; figures recalled", verified: false },
    { id: "AP-335", series: "330", gen: "ac", place: "indoor", radios: { "2.4": { ss: 4, tx: 24, chain: 18 }, "5": { ss: 4, tx: 24, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 4.7, "5": 5.0 }, src: "330 series datasheet, PDF; figures recalled", verified: false },
    { id: "AP-345", series: "340", gen: "ac", place: "indoor", radios: { "2.4": { ss: 4, tx: 24, chain: 18 }, "5": { ss: 4, tx: 24, chain: 18 } }, antKind: "dtomni", ant: { "2.4": 4.5, "5": 5.0 }, dual5: true, src: "340 series QuickSpecs a00027233enw, PDF; figures recalled", verified: false },
    { id: "AP-365", series: "360", gen: "ac", place: "outdoor", radios: { "2.4": { ss: 2, tx: 24, chain: 21 }, "5": { ss: 2, tx: 24, chain: 21 } }, antKind: "omni", ant: { "2.4": 3.9, "5": 5.6 }, src: "360 series QuickSpecs c05348011, PDF; figures recalled", verified: false },
    { id: "AP-367", series: "360", gen: "ac", place: "outdoor", radios: { "2.4": { ss: 2, tx: 24, chain: 21 }, "5": { ss: 2, tx: 24, chain: 21 } }, antKind: "dir90", ant: { "2.4": 6.0, "5": 6.5 }, src: "360 series QuickSpecs c05348011, PDF; figures recalled", verified: false },
    { id: "AP-374", series: "370", gen: "ac", place: "outdoor", radios: { "2.4": { ss: 2, tx: 25, chain: 22 }, "5": { ss: 4, tx: 28, chain: 22 } }, antKind: "ext", ant: {}, src: "370 series QuickSpecs a00027234enw, PDF; figures recalled", verified: false },
    { id: "AP-375", series: "370", gen: "ac", place: "outdoor", radios: { "2.4": { ss: 2, tx: 25, chain: 22 }, "5": { ss: 4, tx: 28, chain: 22 } }, antKind: "omni", ant: { "2.4": 3.4, "5": 5.0 }, src: "370 series QuickSpecs a00027234enw, PDF; figures recalled", verified: false },
    { id: "AP-377", series: "370", gen: "ac", place: "outdoor", radios: { "2.4": { ss: 2, tx: 25, chain: 22 }, "5": { ss: 4, tx: 28, chain: 22 } }, antKind: "dir90", ant: { "2.4": 6.8, "5": 5.6 }, src: "370 series QuickSpecs a00027234enw, PDF; figures recalled", verified: false }
  ];
  A.byId = {};
  A.MODELS.forEach(function (m) { A.byId[m.id] = m; });
  A.model = function (id) { return A.byId[id] || null; };

  /* an omni's elevation beamwidth from its gain: directivity D = 10^(g/10),
     HPBW about 101 / D degrees. 5 dBi is 32 degrees, 3.4 dBi is 46. */
  A.omniBeam = function (gDbi) { return NFN.clamp(101 / Math.pow(10, gDbi / 10), 14, 90); };

  /* register a model's built in antenna for a band with the mesh planner's
     antenna table, and return its id; an external antenna model returns null
     and the planner keeps whatever the user hung on it */
  A.antennaFor = function (id, band) {
    var m = A.model(id); if (!m || m.antKind === "ext") return null;
    var b = String(band), g = m.ant[b] !== undefined ? m.ant[b] : m.ant["5"], k = A.KINDS[m.antKind], key = "m:" + id + ":" + b;
    if (NFN.mesh && !NFN.mesh.ANTENNAS[key]) {
      NFN.mesh.ANTENNAS[key] = { label: id + " built in, " + b + " GHz", g: g, h: k.h, v: k.v || A.omniBeam(g), tilt: k.tilt, f2b: k.f2b, model: id, hidden: true };
    }
    return key;
  };

  /* what a model means for a mast: streams, the power ceiling, the bands it
     has, whether it has a radio to spare for the backhaul */
  A.describe = function (id) {
    var m = A.model(id); if (!m) return null;
    var bands = Object.keys(m.radios), has6 = bands.indexOf("6") >= 0;
    return {
      model: m, bands: bands, has6: has6,
      /* a box with a 5 GHz and a 6 GHz radio can carry the backhaul on one and
         the clients on the other; so can a dual 5 GHz box in tri radio mode */
      dedicated: has6 || !!m.dual5,
      ssFor: function (band) { var r = m.radios[String(band)]; return r ? Math.min(4, r.ss) : 2; },
      txMax: function (band) { var r = m.radios[String(band)]; return r ? r.tx : 23; },
      std: m.gen
    };
  };
})(typeof window !== "undefined" ? window : globalThis);
