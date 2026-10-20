---
title: Noise, SNR, and Why RSSI Lies
slug: academy-07-noise-snr-and-why-rssi-lies
date: 2026-09-25
tags: Wireless, Academy, RF
hero: hero-academy-07.svg
academy: 7
summary: A client at -67 dBm can be flying or crawling and the RSSI number won't tell you which. The noise floor will. Where the floor comes from, why a Wi-Fi card can't see most of what raises it, and a lab where you raise it yourself with a microwave oven.
origin: Wireless Academy, lesson 7. Fundamentals first, then a lab on real gear
---
Last week ended with adjacent-channel overlap raising the noise floor. This week is the floor itself, and why the number everybody stares at doesn't include it.

A client sits at -67 dBm and the user says it's slow. Somebody opens the client page, sees a healthy bar, and says the Wi-Fi is fine. Both are right about what they can see. RSSI is how loud the AP is. It says nothing about how loud everything else is, and the radio only cares about the gap. That gap is SNR, and SNR picks the rung on lesson 4's table. Not the signal. The gap.

## Where the floor comes from

With nothing transmitting anywhere, a receiver still hears noise. Thermal noise, the electrons in its own front end moving about, and physics gives it a number: about -174 dBm per hertz of bandwidth at room temperature. Wider channel, more hertz, more noise. A 20 MHz channel collects 73 dB worth of hertz, so its thermal floor is -101 dBm, and every doubling of width adds 3 dB: -98 at 40, -95 at 80, -92 at 160. That's the price of width from lesson 2, paid before a single frame goes on the air.

Then the receiver adds its own. The amplifier chain adds a few dB called the noise figure, and how few depends on the silicon. The AP-735 in my lab reports a noise floor of -91 dBm on its 80 MHz channel in `show ap debug radio-stats`, about 4 dB over thermal, and `show ap arm rf-summary` lists -88 to -92 for each 20 MHz channel it scanned, which is 9 to 13 dB over thermal at that width, because a scan is a quick sample and the neighbors are in it. A laptop I've seen written up reads -98 on 20 MHz, 3 dB over. Cheaper radios are worse. So a quiet channel on real gear sits somewhere between -98 and about -88 depending on the radio, the width and how the box measures it, and Aruba's own doc says a floor above -80 dBm is a sign of trouble. I'll use -95 for the sums because it's in the middle of that spread. Anything near -80 means the room has a problem.

Everything above thermal plus noise figure is the room. Other people's Wi-Fi too weak to decode. Microwaves. Cameras. Bluetooth. The floor the AP reports is the total, and it can't tell you which part is which. It's a sum, and computers are very patient about summing.

## The number that matters

```
SNR (dB) = RSSI (dBm) - noise floor (dBm)
```

Same client, -67 dBm, two rooms. A quiet one and one with something running in it.

```
-67 - (-95) = 28 dB SNR   ->  MCS 7, 64-QAM 5/6, 86 Mb/s on 20 MHz one stream
-67 - (-80) = 13 dB SNR   ->  MCS 3, 16-QAM 1/2, 34 Mb/s on 20 MHz one stream
```

The rows are lesson 4's SNR floors, the site's own typical figures: MCS 7 wants 25 dB and MCS 8 wants 29, so 28 lands on 7. MCS 3 wants 12 and MCS 4 wants 16, so 13 lands on 3. The signal didn't move. The floor came up 15 dB and took four rungs and 60 percent of the rate with it, and the retries on the way down come out of lesson 5's airtime, so the whole channel pays.

## Why RSSI lies

It doesn't lie, exactly. It answers a narrower question than people think they're asking. A Wi-Fi chip is a modem. It reports the strength of 802.11 frames it managed to decode, because that's what it's for. Energy it can't demodulate isn't a frame, so it isn't signal; the chip lumps it into the noise floor and moves on. A microwave oven three meters away doesn't lower your RSSI at all. It raises the floor, and the client page shows you the one number that can't see it.

A spectrum analyzer is the opposite kind of tool. It measures energy in a slice of frequency and doesn't care whether anything decodes. Everything shows up, with a shape:

- **A microwave oven** is a wide hill centerd around 2.45 GHz that switches on and off with a regular cadence rather than sitting solid. It's a 2.4 GHz problem only; there's nothing for it to leak into at 5 GHz.
- **Bluetooth** is narrow spikes hopping across the whole 2.4 GHz band, 79 channels of 1 MHz at 1,600 hops a second. Low power, everywhere, briefly.
- **Wireless cameras** of the old analogue kind are the worst: a solid block that never stops, because video never stops. Vendor testing puts the duty cycle at 90 to 100 percent and the throughput on that channel at nothing.
- **Radar** on the DFS channels is short high-power bursts. Your AP has to leave the channel when it sees one and stay off it for at least 30 minutes, which shows up as a channel change nobody asked for.
- **Neighboring Wi-Fi too weak to decode** is the one people forget. Below the level where the preamble decodes it's just energy, and energy raises the floor. Last week's overlap, seen from the other side.

The chip does notice, in its own way. Retries climb when frames get corrupted, and both platforms report non-Wi-Fi utilization because the radio can count the times it heard energy it couldn't make sense of. That's a symptom. The spectrum view is the cause.

## What the gear shows you

**Aruba Central.** The client page's Signal Quality is SNR in dB as the AP measured it, banded Poor at 0 to 20, Fair at 21 to 35 and Good above 35, with Retry Frames next to it. For the floor, the AP's RF tab has a Noise Floor graph beside Channel Utilization, and the Radios list has a Noise Floor (dBm) column. The AP's Spectrum tab goes further: Channel Utilization split into Available, Interference and Wi-Fi Utilization, and an Interfering Devices table with type, frequency, bandwidth, affected channels, signal strength and duty cycle. The catch is that the radio has to be in spectrum scan mode to feed it, and in that mode it serves no clients. The doc scopes it to Instant 8.5.0.1 and later; whether it works on an AOS 10 AP I haven't checked on a box yet, as of September 2026.

**Aruba CLI.** `show ap debug client-table` gives Last_ACK_SNR and Last_Rx_SNR per client, last packet only, same caveat as lesson 4. `show ap debug radio-stats` has a Current Noise Floor line, and the -80 dBm warning is on that doc page; it's on AOS 8 and on AOS 10 from 10.3.1.0. On AOS 8, `show ap arm rf-summary` lists every channel the radio scanned with a noise column, so you can see whether the floor is on your channel or everywhere. `show ap monitor ap-list` on AOS 10 and Instant gives curr-rssi and curr-snr for every AP the radio can hear, and on 10.8 in my lab there's a pathloss column the AP works out itself. For classification on AOS 8, `ap spectrum local-override` turns a radio into a spectrum monitor and `show ap spectrum device-summary` counts what it found per channel, with Microwave, Bluetooth, Video and Cordless Phone among the types.

**Mist.** Client Insights shows Current Values with RSSI and SNR side by side; the Client SNR chart over time, like lesson 4's PHY rate chart, needs Marvis for Wireless. Site > Radio Management has an AVG. NOISE tile, the average floor of every AP on the band, and its Radio Events include an Interference AP non wifi event that names microwave ovens, cordless phones, Bluetooth and wireless video cameras. The API is more direct than the screens. `GET /api/v1/sites/{site_id}/stats/clients` returns `rssi`, `snr`, `tx_retries` and `rx_retries` per client, and `GET /api/v1/sites/{site_id}/stats/devices` returns per radio, under `radio_stat.band_24` and `band_5`, a `noise_floor` in dBm and a `util_non_wifi` percentage the spec describes as frames with invalid PLCPs and glitches counted as noise. That's the chip admitting what it couldn't decode. There's also `POST /api/v1/sites/{site_id}/analyze_spectrum`, a capture streamed from an AP over a websocket with a per-channel `noise` and `non_wifi` share. I haven't run it and I don't see a screen for it in the 2026 docs.

**Ekahau Sidekick.** The real spectrum analyzer in the bag. Tri-band, 19 kHz resolution, up to 50 sweeps a second, amplitude range down to -92 dBm, so anything quieter than that it can't draw. It's the only thing in this lesson that shows you the shape of the interferer rather than a number derived from it.

## The lab

One AP, one laptop, a wired box for iperf3, a microwave oven, under an hour. A microwave is the one interferer everybody can produce on demand. It's legal, it's repeatable, and it lives in 2.4 GHz only, which makes the second half of the lab free.

1. Pin the AP to channel 6, 20 MHz, fixed power. Laptop 3 m away, line of sight. The oven in the same room, a few meters from both, a mug of water inside so you're not running it empty.
2. Baseline. Write down RSSI and SNR from Central's client page or Mist's Current Values, the radio's noise floor from the RF tab or `stats/devices`, and Retry Frames or `tx_retries`. `iperf3 -s` on the wired host, `iperf3 -c <host> -R -t 30` on the laptop. Write down the throughput.
3. Sidekick in spectrum view on 2.4 GHz for a minute. Note what's there before you add anything.
4. Oven on full for two minutes. Rerun iperf3 for 30 seconds while it runs. Watch the Sidekick during the burst.
5. Read everything again while it's running: RSSI, SNR, noise floor, retries. Cloud stats lag the radio by an averaging window, so give them a minute.
6. Oven off. Wait two minutes, read again.
7. Move the laptop and the AP to 5 GHz, any channel. Repeat steps 2, 4 and 5.

**What you should see.** This is what the physics expects; measured figures replace it once the run is done. RSSI holds within a dB or two of baseline the whole time, because the AP didn't change and the oven isn't a frame. The radio's noise floor climbs and SNR falls by the same amount, because it's a subtraction. Retries climb and throughput drops on every run with the oven on. On the Sidekick, a wide hill near the top of the 2.4 GHz band that flickers rather than sits, with a duty cycle well under 100 percent, because the magnetron pulses in time with the mains rather than running steady. On 5 GHz nothing moves, which is the point of step 7. If the floor on channel 6 barely moves, your oven leaks high and narrow: put the AP on channel 11, the non-overlapping channel nearest 2.45 GHz, and go again.

**What means it's broken.** RSSI dropping with the oven means the laptop moved or the AP changed power; check Central's Power Changes or Mist's Radio Events. SNR falling with no change in the reported floor means the two numbers came from different radios or different minutes; read both from the same radio and wait out the averaging window. A floor above -80 dBm before you switch anything on means the room already had a problem, and step 3 should have shown you what. And if the Sidekick shows the hill but the AP's floor barely moves, the AP is averaging a thing that pulses and the Sidekick is drawing its peaks. Neither is wrong. They measure different things, which is the whole lesson.

## Three questions

1. A client shows -62 dBm RSSI on a radio reporting a -78 dBm noise floor. What's the SNR, and roughly which rung does it land on?
2. The AP's noise floor reads -92 dBm on 80 MHz and you change the radio to 20 MHz. Where should the floor go, and why?
3. A user complains of slow Wi-Fi in the kitchen at lunchtime, 2.4 GHz only. Which two numbers on the client page do you look at first, and which tool tells you the cause?

Answers: 16 dB, MCS 4 on the site's floors, 16-QAM 3/4 and nowhere near the top of the table despite a strong-looking RSSI. About 6 dB lower, near -98, because two halvings of width take two lots of 3 dB off the thermal noise. SNR and Retry Frames, then the Sidekick; the client page shows you the symptom and the spectrum view shows you the oven.

## Next lesson

Joining a network. Probe, authentication, association, the 4-way handshake and EAP, captured on Mist and on Aruba, then the same join read back in ClearPass Access Tracker.
