---
title: Your ClearPass Intune Integration Probably Authenticates Nothing
slug: clearpass-intune-eap-tls-lab
date: 2026-09-09
tags: ClearPass, Intune, EAP-TLS, NAC
hero: hero-intune-tls.svg
summary: Most ClearPass and Intune builds look up a MAC address and call the result authentication. Here's the version where the certificate does the authenticating, Intune does the authorizing, and the two are tied together by something the client can't lie about.
origin: A lab build, because I got tired of not being able to answer what the Intune integration actually proves
series: ClearPass, properly
series_order: 2
---
I built this in the lab because I kept hearing the same sentence and it kept bothering me. "We authenticate devices against Intune."

You don't. Nobody does. Intune doesn't have a RADIUS server in it.

What people mean is that their RADIUS server looks up a device in Intune and reads back some attributes. That's a lookup. It's useful, I use it, but it's authorization, and if you built it the way most guides tell you to then the thing anchoring your whole policy is a MAC address the client just told you.

So this is the corrected version of that build. Intune hands out a certificate and answers compliance questions. ClearPass authenticates the certificate and then asks Intune about the device it just proved it was talking to. Nothing else changes hands.

## The two questions

A RADIUS server answers two questions and they're not the same question.

**Who is this?** Authentication. Something has to prove it holds a secret. A password, or a private key.

**What are they allowed to do?** Authorization. Roles, VLANs, ACLs, and every context source you can bolt on.

The Intune integration only ever answers the second one. It's a context source. When ClearPass asks Intune "is this thing compliant," Intune answers from a record it looked up, and the only reason ClearPass thinks that record belongs to this client is whatever key it used for the lookup.

In the default build, that key is the MAC address.

## What the MAC-keyed build actually proves

Sit with that for a second. Your compliance policy, your jailbreak check, your entire "only managed devices get on the network" story, all hanging off a field the client puts in a frame header. Spoof the MAC of a compliant device and you inherit its compliance state. That's the last row of the test matrix below, and you should run it on your own build before you take my word for it.

That's the attacker case. The boring case is worse in practice. MAC randomization means the compliant device shows up with an address that isn't in the endpoint database at all, and your policy quietly falls through to whatever your catch-all rule does. HPE's own integration guide says as much about MAC addresses being an unreliable identifier, so this isn't me picking a fight with the product. It's the product agreeing with me.

The fix is two moves. Make the authentication real, and key the authorization to the authentication instead of to a header field.

## Intune's first job: hand out a certificate

Intune doesn't have a CA either. What it has is SCEP, which is a way of telling a device to go get a certificate from your CA. With an on-premises Microsoft CA that means NDES plus the Certificate Connector for Intune, on a domain-joined box that is not the CA and not a domain controller. The connector is unsupported on the issuing CA, and putting your CA one hop from the internet is a bad idea on its own merits anyway.

Two permissions bite people here and neither one tells you when it's missing. The NDES service account needs Read and Enroll on the template. And the NDES machine or service account needs **Issue and Manage Certificates** on the CA itself, or Intune will happily tell you it revoked a certificate and the CA will never hear about it. Ask me how I know.

Deploy a trusted root profile first, because the SCEP profile references it and goes nowhere without it. Then the SCEP profile. These are the settings that matter for a Windows device certificate:

| Setting | Value | Why |
|---|---|---|
| Certificate type | Device | Lands in the Local Computer store |
| Subject name format | `CN={{AAD_Device_ID}}` | The Entra device ID. Stable, and it's what ClearPass will key the lookup on |
| SAN | URI = `AAD_Device_ID:{{AAD_Device_ID}}` | HPE's Intune extension parses the SAN URI as KEY:VALUE. Anything without a recognised key in front of it gets treated as a plain Intune DeviceId, which is not the same thing |
| Key storage provider | Enroll to TPM KSP, otherwise fail | See below |
| Key size | 2048 | 4096 isn't supported with a hardware TPM |
| Extended key usage | Client Authentication | |
| SCEP Server URL | Your published NDES URL | |

Don't use `CN={{DeviceId}}` on Windows. Microsoft's own docs say to avoid it because it can break Intune sync on the device. And don't build identity out of `{{SerialNumber}}` or `{{IMEI}}`; the same docs say those can be spoofed by someone with access to the device. The Entra device ID is the one that's tied to a record Intune controls.

That TPM row is the whole ballgame. "TPM if present, otherwise software KSP" sounds like sensible defensive configuration and it isn't. A software-backed key lives on disk under DPAPI. Microsoft doesn't document it as extractable, and in practice anyone with SYSTEM on the box can lift it with the usual tooling. That part is my own observation, not something I can point you to in a doc. If your device credential can be copied off the device then it isn't device authentication, it's a shared secret with extra steps. Set it to fail, then go find out which of your machines have no usable TPM. Better to know now.

Last, the Wi-Fi or wired profile that tells the device to actually use the certificate. That's the one people forget, and then spend an afternoon wondering why a device with a perfectly good certificate is still sitting there asking for a password.

## ClearPass's job: authenticate the certificate

Import the root and the issuing CA into the trust list and mark them for EAP. Don't import the client certificate. I've watched somebody do it and then wonder why one laptop worked.

ClearPass ships an authentication method called `[EAP TLS with OCSP Enabled]`. Copy it, name the copy, and work on that. Two settings on it decide whether this is real.

**Certificate Comparison.** The options are do not compare, compare CN, compare SAN, compare CN or SAN, and compare binary (which matches the presented certificate against one stored on the account in AD or LDAP). With no comparison, the identity in the certificate is never checked against anything, so any certificate from a CA you trust satisfies the EAP method. Authorization Required is on by default, so the identity still has to resolve in a source; what you lose is the check that this certificate belongs to that identity. If your issuing CA also signs web servers, VPN, or anything else, all of those are now valid Wi-Fi credentials. Pick a comparison, and pick the same field you're going to key the Intune lookup on.

**Verify Certificate using OCSP.** Four options: None, Optional, Required, and Required (CRL fallback). Set it to **Required**. The CRL fallback option is documented as skipping the OCSP check and using the CRL result when the responder is unreachable, which is exactly the fail-open you'd be trying to avoid. A dead responder blocking authentication is a real availability trade and you should know you're making it. Make the responder redundant instead of making the check soft. What Optional does with a dead responder isn't spelled out in the guide, so I'm not going to tell you; test it.

Leave ClearPass taking the OCSP URL from the certificate unless your responder lives somewhere the AIA doesn't point, then use the override field. Keep a CRL configured as the backstop, and if your CA publishes a delta CRL, configure both the base and the delta URL or you're only getting half the list. There's a Check Now button on the revocation list page that beats waiting on the schedule.

Point `eapol_test` at the service and get a `SUCCESS` before you build a single enforcement rule. Everything you add from here can only make it fail, so establish that it passes first.

```
# /tmp/eaptls.conf
network={
  key_mgmt=WPA-EAP
  eap=TLS
  identity="host/testclient.lab.example"
  ca_cert="/etc/lab/root-ca.pem"
  client_cert="/etc/lab/device.pem"
  private_key="/etc/lab/device.key"
}
```

```term
$ eapol_test -c /tmp/eaptls.conf -a 192.0.2.10 -p 1812 -s <SHARED-SECRET> -r 0
...
SUCCESS  <<
```

Those are ordinary `wpa_supplicant.conf` network-block keys. Add `private_key_passwd` if your key is encrypted.

## Intune's second job: authorization, keyed on the certificate

ClearPass gets Intune data two ways and you probably want both.

**The extension sync** polls Intune and writes attributes onto the endpoint record. Cheap at authentication time because it's a local read. Stale by definition. Install it on one node.

**The HTTP authorization source** calls Intune during the authentication. Current, but you've put a cloud API call in the critical path of every association. On a cluster it has to be installed on every node that processes authentications, at the same address on each, because the source config propagates cluster-wide. And its Cache Timeout defaults to zero seconds, so a stock build caches nothing and hammers the tenant. Set it.

Either way, the endpoint database is keyed on MAC, which is the problem from the top of the post. The fix is to stop asking "what do we know about this MAC" and ask "what do we know about the device ID in this certificate." The certificate is signed. The MAC isn't.

HPE's integration guide documents the HTTP source doing exactly this: the extension reads the device ID out of the certificate's SAN URI and queries Intune by that ID instead of by MAC. The filter query is one attribute:

```
%{Certificate:Subject-AltName-URI}
```

That's why the SAN format in the table above matters. Get the key wrong and the lookup is keyed on nothing.

Once the lookup returns, the rules are boring, which is the point. Two things to get exactly right, because ClearPass string compares are case sensitive and the values come straight from the Graph API:

```
Authorization:[Intune]:Intune Compliance State  EQUALS  compliant
Authorization:[Intune]:Intune Jail Broken       EQUALS  False
```

Lowercase `compliant`. I had it capitalised in an earlier version of this post and that rule matches nothing, which with a default-deny policy means it quarantines your entire healthy fleet. Or use `EQUALS_IGNORE_CASE` and stop having to care. And `EQUALS False` rather than `NOT_EQUALS True`, because Graph documents the jailbreak field as a string that defaults to empty, so it can come back blank or not come back at all, and `NOT_EQUALS True` passes both. Match the value you actually want.

Which brings up the branch nobody writes. What does your policy do when the Intune lookup returns nothing? Not "non compliant." Nothing. Device isn't enrolled, the sync is broken, the client secret expired (the portal caps those at two years, put it on a calendar). Write that rule explicitly and make it a deny. A policy that only handles compliant and noncompliant has a third branch you didn't write, and it's the one that ends up in production. The compliance state field has seven possible values, and `inGracePeriod` is the one you'll meet mid-rollout.

## Test it or it doesn't count

Every row should be a distinct, observable outcome. If two rows produce the same result, one of your rules isn't doing anything.

| Scenario | How to trigger it | Expected |
|---|---|---|
| Healthy managed device | Baseline | Full access role |
| No certificate | Client with no cert | Reject at EAP |
| Cert from an untrusted CA | Self signed cert | Reject, chain failure |
| Valid cert, unknown to Intune | Issue one manually, skip enrollment | Quarantine, not full access |
| Revoked certificate | Retire in Intune, then the steps below | Reject, OCSP shown as the reason in Access Tracker |
| Responder unreachable | Block it from ClearPass | Reject with OCSP Required. Try it with the other three settings while you're there and write down what each one did |
| Non compliant device | Break a compliance rule | Quarantine role |
| Intune lookup returns nothing | Stop the sync, clear the endpoint | Explicit deny, not a fall through |
| MAC spoofed | Clone a compliant device's MAC | No change in outcome. If it grants access, your authorization is still keyed on MAC |

That last row is the whole post. Run it before you build anything and again at the end. If the result changes, you fixed something real.

The revoked row deserves its own steps because the path has five links and four of them fail silently. Retire the device in Intune. Then check the CA, not Intune:

```term
C:\> certutil -view -restrict "SerialNumber=<SERIAL>" -out "SerialNumber,Disposition,Request.RevokedWhen,Request.RevokedReason"
  Serial Number: <SERIAL>
  Request Disposition: 0x15 (21) -- Revoked  <<
  Revocation Date: <timestamp>
  Revocation Reason: 0x0 (0) -- Unspecified
```

Column names come from `certutil -schema` on your CA. Check yours if that list errors.

If Intune says revoked and the CA still shows the certificate issued, that's the Issue and Manage Certificates permission from earlier, and nothing downstream will ever work until it's fixed. Then `certutil -crl` on the CA, Check Now on the ClearPass CRL page, `openssl ocsp` against the responder until it says `revoked`, and `eapol_test` again. You want `FAILURE`. If you get `SUCCESS`, your OCSP setting is softer than you think or ClearPass is serving a cached answer, and both are worth finding now rather than the day someone leaves.

One more thing to check while the lab's up. Revoke a certificate on a device that's already connected and go look at it. It's probably still online. Revocation and compliance are evaluated at authentication, and nothing about either one drops a session by itself. You need a CoA on compliance change, or a session timeout short enough that the window is acceptable, or both. Pick a number and know what it is.

## Bottom line

The Intune integration is a context source and it's a good one. It is not authentication, and no amount of documentation calling it "Intune authentication" makes it one.

Make the authentication real with EAP-TLS and a TPM-bound key. Make revocation real with OCSP set to Required and a tested path from Intune to the responder. Then key the Intune lookup to the device ID inside the signed certificate rather than to a MAC address, so the authorization inherits the strength of the authentication instead of undercutting it.

Build the lab. The revocation test takes twenty minutes and I'd bet a decent lunch it fails the first time on the CA permission.
