---
title: What a Radio Actually Sends
slug: academy-01-what-a-radio-actually-sends
date: 2026-09-10
tags: Wireless, Academy, RF
hero: hero-academy-01.svg
academy: 1
summary: Frequency, wavelength, and the dBm math you can do in your head. Then a lab where you walk away from an AP and watch the number fall exactly the way the formula says it will.
origin: Wireless Academy, lesson 1. Fundamentals first, then a lab on real gear
---
This is the first lesson of the Wireless Academy, and it starts with the thing every wireless conversation eventually gets stuck on: the numbers. RSSI is -67 dBm. Is that good? The AP is at 20 dBm. Is that a lot? Somebody wants "more signal." How much more, and what does more even mean?

By the end of this one you'll be able to answer those without a calculator, and you'll have measured it yourself on an AP you own.

## What's actually leaving the antenna

A Wi-Fi radio sends an electromagnetic wave. Three things describe it. Frequency is how many times a second it oscillates, and it's what picks the band: 2.4 GHz, 5 GHz, 6 GHz. Wavelength is how long one cycle is in space, and it falls out of frequency directly: the speed of light divided by the frequency. At 2.4 GHz that's about 12.5 cm. At 5 GHz it's about 6 cm, and at 6 GHz about 5 cm.

That matters more than it sounds. A shorter wavelength interacts with objects differently. It gets through gaps more easily but loses more energy going through walls, and it doesn't bend around corners as well. Most of the "5 GHz doesn't reach as far as 2.4" gap is wavelength. The frequency term in free space loss alone costs about 6 dB going from 2.4 to 5 GHz. It isn't all of it, though. Regulatory caps differ by band, and so does whatever per-band power your APs are actually set to.

Amplitude is how strong the wave is, and that's the one we spend our lives measuring. The problem is the range. The AP transmits something like 100 milliwatts. The client, a few rooms away, receives something like a ten-billionth of that. Writing those two numbers next to each other in milliwatts is useless, so we don't.

## The number that matters: dBm

We use decibels relative to one milliwatt, dBm. The definition is 10 times the log of the power in milliwatts, and you don't need to remember that. You need to remember three anchors and two rules.

Anchors: 0 dBm is 1 mW. 20 dBm is 100 mW, roughly what an enterprise AP radio transmits. 30 dBm is 1 W. In the US that's the FCC ceiling at 2.4 GHz and in U-NII-3, while U-NII-2A and 2C cap you at 24 dBm, and 6 GHz indoor is 30 dBm EIRP rather than conducted. Treat 30 dBm as the outer wall, not a number you're entitled to.

Rule one: 3 dB doubles or halves the power. Rule two: 10 dB is ten times or a tenth. Everything else is those two combined. 23 dBm is 20 plus 3, so 200 mW. 13 dBm is 10 plus 3, so 20 mW. Going down, -70 dBm is seven tens below 1 mW, which is one ten-millionth of a milliwatt. That's a workable data signal, although most designs want -67 dBm or better once voice or density is involved, and it's why we don't write it in milliwatts.

When two dBm numbers are compared you get a plain dB difference. An AP at 20 dBm and a client hearing it at -67 dBm are 87 dB apart. That 87 dB is the total link loss, path loss plus whatever the two antennas gave back or took away, and it's the number a wireless design lives or dies on.

One rule for free space that you'll use constantly: every time you double the distance, you lose about 6 dB. Four times the distance is 12 dB. That's what the lab is about.

## What the gear shows you

Every platform reports received signal strength for a connected client, and they mostly agree on the unit even when they disagree on the name.

In Aruba Central, open the client from the Clients list and watch the labels. The client detail gives you Signal Quality as SNR in dB, Device Health as a percentage, and the actual dBm figure as RSSI in the connectivity detail. Three names, one power level. On the AP itself, `show ap debug client-table` lists every associated client, but its signal columns are `Last_ACK_SNR` and `Last_Rx_SNR`: SNR, dB above the noise floor, not dBm, and that's true on AOS 8, Instant and AOS 10 alike. On an AOS 8 controller the command also takes an `ap-name`. So don't be surprised when it's a small positive number, and if you want a dBm figure you're going back to Central for it. Same physics, different reference.

In Mist, open the client from the Clients list and follow its Client Insights link. The status block gives you RSSI and SNR as current values; the charts of both over time need the Marvis for Wireless subscription. The graphed form is the useful one, because a single reading lies and a trend doesn't.

On the Sidekick, Ekahau lists every AP it can hear with its signal strength (the Network Overview in the Analyzer app), which is the one measurement in this list that doesn't depend on your client's radio. The Sidekick has calibrated radios of its own, and that independence is the whole reason it exists.

## The lab

One AP, one client, a tape measure, and forty minutes. Outdoors or a large open room, because walls will make the numbers lie and that's next lesson's problem.

1. Note the AP's transmit power. Central shows it per radio; Mist shows it on the AP's radio settings. Fix it if it's on auto, so it doesn't change during the lab.
2. Stand 2 m from the AP with the client associated on 5 GHz. Wait a minute for the reading to settle, then record RSSI from the platform and from the Sidekick.
3. Move to 4 m. Record again. Then 8 m, then 16 m.
4. Put the four numbers in a row.

What you should see: each step drops by something close to 6 dB. Not exactly. Reflections, the client's antenna, and the fact that you're standing there will push it around by a couple of dB, and that's fine.

What means something's off: a drop of 15 dB on one step usually means you walked behind something, or the client roamed to another AP, which the platform will show you. A reading that doesn't change at all across two steps means the number you're reading is being averaged too slowly, or the client picked a different radio. Check the BSSID the client is on before you trust any step.

Then do it once on 2.4 GHz. The steps still drop about 6 dB each, and at the same transmit power they start from a higher number. Check the 2.4 GHz radio's power before you compare, because APs are routinely set lower on 2.4 to stop the cell swallowing the building, and that alone can erase the gap you're looking for. Match the power and the gap that's left is the wavelength difference from the top of this lesson, and now you've measured it.

## Three questions

Is 100 mW more or less than 23 dBm, and by how much? A client's signal went from -60 to -66 dBm; what happened to the received power? You've moved to four times your original distance from the AP; roughly how much signal did you give up?

Answers: less, by 3 dB. It dropped to a quarter. About 12 dB.

## Next week

Bands, channels and widths. Where 2.4, 5 and 6 GHz live, what the U-NII blocks are, and what you pay for a wider channel. The lab is the same AP with the width changed, and the client's rate table telling you what it cost.
