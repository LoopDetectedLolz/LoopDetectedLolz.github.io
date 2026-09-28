---
title: Your Wi-Fi Takes Turns, and the Slowest Talker Sets the Pace
slug: wifi-takes-turns
date: 2026-09-28
tags: Wireless, Airtime, WMM
hero: hero-wifi-takes-turns.svg
summary: Every time a Wi-Fi radio wants the air, it waits for quiet and counts down a random number, and every radio on the channel plays the same game. A laptop linked at 1201 Mb/s that sends one packet per turn moves 55 Mb/s, and one old laptop downloading beside it can take most of the air.
origin: Written as the companion to Academy lesson 5, because this is the part of Wi-Fi almost nobody gets taught
---
## Why I'm writing this

Not a lot of people get this side of wireless. We talk about signal, channels, rates and antennas. Almost nobody talks about the part where every radio on a channel has to wait its turn, and that's where most of your Wi-Fi performance goes.

Every slow Wi-Fi conversation ends up in the same place. The laptop says it's connected at 1201 Mbps. The speed test says a fraction of that. Somebody concludes the AP is bad, or the laptop is, and starts changing things. Usually neither is broken. They're taking turns.

## The game, in plain words

Picture a meeting room with one microphone and a strict set of rules.

Nobody talks until the room has been quiet for a moment. Then everybody who wants to talk picks a random number and counts down silently, one tick for every moment the room stays quiet. If somebody else starts talking, you stop counting and hold your place. Whoever reaches zero first gets the microphone. When they finish, the person they were talking to says "got it."

If you don't hear "got it," you don't know why. Maybe you and somebody else hit zero together and talked over each other. Maybe the frame just didn't make it. Nobody actually hears a collision. You just never get the answer, so you treat it like one: pick your next number from a range twice as big and play again.

That's the whole thing, and a radio plays it every time it wants the air, on every Wi-Fi network. The client plays it. The AP plays it. On 5 GHz the quiet moment is 43 microseconds for normal traffic, a tick is 9, the first number comes out of 0 to 15, and "got it" comes back 16 microseconds after the frame ends.

## Speed is how fast you talk once you have the microphone

Here's the part that surprises people. A turn has a cost that doesn't care how fast you talk: the quiet moment, plus the countdown, which averages 67.5 microseconds, plus the answer. A radio with a steady stream to send waits about 110 microseconds on average before each frame, even on an empty channel.

Take a laptop at 1201 Mbps and have it send one 1500-byte packet per turn. The packet's bits take 10 microseconds. The whole turn takes 218.5. That's 55 Mbps. Same laptop, same "1201" on the screen.

That's why radios bundle packets together. Put 64 in one frame and the turn gets about four times longer while carrying 64 times the data, and you're at 877 Mbps. Bundling only works when there's a pile of traffic going to one place, though, and a lot of real traffic isn't like that.

## The slow talker sets the pace

The game gives every radio the same shot at every turn. It doesn't care how long the winner holds the microphone.

So picture one old laptop that only speaks 802.11a/g, downloading beside yours. It can't bundle. In the model behind this site, your download alone on a quiet channel runs at about 720 Mbps. With the old laptop at 54 Mbps, right next to the AP, yours drops to about 480. Move the old one to the edge of the room, where it's down to 6 Mbps, and yours drops to about 210, while the old laptop holds about 60 percent of the air to get 3 Mbps out of it.

Those are modelled numbers, not a capture: 5 GHz, everybody hearing everybody, nothing failing except collisions. Real radios lose frames to more than collisions, so expect real numbers to come in lower.

The fix you've probably heard of is airtime fairness. It's a real feature on AOS 8 and Instant, but the release notes for both say it isn't supported on 802.11ax APs, and I couldn't find it in AOS 10 or in Mist. What's left is design, which is below.

## The meter lies

Your AP's channel utilization chart measures how often the air is busy. It doesn't measure whether anything useful happened. A collision is busy. A beacon is busy. A 6 Mbps frame is busy for a very long time.

Beacons are the tax nobody budgets for. Every SSID sends one about ten times a second from every AP at the lowest rate you allow. At 6 Mbps a 250-byte beacon costs about 0.4 percent of the channel per SSID per AP, and bigger beacons cost more. Eight SSIDs on six APs that share a channel is 18.6 percent at that size, gone before anybody connects. The printers post was the same story with multicast: 765 mDNS frames a second at 6 Mbps, about 40 percent of a channel.

Utilization tells you the room is loud. It doesn't tell you whether anybody's being understood.

## What good looks like

| Do this | Because |
|---|---|
| Run fewer SSIDs | Each one costs a beacon about ten times a second on every AP, at the lowest rate |
| Raise the minimum rate after a survey | Beacons and multicast get cheaper, and edge clients move to a closer AP or drop if there isn't one |
| Get legacy devices off your fast channel | They can't bundle, so every byte costs more air |
| Stop multicast chatter at the switch | It goes out at the basic rate with no retries and no bundling |
| Keep voice for voice | The voice queue draws from 0 to 3; crowd it and it collides |
| Map DSCP 46 to voice | By default AOS 10 and Mist put EF in the video queue |

## Bottom line

Wi-Fi is a room where everybody takes turns. The rate on the laptop is how fast it talks once it has the microphone, not how much it gets done. Anything that makes a turn longer, or adds turns nobody needed, comes out of everybody's share.

If you'd rather feel it than read it, [Academy lesson 5](academy-05-airtime-is-the-only-resource.html) has a game where you play the radio. You count your own number, you freeze when somebody else talks, and in level 3 you meet the scanner.
