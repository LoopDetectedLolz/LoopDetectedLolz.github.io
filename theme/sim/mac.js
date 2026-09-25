/* MAC: the tax. Everything between one station finishing and the next one
   starting, which is where a surprising share of a Wi-Fi cell actually goes. */
(function (root) {
  var NFN = root.NFN = root.NFN || {};
  var MAC = NFN.mac = {};

  MAC.T = {
    SIFS: 16, SLOT: 9, DIFS: 34,      /* 5 and 6 GHz values */
    ACK: 28, BA: 32,                   /* control frames at a basic rate */
    ACKTO: 50,                         /* AckTimeout = SIFS + slot + aPHYRxStartDelay (16 + 9 + 25), 802.11-2020 10.3.2.9 */
    CWMIN: 15, CWMAX: 1023, RETRY_MAX: 7
  };

  /* a station waits a random number of slots in [0, CW]; on average half of it */
  MAC.avgBackoff = function (cw) { return ((cw === undefined ? MAC.T.CWMIN : cw) / 2) * MAC.T.SLOT; };

  /* the contention window after n failed attempts: doubled each time, capped */
  MAC.cwAfter = function (fails, cw0) {
    var cw = (cw0 === undefined ? MAC.T.CWMIN : cw0) + 1;
    return Math.min(cw * Math.pow(2, fails), MAC.T.CWMAX + 1) - 1;
  };

  /* microseconds of channel time one successful transmission costs, end to end */
  MAC.txopTime = function (opts) {
    var air = NFN.phy.frameAirtime(opts),
        ack = (opts.agg || 1) > 1 ? MAC.T.BA : MAC.T.ACK;
    return MAC.avgBackoff(opts.cw) + MAC.T.DIFS + air + MAC.T.SIFS + ack;
  };

  /* Retries are not free and they are not cheap. Each attempt costs DIFS, a
     backoff and the whole frame; a failed one then waits out the ACK timeout
     (50 us) and the next attempt draws its backoff from a doubled window (31,
     63, 127 ... slots). retry is the chance any one attempt fails; the sum walks
     the attempts a frame is allowed (RETRY_MAX) with the probability of getting
     that far, so at retry 0 this is txopTime exactly. Frames still failing
     after the last attempt are dropped, and throughput() pays for that too. */
  MAC.txopWithRetries = function (opts) {
    var r = NFN.clamp(opts.retry === undefined ? 0.1 : opts.retry, 0, 0.9),
        air = NFN.phy.frameAirtime(opts),
        ack = (opts.agg || 1) > 1 ? MAC.T.BA : MAC.T.ACK,
        total = 0, p = 1, i;
    for (i = 0; i <= MAC.T.RETRY_MAX; i++) {
      total += p * (MAC.T.DIFS + MAC.avgBackoff(MAC.cwAfter(i, opts.cw)) + air
                    + (1 - r) * (MAC.T.SIFS + ack) + r * MAC.T.ACKTO);
      p *= r;                        /* the chance the next attempt is needed at all */
    }
    return total;
  };
  /* the share of frames that get through inside the retry limit */
  MAC.delivered = function (retry) {
    var r = NFN.clamp(retry === undefined ? 0.1 : retry, 0, 0.9);
    return 1 - Math.pow(r, MAC.T.RETRY_MAX + 1);
  };

  /* bits per second a single station gets when it has the medium to itself */
  MAC.throughput = function (opts) {
    var agg = Math.max(1, opts.agg || 1), bytes = opts.bytes === undefined ? 1500 : opts.bytes;
    return MAC.delivered(opts.retry) * agg * bytes * 8 / (MAC.txopWithRetries(opts) * 1e-6);
  };

  /* What a beacon set costs before a single client has said anything. A beacon
     is a management frame sent at the lowest basic rate, 6 Mb/s non-HT on 5 and
     6 GHz, whatever the SSID's clients can do: about 396 us for a 250-byte body,
     not the 315 us an HE MCS 0 PPDU would take. std is kept for a caller that
     wants to cost a different basic rate. */
  MAC.beaconOverhead = function (ssids, intervalMs, std) {
    var air = NFN.phy.frameAirtime({ std: std || "a", mcs: 0, ss: 1, bw: 20, bytes: 250, agg: 1, kind: "mgmt" });
    return (ssids || 1) * (air * 1e-6) / ((intervalMs || 102.4) / 1000);
  };
})(typeof window !== "undefined" ? window : globalThis);
