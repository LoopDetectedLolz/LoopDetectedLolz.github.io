---
title: Modulation and Data Rates
slug: academy-04-modulation-and-data-rates
date: 2026-09-23
tags: Wireless, Academy, PHY
hero: hero-academy-04.svg
academy: 4
interactive: betheradio
summary: The speed of a Wi-Fi link isn't a number, it's a row in a table, and the radio picks a row for every transmission. Neither Central nor Mist will tell you which row. This is how to read it backwards from what they do show, then cap it on purpose and measure what it cost.
origin: Wireless Academy, lesson 4. Fundamentals first, then a lab on real gear
---
Last week was whether the signal gets across the room. This week is what the radio does with it once it has.

Somebody asks how fast the Wi-Fi is. The datasheet says 2.4 Gbps. The laptop says 1201 Mbps. The speed test says 480. The user says slow. All four are true and none of them describe the same thing. The datasheet is the top of a table. The laptop is the row the radio picked a moment ago. The speed test is what survived airtime, which is next week. This lesson is the table.

## Speed is a table, not a number

A radio doesn't have a speed. It has a list of ways to put bits on a carrier and it picks one for every transmission, and can pick a different one for the retry. That list is the MCS table, and every row is three choices.

**Modulation** is how many states one symbol on one subcarrier can take. BPSK has two, so one bit. QPSK four, two bits. 16-QAM four bits, 64-QAM six, 256-QAM eight, and 1024-QAM, new to the standard in Wi-Fi 6, ten. Wi-Fi 7 adds 4096-QAM at twelve, and it's optional in the certification, so don't assume a Wi-Fi 7 client has it. More states means the points sit closer together and less noise is needed to push one into its neighbor. That's the whole trade. Every rung up buys bits per symbol and costs signal margin. Don't take my word for it. Drag the slider under the four constellations below and watch the clouds grow until the receiver starts guessing.

{{widget: constellation}}

**Coding rate** is how much of what you send is redundancy. 1/2 means one of every two bits on the air is redundancy the receiver uses to repair damage. 5/6 means five bits of payload for every six sent.

**Spatial streams** multiply the lot. Two streams, twice the rate, if both ends have the antennas. Most phones are 2x2. Most printers, thermostats and badge readers are 1x1, and there's nothing the AP can do about that.

Wi-Fi 6 gives you MCS 0 through 11, BPSK 1/2 at the bottom and 1024-QAM 5/6 at the top. Width and guard interval set the rest. Everything you've been told about "Wi-Fi speed" is somebody pointing at one cell of that table.

**Wi-Fi 7, since you'll be asked.** 802.11be adds two rungs, MCS 12 and 13, 4096-QAM at 3/4 and 5/6, twelve bits per subcarrier. It doubles the widest channel to 320 MHz, and 320 only exists in 6 GHz. Same symbol, same guard intervals, so the arithmetic below still works: 3920 data subcarriers at 320 MHz, and a two-stream client at MCS 13 comes out at 5764.7 Mb/s. Three catches. 4096-QAM wants on the order of 40 dB of SNR, which is a client on the same desk as the AP. It's optional in Wi-Fi CERTIFIED 7 and outside the mandatory MCS set, so plenty of Wi-Fi 7 silicon tops out at MCS 11 and the number on the box never happens. And multi-link operation lets one association use more than one band at the same time, so a Wi-Fi 7 client's rate can be two rows of the table added together. The Mist API reports those clients as proto `be`. What Central labels them I haven't checked on a box yet, as of September 2026.

## The number that matters

```
rate = data subcarriers x bits per subcarrier x coding rate x streams
       ---------------------------------------------------------------
                       symbol time + guard interval
```

For Wi-Fi 6 the symbol is 12.8 microseconds and the shortest guard interval it allows is 0.8, so the bottom is 13.6. A 20 MHz channel has 234 data subcarriers, an 80 MHz channel 980. Worked once, for a laptop on 80 MHz, two streams, top of the table:

```
980 x 10 x 5/6 x 2 / 13.6 us = 1201 Mbps
```

That's the number the laptop shows you. Same channel at MCS 7, 64-QAM 5/6:

```
980 x 6 x 5/6 x 2 / 13.6 us = 720.6 Mbps
```

MCS 0 on the same channel is about 72 Mbps. Top to bottom is a factor of seventeen on one channel. Width and streams set the scale; MCS moves you along it.

The other half of the table is what each rung costs. The 802.11ax standard sets a minimum receiver sensitivity per MCS on 20 MHz: -82 dBm at MCS 0 up to -52 dBm at MCS 11, and each doubling of width relaxes that by 3 dB. Those are conformance floors at 10 percent packet error and real radios beat them by a few dB. The point is the span. Thirty decibels separate the bottom rung from the top. Last week's budget doesn't tell you whether the link works. It tells you which rung you get.

In SNR terms, the version you'll use on site: BPSK wants a few dB, 16-QAM the low teens, 64-QAM somewhere from the high teens to the high twenties depending on coding rate, 256-QAM mid twenties to mid thirties, 1024-QAM the mid thirties. Wide ranges, and the published charts disagree with each other by 5 dB or more, because the chipset's rate adaptation draws the actual lines. A design that targets 25 dB SNR is really saying "64-QAM everywhere, 256 where I can get it."

Before you touch real gear, be the radio for twelve rounds. The game below shows you the SNR and nothing else, same as the real thing, and you pick the rung. Level 1 is a walk down a corridor. Level 2 has a microwave in it. Level 3 is a badge reader that somebody wants 300 Mb/s out of, and I'll let you find out what the right button is. The rungs and the SNR floors are the site's own numbers, the same ones the lab section's expectations came from.

## What the gear shows you

Here's what surprised me writing this. Neither platform shows the MCS index. As of September 2026, Central's client page has no MCS field and the Mist client stats API has no MCS field. Both hand you a PHY rate in Mbps and leave you to read the table backwards. So learn the table. Or cheat: [Read It Backwards](../tools.html#readitbackwards) on the Tools page takes the number and whatever you know about the link and names the row, or lists every row it could be when you know nothing, which is more rows than you'd think.

In Aruba Central, open the client from the Clients list. The health bar shows Tx|Rx Rate, and further down there are Retry Frames and Tx/Rx Rate graphs. Add the channel width from the radio and the stream count from the laptop's own adapter details, and you can place it: 1201 on 80 MHz with two streams is MCS 11, 960.8 is MCS 9, 720.6 is MCS 7.

On the AP, `show ap debug client-table` gives Tx_Rate and Rx_Rate per client, and the doc is specific that these are the rate of the last packet each way, not an average. That's why Rx_Rate often reads 6 Mbps next to a Tx_Rate in the hundreds. The last thing the client sent was probably a null frame or an ACK, and clients typically send those at the lowest basic rate. Not broken. Literal. The command that actually shows MCS is `show ap debug client-stats`: counters per MCS, per stream count and per width for that client, so you see the histogram of what rate adaptation has been doing rather than its last pick. The syntax differs by platform. On an AOS 8 controller it's `show ap debug client-stats client-mac <mac>`; on Instant and AOS 10 it's `show ap debug client-stats <mac> <bssid>` with no keyword. On AOS 10 it arrived in 10.3.1.0.

In Mist, open the client from WiFi Clients and follow the Client Insights link. Current Values gives you the RX and TX rates and the protocol. The TX/RX PHY Rates chart over time is there if the org has Marvis for Wireless; without it you get bytes, not rates. From the API, `GET /api/v1/sites/{site_id}/stats/clients` returns `tx_rate` and `rx_rate` in Mbps with `proto`, `band` and `channel`, which is everything a script needs to place the client on the table. The spec's own example has `tx_rate 173.3` and `rx_rate 6`. Same last-packet effect. The stats carry no channel width and no stream count, so a script can't name the row either; it can list the candidates. That's what `mist-rates.py` in the repo does, one request and a table:

```python
url = f"https://{HOST}/api/v1/sites/{SITE}/stats/clients"
r = requests.get(url, headers={"Authorization": f"Token {TOKEN}"}, timeout=30)
for c in r.json():
    print(c.get("hostname"), c.get("proto"), c.get("band"), c.get("channel"),
          c.get("rssi"), c.get("snr"), c.get("tx_rate"), c.get("rx_rate"),
          candidates(c.get("tx_rate"), c.get("proto")))
```

`candidates()` is the same arithmetic as the decoder, capped at four streams because clients stop there. Placeholder host, token and site id; use your region's API host.

Capping the rate on purpose, which the lab needs, lives in odd places. In Central for AOS 10 the WLAN's Advanced settings have an Enable 11ax toggle. Off, a 5 GHz client has nothing above 802.11ac to associate as, so it should top out at VHT MCS 9, the Wi-Fi 5 ceiling. No doc page says that in so many words; it's the table. The Transmit Rates section on that page is labeled Legacy Only and touches nothing above 54 Mbps. On AOS 8, `wlan he-ssid-profile` has `he-supported-mcs-map`, a comma-separated list of the max MCS for each of eight streams, each 7, 9 or 11, which is the one proper 11ax cap I found on the Aruba side. Instant has `high-efficiency-disable` and `vht-supported-mcs-map` in the `wlan ssid-profile`. In Mist, untick Wi-Fi 6 under Wi-Fi Protocols on the WLAN, `disable_11ax` in the API. Deeper than that is the `rateset` object with `template` set to `custom` and an `he` bitmask per stream, encoded the same way as the documented `ht` and `vht` masks. The schema defines it but none of the spec's worked examples use it, so test it before you lean on it.

One caution the Mist data rates doc gives for its custom legacy rates, and I'd apply it to every rate knob on every platform: you control what the AP transmits. The client may still send at rates you disabled, and the AP will refuse to talk to it at those. You're capping half the link directly and the other half only by consequence.

## The lab

One AP, one laptop, a wired box for iperf3, under an hour.

1. Pin the AP. Fixed channel, 80 MHz, fixed power. Note Central's Channel Changes and Power Changes counters, or Mist's Radio Events, so you can prove nothing moved.
2. Sidekick in spectrum view on your channel for a minute. If it's busy, move. A dirty channel changes the answer and that's lesson 7's problem.
3. Laptop 3 m from the AP, line of sight. `iperf3 -s` on the wired host, `iperf3 -c <host> -R -t 30` on the laptop. Write down the throughput.
4. Read the rate. Central: Tx|Rx Rate. Mist: Current Values on Client Insights, or `tx_rate` from the API. Convert it to an MCS with the table and write that down too.
5. Cap it. Turn Wi-Fi 6 off on the SSID on both platforms and reconnect the laptop. It should now top out at 802.11ac MCS 9, which on 80 MHz with two streams is 866.7 Mbps. Rerun iperf3.
6. Cap harder if your platform lets you: `he-supported-mcs-map` on AOS 8, the `he` bitmask on Mist. Aim for MCS 7. Rerun.
7. Put it all back, then walk away until the rate drops on its own. Watch it step, not slide, and watch retries on the same screen.

**What you should see.** Same deal as lesson 2: these are what the model expects, and the measured numbers replace them when I've run it. The rate is always a rung from the table, never a number between rungs. Throughput follows the rate down but the ratio is well under one; the gap is airtime and it's next week. At 3 m the capped runs should cost you roughly in proportion to the rate you took away. On the walk the rate holds, then steps. Rate adaptation loops mostly move on what got acknowledged, not on the RSSI number, which is why the rate lags a few meters behind the signal.

**What means it's broken.** A Tx rate of 6, 12 or 24 Mbps at 3 m can only be a legacy 802.11a rate, no HT, VHT or HE row lands on those numbers at any width: check the client is on 802.11ax and on 5 GHz, not the 2.4 GHz radio you forgot to disable. A rate that won't budge after the cap means the client hasn't reassociated; bounce the laptop's radio. Throughput that collapses while the rate stays high means retries, and the counter is next to the rate on both platforms. Read it.

Whatever laptop you use, it'll sit on the same rungs and stop at different places from mine, because the rungs are the standard and the stopping points are the chipset.

## Three questions

1. Central shows a client at 960.8 Mbps on an 80 MHz channel with two streams. Which MCS, and which modulation?
2. You turn Wi-Fi 6 off on an SSID. On 80 MHz with two streams, what does the top rate drop from and to?
3. A client's SNR is 22 dB. Where on the table is it living, and what would it take to reach 256-QAM?

Answers: MCS 9, 256-QAM at 5/6. From 1201 Mbps to 866.7. 64-QAM, MCS 5 or 6 territory. 256-QAM wants somewhere in the mid twenties to mid thirties depending on the chart and the chipset, so at least a few more dB and possibly ten, which means closer than half the distance, or a cleaner channel.

## Next lesson

Airtime is the only resource. Why a 1201 Mbps link delivers 480, and why one slow client hurts everyone on the channel, with the mDNS post as the case study.
