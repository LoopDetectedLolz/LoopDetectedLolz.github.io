---
title: A RADIUS Timeout Means Somebody Dropped It, Not That It Never Left
slug: a-radius-timeout-means-somebody-dropped-it-not-that-it-never-left
date: 2026-09-23
tags: RADIUS, AOS-Switch, 802.1X, NAT
hero: hero-a-radius-timeout-means-somebody-dropped-it-not-that-it-never-left.svg
summary: A 2930 timed out on every EAP-TLS auth while the APs at the same site worked, and the firewall log showed a fixed source port of 1812. The port was a red herring. The server was silently dropping requests from a source it didn't trust.
origin: One Airheads thread asking how to randomize the RADIUS source port on a 2930
---

## Why I'm writing this

Somebody on the forums had a 2930 doing EAP-TLS against a cloud RADIUS service on nonstandard ports. Every auth timed out. The APs at the same site, pointed at the same service, worked fine.

Their firewall showed the switch always sourcing from UDP 1812 and the APs from random high ports. So they asked how to make the switch randomize its source port.

Wrong question, and a common one. The source port is the loudest difference in that log and the least relevant one. The column that matters is the translated source IP.

The switch isn't broken. It sent, waited, retried, gave up and logged a timeout. When nobody answers, that's the whole job. They were right that the firewall log had the answer. They were just reading the wrong column.

## What can actually go wrong

RADIUS is UDP. A timeout means no reply came back. It doesn't prove the packet was blocked. The switch can't tell "lost on the way" from "arrived and ignored", and the RFC makes ignoring the normal response to a stranger.

- **Unregistered source IP.** RFC 2865 says a request from a client the server has no shared secret for must be silently discarded. A cloud service that registers clients by IP only knows you by your public IP after NAT. If the switch leaves through a different NAT rule than the APs, or from a VLAN with no rule at all, it's a stranger.
- **Wrong shared secret.** People expect this one to show up as a reject. With 802.1X it doesn't. RFC 3579 requires a Message-Authenticator on every packet carrying EAP, and a server that can't validate it silently discards the packet. From the switch, a bad secret looks exactly like an unregistered IP. Two different bugs, one symptom. HPE's own AOS-Switch troubleshooting entry for a server that "fails to respond" even though its IP is right tells you to check the key. PAP is the exception: the password decrypts to garbage and the server usually sends a reject.
- **The firewall really blocking the odd ports** comes a long way third. A normal outbound rule matches on destination port, so a fixed source port of 1812 doesn't break anything by itself.
- **EAP-TLS fragmentation.** Certificates are big and a WAN path can drop fragments. But that fails partway through, after challenges have already come back. It doesn't cause silence from the very first packet. The poster already had the fragment size set, which tells you something.

Why the APs worked: not the random ports. Their traffic matched a NAT rule whose public IP the service knew. If they're Instant APs with dynamic RADIUS proxy, all of it comes from the virtual controller IP anyway.

One caveat. I couldn't confirm from that service's public docs whether it filters on source IP at all or keys only on its per-organization ports and the secret. That part is my own read, and I'll flag it as mine rather than the vendor's. If it doesn't filter on IP, the secret is your suspect. The test below finds either one.

## What good looks like

The rule: every NAS reaches the RADIUS server from one source IP you picked on purpose, and that IP (or the IP it NATs to) is registered on the server with the secret. Never let the switch use whichever VLAN happens to route toward the server. HPE's AOS-Switch guide says it more politely: the source IP is how the server identifies the client, and a switch with several routed interfaces can show up with a different one depending on the path.

The source IP is the only source setting you control. Stop trying to control the port.

With cloud RADIUS the client entry is the public IP after NAT, so the fix is often a NAT rule, not a switch command. Send the switch out the same egress as the APs, or register the second public IP.

The other reply in that thread said to lock the RADIUS server down to known source IPs. Good advice. It's exactly what the cloud service was already doing to the switch.

The server isn't being rude. It's following an RFC from June 2000 that says don't talk to strangers.

## Platform specifics

**Aruba CX.** Server with key, ports and VRF, then the source IP in the same VRF:

```
radius-server host 203.0.113.50 key plaintext <SECRET> port <AUTH-PORT> acct-port <ACCT-PORT> vrf <VRF-NAME>
ip source-interface radius 192.0.2.1 vrf <VRF-NAME>
```

Gotcha: the source setting only applies to the VRF you name, and to default if you name none. Server in mgmt, source in default, and the request leaves with whatever address mgmt has, which usually has no NAT rule. My own read on the NAT part, but match the VRFs and it can't bite you.

**AOS-Switch**, the platform in the thread:

```
interface loopback 1
   ip address 192.0.2.1
ip source-interface radius loopback 1
radius-server host 203.0.113.50 key <SECRET> auth-port <AUTH-PORT> acct-port <ACCT-PORT>
```

The guide defines auth-port and acct-port as UDP destination ports, defaulting to 1812 and 1813. There's no source port option, fixed or random. The poster's firewall showed 1812 as the source, and I've never found a command that changes it.

- `aaa server-group radius` on its own does nothing that I've seen unless an auth method names it with `server-group <name>`. In that config the host was also in the global list, and that's what 802.1X was using. My read; check `show radius host` counters.
- `cached-reauth` only covers reauthentication for clients that already passed. It can't hide a first-auth failure. It can make a dead server look alive to everyone already on the network.
- `aaa port-access authenticator eap-tls-fragment towards-server` takes 576 to 3072 bytes and only changes what goes to the server. Unset, the switch fragments only above 3 KB. Lower it when EAP-TLS stalls after challenges start coming back. It isn't a timeout fix.

**AOS-8 and Instant.** The APs in the thread sourced from high ports. Cosmetic. Instant with dynamic RADIUS proxy sends everything from the virtual controller IP (or the DRP IP you set), so that's the one address to register.

**Junos EX.** `set access radius-server 203.0.113.50 source-address 192.0.2.1`. Same rule, set it on purpose.

## Test it or it doesn't count

- **Firewall first.** Filter on the service's auth port and read the post-NAT source IP. On Sophos, open the detailed view and read `src_trans_ip`. The standard view can show the default masquerade address even when a custom NAT rule was used. Compare it character by character with the registered client. If it doesn't match, you're done diagnosing.
- **On the switch.** `show radius authentication` on AOS-Switch, `show radius-server statistics authentication` on CX. Challenges or rejects coming back mean the server is talking to you. A reject is good news at this stage. What's left is policy.
- **Timeouts climbing, zero replies.** Wrong IP or wrong secret, and the counters can't tell you which. Fix the IP first, because it's the one you can see. If it still times out from a registered IP, delete the secret on both sides and type it again. Don't eyeball it.
- **Bad authenticators.** A reply came back and didn't verify, so the switch threw it away. That's a secret mismatch you can see. Rare with EAP, because the server usually drops it first.

What broken looks like: timeouts, a clean permit in the firewall log and nothing in the server log. That's the thread's exact symptom. In my experience it has always been the client registration.

## Checklist

| Step | Where | What good looks like |
|---|---|---|
| Loopback and `ip source-interface radius` set | Switch | Every RADIUS packet leaves from one address you chose |
| NAT rule for that source IP identified | Firewall | You can name the public IP it becomes |
| Public IP registered as a client | RADIUS service | Exact match to the translated source |
| Secret re-entered on both sides | Switch and service | Typed fresh, not copied from an old config |
| UDP permitted to auth and accounting ports | Firewall | Rule matches on destination port |
| Request and reply both in the log | Firewall | Two flows, one each way |
| Counters moving | Switch | Challenges, accepts or rejects, no timeouts |
| Fragment size | Switch | Changed only if EAP-TLS stalls mid-exchange |

## Bottom line

A timeout means the request left and nobody answered. Fix the source IP, then the secret, then look at the firewall. There's no source port knob on AOS-Switch, and you don't need one.

What changed in my base config: every AOS-Switch and CX build gets a loopback and `ip source-interface radius` before the first `radius-server host` line. The build sheet records the post-NAT IP next to the secret, so whoever registers the client isn't guessing.
