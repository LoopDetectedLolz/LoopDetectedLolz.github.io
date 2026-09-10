---
title: The Banner Is a Wi-Fi Link You Can Break
slug: how-the-banner-works
date: 2026-09-11
tags: Wireless, RF, Lab
hero: hero-banner-video.svg
summary: The animation at the top of this site sends a real frame from a packet capture, one symbol per particle, through a link budget you can drag walls into. Four minutes on what it is doing and why the Teams call breaks before the chat does.
origin: The front-page banner, built one question at a time
---
The thing at the top of the front page started as a decoration. It was supposed to show a spiral hitting a QAM target. Then I kept asking it questions, and every answer had to be true, and now it is a small Wi-Fi link that you can break in most of the ways a real one breaks. This is the walkthrough.

<video controls playsinline preload="metadata" poster="../media/banner-walkthrough.jpg" src="../media/banner-walkthrough.mp4"></video>

## What it is sending

Not a title, not lorem ipsum. Frame 1 of a packet capture: a 118-byte ping from a client to its AP, every byte, least-significant bit first the way the PHY serialises it. Each particle is one symbol carrying six of those bits at 64-QAM, and the hex pane under the canvas is the receiver rebuilding the frame as they land. Hover a byte and it tells you which field it belongs to. Click a hit on either target and it tells you which symbol it was, which byte, and what the receiver decided.

The Traffic menu swaps the ping for two Teams flows, each a real capture you can download and open in Wireshark: five minutes of SRTP voice packets and a five-minute chat thread over TLS. Both look like noise on the wire, which is the point. The panel above the hex pane is what the app sees after it decrypts them, and the demo keys ship with the captures so that view is decrypted for real.

## Why the scatter is not decoration

Where a symbol lands comes from a link budget. 20 dBm into a Yagi, path loss with an indoor exponent, walls you drag along the beam at typical survey losses, and a noise floor that rises with channel width. The SNR that falls out sets the Gaussian every symbol lands with. Push the distance out or add concrete and rate adaptation walks down the MCS ladder on its own, because the frames start failing their CRC, not because I told it to.

Multipath is one reflection off the wall. The echo flips phase at the bounce, arrives late, and since each particle is one subcarrier, some subcarriers add and some cancel. That is the strip that shows gain against frequency. Streams add antennas at both ends, and the second stream only separates when the channel has rank 2, which the reflector provides and line of sight does not. Ask me how I know that eight streams on a bare bench looks like a disaster.

## The part that lands with people

Turn on Interference and hold the cursor in the beam with the voice flow running. Frames fail, retries stack, and a frame that dies after seven attempts is a 20 ms hole in the audio. Packet loss climbs, the MOS score falls. Switch to chat and do the same thing. Nothing is lost. TCP retransmits, and the message shows up 200 ms late.

Choppy call, slow chat, same interference. If you have ever had to explain why the phones complain before the laptops do, that is the whole explanation, and now there is a picture for it.

## What is modelled and what is not

The explainer behind the banner text lists every place it is a model rather than a measurement: the Yagi pattern is a textbook shape, the wall losses and minimum-SNR figures are typical values, the stream penalty is a rule rather than a matrix solve, and there is no forward error correction, so a real link at the same SNR recovers a few percent of symbol errors that fail the CRC here. The Wi-Fi link itself is left open so the headers stay readable. Everything else, the timings, the bit order, the CRC, the encryption, is the real thing.

Time slider on the left. Start at symbols, drag to real time to see the channel as a strip, drag the other way to see the carrier and then the photons. Fullscreen if you are on a phone.
