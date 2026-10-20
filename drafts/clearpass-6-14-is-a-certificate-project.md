---
title: ClearPass 6.14 Is a Certificate Project With an Upgrade Attached
slug: clearpass-6-14-is-a-certificate-project
date: 2026-10-12
tags: ClearPass, Security, Certificates
hero: hero-clearpass-6-14-is-a-certificate-project.svg
summary: I ran a stock 6.11.1 lab box through the 6.14 certificate rules before touching the upgrade. Of 46 certificates in its trust list, 25 are signed with SHA-1, three of those are enabled, and any one of them is enough to stop the upgrade cold.
origin: Reading the 6.14 release notes and install guide, then scanning my own 6.11 lab ClearPass against them
series: ClearPass, properly
series_order: 4
---

## Why I'm writing this

Every ClearPass major upgrade gets the same plan. Patch to the latest on your current train, take a backup, import the image, go get lunch. That plan is fine. The path hasn't really changed in years and it works when you do it the right way.

6.14 is different, and not because of the path. It's because 6.14 stops trusting things your ClearPass has been quietly trusting since the day you installed it. SHA-1 signatures, short RSA keys, old ciphers, BIOS boot. Some of that blocks the upgrade outright. Some of it lets the upgrade finish and then breaks things on Monday.

So before I touched an upgrade image, I pointed the 6.14 rules at my own lab box, a 6.11.1 CLABV that nobody has ever accused of being exotic. By HPE's own rules it wouldn't get past the pre-upgrade check.

## What my 6.11 box would trip on

I pulled the Certificate Trust List over the REST API and ran every entry through openssl. No changes, just reads.

```term
trust list entries ............ 46
  enabled ..................... 12
signed with SHA-1 ............. 25
  SHA-1 and enabled ............ 3   <<
RSA keys under 2048 bits ...... 4   (all disabled)
server certs (HTTPS, RADIUS, RadSec) .. SHA-256, 2048-bit RSA or P-256
```

The three enabled ones aren't anything I added or switched on. They're default public roots: a Go Daddy Class 2 root, a VeriSign Class 3 root from 1999, and the DigiCert Global Root CA. The four short keys are old VeriSign and Alcatel CAs at 1024 bits, all disabled. My server certificates were fine because I'd already replaced them with SHA-256 ones off my lab CA.

That's a box that has never seen a customer, and by the documented rules it would still be blocked.

## What blocks the upgrade

These stop you before the upgrade starts. Fix them in the maintenance window and you've wasted the window.

**SHA-1 anywhere in the config database.** The 6.14 install guide says a SHA-1 signed certificate in the config DB blocks the upgrade with a warning. The release notes spell out what counts: external SHA-1 certificates, default SHA-1 CAs that are enabled, any SHA-1 cert a service is using, and SHA-1 CRLs. Deprecated certs that aren't enabled get deleted after you confirm, so the disabled pile mostly takes care of itself. The enabled ones and anything you imported are on you.

**BIOS boot.** 6.14 is UEFI only, for upgrades and new installs. Any VM installed on 6.11 or 6.12 with BIOS firmware has to be moved to EFI first. I couldn't find a conversion procedure in the install guide. My read, and I'll flag it as mine rather than HPE's, is that the practical answer is a fresh 6.14 VM and a restore. My lab VM is a BIOS install, so this is exactly where mine would go.

**A hostname with an underscore.** It blocks the upgrade. Rename it first.

**Gen9 hardware.** C2000 and C3000 (Gen9) appliances can't go to 6.14 at all.

## Moving config from 6.9 and up

The path is the boring part, so I'll keep it short.

**6.11.x and 6.12.x** upgrade straight to 6.14, hotfixes included. Patch to the latest on your train first, then use Import Upgrade Image under Software Updates, the Cluster Upgrade page, or `system upgrade` on the CLI.

**6.10.x and 6.9.x** don't go direct. Back it up, restore that backup onto a fresh 6.11.x, then upgrade the 6.11 box to 6.14. If you're also stuck on BIOS boot, you're already rebuilding, so plan both moves as one.

Some things don't come along no matter which path you take:

- **Access Tracker and Log DB history.** Only config migrates. The upgrade leaves an upgrade-backup.tar.gz in Local Shared Folders, and you restore the session logs from it per server if you want them back.
- **Custom CoA dictionary attributes.** Removed. Export the dictionary before, import it after.
- **Custom service parameters** like RADIUS thread counts and the TLS session cache limit go back to defaults. Screenshot them first.
- **Offline-installed custom skins.** Not migrated.

And three things to do before you start: turn off auto backup, delete expired evaluation or subscription licenses, and set the standby publisher to false so the cluster doesn't fail over halfway through.

Plan the window honestly. HPE's sample times run 19 to 25 minutes on a C1000V and 45 to 73 on a C3000V, and the C1000 hardware appliance took up to 374 minutes in their test. On a VM, storage IOPS is one of the biggest swings, along with database size.

## What upgrades fine and breaks after

This is the part that makes Monday interesting.

**Short keys on the RADIUS or RadSec cert.** This one surprised me. A RADIUS or RadSec certificate with an RSA key under 2048 bits, or EC under 224, doesn't block the upgrade. The upgrade finishes and the service just won't start, which takes every RADIUS request on that node with it. DSA is gone too, and so are Ed25519 SSH keys. Check the key size on your server certs before the window, because the pre-check won't do it for you.

**APs and gateways doing EAP-TLS or RadSec.** The default Aruba AP and gateway device certificates are SHA-1 signed. On 6.14.0 that breaks RadSec tunnels and can fail AP EAP-TLS with an unknown CA. 6.14.1 adds the Aruba Trusted Computing Root CA back to the trust list, disabled. Enable it and AP EAP-TLS works again in non-FIPS mode. For RadSec, HPE's answer is still SHA-256 device certs. If you're going to 6.14, patch to 6.14.1 in the same window.

**Onboard and saved PFX files.** 6.14.1 won't let you create an Onboard CA with a 1024-bit key, so if yours is one, plan a 2048-bit replacement. PFX files exported with RC2-40 won't import, so re-export the ones you keep around with AES-256.

**Active Directory child or trusted domains.** If the domain was joined on 6.11 before 6.11.14 or 6.12 before 6.12.7, and Microsoft KB5066014 was already on your DCs when you joined, authentication against trusted or child domains can fail after the upgrade. Rejoin fixes it. Check your join date before the window, not after the help desk calls.

**macOS OnGuard agents.** Auto-upgrade from 6.11 or 6.12 agents fails because the agents are now signed with an HPE certificate. Push the new agent another way. 32-bit OnGuard is gone too.

**FIPS mode clients.** In FIPS mode, TLS clients have to support Extended Master Secret or they get rejected. That covers RADIUS, captive portal, RadSec and the admin GUI.

**Subscriber certs on the publisher.** One thing that got easier: upgrading from 6.11 or 6.12 adds the subscribers' HTTPS(ECC) certificates to the publisher's trust list for you.

**Rolling back.** If you switch boot images afterwards, activate the target with `system boot-image -a <partition>` or secure boot won't let it start. From 6.11.14 you can only go back to 6.11.14.

## Test it or it doesn't count

Before the window:

- Trust list sorted by enabled, then every enabled entry checked for its signature algorithm. SHA-1 certs you imported get replaced, default SHA-1 roots get disabled.
- Every server certificate (HTTPS RSA and ECC, RADIUS, RadSec) checked for SHA-256 or better and a key of 2048 bits or more.
- Onboard CA key size checked if you use Onboard.
- Hostname checked for underscores, VM firmware checked for UEFI.

After:

- One real PEAP login against each AD domain you use, child domains included, in Access Tracker with the right role. Not the test button.
- One AP doing EAP-TLS and one RadSec tunnel up, if you run either.
- Event Viewer checked for certificate warnings.
- A fresh backup taken on 6.14.

## Checklist

| Step | When | Done when |
|---|---|---|
| Patch to latest 6.11.x or 6.12.x | Before | Version shows the latest patch on the train |
| 6.9 or 6.10: restore onto fresh 6.11 | Before | 6.11 box running the restored config |
| BIOS VM: plan rebuild on UEFI | Before | New 6.14 VM boots UEFI |
| Trust list SHA-1 cleanup | Before | No enabled SHA-1 entries left |
| Server and Onboard certs | Before | SHA-256, 2048-bit RSA or P-256 |
| Hostname | Before | No underscores |
| Export CoA dictionary, note service params | Before | Files saved off the box |
| Auto backup off, expired licenses gone, standby publisher false | Before | All three confirmed |
| Upgrade to 6.14, patch to 6.14.1 | During | All nodes on 6.14.1 |
| Restore session logs if you need history | After | Access Tracker shows old records |
| AD auth per domain, AP EAP-TLS, RadSec | After | Real accepts in Access Tracker |
| Backup on 6.14 | After | Export saved off the box |

## Bottom line

The 6.14 upgrade isn't hard. The certificate store is. Scan your trust list and server certs a week before the window, fix the SHA-1 and short keys while nothing is on fire, and patch to 6.14.1 in the same window. Then don't close the window until a real user from every domain gets on.
