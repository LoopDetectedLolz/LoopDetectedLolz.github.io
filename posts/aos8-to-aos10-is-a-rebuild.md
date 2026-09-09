---
title: AOS-8 to AOS-10 Is a Rebuild, Not an Upgrade
slug: aos8-to-aos10-is-a-rebuild
date: 2026-07-30
tags: Wireless, AOS-10, Central, Migration
hero: hero-aos10.svg
summary: Three threads in one week, three symptoms, one cause: people planned an upgrade and got handed a rebuild. What doesn't come with you, the pre-validate defect everyone blames on DNS, and the order of operations.
origin: Three Airheads threads in the same week, same root cause
---
## Why I'm writing this

Three threads crossed my desk in one week. A pre-validate failing with a DNS error on a few hundred APs. Somebody moving a standalone 7030 to a 9240. Somebody else with a hundred AP-735s trying to get them onto AOS-8.13.3 without touching each one. Different boards, different symptoms, and underneath all three the same thing: people planned an upgrade and got handed a rebuild.

That's the whole post. If you take one thing from it, make it this: **the word "migration" is doing a lot of work in the HPE documentation, and it does not mean what it means everywhere else in networking.** You are not carrying your config forward. You are standing up a new management plane and re-homing devices into it.

Once you accept that, the rest of this gets a lot easier to plan.

## What actually doesn't come with you

This is the part that should drive your project plan, and it's buried in a Validated Solution Guide table rather than anywhere you'd trip over it.

**The internal authentication server is gone.** The local user DB on the Mobility Conductor has no equivalent. HPE's own wording is "local user authentication service is not supported." If you're using it for guest, for a handful of service accounts, for lab clients, that's a workstream, not a footnote. Run `show local-user db` during discovery so you know what you're dealing with before somebody finds out the hard way.

**AAA FastConnect is gone.** Same table, same blunt "not supported." If the controller is acting as the authentication server rather than relaying to one, you need a real RADIUS server before you migrate.

**Mobility Conductor and AirWave both go away.** Everything moves to Central. And AirWave 8.2.15.1 and later can't perform the AOS-10 upgrade for you, so it isn't even useful as a migration tool.

**Manual radio tuning goes away.** Transmit power, channel width, DFS handling, all of it moves to AirMatch. ClientMatch band steering, sticky client and load balancing move to Central too, and the VSG is explicit that those settings can't be tuned. If you have a site with hand-tuned RF because of some peculiar building, plan to re-solve that problem a different way.

**The Instant Virtual Controller is deprecated**, which took Dynamic RADIUS Proxy with it in bridge mode. Worth knowing if you rely on DRP today.

And one that isn't a feature loss but will absolutely generate a ticket: **your RADIUS source IP changes.** On AOS-8 the NAD is the Mobility Controller. On AOS-10 in mixed mode it's the gateway's management address, and in bridge mode it's each individual AP's management address. Every RADIUS server you talk to needs its client list updated, and in bridge mode that means every AP. Sort that before cutover, not during.

## The AP conversion itself

The command lives on the Mobility Conductor and it's been there since 8.6:

```
ap convert active {all-aps|specific-aps} {activate | local-flash <file> | server <URL>}
                  [max-downloads] [no-pre-validation] [no-reboot]
ap convert pre-validate {all-aps|specific-aps}
ap convert cancel
show ap convert-status
show ap convert-status-summary
show ap convert-status-list
```

Note it's `ap convert cancel`, two words, not `ap convert-cancel`. The status command is hyphenated the other way, `show ap convert-status`. That inconsistency has cost me more time than I'd like to admit.

`max-downloads` defaults to 10 concurrent AP image downloads. `server` takes ftp, tftp, http, https or scp. The `activate` option exists but the migration guide says it's "not currently recommended for use," so use `server` or `local-flash`. (The CLI reference for `show ap convert-status-summary` still calls Activate the recommended value. Two HPE pages, two answers; the migration guide is the newer one.)

If you're doing multiple AP models in one shot, semicolon-separate the images:

```
ap convert active specific-aps server http common.cloud.hpe.com \
  path ccssvc/ccs-system-firmware-registry/IAP ArubaOS_Norma_10.6.0.1_89990;ArubaOS_Scorpio_10.6.0.1_89990
```

Those constellation names are per-model image families. Get the right one for your hardware, because the wrong image just fails the download.

**What conversion does:** the AP pulls the AOS-10 image, saves its uplink parameters into `ap-env` so it can find its way back onto the network, boots AOS-10, gets a provisioning rule from Activate pointing it at Central, joins its assigned group, and then Central audits it and wipes almost everything else. What survives is a short list: DHCP/IPv4, static IPv4, dual Ethernet, PPPoE, AP1X, proxy, LACP and mesh.

Handy field check while you're watching it happen: look at LLDP neighbor info on the access switch. Still on AOS-8 and the AP reports as CAP. Converted and it reports as IAP.

## Pre-validate, and the failure everybody hits

Pre-validate checks that the AP has NTP sync, can reach Activate and the Central URL, and **is licensed in Central with a group already assigned**. That last one catches people, because it means you have to pre-provision APs into an AOS-10 group before you can validate them.

Now the failure. One of the threads that prompted this post had pre-validate failing with `Pre Validate Failed dns error(Central) device-uswest4.central.arubanetworks.com` on 8.10.0.5, on a controller where the AP could resolve that exact name and reach the internet. A packet capture showed the AP resolving the record and then never attempting a connection to the returned addresses. An Aruba SE reproduced it in a lab.

There is a defect for this, and it's a better answer than any of the theories that got floated on the thread. **AOS-253282, AOS-253299 and AOS-252424**, three linked defect records with identical text, resolved in **8.10.0.11** (and in 8.12.0.1 and 8.13.0.1 on the other trains), observed on controllers running AOS-8.7.1.9 and later. HPE's wording, straight from the defect record:

> The AP image conversion failed in controllers. The output of the `show ap convert-status` command shows Pre Validate Failed as the failure reason. This issue occurred when Central used an IPv6 address.

That last sentence is the whole thing. Central handed back an IPv6 address and the controller couldn't do anything with it. Which is exactly what the packet capture showed: resolution succeeds, records come back, no session is ever opened. It was never a DNS failure. It was an address family failure wearing a DNS error string, and the string sent an entire thread off to audit their resolvers.

Keep it in mind alongside the other IPv6 constraint in this migration, that APs have to be IPv4 or dual-stack because native IPv6 on APs isn't supported. Same fault line, showing up somewhere you wouldn't look for it. If you're below 8.10.0.11 and pre-validate is throwing DNS errors, go to 8.10.0.12 or later and stop debugging.

HPE also documents a second, independent cause of the exact same symptom on the same releases: on any 8.10 build before 8.10.0.11 with CPsec enabled, pre-validate fails because of the packet routing CPsec uses. Different mechanism, identical error, same fix. Get to 8.10.0.11 or later.

The workaround everybody lands on is `no-pre-validation`, and HPE documents the tradeoff honestly, in that CPsec note: bypassing validation "will allow the upgrade to complete at the risk of incomplete setup of the APs." In practice that risk is concrete. You're skipping the check that the AP is licensed and has a group, which is precisely the failure that leaves you with a converted AP sitting there unadopted. One poster in that thread reported needing a physical reset on APs converted this way. That isn't in any HPE doc, so treat it as a field report rather than gospel, but it's the right kind of thing to be nervous about when you're doing hundreds.

There's a second early-8.10 gotcha worth knowing: on releases before **8.10.0.5**, images transferred to the controller over SCP get the wrong permissions. Use something other than SCP on those versions.

## Version minimums, and a documentation contradiction

Three HPE sources, three different answers:

| Source | Minimum controller version |
|---|---|
| AOS-10 migration prerequisites | 8.10.0.12 or 8.12.0.1 and later |
| VSG Campus Migrate | 8.10.0.12 or 8.12.0.1 and later |
| Central 2.5.8 AP migration page | 8.7.1.9 or 8.10.0.5 and later |

Our DNS-error poster was on 8.10.0.5. He met the Central doc's bar and missed the other two by seven maintenance releases. I'd treat 8.10.0.12 as the real floor and ignore the Central page.

While we're here: 6.x straight to 10 isn't supported, you go via 8.7.1.0. And APs must be IPv4 or dual-stack, because native IPv6 on APs isn't supported.

## The stuff that bites you on the way through

**VLAN 1 is the AP uplink VLAN in AOS-10, and at conversion time you don't get a vote.** Your AP's native/management VLAN config is neither retained nor migrated. HPE's wording is that the AP "will always assume VID 1 for the native VLAN on the uplink," so it boots AOS-10 expecting untagged VID 1 and loses its mind if the switchport says otherwise. AOS-10.5 added the ability to set native and management VLANs from Central, but only after the AP is up on 10.5, which does nothing for you during the conversion. Fix the switchports first. (The VSG still says the uplink VLAN "cannot be updated"; the AOS-10 migration prerequisites page is the newer word.)

**A tunnel-mode client VLAN can't exist on the AP's trunk uplink.** That's deliberate, so the AP never learns client MACs on its wired side, but it means your uplink trunk config probably needs changing too. And don't use VLAN 1 for tunneled clients.

**Some config is retained on the AP but not migrated into Central.** AP1X, HTTP proxy and PPPoE all fall in this gap, and PPPoE is only retained at all when the target firmware is 10.4.1.4 or newer. When the AP's local setting and the Central group config disagree, you get AP flapping and auto-restore loops. Pre-stage those in the group before you convert anything. Also note LACP defaults to Passive in AOS-10.

**VLAN 3333 has to be clear of clients.** The magic-VLAN captive portal logon/logout role trick doesn't exist in AOS-10.

**Your LMS-IP needs to point at the cluster VRRP VIP, not an individual controller's management IP.** Otherwise you upgrade that one controller first and strand the APs pointed at it.

**Conversion can only be kicked off from the AP's currently active controller.** On a large cluster the AOS-10 migration guide suggests a separate non-clustered staging controller, which sounds like overkill until you're trying to sequence four hundred APs.

**Build a brand new Central group.** You cannot convert an existing IAP 8.x group to AOS-10. HPE's FAQ says the configuration constructs behind the scenes don't allow it. Set the group architecture to ArubaOS 10, set the network role, set firmware compliance, and get country code, time zone, NTP and your WLANs in place before a single AP shows up. And split any mixed-model Instant cluster containing an AP that AOS-10 doesn't support, because otherwise the download errors and none of them upgrade.

## When hardware is in the mix

Two of my three threads had a hardware angle, and it changes the shape of the job.

**Controller to gateway.** A 7030 going to a 9240 isn't just an OS decision. The 9240 runs AOS-8 from 8.10, so you can stay on AOS-8 and treat it as a box swap, or go AOS-10 and accept that there's no config restore at all, because AOS-10 gateways take everything from Central. There's no HPE-supplied config converter. And the ports are completely different: 8 combo copper on the 7030, 4 SFP28 and no copper data ports on the 9240 (the RJ-45s it does have are management and console), so every `interface gigabitethernet 0/0/4` through `0/0/7` stanza silently evaporates along with whatever VLANs lived on it. Usually including your management path. Console access is not optional.

**New APs that only speak AOS-10.** This one is field observation rather than something I can point you to in a doc, so weigh it accordingly. The AP-7xx series ships AOS-10, and in my experience the AOS-8 image lands in a separate partition fetched via Activate rather than by controller discovery. Pull them out of the box, upgrade them, drop them straight onto your AP VLAN, and that fetch never happens; no amount of DHCP option 43 convinces them to find a controller. Check `show image` for a second partition build before you go hunting for a config problem.

**Old APs that can't come at all.** 320 Series APs with 256 MB of RAM (serials starting DD, built between August 2015 and January 2016) can't be converted, full stop. Screen the inventory for them before you plan the wave.

## Rollback

Yes, you can go back, and it's documented. The order matters:

1. Confirm the target controller is licensed and has AP capacity.
2. `show ap convert-status`. If anything is Active, `ap convert cancel` first, or your APs will immediately try to convert forward again.
3. Get to the AP console, serial or SSH or Central Remote Console.
4. On the AP: `convert-aos-ap cap <controller-address>`.
5. Once it's back, remove the Central subscription in GreenLake so the AP drops out of Central management.

Note that `convert-aos-ap` runs on the AP, not the controller, and it's the reverse of `ap convert`. Two commands, similar names, opposite directions, different boxes. Worth writing on the whiteboard during a cutover.

## About TAC telling you it isn't supported

One of the three posters opened a case and was told AOS-8 to AOS-10 migration isn't supported and he'd need Professional Services. That's worth pushing back on.

HPE publishes a full customer-facing migration guide series covering APs and gateways, plus a Validated Solution Guide, **VSG 035 Campus Migrate**, with a chapter specifically on AOS-8 Campus to AOS-10 and another on upgrade steps, walking a two-controller cluster end to end with real CLI. That is not what an unsupported path looks like.

What I think happened is a conflation. There's an older use of `ap convert` to turn campus APs into Instant APs on AOS-8, and the CLI reference itself says HPE does not support that for Instant APs managed through AirWave or the local UI and recommends it only in lab or test environments. That caveat attaches to the Instant-on-AOS-8 destination. It does not attach to the documented CAP to AOS-10 and Central path. If you get the same answer, cite the VSG.

## Order of operations

| Step | Why it's in this position |
|---|---|
| Inventory what you lose first | Internal auth DB, FastConnect and hand-tuned RF are workstreams, not config lines |
| Get devices into GreenLake with subscriptions | Pre-validate checks this, and skipping it is how APs end up orphaned |
| Build a new Central group, never clone an IAP 8.x one | HPE says the underlying constructs don't convert |
| Pre-stage AP1X, proxy, PPPoE, mesh and country code in the group | Mismatch causes flapping and auto-restore loops |
| Fix switchports: no native VLAN, no tunnel client VLAN on the AP trunk | The AP comes up assuming untagged VID 1 |
| Update RADIUS NAD lists | Source IP moves to the gateway or to every individual AP |
| Point LMS-IP at the cluster VIP | Or the first controller you upgrade strands its APs |
| Get to 8.10.0.12 or later before converting | Two of three HPE sources say so, and AOS-253299 alone is worth the jump |
| Convert a pilot group, verify adoption, then scale | `show ap convert-status-summary` and LLDP CAP versus IAP |
| Keep console access and a rollback plan | `ap convert cancel` then `convert-aos-ap cap` |

## Bottom line

Plan it as a rebuild and it goes fine. Plan it as an upgrade and you'll discover the internal user database halfway through a maintenance window, which is a bad time to learn about it.

The technology is not the hard part. `ap convert` works, rollback works, the guides are decent once you find them. What gets people is walking in expecting the config to come along for the ride, and then meeting the feature deltas one at a time in production.

Most of the pain in this post is scheduling pain, and scheduling pain is cheap to avoid and expensive to fix. Plan for it before the project plan exists, not after.
