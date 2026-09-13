---
title: Converting a Mesh Over the Air Strands Every Point
slug: mesh-conversion-strands-the-points
date: 2026-09-13
tags: Wireless, Migration, AOS-10, Mesh
hero: hero-mesh-strand.svg
bot: nfn-bot-signal.svg
summary: Conversion keeps the uplink parameters and throws away everything else, and Central wants a mesh provisioned over the wire the first time. Put those two sentences together before you convert anything on a pole.
origin: A migrating-mesh-to-Central thread, and the sinking feeling that came with reading the plan
series: Moving to AOS 10
series_order: 3
---
Somebody on Reddit was moving a mesh network to Central and laid out the plan. Convert the APs, let them come up in AOS 10, carry on. Reasonable plan, and it would have worked fine if every one of those APs had a cable in it.

Two facts kill it, and neither of them is hiding. HPE's own migration page says that after an AP converts, Central cleans up any old configuration on it except for the uplink parameters. The Central mesh page says the mesh network must be provisioned for the first time by plugging into the wired network. Read those one after the other and the outcome writes itself: the conversion takes away the thing that lets a mesh point join the network, and the only way to give it back is the one thing a mesh point does not have.

## What actually gets erased

A mesh point does not find its portal by magic. It authenticates to it using the mesh cluster profile it was provisioned with: the cluster name that goes out as the MSSID, the key, the priority. That profile is why a point associates to your portal and not to the one across the car park. It is config, it lives on the AP, and it is not an uplink parameter.

So when the AP reboots into AOS 10 and Central does its cleanup, the point comes back with an AOS 10 image, its uplink settings, and no idea that your mesh exists. It sits there advertising nothing and joining nothing.

## And the wire is not optional

The obvious next thought is fine, Central will push the mesh config down to it. Central will, once it can talk to the AP. It cannot talk to the AP, because the AP's only path to Central was the mesh link that no longer forms.

That is not a Central limitation you can argue your way around. The doc is direct: the first provisioning happens over the wire. After that the mesh behaves like any other deployment. But the first time is the wire, and a conversion makes every AP a first time again.

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

The running-time version is the one that bites. A point that later sees Ethernet 0 come up runs loop detection, and if the link is real it reboots as a portal. So plugging into a mesh point to have a look at something is not a passive act. Neither is unplugging a portal, which reboots five minutes after it loses its wired uplink.

## Everything else on that page worth taking with you

A short list of things that are all documented and all cost somebody a day at some point.

Reverse conversion is not symmetrical. Forward, you convert a whole AP group in one command. Backward, from AOS 10 to AOS 8, it is one AP at a time from that AP's console, and the doc says so plainly. Plan the rollback as a per-device job, not a group job.

ADP discovery is off in AOS 10, so a converted AP ignores the DHCP and DNS options you have been using to point APs at things. If that was part of your bring-up, it is not part of it any more.

A mesh point cannot be converted to a Remote AP at all, because mesh does not do VPN. If your plan had a RAP in it somewhere, that is the sentence to find first.

Eight mesh points per portal is the ceiling. And if you were planning 6 GHz backhaul, that band is WPA3-SAE only for mesh, so a cluster still configured for WPA2 PSK either gets converted to SAE automatically on 6 GHz or does not run there at all.

## Checklist before you convert anything with no cable in it

| Check | Why |
|---|---|
| Every AP has a wired port available, even a temporary one | First provisioning after conversion is wired, no exceptions |
| Portals converted, provisioned and verified before any point | A point with no portal advertising has nothing to join |
| Mesh cluster name and key recorded off the APs first | The AP's copy does not survive the cleanup |
| Group in Central holds the mesh config before the AP arrives | So the profile is waiting rather than being built while you stand there |
| Rollback planned per AP | AOS 10 back to AOS 8 is not a group operation |
| DHCP or DNS option-based discovery removed from the plan | ADP is disabled in AOS 10 |
| Points per portal under eight | Documented ceiling |
| 6 GHz backhaul means WPA3-SAE | WPA2 PSK does not run mesh on 6 GHz |

## Bottom line

Conversion is a provisioning event, and provisioning needs a path. Any AP whose only path is the network you are rebuilding cannot be provisioned by that rebuild, and mesh points are the clearest case because their path is the mesh itself.

The rule generalises past mesh. Before you convert anything, ask how the device will reach its new manager after it forgets everything it knew. If the answer is the thing you are converting, put a cable in it first.
