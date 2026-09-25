---
title: Converting a Mesh Over the Air Strands Every Point
slug: mesh-conversion-strands-the-points
date: 2026-09-13
tags: Wireless, Migration, AOS-10, Mesh
hero: hero-mesh-strand.svg
bot: nfn-bot-signal.svg
summary: HPE says the mesh profile survives conversion, and the same doc set says a mesh must be provisioned over the wire the first time. Nobody has reconciled those two sentences, and the one that is wrong is the one that costs you a lift. Plan for the wire.
origin: A migrating-mesh-to-Central thread, and the sinking feeling that came with reading the plan
series: Moving to AOS 10
series_order: 3
---
Somebody on Reddit was moving a mesh network to Central and laid out the plan. Convert the APs, let them come up in AOS 10, carry on. Reasonable plan, and it would have worked fine if every one of those APs had a cable in it.

Two sentences in HPE's own docs decide it, and they do not agree with each other. The migration page says that after an AP converts, Central cleans up any old configuration on it except for the uplink parameters, and its list of what is kept ends with mesh. The Central mesh page says the mesh network must be provisioned for the first time by plugging into the wired network. Read those one after the other and you have a profile that is supposed to survive, on an AP that is supposed to need a cable anyway. One of those sentences is going to be the one that matters on the day, and you do not get to pick which.

## What the profile is, and what the docs promise

A mesh point does not find its portal by magic. It authenticates to it using the mesh cluster profile it was provisioned with: the cluster name that goes out as the MSSID, the key, the priority. That profile is why a point associates to your portal and not to the one across the car park. It is config, and it lives on the AP.

HPE's migration guide says that profile is kept through conversion, and says why: "the existing mesh profile will be retained on the AP for the purpose of allowing reconnection to a mesh network." Good. Now hold that next to the mesh page, which says a mesh is provisioned the first time over the wire, and ask what a converted point is. It is an AP that has just booted a new operating system into a group it has never seen, carrying a profile from the old one. Whether AOS 10 treats that as a reconnection or a first time is the whole question, and neither page answers it. Until one of them does, the plan that survives being wrong is the one with a cable in it.

## And the wire is not optional

The obvious next thought is fine, Central will push the mesh config down to it. Central will, once it can talk to the AP. It cannot talk to the AP, because the AP's only path to Central was the mesh link that no longer forms.

That is not a Central limitation you can argue your way around. The doc is direct: the first provisioning happens over the wire. After that the mesh behaves like any other deployment. But the first time is the wire, and a conversion makes every AP a first time again.

## The objection, which is a good one

AOS 10 has a mesh recovery mechanism. It is PSK based, the key is generated from the customer ID, and the doc describes it as how a mesh node gets a link back to the managed device when the mesh link is broken and no other cluster is available. Read that quickly and it sounds like the answer to everything above.

I would not build a migration on it. Recovery is described as a repair path for a deployment that already exists, not as a provisioning path for an AP that just had its config cleaned and was handed to a different manager, and nothing in the mesh or migration pages says a freshly converted point can use it to receive its first configuration. I have not tested it either, so treat that as unproven in both directions. The wire is the documented path, and until somebody proves otherwise the wire is what belongs in the plan.

{{figure: fig-mesh-order.svg | The two orders are the same amount of work. One of them is done from a bench and the other is done from a ladder, twice.}}

## The order that works

Nothing clever here, it just has to happen in this sequence.

Bring the AP to a wired port. Convert it there. Let it boot into AOS 10, find Central, land in the right group and take the mesh cluster profile. Watch it come up as a portal, because a wired AP with a reachable network is a portal by definition. Then unplug it, put it where it belongs, and let it boot with no Ethernet, at which point it becomes a point and joins the cluster that the portal is advertising.

Portals first, and get them converted and stable before you strand anything on purpose. A point with nothing to join is just an expensive light.

If the site is big enough that carrying everything back to a bench is unrealistic, the wire does not have to be a permanent one. A patch cable and a PoE injector at the base of the pole is a wired port. It only has to be there once, for one boot.

## The role you did not choose

Worth knowing while you are in here, because it explains a couple of confusing reboots.

On mesh-auto, nobody assigns the role. The AP works it out at boot. Ethernet link down means point. Ethernet link up means it checks whether the network is actually reachable, either by pinging its gateway with a static address or by getting a DHCP lease, and it is only a portal if that works. Link up with nothing behind it makes it a point again, which is a nice touch.

{{figure: fig-mesh-role.svg | Role detection at boot, plus the bit that catches people: a live Ethernet link on a point is a reboot into a portal, not a convenience.}}

The running-time version is the one that bites. The page says a point that later sees its Ethernet link come up keeps running loop protection, reboots if it detects a loop, and otherwise stays a mesh point. What it does not say is when a point with a live, loop-free cable ever becomes a portal without a reboot you triggered. So plugging into a mesh point to have a look at something is not a passive act. Neither is unplugging a portal, which reboots five minutes after it loses its wired uplink. Plan for the reboot, because that is the assumption that costs you nothing if you are wrong, and put it on the lab list if you need to know for certain.

## Everything else in the docs worth taking with you

A short list of things that are all documented and all cost somebody a day at some point.

Reverse conversion is not symmetrical. Forward, you add an AP group to the conversion list and convert the lot at once. Backward, from AOS 10 to AOS 8, it is one AP at a time from that AP's console, and the doc says so plainly. Plan the rollback as a per-device job, not a group job.

A converted AP does not do controller discovery at all. ADP, DHCP option 43 and DNS are three different mechanisms and it ignores all three, because an AOS 10 AP gets its provisioning rule from Activate and goes to Central. If option 43 or an aruba-master record was part of your bring-up, it is not part of it any more.

If you are still on Instant and a RAP is somewhere in the plan, the Instant guide is blunt: a mesh point cannot be converted to a Remote AP, because mesh APs do not support a VPN connection. AOS 10 has no RAP role at all; the equivalent is Microbranch, and that is a different conversation.

Eight mesh points per portal is the ceiling the Instant mesh doc gives. The AOS 10 mesh page does not state one, which is not the same as there not being one. Treat eight as the number until HPE writes down a different one.

And if 6 GHz backhaul is in the plan, check the opmode before you commit to the band. The mesh notes say 6 GHz supports only wpa3-sae-aes, and that a cluster configured for wpa2-psk-aes gets switched to SAE on that band. Worth knowing that this text sits inside the AP-615 section rather than the general mesh guidance, so treat it as model specific until you have confirmed it for the hardware in your hand.

## Checklist before you convert anything with no cable in it

| Check | Why |
|---|---|
| Every AP has a wired port available, even a temporary one | First provisioning after conversion is wired, no exceptions |
| Portals converted, provisioned and verified before any point | A point with no portal advertising has nothing to join |
| Mesh cluster name and key recorded off the APs first | HPE says the AP's copy is retained; if it is not, you want it on paper, not in a lift bucket |
| Group in Central holds the mesh config before the AP arrives | So the profile is waiting rather than being built while you stand there |
| Rollback planned per AP | AOS 10 back to AOS 8 is not a group operation |
| DHCP or DNS option-based discovery removed from the plan | A converted AP does not do controller discovery; it finds Central through Activate |
| Points per portal at eight or fewer | The ceiling in the Instant mesh doc; the AOS 10 mesh page states no limit, so treat eight as the safe number |
| 6 GHz backhaul, confirm the opmode for your model | The 6 GHz WPA3-SAE requirement is written in the AP-615 section, not the general guidance |

## Bottom line

Conversion is a provisioning event, and provisioning needs a path. Any AP whose only path is the network you are rebuilding cannot be provisioned by that rebuild, and mesh points are the clearest case because their path is the mesh itself.

The rule generalises past mesh. Before you convert anything, ask how the device will reach its new manager after it forgets everything it knew. If the answer is the thing you are converting, put a cable in it first.
