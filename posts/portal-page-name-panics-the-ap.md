---
title: A Captive Portal Page Name Long Enough to Reboot Your APs
slug: portal-page-name-panics-the-ap
date: 2026-09-16
tags: Wireless, AOS-8, Captive Portal
hero: hero-portal-panic.svg
summary: A 605H in bridge mode kernel panicked every two to three minutes and nothing in the WLAN config looked wrong. The cause was the length of the captive portal page name, not the page, not the policy, not the AP. Here is why bridge mode is what exposed it, and why tunnel mode would have hidden it.
origin: An Airheads thread where the engineer read the AP console logs himself after a week of waiting on a case
---

Somebody on the forums had access points falling over in a loop. A 605H in bridge mode, two to three minutes of life, kernel panic, reboot, repeat. Only on one WLAN. Move a client to a different SSID on the same AP and everything behaved.

He opened a case. A week later, with the case no further along, he read the AP console logs himself and found it. The captive portal page **name** was 72 characters long. Not the page, not the HTML, not anything a user would ever see. The name of the object.

Shorten the name, the APs stop panicking.

I have not reproduced this, and I want to be straight about what that means before you read any further. This is a field finding from one engineer's environment, reproduced by him on 8.12.0.6 and 8.12.0.7, and I checked the 8.13.0.0 resolved issues list and it is not there. There is no defect ID. Treat it as a thing to check rather than a thing that is documented.

## Why nobody would look there

Think about the shape of the fault. An AP kernel panics, which is about as low-level as a failure gets, and the thing that fixes it is the length of a string in a configuration object three layers up. Nothing about the symptom points at the cause.

The instincts are all wrong here, and they are wrong in an expensive way:

A panicking AP looks like hardware, so you swap it. The replacement panics too, so you decide it is the firmware and you plan an upgrade window. The upgrade does not fix it, so you open a case and wait. Meanwhile the actual fault is a field you typed once, months ago, and never thought about again.

The reason it lands on the AP at all is the forwarding mode, and that is the part worth taking away from this even if you never touch a 605H.

## What bridge mode actually moves

In tunnel mode the AP is doing very little thinking. Client traffic goes into a GRE tunnel and comes out at the controller or gateway, and that is where the role lives, where the ACLs are evaluated, and where a captive portal redirect gets built and injected. The AP is a radio with a tunnel endpoint attached.

Bridge mode hands all of that back to the AP. HPE says it plainly on the AOS 10 bridge forwarding design page: when bridge forwarding is selected in a profile, the APs operate as the sole policy enforcement point. The incident above was on 8.12 rather than AOS 10, but the principle is the same on both, and that one sentence explains a whole category of reports that read "works in tunnel, breaks in bridge."

{{figure: fig-bridge-enforcement.svg | The same captive portal on the same WLAN, in the two forwarding modes. Bridge does not simplify the path, it relocates the work onto a device with a fraction of the memory.}}

So in bridge mode the AP is the box that has to hold the portal configuration, assemble the redirect, and hand it to the client. A fixed-size buffer somewhere in that path plus a name longer than whoever wrote it expected is a classic overflow, and the AP is the thing that pays for it.

That is also why a lab in tunnel mode would never have found this. The string never reaches the AP.

## The general lesson, which is bigger than one bug

Bridge mode is sold as the simple option. No tunnel, no controller in the data path, traffic goes straight onto the local VLAN. All true, and it is the right call for plenty of designs.

What gets left out is that you have not removed the work. You have moved it onto a device that has a fraction of the CPU, a fraction of the memory, and a fraction of the operational visibility of the gateway you took it off. Every role, every ACL, every policy the client hits is now being evaluated on an access point stuck to a ceiling.

Most of the time that is fine. When it is not fine, it fails as an AP problem rather than as a policy problem, and you spend your first day looking in completely the wrong place.

## What to actually do

**Check your portal page names now, not after something breaks.** It costs nothing. Anything approaching 60 characters is worth shortening on general principle, and you may as well settle on a short naming convention for portal objects while you are in there.

**Read the AP console before you open a case.** This is the part of the story that matters most. The engineer who found this got there because he stopped waiting and read the logs off the AP himself. A kernel panic leaves a trace, and that trace named the string. A case sat on it for a week; console output took an afternoon.

**When something works in tunnel and dies in bridge, look at what the AP is now holding.** Roles, ACLs, portal configuration, anything with a string in it. That is your suspect list, and it is short.

**If you can, test the WLAN in the mode you will deploy it in.** Validating a captive portal in tunnel and shipping it in bridge tests a different code path than the one your users will hit.

## The honest boundary

Everything above is one engineer's finding, reproduced on two maintenance releases, plus a documented statement about what bridge forwarding does. Those are two different grades of evidence and I am not going to blur them.

What is documented: bridge forwarding makes the AP the sole policy enforcement point.

What is a field report: a 72 character portal page name panics a 605H in bridge mode on 8.12.0.6 and 8.12.0.7, and shortening it stops the panic.

If you hit this, the useful thing you can do for everyone else is get a defect ID attached to it, because right now there is not one.
