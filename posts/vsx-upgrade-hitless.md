---
title: Your VSX Upgrade Is Hitless Right Up Until It Isn't
slug: vsx-upgrade-hitless
date: 2026-09-04
tags: Switching, AOS-CX, VSX
hero: hero-vsx.svg
summary: Everybody has heard a VSX upgrade is hitless. Almost nobody has been told what hitless is conditional on. It's a single cable and a 180 second timer.
origin: A 6405 pair, a 6410 pair watching BGP drop, and a Central live-update question, all in one week
series: Switching, carefully
series_order: 1
---
Three different people asked me about VSX upgrades inside of about a week. One wanted to know how to get a 6405 pair to a new build without an outage. One had already run the upgrade on a pair of 6410s and watched BGP drop on holdtimer expiry both times a member rebooted. One was working through doing the whole thing from Central.

That's usually the signal that something isn't written down anywhere useful. Everybody has heard that a VSX upgrade is hitless. Almost nobody has been told what "hitless" is conditional on, and it turns out it's conditional on quite a lot.

## What the orchestrated upgrade actually does for you

The command is `vsx update-software`, and it's worth knowing what it's doing on your behalf instead of treating it as a magic word.

```
vsx update-software tftp://<SERVER>/<IMAGE> [vrf <VRF-NAME>]
vsx update-software boot-bank {primary | secondary}
```

The first form pulls the image down over TFTP (that's the only transport the command reference documents), verifies it, installs it to the non-active bank on both members, and then reboots them one at a time: secondary first, primary second. It'll offer to save your running config on the way past. Say yes.

The boot-bank form doesn't download anything. You stage the image into that bank on both members yourself, then this command checks the versions match and runs the same sequenced reboot. It's the one to use when the window is tight or a TFTP transfer through the management VRF would eat half of it.

That sequencing is the entire trick. While one member is down, the other one is supposed to be carrying everything. The upgrade isn't hitless because the software is clever. It's hitless because half your network keeps forwarding while the other half reboots, and that only works if traffic actually has a second path.

## The thing that will bite you is a single cable

Here's the part nobody says out loud. **Every device hanging off that VSX pair by one link is an outage waiting for its turn.** Not a risk. An outage. When the member it's plugged into reboots, that device is gone for the length of a reboot, and no upgrade method on earth fixes it because there's nowhere else for its traffic to go.

Dual-homed gear rides it out. Orphan ports don't. So before you touch anything, the real pre-check isn't a command, it's a walk through your port map asking which downstream boxes only have one leg. Firewalls, load balancers, that one out-of-band appliance somebody installed in a hurry. It's always the appliance somebody installed in a hurry.

If you find single-homed devices and you can't fix the cabling before the window, at least know their names in advance so you're not diagnosing them live at 2am. Because it will pick 2am.

## The timer nobody configures

This is the one that explains the weird multi-minute outages.

When a member reboots, the ISL and the keepalive both go down, and the surviving member keeps its VSX LAG links up no matter which role it holds. So far so good, the survivor carries everything. Then the rebooted member comes back, the ISL re-forms, it syncs its MAC and ARP tables from the peer, and **only after a delay timer expires do its VSX LAG links come back up.**

(Don't confuse that with the ISL-only failure, where the keepalive stays up and the secondary deliberately drops its VSX LAGs. That's split-brain protection, and it's a different event from a reboot. The docs walk both cases under "Keepalive resolution and ISL failure scenarios" if you want the full table.)

That timer is `linkup-delay-timer`, it lives in the VSX context, and the default is 180 seconds. Max is 600.

```
linkup-delay-timer <DELAY-TIMER>
linkup-delay-timer exclude lag-list <LAG-LIST>
```

The reason it exists is good: the returning switch needs time to push learned entries into the ASIC and rebuild its adjacencies. Bring those ports up early and the switch happily accepts traffic it has no idea what to do with, and drops it. Late is better than black-holed.

The reason it hurts is that 180 seconds is a long time to a BGP holdtimer. If you're watching peerings expire and re-form "after a few minutes," go look at this timer before you go looking for a defect. Three minutes is a suspiciously round number.

And note that second line, because I think it's the most useful command in this whole post and I almost never see it configured. `linkup-delay-timer exclude lag-list` lets you pull specific LAGs out of the delay so your upstream routed links come up immediately and start forming adjacencies, while your downstream access LAGs still wait for the tables to populate. That's the knob for "I need my core adjacency back now, the access layer can wait." Very friendly of it.

Two caveats from the same doc page. While the timer runs, every SVI that contains a VSX LAG member is held in a pseudo-shutdown state, so don't expect routing on those VLANs to come back early just because the physical link did. And the docs say OSPFv2 and v3 will form neighborships during the delay even without the exclusion, provided active-forwarding is enabled on the VLAN. They say nothing about BGP getting the same treatment, so for eBGP to a firewall the exclusion is the documented path.

## The dual management module question

If your 6400s have two management modules per chassis, the orchestration doesn't change. Secondary still goes first, primary still goes second. What changes is what your redundancy looks like during the run.

The command reference lists no dual-MM caveat for `vsx update-software`, and it always writes to the non-active bank, which is the safe one. My own read, and I'll flag it as mine rather than HPE's: writing into the currently active bank costs you the standby module's known-good copy until the next reboot. Whether or not you buy that, writing to the non-active bank is what the orchestrated command does anyway, and it's a good reason not to hand-roll the upgrade with `boot system` just because you've always done it that way.

Two management modules is also the prerequisite for ISSU on the 6400, which is a different upgrade path entirely: control plane failover instead of a chassis reboot. It's limited to upgrades between minor releases, it's blocked if MACsec is enabled on any port, and in a VSX pair HPE says run it on one member at a time. Worth knowing it exists before you decide which window you need.

Run `show images` on both members first so you actually know which bank is live before you start. Takes ten seconds and saves an argument later.

## Check these before you push it

Three commands, and they're not optional.

`show vsx brief` gives you ISL state, device state, keepalive state, device role and the multichassis LAG count. You want the ISL in sync and the keepalive established. If either one is unhappy right now, upgrading is going to make it considerably less happy.

`show vsx status` gives you the ISL channel, config sync status, system MAC, platform and software version per member. Mostly you're using it to confirm both sides agree about what they're running before you change what they're running. `show vsx status linkup-delay` prints the configured timer, whether it's running, time left, and which LAGs are excluded, which is the fastest way to answer the timer question from the last section.

`show lacp interfaces multi-chassis` is the one HPE's own pre-check list calls for and most people skip. It's also the mechanical version of the port-map walk: anything whose members all land on one chassis is an orphan. Note which interfaces are forwarding before you start so you have something to diff against afterward.

If you've got loop protect turned on, confirm the action is set to TX disable (`show loop-protect`, and `loop-protect action tx-disable` on the VSX interface if it isn't). And save the config. I shouldn't have to say that one.

## Checklist before the window

| Check | Command or action | What you want to see |
|---|---|---|
| Single-homed devices | Walk the port map | Nothing critical on one leg |
| ISL health | `show vsx brief` | ISL in sync |
| Orphan LAGs | `show lacp interfaces multi-chassis` | Nothing critical with members on one chassis only |
| Keepalive | `show vsx brief` | Keepalive established |
| Both members agree on version | `show vsx status` | Same running version |
| Which bank is live | `show images` | You know before you write |
| Loop protect action | Running config | TX disable |
| Link-up delay | `show vsx status linkup-delay` | Known value, not a surprise |
| Upstream LAGs excluded | `linkup-delay-timer exclude lag-list` | Core adjacencies not waiting 180s |
| Config saved | `write memory` | Done |
| BGP or OSPF timers | Neighbor config | Holdtime you can live with |

## Bottom line

A VSX upgrade is hitless for anything with two legs and an outage for anything with one. The orchestration handles the sequencing, the link-up delay handles the tables, and neither of them can invent a redundant path you didn't build.

So before the next window, go find your orphan ports and go look at your link-up delay timer. Those two things account for basically every "the upgrade was supposed to be seamless" conversation I've had this year.
