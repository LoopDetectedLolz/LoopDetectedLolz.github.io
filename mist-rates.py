#!/usr/bin/env python3
"""Print every wireless client on a Mist site with its PHY rate and the MCS rows
that rate could be. Mist reports the rate in Mb/s and no MCS, and the client
stats carry no channel width or stream count, so the best a script can do is
list the candidates and let you narrow them with what you know about the radio.

Environment:
  MIST_TOKEN   an API token for the org
  MIST_SITE    the site id
  MIST_HOST    api.mist.com by default; use your region's host (api.eu.mist.com, ...)

Endpoint: GET /api/v1/sites/{site_id}/stats/clients
Fields used: mac, hostname, proto, band, channel, rssi, snr, tx_rate, rx_rate, tx_retries
"""
import os
import sys
import requests

HOST = os.environ.get("MIST_HOST", "api.mist.com")
TOKEN = os.environ["MIST_TOKEN"]
SITE = os.environ["MIST_SITE"]

# Same table as the site's phy.js: label, bits per subcarrier, coding rate
MCS = [("BPSK 1/2", 1, 1/2), ("QPSK 1/2", 2, 1/2), ("QPSK 3/4", 2, 3/4), ("16-QAM 1/2", 4, 1/2),
       ("16-QAM 3/4", 4, 3/4), ("64-QAM 2/3", 6, 2/3), ("64-QAM 3/4", 6, 3/4), ("64-QAM 5/6", 6, 5/6),
       ("256-QAM 3/4", 8, 3/4), ("256-QAM 5/6", 8, 5/6), ("1024-QAM 3/4", 10, 3/4), ("1024-QAM 5/6", 10, 5/6),
       ("4096-QAM 3/4", 12, 3/4), ("4096-QAM 5/6", 12, 5/6)]
STD = {
    "n":  dict(nsd={20: 52, 40: 108}, tsym=3.2, gi=(0.8, 0.4), mcs_max=7, ss_max=4),
    "ac": dict(nsd={20: 52, 40: 108, 80: 234, 160: 468}, tsym=3.2, gi=(0.8, 0.4), mcs_max=9, ss_max=4),
    "ax": dict(nsd={20: 234, 40: 468, 80: 980, 160: 1960}, tsym=12.8, gi=(0.8, 1.6, 3.2), mcs_max=11, ss_max=4),
    "be": dict(nsd={20: 234, 40: 468, 80: 980, 160: 1960, 320: 3920}, tsym=12.8, gi=(0.8, 1.6, 3.2), mcs_max=13, ss_max=4),
}
# 802.11ac combinations the standard leaves out
EXCL = {20: {9: (1, 2, 4, 5, 7, 8)}, 80: {6: (3, 7), 9: (6,)}, 160: {9: (3,)}}
LEGACY = (1, 2, 5.5, 6, 9, 11, 12, 18, 24, 36, 48, 54)


def candidates(rate, proto):
    """Every (mcs, width, streams) whose PHY rate is within 0.1 percent of `rate`."""
    if rate is None or rate <= 0:
        return []
    if any(abs(rate - v) / v < 0.001 for v in LEGACY):
        return ["legacy rate, not an MCS"]
    out, seen = [], set()
    for std in ([proto] if proto in STD else STD):
        s = STD[std]
        for bw, nsd in s["nsd"].items():
            for ss in range(1, s["ss_max"] + 1):
                for m in range(0, s["mcs_max"] + 1):
                    if std == "ac" and ss in EXCL.get(bw, {}).get(m, ()):
                        continue
                    for gi in s["gi"]:
                        r = nsd * MCS[m][1] * MCS[m][2] * ss / (s["tsym"] + gi)
                        if abs(r - rate) / r < 0.001:
                            idx = m + 8 * (ss - 1) if std == "n" else m
                            key = (std, bw, ss, idx)
                            if key not in seen:
                                seen.add(key)
                                out.append(f"{std} {bw}MHz {ss}SS MCS{idx} ({MCS[m][0]})")
    return out


def main():
    url = f"https://{HOST}/api/v1/sites/{SITE}/stats/clients"
    r = requests.get(url, headers={"Authorization": f"Token {TOKEN}"}, timeout=30)
    r.raise_for_status()
    clients = r.json()
    print(f"{'client':<28} {'proto':<5} {'band':<4} {'ch':>4} {'rssi':>5} {'snr':>4} {'tx':>7} {'rx':>7}  candidates for tx rate")
    for c in sorted(clients, key=lambda c: c.get("tx_rate") or 0, reverse=True):
        name = (c.get("hostname") or c.get("mac") or "?")[:28]
        tx, rx = c.get("tx_rate"), c.get("rx_rate")
        cands = candidates(tx, c.get("proto"))
        shown = "; ".join(cands[:3]) + (f" (+{len(cands) - 3} more)" if len(cands) > 3 else "")
        print(f"{name:<28} {str(c.get('proto')):<5} {str(c.get('band')):<4} {str(c.get('channel')):>4} "
              f"{str(c.get('rssi')):>5} {str(c.get('snr')):>4} {str(tx):>7} {str(rx):>7}  {shown or 'no row matches'}")


if __name__ == "__main__":
    try:
        main()
    except KeyError as e:
        sys.exit(f"set {e.args[0]} in the environment first")
