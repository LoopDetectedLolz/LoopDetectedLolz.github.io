---
title: The Banner Is a Wi-Fi Link You Can Break
slug: how-the-banner-works
date: 2026-09-11
tags: Wireless, RF, Lab
hero: hero-banner-video.svg
summary: The animation at the top of this site sends a real frame from a packet capture, one symbol per particle, through a link budget you can drag walls into. Four minutes on what it is doing and why the Teams call breaks before the chat does.
origin: The front-page banner, built one question at a time
---
The simulator, which used to live at the top of the front page and now has its own tab, started as a decoration. It was supposed to show a spiral hitting a QAM target. Then I kept asking it questions, and every answer had to be true, and now it is a small Wi-Fi link that you can break in most of the ways a real one breaks. This is the walkthrough.

<video controls playsinline preload="metadata" poster="../media/banner-walkthrough.jpg" src="../media/banner-walkthrough.mp4"></video>

*Recorded 10 September 2026. A few things in it have been corrected since. The ACK takes 28 µs, not 44, so the clean exchange is 105 µs rather than the 121 on screen. The Teams call is now a call to a phone number carrying real G.711, and the page decrypts every packet that gets through. And 3, 5 and 7 streams now get the training fields they were missing.*

## What it is sending

Not a title, not lorem ipsum. Frame 1 of a packet capture: a 118-byte ping from a client, through its AP, to the gateway, every byte, least-significant bit first the way the PHY serialises it. Each particle is one symbol carrying six of those bits at 64-QAM, and the hex pane under the canvas is the receiver rebuilding the frame as they land. Hover a byte and it tells you which field it belongs to. Click a hit on either target and it tells you which symbol it was, which byte, and what the receiver decided.

The Traffic menu swaps the ping for two Teams flows, and each one is a capture you can download and open in Wireshark. The first is a Teams call to a phone number: five minutes of SRTP from the laptop straight to the session border controller that hands the call to the phone network. The second is a five-minute chat thread over TLS 1.2. Both look like noise on the wire, which is the point. The demo keys ship with the captures, and the panel above the hex pane uses them on every frame that gets through: it checks the authentication tag, decrypts, and shows you what came out. The voice is a synthetic tone, not a recording of anybody, but it's real G.711, so the waveform you see is decoded from the bytes that just landed.

## Why the scatter is not decoration

Where a symbol lands comes from a link budget. 20 dBm into a Yagi, path loss with an indoor exponent, walls you drag along the beam at typical survey losses, and a noise floor that rises with channel width. The SNR that falls out sets the Gaussian every symbol lands with. Push the distance out or add concrete and rate adaptation walks down the MCS ladder on its own, because the frames start failing their CRC, not because I told it to.

Multipath is one reflection off the wall. At a shallow bounce like this one the echo comes back phase-flipped, it arrives late, and since each particle is one subcarrier, some subcarriers add and some cancel. That is the strip that shows gain against frequency. Streams add antennas at both ends, and the second stream only separates when the channel has rank 2, which the reflector provides and line of sight between co-polarised antennas does not. Ask me how I know that eight streams on a bare bench looks like a disaster.

## The part that lands with people

Turn on Interference and hold the cursor in the beam with the voice flow running. Frames fail, retries stack, and a frame that dies after seven attempts is a 20 ms hole in the audio. Packet loss climbs, the MOS score falls. Switch to chat and do the same thing. Nothing is lost. TCP retransmits, and the message shows up at least 200 ms late, longer if it has to go again.

Choppy call, slow chat, same interference. If you have ever had to explain why the phones complain before the laptops do, that is the whole explanation, and now there is a picture for it.

## What is modelled and what is not

The explainer behind the banner text lists the places it's a model rather than a measurement. The big ones: the antenna patterns are typical shapes, not somebody's datasheet. The wall losses and minimum-SNR figures are typical values. The stream penalty is a rule, not a matrix solve. Every frame goes out as plain best-effort data, with none of the WMM voice priority a properly marked call would get. And there's no forward error correction, so near the edge it fails far more frames than a real link at the same SNR, which would have corrected most of those symbol errors. The Wi-Fi link itself is left open so the headers stay readable. The bit order and the CRC are the real thing, the preamble and the gaps between frames follow the standard, and the encryption is real SRTP and real TLS 1.2, keyed the way the RFCs say.

[Open the simulator](../simulator.html). Time slider on the left. Start at symbols, drag to real time to see the channel as a strip, drag the other way to see the carrier and then the photons. Fullscreen if you are on a phone.
