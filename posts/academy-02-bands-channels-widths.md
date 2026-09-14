---
title: Bands, Channels and Widths
slug: academy-02-bands-channels-widths
date: 2026-09-14
tags: Wireless, Academy, RF
hero: hero-academy-02.svg
academy: 2
interactive: fitband
summary: A band is a stretch of spectrum, a channel is a slice of it, and width is how big a slice you take. Every doubling of width doubles the rate, halves how many cells you can have, and costs 3 dB. There is a game in here to prove the middle one.
origin: Wireless Academy, lesson 2. The trade nobody feels until they run out of channels
---
Last week was one radio and one number. This week is the room that radio has to live in, and the first real trade in wireless design.

Three words, in plain language. A **band** is a stretch of spectrum a regulator has set aside. A **channel** is a slice of that band your radio actually sits on. **Width** is how big a slice you took. That is the whole vocabulary, and the entire lesson is what happens when you take a bigger slice.

## What you actually have

In the US there are three bands worth your time, and they are wildly different sizes.

**2.4 GHz** gives you eleven channels, and only three of them fit side by side without overlapping: 1, 6 and 11. The rest overlap their neighbours, which is why channel 3 is not a clever compromise, it is two problems at once. Everything else lives here too, so the band is loud before you arrive.

**5 GHz** is the working band, and it comes in four blocks you should know by name. U-NII-1 is channels 36 to 48. U-NII-2A is 52 to 64. U-NII-2C is 100 to 144, the big one. U-NII-3 is 149 to 165. Twenty five channels of 20 MHz, which sounds like plenty until you start widening them.

The catch is DFS. Everything from 52 to 144 is shared with radar, mostly weather and military, and the rules are not negotiable: your AP has to listen before it transmits there, and if it hears a radar pattern it must leave that channel and stay off it for thirty minutes. That is real capacity, and you should use it, but it is borrowed rather than owned.

**6 GHz** is the new room, and it is enormous: 5.925 to 7.125 GHz, fifty nine 20 MHz channels, and no DFS anywhere in it. Seven of those channels are 160 MHz wide, which is six more than 5 GHz can offer. Outdoors at standard power you need AFC to tell you what you may use, and only Wi-Fi 6E and Wi-Fi 7 clients can see any of it at all.

## The number that matters

Doubling the width doubles the number of subcarriers, so it roughly doubles the data rate. Nobody argues with that half. Here is the other half.

**Doubling the width raises the noise floor by 3 dB.** A wider channel is a bigger bucket, and it collects proportionally more noise. Your radio needs 3 dB more signal to hold the same modulation, so the cell gets smaller. Go from 20 to 80 MHz, four times the width, and you have given away 6 dB of link budget. That is the same 6 dB that costs you half your distance, from lesson one.

And the part people feel last: **every doubling of width halves how many non-overlapping channels you have.** In 5 GHz that takes twenty five channels down to six at 80 MHz, and down to two at 160 MHz, both of which are DFS. A design is not a single cell, it is cells next to each other, and cells next to each other need different channels.

So the trade is not "wider is faster." The trade is wider is faster per cell, smaller per cell, and fewer cells. In a warehouse with four APs, fine. In a lecture hall with thirty, it is a way to build one slow network out of a lot of expensive hardware.

## Play it, it is faster than reading it

Drop the access points onto legal channels. The rules are the real ones: 40 MHz has to sit on a proper pair, 160 has to sit on a proper eight, DFS is shaded, and anything that overlaps another AP turns orange. Level two is the lesson.

## What the gear shows you

Width is a radio setting, not an SSID setting, and that trips people up on both platforms.

In **Aruba Central** with AOS 10, channel width lives in the RF configuration that applies to the AP group, alongside the channel list and transmit power, not anywhere in the WLAN wizard. Set it there and it applies to every AP the group holds. To see what an AP actually ended up on, rather than what you asked for, `show ap bss-table` on the AP gives you the BSSID, the channel and the width in use, and the channel column is where you find out that your 80 MHz plan quietly became 40 because a neighbour was already sitting there.

In **Mist**, width is in the RF template at org level, with a per AP override if you need one, and the client insights view will show you the negotiated PHY rate that resulted. The template is the right place to make the decision once.

On the **Sidekick**, the channel view shows you the width as occupied spectrum rather than as a setting, which is the only view that tells you what your neighbours chose.

## The lab

One AP, one client, about forty minutes.

1. Put the AP on a 20 MHz channel in U-NII-1, somewhere clear, and connect one client a couple of metres away.
2. Note three things: the client's PHY rate, its RSSI, and the AP's airtime utilisation.
3. Run a file transfer big enough to last a minute and record the throughput.
4. Change the radio to 40 MHz, let the client reconnect, and repeat every measurement.
5. Do it again at 80 MHz.
6. Now walk to the edge of coverage, where RSSI is around -70 dBm, and repeat at 20 and at 80.

**What you should see.** Close in, the PHY rate roughly doubles with each doubling of width and throughput follows it up, though not by the full factor, because overhead does not shrink. At the edge, the picture inverts: the 80 MHz link holds a lower modulation than the 20 MHz link did, or drops entirely, because you spent 6 dB on width that you did not have to spend.

**What means it is broken.** If the PHY rate does not move at all when you change width, the client never reconnected, or it is a 20 MHz only device, and plenty of scanners and handhelds are. If throughput goes up but airtime goes up faster, you are watching retries, not capacity.

## Three questions

1. Your site has fourteen APs in one open floor and the customer wants 80 MHz everywhere in 5 GHz. How many non-overlapping channels do you have without DFS, and what is the actual reuse distance you are asking for?
2. An AP on channel 100 stops serving clients for half an hour and then comes back on its own. What happened, and which band would have avoided it?
3. Two APs are on 40 MHz channels that share one 20 MHz half. Is that better or worse than putting them both on the same 40 MHz channel, and why?

## Next week

Lesson 3 is the link budget: EIRP, antenna gain, receive sensitivity and free space path loss, and predicting the RSSI at 10 m before you go and measure it.
