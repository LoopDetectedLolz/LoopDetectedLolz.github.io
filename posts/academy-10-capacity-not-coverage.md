---
title: Capacity, Not Coverage
slug: academy-10-capacity-not-coverage
date: 2026-09-27
tags: Wireless, Academy, Design
hero: hero-academy-10.svg
academy: 10
summary: Coverage asks whether everyone can hear the AP. Capacity asks whether everyone gets a turn. The cell isn't drawn by power, it's drawn by the slowest rate you allow, and raising that rate is the cheapest capacity you'll ever buy.
origin: Wireless Academy, lesson 10. Fundamentals first, then a lab on real gear
---
Last week the client decided when to leave. This week is how many of them you can afford in the room at once.

Every heatmap I've been handed answers one question: can a client hear the AP at -67 dBm from here. That's coverage. It's the wrong question for a lecture hall, a warehouse at shift change, or an office where every desk has a laptop, a phone and a headset. Those places fail with full bars. The signal is fine. The airtime is gone.

## Two designs that look the same on a floor plan

A coverage design puts APs where the signal runs out. Big cells, full power, as few boxes as you can get away with. It works right up until enough people show up.

A capacity design starts from the other end. How many clients, what are they doing, how much airtime does that take. Then it works out how many cells carry it and makes each cell small enough to hold its share. Same APs, same ceiling, different count and a different set of knobs. Three numbers drive it.

**Clients per radio.** A design assumption, not physics. The association limits are huge: Mist's doc gives 512 per radio on its Wi-Fi 6 and 6E APs, Meraki's says the same for its Wi-Fi 6 gear and then tells you the real number is far lower. For a working figure, Meraki's high density guide plans on about 25 clients per radio, 50 per AP. I plan on 25 to 30 per 5 GHz radio for laptops doing real work.

**Application budget.** Per client, per direction, and only what the vendor publishes. Microsoft's Teams network page says one-to-one audio wants 58 kb/s each way recommended, 76 for best, and one-to-one video 1,500 kb/s each way recommended. Zoom's page says audio is 60 to 80 kb/s and 1:1 video runs from 600 kb/s each way up to 3.8 up and 3.0 down for 1080p. Meraki budgets web browsing at 500 kb/s, which is bursty and nothing like a stream. Budget the worst thing a normal user does.

**Cell size.** This is the part people get backwards. The cell is not drawn by transmit power. It's drawn by the slowest rate the AP will talk at. The minimum basic rate is what beacons, probe responses and most management frames go out at, and a client can only join where it can decode a beacon. A beacon at 6 Mb/s decodes a long way out. Raise the MBR to 24 and the beacon needs about 8 dB more signal, which on lesson 1's rule is a lot less floor. The client at the edge that used to sit at 6 Mb/s, taking ten or twenty times the airtime of everyone else for the same frame, can't associate there any more. It finds a closer AP, which is what you put the closer AP in for.

Aruba's Instant radio profile has `min-tx-power` and `max-tx-power`. Those are power. They move where the signal reaches; they don't change what rate the beacon goes out at. Rates live in the SSID profile, and that's this lesson's knob.

## The number that matters

Two pieces of arithmetic. First, demand on a cell, which is lesson 5's airtime in a different coat:

```
airtime needed = clients x per-client demand (both directions, it's half duplex)
                 ------------------------------------------------------------
                  realistic throughput of the cell at the rates clients get
```

Worked once, with a model figure on the bottom line. Twenty-five laptops on a 5 GHz radio, all on Teams video at the recommended 1,500 kb/s each way. Say the cell really delivers 100 Mb/s, a 40 MHz cell with clients spread over the mid rungs and lesson 5's overhead taken off. That's my model, not a measurement:

```
25 x 1.5 Mb/s x 2 directions = 75 Mb/s
75 / 100 = 0.75, about 75 percent busy before anybody opens a browser
```

That cell is full. Not broken, full. The fix isn't power. It's a second cell, which is a second AP, which is a second channel, and lesson 6 told you channels are finite. A capacity design is a channel budget as much as an AP budget. Smaller cells, more APs, more co-channel reuse, and the rate you raise this week is what stops those cells hearing each other next week.

Second, the beacon, the cost you pay whether anyone shows up or not. A beacon is a few hundred bytes; 7SIGNAL's write-up puts it at 60 to 450, so call it 300. It goes out every 102.4 ms per SSID per radio, about ten a second, with a preamble the standard sets: 192 microseconds for the long DSSS preamble at 1 Mb/s, 20 microseconds for OFDM. An approximation, ignoring OFDM symbol padding:

```
300 bytes = 2400 bits

at  1 Mb/s:  2400 us + 192 us = 2592 us x 10/s = 25.9 ms/s   2.6 percent
at  6 Mb/s:   400 us +  20 us =  420 us x 10/s =  4.2 ms/s   0.4 percent
at 24 Mb/s:   100 us +  20 us =  120 us x 10/s =  1.2 ms/s   0.1 percent

six SSIDs:   1 Mb/s 15.6 percent   6 Mb/s 2.5 percent   24 Mb/s 0.7 percent
```

Six SSIDs at 1 Mb/s is a sixth of the 2.4 GHz channel spent announcing yourself to nobody, before a single probe response. It's why Mist's WLAN doc says two or three WLANs per AP and names the beacon at the MBR as the reason. The 1 Mb/s line only exists on 2.4 GHz; 5 GHz bottoms out at 6.

## What the gear shows you

Both vendors have the knob. Aruba splits it in two.

**Aruba.** In Central the WLAN's Advanced settings have Transmit Rates (Legacy Only), a minimum and maximum per band, default 1 to 54 on 2.4 GHz and 6 to 54 on 5 GHz, with no 6 GHz row. There's a separate Beacon Rate per band, default the minimum valid rate, so out of the box the beacon rides the lowest basic rate. On the CLI the split is explicit. Instant and AOS 8 both put it in `wlan ssid-profile`: `a-basic-rates` and `g-basic-rates` are the rates advertised as mandatory in the beacon, `a-tx-rates` and `g-tx-rates` are the rates the AP may send data at. Defaults are 6, 12 and 24 basic on 5 GHz, 1 and 2 on 2.4 GHz. AOS 8 adds `a-beacon-rate` and `g-beacon-rate`, and the doc says they're for DAS and can cause connectivity problems in normal use. Which of these Central's minimum box writes I haven't confirmed on a box, as of September 2026; check `show running-config` after. On the signal side the same page has Min SNR for auth request, automatic or a manual dB value, which is Aruba's closest thing to a minimum signal to join.

**Mist.** The WLAN's Data Rates block has four options. Compatible, the default, sets a 1 Mb/s MBR with everything enabled. No Legacy drops 802.11b and sets the MBR to 12. High Density sets 24 and disables everything below. Custom marks each rate per band Disabled, Supported or Mandatory, and the lowest Mandatory becomes the MBR. The doc is careful about what this controls: the AP's transmissions. The client may still transmit at rates you disabled, and it won't be able to connect at them. In the API it's `rateset` per band, `template` one of `compatible`, `no-legacy`, `high-density`, `custom`, and a `legacy` list where `24b` means 24 basic. One warning: Mist's design guide and its product doc disagree on the No Legacy MBR, 6 versus 12. Trust the beacon. Separately the WLAN has Geofence, a minimum client RSSI per band that applies to the initial association only; `min_rssi` in the same `rateset` object. Aruba's Min SNR measured the other way round.

**Reading the effect.** The honest readout is a capture. A beacon's radiotap header carries the rate it was sent at, and its Supported Rates element flags the basic ones. Ekahau AI Pro's Optimizer has a Min Basic Rate check; which column, if any, the Analyzer app shows the beacon rate in I haven't checked as of September 2026. For who survived, Central's Clients list and Mist's WiFi Clients page. For who didn't, Mist's Client Insights has Association Failure and 802.11 Auth Denied in its negative events, which is where a client that can't decode your new beacon lands.

## The lab

One AP, one laptop, tape on the floor, under an hour.

1. Pin the AP: fixed channel, 20 MHz, fixed power. Confirm default rates, Aruba minimum 6 on 5 GHz, Mist Compatible. Disable the 2.4 GHz radio for the hour or you'll measure the wrong band.
2. Mark lesson 1's spots at 2, 4, 8 and 16 m and keep walking the line until the laptop drops. Tape that. Note RSSI and Tx|Rx Rate from Central, or Current Values in Client Insights, at each spot.
3. Raise the floor. Aruba: minimum transmit rate 24 on 5 GHz. Mist: High Density. Both touch the beacon, so expect the laptop to drop and don't be surprised if the radio resets.
4. Reconnect at 2 m and walk the line again. Tape where the laptop can no longer join. Note the RSSI there.
5. Sidekick capture on your channel, thirty seconds before and after. Filter to beacons, read the rate, count them, and multiply by the duration from the code block if you want the airtime figure back as a measurement.
6. Put it back. Don't be the person who leaves a lab AP at 24 in a building with printers.

**What you should see.** The join edge moves in. 24 Mb/s wants about 8 dB more than 6 to decode, and 6 dB per doubling of distance puts the new edge at about 40 percent of the old distance, the standard's expectation and not a promise. Beacons in the capture go from 6 to 24 and each one takes about a third of the airtime. The laptop's rate at 2 m doesn't move; you changed the floor, not the ceiling.

**What means it's broken.** A client that won't join at any distance has a radio that doesn't support your new floor. It's always a printer. A laptop that reconnects but sits at 6 Mb/s means the beacon didn't change, and on Aruba that's the moment to check whether basic rates or only tx rates moved. Association Failure in Mist at a spot where it used to join isn't broken. That's the lesson working.

## Three questions

1. You double the transmit power on an AP. What happens to the rate its beacons go out at, and to the edge where a client can associate?
2. A 2.4 GHz radio carries six SSIDs at a 1 Mb/s MBR. About what share of the channel is beacons, and what does it drop to at 12?
3. Forty laptops on Teams video on one 5 GHz radio at the recommended bitrate. With this lesson's model cell, how many radios?

Answers: The beacon rate doesn't change, the edge moves out, and you've made the airtime hog's cell bigger. About 16 percent at 1 Mb/s; at 12 a beacon is 200 plus 20 microseconds, about 1.3 percent for six. Forty times 1.5 times two is 120 Mb/s against a 100 Mb/s cell, so two radios, and on 2.4 GHz there's no second channel to put it on.

## Next lesson

Surveys and what a heatmap can't see. Predictive, AP-on-a-stick and validation, with a one-room passive survey on the Sidekick cross-checked against what the AP is really on.
