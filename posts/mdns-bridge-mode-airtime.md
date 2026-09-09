---
title: 84 Percent of Your Airtime Is Printers Saying Hello
slug: mdns-bridge-mode-airtime
date: 2026-08-02
tags: Wireless, AOS-8, Multicast
hero: hero-mdns.svg
summary: Someone counted. 269,253 mDNS frames in under six minutes, 84 percent of an uplink, and every one of them going out over the air at 6 Mbps. Here's the math nobody does.
origin: An Airheads thread where the poster did the isolation test most people skip
---
## Why I'm writing this

Somebody posted a wireless performance problem on Airheads last week that I want to walk through, because the shape of it comes up constantly and almost nobody gets it right the first time.

The setup: a 7030 on AOS 8.10, AP-515s, bridge mode SSID, clients on VLAN 20, no PEF license. Users complaining about throughput, ping spikes, and packet loss. Worst first thing in the morning when everyone badges in, gradually improving through the day. 5 GHz channel utilization sitting between 50 and 80 percent. Every AP on a different channel, so it wasn't co-channel interference.

Then he did something most people skip. He built an isolated test switch with one uplink and one AP port, hung a MAC ACL on it, and counted. In five minutes and 52 seconds that uplink carried 141,291 IPv4 mDNS frames and 127,962 IPv6 mDNS frames. Call it 269,253 frames, about 765 packets per second, and by his count 84 percent of the frames crossing the link.

Every one of those frames was being put on the air by every AP in VLAN 20.

One scoping note up front, because I got this wrong the first time I wrote it up. Everything below about the controller being unable to help is specific to **AOS-8 controller-managed** bridge mode. AOS-10 with Central behaves differently, and I cover that in its own section further down.

## The math nobody does

Here's the part I think people skip, and it's the part that makes this lethal.

Broadcast and multicast go out at the lowest configured basic rate. No acknowledgment, no block ack, no aggregation, no rate adaptation. One frame, one shot, at whatever the slowest mandatory rate on that radio happens to be.

On 5 GHz the AOS-8 default for `a-basic-rates` includes 6 Mbps, so that's the rate. A 300 byte mDNS frame at 6 Mbps is roughly 424 microseconds of actual transmission. Add DIFS and average backoff and you're at about 525 microseconds of medium time per frame.

Multiply by 765 frames per second.

| 5 GHz basic rate | Medium time per frame | Channel consumed at 765 pps |
|---|---|---|
| 6 Mbps (the default) | ~525 us | **~40%** |
| 12 Mbps | ~325 us | ~25% |
| 24 Mbps | ~225 us | ~17% |

Forty percent of the channel gone before a single client transmits anything. That's why 50 to 80 percent utilization can look survivable on a graph and feel awful to the people using it. Utilization tells you the medium is busy. It doesn't tell you the medium is busy doing something useless.

And if you're still running 2.4 GHz with the default `g-basic-rates` of 1 and 2 Mbps, the same traffic needs roughly 3 milliseconds per frame. At 765 pps that works out to 2.3 seconds of airtime for every second of wall clock. The radio does not have 2.3 seconds. It just drops things.

The morning peak makes sense once you see it this way. That's when laptops boot and start announcing themselves.

## On AOS-8, bridge mode is why your controller can't help

In tunnel mode the controller sits in the data path and you have options: broadcast-filter on the virtual AP, DMO, `bcmc-optimization` on the VLAN interface, AirGroup.

In bridge mode the AP handles association, encryption, and firewall enforcement locally, then bridges the VAP straight onto its own Ethernet segment. Wired VLAN traffic arrives at the AP's switchport and goes out over the BSS. The controller sees almost none of it (the docs say "most" data traffic stays local to the AP, and for this problem "most" is all of it). The AOS-8 docs say this outright, and it's the sentence I wish more people had read: in bridge forwarding mode the managed device isn't able to filter out that broadcast traffic.

Which means the two settings everybody reaches for are the wrong ones.

**Drop Broadcast and Multicast** is `broadcast-filter all` in the virtual-ap profile, not the SSID profile, and the documentation specifically tells you not to use it on bridge mode VAPs, because the filtering happens on a box that isn't in the path. Same story for Convert Broadcast ARP Requests to Unicast.

**DMO** is the other reflex, and here I'll correct something I got wrong in an earlier version of this. On AOS-8 it needs PEFNG, so people assume the license is the blocker and go get a quote. I used to say the docs were silent on whether DMO works in bridge mode. They aren't. The AOS-8 user guide's mode-support table, under Behavior and Defaults, lists DMO by name as supported in bridge mode, right alongside AirGroup, broadcast filter and rate limiting. So DMO is on the table in bridge mode if you have PEF. Whether it helps with this specific mDNS flood is a different question, because it converts multicast to unicast per subscribed client rather than filtering, and mDNS has no proper group membership to speak of. If you already have PEF, test it. If you'd be buying it specifically for this, test it in a lab first.

## What AOS-10 and Central change

If you're on AOS-10 with Central, most of the above doesn't apply to you, and it's worth understanding why, because this is a different architecture rather than a feature bump.

AOS-10 inherited its broadcast handling from the InstantOS line, not the controller line, and the AP does the filtering. The design guide is unambiguous about what that means: all filtering and optimization options configured in a WLAN profile apply to all forwarding modes. So on a bridge-mode AOS-10 SSID you have broadcast filtering with the usual All, ARP, Unicast-ARP-Only and Disabled values, ARP unicast conversion, IPv6 RA and ND conversion, minimum transmit data rates, Multicast Transmission Optimization, DMO and AirGroup. In classic Central they sit under the SSID's General tab, Advanced Settings, in the Broadcast/Multicast block. In New Central they ride the Network Configuration preset, and you pick Custom to get at the raw control.

The only piece that's genuinely tunnel-only in AOS-10 is the gateway-side broadcast and multicast optimization applied per user VLAN, and that's tunnel-only by definition since bridge mode has no gateway in the path. In bridge mode that job belongs to the access switch, which is where we ended up anyway.

Two things to know before you go turn DMO on. Enabling it forwards mDNS and SSDP as unicast regardless of your broadcast filter setting, so DMO without AirGroup can reopen the exact firehose you were trying to close. And check what your profile actually has rather than assuming the default. The Instant CLI reference, classic Central and the design guide all say `broadcast-filter` defaults to ARP, but the New Central "Most Compatible" network preset turns it off, so two SSIDs built a month apart can disagree.

## IGMP snooping won't save you either

This is the one that catches experienced people, so it's worth being precise about.

mDNS is 224.0.0.251. LLMNR is 224.0.0.252. Both live in 224.0.0.0/24, the link-local control block, which switches flood by design and never constrain through snooping. That isn't a bug or a vendor gap, it's the entire point of that range. It also carries OSPF hellos on 224.0.0.5 and .6, VRRP on 224.0.0.18, HSRP, and IGMP itself on 224.0.0.1 and .2. A switch that suppressed 224.0.0.0/24 based on group membership would take your routing protocols down with it.

IPv6 mDNS at ff02::fb is the same story for MLD snooping. SSDP and WS-Discovery at 239.255.255.250 are technically snoopable, but almost nothing joins the group properly, so in practice they flood too.

Turn IGMP snooping on anyway. It's the right thing for real application multicast. Just don't expect it to touch your top talkers.

## What good looks like

Filter the specific noisy groups on the wired side, as close to the AP as you can get, and raise your basic rates so whatever survives costs less airtime. That's the whole design.

The thing to be careful about is scope. Do not drop 224.0.0.0/24 or the whole `0100.5e00.0000` MAC range wholesale, for the reasons above. Name the groups you want gone:

| Protocol | IPv4 group | Multicast MAC | What it does |
|---|---|---|---|
| mDNS | 224.0.0.251 | 0100-5e00-00fb | Bonjour, AirPrint, Chromecast |
| mDNS v6 | ff02::fb | 3333-0000-00fb | Same, IPv6 side |
| LLMNR | 224.0.0.252 | 0100-5e00-00fc | Windows name resolution fallback |
| SSDP / WS-Discovery | 239.255.255.250 | 0100-5e7f-fffa | WSD printers and scanners, DLNA |

## The wired side

The original poster was on Comware, and this is the ACL he proved it with. Worth keeping as a reference because it's short and it works:

```
acl mac 4000
 rule 10 deny dest-mac 0100-5e00-00fb ffff-ffff-ffff counting
 rule 20 deny dest-mac 3333-0000-00fb ffff-ffff-ffff counting
 rule 100 permit counting
```

That's Comware 7 syntax. On Comware 5 it's `acl number 4000` in Ethernet frame header ACL view and there's no `counting` keyword. Apply it with `packet-filter mac 4000 inbound` on the uplink toward the access layer, or outbound on the AP-facing ports. Check it with `display packet-filter statistics interface <intf> inbound`. Comware also gives you per-port `multicast-suppression` and `broadcast-suppression` as a pps safety net for whatever you didn't explicitly match.

On AOS-CX I'd do it with an IP ACL instead, since it's more readable six months later:

```
access-list ip MCAST-CHATTER
    10 deny udp any 224.0.0.251/255.255.255.255 eq 5353 count
    20 deny udp any 224.0.0.252/255.255.255.255 eq 5355 count
    30 deny udp any 239.255.255.250/255.255.255.255 eq 1900 count
    40 deny udp any 239.255.255.250/255.255.255.255 eq 3702 count
    50 permit any any any
```

Sequence 50, `permit any any any`, is not optional. Same rule as any other ACL: leave it off and the implicit deny at the end takes everything with it. The `count` keyword on the deny entries is what makes this maintainable, because `show access-list hitcounts` then tells you exactly how much you're dropping and whether it's still worth having.

Apply it on the AP-facing port:

```
interface 1/1/10
    apply access-list ip MCAST-CHATTER out
```

One platform caveat: egress ACLs on a layer 2 port work on the 6300, 6400, 8100 and 8360. On the 8325, 9300 and 10000 the docs only allow egress IPv4 ACLs on routed ports, and applying one to a layer 2 interface errors out. On those boxes apply it inbound on the uplink instead.

IPv6 mDNS needs its own IPv6 ACL on CX, or a MAC ACL if you'd rather do both in one place. CX MAC ACLs use dot notation and the ethertype field is mandatory, so the entry looks like `10 deny any 3333.0000.00fb any count`.

On the Juniper side the same job is a `family ethernet-switching` filter with a term per group, count and discard on each, and a final term that accepts everything else. The shape is identical, only the syntax changes. Check the term options on your Junos version before you paste, because what you can match on in an ethernet-switching filter varies more than you'd like.

## The wireless side, such as it is

On AOS-8 you have one lever in bridge mode and it's your basic rates:

```
wlan ssid-profile CORP
   a-basic-rates 12 24
```

The default is 6, 12, and 24, so multicast is going out at 6. Moving the floor to 12 halves the airtime per frame and 24 quarters it. Do the same on 2.4 GHz if you still have it, where the default of 1 and 2 Mbps is dramatically worse.

The cost is cell edge. Clients that can't hold 12 Mbps drop off, which at normal campus AP density is usually fine and occasionally isn't. Survey before you do it in a warehouse.

One thing to leave alone: `mcast-rate-opt`. The CLI reference says not to enable it unless support tells you to, and says the default is disabled; the user guide doesn't state a default at all. Check `show wlan ssid-profile <name>` on the actual box rather than trusting either.

## What breaks when you do this

Be honest with yourself about this list before you push it, because these are all things users notice:

AirPrint and Bonjour printer discovery. Chromecast and AirPlay. WSD printer and scanner discovery. DLNA. The Network view in Windows Explorer.

If any of those actually matter in the environment, the clean answer on AOS-8 is AirGroup, which needs tunnel or decrypt-tunnel mode (the docs rule out split-tunnel too). On AOS-10 it's a different story again: AirGroup runs on each AP rather than the gateway, so it works in bridge mode as long as the server VLANs are trunked to the AP switchports. Which brings us to the strategic version of this problem: if you're running bridge mode mainly because that's how it was built five years ago, moving to tunnel or decrypt-tunnel puts the controller back in the path and hands you broadcast-filter, DMO, `bcmc-optimization` on the SVI, and AirGroup all at once. Check controller capacity against your AP and client count first, obviously.

## Test it or it doesn't count

Do the isolation test before you touch production, the same way the original poster did. One switch, one uplink, one AP, and a counter. It takes twenty minutes and it turns an argument into a number.

The direction matters and it's the actual diagnostic:

Block multicast inbound on the uplink and if performance improves, the noise is coming from the wired network. Block it inbound from the AP port and if nothing changes, your wireless clients aren't the source. That combination is the whole diagnosis, and it's why I could tell this poster his read was right rather than guessing with him.

For the wireless side, capture at the AP's own wired port, not on the controller. In bridge mode the controller has nothing to show you:

```
ap packet-capture open-port <port>
ap packet-capture wired-start ap-name <ap> <your-pc-ip> <port>
show ap packet-capture status ap-name <ap>
ap packet-capture stop ap-name <ap> <pcap-id>
```

And the supporting show commands:

```
show wlan virtual-ap <vap-profile>
show wlan ssid-profile <ssid-profile>
show ap arm rf-summary ap-name <ap>
show ap debug radio-stats ap-name <ap> radio 0 advanced
show ap debug datapath ap-name <ap>
show ap debug bss-stats ap-name <ap>
```

Radio 0 is 5 GHz on an AP-515 in every one I've touched, but the docs don't pin radio index to band, so confirm with `show ap radio-summary ap-name <ap>` before you read the wrong stats.

## Checklist

| Step | Why |
|---|---|
| Count before you fix | A MAC ACL with `count` on an isolated switch turns opinion into pps |
| Test filter direction both ways | Proves wired versus wireless source, which is the actual diagnosis |
| Name specific groups | Dropping 224.0.0.0/24 wholesale takes OSPF, VRRP and IGMP with it |
| Keep the final permit | Same trap as every other ACL, and you'll find it the hard way |
| Put `count` on every deny | Six months from now you'll want to know if the rule still earns its place |
| Raise `a-basic-rates` to 12 | Halves the cost of whatever multicast survives the filter |
| Survey cell edge after | Raising basic rates shrinks coverage, usually fine, occasionally not |
| Write down what you broke | AirPrint and Chromecast disappearing needs to be a decision, not a surprise |
| Ask why it's bridge mode | If there's no good reason, tunnel mode gives you real tools |

## Bottom line

Bridge mode SSIDs on AOS-8 are a blind spot. Everything we're used to reaching for lives on the controller, and in bridge mode the controller isn't in the path, so the levers are on the switch and in your basic rates instead. On AOS-10 that flips, because the AP does the filtering and bridge mode stops being a limitation. Meanwhile a few hundred Windows machines announcing themselves can eat close to half a channel without anything showing up as an error anywhere.

The diagnostic is cheap. One isolated switch, one ACL with counters, twenty minutes. If you're chasing a wireless performance problem that gets worse when more people show up and better as the day goes on, count your multicast before you start moving channels around.

If you hit one of these and want a second set of eyes, get in touch and we'll figure it out.
