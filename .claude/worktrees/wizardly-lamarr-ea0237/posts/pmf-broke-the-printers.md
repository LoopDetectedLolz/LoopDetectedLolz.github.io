---
title: Your WPA3 Transition SSID Didn't Break the Printers. PMF Did.
slug: pmf-broke-the-printers
date: 2026-09-26
tags: Wireless, WPA3, AOS-10, Security
hero: hero-pmf.svg
bot: nfn-bot-signal.svg
summary: Flip a Personal SSID from WPA2 to WPA2/WPA3 transition and a class of older clients falls off, with the same name and the same passphrase. One bit and a longer AKM list did it, and the fix is a design decision, not a driver hunt.
origin: A 6 GHz readiness change that took the printers in receiving with it
---
The change request said "enable WPA3 transition on the staff SSID so we're ready for 6 GHz." Same SSID name, same passphrase, nobody touched anything called PMF. By the next morning the label printers in receiving were offline, two handheld scanners wouldn't join, and a conference room TV had decided it had never heard of the network.

Everyone went looking for a WPA3 problem. There wasn't one. Every one of those clients was still doing WPA2-PSK, exactly as before. What changed was the security element the AP advertises, and the two things that changed in it are the management frame protection bit and the list of ways you're allowed to authenticate. The printer never got as far as either. It read the element, didn't like it, and walked away.

## What actually changed on the air

An SSID advertises how to talk to it in the RSN element of every beacon and probe response. Before the change, that element said: AKM is PSK, pairwise cipher is CCMP, and the RSN capabilities field had both management frame protection bits clear.

WPA2/WPA3 transition mode is defined by the Wi-Fi Alliance, not by any one vendor, and it changes the element in two places at once. The AKM list grows: SAE alongside PSK at minimum, and the spec says the AP should also offer PSK with SHA-256 and the newer group-dependent-hash flavour of SAE, so a client can see four or more where it used to see one. HPE's own decoder ring for an AOS AP shows PSK and SAE on 2.4 and 5 GHz, and the two 802.11r variants on top if fast roaming is on. And in the capabilities field, MFPC goes to 1 while MFPR stays at 0: protection is capable, not required. That is the "optional" everyone points at and says can't break anything. A group management cipher for broadcast management frames may show up too, though the default is BIP-CMAC-128 and an AP is allowed to leave the field out when that's what it uses.

So the SSID your printer saw yesterday and the SSID it sees today have the same name and the same passphrase and a different RSN element. The printer has to parse that element before it can decide to associate. That is where the problem is, and the Wi-Fi Alliance says so in its own spec: the whole reason a later revision added a workaround (more on that below) is stations that are expected to have trouble with an RSN element advertising everything the AP has enabled.

## The two bits

Take the pair as a truth table. The AP sets MFPC and MFPR. The client sets its own pair in its association request. For an AP that is optional or required, and a client that is capable or not, there are four outcomes.

AP required and client capable: PMF negotiated. AP optional and client capable: PMF negotiated, because a capable client on a capable AP uses it. AP optional and client not capable: association proceeds without PMF, which is what "transition" promised. AP required and client not capable: association rejected, status code 31, robust management frame policy violation.

An optional AP never rejects a WPA2-PSK client on PMF grounds. It does reject one thing: a client that picks SAE and then doesn't negotiate PMF, because the spec says WPA3 and PMF go together. That's rare and it's a WPA3 client's problem. The printers are in a fifth outcome the table doesn't have, and it has nothing to do with the bits themselves.

**The driver chokes on the element.** An embedded Wi-Fi module from a decade ago was written against an RSN element with one AKM and no extra fields. Hand it two or four AKMs and a group management cipher and some of them stop parsing, decide the network isn't one they support, and never send an association request at all. They may still probe, so you might see them scanning, but from the AP's side there is no auth and no association to log. The client simply stopped showing up. The people who maintain hostapd describe these as stations that don't implement RSN element extensibility correctly, which is a polite way of putting it.

**The client claims capable and isn't.** Some older stacks set MFPC in their association request because the driver knows the bit exists, then fail the first thing PMF asks of them. These associate fine, pass the handshake, run for a while, and fall over the first time the AP sends a protected management frame they can't handle. The tickets say "randomly disconnects since the change." This one is field observation, mine and other people's, rather than something I can point you to in a doc, so weight it accordingly.

**The SAE stack is early.** Anything that does try WPA3 needs a working SAE implementation. Early ones exist in firmware nobody will update. On a transition SSID they can fall back to PSK; on a WPA3-only SSID they can't, which is why the WPA3-only SSID should be a separate decision, not the next step.

None of those three is a bug in WPA3. They are all the same thing: you changed what the client has to understand before it can join, and the client is what it is.

## What PMF actually protects, and what it doesn't

Worth being exact here because the marketing version is "encrypts management frames" and that isn't it.

PMF protects the robust management frames: deauthentication, disassociation, and the robust action frames (block ack setup, spectrum management, radio measurement and the like). Unicast ones are encrypted with the pairwise key, same as data. Broadcast ones, like a deauth to the whole cell, get an integrity check under BIP using a separate integrity group key, the IGTK, which is handed out in the 4-way handshake alongside the GTK.

It does not protect probe requests or responses, authentication frames, or the association exchange itself, because there is no key yet when those go by. Beacons are unprotected too unless the AP and client both do beacon protection, an optional addition that arrived with the 802.11-2020 revision, with its own key (the BIGTK) and, on AOS 10, its own release floor. PMF doesn't touch the 4-way handshake either; EAPOL rides in data frames and has its own integrity check. And it does nothing about the channel being jammed. A pen tester who used to knock every client off with a spoofed deauth will find that stops working against the clients that negotiated PMF, that the WPA2 clients on a transition SSID are exactly as exposed as they were last week, and that RF jamming still works on everyone. The report will say so.

The piece that catches people is what happens when a client with PMF loses its state, comes back, and asks to associate again while the AP still thinks the old session is alive.

{{figure: fig-sa-query.svg | The SA Query dance. Without PMF the second association request replaces the first. With PMF the AP has to prove the old session is dead before it lets the new one in, and that can take up to a second.}}

Without PMF the AP just accepts the new association request and tears down the old one. With PMF it can't, because that would let anyone with your MAC address kick you off by asking to associate. So the AP answers status 30, association rejected temporarily, with a comeback time, and sends an SA Query to the old association. If nothing answers within the SA Query timeout the old one is dead, and the client's second attempt after the comeback goes through. The default maximum is 1000 TU, call it a second. When you walk out of range, come back, and the phone takes a beat to reconnect, this is sometimes why.

## What this means for 6 GHz

The reason the change request existed in the first place. On 6 GHz the Wi-Fi Alliance rules leave no room: WPA3, Personal with hash-to-element or Enterprise, or Enhanced Open. PMF required on every BSS. No WPA2, no open, and no transition mode of either kind. HPE Aruba's SSID profile reference says it plainly: a Wi-Fi 6E network only supports enhanced-open and the WPA3 opmodes.

Here is the part I had wrong when I started writing this, and it's good news. On AOS you don't need a second SSID to get there. The Wi-Fi design guide's security modes page says a WPA3-Personal SSID with transition enabled runs transition mode on 2.4 and 5 GHz only, and the transition setting is overridden and disabled on 6 GHz automatically. Its own decoder ring shows the same SSID advertising MFPC 1, MFPR 0 on 2.4 and 5 GHz and MFPC 1, MFPR 1 on 6 GHz. One SSID, two personalities, sorted by band.

So "transition mode to get ready for 6 GHz" is actually most of a plan. Your WPA3 clients get SAE everywhere and 6 GHz where the AP has it, your WPA2 clients keep working on 2.4 and 5, and the 6 GHz radio never carries anything but WPA3. What it does not do is help the printers, because they live on 2.4 and 5 GHz and that's where the transition element is.

## The fix the standard grew, and whether you can use it yet

The Wi-Fi Alliance saw this coming. WPA3 spec version 3.4, from October 2024, added WPA3-Personal Compatibility Mode. The idea is simple: on 2.4 and 5 GHz the ordinary RSN element goes back to advertising plain WPA2-PSK, the way it did before, and the SAE offer moves into a separate RSN Override element that old clients don't know exists and therefore don't try to parse. Clients that understand the override element read both and pick SAE; a WPA3 client that doesn't know about it connects on WPA2, which the spec says out loud. 6 GHz stays SAE-only. The spec says outright that it's for cases where stations are expected to have trouble with an RSN element that advertises every enabled option. That is this post, in one sentence, written by the people who wrote the standard.

Whether you can turn it on is a different question. As of September 2026 I could not find compatibility mode or RSN override in the Central or AOS 10 documentation. If it shows up in a release note, that's the switch you want, and until then the answer is design.

## Where it lives on AOS-10 and Central

In Central, on the SSID's Security tab with the security level set to Personal, the Key Management list is where WPA3-Personal is chosen. On the AP side that is the opmode `wpa3-sae-aes` in the SSID profile, and the part that matters for this post is the `opmode-transition` parameter, which the Instant CLI reference describes as backward compatibility for `wpa3-sae-aes` and `enhanced-open`, on by default. So on 2.4 and 5 GHz, WPA3-Personal is a transition SSID unless you turn that off (that default is documented for the CLI; read the AP config after you pick it in Central rather than trusting me on what the UI writes); `opmode-transition-disable` is what makes it WPA3-only on every band.

Management frame protection has its own toggle under the SSID's General tab, Advanced Settings, Miscellaneous, and Central's page on it says it can be enabled only on WPA2-PSK and WPA2-Enterprise SSIDs. The CLI has two knobs behind it, `mfp-capable` and `mfp-required`, both off by default; which one the toggle sets isn't documented, so read the AP config after you flip it. The same page notes that 802.11r fast roaming won't take effect when MFP is enabled on a WPA2 SSID, so if you were leaning on 11r for voice, read that twice.

On a WPA3 or transition SSID the MFP toggle isn't the control. The Wi-Fi Alliance rules set the capable bit for you, and required versus optional is decided by the transition setting: transition on is MFPR 0, transition off is MFPR 1. That's the whole design decision, and it's made in a field that doesn't have "PMF" anywhere in its name.

When a client is refusing to join, the AP can tell you which outcome it hit, as long as the client transmitted something. `show ap debug mgmt-frames <client-mac>` on the AP console lists the management frames it traded with that client with the status in the Misc column, so a rejected association on an MFP-required SSID shows up there as the association response with its status. `show ap debug auth-trace-buf <client-mac>` shows the 4-way handshake messages for a client that did associate, so a client that got through it had the passphrase right and whatever went wrong after that is somewhere else. Nothing on the AP will show you a client that never sent an association request, which is the point: the driver-choked printer is diagnosed by its absence.

## Who can do what

The floors, from vendor documentation. Everything below these lines is where the tickets come from.

| Client | WPA3-Personal (SAE) | On a transition SSID | Notes |
|---|---|---|---|
| iPhone, iPad, Mac | iPhone 7, iPad 5th generation, late-2013 Macs with 802.11ac and later, per Apple's platform security guide; the guide's fall 2019 edition (iOS 13, Catalina) is the first to list WPA3 | Fine | Apple's router guidance recommends WPA3 Personal, or WPA2/WPA3 Transitional for compatibility |
| Android | Android 10 and later, hardware permitting | Fine on 10 and up, WPA2 below | Google documents Android 9 and older using the WPA2 half of a transition SSID |
| Windows 10 and 11 | Windows 10 version 1903 and later per Intel, with a WPA3 driver | Fine with a current driver | `netsh wlan show drivers` lists WPA3 Personal under authentication if the adapter has it |
| Intel adapters | Wireless-AC 9000 series and newer, driver 21.10 or later | Same | Intel's WPA3 list starts at the 9000 series; a 7260 or 8260 isn't on it |
| Printers, scanners, IoT modules | Whatever the module vendor shipped | This is the row that breaks | Assume nothing, test one of each before the change |

The last row is the whole post. The laptops and phones were rarely the risk, though an old laptop with a 7260 in it belongs in the test pile too.

## What good looks like

Three SSIDs doing three jobs, not one SSID trying to do all of them.

A WPA3-only SSID for the fleet that can do it, transition off, 6 GHz enabled. A transition SSID for the middle: known-good WPA2 clients that will move to SAE as they get replaced, and you accept that its 2.4 and 5 GHz element advertises SAE and MFPC to everyone. And a WPA2-only SSID with MFP off as the parking lot for the things that will never see a firmware update, on its own VLAN with a policy that treats it like the exposure it is. If compatibility mode lands on your platform, the middle SSID and the parking lot can become one.

Before any of that, take one of each device class into a lab SSID that already has the target settings and try it. Not the model number from the asset list, the actual unit, on its actual firmware. A printer that joins a WPA2 SSID and refuses a transition SSID with the same passphrase has told you everything in about thirty seconds, and it told you before the change window instead of after.

## Checklist before you flip it

| Check | Why |
|---|---|
| Inventory every non-laptop, non-phone client on the SSID, and the oldest laptops | Those are the ones most likely to be at risk |
| Test one real unit of each against a transition SSID in the lab | The silent failure is no association request at all; also watch for a rejected association and for drops after joining |
| Decide transition on or off on purpose | On is the backward-compatible setting, MFPR 0 on 2.4 and 5 GHz; off is MFPR 1 on every band |
| Know that 6 GHz is WPA3-only even on the transition SSID | AOS overrides transition on 6 GHz; that half only serves clients that do SAE with hash-to-element |
| If 11r is doing work for voice, read the MFP note | Central documents 11r not taking effect with MFP on a WPA2 SSID |
| Have the parking-lot SSID and VLAN built before the change | So the printers have somewhere to land at 8 am |

## Bottom line

Transition mode is safe for nearly every client that can read the element it advertises. The ones that can't are the ones you already knew were old, and they fail silently, from their side, with nothing in your association logs. Test the old stuff, give it a home, and make the transition-on-or-off call yourself instead of letting a default make it for you.
