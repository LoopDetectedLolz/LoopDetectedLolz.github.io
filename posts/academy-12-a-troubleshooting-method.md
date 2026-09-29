---
title: A Troubleshooting Method
slug: academy-12-a-troubleshooting-method
date: 2026-09-28
tags: Wireless, Academy, Troubleshooting
hero: hero-academy-12.svg
academy: 12
summary: Every Wi-Fi ticket lives in one of four layers, and every layer has a counter that proves it or clears it. This is the method the other eleven lessons were building, and a lab that breaks one AP three ways so you can practice finding each with the right tool.
origin: Wireless Academy, lesson 12. Fundamentals first, then a lab on real gear
---
Last week was the survey and what a heatmap can't see. This week is what to do when the ticket arrives anyway, saying "Wi-Fi is slow" and nothing else.

Eleven lessons come down to one habit: find the layer before you touch anything. Most of the bad troubleshooting I've done was changing a channel because the ticket said Wi-Fi when the problem was a DHCP scope with no leases left. The radio is usually fine. It's just the part everyone can see.

## Four layers

A wireless connection has four places to fail.

**The client.** Its adapter, its driver, the rates and streams it supports, and what it decided to do. Lesson 4 was the rate it picked; lesson 9 was the AP it picked. A 1x1 badge reader on an old driver is a client problem and no AP setting fixes it.

**RF.** Signal, SNR, noise floor, airtime, co-channel neighbors. Lessons 1, 3, 5, 6 and 7. The layer the ticket blames, and the fastest to prove or clear, because retries and SNR are on the first screen of both platforms.

**Infrastructure.** The AP, the controller or cloud, the join, the auth, the VLAN, DHCP. Lesson 8. A client that associates and then goes nowhere is here, and the events name the step.

**Upstream.** The switch port, PoE, the uplink, DNS, the internet. Out of scope for the Academy, and in my experience where about half the "Wi-Fi is slow" tickets end.

The method is four lines. Reproduce it. Locate the layer before you touch anything. One change at a time. Write the prediction down before you measure, lesson 3's habit. Then read the counter that proves the layer: retries for RF, Access Tracker for auth, the DHCP event for infrastructure. And read the counters that stayed clean. A clean counter is how you rule a layer out, and ruling layers out is most of the job.

## The number that matters

The one-change rule is arithmetic, not manners. With n suspects and one change per trial, each result names a knob:

```
one at a time:      n trials           3 suspects  ->  3 trials, worst case
all at once:        2^n combinations   3 suspects  ->  8 to tell them apart
```

Change two things together and if it works you have four combinations of those two knobs and no idea which one mattered, so you're back to trying them separately, up to four trials, to learn what one would've told you. Computers are very patient about this. Change control isn't.

## What the gear shows you

Every screen and command below is from an earlier lesson or a doc page. The job is matching each to a layer.

| Tool | Layer it proves | What to read |
|---|---|---|
| Central client page | Client, RF | Health bar: Device Health, Signal Quality (SNR), Tx\|Rx Rate. Graphs: Retry Frames, Roaming Experience. Connection: Client Capabilities, Client Max Speed. Network: VLAN ID, Auth Server, DHCP Server |
| Central client Events tab | Infrastructure | Client 802.1X Radius Reject, Client 802.1X Radius Timeout, Client EAP Failure, Client DHCP Acknowledged, Client DHCP Timeout, Client Roaming Success |
| AOS CLI | Client, RF | `show ap debug client-table` (last-packet rates, Last_ACK_SNR), `show ap debug client-stats` (per-MCS counters), `show ap arm history`, `show ap bss-table` (channel, EIRP, client count per BSS), `show ap monitor ap-list` (neighbors with chan, curr-rssi, curr-snr) |
| AOS 8 CLI | Infrastructure | `show auth-tracebuf` with `failures` or `mac <address>`: the 802.1X exchange with the server, packet by packet |
| Mist Client Insights | All four | Current Values: RSSI, SNR, RX/TX rates, protocol. Client Events: Authorization Failure, DHCP Timed Out, DHCP Denied, Gateway ARP Timeout, DNS Failure. Pre-Connection charts: Authorization Latency, DHCP Latency |
| Mist SLEs | Site-wide | Successful Connects, Time to Connect, Throughput, Coverage, Capacity, Roaming, AP Health. The classifiers under each name the layer for you |
| Marvis | Infrastructure, upstream | Marvis Actions: Authentication Failure, DHCP Failure, ARP Failure, DNS Failure. The Conversational Assistant for the question in words |
| ClearPass | Infrastructure | Access Tracker: Login Status of Accept, Reject or Timeout, and the Error Code. Event Viewer: what never made it into Access Tracker |
| Sidekick | RF | The spectrum view for non-Wi-Fi noise, the passive survey for what's actually on the channel |

Central's Events tab and Mist's Client Events are the same idea with different names, and both list auth and DHCP as separate events, which is what makes them a layer detector. The Mist SLE names are the doc page's as of September 2026; the classifiers under Successful Connects are Association, Authorization, DHCP, ARP and DNS, which is the four-layer model in a different font.

The client layer is the one no platform shows well. Central gives you Client Capabilities and Client Max Speed, Mist gives you the protocol, and beyond that you're on the laptop reading its adapter properties. It's always a laptop.

## The lab

One AP, one laptop, lesson 8's 802.1X SSID pointed at the ClearPass lab, the AP on a switch port you can edit, the Sidekick, and a microwave or a metal cabinet. Under an hour. Each break gets three columns in your notes: predicted, seen, and which counters stayed clean.

1. Baseline. Laptop 3 m from the AP, connect, write down SNR, Retry Frames, the Access Tracker Accept, and the DHCP Acknowledged event (Central) or DHCP Success (Mist). Every break gets compared to this row.
2. Break RF. Put the laptop behind the cabinet or run the microwave on the 2.4 GHz radio, same as lesson 7. Prediction first, and the two breaks predict differently: behind the cabinet, RSSI and SNR fall together and the noise floor doesn't move; with the microwave, RSSI holds within a few dB, the floor rises and SNR collapses. Either way retries climb, no auth event, no DHCP event.
3. Read it. Central: Signal Quality drops, Retry Frames climbs, Events tab quiet. Mist: SNR in Current Values drops, `tx_retries` from `/stats/clients` climbs, Client Events show nothing bad. Sidekick: the spectrum view shows the thing. Access Tracker: no new session, because the client never re-authenticated. That's RF, proven by retries, cleared on auth and DHCP.
4. Put it back. Confirm SNR and retries return to the baseline row before the next break, or you're changing two things.
5. Break auth. Change the RADIUS shared secret on the WLAN's server entry, on either platform, to something wrong. Reconnect the laptop. Prediction: SNR and retries unchanged, an auth failure event, nothing in Access Tracker.
6. Read it. Central: a Client 802.1X event in the Events tab and a status of Failed in the health bar. Mist: Authorization Failure in Client Events, with a paperclip if the AP kept a packet capture, and Successful Connects takes the hit under Authorization. ClearPass: the doc puts shared secret errors in Monitoring > Event Viewer, and in my experience Access Tracker stays empty for an 802.1X request it can't check. No new row in Access Tracker plus an Authentication event in Event Viewer is the signature. Check both, though; a Reject carrying the error text Wrong shared secret is possible on some request types and I haven't seen it on an EAP request yet, writing in September 2026. Whether Central logs it as Reject or Timeout I haven't pinned to a box yet, as of September 2026; in my experience the server doesn't answer a request it can't check, so I'd expect the timeout.
7. Put it back. Confirm an Accept in Access Tracker before you touch the switch.
8. Break upstream. My lab SSID is bridged at the AP, so on the AP's switch port, remove the client VLAN from the trunk, or block DHCP on the port if your switch has a knob for it. If yours is tunnelled to a controller, gateway or Mist Edge, do the same on that box's uplink instead; the AP's port doesn't carry the client VLAN. Reconnect. Prediction: SNR and retries clean, Accept in Access Tracker, then a DHCP timeout and no address.
9. Read it. Central: Client DHCP Timeout in the Events tab, and the Network section shows the VLAN ID the client landed in. Mist: DHCP Timed Out in Client Events, DHCP Latency on the Pre-Connection chart, Successful Connects hit under DHCP, sub-classifier Discover Unresponsive if Mist saw no offer at all. RF clean, auth clean. That's upstream.
10. Put it all back and run the baseline row once more.

**What you should see.** Three breaks, three different dirty counters, and each time the other layers' counters sit at the baseline. The RF break is the only one that touches SNR and retries. The auth break is the only one with an empty Access Tracker. The DHCP break is the only one where the client gets through authentication and still has no address. If your notes show that, you can find any of the three in a real building without touching a config.

**What means it's broken.** Retries rising on the auth break means you didn't wait for RF to settle after step 4; redo the row. An Accept in Access Tracker during the auth break means the wrong secret went on a server the WLAN doesn't use; check the Auth Server field. A DHCP failure during the RF break means the microwave knocked the client off and it came back; that's the layers interacting, which is real, and the fix is to read the events in time order.

The figures here are what the method expects. Measured ones replace them, same as lesson 2.

## Three questions

1. A client shows 35 dB SNR, 2 percent retries, an Accept in Access Tracker, and DHCP Timed Out. Which layer, and which counters cleared the others?
2. You change the channel and the RADIUS timeout together. The user says it's better. What did you learn?
3. Central shows Retry Frames at 40 percent and Signal Quality at 12 dB while the laptop reports a strong signal. Which lesson, which tool, and which layer?

Answers: Upstream, or the DHCP side of infrastructure; the SNR and retries cleared RF, the Accept cleared auth, so the address is the only thing missing. Nothing, and you now owe two more trials to find out which one did it. Lesson 7, the Sidekick's spectrum view, RF; strong RSSI with low SNR is noise, and the client can't see noise, only the analyzer can.

## What to do with all twelve

Run the labs, keep the numbers, and put the calculators on the Tools page to work every time a ticket says "slow" without saying why.
