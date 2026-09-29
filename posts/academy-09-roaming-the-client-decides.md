---
title: Roaming: the Client Decides
slug: academy-09-roaming-the-client-decides
date: 2026-09-26
tags: Wireless, Academy, Roaming
hero: hero-academy-09.svg
academy: 9
summary: The AP never moves a client. It can tell the client who its neighbours are, suggest a better one, or throw it off and hope. What the client is actually doing when it decides, what 802.11k, v and r each change, and a walk test to watch it happen on Mist and Central.
origin: Wireless Academy, lesson 9. Fundamentals first, then a lab on real gear
---
Last week was how many exchanges it takes to get on. This week is what happens when the client wants to get on somewhere else.

Somebody walks from their desk to the meeting room and the call breaks up halfway. The ticket says the Wi-Fi dropped. It didn't. The laptop stayed loyal to the AP by the desk until it was three walls away, then did a full join to the meeting room AP, and the call didn't survive the gap. Nothing in the infrastructure chose that. The decision to roam, when and to where, is made by the device in the user's hand. The AP can only advise or refuse.

## The client decides

A client watches the signal from the AP it's on. When it drops past a threshold the client chose, it scans the channels it thinks are worth scanning and moves if it finds something enough better. Every one of those numbers belongs to the client. Apple publishes theirs, which is why I can quote them. iPhone and iPad hold the current AP until the RSSI crosses -70 dBm. A Mac holds until -75. Once looking, an iPhone wants a candidate 8 dB stronger if it's passing traffic, 12 dB if idle. A Mac wants 12 dB either way. Microsoft doesn't publish a threshold that I can find. Intel adapters have a Roaming Aggressiveness setting, Lowest to Highest with Medium the default, described as moving the signal threshold where the adapter starts scanning. No number, and a driver setting survives nothing, so I don't build on it.

That gap between "-70 dBm" and "8 dB better" is where sticky clients live. A Mac at -72 next to a corridor AP that would give it -60 hasn't moved, because it doesn't start looking until -75 and then wants 12 dB better. It's always a laptop.

The standards give the AP three ways to help.

**802.11k** is a neighbour report. The client asks its AP who the neighbours are and gets BSSIDs and channels. Apple's devices use the first six entries to pick which channels to scan, and Apple's doc says that without it the client scans every channel on every band, which can add several seconds. 11k shortens the search. It doesn't start it.

**802.11v** BSS transition management is a suggestion. The AP sends a frame saying "here's a better AP, please go". The client may go, may decline, may ignore it. Mist's doc says clients are free to ignore it and often do.

**802.11r** fast BSS transition changes what a roam costs, not when it happens. At the first join the client and network set up a top-level key, PMK-R0, and derive a per-AP key, PMK-R1, from it. On a roam the client authenticates to the new AP with FT elements in the authentication frames and finishes with a reassociation. The nonces that would have been the 4-way handshake ride inside those four frames, so there's no separate handshake and no trip to RADIUS. Over-the-air does it directly with the new AP; over-the-DS goes through the current AP in action frames. Mist's API notes its chips don't do over-the-DS and that forcing the bit on breaks iOS, so over-the-air is the one that matters. A client that doesn't speak 11r should still get a normal join on an 11r SSID; Apple's doc says its Intel Macs interoperate that way.

**OKC** is the non-standard cousin. The client reuses the PMK from its first EAP exchange on other APs and skips RADIUS, but as I read it the 4-way handshake still runs, because only the key was cached. Windows and some Android do it. Apple doesn't; Apple's doc is clear that its sticky key caching isn't OKC, and that flavour only helps going back to an AP you've already been on.

Then there's the shove. Min RSSI, ClientMatch, a plain deauth: the AP decides the client should have left and throws it off. The client then does what it was going to do anyway, only with no connection while it thinks, and the AP only ever knew how well it heard the client, not how well the client heard it. Useful for a client that would otherwise never leave. Not a roaming strategy.

The honest line: every AP-side mechanism is a suggestion or a shove. Never a decision.

## The number that matters

The cost of a roam is the frames the client must get right before traffic flows again. Mist's roaming doc puts a standard roam at eight messages and an 11r roam at four. Add last week's EAP conversation for an enterprise SSID:

```
standard roam, PSK:  auth 2 + assoc 2 + 4-way 4                          =  8 frames
standard roam, EAP:  auth 2 + assoc 2 + EAP-TLS (a dozen and up) + 4-way 4  = 20 or more
11r roam, either:    FT auth 2 + FT reassoc 2                             =  4 frames
```

That's the pitch for 11r on a voice SSID: half the frames of a PSK roam, a fifth of an EAP-TLS one, and no RADIUS in the path. Nobody publishes a roam time you can plan against, so I use what the platforms grade against. Mist's Roaming SLE calls an 11r roam slow past 400 ms and a standard or OKC roam slow past 2 seconds. Central flags a roam as high latency past 50 ms. Two vendors, two ideas of slow, and both are just the line they drew.

## What the gear shows you

**Mist.** Open the client from the Insights page and read Client Events. The names carry the roam type: Reassociation, 11r Roam, 11r Reassociation, OKC Roam, and Client Roamed Away from the AP it left. The failures are there too: 11r Auth Failure, 11r FBT Failure, 11r Key Lookup Failure. Click one for the summary and, where the AP kept the buffer, a packet capture. The Roaming SLE grades the same roams: Latency splits into Slow 11r Roams, Slow Standard Roams and Slow OKC Roams; Stability has Failed to Fast Roam; Signal Quality has Interband Roam, Suboptimal Roam (to an AP more than 6 dB worse, or below the coverage threshold) and Sticky Client (stayed put with something more than 6 dB better on offer). From the API, `GET /api/v1/sites/{site_id}/events/fast_roam` returns each roam with `fromap`, `ap_mac`, `latency` in seconds and a `type` of success, slow, poor, pingpong, fail or none. The walk test as a list.

On the WLAN, Security has Fast Roaming: Default is local PMKID caching only, which the doc says doesn't scale, then OKC and .11r. OKC only appears once the security type is Enterprise (802.1X); a Personal (SAE) WLAN offers Default and .11r, which makes sense, since OKC is a way of carrying an 802.1X key around. The API's `roam_mode` takes `NONE`, `OKC` or `11r`. 802.11k and 802.11v are on by default, the WLAN options doc lists no switch for them, and the API's `disable_11k` sits in the site Wi-Fi settings.

**Aruba Central.** Open the client details page. The Roaming Experience pane lists each roam with Date/Time, SSID, Latency(ms), To BSSID, Source AP, Destination AP, Roaming Type, Band and RSSI (dBm). ClientMatch's own moves are under Analyze, Alerts & Events, Events, with the Advanced Filtering option Client Match Steer. What ClientMatch does, per the doc: for an 11v-capable client it sends a BSS transition request and waits. For one that isn't, every neighbouring radio except the target refuses the client for 5 seconds, and 2 seconds later the current AP sends a deauthentication. A client that ignores five 11v requests goes on an unsteerable list for 24 hours; one that beats three deauth moves, 48. Load-balance moves are 11v only. On AOS 10 the whole thing runs from Central, not a controller.

The WLAN toggles are on the Security page under Advanced Settings, in a Fast Roaming section: Opportunistic Key Caching (OKC), 802.11r, 802.11k, and 802.11v, worded "802.11v based BSS transition". The 11v toggle is documented on the personal-security page; the enterprise page as written lists only OKC, 11r and 11k, so check the box, as of September 2026.

**AOS 8 and Instant CLI.** `show ap client trail-info <mac>` prints the Mobility Trail: AP name, BSSID, ESSID and timestamp for every AP the client has been on, plus deauth reasons. `show ap arm client-match history client-mac <mac>` shows each ClientMatch move with Reason and Status/Roam Time/Mode columns, and `show ap arm client-match summary` totals moves by type, SM for sticky, LM for load balance, B5G and B6G for band steering, each with Total and Success, and a separate 11v Moves column. On Instant it's `show ap client-match-history`. 11r is `wlan dot11r-profile` with `dot11r` and `mob-domain-id`, attached to the ssid-profile; 11k is `wlan dot11k-profile` with `dot11k-enable`; ClientMatch's 11v use is `cm-dot11v` in the `rf arm-profile`, on by default.

**Sidekick.** In my experience, walking the corridor in a passive survey gives you the RSSI from both APs along the route. That's the crossing in the hero, which the client never sees, because it isn't looking.

## The lab

Two APs on different channels, one phone or laptop, a corridor, under an hour. Pin both APs' channel and power first.

1. Start a continuous ping to the gateway on the client. Note the RSSI from AP 1.
2. Walk from AP 1 to AP 2 and back, three times, at walking pace. Don't stop at the crossing.
3. Mist: Client Events. Central: the Roaming Experience pane. For each roam write down the RSSI when it moved, the latency reported, and whether it went where you'd have sent it.
4. Turn on 802.11r on the SSID. Mist: Fast Roaming to .11r. Central: the 802.11r toggle. Reconnect the client so its first association carries the FT elements.
5. Walk again. Mist should now say 11r Roam; Central's Roaming Type should change. Compare latency.
6. Turn on 802.11v where it's a toggle and walk once more, watching for a transition request and whether the client took it. On Mist it's on by default, so you're comparing against what you already had.

**What you should see.** Six roams at roughly the same RSSI every time, and on Apple gear at or below the -70 dBm line, not at the crossing. The 11r walk should cut the reported latency hard; Mist's doc says half the frames of a PSK roam, and the platforms grade it against 400 ms instead of 2 seconds. The roam point doesn't move with 11r. 11k won't move it either; it only shortens the scan once the client starts. A BTM request the client acts on, or a shove, is the only thing that brings it earlier. Those are the model's expectations; the measured numbers replace them.

**What means it's broken.** A client that never roams until the ping dies is sticky: compare its RSSI at the drop to the neighbour on the Sidekick trace. A roam to the weaker AP is Suboptimal Roam on Mist and usually a stale scan list; 11k is the fix. An 11r walk slower than the plain one means the client doesn't do FT and fell back, or the mobility domain doesn't match across APs; 11r Key Lookup Failure and 11r FBT Failure name it. A roam with no event at all is a disconnect and a rejoin, and the ping gap is last week's join sequence.

## Three questions

1. An iPhone sits at -68 dBm on AP 1 with AP 2 offering -58. Does it roam?
2. An 11r roam on an EAP-TLS SSID: how many frames, and does RADIUS see it?
3. ClientMatch wants a non-11v client off an AP. What does it actually do?

Answers: Not yet. The iPhone's trigger is -70 dBm and it isn't looking until it crosses it, though once it does, 10 dB better clears the 8 dB bar. Four frames, FT authentication and FT reassociation, and RADIUS never hears about it; the key came from the PMK-R0 set up at the first join. It has every neighbouring radio except the target refuse the client for 5 seconds, waits 2, deauthenticates it, and relies on the client rejoining where it's allowed.

## Next lesson

Capacity, not coverage. Clients per radio, cell size and the minimum basic rate. We raise it on both platforms and watch the cell shrink.
