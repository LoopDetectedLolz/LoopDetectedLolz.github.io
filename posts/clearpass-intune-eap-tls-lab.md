---
title: Your ClearPass Intune Integration Probably Authenticates Nothing
slug: clearpass-intune-eap-tls-lab
date: 2026-09-09
tags: ClearPass, Intune, EAP-TLS, NAC
hero: hero-intune-tls.svg
summary: Most ClearPass and Intune builds look up a MAC address and call the result authentication. Here's a full lab build that fixes that, with SCEP, OCSP, jailbreak checks, quarantine and a revocation test you can actually run.
origin: A lab build, because I got tired of not being able to answer what the Intune integration actually proves
---
I built this in the lab because I kept hearing the same sentence and it kept bothering me. "We authenticate devices against Intune."

You don't. Nobody does. Intune doesn't have a RADIUS server in it.

What people mean is that their RADIUS server looks up a device in Intune and reads back some attributes. That's a lookup. It's useful, I use it, but it's authorization, and if you built it the way most guides tell you to then the thing anchoring the whole policy is a MAC address the client just told you.

So this is the lab I built to get it right, written up so you can build it too. Both halves, Intune and ClearPass, from empty VMs. If you only have one of the two environments, the Intune half stands on its own and so does the ClearPass half.

Fair warning on length. This is a build guide, not a hot take. Skip to the test matrix at the bottom if you just want the part where you break things.

## The two questions

A RADIUS server answers two questions and they're not the same question.

**Who is this?** That's authentication. Something has to prove it holds a secret. A password, or a private key.

**What are they allowed to do?** That's authorization. Roles, VLANs, ACLs, and every context source you can bolt on.

The Intune integration only ever answers the second one. It is a context source. When ClearPass asks Intune "is this thing compliant," Intune answers based on a record it looked up, and the only reason ClearPass thinks that record belongs to this client is whatever key it used for the lookup.

In the default build, that key is the MAC address.

Sit with that for a second. Your compliance policy, your jailbreak check, your entire "only managed devices get on the network" story, hanging off a field the client puts in a frame header. Spoof the MAC of a compliant device and you inherit its compliance state. And that's the attacker case. The boring case is worse in practice: MAC randomization means the compliant device shows up with a MAC that isn't in the endpoint database at all, and your policy quietly falls through to whatever your catch-all rule does.

So the goal of this lab is to make the authentication real, and then key the authorization to the authentication instead of to a header field.

## What you need

Everything here runs as VMs on one host. I used about 24 GB of RAM total.

| Piece | What it does | Notes |
|---|---|---|
| ClearPass Policy Manager | The RADIUS server | Lab VM. 6.11 minimum for what's below, 6.12 or newer if you want Entra device group lookups |
| Windows Server (AD DS + AD CS) | Domain and issuing CA | Must be an Enterprise CA. Standalone isn't supported by the connector |
| Windows Server (NDES) | SCEP endpoint | Domain joined, same forest as the CA, **not** the CA and **not** a DC |
| Intune tenant | Issues the profiles | A trial tenant works. So does a Microsoft 365 developer tenant |
| A NAS | Wireless controller, AP or switch | Optional, see below |
| Test clients | Windows 11, an iPhone | The iPhone is for the jailbreak section |

That NAS row says optional on purpose. You do not need a controller to test EAP-TLS. `eapol_test`, which ships with `wpa_supplicant`, will drive a full EAP-TLS conversation straight at ClearPass from a Linux box and print you the result. It's the single best thing in this lab because it takes the AP, the client supplicant and the driver out of the picture and leaves you looking at exactly one thing.

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

```
eapol_test -c /tmp/eaptls.conf -a 192.0.2.10 -p 1812 -s <SHARED-SECRET> -r 0
```

`SUCCESS` or `FAILURE` on the last line, and the full RADIUS exchange above it. You will run this a lot in the revocation section.

Addressing below is RFC 5737. Substitute your own.

## Part 1: teach Intune to hand out certificates

Intune does not have a CA. Intune has a way to tell devices to go get a certificate from your CA. That's all SCEP is here. If you have an on-premises Microsoft CA, that means NDES plus the Certificate Connector for Microsoft Intune.

Yes, the cloud management story still needs an on-premises Windows box. I'll come back to that.

### The CA and the template

On the issuing CA, duplicate a template and set it up as the SCEP template. The settings that matter:

- **General**: uncheck *Publish certificate in Active Directory*. Give it a display name you'll recognise.
- **Subject Name**: *Supply in the request*. This looks alarming. It isn't, because the Intune policy module on the NDES server validates the request against a signed challenge blob before anything gets issued.
- **Extensions**: Application Policies must include *Client Authentication*. Add nothing you don't need.
- **Extensions, for iOS and macOS templates**: edit Key Usage and make sure *Signature is proof of origin* is **not** selected.
- **Security**: the NDES service account needs *Read* and *Enroll*.

Then publish it: *Certificate Templates > Action > New > Certificate Template to Issue*.

Now the setting everybody forgets, and it's the one that quietly breaks revocation two weeks later. On the CA, right click the CA name, *Properties*, *Security*, and grant **Issue and Manage Certificates** to either the NDES server's machine account or the NDES service account. Without it, Intune will happily tell you it revoked a certificate and the CA will never hear about it.

Validity period: Microsoft's guidance is five days minimum, and Intune supports up to 24 months. In the lab I set the template to one year and let the profile ask for less. Under five days and the MDM agent can reject the certificate for being nearly expired before it even installs.

### NDES

Add Roles and Features, *Active Directory Certificate Services*, tick **Network Device Enrollment Service**, untick *Certification Authority*. IIS comes along with it. Confirm these are present:

- Web Server > Security > Request Filtering
- Web Server > Application Development > ASP.NET 3.5 (installs .NET 3.5, add HTTP Activation)
- Web Server > Application Development > ASP.NET 4.7.2 (core feature, ASP.NET 4.7.2, and WCF Services > HTTP Activation)
- Management Tools > IIS 6 Management Compatibility > IIS 6 Metabase Compatibility
- Management Tools > IIS 6 Management Compatibility > IIS 6 WMI Compatibility

Add the NDES service account to the local **IIS_IUSRS** group. Then run the AD CS Configuration wizard, pick the NDES role service, give it the service account, and point it at your issuing CA.

Then the registry. This one is a classic:

```
HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography\MSCEP\
```

Set the value that matches your template's Purpose (from its Request Handling tab) to the template **name**, not the display name. Signature purpose sets `SignatureTemplate`, Encryption sets `EncryptionTemplate`, Signature and encryption sets `GeneralPurposeTemplate`. Get the name wrong and you get a request that's rejected with nothing useful in the log.

Reboot the server afterwards. Not `iisreset`. The docs are explicit about this and I ignored them once, so now I don't.

Then request a server authentication certificate, bind it to the Default Web Site on 443 in IIS, and browse to:

```
https://<NDES-FQDN>/certsrv/mscep/mscep.dll
```

You should get the NDES page. A **503** here almost always means the app pool died because the service account is missing a permission.

Install the Certificate Connector on the NDES server. Not on the CA. The connector is explicitly unsupported on the issuing CA and it also means your CA would be one hop from the internet, which is a terrible idea on its own merits.

### Publishing NDES

For a lab on one subnet you can skip this. For anything resembling reality, put NDES behind a reverse proxy: Entra application proxy, Web Application Proxy, or a third party.

Two things bite people here.

**Pre-authentication must be set to Passthrough.** SCEP can't do pre-auth, full stop. Whatever your proxy calls it, it needs to be off.

**The proxy has to handle long URIs.** The certificate request rides in the query string and can reach 40 KB. A proxy with a stock URI limit will chop it and you'll get a failure with no obvious cause.

If you browse directly to the published NDES URL and get **403 Forbidden**, that's correct. The Intune policy module does that deliberately. It's not a misconfiguration, it's the module refusing to talk to anything that isn't a well formed Intune request.

### The trusted root profile

Devices > Configuration > Create > platform > *Trusted certificate*. Upload your root CA. If you have a two tier PKI, this is the top level root that validates your issuing CA.

Deploy it to the same group as the SCEP profile. Deploy it **first**. A SCEP profile references the trusted certificate profile directly and it goes nowhere without it.

### The SCEP profile, and the variables that matter

Devices > Configuration > Create > platform > *SCEP certificate*.

For a Windows device certificate:

| Setting | Value | Why |
|---|---|---|
| Certificate type | Device | Lands in the Local Computer store |
| Subject name format | `CN={{AAD_Device_ID}}` | The Entra device ID. Stable, and it's what you'll key the Intune lookup on |
| SAN | URI = `AzureDeviceId://{{AAD_Device_ID}}` | Gives ClearPass a second place to find the ID |
| Key storage provider | Enroll to TPM KSP, otherwise fail | Non negotiable, see below |
| Key usage | Digital signature, Key encipherment | Match your template |
| Key size | 2048 | 4096 does not work with a hardware TPM. Software KSP only |
| Extended key usage | Client Authentication | |
| Renewal threshold | 20 | Renews at 80 percent of life |
| SCEP Server URL | `https://<NDES-FQDN>/certsrv/mscep/mscep.dll` | |

**Do not use `CN={{DeviceId}}` on Windows.** Microsoft's own documentation says to avoid it, because in some cases a certificate with that subject name causes Intune sync on the device to fail. Use `{{AAD_Device_ID}}` (or its alias `{{AzureADDeviceId}}`) instead.

That TPM row is the whole ballgame. "Enroll to TPM KSP if present, otherwise Software KSP" sounds like sensible defensive configuration and it isn't. The software KSP writes an exportable key to disk. If your device authentication can be copied off the device with a script then it isn't device authentication, it's a shared secret with extra steps. Set it to fail, then go find out which of your machines have no usable TPM. Better to know.

While we're on things that can be lied about, Microsoft puts this warning right in the SCEP docs, and it's worth reading twice: device properties like **IMEI**, **SerialNumber** and **FullyQualifiedDomainName** used in the subject or SAN "could be spoofed by a person with access to the device." Build the identity out of the Entra device ID, not out of the serial number.

For a user certificate, same profile type with Certificate type set to *User*, `CN={{UserPrincipalName}}`, and a SAN of UPN = `{{UserPrincipalName}}`.

### Order of deployment

Trusted root, then SCEP, then the Wi-Fi or wired profile that tells the device to actually use the certificate. That last one is the one people forget and then spend an afternoon wondering why a device with a perfectly good certificate is still sitting there asking for a password.

## Part 2: make ClearPass trust it properly

### Trust list

Import the root CA and the issuing CA into the ClearPass trust list. Mark them for the EAP usage. Don't import the client certificate. I've watched someone do it and then wonder why one laptop worked.

### The EAP-TLS method

Duplicate the built in `[EAP TLS]` method under *Configuration > Authentication > Methods* and work on the copy. Never edit the built in one, you will want it back.

Two settings decide whether this is real.

**Certificate Comparison.** By default, EAP-TLS in ClearPass validates the chain and stops. That means any certificate from a CA you trust gets in. If your issuing CA also signs certificates for web servers, VPN, or anything else, all of those are now valid Wi-Fi credentials. Certificate comparison forces ClearPass to check the identity in the certificate against a record in an authorization source, so the certificate has to belong to something you know about, not just be signed by someone you trust.

**Verify Certificate using OCSP.** Set it to **Required**. More on that next.

### The service

Wireless 802.1X service, EAP-TLS method, and for authentication source you want the sources you'll be checking the certificate identity against. Add your NAS as a network device with a shared secret and the right vendor.

Point `eapol_test` at it and get a `SUCCESS` before you build a single enforcement rule. Every extra thing you add from here can only make this fail, so establish that it passes first.

## Part 3: OCSP, and why the CRL isn't enough

A certificate is a claim that was true when it was signed. Revocation is how you find out it stopped being true. If you don't check revocation, then a certificate you revoked this morning still works this afternoon, and it keeps working until it expires. On a 24 month certificate, that's not a gap, that's a career.

**CRL** is a list your CA publishes on a schedule. ClearPass downloads it and caches it. Between publications it's stale. Your effective revocation delay is the CRL publication interval, and the default on a Microsoft CA is a week.

**OCSP** is a per certificate question asked at authentication time. The answer is current.

Set the EAP-TLS method to OCSP **Required**, not Optional. Optional means "check, and if the responder doesn't answer, let it through." That's a revocation check that an attacker turns off by making one host unreachable. Required means a dead responder blocks authentication, which is a real availability tradeoff and you should know you're making it. Make the responder redundant instead of making the check optional.

Leave ClearPass taking the OCSP URL from the certificate's Authority Information Access extension if you can, so a certificate carries its own answer location. There's an override field for when your responder lives somewhere the AIA doesn't point, which in a lab is often.

Keep the CRL configured as well. OCSP first, CRL as the backstop. Note that ClearPass wants the CRL over HTTP, so if your CA is only publishing to an LDAP distribution point you need to add an HTTP one and republish.

Prove the responder works before you trust it. From any box with `openssl`:

```
openssl ocsp -issuer issuing-ca.pem -cert device.pem \
  -url http://ocsp.lab.example/ocsp -resp_text -noverify
```

You want `Cert Status: good`. You'll want to run this again in a few minutes and see `revoked`.

## Part 4: the authorization half, keyed properly

Now the Intune side.

ClearPass gets Intune data one of two ways and you probably want both.

**Periodic sync.** ClearPass polls Intune and writes attributes into the endpoint database. Cheap at authentication time because it's a local read. Stale by definition. Install it on one node.

**Real time authorization source.** An HTTP authorization source that calls Intune during the authentication. Current, but you've put a cloud API call in the critical path of every association. If you run it, it has to be installed on every node that processes authentications, and every node's copy has to be set to the same address, because the authorization source config propagates cluster wide.

The sensible build is both: sync nightly for the bulk, real time for the lookups the sync missed, and on newer ClearPass there's a TTL cache on the real time queries so you're not hammering the tenant.

### The Entra app registration

App registrations > New registration. Under API permissions, Microsoft Graph > **Application permissions**:

- `DeviceManagementManagedDevices.Read.All`
- `DeviceManagementManagedDevices.PrivilegedOperations.All` if you want ClearPass to be able to trigger device actions

Grant admin consent. Save the Application (client) ID, the Directory (tenant) ID and the client secret.

Put a calendar reminder on the secret expiry. A client secret maxes out at 24 months, and when it lapses the sync stops and enforcement changes behaviour with no alarm that says "your certificate infrastructure is fine, your context source expired." If your ClearPass version supports connecting to Entra with a certificate instead of a secret, do that.

### The bit that fixes the MAC problem

Once the sync is running you get attributes on the endpoint record with names like *Intune Compliance State*, *Intune Jail Broken*, *Intune Azure AD Device Id*, *Intune Management Agent*, *Intune Managed Device Owner Type* and *Intune User Principal Name*.

The endpoint database is keyed on MAC. That's the problem from the top of the post.

The fix is to stop asking "what do we know about this MAC" and start asking "what do we know about the device ID in this certificate." The certificate is signed. The MAC isn't.

ClearPass exposes the certificate fields as attributes you can reference in a filter:

- `%{Certificate:Subject-CN}`
- `%{Certificate:Subject-AltName-URI}`

So you build an authorization source that looks up the Intune record by the ID in the certificate. Against the local endpoint database that's a generic SQL source pointed at `tipsdb`, with a filter along the lines of:

```
WHERE attributes->>'Intune ID' = LOWER('%{Certificate:Subject-CN}')
```

Against Intune directly it's the HTTP authorization source with the device ID substituted into the query instead of the MAC. Newer ClearPass will parse the device ID out of the comma separated SAN URI field for you, which saves a regex you'd otherwise have to write and maintain.

Either way, the property you now have is the one that was missing: the compliance state you're enforcing on belongs to the device that just proved it holds a private key. That is the difference between authorization and authentication theatre, and it is one filter string.

## Part 5: jailbreak, and what ClearPass can actually see

ClearPass cannot detect a jailbroken device. Nothing on the network can. There's no packet that says "this phone is rooted." What ClearPass can do is read Intune's opinion, and Intune's opinion comes from the management agent on the device.

So the chain is: Intune compliance policy has a jailbreak rule, the agent evaluates it, the device gets marked non compliant, ClearPass reads that state, ClearPass acts.

In Intune: Devices > Compliance > Create policy > iOS/iPadOS. Under **Device health**, set **Jailbroken devices** to **Block**. As measured in September 2026 this setting is documented as supported for iOS 17.0 and later, along with **Require the device to be at or under the Device Threat Level**, which is the same idea handed off to a mobile threat defence product. Android has the equivalent rooted device setting.

Give it no grace period. A grace period on a password complexity rule is reasonable. A grace period on "the security model of this device has been dismantled" is not.

Then in ClearPass the check is boring, which is the point:

```
Authorization:[Intune]:Intune Compliance State  EQUALS  Compliant
Authorization:[Intune]:Intune Jail Broken       NOT_EQUALS  True
```

Two things to be honest about here.

A jailbroken device is a device where the user has root. The Intune agent runs on that device. Detection is a best effort check running inside the environment it's checking, and the jailbreak community's entire business is defeating exactly this. Treat it as a filter that catches the careless, not a control that stops the determined.

And second, this only works if the agent checked in. Which brings us to the failure mode nobody tests: what does your policy do when the Intune lookup returns nothing at all? Not "non compliant." Nothing. Device isn't enrolled, or the sync is broken, or that expired client secret. Write the rule for that case explicitly, and make the default deny, because a policy that only handles Compliant and NonCompliant has a third branch you didn't write.

## Part 6: quarantine that can actually remediate

Two enforcement profiles, minimum.

**Full access.** Certificate valid, OCSP good, Intune says compliant, not jailbroken. Production role.

**Quarantine.** Everything else that authenticated but failed a posture check.

The design question that matters is what the quarantine role can reach, and it's the one people get backwards. A device is quarantined because it's non compliant. For it to stop being non compliant, the Intune agent has to check in, download policy, do whatever remediation is required, and report back. If your quarantine role blocks the Microsoft endpoints, that device is in quarantine permanently and the only exit is a human with a cable.

So the quarantine role needs DNS, DHCP, whatever your remediation page is, and the Intune and Entra service endpoints. Nothing else. Not "internet minus a few things." Allowlist it.

On the enforcement side you want a role and a session bounce. Import the RADIUS Dynamic Authorization templates for your NAS platform under *Administration > Dictionaries > RADIUS Dynamic Authorization Templates*, then build the enforcement profiles under *Configuration > Enforcement > Profiles*.

The bounce matters because of a timing problem that's easy to miss. A device authenticates at 09:00 as compliant. At 09:20 the user jailbreaks it, or drops off VPN, or fails a policy. Intune notices. ClearPass gets the update. And the device carries on using the session it was granted at 09:00, because RADIUS enforcement happens at authentication and nothing about a compliance change generates a new one.

You need something to force a reauthentication. A post-auth action that fires a CoA when the endpoint's compliance attribute changes, or a session timeout short enough that the window is acceptable, or both. Pick a number and know what it is. "It'll pick that up eventually" is not a number.

## Part 7: revoke it, and prove it

This is the part I actually built the lab for, because the revocation path has five links and four of them fail silently.

The chain: you retire the device in Intune, Intune tells the connector, the connector revokes at the CA, the CA updates its database, the OCSP responder answers "revoked," ClearPass denies at the next authentication.

### The test

**1. Get a baseline.** Run `eapol_test`, confirm `SUCCESS`, and note the certificate serial number.

**2. Confirm OCSP says good.** Run the `openssl ocsp` command from Part 3. `Cert Status: good`.

**3. Revoke it.** In Intune, retire the device. Or remove it from the group the SCEP profile targets, which is the subtler test and the one closer to what actually happens when someone leaves.

**4. Check the CA, not Intune.** This is the step people skip, and it's the step that catches the missing permission.

```
certutil -view -restrict "SerialNumber=<SERIAL>" -out "SerialNumber,Disposition,RevocationDate"
```

If Intune says revoked and the CA says the certificate is still issued, go back to Part 1 and grant *Issue and Manage Certificates*. Nothing downstream will ever work until that's fixed, and nothing will tell you.

**5. Force a CRL publish** so you're not waiting on the schedule:

```
certutil -crl
```

**6. Ask the responder again.** `Cert Status: revoked`, with a revocation time.

**7. Reauthenticate.** Run `eapol_test` again. You want `FAILURE`, and you want ClearPass Access Tracker to show the OCSP check as the reason. If it shows `SUCCESS`, your OCSP setting is Optional, or ClearPass has a cached response, or it's falling back to a stale CRL. All three are worth finding now.

**8. Check the existing session.** If you had a live client on the network through all of that, go look at it. It's probably still online. Revocation is evaluated at authentication. Everything in Part 6 about CoA applies here too, and revoking a certificate does not drop a session by itself.

### What the revocation matrix actually says

Intune's behaviour is per platform and per action, and "revoked" and "removed" are different outcomes. On Windows, iOS and macOS, a SCEP certificate is both revoked and removed on unenroll, wipe, retire, removal from the targeted Entra group, or removal of the profile from the group assignment. Changing the SCEP profile revokes the old certificate.

Two traps.

**Losing an Intune licence doesn't revoke anything.** Neither does an admin pulling the licence, or removing the user from Entra ID. The certificate stays on the device and stays valid. Microsoft's documented order of operations is wipe or retire the device **first**, then remove the user from the directory. Do it the other way round and you've orphaned a valid credential. Given that offboarding usually starts in the directory, this is worth writing into whatever runbook your identity team uses.

**Android Enterprise Device Owner and Android AOSP cannot be revoked by Intune at all.** Fully managed, dedicated, corporate owned work profile. The documentation is direct about it: you manage revocation through an external process or at the CA yourself. If your kiosk fleet is Android dedicated, your revocation story for those devices is a person opening the CA console. Find that out in the lab, not during an incident.

And if you're using a third party CA rather than a Microsoft one, check what your CA does with Intune's revocation list. SCEP certificates are removed but not revoked with a third party CA unless the CA specifically implements the fetch-and-revoke behaviour.

## The cloud managed device question

Here's where this ties back to the top.

A Microsoft Entra joined device, cloud only, no on-premises AD. There's no machine account. There's no domain to check against. Historically that's exactly why people fell back to "authorize by Intune lookup," because the thing they used to authenticate with was gone.

It doesn't have to be. The device still gets a SCEP device certificate with a TPM bound private key, and EAP-TLS with that certificate is a stronger authentication than machine password auth against a domain ever was. There's no domain in the path because there doesn't need to be one. ClearPass validates the chain, checks OCSP, and reads the Entra device ID out of the subject. That's genuine device authentication with no on-premises identity involved.

With one asterisk, and it's a good one to know because it makes people think cloud only certificates are broken when they aren't.

The `{{OnPremisesSecurityIdentifier}}` variable, the one that satisfies the strong certificate mapping requirements from KB5014754, is documented as supported in **device** certificates only for Entra **hybrid** joined devices. A cloud only device has no on-premises SID to put in there. So a cloud only device certificate can't satisfy strong mapping.

That matters to a Windows domain controller doing certificate based authentication. It does not matter to ClearPass, which is validating a chain and a revocation status, not consulting AD for a SID. Two different problems that happen to involve the same certificate. If someone tells you cloud only devices can't do certificate authentication, they're describing the KDC's problem, not yours.

### Getting user and device together

Device certificate proves the device. User certificate proves the user. Most people want both, and want to know both in a single session rather than inferring one from the other.

That's EAP chaining, and on ClearPass it's TEAP, with EAP-TLS as both inner methods. Deploy a device SCEP profile and a user SCEP profile, and the supplicant presents both inside one tunnel. ClearPass ends up with a machine identity and a user identity in the same authentication and you can write the policy you actually wanted: this user, on this device, both of them proven, both of them checked against Intune.

TEAP needs a modern ClearPass and a Windows 10 build 2004 or later supplicant. It's fussier to get working than plain EAP-TLS. Build plain EAP-TLS first, confirm it, then add the second method. Don't debug both at once.

For authorization on cloud only devices, newer ClearPass can query Entra ID for device group membership as well as user group membership, which closes the last gap where people were falling back to AD.

## Test matrix

Everything below should be a distinct, observable outcome. If two rows produce the same result, one of your rules isn't doing anything.

| Scenario | How to trigger it | Expected |
|---|---|---|
| Healthy managed device | Baseline | Full access role |
| No certificate | Client with no cert | Reject at EAP |
| Certificate from an untrusted CA | Self signed cert | Reject, chain failure |
| Valid cert, unknown to Intune | Issue manually, skip enrollment | Quarantine, not full access |
| Revoked certificate | Retire in Intune, republish CRL | Reject, OCSP failure in Access Tracker |
| Revoked, but responder is down | Block the responder | Reject if OCSP is Required. If it passes, yours is set to Optional |
| Non compliant device | Break a compliance rule | Quarantine role |
| Jailbroken iOS | Compliance policy set to Block | Quarantine role |
| Compliance changes mid session | Break a rule on a connected client | Session bounced by CoA, or note how long it took |
| Quarantine can self remediate | Fix the device from inside quarantine | Reaches Intune, becomes compliant, gets bounced to full access |
| Intune lookup returns nothing | Stop the sync, clear the endpoint | Explicit deny, not a fall through |
| Client secret expired | Set a short expiry, wait | You should find out from an alert, not from users |
| MAC spoofed | Clone a compliant device's MAC | No change in outcome. If it grants access, your authorization is still keyed on MAC |

That last row is the whole post. Run it before you build anything, and run it again at the end. If the result changes, you fixed something real.

## Bottom line

The Intune integration is a context source and it's a good one. It is not authentication and no amount of documentation calling it "Intune authentication" makes it one.

Make the authentication real with EAP-TLS and a TPM bound key. Make revocation real with OCSP set to Required and a tested path from Intune all the way to the responder. Then key the Intune lookup to something inside the signed certificate rather than to a MAC address, and the authorization inherits the strength of the authentication instead of undercutting it.

Build the lab. The revocation test in Part 7 takes twenty minutes and I'd bet a decent lunch it fails the first time on the CA permission.
