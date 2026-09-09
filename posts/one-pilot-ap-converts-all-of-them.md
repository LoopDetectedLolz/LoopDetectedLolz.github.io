---
title: One Pilot AP Converts All Hundred of Them
slug: one-pilot-ap-converts-all-of-them
date: 2026-09-05
tags: Wireless, Instant, AOS-8, Migration
hero: hero-iap.svg
summary: Someone with a hundred Instant APs on AirWave wanted to move them to a controller cluster and, sensibly, test on one AP first. The virtual controller had other plans.
origin: An Airheads migration plan that would have converted the whole cluster at once
---

## Why I'm writing this

Somebody posted a migration plan on the forums last week that was about ninety percent right, and the ten percent would have taken a warehouse down in the middle of a shift.

The setup: around a hundred Instant APs in one cluster, managed through AirWave, on a 10.x management subnet. They were being redeployed to a new environment with three 9000-series gateways under a Mobility Conductor, on a 172.x subnet, with no routing between the two. (Check the per-node AP limit before you size a cluster like that. A 9012 tops out at 64 campus or remote APs on AOS 8.12 and later, and 32 below that, so three of them don't hold a hundred APs on 8.11, never mind with one node down.) The plan was to move the APs to the new VLAN, let them lose AirWave, confirm the cluster kept running, then convert one AP to Campus AP mode as a pilot before touching the rest.

Reasonable. Careful, even. And it has a trap in it that isn't obvious unless you've watched it happen.

## AirWave isn't the thing holding the cluster together

First, the part the poster had right, because it's worth saying clearly. AirWave is management and monitoring. It is not a control plane. When the APs move to a subnet that can't reach it, the Instant cluster keeps doing exactly what it was doing: the virtual controller keeps its election, the SSIDs stay up, clients keep roaming. Nothing about the cluster's operation depends on AirWave being reachable.

You don't even have to strip the AirWave config out before the move. It's tidier to clear it afterwards so the APs stop retrying a server they'll never see again, but it isn't a prerequisite.

So far so good. Here's where it goes sideways.

## Conversion is a cluster decision, not an AP decision

When you convert an Instant AP to a Campus AP, you aren't talking to that AP. You're talking to the virtual controller, and the virtual controller sends the convert command to every member of the cluster. Every one. HPE's own wording, from the AOS 8.3 conversion page: "the virtual controller sends the convert command to all the other Instant APs." The AP you picked as your pilot is just the one whose web UI you happened to be logged into.

Here's the part that bugs me. The current Instant user guide dropped that sentence from the Campus AP page. It's a bare five-step procedure now. The Remote AP page next to it still carries the warning. So the one page people actually read for this job is the one that stopped telling them.

So the "convert one AP first" step converts a hundred APs first. They all reboot, all go looking for the controller, and if the controller isn't reachable from where they sit, or the campus AP whitelist isn't ready, or the image download stalls, you now have a hundred APs sitting on a setup SSID waiting for a human, and a very quiet warehouse. Recoverable, but it's a hundred truck rolls instead of one.

It isn't a bug. It's how Instant clusters work, and my read on why (the docs don't say) is that a cluster half Instant and half Campus would be a mess to reason about. The conversion page does have a per-AP picker, but only on the Standalone path, not Campus or Remote. And "I'll test on one first" is such a natural instinct that people walk straight into it.

## What a real pilot looks like

If you want to convert one AP and only one AP, it has to be the only AP in its cluster.

Pull one out of production and put it on its own VLAN, with no layer 2 path back to the others. Give it a minute to elect itself virtual controller of a cluster of one. Now convert it. Watch it reboot, watch it find the gateways, watch it pull the Campus AP image, watch it show up on the controller. That's your pilot, and it actually tells you something: the controllers are reachable, the whitelist works, the image is right for that hardware.

Then, and only then, you go back to the production cluster knowing that when you press convert, all hundred of them are going to do what the pilot did.

```
# pilot AP, isolated VLAN, cluster of one
show swarm state
show aps
show ap-env
# after conversion, on the controller
show ap database
show ap image version
```

And if it does go wrong on the production cluster, there's a documented way back that doesn't involve a hundred hard resets, provided the APs actually made it onto the controller: `ap redeploy controller-less` on the controller, with `all`, `ap-group`, `ap-name`, `ip-addr` or `wired-mac` to scope it, sends them back to Instant mode. That's been there since AOS 6.5.2. It doesn't help an AP that never found the controller, which is why the reachability check comes first.

If you'd rather not build a VLAN for it, `swarm-mode standalone` on the pilot AP does the same job. The docs say a standalone AP can't join a cluster even on the same VLAN, which is exactly the isolation you want.

Put the APs in the campus AP whitelist before any of this (that's the gate when CPsec is on with the default auto cert provisioning off), and confirm the controller answers from the AP subnet. Two more that fail every AP at once if you miss them: the controller has to be on a release that supports conversion for that AP model, and the Instant APs and the controller have to be in the same regulatory domain. A domain mismatch fails the whole cluster together, which is precisely the failure this post is about.

## The migration you might not need

One more thing from that thread, because it removes the riskiest step entirely if it applies to you.

Campus APs find their controller by IP. Routed is fine. Static, DHCP option 43 and DNS discovery all work across layer 3; only ADP needs to be on the same layer 2 segment. There's no requirement for the APs and the controllers to share a VLAN or a subnet. So if the only reason you're moving the APs to a new management subnet is "that's where the controllers are," you can leave the APs where they sit, make sure 10.x can route to 172.x, and convert them in place. No subnet move, no disconnected-from-everything moment, one fewer thing to go wrong.

In this case the poster couldn't do that. The two networks were physically separate, different sites, no path between them. Fair enough. But ask the question. A lot of migration plans move APs around for reasons that turn out to be habit.

## Checklist

| Step | Why |
|---|---|
| Confirm the controllers answer from the AP subnet | If they don't, every converted AP is stranded |
| Controller release supports conversion for your AP models, regulatory domains match | Either one fails the whole cluster at once |
| Load the campus AP whitelist first | Controllers reject unknown APs, and a hundred rejections at once is a bad afternoon |
| Isolate one AP on its own VLAN, or set it swarm-mode standalone | Either way it's a cluster of one, and that's the only way to convert one AP |
| Convert the isolated AP, verify image and controller join | This is the actual test |
| Ask whether the subnet move is even necessary | CAPs route to controllers fine |
| Convert production in a window, expecting all of them to go | Because all of them will |
| Know the way back: `ap redeploy controller-less` | Only works for APs that reached the controller |
| Clear the AirWave config afterwards | Tidy, not required |

## Bottom line

The instinct to test on one AP is the right instinct. The virtual controller just doesn't offer that option unless you build it a cluster of one. Everything else about the plan was fine, and the poster ended up running exactly this: one isolated AP, then the rest.
