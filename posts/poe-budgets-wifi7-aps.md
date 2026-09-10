---
title: Your New AP Isn't Broken, It's Hungry: PoE Budgets in the Wi-Fi 7 Era
slug: poe-budgets-wifi7-aps
date: 2026-07-29
tags: Wireless, PoE, Wi-Fi 7
hero: hero-poe.svg
summary: Wi-Fi 7 APs don't fail when they're underpowered. They negotiate, shrug, and come up in a reduced mode with the 6 GHz radio dark. Nothing turns red.
origin: Five Airheads threads wearing different titles, one root cause
series: Wi-Fi 7 rollout
series_order: 1
interactive: poe
---
## Why I'm writing this

Spend ten minutes on Airheads and you'll find the same thread wearing five different titles. "New AP, 6 GHz radio stays down." "Radio disabled due to low power." "Wi-Fi 7 AP slower than the AP it replaced." The poster has usually already swapped the AP, opened a TAC case, and started doubting the firmware. And in most of these threads the AP is fine. It's plugged into a switch port that can't feed it, so it quietly turned off the features that make it worth the money.

This is the most common misconception of the Wi-Fi 7 hardware era: that an AP either works or it doesn't. Modern APs don't fail when they're underpowered. They negotiate, shrug, and come up in a reduced mode. Nothing turns red. If you don't know to look for it, it looks exactly like a bad AP.

## The 60-second PoE primer

PoE comes in tiers: 802.3af (15.4W at the switch port, 13W to the device), 802.3at/PoE+ (30W at the port, 25.5W to the device), 802.3bt/PoE++ (51W for Class 6, 71.3W for Class 8, and note AOS-CX PoE switches don't do Class 7 or 8 at all). The switch and device negotiate, first by hardware classification, then refined over LLDP after link-up.

What changed: the previous couple of AP generations mostly fit inside PoE+. A Wi-Fi 7 enterprise AP has three Wi-Fi radios plus IoT radios, more chains, faster CPUs, and on the mid-range and flagship models a multi-gig PHY, USB and a second Ethernet port, and the flagships want well north of 30W for all of it (the 750 Series datasheet says 40W or 51W). That's 802.3bt territory. Plug one into the 802.3at closet switch that's been faithfully powering APs for eight years and the AP does math, decides what it can afford, and starts turning things off.

## What "underfed" looks like

- **802.3bt:** everything works. Read the class carefully though: the 755 needs Class 6 (51W) to run unrestricted, and at Class 5 it's still in restricted mode.
- **802.3at:** degraded, and it's model-specific. The 755 on Class 4 loses USB and the second Ethernet port, drops from 4x4 to 2x2, and takes a 3 dB TX cut. The 735 on Class 4 loses USB and that's it. The 725 runs on 802.3at with no restrictions at all.
- **802.3af:** staging only on the 730 and 750 Series, no radios. The 725 does run on af, with USB off and 3 dB less TX power.

The middle row is the Airheads thread generator. What gets cut, and in what order, is documented: USB first, then the second Ethernet port, then chains and TX power. A radio going dark is at the bottom of that list, and on the current Wi-Fi 7 datasheets it doesn't happen by default at Class 4 at all. It only happens if someone configured an IPM reduction step to disable a radio, which is a real setting and does turn up in the field. So the flagship on an at port joins, broadcasts on all three bands, clients connect, everything "works," and it's a 2x2 AP with a 3 dB haircut that somebody paid 4x4 money for. The only evidence is a status field nobody looked at.

## The sneaky variant: right switch, wrong negotiation

The switch IS bt-capable and the AP is still degraded. Check in order: LLDP power negotiation not happening on the port (without it the switch only allocates what the hardware class asked for, so leave LLDP on for AP ports), per-member PoE budget oversubscribed (cameras and phones count too, and in a VSF stack one member can't borrow from another; the switch made a budgeting decision and didn't send a memo), or something old in the middle (injectors, extenders, mystery patch infrastructure).

## The five-minute check

Aruba CX: `show power-over-ethernet brief` (a PD class of 4 on a new Wi-Fi 7 AP is your answer, because Class 4 caps it at 25.5W) and `show power-over-ethernet <interface>` for the LLDP block, which shows PSE allocated versus PD requested power. `show lldp neighbor-info detail` confirms the neighbor is there at all. AP side: `show ap power-mgmt-statistics` on Instant and AOS-10, or `show ap debug system-status` on AOS-8, where the power section shows the hardware negotiation result and the LLDP negotiated value. Central collects that per-AP power telemetry when IPM is enabled. Mist flags insufficient power right on the Access Points list. Do this per AP at deployment, before anyone tests throughput. Five minutes of LLDP reading versus a month of "the new wifi feels slow" and an RMA that comes back No Fault Found, because there was no fault.

## Design it out

Power math is part of the design, not an install-day discovery. Count APs at the datasheet budget number (not typical draw), add everything else in the closet, compare to switch budget with headroom. If the closet is at-era, the switch refresh goes in the proposal next to the APs. Expected per-AP power class goes in the as-built. And multi-gig ports while you're in there: a 1G uplink caps exactly the performance the customer paid to raise.

## Checklist for the next "my new AP is broken" thread

1. What did the port allocate? `show power-over-ethernet brief`
2. LLDP power TLVs exchanging? `show power-over-ethernet <interface>`
3. AP admitting it's degraded? `show ap power-mgmt-statistics` / `show ap debug system-status`
4. Closet budget oversubscribed? Total allocated vs switch budget
5. Anything between switch and AP? Bypass and retest
6. Only then firmware, and only then the AP

## Bottom line

Wi-Fi 7 APs are the first generation where the power budget routinely decides whether the customer gets what they bought. An underfed AP doesn't fail, it downgrades itself politely and lets you find out from a slow Teams call. Check allocation day one, design the closet budget into every refresh, and the next "new AP feels slow" thread answers itself. And when a thread says a radio stayed down, ask what the IPM steps are set to before you blame the switch.
