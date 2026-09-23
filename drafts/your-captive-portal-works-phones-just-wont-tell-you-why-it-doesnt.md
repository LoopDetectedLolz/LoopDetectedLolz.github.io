---
title: Your Captive Portal Works, Phones Just Won't Tell You Why It Doesn't
slug: your-captive-portal-works-phones-just-wont-tell-you-why-it-doesnt
date: 2026-09-22
tags: ClearPass, Captive Portal, Aruba Central, Certificates
hero: hero-your-captive-portal-works-phones-just-wont-tell-you-why-it-doesnt.svg
summary: Laptops clear the ClearPass Guest login, phones sit in pre auth forever. It's the cert on the AP or gateway nine times out of ten, and Access Tracker tells you which of three problems you've got in about a minute.
origin: An Airheads thread where every laptop logged in and every phone stalled, plus an older one asking why a guest portal needs two certs
---

## Why I'm writing this

Somebody on Airheads had a ClearPass Guest portal on a Central managed network. Laptops sailed through. Phones loaded the page, filled it in, tapped Log In, and sat in the pre auth role until the battery died.

They'd checked the redirect, DHCP and DNS. All fine. That's the tell. When one class of client works and another doesn't, the policy isn't the suspect. The client is.

I've watched this eat two days on a customer site. The fix took about eleven minutes once someone looked at the cert instead of the service rules. An HPE employee on the thread said the thing I wish more people said: work out where in the guest workflow the login aborts and the fix is usually trivial. So here's the workflow, and the one spot on it where phones die quietly.

## Where the login actually dies

A ClearPass Guest login isn't one hop. It's three, then RADIUS.

1. The AP or gateway redirects the phone to the ClearPass portal.
2. ClearPass serves the form.
3. The form posts the credentials back to the AP or gateway's captive portal name. Only then does the AP or gateway send RADIUS to ClearPass.

Everybody looks at hop one, because that's the page you can see. Hop three is the one that fails. It hits the securelogin name, and whatever cert lives behind it.

If that cert is self signed, expired, missing its intermediate, or its name doesn't match the address the form posts to, the client has to decide whether to carry on. A laptop browser asks the human. The human clicks Advanced, then Proceed, then forgets they did. Nobody learns anything.

The popup on a phone isn't that forgiving. In my experience the iOS captive network assistant gives you nothing to click past, and Android's sign in screen may flash a warning but won't finish the login inside the popup. No RADIUS request goes out. From ClearPass's side, the phone never tried. That's the silent part. I'll flag that as what I've seen in the field, not something Apple or Google document for this case.

The same HPE employee added a second trap: laptops that have met the intermediate CA before can build the chain themselves, and a phone that hasn't won't. So the cert can look perfect on your laptop and be broken on every phone in the building. That's the likely mechanism, not gospel. The fix doesn't care about the why.

The phone isn't misbehaving. It's the only client in the room doing exactly what the cert told it to.

## What good looks like: two certs, two names, one chain

- One publicly signed cert on ClearPass, for the page the guest sees.
- One publicly signed cert on the AP or gateway, for the name the form posts back to.
- Same CA isn't required. Real, in date, and uploaded with its intermediates is.

The Address in the Web Login page's vendor settings has to match the CN on the AP side cert. HPE's support note on Web Login NAS addresses says exactly that. Central pushes a trusted securelogin.hpe.com cert when you haven't installed your own. Put your own on and the Web Login address has to change with it, or you've built this problem on purpose.

The pre auth role needs DNS, plus HTTPS to the ClearPass portal FQDN, and that FQDN has to resolve for a client that hasn't logged in yet. You don't route the securelogin name anywhere: the AP or gateway intercepts DNS for its cert's name and answers with itself.

## Central and AOS 10, then AOS 8 in a paragraph

- **The cert is group config.** On gateways it's System, Certificates, Server Certificates, then the Captive portal certificate pick. A fresh group for the new building starts from the default, not your cert. How quietly that happens is my read, not HPE's wording.
- **Import the chain.** Upload the server cert with its intermediates in the bundle. On a laptop, with and without look identical.
- **Tunneled SSID:** the gateway proxies RADIUS for tunneled clients, so the gateway is what ClearPass hears from and what goes in as the network device. Don't spend an hour adding APs.
- **Bridged SSID or Instant:** each AP sends RADIUS, or the VC does if dynamic RADIUS proxy is on. Every source ClearPass hears from needs a network device entry. From the phone's chair, a missing one looks exactly like the cert problem.
- **Gotcha:** the role ClearPass returns has to exist on the SSID. A clean accept naming a role the AP doesn't know leaves the client stuck, and you'll blame the cert again.
- **Gotcha, once:** on Central, Cloud Guest is a built in splash page option that skips ClearPass entirely. Not this post's answer, but worth knowing before you buy a cert.

AOS 8 and Instant: same two cert rule, different menu. The old default name is securelogin.arubanetworks.com, and its CA revoked that default cert in 2016. A Web Login page carried over from an old build that still posts there is posting to a cert no phone will trust. On Instant, check what the VC presents today, not what you uploaded three firmware versions ago:

```term
show cpcert
```

## Test it or it doesn't count

This is the bit to print. Open Access Tracker, filter on the phone's MAC, then log in from the popup. Three outcomes, three problems.

- **Nothing in Access Tracker.** Check Event Viewer first. "Request from Unknown NAD" means a missing device entry. Nothing there either means the post to the AP never landed: cert or name. Stop reading enforcement profiles, they never ran.
- **An accept with a role.** The AP side is broken. Role mismatch, or the NAS isn't the device you think.
- **A reject.** You're in policy land after all, and this isn't the post you need.

On the phone, dismiss the popup, open Safari or Chrome and hit the portal by hand. Works in the real browser, maybe after a warning, and fails in the popup? That's the cert being refused where nobody can click past it. Found it.

On a laptop joined to the guest SSID, browse to `https://<SECURELOGIN-CN>/` and read the cert: CN, dates, and whether the chain completes. Use a clean browser profile, not the one that already trusts half the internet.

Good looks like: the popup logs in, the role changes, and Access Tracker shows one accept per attempt with nothing odd in between.

## What changed in my base config

- The guest SSID build sheet has a row for the AP side cert (CN, CA, expiry) next to the ClearPass cert row. Two certs, two rows, no exceptions.
- Guest portal acceptance includes one login from a phone popup with Access Tracker open. A laptop pass doesn't count.
- Both expiries go into monitoring the day the portal goes live. Guest portals break on a Saturday and nobody notices until Monday's visitor complains.
- New Central groups get the portal cert assigned before the SSID is pushed.

## Checklist

| Check | Where to look | What broken looks like |
|---|---|---|
| AP or gateway portal cert is public and in date | Central group certificate settings, `show cpcert` on Instant | Phones stall, laptops warn then pass |
| Intermediates imported with it | The uploaded bundle, a clean browser's chain view | Fine on your laptop, dead on phones |
| Web Login Address equals the cert CN | ClearPass Web Login vendor settings | No RADIUS request at all |
| ClearPass HTTPS cert is public, FQDN resolves in pre auth | ClearPass server certificate, DNS from a pre auth client | Warning on the page itself |
| Pre auth role allows DNS and 443 to ClearPass | Captive portal role on the SSID | Page never loads |
| Network device is the real RADIUS source | ClearPass network devices, Event Viewer | "Request from Unknown NAD" |
| Returned role exists on the SSID | Access Tracker output vs SSID roles | Accept logged, client stuck |
| Tested from a phone popup | Access Tracker filtered on the MAC | Only laptops ever tested |

## Bottom line

Laptops log in and phones don't: it's the cert on the AP side nine times out of ten. The tenth is the role name.

Two public certs, matching names, full chain. Then test from the phone, because the phone is the only client that tells you the truth by saying nothing.
