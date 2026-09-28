---
title: Surveys and What a Heatmap Can't See
slug: academy-11-surveys-and-what-a-heatmap-cant-see
date: 2026-09-27
tags: Wireless, Academy, Survey
hero: hero-academy-11.svg
academy: 11
summary: A heatmap is a record of what one instrument heard, on the channels it was told to listen to, on the day. What each kind of survey proves, what the picture leaves out, and the habit of reading the AP's real channel from the controller before you believe the map.
origin: Wireless Academy, lesson 11. Fundamentals first, then a lab on real gear
---
Last week was how much a cell can carry. This week is the map everybody points at when they argue about it.

Somebody hands you a heatmap. Green everywhere. The users say the Wi-Fi is bad. Both are telling the truth. A survey is a record of what one instrument heard, on the channels it was told to listen to, at the speed you walked, on that day. Every clause in that sentence is a place the map can be right and the building can still be wrong.

## Three surveys, three proofs

**Predictive.** A floor plan, wall types with attenuation values, a model AP dragged onto the drawing, and the software works out where the signal should go. Ekahau AI Pro does this well. It proves nothing on its own. It's a plan. The model only knows the walls you drew and the losses you gave them, and lesson 3 was an hour of me finding that a glass door I'd have put down at a few dB measured nothing.

**AP-on-a-stick.** One real AP on a pole at a spot the plan picked, and you walk it. Ekahau's docs call it the checkpoint between the plan and the finished build: survey, freeze the AP in the project, move it to the next candidate spot, repeat. It proves one location at a time with real walls and a real radio. It can't prove the neighbour APs won't fight it, because they aren't there yet.

**Validation.** The network is built and you walk all of it. Ekahau calls it a post-deployment survey and says there's nothing special to do, just survey. It's the only one that measures what the network actually radiates, and it's where the heatmap in the argument usually came from.

Two ways to walk any of them. A **passive** survey listens: the Sidekick hops through its channel list and records every beacon it hears, from every AP, yours and the neighbours', without joining anything. That's where signal strength maps come from. An **active** survey associates: your laptop joins the SSID and the software pings a host or runs throughput against an iperf server as you walk. Ekahau's table of which visualisation needs which survey is blunt: ping round trip, packet loss and associated AP only come from active, signal and SNR from passive. Most walks run both at once.

## The number that matters

Two, because a survey has two knobs nobody thinks about: how long you stood still and how fast you walked.

Lesson 3 had you take twenty samples at a taped spot and compute the standard deviation. Mine was 2 dB. The uncertainty of the mean of n samples is that spread over the square root of n:

```
uncertainty of the mean = sigma / sqrt(n)

sigma 2 dB, 1 sample:    2 / sqrt(1)  = 2.0 dB
sigma 2 dB, 4 samples:   2 / sqrt(4)  = 1.0 dB
sigma 2 dB, 16 samples:  2 / sqrt(16) = 0.5 dB
```

One sample is a 2 dB guess. A doorway that shows -67 on one sample could be -65 or -69, and that's two MCS rungs.

The second is how far you move between samples of the same channel. A scanning radio dwells D milliseconds on each of C channels, split across R radios, so one full sweep takes D x C / R, and at walking speed you cover that much floor before the same channel gets heard again:

```
sweep time = D x C / R

D = 105 ms  (Ekahau's documented default channel scan time; check your tool)
C = 95      (US: 11 at 2.4 GHz, 25 at 5 GHz without U-NII-4, 59 at 6 GHz)
R = 4       (Sidekick 2 radios)

sweep = 105 x 95 / 4 = 2494 ms, about 2.5 s
at 1 m/s:    2.5 m between samples of one channel
at 0.5 m/s:  1.25 m
```

The 105 isn't arbitrary. The default beacon interval is 100 time units, 102.4 ms, so a dwell just over that catches one beacon from every AP on the channel, most of the time. Ekahau's guidance is a slow, steady walk, and now you know why. At a normal pace every AP on the map is sampled about every 2.5 m, once, and interpolated in between. The smooth gradient is the software being polite.

## What a heatmap can't see

The signal map is beacon RSSI measured by the survey tool's own radios. The Sidekick 2 has nine antennas Ekahau says are lab calibrated for omnidirectional consistency, which is the point: it's a repeatable instrument. It is not your client. The badge reader with one antenna behind a metal bracket hears a different number, and lesson 3 found 15 dB between the model and a laptop on a shelf. The map is what a very good radio heard. Nobody on the floor is carrying one.

Then the things a beacon can't say.

**Airtime and retries.** A beacon says the AP exists and how loud it is, not how busy the channel was between beacons or who was on it. Ekahau's airtime utilisation map is a capacity simulation from the client devices you assigned to areas in the project, not a measurement, and the doc says so. A green heatmap of a network that has run out of airtime is still green. Lesson 5 was the whole reason that matters.

**Noise and non-Wi-Fi interference.** Ekahau's spectrum utilisation and channel power maps come from the spectrum analyser, which only contributes if it was running during the walk. Wi-Fi radios don't see the microwave. That was lesson 7.

**Channels it wasn't listening to.** This is the one that got me. A passive survey only hears the channels in its scan list. An AP on a channel the tool skipped isn't weak on the map, it's absent, and the map fills the space with whatever it did hear, so the hole looks like a hole in the building. I wrote up a floor with two radios on channel 173 that two survey files had never scanned, in [Your Survey Tool Can't See Channel 173](channel-173-survey-blind-spot.html). Both surveys were clean. Both were missing two radios. Nothing in the output said so.

## What the gear shows you

Ekahau's names as of September 2026, since they've moved. The design tool is Ekahau AI Pro, with a web version called Ekahau AI Pro Online. The app that does the walk with the Sidekick 2 on iOS or Android is Ekahau Survey, with Auto-Pilot, Continuous, Stop-and-Go, Just Go and GPS modes. Ekahau Analyzer is the troubleshooting app with the spectrum view. The Sidekick 2 has four tri-band radios and a spectrum analyser from 2.4 to 7.125 GHz.

The channel list is editable on both ends. In AI Pro the Devices dialog has a Scan default channels toggle; off, a cog beside each band lets you pick channels, and the doc says the default covers all channels on all frequencies, split across the Sidekick's radios. In the Survey app, tapping the Sidekick status icon shows serial, battery, firmware and storage, and the doc says you configure scan channels there too. The dwell time is no longer adjustable in the UI; Ekahau's doc says the 105 ms default is fixed so people don't distort their own results, which is a fair opinion of us. Stop-and-Go samples for five seconds by default, under File > Preferences.

Now the network's own truth, which is the habit. Before you trust the survey's picture of an AP, read what channel and power the AP says it's on.

**Aruba Central.** Open the AP. The Summary tab's Radios section lists each radio's Mode, Status, Channel and Power. The RF tab is the part the heatmap can't see: Channel Utilization split into Transmitting, Receiving and Non-Wifi Interference, a Noise Floor graph, and Frames with Drops, Errors and Retries.

**AOS CLI.** `show ap bss-table` has a column headed ch/EIRP/max-EIRP: channel, current EIRP and maximum EIRP per BSS. `show ap active` gives it per AP with a width suffix on the channel: a plus or minus sign for 40 MHz, E for 80, S for 160. Lesson 3 settled that the Aruba figure is EIRP, so it's the number the survey should read minus path loss.

**Mist.** Site > Radio Management, Current Radio Values, lists each AP's radio settings for the band you pick; Radio Events shows channel, bandwidth and power changes and what triggered them. The AP's Insights page has a Channels section with utilisation per band. From the API, `GET /api/v1/sites/{site_id}/stats/devices` returns `radio_stat` with `band_24`, `band_5` and `band_6`, each carrying `channel`, `bandwidth`, `power`, `noise_floor` and `util_all`. `power` is per chain on Mist. One request prints the real channel next to the survey's:

```python
url = f"https://{HOST}/api/v1/sites/{SITE}/stats/devices"
r = requests.get(url, headers={"Authorization": f"Token {TOKEN}"}, timeout=30)
for ap in r.json():
    b5 = (ap.get("radio_stat") or {}).get("band_5") or {}
    print(ap.get("name"), b5.get("channel"), b5.get("bandwidth"),
          b5.get("power"), b5.get("noise_floor"), b5.get("util_all"))
```

Placeholder host, token and site id; use your region's API host.

## The lab

One room, one AP of yours, whatever neighbours you can hear, the Sidekick 2 and the Survey app. Under an hour.

1. Pin the AP: fixed channel, width and power. Write down the channel and power from Central or Mist and from the CLI. That's your truth.
2. New project in Ekahau Survey. Photograph or sketch the room and set the scale from a wall you've measured. Get the scale wrong and every distance is off by the same factor and nothing will tell you.
3. Check the scan list on the Sidekick icon, defaults on. Note which channels it offers. If your AP's channel isn't there, you've already found the lesson.
4. Stop-and-Go on lesson 1's four tape marks: tap, wait for the sampling to finish, move. Then one Continuous pass round the room at a slow walk, tapping at every turn.
5. Read it back. View tab, the RSSI heatmap, then tap your AP for its details, channel included. Inspect tab, tap a route point and read what the Sidekick heard there.
6. Cross-check the survey's channel against `show ap bss-table` or `radio_stat.band_5.channel`, and its signal at the nearest tape mark against EIRP minus the FSPL from lesson 3.
7. Break the map. Turn Scan default channels off and remove your AP's channel. If your build won't let you, move the AP to 173 and leave the list alone, which is the version I did by accident. Re-walk the same four spots and the loop.

**What you should see.** The survey's channel matches the controller's, and at the tape marks the signal sits within a few dB of the lesson 3 prediction with a spread around 2 dB. The Continuous pass has fewer samples at any one spot than five seconds of Stop-and-Go did. After step 7 your AP is gone. Not weaker. Gone, and the room fills with the neighbours' colour or grey, while the controller still shows it up, on its channel, at its power, with clients.

**What means it's broken.** A survey channel that doesn't match the controller's means the AP moved mid walk; check Channel Changes on Central or Radio Events on Mist and pin it harder. A signal 10 dB or more off the prediction with a small spread is lesson 3 again, the antenna pattern or the path, not the survey. A spread over 3 dB standing still is something moving. And an AP that never appears in step 5 with the default list is the real finding: compare the channel it's on with the channels the list offers, and if it's above 165 or in a DFS block the list skipped, the hole is in the scan list, not the building.

## Three questions

1. A validation survey shows -70 dBm in a corridor from one sample and the requirement is -67. Pass or fail, and what do you do first?
2. The heatmap is green across a floor where users say the Wi-Fi is slow at 10 am. Name two things the passive survey didn't measure, and the screen that shows each.
3. Your Sidekick's channel list stops at 165 and the controller shows a radio on 177. What does the heatmap show at that AP, and what do you change first?

Answers: neither yet; one sample with a 2 dB spread is -70 plus or minus 2, so stand there and take enough that the mean's uncertainty is under a dB. Airtime and retries: Central's RF tab Channel Utilization and Frames, or Mist's Channels on the AP Insights page and `util_all` from the API; the survey heard beacons, not the traffic between them. Nothing, not a weak nothing but a gap filled by the neighbours; add the channel to the scan list if your tool offers it, otherwise take it out of the AP's auto-channel pool until it does, and redo the walk either way.

## Next lesson

Lesson 12 is the method: client, RF, infrastructure, upstream, and which tool shows which layer. Break it three ways, find each one with the right tool.
