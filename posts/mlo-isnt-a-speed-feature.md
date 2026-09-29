---
title: Wi-Fi 7 MLO Isn't a Speed Feature. Walk Around and You'll See Why.
slug: mlo-isnt-a-speed-feature
date: 2026-09-29
tags: Wireless, Wi-Fi 7, AOS-10, MLO
hero: hero-mlo-isnt-a-speed-feature.svg
summary: Same phone, same AP-735, same walk through the house. With MLO on the download averaged 430 Mbit/s and with it off 403. What actually changed was reconnections: none in 16 minutes with MLO on (one in a later run), 13 in 16 minutes with it off.
origin: Three days on the home lab bench with an AP-735, an iPhone 18 Pro Max and iperf3
series: Wi-Fi 7 rollout
series_order: 3
---
## Why I'm writing this

Every Wi-Fi 7 deck has the same slide. A phone, two bands, both lit up, and a number with "Gbps" after it. MLO is the feature doing the heavy lifting on that slide.

So I put the newest phone I could get on the Wi-Fi 7 AP on my bench and ran it the boring way: one setting at a time, iperf3 instead of a speed test, then a walk around the house with a download running, MLO on and MLO off.

Same route, same stops, five minutes each. MLO on averaged 430 Mbit/s. MLO off averaged 403. That's a tie. The number that did move was reconnections. In 16 minutes with MLO on, the phone never reconnected (a later run wasn't quite that clean, more on that below). In 16 minutes with it off, it reconnected 13 times, ten of them in one stretch at my desk that I couldn't make happen again the next night.

## The bench

An AP-735 on AOS-10 10.8.1.0, managed from Central, with a test SSID on all three bands: 6 GHz at 160 MHz, 5 GHz at 80, 2.4 at 20. An iPhone 18 Pro Max on iOS 27, which is Wi-Fi 7 with two spatial streams and 160 MHz channels at most, so its best case on 6 GHz is 2402 Mbit/s on paper. The AP hangs off a 1G switch port and the iperf3 server is a desktop wired to the same switch, so anything over about 940 Mbit/s is the cable talking, not the air. Keep that number in your head. It matters later.

I started with Speedtest and gave up on it after three rungs. Most runs landed between 650 and 745 down and 38 to 39 up no matter what I changed, because something upstream of the Wi-Fi, most likely the ISP, was the bottleneck. A speed test that reads the same whatever you do is a very consistent way to learn nothing.

## The ladder

Here's the climb, one change at a time, and what the AP actually did about each one. That column comes from `show ap bss-table` and `show ap association` on the AP, not from Central's banner.

| Rung | What I set | What the AP actually did |
|---|---|---|
| 0 | My house SSID, WPA2 with MPSK | Wi-Fi 6 at 80 MHz on 5 GHz. A Wi-Fi 7 phone on a Wi-Fi 7 AP with a Wi-Fi 6 connection |
| 1 | Test SSID on WPA2, 11be ticked | Central refused to save it with 6 GHz on. With 6 GHz off it saved, and the AP ran the SSID as Wi-Fi 6 with no MLD anyway |
| 2 | WPA3 Personal (transition mode on), 11be on, MLO off | Wi-Fi 7 on each band as its own BSS. The phone took 6 GHz at 160 MHz, then reassociated between 5 and 6 GHz in the middle of a test |
| 3 | MLO on | One MLD across all three bands. The phone joined with links on 6 and 5 GHz and held one association through the first test |
| 4 | 802.11r on, MLO still on | Central said "Configured Successfully." The AP-735 kept MLO and left 11r off. The Wi-Fi 6E AP-635 in the same group turned 11r on |
| 5 | 802.11r on, MLO off (Monday night) | The `r` flag came on for all three BSSs. Every time I flipped 11r, the push knocked my phone off and it stumbled getting back. More in the gotchas |

Rungs 1, 4 and 5 are the ones that'll bite somebody, and none of them warns you about the part that matters. You find out from the BSS table flags or you don't find out.

## Standing still

Three feet from the AP, iperf3, five streams, 30 seconds a run:

| At 3 ft | MLO on | MLO off |
|---|---|---|
| Download | 866 and 839 Mbit/s | 782 Mbit/s |
| Upload | 611 and 477 Mbit/s | 750 Mbit/s |

Two runs one way, one the other, all under a 1G ceiling. That's too few runs to call anything, and half the differences point the wrong way for the brochure. Standing still, MLO bought me nothing, and I wouldn't expect it to. One good link can already fill that cable.

## The walk

{{figure: fig-walk-route.svg | The route. Start the download at the desk, walk to the laundry room, then four more stops at 20 seconds each and back to the desk. Distances are straight lines from the AP.}}

Download running, five streams, five minutes. Start at the desk, walk to the laundry room, 41 feet and a few walls from the AP, then four more stops at 20 seconds each, and back. I pinned the SSID to the AP-735 for this. On my first walk, with MLO on and the SSID on all three APs, the phone let go of the 735 for at least 40 seconds, and I couldn't tell you where it went. Unpinned, you're measuring roaming. That's a different post.

{{figure: fig-mlo-walk.svg | Top: the same walk with MLO on and MLO off, per second from the iperf3 server log. Bottom: a later MLO-on walk to the laundry room and back, with the link carrying the download read off the AP.}}

On the averages it's a tie: 430 against 403, medians 333 and 340. The MLO-off run actually did better through the middle of the house. Where they differ is the holes.

With MLO off, about 20 seconds into the run the download went to zero for eight straight seconds. The AP's auth trace shows what happened: the phone came back to the same 6 GHz BSS with a brand new SAE exchange and four-way handshake, 44 ms start to finish on the AP's clock. Nothing logged a deauth or a disassociation from either side before it, and `show ap client-match action-history` had no entry for the phone, so the AP didn't push it. The phone went quiet on its own, came back, and TCP took a few more seconds to believe it. Forty-five seconds later it hopped to 5 GHz, which cost one bad second, and it stayed there for the rest of the download. MLO on had a single zero second in five minutes and never reassociated.

One run each, and the MLO-off walk ran about 20 seconds behind by the end, so compare the shapes rather than second by second.

## The strange part: sitting at the desk

The walk was the test. What happened at the desk afterwards is the part I can't fully explain. With MLO off, once the download ended, the phone started switching bands on its own: 6 GHz, 5 GHz, 6, 5, eleven times in the next eleven minutes, ten of them sitting still at my desk, four feet from the AP. Here's a slice of the auth trace, trimmed to the columns that matter:

```term
AP-735# show ap debug auth-trace-buf | include <phone-mac>
Sep 27 16:48:38.040  station-up  <phone-mac>  <5ghz-bssid>  wpa3-sae aes-ccmp-128
Sep 27 16:50:08.341  station-up  <phone-mac>  <6ghz-bssid>  wpa3-sae aes-ccmp-128
Sep 27 16:50:46.919  station-up  <phone-mac>  <5ghz-bssid>  wpa3-sae aes-ccmp-128
Sep 27 16:51:19.307  station-up  <phone-mac>  <6ghz-bssid>  wpa3-sae aes-ccmp-128
Sep 27 16:52:02.320  station-up  <phone-mac>  <5ghz-bssid>  wpa3-sae aes-ccmp-128
```

Every one of those is a full reassociation with a four-way handshake behind it. Count the walk and the desk together and it's 13 reconnections in 16 minutes with MLO off. The same phone on the same AP with MLO on held one association for 16 minutes straight, walk included. That's the graphic at the top.

The odd part: before the walk, with MLO already off, the phone sat on 6 GHz at the same desk for four minutes without a single switch. After the walk it couldn't make up its mind.

So the next night I went after it. My first suspect was the FTM responder. It was on for every Sunday run, and the 10.8.1.0 release notes list frequent 6 GHz client disconnects on the 7xx APs when the AP runs FTM ranging scans, mostly on Enhanced Open SSIDs, with the FTM responder off as the workaround.

MLO off again, phone on the same desk, auth trace read every few minutes. With FTM off, the phone moved once, from 5 GHz to 6, in 21 minutes, then sat on 6 GHz for twelve. With FTM back on, twelve and a half minutes on 6 GHz without a drop. So it isn't FTM, or not FTM on its own, and in over half an hour of sitting still with MLO off, the phone never went back and forth once.

I didn't repeat the walk with a download running, which is what came right before the flipping on Sunday, so that part's still open. Take the ten desk switches as something that happened that afternoon, not something MLO off always does. What held both days is simpler: with MLO off, every band change the phone did make was a full reconnect.

## What MLO actually does on a walk

The one view Central's Tools > Commands list doesn't give you is per link. The AP console has it: `show ap debug client-table mlo` prints the MLD row plus a row per link, each with its own rates, SNR and byte counters. I piped it through `include` on the BSSID prefix to lose the legend, did one more walk with MLO on, desk to laundry room and back, and read it every 15 seconds or so.

| Where I was | 6 GHz link | 5 GHz link |
|---|---|---|
| At the desk | 2401 Mbit/s, carrying everything | Up, zero packets |
| Walking out | 432 Mbit/s, SNR 10 | Still zero |
| Laundry room | 6 Mbit/s, SNR 8, no data for 20 s | 144 Mbit/s, SNR 7, carrying the download |
| Back at the desk | Up, idle | 960 to 1200 Mbit/s, carrying the download |
| Next download | Carrying again | Idle |

That's the feature. The traffic moved from 6 GHz to 5 GHz inside one association: same association ID, no reassociation, no handshake. It wasn't instant. The iperf log shows about five seconds between 10 and 70 Mbit/s while 6 GHz died and before 5 GHz took over, but it never hit zero. Back at the desk the download stayed on 5 GHz until it finished, and 5 GHz at 80 MHz could still fill the 1G wire. The next download started on 6 GHz again.

The AP has a name for what this phone does. `show ap association mlo` lists it as MLD-MLSR, multi-link single radio: links up on 6 and 5 GHz, but data on one link at any given moment. HPE's own example output shows an EMLSR client and an STR client. Mine is neither, so on this phone MLO was never going to add the two links together, whatever the slide says.

And the honest part. In that same run, still near the desk, the phone did one full reconnect with MLO on: fresh SAE, new link addresses, three seconds of nothing. 10.8.1.0 does list a known issue with unexpected deauthentication when MLO is on (AOS-271966), but the trace didn't log a deauth before mine, so I can't pin it on that. Either way, MLO doesn't stop a client from deciding to start over. What it stops is a band change costing you a reconnect.

## Gotchas

**802.11r and MLO don't mix on 10.8.1.0, and 11r without MLO has a trap of its own.** Central (Classic, as of September 2026) will accept 11r on an MLO SSID and tell you it worked. The AP-735 kept MLO and quietly left 11r off. HPE documents 11r as unsupported with MLO in this release, so plan on no fast roaming between APs for that SSID, and check for the `r` flag in `show ap bss-table` instead of trusting the banner. Turn MLO off and the `r` flag does come back. What I didn't expect was what flipping it did to my iPhone. Every time I pushed 11r on with the phone connected, it came straight back with the plain SAE it had been using, and the four-way handshake died at message 1 or 3. Three times it switched to FT-SAE on its own and got back in 1 to 16 seconds. Twice it sat off the network until I tapped it. Pushing 11r off broke it the other way round: the phone came back asking for FT-SAE, the AP accepted the association anyway, and the handshake died at message 1. It didn't come back on its own either time. That's seven pushes and seven broken reconnects, with WPA3 transition mode on or off. A plain Wi-Fi toggle never tripped it. I caught two over the air, and both joined with FT-SAE in under 50 ms. `show ap debug mgmt-frames` in Tools > Commands is what shows who hung up. The closest thing in the 10.8.1.0 known issues is an 11r bug about roaming (AOS-270569), not this. So flip 11r in a maintenance window, and check your iPhones actually came back.

**Your Mac has a Wi-Fi sniffer, and it's free.** Hold Option, click the Wi-Fi icon, open Wireless Diagnostics, then pick Window > Sniffer. Choose the channel and width, click Start, and it writes a pcap that Wireshark opens. That's how I caught those two clean joins. The catch: the Mac drops off Wi-Fi while it listens, so you can't push a config change from the same laptop mid-capture. That's exactly why I don't have the broken reconnect on the air yet. And Sniffer isn't the only thing in that Window menu. Info, Logs, Scan and Performance sit right beside it, which is a decent little survey kit for a tool you never installed. Checked on macOS 26.6.2, September 2026.

**WPA2 means Wi-Fi 6 on 10.8.1.0, whatever you ticked.** An 11be checkbox on a WPA2 SSID gets you HE on the air and no MLD. The 10.8.1.0 release notes list that as a fix, so older builds may behave differently. WPA3 transition mode kept Wi-Fi 7 on 2.4 and 5 GHz in my lab, and Central refuses WPA2 with 6 GHz outright, which is at least honest.

**Re-enabling MLO can leave clients single link.** Three times in five tries, my phone came back on the MLO SSID as a single-band client until I toggled its Wi-Fi. If you flip MLO mid-test, make the client rejoin from scratch before you believe anything.

**The per-link view is console only on my tenant.** Neither `show ap debug client-table mlo` nor `show ap association mlo` is in the Tools > Commands list as of September 2026. The remote console runs both.

**The auth trace names your MPSK entries.** On 10.8.1.0, `show ap debug auth-trace-buf` ends each MPSK client's key-2 line with a `pass:` field holding the name of the MPSK entry the client matched. I checked with a throwaway entry named unlike its passphrase, and the field showed the name. Trouble is, I'd named my house entries after their passphrases, so there they were, in clear, for anybody who can run show commands on that AP from Central's Tools or its console. Name MPSK entries after who they're for, not what they are, and redact that field before the output goes into a ticket or a forum post.

## Bottom line

MLO didn't make my phone faster, standing still or walking around. What it changed was what a band change costs. With it off, every band change was a full reconnect: thirteen reconnects in sixteen minutes on Sunday, twelve of them to switch bands, most of those in one stretch at my desk I couldn't repeat the next night. With it on, the phone held one association and the traffic moved between bands underneath it.

That's a dropped-call and latency story, not a speed story. So test it like one: a walk and a call, not a speed test at three feet.
