/* MAC: the tax. Everything between one station finishing and the next one
   starting, which is where a surprising share of a Wi-Fi cell actually goes. */
(function (root) {
  var NFN = root.NFN = root.NFN || {};
  var MAC = NFN.mac = {};

  MAC.T = {
    SIFS: 16, SLOT: 9, DIFS: 34,      /* 5 and 6 GHz values */
    ACK: 28, BA: 32,                   /* control frames at a basic rate */
    CWMIN: 15, CWMAX: 1023, RETRY_MAX: 7
  };

  /* a station waits a random number of slots in [0, CW]; on average half of it */
  MAC.avgBackoff = function (cw) { return ((cw === undefined ? MAC.T.CWMIN : cw) / 2) * MAC.T.SLOT; };

  /* microseconds of channel time one successful transmission costs, end to end */
  MAC.txopTime = function (opts) {
    var air = NFN.phy.frameAirtime(opts),
        ack = (opts.agg || 1) > 1 ? MAC.T.BA : MAC.T.ACK;
    return MAC.avgBackoff(opts.cw) + MAC.T.DIFS + air + MAC.T.SIFS + ack;
  };

  /* Retries are not free and they are not cheap: a failed attempt costs the whole
     frame plus an ACK timeout plus a doubled backoff before anyone tries again. */
  MAC.txopWithRetries = function (opts) {
    var r = NFN.clamp(opts.retry === undefined ? 0.1 : opts.retry, 0, 0.9),
        good = MAC.txopTime(opts),
        failed = MAC.avgBackoff(opts.cw) + MAC.T.DIFS + NFN.phy.frameAirtime(opts) + MAC.T.SIFS + 10,
        n = r / (1 - r);              /* expected failed attempts per success */
    return good + n * failed;
  };

  /* bits per second a single station gets when it has the medium to itself */
  MAC.throughput = function (opts) {
    var agg = Math.max(1, opts.agg || 1), bytes = opts.bytes === undefined ? 1500 : opts.bytes;
    return agg * bytes * 8 / (MAC.txopWithRetries(opts) * 1e-6);
  };

  /* what a beacon set costs before a single client has said anything */
  MAC.beaconOverhead = function (ssids, intervalMs, std) {
    var air = NFN.phy.frameAirtime({ std: std || "ax", mcs: 0, ss: 1, bw: 20, bytes: 250, agg: 1 });
    return (ssids || 1) * (air * 1e-6) / ((intervalMs || 102.4) / 1000);
  };
})(typeof window !== "undefined" ? window : globalThis);
