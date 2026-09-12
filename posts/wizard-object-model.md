---
title: The Wizard Is Lying About the Shape of Your Config
slug: wizard-object-model
date: 2026-09-12
tags: Wireless, Central, New Central, MPSK
hero: hero-object-model.svg
bot: nfn-bot-signal.svg
summary: A tunneled MPSK client that authenticates and lands nowhere, a Central NAC certificate that never gets issued, and a device quietly overriding group policy. Three features, one shape, and none of them raise an error.
origin: Three community threads in one week that all turned out to be the same problem
---
Three threads inside about a week, and they didn't look anything like each other.

One person added an MPSK passphrase, the client authenticated, and then it sat there with no VLAN. One person stood up Central NAC on a tunneled WLAN and the RadSec certificate never got issued. One person just wanted a list of the devices in their fleet that were overriding group policy, and there isn't one in the UI.

Three features, three people, one root cause. What the UI shows you is a flat list. What you actually built is a graph, it spans more than one class of device, and the wizard that built it wrote some of those objects and skipped the rest. Nothing errors. That's the whole problem.

## The role that stops at the AP

Start with MPSK Local, because this is the one where the documentation says the quiet part out loud and people still get caught.

When you add a passphrase to an MPSK Local profile, you also pick a role for it. That role gets created on the AP side. If the SSID is tunneled, the client's traffic terminates on a gateway, and the gateway has never heard of that role. Central's own MPSK Local page tells you to make sure the role in the profile also exists on the gateways, because the WLAN wizard isn't going to put it there for you.

So the client associates, the passphrase matches, the AP assigns the role, traffic goes up the tunnel, and the gateway looks for a role it doesn't have. No VLAN. Meanwhile the client sits there showing connected, which is the least useful symptom available.

{{figure: fig-mpsk-journey.svg | Five hops succeed and the sixth has nothing to look up. Nobody logs a failure, because an object that was never created cannot refuse.}}

While you're in there, three more MPSK Local constraints worth knowing before you design around it: wpa2-psk-aes only, 24 passphrases per SSID, and passphrases as strings rather than hex. The first one has a consequence people miss. 6 GHz requires WPA3, so an MPSK Local SSID isn't going on 6 GHz at all. If the plan involved 6 GHz and per-device passphrases, the plan changes before the AP order does.

## Two profiles, one name, different classes

Second case. New Central, tunneled WLAN, Central NAC doing the authentication. Everything configured, nothing authenticating, and the RadSec certificate the gateway needs never appeared.

What it came down to was which kind of profile the WLAN was built from. A library profile and a local profile look the same in the UI. Same fields, same name if you named them the same, same spot in the layout. They are not the same object class, and some features only wire themselves to one of them. Central NAC is one of those: the certificate follows the library profile.

That's a miserable thing to debug, because there's nothing to debug. You built something visually identical to the thing that works. My read is that local profiles exist so one scope can override without disturbing everything above it, which is reasonable, and rendering both classes the same way is what turns a reasonable design into a trap.

{{figure: fig-profile-class.svg | The fields are identical and the class is not. Only one of these two rows has a path to a certificate.}}

So the habit now is: before I debug a feature that won't wire itself up, I check what class the object is, not what the object says.

## The override you can't see

Third case, and this one is a visibility gap rather than a footgun. Somebody wanted to know which of their devices were overriding group policy. Reasonable question, especially before an audit, and the UI won't answer it.

The API will. Ask it for the objects that live on the device rather than the ones it inherits, `object-type=LOCAL`, and you get the list nobody built a page for. Nothing is broken and nothing is hidden on purpose. It's just a view that doesn't exist.

I've started treating that as the general move. If the UI can't tell me what's local and what's inherited, the API usually can, and what comes back is the config that's actually running.

## What good looks like

Same shape three times. A wizard writes objects in more than one place: AP and gateway, library and scope, group and device. It writes the ones it knows about, the rest are yours, and nothing tells you which ones it skipped, because an object that was never created doesn't generate an error. It just isn't there.

Two rules fall out of that.

**When a wizard writes objects for you, go find out what it didn't write.** If the feature spans an AP and a gateway, look at both. If it spans a library and a scope, find out which one got the object.

**When the UI can't answer a question about what's local, ask the API.** Overrides, profile classes, device-level objects. The UI is a view. The API is closer to the config.

Neither of those is clever. Both of them would have saved three people a day each.

## Checks for the three cases

| Symptom | What to check | Where |
|---|---|---|
| Tunneled MPSK client connects, gets no VLAN | Does the role named in the MPSK Local profile exist on the gateway | Gateway role list, not the WLAN wizard |
| 6 GHz in an MPSK design | MPSK Local is wpa2-psk-aes only, so there's no 6 GHz SSID to be had | MPSK Local profile constraints |
| More than 24 devices needing their own passphrase | 24 passphrases per SSID, strings not hex | Same place |
| Central NAC configured, no RadSec certificate | Whether the WLAN was built on a library profile or a local one | Profile class, before the certificate |
| Need the devices overriding group policy | Query the API for local objects instead of hunting for a UI list | `object-type=LOCAL` |

## Bottom line

None of these three are bugs. They're the same gap between the object model and the picture the UI draws of it, and all three fail silently, which is why they cost hours instead of minutes.

If something authenticated and then did nothing at all, stop looking at the thing that authenticated. Go find the object that was never created on the other side.
