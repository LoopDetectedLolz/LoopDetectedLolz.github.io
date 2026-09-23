---
title: A RADIUS Timeout Means Somebody Dropped It, Not That It Never Left
slug: a-radius-timeout-means-somebody-dropped-it-not-that-it-never-left
date: 2026-09-22
tags: RADIUS, AOS-Switch, AOS-CX, 802.1X
hero: hero-a-radius-timeout-means-somebody-dropped-it-not-that-it-never-left.svg
summary: A 2930 on cloud RADIUS timed out on every EAP-TLS auth while the APs worked. The source port wasn't the problem. The server was silently dropping requests, which is what RFC 2865 and RFC 3579 tell it to do, and with default timers the switch spends 20 seconds per server finding that out.
origin: One Airheads thread asking how to randomize a switch's RADIUS source port, which was the wrong question
---

## Why I'm writing this

Somebody on the forums had a 2930 pointed at a cloud RADIUS service, EAP-TLS on one port, and every auth timed out. Their firewall showed the switch always sourcing from UDP 1812 while the APs used random high ports. The APs worked and the switch didn't. So the question was: how do I make the switch use a random source port?

Wrong question, and I've seen plenty of people ask it. The source port is a red herring. The switch isn't broken either. It's doing what a RADIUS client does: send, wait, retry, give up, log a timeout.

The real bug is upstream of the port number. It's about which address the request arrives from and whether the secret matches. That's the whole post.

The firewall log that made them suspicious was the one thing on the network telling the truth. It said the packet left.

## What a timeout actually means

RADIUS is UDP. A timeout just means no reply came back, and that's all it means. The switch can't tell "dropped on the way" from "arrived and got ignored."

Getting ignored is by design. RFC 2865 says the server picks the shared secret by the packet's source IP, and a request from a client it has no secret for MUST be silently discarded. RFC 3579 adds the EAP rule: every Access-Request carrying EAP needs a Message-Authenticator, and if that doesn't verify with the secret, the server MUST silently discard it too. So on an EAP-TLS port, a wrong secret looks exactly like a dead server.

Cloud RADIUS adds NAT. The service only ever sees what comes out of your firewall. If the switch goes out through a different NAT rule than the APs, or from a VLAN address with no NAT rule at all, the server sees a different client than the one you set up.

The order I check, in field order:

1. Source IP hitting the server (NAT, source interface)
2. Shared secret
3. A long way third: the firewall actually blocking UDP to the odd ports the service uses

The service in the thread gives each customer its own port pair, which is why the poster had 4530 and 4531. Its published setup guides talk about server IP, port and secret. I couldn't find them documenting a source IP allow list, so with that one I'd check the secret first. With anything that keys clients by address, which covers every on-prem RADIUS server, check the source IP first.

Fourth, and rarer: EAP-TLS certificates are big and can fragment on a WAN path. That breaks things partway through the conversation, after challenges have started coming back. It doesn't look like dead silence from the first packet.

The server isn't being rude. It's following an RFC from June 2000 that says don't talk to strangers.

## What good looks like

The rule: the RADIUS server sees one predictable source IP per NAS, and you set it on purpose. Never let the switch use whichever VLAN address happens to route toward the server.

Register that IP as a client, or the public IP it NATs to if the server is in the cloud. One switch, one IP, one client entry, one secret. If the server is cloud, the address that counts is the one after NAT, so go look at the NAT rule, not the switch.

The source IP is the only source you control. Stop trying to control the port.

## Platform specifics

**Aruba CX.** Set the source per feature, with the VRF:

```
ip source-interface radius interface loopback0 vrf <VRF-NAME>
radius-server host <SERVER> key plaintext <SECRET> port <AUTH-PORT> acct-port <ACCT-PORT> vrf <VRF-NAME>
```

Two gotchas. The auth port keyword on CX is `port`, not `auth-port`. And if you leave off `vrf` the server lives in the VRF named default, so the request can go out the wrong table and never reach the NAT rule you expected. `show radius-server statistics` is the counter to watch.

**AOS-Switch**, the platform in the thread. The poster's firewall showed the 2930 sourcing from 1812, and I've never found a command in the AOS-Switch guides that sets or randomizes the source port. That's my own read, not HPE's. What you do get is the source IP:

```
ip source-interface radius loopback 1
radius-server host <SERVER> key <SECRET> auth-port <AUTH-PORT> acct-port <ACCT-PORT>
```

Leave out `auth-port` and `acct-port` and you get 1812 and 1813, which won't match a cloud service with its own ports. Defaults are a 5 second timeout and 3 retransmits, so each server takes 20 seconds to fail. Gotcha: `cached-reauth` keeps clients that are already authenticated up while the server is unreachable. It can hide a server that stopped answering, but it never helps a new client, and the thread was all new clients.

**AOS-8 controllers** do the same job with `ip radius source-interface`, and a per-server NAS IP overrides it. As for the APs in the thread using random ports: nothing in the thread says what brand they were, and it doesn't matter. The APs worked because whatever they sent arrived the way the server expected.

**Junos EX.** `set access radius-server <SERVER> secret <SECRET> source-address 192.0.2.10`. Same rule: set it on purpose. Default port is 1812.

**The EAP-TLS fragment knob.** On AOS-Switch, `aaa port-access authenticator eap-tls-fragment towards-server <576-3072>` caps the EAP-TLS fragment size the switch sends to the server. The default is 3072. Lower it when a WAN path fragments the cert exchange. It only applies to EAP-TLS, only works in the direction of the server, and doesn't fix a timeout that starts on the first packet.

## Test it or it doesn't count

On the switch you want the request counters climbing along with accepts or rejects. A reject is good news at this stage. It means the server is talking to you.

```term
Timeouts .................. 42    Bad Authenticators ...... 0
```

That's the thread's symptom. Timeouts with zero bad authenticators means nothing came back that the switch could check. On a PAP or MAC auth test, a wrong secret usually shows up as bad authenticators, because the server replies and the reply won't verify. On EAP it shows up as timeouts, because of RFC 3579. So zero bad authenticators on an EAP port doesn't clear the secret.

On the firewall, look for outbound UDP to the service's auth port from the public IP you expected, and a reply from that port. If there's no reply, the server dropped it.

On the server, a client it doesn't recognize usually leaves no log entry. That silence is the diagnosis. Once the client is right, the request shows up and anything left over is policy.

What broken looks like: timeouts, clean firewall logs, nothing on the server. Every time I've seen that, it's been client registration or the secret.

## Checklist

| Step | Where | What good looks like |
|---|---|---|
| Source interface set | NAS | `ip source-interface radius` points at a loopback or management VLAN |
| NAT rule identified | Firewall | One rule, one public IP for that source |
| Client registered | RADIUS server | The post-NAT IP is a client (or the service's port pair is right) |
| Secret matches | Both sides | Retyped, not pasted from a ticket |
| Ports permitted | Firewall | UDP to the service's auth and acct ports |
| Request and reply seen | Firewall log | Outbound and return on the auth port |
| Counters move | NAS | Accepts or rejects, not timeouts |
| Fragment size | NAS | Lowered only if EAP-TLS stalls after the first challenge |

## Bottom line

A timeout means the request left and nobody answered. Fix the source IP, then the secret, then look at the firewall. There's no source port knob on AOS-Switch and you don't need one.

What changed in my base config: every AOS-Switch and CX build now sets `ip source-interface radius` to a loopback before the first `radius-server host` line goes in.
