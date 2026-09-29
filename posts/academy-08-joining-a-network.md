---
title: Joining a Network
slug: academy-08-joining-a-network
date: 2026-09-26
tags: Wireless, Academy, ClearPass
hero: hero-academy-08.svg
academy: 8
summary: A client doesn't connect. It climbs a ladder of a dozen exchanges, and every rung is somewhere it can fall off. This is the ladder in order, what each platform shows you for each rung, and a lab that breaks it three ways so you learn which rung each failure lands on.
origin: Wireless Academy, lesson 8. Fundamentals first, then a lab on real gear
---
Last week was whether the radio can hear the AP through the noise. This week is what happens once it can, because "connected" is not one event. It's a ladder.

The user says the Wi-Fi is down. The helpdesk says the password is wrong. The RADIUS admin says nothing hit the server. The DHCP admin says the scope has leases. All four are looking at a different rung of the same ladder, and the fix depends on which rung the client fell off. Learn the rungs in order and the platform screens stop being a pile of events and start being a story with a page number.

## The ladder

**Discovery.** On 2.4 and 5 GHz the client either listens for beacons, one channel at a time for a beacon interval, 100 TU or 102.4 ms by default, or sends a probe request and gets a probe response. Two frames. On 6 GHz the client isn't allowed to blind-probe every channel, so the AP announces itself with FILS Discovery frames or unsolicited probe responses about every 20 ms, and its 2.4 and 5 GHz beacons carry a Reduced Neighbor Report pointing at the 6 GHz radio. Discovery is the rung that leaves nothing on the AP when it fails, because the client never talked to it.

**802.11 authentication.** Two frames, sequence 1 and 2, with a status code. Open system, which is what WPA2-PSK and Enterprise use here, proves nothing; it's there so the state machine can move. WPA3-Personal replaces it with SAE, four authentication frames, commit and confirm each way, and the PMK falls out of that exchange instead of the passphrase.

**Association.** Request and response, another status code, and an AID if it's zero. The client is now authenticated and associated, and on an RSN network every data frame it sends is dropped until the keys exist. Capability mismatches fail here. Status code 43 is the client offering no AKM the AP is configured for.

**EAP, enterprise only.** The client may send EAPOL-Start; the AP sends an EAP identity request either way and the client answers with an identity. The AP wraps that in a RADIUS Access-Request to ClearPass, ClearPass answers with an Access-Challenge, and that pair repeats for every step of the method. EAP-TLS is a certificate exchange both ways inside those round trips; PEAP-MSCHAPv2 is a TLS tunnel with a password challenge inside. It ends with an Access-Accept carrying the key material in MS-MPPE-Recv-Key and MS-MPPE-Send-Key, or an Access-Reject. The AP turns the accept into EAP-Success and the first 256 bits of the master session key become the PMK.

**PSK, where it differs.** No RADIUS leg. Both ends compute the PMK from the passphrase and the SSID, PBKDF2 with 4096 iterations, 256 bits out. The AP can't tell a wrong passphrase from a right one until the next rung.

**The 4-way handshake.** Four EAPOL-Key frames. Message 1, AP to client, carries the ANonce. Message 2 carries the SNonce and a MIC. Both ends now have the PMK, both nonces and both MAC addresses, so both derive the same PTK. Message 3 carries the group key, the GTK, encrypted with the PTK. Message 4 says the keys are installed. A wrong PSK fails at message 2, because the MIC doesn't check. The AP's answer is a deauth, and the client's answer is usually to try again, because computers are very patient.

**DHCP.** Discover, offer, request, ack. Four messages, and they're encrypted data frames, so the radio thinks the client is on. The user is still watching it spin.

Then the first frame the user actually asked for. Every rung above it needs something different: the right channel, a status code of zero, a certificate the server trusts, a passphrase both ends agree on, a DHCP server that can hear a broadcast. And every rung fails on a different screen.

## The number that matters

Count the exchanges between the first probe and the first useful frame. N is the number of EAP request and response pairs after the identity exchange, which is the same as the number of RADIUS Access-Challenge round trips.

```
PSK:      2 probe + 2 auth + 2 assoc + 4 EAPOL-Key + 4 DHCP        = 14 on the air, 0 to RADIUS
EAP-TLS:  2 + 2 + 2 + 1 EAPOL-Start + 2 identity + 2N + 1 EAP-Success + 4 + 4
                                                                     = 18 + 2N on the air, N + 1 RADIUS round trips
          with N = 8:  34 frames on the air, 18 RADIUS packets on the wire
```

N = 8 is the model's placeholder for a client certificate with a short chain; count yours off the capture in the lab and replace it. The point is the ratio. Enterprise more than doubles the ladder, and the extra rungs cross the wire to a server with its own queue, its own certificate checks and its own idea of a timeout. A roam is this ladder again, minus discovery, every time the client moves. 802.11r, OKC and PMK caching exist to skip the EAP rungs on the second climb, and if you know the count you know what they're saving.

## What the gear shows you

**Aruba, on the box.** `show ap association` lists every client with `auth` and `assoc` columns and a flags string; `S` is an SAE client, `E` an enterprise one. `show ap debug client-table` has the `Assoc_State` column, which the doc says shows whether the client is currently authorized and/or associated. On an AOS 8 controller `show auth-tracebuf mac <mac>` is the authentication state machine per client: the doc example shows `station-up`, `wpa2-key1`, `wpa2-key2` with `mic failure` against it, and `station-data-ready` at the end, which is the line you want. `show auth-tracebuf failures` keeps only the bad ones. For the 802.11 frames themselves, an AOS 8 controller has `show ap remote debug mgmt-frames ap-name <name> client-mac <mac>` and Instant has `show ap debug mgmt-frames`, both with `stype`, `SA`, `DA`, `BSS`, `signal` and `Misc` columns and the status in `Misc`. On AOS 10 the same two views are `show ap debug auth-trace-buf`, which prints `eap-req`, `eap-resp`, `rad-req` and `rad-resp` lines with the RADIUS server named, and `show ap debug mgmt-frames`. Central's own Tools > Commands page lists them as `auth-trace-buf+` and `mgmt-frames+`, and that plus is Central's marker for a command that takes optional filters, not part of the command; it runs them without it. Both arrived in 10.3.1.0.

**Aruba Central.** Open the client. The Summary has a Connection section with Channel, Band, Client Capabilities and Client Max Speed, and a Network section with Auth Server and DHCP Server, a fast way to check the client is talking to the ClearPass you think it is. The Events tab is the join as a table, Occurred On, Event Type, Description, filterable by type. Under Analyze, Live Events streams the client with a Packet Capture toggle and a Download PCAP button. Under Manage > Overview, Wi-Fi Connectivity is the ladder for the whole site: a summary bar with Association, Authentication, DHCP and DNS success percentages, and a Connection Problems tile that splits authentication failures by type and by server. The AI Insights that match are Clients with High 802.1X Authentication Failures, Clients with High Wi-Fi Security Key-Exchange Failures and Clients with Significant Number of DHCP Server Connection Problems. The ladder again, in three cards.

**Mist.** Open the client, follow Client Insights, and the Client Events section is the ladder with a color on every rung, with tabs for all, good, neutral or bad. A clean join reads Association, Authorization & Association on 802.1X, DHCP Success, Gateway ARP Success, DNS Success. The bad list has Association Failure, Authorization Failure, SAE Auth Failure, DHCP Timed Out, DHCP Denied and DNS Failure; 802.11 Auth Denied sits in neutral. When Authorization Failure, Association Failure or a DHCP failure fires, Mist takes a Dynamic Packet Capture on its own, pins a paperclip to the event, and Download Packet Capture hands you the pcap. The Successful Connects SLE is the same thing site-wide, classifiers Association, Authorization, DHCP, ARP and DNS, with DHCP split into Discover Unresponsive, Renew Unresponsive, Nack and Incomplete. Time to Connect, next to it, is defined as the seconds from the association frame to the moment the client can move data, which is this lesson's number measured. From the API, `GET /api/v1/sites/{site_id}/clients/{client_mac}/events` returns the events with `type`, `text`, `ssid`, `bssid`, `band` and `timestamp`; the spec's own example is a `CLIENT_DNS_OK` with the text `Status code 0 "Successful"`.

**ClearPass.** Monitoring > Live Monitoring > Access Tracker is the RADIUS leg and nothing else. One row per request: Server Name, Source, Username, Service, Login Status and Request Timestamp, and Login Status is Accept, Reject or Timeout. Click the row and Request Details opens on Summary, where you read which Service matched, then Input, what the AP sent and what ClearPass computed from it, and Output, what went back to the AP with the enforcement profile. Accounting only appears if accounting packets arrived. On a reject there's an Alerts tab with the reason; the 6.12 guide only documents that tab for TACACS+ sessions, but Juniper's ClearPass troubleshooting page sends you there for a RADIUS reject and so do I. The rule that saves the most time: no row at all means ClearPass never accepted the packet, and you go to Monitoring > Event Viewer, Authentication category, and look for Request from Unknown NAD or a shared secret complaint. Access Tracker can only show you what got in the door.

**Sidekick.** The Sidekick 2 with Ekahau Analyzer on a phone takes a packet capture on the AP's channel, and Wireshark then shows the whole ladder as frames, which is the only view that includes the probes. Five minutes per capture is plenty for a join.

## The lab

One AP on each platform, one 802.1X SSID pointed at the ClearPass lab, EAP-TLS if you have certs on the laptop, PEAP if you don't, one laptop. Under an hour.

1. Pin the channel and power, same as every lab so far.
2. Forget the network on the laptop, start Live Events on Central with Packet Capture on, or a Sidekick capture on the channel, and join. Read it top to bottom in the Events tab and in `show auth-tracebuf mac <mac>` on AOS 8 or `show ap debug auth-trace-buf` on AOS 10. Count the `rad-req` lines and take one off for the identity. That's your N.
3. Same join on the Mist AP. Read it in Client Events, and compare the gap from Association to DNS Success with the Time to Connect SLE.
4. Open Access Tracker, find the row by username, open it. Summary for Service and Login Status, Output for the enforcement profile, Input for the NAS IP the AP used.
5. Break one: wrong password, or on EAP-TLS an expired or untrusted certificate. Join again on both platforms and find it in all three places.
6. Break two: change the RADIUS shared secret on the AP only. Join again. Notice which of the three places is empty.
7. Break three: move the client VLAN somewhere with no DHCP, or block UDP 67 on the way to the server. Join again.
8. Put it all back and do one clean join so you leave with a good capture next to three bad ones.

**What you should see.** On the clean join, the ladder in order on every platform, with the RADIUS leg visible only in ClearPass and the AP's trace buffer. Break one is Login Status Reject with the reason on Alerts, Authorization Failure on Mist with a paperclip, and on Aruba a `rad-resp` with no `station-data-ready` after it. Break two is the useful one: the client sees the same failure as break one, but Access Tracker has no row, and the AP trace shows `rad-req` lines with nothing coming back. The evidence moved to Event Viewer. Break three fools people: ClearPass says Accept, the handshake finishes, Aruba's client table says associated, Mist says Authorization & Association in green, then DHCP Timed Out in red with Discover Unresponsive under the Successful Connects SLE. Everything below the DHCP rung is fine and the user still can't get on. The frame counts are what the model expects; measured ones go in when I have them.

**What means it's broken.** A reject with a Service you didn't expect means the request matched the wrong service; the fix is in the service rules, not the auth source. Nothing in Access Tracker and nothing in Event Viewer means the packet never left the AP: check the server IP and the AP's route before you touch ClearPass. A `mic failure` on `wpa2-key2` with PSK is the passphrase; after a clean Accept on 802.1X it means the two ends derived different PMKs, and in my experience that's the supplicant or the driver. DHCP failures on one platform and a clean join on the other with the same VLAN is a switch port, not a wireless problem.

## Three questions

1. A client is associated, the AP shows it, and Access Tracker shows Accept, but the user has no IP. Which rung, and which screen proves it?
2. You change the shared secret on the AP and get the password wrong on the laptop in the same afternoon. Which one leaves a row in Access Tracker?
3. On PSK, the client keeps associating and getting deauthed a second later. Where in the ladder is it failing and why can't the AP tell you sooner?

Answers: DHCP; Mist Client Events with DHCP Timed Out, or Central's Wi-Fi Connectivity DHCP stage, and Access Tracker can't show it because ClearPass was done two rungs earlier. The wrong password, as a Reject; the wrong shared secret leaves nothing, and you find it in Event Viewer. The 4-way handshake, at message 2, because with PSK the AP has no way to check the passphrase until the client's MIC arrives, so association always succeeds first.

## Next lesson

Roaming, and why the client decides. Everything in this lesson happens again every time the laptop moves, and 802.11k, v and r are three ways to make the second climb shorter.
