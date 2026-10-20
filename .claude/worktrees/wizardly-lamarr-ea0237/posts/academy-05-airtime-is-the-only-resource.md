---
title: Airtime Is the Only Resource
slug: academy-05-airtime-is-the-only-resource
date: 2026-09-24
tags: Wireless, Academy, MAC
hero: hero-academy-05.svg
academy: 5
interactive: waityourturn
summary: Before a Wi-Fi radio starts a transmission, it waits for quiet, draws a random number and counts it down, and every other radio on the channel plays the same game. A laptop linked at 1201 Mb/s that sends one packet per turn moves 55 Mb/s. In the site's model, one old 802.11a/g laptop downloading beside it takes its download from about 720 to about 480.
origin: Wireless Academy, lesson 5. Fundamentals first, then a lab on real gear
---
Last week was the table. This week is why you never get the number in it.

The laptop says 1201. The speed test says 480. Last week I said the gap was airtime. Nothing's broken. A radio spends most of its life waiting for a turn, and its rate only counts while it's actually talking.

## The game every radio plays

A Wi-Fi channel is one conversation. One radio talks and everybody else on that channel listens. A radio can't hear anything while it's transmitting, which matters more than it sounds: old shared Ethernet could notice a collision halfway through a frame, and a radio can't. So Wi-Fi avoids collisions instead of detecting them. Every radio, client and AP alike, plays the same game before every transmission it starts on its own.

**Listen for quiet.** The air has to be idle for a set gap first: 43 microseconds for normal traffic on 5 GHz. The original rule, plain DCF, called it DIFS and made it 34. WMM, which everything from Wi-Fi 4 on uses, gives each traffic class its own gap, and 43 is best effort's.

**Draw a number.** A random whole number from 0 to 15. That's the backoff.

**Count it down, one quiet slot at a time.** A slot is 9 microseconds. Every slot the air stays quiet, take one off.

**If somebody else starts talking, freeze.** Don't start over. Wait for them to finish, wait out the gap again, carry on from where you stopped.

**At zero, send.** The receiver answers 16 microseconds after the frame ends with an ACK, or a block ACK if the frame was a bundle of packets.

**No ACK means the frame failed, and the sender can't tell why.** Two radios drawing the same number is one way it happens. Noise and a weak signal are others. Nobody hears a collision; they just never hear back. The rule is the same either way: double the range you draw from, 0 to 31, then 0 to 63, and so on up to 0 to 1023 for a laptop's best effort traffic (the AP's stops at 0 to 63), and go again. After seven attempts, the standard's default, the radio gives up on that frame.

Why random? If everybody waited the same fixed time, everybody would start at the same moment, every time. The random number is all that stands between a busy channel and constant collisions.

That's the lesson, and the game under the hero makes you play it. Level 1 is you and the AP. Level 2 fills the room, hides your number and makes you keep count yourself. Level 3 can't be won, and I'll let you find out why. Level 4 hands you the AP. Play it before you read on. The next section will feel obvious.

## The number that matters

Most of a turn costs the same whatever your rate is:

```
turn = gap + average count + frame + SIFS + ACK
     = 43  + 67.5          + frame + 16   + 28   (microseconds)
```

The average count is half of 15 slots, 67.5 microseconds. So a radio with a steady stream to send waits 110.5 microseconds on average before every frame, even on a channel with nobody else on it.

Take last week's laptop, 1201 Mb/s on two streams at 80 MHz, and have it send one 1500-byte packet per turn. The packet's bits take 10 microseconds at that rate. The preamble in front of them takes 50, and rounding up to a whole symbol makes the frame 64 microseconds long, inside a turn of 218.5.

```
1500 bytes x 8 / 218.5 us = 55 Mb/s
```

That's a 1201 Mb/s laptop, sending one packet per turn, moving 55 Mb/s. The rate is how fast the bits go once you're talking. Throughput is what you move per turn divided by how long a turn takes, and the waiting doesn't care how fast you talk.

That's why aggregation exists. Pack 64 packets into one frame and the turn carries 64 times the data for four times the time: 717 microseconds on the air, 875 for the whole turn, 877 Mb/s. It's the only way anything gets near the PHY rate, and it only works while there's a backlog headed to one place.

Then real life starts. A download isn't one-way. TCP sends acknowledgements back and they play the game too. The site's model puts one laptop alone on a quiet channel, downloading, at about **720 Mb/s**. Put one old laptop beside it that only speaks 802.11a/g, at 54 Mb/s, also downloading, and yours drops to about **480**. There's last week's speed test. If the old one is at the edge of the cell at 6 Mb/s, yours drops to about **210**, and the old laptop holds about 60 percent of the air to get 3 Mb/s.

Those are computed, not measured, averaged over twenty runs of the model: 5 GHz, best effort, 1500-byte packets, no packet extension, everybody hearing everybody, nothing failing except collisions. Real radios also retry frames that fail for other reasons, so real numbers come out lower. The shape is the point. One slow device, and the fast one loses between a third and two thirds of what it had.

## One slow client and everybody pays

The game is fair per turn, not per microsecond. Every radio gets the same shot at every turn, and nobody checks how long the winner will hold the air. Researchers named this the performance anomaly back in 2003, on 802.11b: one slow station drags every station on the channel down to about its own throughput. Aggregation softens that, which is why your laptop kept 210 rather than 3. It doesn't cure it.

It isn't only far-away devices, either. Anything that can't aggregate is expensive per byte at any rate. That's how the 54 Mb/s laptop cost you a third of your download while sitting right next to the AP.

**Airtime fairness** used to be the knob for this: `shaping-policy fair-access` in the AOS 8 `wlan traffic-management-profile`, or `air-time-fairness-mode` under `arm` on Instant, both off by default (`default-access`). Then the gear moved on. The AOS 8 and Instant release notes for 8.10 and 8.11 both list it as not supported on 802.11ax APs. I couldn't find it in AOS 10, where the nearest thing is a per-SSID airtime share under Bandwidth Control that caps an SSID rather than balancing its clients, and I couldn't find it in Mist. The knob most of us learned on isn't on the gear we install now.

What's left is design. Raise the minimum rate so the device at the edge has to find a closer AP. Keep legacy devices off the channel your fast clients live on, or retire them. Build coverage so clients sit near an AP. Level 4 is exactly this problem.

## Overhead before anyone says anything

On 2.4 and 5 GHz, every SSID beacons about ten times a second, from every AP, at the lowest basic rate, whether or not a single client is connected. The model costs a beacon at 250 bytes of body, 278 on the air once the 802.11 header and FCS are on it, and bigger ones cost more. At 6 Mb/s that's 396 microseconds, 0.39 percent of the channel per SSID per AP.

Sounds like nothing. Now multiply. Eight SSIDs on six APs sharing a channel is **18.6 percent** of it, gone, all day. Raise the floor to 12 Mb/s and it's 9.8. Cut to three SSIDs at 12 and it's 3.7. On 2.4 GHz at the 1 Mb/s default a beacon takes 2,416 microseconds, and eight SSIDs cost 19 percent of the channel from one AP before you count its neighbors. That's the old SSID horror story, and it's still true on any 2.4 radio left on defaults.

Broadcast and multicast go out the same way: basic rate, no ACK, no aggregation. The printers post is the worked example. 765 mDNS frames a second, each one put on the air by every AP in the VLAN at 6 Mb/s, cost about 40 percent of a channel, and the main fix was on the switch.

The minimum rate moves all of this at once. New Central's presets are Most Compatible (1 Mb/s on 2.4 GHz, 6 on 5), Balanced (12 and 12) and High Density (24 and 24), and HPE's AOS 10 design guidance recommends 12 or 24. Mist has Compatible, No Legacy and High Density, with High Density at 24 everywhere. The cost is the cell edge. A client that can't hold the new floor has to move or drop, so survey before you raise it in a warehouse.

## WMM: voice cuts the line

WMM plays the same game four times with different rules, one queue per traffic class:

| Queue | Gap (client) | Draws from | Average wait |
|---|---|---|---|
| Voice | 34 us | 0 to 3 | 47.5 us |
| Video | 34 us | 0 to 7 | 65.5 us |
| Best effort | 43 us | 0 to 15 | 110.5 us |
| Background | 79 us | 0 to 15 | 146.5 us |

The AP plays voice and video with an even shorter gap, 25 microseconds. Voice waits less and draws smaller numbers, so it usually goes first, which is why a call can sound fine in a room that's struggling.

It only works while voice is rare. Put eight busy radios in the voice queue and roughly seven turns in ten start with a collision. Draw from 0 to 15 and it's about two in ten. Mark everything as voice and the collisions pile up, and the calls get worse, not better. Level 4 has that switch. Try it.

**The default map gotcha.** On AOS 10 and on Mist, DSCP 46, the EF marking voice traffic actually carries, lands in the video queue by default, not voice. HPE's AOS 10 guidance says to map 46 to voice on any SSID that carries calls, and RFC 8325 says the same from the IETF side. The knob is the WMM DSCP list on the WLAN: `wmm-vo-dscp` on AOS 8, the DSCP mapping next to Voice Wifi Multimedia Share in Classic Central (the share itself is a bandwidth setting), `voice-dscp` under `wmm-cfg` in New Central. Mist's QoS Priority section has an Override QoS option that forces one class for the whole WLAN. That's the everything-as-voice switch, so leave it alone unless the WLAN really carries nothing but calls.

## Wi-Fi 6 and 7, since you'll be asked

Wi-Fi 6 lets the AP run part of the game for its clients. Once the AP has won the air it can send a trigger frame, and several clients answer at once, each on its own slice of the channel. That's uplink OFDMA, with one block ACK covering all of them. The AP can also tell the clients it's scheduling to back off harder on their own for a while, so the scheduled uplink takes over. That's the MU EDCA parameter set, and AOS 8 has a profile for it. AOS 10 has OFDMA on by default in the SSID profile. None of this retires the game. The AP still has to win the air before it can schedule anything, and everything that isn't scheduled still contends.

Wi-Fi 7 adds restricted target wake time, which reserves service periods for latency-sensitive traffic, with other Wi-Fi 7 stations expected to finish before a reserved period starts. Older ones only stay out of the way if the AP also schedules a quiet interval. It also adds multi-link operation, which gives a client more than one link to play on. On a walk through my house, MLO bought me fewer reconnections, not more speed.

## What the gear shows you

**Aruba Central, classic.** Open the AP, then the RF tab. Channel Utilization is split into Transmitting, Receiving and Non-Wifi Interference, and the total is the three added up.

**New Central.** The monitoring API has `channel-utilization-trends` per AP radio, returning `tx`, `rx` and `non_wifi_interference`. I couldn't find the matching UI labels in the docs as of September 2026, so I won't guess them.

**On the AP.** `show ap debug radio-stats 0` (or `1`, depending on which radio has the band you want) gives Channel Busy over 1, 4 and 64 seconds, plus Tx Time and Rx Time as a percentage of recent beacon intervals. `show ap arm rf-summary` has a utilization column per channel.

**Mist.** The AP's Insights page has Channels charts per band. From the API, the device stats carry a `radio_stat` per band with utilization split out:

```python
url = f"https://{HOST}/api/v1/sites/{SITE}/stats/devices"
r = requests.get(url, headers={"Authorization": f"Token {TOKEN}"}, timeout=30)
for ap in r.json():
    b5 = ap.get("radio_stat", {}).get("band_5", {})
    print(ap.get("name"), b5.get("channel"), b5.get("util_all"), b5.get("util_tx"),
          b5.get("util_rx_in_bss"), b5.get("util_rx_other_bss"), b5.get("util_non_wifi"))
```

Placeholder host, token and site. `util_rx_in_bss` is traffic from this AP's own clients. `util_rx_other_bss` is everybody else's on your channel, which is next week's problem.

Here's what to take away from all of them. Every number on these screens is busy air, not useful air. A collision is busy. A beacon nobody needed is busy. A scanner at 6 Mb/s is very busy. The chart looks the same whether the air was doing your work or wasting it. The game's two bars, busy against actually carrying data, are the gap none of these screens show you.

## The lab

One AP, two laptops, a wired box running `iperf3 -s`, under an hour. Pin the AP's channel and power first, and note the Channel Changes and Power Changes counters so you can prove nothing moved.

1. **Baseline.** One SSID, nothing connected, a quiet 5 GHz channel. Read the utilization on both platforms and write it down.
2. **The beacon tax.** Turn on the AP's 2.4 GHz radio on a quiet channel, leave its minimum rate at the 1 Mb/s default, and add SSIDs until there are eight. Give it a few minutes, then read the transmit side of the 2.4 GHz radio's utilization. Set the minimum rate to 12 and read it again.
3. **The fast laptop alone.** Laptop A about 3 m from the AP on 5 GHz, `iperf3 -c <host> -R -t 60`. Write down throughput and utilization.
4. **Add a slow one.** Laptop B on the same SSID and radio, downloading at the same time. Make it slow: put it where it can barely hang on, or force it to 802.11a/g in the adapter's advanced settings if yours has that option. Write down both throughputs and the utilization.
5. **Raise the floor.** Move the minimum rate to 12, then 24, and rerun step 4. Watch where laptop B goes.

**What you should see.** Model expectations, labeled that way until I've run this on my own bench. Eight SSIDs on 2.4 GHz at 1 Mb/s should add about 19 percent of transmit utilization from one AP, and about 2 percent at 12 Mb/s. Laptop A alone should land well under its PHY rate: the model says about 720 Mb/s for a 1201 link, before real retries take their cut. With B downloading beside it at 6 or 12 Mb/s, A should lose half or more while utilization climbs. If B is only forced to 802.11a/g close to the AP, A should lose about a third while utilization actually drops a little, 83 to 77 percent in the model. Less busy, and a third less done. That's the whole lesson on one screen. Raise the floor past what B can hold and B leaves, and A gets its air back.

**What means it's broken.** If utilization doesn't move when you add SSIDs, check that the new ones are actually broadcasting on the radio you're watching. If A doesn't drop when B starts, B is probably on the other band or another AP, so check its channel in the client list. If utilization is high with nothing connected, something else is on your channel. Look at the receive and non-Wi-Fi split before you blame the SSIDs.

## Three questions

1. A client linked at 1201 Mb/s sends one 1500-byte packet per turn on an empty channel. Roughly what does it get, and where did the rest go?
2. Eight SSIDs, six APs sharing one 5 GHz channel, 6 Mb/s minimum. How much of that channel goes on beacons, and what does a 12 Mb/s minimum do to it?
3. Why can't you just mark everything as voice?

Answers: About 55 Mb/s. The packet's bits take 10 microseconds of a 218.5 microsecond turn; the rest is the gap, the count, the preamble, the padding in the last symbol, the 16 microsecond pause and the ACK. About 18.6 percent, and 12 Mb/s roughly halves it, to 9.8. Voice draws its number from 0 to 3, so with lots of busy radios in that queue most turns start with a collision and the real calls suffer. Priority only works while most traffic doesn't have it.

## Next lesson

Interference from yourself. Somebody asked on LinkedIn, under the lesson 2 post, whether adding APs to a big open floor makes the cell edge worse. The answer is mostly about channel width, and it starts where this lesson stops: `util_rx_other_bss`.
