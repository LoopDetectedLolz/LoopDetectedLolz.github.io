---
title: Your ClearPass SAML Login Validates and Still Fails
slug: saml-login-validates-and-still-fails
date: 2026-09-05
tags: ClearPass, Security, Entra ID, SAML
hero: hero-saml.svg
summary: Admin MFA on ClearPass means SAML to your IdP, and every guide you find is about Onboard instead. Here are the three places an admin login fails silently, in the order to check them.
origin: A year-old Airheads thread about admin MFA, revived by someone who had "set up SSO" and couldn't log in
---

## Why I'm writing this

Every ClearPass deployment I touch now gets the same question from the security team within a week: can we put MFA on the admin GUI? The answer is yes, and the way you do it is SAML to whatever identity provider already has MFA in front of it, which these days is usually Entra ID.

That's the easy part. The part that generates forum threads is what happens next. You configure single sign-on, the login page redirects to Microsoft, you authenticate, you get bounced back to ClearPass, and it says no. No error worth reading. Just no.

Someone hit exactly this on the forums and asked what they'd missed. Turns out there are three different things you can miss, and they all fail the same way from the login page, so here they are in the order to check them.

## The two halves nobody explains together

ClearPass admin SSO is two separate jobs, and the documentation treats them as two separate pages, which is why people finish one and think they're done.

**The trust half** lives under Configuration, Identity, Single Sign-On. That's where you tell ClearPass who the IdP is, what certificate to trust, and which applications should use SSO at all. When this half is right, the SAML assertion comes back and validates.

**The privilege half** is a service. ClearPass doesn't hand out admin rights because Microsoft said you're a real person. It hands them out because a service ran, matched you, and an enforcement profile said Super Administrator or Read-only Administrator or whatever the role is. If that service doesn't exist, you're authenticated and you have nothing, and authenticated with nothing looks exactly like a failed login.

Most "SSO is set up but login fails" threads are people who built the trust half and never built the service half.

## Gate 1: does it redirect at all?

On the Single Sign-On page there's a field called Enable SSO for, and it's a list of applications (Policy Manager, Guest, Insight, Onboard, and the Guest operator login). Policy Manager has to be ticked. If it isn't, the admin login page never redirects to your IdP in the first place, and you'll sit there wondering why your carefully built Entra app never sees a request.

While you're on that page, confirm the IdP URL is the actual sign-on endpoint from the Entra enterprise app, not the tenant login page.

## Gate 2: does the assertion validate?

The Identity Provider Signing Certificate field is required, and there's a step before it: the cert has to be in the Certificate Trust List first, or it won't appear in that dropdown. Download the signing cert from the Entra app (Base64), import it under Administration, Certificates, Trust List with the Usage set to SAML, then come back and select it. It shows up with a CN of Microsoft Azure Federated SSO. Miss that and the assertion arrives, fails signature validation, and you get the same silent no.

Two more things have to agree between the two sides. The Entity ID and the Reply URL in the Entra app need to match what ClearPass publishes in its SP metadata, which you can download from the same page. They're of the form `https://<clearpass-fqdn>/networkservices/saml2/sp` and `https://<clearpass-fqdn>/networkservices/saml2/sp/acs`. Copy them out of the metadata rather than typing them; a trailing slash is enough to break it.

If you run a cluster, that FQDN is per node. Every node has its own ACS URL, and the Entra app has to carry all of them as Reply URLs, or SSO works against the publisher and fails against everything else. HPE's own Okta write-up makes the same point with Okta's "requestable SSO URLs," and it applies just as much to Entra.

And one that isn't on either page: NTP. ClearPass's own SSO doc says flatly that if the clocks are out of sync, SAML will not function. Assertions carry validity windows measured in minutes. Check `show ntp` or the Server Configuration page before you touch anything else. Call it gate zero.

## Gate 3: does anybody get a privilege?

This is the one the original thread was missing. Go to Configuration, Service Templates and Wizards, and use the Policy Manager Admin SSO Login (SAML SP Service) template. It was called ClearPass Admin SSO Login in 6.8 and earlier, which is why half the guides you'll find use the old name. It builds the service and the enforcement policy that actually maps a user to an admin privilege level. You can hand-build the same thing, and if you do, the service type is Aruba Application Authorization. The user guide describes that type as providing authorization for users of Aruba applications, sending a Generic Application Enforcement profile to grant the privilege. So: service type Aruba Application Authorization, enforcement policy type Application, enforcement profile Generic Application Enforcement pointed at Super Administrator or Read-only Administrator or whichever level you mean. I had Authentication in an earlier draft of this. HPE's own Entra write-up says Authorization, and so does the user guide.

One more thing that isn't obvious until you try group-based roles. Entra sends its group and tenant claims with long schema-style attribute names that aren't in the ClearPass SSO dictionary out of the box. To match on them you export the SSO dictionary under Administration, Dictionaries, Applications, add the attributes, and import it back. Until you do, the group claim is in the assertion (a SAML tracer will show it) and ClearPass just can't see it.

Then check what the service is matching on. Entra sends the user principal name as the Name ID by default. If your enforcement conditions or your authorization source lookup expect sAMAccountName, nothing matches, nobody gets a role, same silent failure. Either change the Entra claim to send the attribute ClearPass expects, or change the ClearPass side to look up by UPN. Pick one and write it down.

```
Configuration > Identity > Single Sign-On
  Enable SSO for: [x] Policy Manager
  IdP URL: https://login.microsoftonline.com/<TENANT-ID>/saml2
  IdP Signing Certificate: <cert already in Trust List>

Configuration > Service Templates & Wizards > Policy Manager Admin SSO Login (SAML SP Service)
  Service type:             Aruba Application Authorization
  Enforcement policy type:  Application
  Enforcement profile:      Generic Application Enforcement -> admin privilege level
                            (Super Administrator, Read-only Administrator, ...)

Administration > Certificates > Trust List
  Entra signing cert, Usage: SAML

Entra enterprise app
  Identifier (Entity ID): https://<clearpass-fqdn>/networkservices/saml2/sp
  Reply URL (ACS):        https://<clearpass-fqdn>/networkservices/saml2/sp/acs   (one per cluster node)
  Name ID:                user.userprincipalname (default)
```

## Where to look when it still fails

Access Tracker. A SAML admin login that reaches the service shows up there as an Application Auth request (HPE's own SSO write-ups show exactly that), and the reject reason tells you which gate you're stuck at. If there's nothing in Access Tracker at all, you're at gate 1 or gate 2: the request never got far enough to hit a service. A SAML tracer extension in the browser shows you the assertion itself, which is the fastest way to see whether a claim is actually being sent.

And a bit of sequencing advice straight from HPE support: enable SSO for Guest or Insight first, prove the round trip works, then tick Policy Manager. A broken SSO build on Policy Manager is a lockout, and you'd rather find gate 3 on the Insight login page.

One more setting worth knowing on the SSO page while you're building this for MFA: Force Authentication, off by default. Turn it on and ClearPass makes the IdP re-authenticate even when the admin already has a live session with Microsoft, which is usually what the security team meant when they asked for MFA on the GUI.

## Checklist

| Check | Where |
|---|---|
| Clocks in sync | NTP on every node |
| Policy Manager ticked under Enable SSO for | Configuration, Identity, Single Sign-On |
| IdP signing cert imported to the Trust List, then selected | Same page, after Certificate Trust List |
| Entity ID and Reply URL copied from SP metadata | Entra enterprise app |
| Every cluster node's ACS URL is a Reply URL in Entra | Entra enterprise app |
| Policy Manager Admin SSO Login service exists, type Aruba Application Authorization | Service Templates and Wizards |
| Generic Application Enforcement profile maps to a real admin privilege level | The service's enforcement policy |
| Group claim attributes added to the SSO dictionary, if you map roles on groups | Administration, Dictionaries, Applications |
| Force Authentication on, if MFA every time is the requirement | Single Sign-On page |
| Name ID attribute matches what the service looks up | Entra claims vs ClearPass conditions |
| Request visible in Access Tracker | Monitoring |

## Bottom line

SAML everywhere you can, RADIUS and TACACS+ where you must. That was the consensus on the thread and I agree with it. Just know that on ClearPass, SAML is two builds, not one, and the second one is the one that gives you a role.
