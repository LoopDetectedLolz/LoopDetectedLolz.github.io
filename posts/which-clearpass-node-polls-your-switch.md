---
title: Which ClearPass Node Is Actually Polling Your Switch
slug: which-clearpass-node-polls-your-switch
date: 2026-09-15
tags: ClearPass, Security, AOS-CX
hero: hero-snmp-node.svg
summary: SNMP reads do not come from the publisher. They come from whichever node the cluster decides to use, which matters the moment you write a firewall rule or a control plane ACL that names one address. Here is how to prove which node is sending, and why ARP polling is the only thing that classifies a static device behind a firewall before it authenticates.
origin: Building authentication services in the lab and finding the SNMP poll arriving from the subscriber
series: ClearPass, properly
series_order: 3
---

I built a two node cluster, registered a switch as a network device, ticked Allow SNMP Read, and then went looking for the traffic. I expected it from the publisher. That is the node I log into, the node that holds the configuration, the node every diagram puts in the middle.

It was not the publisher.

If you have ever written a firewall rule or a control plane ACL that permits SNMP from your ClearPass address, singular, this post is for you. The rule works, the polling works, and then one day you add a subscriber or fail over and half your endpoints stop getting classified for reasons nobody can find.

## Why the SNMP read is worth defending in the first place

Most people treat SNMP read on a network device as an optional extra that fills in a port description somewhere. It is doing more than that, and it matters most in exactly the place it is easiest to forget: a segment sitting behind a firewall.

Here is the case I keep running into. A group of devices lives on a VLAN behind a FortiGate. They are statically addressed because somebody decided years ago that printers, cameras and controllers should not move. They speak when spoken to. And they will eventually hit a MAC authentication service on ClearPass, at which point ClearPass has to decide what they are.

Without SNMP, here is what ClearPass knows about that device before the first authentication request arrives: nothing.

It has no DHCP fingerprint, because the device never asks for a lease. This is the part people try to solve with an IP helper pointed at ClearPass, and it is the right instinct on a normal subnet. It does nothing here. There is no DHCP conversation to relay. You cannot forward a packet that was never sent.

It has no active scan result either, because an active scan needs a target address, and ClearPass has no reason to believe that address exists or belongs to anything on your network.

{{figure: fig-profile-sources.svg | What Profiler knows about a statically addressed device behind a firewall, with SNMP ARP polling and without it. The DHCP column is empty either way.}}

SNMP ARP polling is what breaks that deadlock. ClearPass reads the ARP table off the layer 3 gateway for that VLAN, which is the one device on the network that is guaranteed to have seen the endpoint's MAC and IP together. That single binding is the hinge. Once ClearPass has it, the endpoint record exists, the IP is attached to the MAC, and everything else Profiler can do has somewhere to point.

The reason this is better than profiling after the fact is timing. The ARP read happens on a poll cycle, on its own, with no client involvement. By the time the device sends its first MAC authentication request, ClearPass already has a device category on the endpoint and your enforcement policy can match it on the first attempt. The alternative is a policy that has to reject or under-authorise the device once, profile it, and then wait for a re-auth to put it where it belongs. That works on a laptop that retries in seconds. It does not work on a controller that gives up and needs a site visit.

## The wrong assumption

The ARP read is worth protecting, so people protect it, and they protect it with a rule naming the publisher. That is the mistake.

SNMP read is not a publisher function. The node that performs it is chosen by the **Policy Manager Zone**, which is a field on two different pages that nobody checks together.

Every cluster node has a zone, under Administration, Server Manager, Server Configuration, the node, System tab. Every network device also has a zone, under Configuration, Network, Devices, the device, SNMP Read Settings tab. The zone is the thing that says "these nodes talk to that gear", and it exists precisely so a node in one data centre does not poll a switch in another.

In my lab both nodes sat in Zone 1. The switch sat in `default`. Three zones existed and one of them had no servers in it at all.

{{figure: fig-zone-mismatch.svg | The two places the zone is set, and what it looks like when they disagree. Nothing in the interface objects.}}

Nothing warns you. There is no red text, no validation on save, no event. The polling keeps happening, which is why it takes months to notice, and the node it comes from is not the one you assumed.

So the checklist is short, and you do it before you touch a firewall:

1. Read the zone on every node. Server Configuration lists it in a column, so this is one screen.
2. Read the zone on the network device. Different page, different tab.
3. If they do not match, that is your finding. Fix the device to match the zone your nodes are in rather than inventing a new zone.

While you are in there, note that `Device Info Poll Interval` lives in Service Parameters on **each node**, under ClearPass network services, not in Cluster-Wide Parameters. A cluster wide behaviour configured per node is exactly the kind of thing that hides a discrepancy for a year.

## Proving it from the switch

Zones tell you what should happen. A counter tells you what did. On AOS-CX the cheapest proof is a control plane ACL that permits what is already permitted and counts it on the way through.

Two things before you paste this. Rule 30 is not optional, because an ACL ends in an implicit deny and a control plane ACL without a trailing permit will take the box away from you. And check which VRF your management session is on. If you manage the switch out of band on the `mgmt` VRF and the SNMP poll arrives on an SVI in `default`, the two never touch each other, which is the safest way to run this.

```term
sw-lab-01# configure
sw-lab-01(config)# access-list ip CPPM-SNMP-WATCH
sw-lab-01(config-acl-ip)#   10 permit udp 10.100.0.51/32 any eq 161 count
sw-lab-01(config-acl-ip)#   20 permit udp 10.100.0.52/32 any eq 161 count
sw-lab-01(config-acl-ip)#   30 permit any any any count
sw-lab-01(config-acl-ip)# exit
sw-lab-01(config)# apply access-list ip CPPM-SNMP-WATCH control-plane vrf default
```

Clear the counters, wait out one poll interval, and read them back.

```term
sw-lab-01# clear access-list hitcounts ip CPPM-SNMP-WATCH control-plane vrf default
sw-lab-01# show access-list hitcounts ip CPPM-SNMP-WATCH control-plane vrf default

Statistics for ACL CPPM-SNMP-WATCH (ipv4):
  Control Plane (vrf default):

           Hit Count  Configuration
                   0    10 permit udp 10.100.0.51/32 any eq 161 count
                  48    20 permit udp 10.100.0.52/32 any eq 161 count  <<
               11207    30 permit any any any count
```

That is the whole answer in one screen. Rule 10 is the publisher and it never fired. The polling came from the subscriber, and an ACL that had named only `10.100.0.51` would have dropped every one of those packets.

Take it off when you are done. It costs nothing to leave, but a counting ACL on the control plane is not something to forget about.

```term
sw-lab-01# configure
sw-lab-01(config)# no apply access-list ip CPPM-SNMP-WATCH control-plane vrf default
sw-lab-01(config)# no access-list ip CPPM-SNMP-WATCH
```

The numbers above are illustrative rather than a transcript of one run. The pattern is the point: one rule at zero, the other one climbing, and it is not the rule you expected.

If you would rather not touch the control plane at all, mirror the uplink to a laptop and filter on `udp port 161`. Slower to set up, same answer, no chance of locking yourself out.

## Proving it from ClearPass

Do it from both ends, because two independent sources agreeing is what turns a finding into something you can put in a design document.

A capture on each node, filtered to the conversation, tells you which one is talking:

```term
udp port 161 and host 10.201.13.250
```

Run it on the publisher and on every subscriber at the same time, for longer than one poll interval. The node that produces output is your answer, and if you only ever capture on the publisher you will conclude, wrongly, that SNMP polling is broken.

One thing that trips people up on the way: the Event Viewer has a **Select Server** dropdown at the top right, and it defaults to whichever node you logged into. Logs are per node. Looking at the publisher and seeing nothing is not evidence that nothing happened.

## Use SNMPv3, and make both ends agree

If you are going to send credentials to every access switch in the estate on a timer, do not send a v2c community string. SNMPv3 with authentication and privacy is not more work, it is the same work in more fields.

On the switch:

```term
sw-lab-01(config)# snmpv3 user cpsnmp auth sha auth-pass plaintext <auth-passphrase> priv aes priv-pass plaintext <priv-passphrase>
sw-lab-01(config)# snmp-server vrf default
sw-lab-01(config)# exit
sw-lab-01# show snmpv3 users
```

On ClearPass, the matching side is Configuration, Network, Devices, the device, SNMP Read Settings. Set the read setting to SNMP v3 with Authentication using SHA and with Privacy, the privacy protocol to AES_128, and the username to the one you just created. Then tick **Read ARP table from this device**, which is the checkbox that does the work described at the top of this post and is off by default.

Three ways this fails quietly, in the order I hit them:

The authentication protocol and privacy protocol have to match exactly on both ends. SHA against MD5, or AES against DES, fails as a timeout rather than as an authentication error, so it reads like a reachability problem.

The SNMP agent has to be enabled on the VRF the poll arrives on. A user that exists on a switch with no agent on that VRF is a user that never answers.

And the zone has to match, which is where this post started.

## What right looks like

Permit every node in the cluster, not the one you log into. Set the device zone to the zone your nodes actually live in. Tick the ARP checkbox. Then spend ten minutes with a counting ACL to prove that the packets arrive from where you think they do, because the alternative is finding out during a cutover, from a printer.
