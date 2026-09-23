---
title: Your Captive Portal Works, Phones Just Won't Tell You Why It Doesn't
slug: your-captive-portal-works-phones-just-wont-tell-you-why-it-doesnt
date: 2026-09-23
tags: ClearPass, Captive Portal, Aruba Central, Certificates
hero: hero-your-captive-portal-works-phones-just-wont-tell-you-why-it-doesnt.svg
summary: Laptops pass a ClearPass Guest login and phones sit in pre auth. The page is fine; the phone's popup rejects the AP or gateway's portal cert on the post back, and one openssl command plus Access Tracker shows which of three places it died.
origin: One Airheads thread this week where laptops logged in and phones sat in the pre auth role on the VC.
---

## Why I'm writing this

Somebody on the forums had ClearPass Guest on a Central managed Instant cluster. Laptops log in. Phones load the page, fill it in, tap Log In, and sit in the pre auth role on the VC. DHCP, DNS and the redirect were already checked.

That list of things that work is the diagnosis. When one kind of client passes, the config is mostly right and the difference is the client. Put the service rules down.

I answered it. Then an HPE engineer on the thread added the missing intermediates angle, plus the line this post is built on: work out where in the guest workflow the login aborts, and the fix is usually trivial.

The phone isn't broken. It's the only client in the building that won't click Proceed.

## Where the login actually dies

It's four legs, not one page:

1. The AP or gateway redirects the phone to ClearPass.
2. ClearPass serves the form over its own cert.
3. The form posts the credentials back to the AP or gateway's captive portal name, over the AP side cert.
4. Only then does the AP or gateway send RADIUS to ClearPass and get a role back.

The page loading proves the ClearPass cert is fine. It proves nothing about the second cert, because the phone doesn't meet that one until leg three.

Leg three dies four ways. The AP is still on its default cert, the cert has expired, it's served without its intermediates, or the name the Web Login posts to isn't on it.

Laptops get away with it. Somebody clicks past the warning, or the browser already holds the missing intermediate (Firefox preloads them) and quietly fills the gap. The login works and nobody learns anything.

Phones don't:

- **Android** at least tells you. The sign in screen swaps in a security warning, "The network you're trying to join has security issues," with the reason under it. The only way on is Continue anyway via browser, which closes the sign in screen. If the cert error is on a sub resource rather than the page itself, it gets cancelled without a word.
- **iOS** doesn't document what the popup does with a bad cert on the post back. My own read, and I'll flag it as mine rather than Apple's: there's no Proceed, and the post just doesn't land.

Either way no RADIUS fires, and as far as ClearPass knows the phone never tried.

## What good looks like: two certs, two names, one chain each

- **Two certs, both publicly trusted.** One on ClearPass for the page, one on the AP or gateway for the post back. The phone checks each connection on its own, so they don't need the same CA.
- **Each one uploaded with its intermediates.** Central wants one PEM file: the server cert, then the chain in order, then the private key. What counts is the chain the device serves, not the chain your laptop can build for it.
- **The Web Login Address is a SAN on the AP side cert.** Not just the CN. iOS 13 stopped trusting names that only sit in the CN. Change the cert and the Address in the same change window. If you upload a wildcard, gateways and AOS 8 controllers swap the asterisk for `captiveportal-login`, so post to that name. The device is supposed to answer DNS for its own portal name (HPE has a support article for when a controller doesn't), and a pre auth client has to get that answer.
- **The ClearPass portal FQDN matches the ClearPass cert and resolves in pre auth.** The pre auth role allows DNS, plus 443 to ClearPass and to the captive portal address. Nothing more.

## Instant on Central, AOS 10, and AOS 8 in a paragraph

- **Instant under Central** is the thread's case, hence "VC". Upload the cert under Maintain, Organization, Certificates, then map it as Captive Portal under Certificate Usage in the group's Security settings. If nothing's mapped, Instant's own guide says the AP makes a self signed portal cert at first boot, and no phone trusts that. Central has a trusted securelogin.hpe.com cert for its own Cloud Guest, but I wouldn't assume it covers an external ClearPass SSID. `show cpcert` on the VC tells you what's actually there.
- **The Instant NAS.** Each AP sends its own RADIUS unless Dynamic RADIUS Proxy is on, and then it's the VC address. ClearPass needs a network device entry for whichever one it is. A subnet entry is fine.
- **AOS 10.** On a tunneled SSID the APs hand RADIUS to the gateway, which proxies it, so the gateway goes into ClearPass and the APs don't. On a bridged SSID the AP talks to ClearPass itself. Current code uses securelogin.hpe.com as the portal name, and gateways run a demo self signed cert until you install yours.
- **AOS 8.** The portal cert is `captive-portal-cert` in the web server profile. Legacy builds used securelogin.arubanetworks.com, so check the Address on migrated Web Login pages. That's the whole paragraph.
- **Gotcha: the role name.** The role ClearPass returns has to exist where the client lands: in the SSID's roles on Instant, in the group on AOS 10. I haven't found it written down what the AP does with a role it doesn't know, so this is my read. The client doesn't get the role you meant, and you'll blame the cert again.
- **Gotcha: Prevent CNA.** It's a bypass, not a fix. ClearPass describes it as bypassing the Apple Captive Network Assistant and warns it may not work with every vendor. With the popup out of the way, Apple users finish in Safari and click past the cert. That's the same laptop habit that hid the problem in the first place.

## Test it or it doesn't count

Start with the cert the phone sees. From a laptop on the guest SSID, still in pre auth:

```
openssl s_client -connect <PORTAL-FQDN>:443 -servername <PORTAL-FQDN> -showcerts </dev/null
```

`-showcerts` prints only the certs the server sent, in the order it sent them. Browsers help. openssl doesn't, and that's the point.

```term
Certificate chain
 0 s:CN = <PORTAL-FQDN>
   i:C = US, O = <PUBLIC-CA>, CN = <INTERMEDIATE-CA>
```

A lone `0` means no intermediates. Pipe the same command into `openssl x509 -noout -text` and read the SANs and the dates.

Then open Access Tracker and filter on the guest username or the phone's private Wi-Fi address (the one on that network's info screen, not the hardware address under About). Log in from the popup.

Watch the source. With a Pre-Auth Check on, ClearPass checks the credentials itself through its Guest Access Web Login service, before the phone posts anything to the AP. That entry isn't the NAS. You want a RADIUS request from the AP, VC or gateway address.

- **Nothing from the NAS:** the post back never landed, so it's the cert or the name. Check Event Viewer before you commit to that. RADIUS from a device that isn't in Network Devices ends up there instead of Access Tracker, and from the phone it looks exactly the same.
- **An accept with a role, phone still in pre auth:** it's the role name or the NAS side.
- **A reject:** you're in policy land after all, and this isn't your post.

Cross check on the phone. On Android, take Continue anyway via browser. On iOS, join from Settings through the info button, tap Cancel on the popup and pick Without Internet, which Apple documents as keeping you on the network. Log in by hand. A warning you can click past, then a login that works: that's the cert.

Good looks like this: the popup logs in and closes, the role changes on the AP, and Access Tracker shows one accept per attempt.

## What changed in my base config

- The guest build sheet has an AP side cert row (names, CA, expiry, chain as served) right under the ClearPass cert row.
- Handover includes the openssl chain check against the portal name, pasted into the as built.
- Acceptance means one login from an iPhone popup and one from an Android sign in screen, with Access Tracker open. A laptop pass doesn't count.
- New Central groups get the portal cert mapped before the SSID is pushed. Both expiries go into monitoring the day the portal goes live.

## Checklist

| Check | Where to look | What broken looks like |
|---|---|---|
| AP side portal cert is public and in date | openssl from a pre auth client | self signed, factory default, or expired |
| Chain served with intermediates | `-showcerts` | one cert only |
| Web Login Address is a SAN on the AP side cert | Web Login vendor settings against the cert | the name is only in the CN, or missing |
| Portal name resolves in pre auth | nslookup from a pre auth client | no answer |
| ClearPass cert is public and matches the portal FQDN | the portal page in a browser | a warning on the form itself |
| Pre auth role allows DNS and 443 to ClearPass and the portal address | the role in Central | page or post back times out |
| The NAS in ClearPass is the device that sends RADIUS | Network Devices, Event Viewer | unknown NAS events |
| The returned role exists | Access Tracker output against the SSID or group roles | accept, still pre auth |
| Tested from a phone popup | Access Tracker during the test | only laptops were ever tested |

## Bottom line

- Laptops pass and phones sit in pre auth: read the AP side cert before you touch a ClearPass service. If the cert's clean, check the role name next.
- Two public certs, matching names, full chains. Then test from the phone popup, because it's the only client that fails honestly.
