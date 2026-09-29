---
title: Interference From Yourself
slug: academy-06-interference-from-yourself
date: 2026-09-25
tags: Wireless, Academy, RF
hero: hero-academy-06.svg
academy: 6
summary: A reader with twelve APs on one big floor asked whether adding APs makes the edge worse, and whether anything self-tunes. The answer is that AP count was never the variable. Channel width is, and the automation only moves the two knobs you let it.
origin: Wireless Academy, lesson 6. Fundamentals first, then a lab on real gear
---
Last week was airtime, the one thing a channel has and everything on it shares. This week the thing sharing it is your own AP across the hall.

A reader asked under lesson 2, on LinkedIn. He has twelve APs on one very large single floor. Does the cell edge get worse as he keeps adding APs? And is there a system that self-tests and adjusts, or is it trial and error? Two good questions, and the answer to the first one depends on a number he didn't give me. It isn't twelve.

## The count isn't the variable

Adding an AP puts a radio closer to somebody. Closer means a stronger signal, a higher MCS row, a better edge. What makes the edge worse is a thirteenth AP on the same channel as one you already had, and whether that happens is decided by width, not by count.

Here's the US 5 GHz inventory at 20 MHz. U-NII-1: 36, 40, 44, 48. U-NII-2A: 52, 56, 60, 64, DFS required. U-NII-2C: 100 through 144 in steps of four, twelve channels, DFS required. U-NII-3: 149, 153, 157, 161, 165. That's 25, and 16 of them need DFS. The FCC opened the bottom of U-NII-4 above 165 for indoor use in 2020, but almost nothing you'll deploy has radios or clients for it, so I count to 165 and stop.

Bond them to 40 MHz and you get twelve pairs (165 has no partner). Bond to 80 MHz and you get six: 36 to 48, 52 to 64, 100 to 112, 116 to 128, 132 to 144, 149 to 161.

Now put his floor on it. Twelve APs at 20 MHz: every AP gets its own channel, thirteen are spare, and a thirteenth AP still gets a clean one. At 40 MHz: twelve channels, twelve APs, the floor is exactly full. At 80 MHz: six channels, twelve APs, every channel already used twice, and on an open floor with no walls those pairs hear each other. He didn't add interference by adding APs. He added it the day somebody set the width to 80.

That's the line I want you to keep. Giving it 80 MHz everywhere returns the best possible version of a bad design.

## What actually degrades

Two APs on one channel don't corrupt each other, mostly. They wait for each other. Before a radio transmits it runs clear channel assessment, and the standard sets two thresholds on a 20 MHz channel: a decodable 802.11 preamble at -82 dBm or better means busy, and energy it can't decode at -62 dBm or better means busy. An AP across the hall at -70 dBm on your channel is well inside the first rule, so your AP defers, and so do its clients, and so do his. Nobody's frame gets damaged. Everybody's frame gets delayed. An Airheads blogger has called this co-channel contention rather than interference for a decade, and he's right, but the label stuck.

So the thing that degrades is airtime, and only airtime. The client's RSSI reads what it read before. Same SNR, same MCS row, half the throughput. If you're staring at a signal number to find the problem, you're on the wrong page. Computers are very patient about waiting their turn.

Adjacent channels are the other case and they behave the opposite way. A transmitter isn't a brick wall in frequency. The 80 MHz spectral mask is flat to 39 MHz off centre, down 20 dB at 41 MHz, down 28 dB at 80 and down 40 dB at 120. That skirt lands in the next block. It isn't a preamble, so nothing defers to it. It's energy you can't decode, which is noise. It raises the floor, eats SNR and pushes the far clients down a row. Same channel costs you time; next-door channel costs you signal. Lesson 7 opens on that floor.

One thing about the word "adjacent" at 80 MHz. Channels 36, 40, 44 and 48 are the same 80 MHz block with a different primary. Two APs on primaries 36 and 44 are co-channel, full stop. The adjacent channel to that block is 52 to 64, and nothing else is.

## The number that matters

```
reuse = channels available at that width / APs on the floor

20 MHz:  25 / 12 = 2.1   every AP alone, thirteen channels spare
40 MHz:  12 / 12 = 1.0   every AP alone, nothing spare
80 MHz:   6 / 12 = 0.5   every channel carries two APs

airtime per AP when N APs share a channel = about 1/N of the channel

two APs on one 80 MHz channel, client at MCS 9, two streams:
960.8 Mb/s PHY x 1/2 = 480 Mb/s ceiling, before last week's overhead
```

Reuse under one means somebody shares. A shared 80 MHz channel, at the model's numbers, is worth about what a 40 MHz channel to itself is worth (458.8 Mb/s at the same row), minus the cost of two APs bumping into each other. You paid for the width and got 40 MHz with extra steps.

## What the automation does

Yes, there's a system on both platforms, and it isn't trial and error. It's an optimiser. It moves two knobs, channel and transmit power, inside a box you drew. It doesn't move antenna gain or walls, and it doesn't move the width unless you let it. The engineer's job is the box: allowed channel list, width, minimum power, maximum power. Give it 80 MHz on a twelve-AP floor and it picks the least-bad six-colour map it can, every night, forever.

**Aruba AOS 10 and Central: AirMatch.** APs send RF statistics to Central on a 24-hour cycle. Central splits the network into partitions, solves for channel, bandwidth and EIRP per radio, and pushes the plan at the hour you chose. In Central it's under Devices > Access Points > Config: the Activate Optimization toggle, the Automatically deploy optimization at drop-down, and Wireless Coverage Tuning, Conservative, Balanced or Aggressive per radio. The Central doc doesn't state a default hour; my tenant came up with 05:00 and Balanced, which matches the AOS 8 `airmatch profile`, where `deploy-hour` defaults to 5 and `quality-threshold` to 8 percent, so a plan has to be 8 percent better before it gets pushed. Your box lives in the Radios tab under RF Coverage: Allowed Channels, Minimum and Maximum bandwidth, and Allowed Transmit Power with a min and a max. Out of the box on 10.8 the 5 GHz bandwidth box is 20 to 80 MHz, so AirMatch will move width between those on its own and never picks 160 unless you raise the maximum. Between runs AirMatch still reacts locally to radar, noise and channel quality. The receipts are Channel Changes and Power Changes on the AP Radios tab, and `show ap arm history` on the AP.

**AOS 8 controllers and Instant: ARM.** Older and different in kind. ARM works from what the individual AP hears, so each AP compensates on its own. Reactive, per AP, no site-wide plan. Instant does the sums in the virtual controller, but still per IAP from that IAP's own scans. The readout is `show ap arm rf-summary ap-name <name>` on AOS 8, and plain `show ap arm rf-summary` on the AOS 10 AP from 10.3.1.0. Read retry, noise, util(Qual) and intf_idx, the AP's own co-channel and adjacent-channel score.

**Mist: RRM.** The box is an RF Template under Organization > Wireless > RF Templates: Channels per band, Channel Width, and Power, which is per transmit chain, the lesson 3 catch. The design guide says min power equal to the design's power and max 3 to 6 dB above it. The site-wide pass runs nightly at around 3 a.m. local and the doc says plainly the time isn't configurable. Radar and interference get handled locally, straight away. Site > Radio Management shows the Distribution block (radios per channel) and the Radio Events block, where every change carries a reason: Scheduled site RRM, Triggered site RRM, Interference AP co-channel, Radar detected. Optimize now on that page fires a Triggered site RRM by hand.

## The lab

Two APs, two laptops, one wired box running `iperf3 -s`. Under an hour. Two clients because AP B has to be busy, not just present. A beaconing AP costs almost nothing; a transmitting one costs the whole channel.

1. Pin both APs. Same 80 MHz channel, primary 36, fixed power, same power. Note Central's Channel Changes and Power Changes, or Mist's Radio Events, so you can prove nothing moved.
2. Sidekick spectrum view on the 36 to 48 block for a minute with both APs idle. Write down the floor. That's your baseline for step 6.
3. Laptop 1 on AP A, 3 m away. `iperf3 -c <host> -R -t 30`. Write down throughput, rate and retries. Central: Tx|Rx Rate and Retry Frames on the client page. AOS: `show ap debug client-table`, Tx_Rate and Tx_Retries. Mist: Current Values on Client Insights, or `tx_retries` from `GET /api/v1/sites/{site_id}/stats/clients`.
4. Read the channel too. AOS 8: `show ap debug radio-stats ap-name <name> radio 0`, the Channel busy 64s line. AOS 10 on the AP: `show ap debug radio-stats 0`. Central: Access Point > Overview > RF, the Channel Utilization chart, split into Transmitting, Receiving and Non-Wifi Interference. Mist: the Channels charts on AP Insights, or `radio_stat` from `GET /api/v1/sites/{site_id}/stats/devices`, which splits `util_tx`, `util_rx_in_bss` and `util_rx_other_bss`. That last field is this lesson in one number.
5. Laptop 2 on AP B, 3 m from it, `iperf3 -c <host> -R -t 30`, and rerun laptop 1 at the same time. Write everything down again.
6. Move AP B to primary 100. Rerun both. Then move AP B to primary 52, the block next door, rerun both with the Sidekick on the 36 to 48 block, and check the Noise Floor chart on AP A's RF page or `noise_floor` in Mist's `radio_stat`.

**What you should see.** Step 5 is the lesson: laptop 1's throughput drops to roughly half of step 3 while its RSSI, SNR and rate don't move. Channel busy on AP A goes high and only part of it is AP A transmitting. On Mist `util_rx_other_bss` carries the rest; on Central it shows as Receiving. Retries rise a little, not a lot, because the APs are deferring, not colliding. Step 6 on channel 100 puts laptop 1 back at step 3. Step 6 on 52 should leave throughput near baseline at 3 m and put a shoulder of energy on the Sidekick above 5250 MHz leaking into your block. Whether the AP's own noise floor number moves at that spacing I haven't checked on a box yet; that was true when this went up in September 2026. The spectrum view is the readout; the chart is a bonus.

**What means it's broken.** No drop in step 5 means they aren't sharing: one AP fell back to 40 MHz, or a primary isn't where you think. Check the radio, not the client. Retries that jump by a multiple instead of a little mean a hidden node: the APs can't hear each other but laptop 1 hears both, so they collide instead of deferring. Move the APs closer, which is the opposite of what instinct says. A drop that persists on channel 100 means the shared thing isn't the channel; it's the wired host or the uplink. It's always a laptop, except when it's the switch.

## Three questions

1. Twelve APs on one floor at 40 MHz, DFS allowed. You add a thirteenth. What's the reuse factor before and after, and what's the cheapest fix?
2. A client sits at -55 dBm on AP A. AP B, same channel, is heard at AP A at -70 dBm and starts a big download. What happens to the client's RSSI, and what happens to its throughput?
3. Two 80 MHz APs, one on primary 36, one on primary 44. Co-channel or adjacent? And if the second moves to 52?

Answers: 12/12 = 1.0 before, 12/13 = 0.92 after, and the cheapest fix is to drop the width to 20 MHz on that floor, which makes it 25/13 and buys twelve spare channels for nothing. The RSSI doesn't move at all; the throughput roughly halves, because -70 is well above the -82 dBm preamble threshold so AP A and everything on it defers to AP B. Co-channel, since 36 and 44 are the same 80 MHz block; on 52 it becomes the adjacent block, nothing defers, and the cost shows up in the noise floor instead of in the airtime.

## Next lesson

Noise, SNR, and why RSSI lies. Step 6 raised the floor without touching the signal, and that's the whole lesson.
