/* Propagation. Everything here is a pure function of its arguments so it can be
   asserted in node against a published figure rather than eyeballed on a canvas. */
(function (root) {
  var NFN = root.NFN = root.NFN || {};
  var RF = NFN.rf = {};

  var C = 299792458, RE = 6371000;

  RF.lambda = function (fGHz) { return C / (fGHz * 1e9); };

  /* free space, the ITU form: 20log10(d_km) + 20log10(f_MHz) + 32.44.
     1 m at 5.2 GHz is 46.8 dB, which is the number every link budget starts from. */
  RF.fspl = function (dM, fGHz) {
    return 20 * Math.log10(Math.max(1e-4, dM) / 1000) + 20 * Math.log10(fGHz * 1000) + 32.44;
  };

  /* indoors nobody gets free space. One metre of it, then an exponent:
     n = 2 is free space, 3 is a typical office, 4 is a warehouse of racking. */
  RF.logDistance = function (dM, fGHz, n) {
    return RF.fspl(1, fGHz) + 10 * (n || 3) * Math.log10(Math.max(1, dM));
  };

  /* typical 5 GHz survey values. Measure your own building; these are a starting point. */
  RF.WALLS = { drywall: 3, glass: 4, wood: 5, cinder: 6, brick: 12, concrete: 15, elevator: 25 };
  RF.wallLoss = function (list) {
    return (list || []).reduce(function (t, w) { return t + (RF.WALLS[w] || 0); }, 0);
  };

  /* thermal noise floor for a channel width, plus the receiver's noise figure */
  RF.noiseFloor = function (bwMHz, nfDb) {
    return -174 + 10 * Math.log10(bwMHz * 1e6) + (nfDb === undefined ? 7 : nfDb);
  };

  /* first Fresnel zone radius at a point d1 from one end, d2 from the other.
     12.0 m in the middle of a 10 km link at 5.2 GHz. */
  RF.fresnel1 = function (d1, d2, fGHz) {
    return Math.sqrt(RF.lambda(fGHz) * d1 * d2 / Math.max(1, d1 + d2));
  };

  /* earth bulge under the line of sight. k = 4/3 is the standard atmosphere.
     36.8 m in the middle of a 50 km link. */
  RF.bulge = function (d1, d2, k) { return d1 * d2 / (2 * (k || 4 / 3) * RE); };

  /* Fresnel-Kirchhoff parameter and the ITU-R P.526 single knife edge approximation */
  RF.vParam = function (hM, d1, d2, fGHz) {
    return hM * Math.sqrt(2 * (d1 + d2) / (RF.lambda(fGHz) * Math.max(1, d1) * Math.max(1, d2)));
  };
  RF.knifeEdge = function (v) {
    if (v <= -0.78) return 0;
    return 6.9 + 20 * Math.log10(Math.sqrt(Math.pow(v - 0.1, 2) + 1) + v - 0.1);
  };

  /* antenna patterns in one plane. n comes from the half power beamwidth:
     cos^n(hpbw/2) = 0.5, which is the textbook way to fit a lobe to a number on a datasheet. */
  RF.cosN = function (hpbwDeg) {
    return Math.log(0.5) / Math.log(Math.cos(hpbwDeg / 2 * Math.PI / 180));
  };
  RF.patternFront = function (hpbwDeg, frontToBackDb) {
    var n = RF.cosN(hpbwDeg), back = Math.pow(10, -(frontToBackDb || 20) / 10);
    return function (th) {
      var a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
      return Math.max(a < Math.PI / 2 ? Math.pow(Math.cos(a), n) : 0, back);
    };
  };
  RF.patternOmni = function (hpbwDeg) {
    var n = RF.cosN(hpbwDeg || 40);
    return function (th) { return Math.max(0.02, Math.pow(Math.abs(Math.cos(th)), n)); };
  };

  /* cell radius for a target signal level: the one number a predictive survey is */
  RF.cellRadius = function (opts) {
    var eirp = opts.txDbm + opts.antDbi, target = opts.targetDbm, f = opts.fGHz || 5.2,
        n = opts.n || 3, walls = RF.wallLoss(opts.walls), rx = opts.rxAntDbi || 0;
    var budget = eirp + rx - target - walls - RF.fspl(1, f);
    return Math.pow(10, budget / (10 * n));
  };
})(typeof window !== "undefined" ? window : globalThis);
