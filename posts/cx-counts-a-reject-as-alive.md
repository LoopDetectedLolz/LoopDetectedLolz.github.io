---
title: Your CX Switch Counts a Reject as Proof ClearPass Is Alive
slug: cx-counts-a-reject-as-alive
date: 2026-10-02
tags: ClearPass, AOS-CX, 802.1X, Security
hero: hero-edge-nac-cx.svg
summary: RADIUS tracking on AOS-CX 10.18 marks a ClearPass node reachable even when ClearPass rejects the probe, so the health check works with no account at all. Here's why I build the probe account and its own service anyway, and the rest of an edge port template for a four node cluster.
origin: Built while writing deployment templates for a four node ClearPass cluster
series: ClearPass at the Edge
series_order: 1
---

I pointed RADIUS tracking at a ClearPass node with a username that didn't exist. Access Tracker filled up with rejects, one per interval. The switch logged the server as reachable every time.

That's not a bug. A reject is an answer, and an answer is all tracking wants. HPE's own guide says it in as many words: tracking can still be performed with a user that isn't configured on the server, because an authentication failure confirms the server is reachable. It does mean the health check works whether or not you ever build the account, and that changes what the account is for.

This is the first of three posts that build the same edge port against the same four node ClearPass cluster on three switch platforms, in the same order, so you can read them side by side. This one is AOS-CX 10.18 on a 6200F or 6300M. Cisco IOS-XE and Junos follow.

## Bottom line

- **Turn on RADIUS tracking and give it its own account and service.** The switch only needs a reply to call a node alive; the account and service are there so Access Tracker stays readable and the reply means what you think it means.
- **Set `initial-auth-response-timeout 10` on every port that mixes printers and laptops.** With the defaults on my bench, a silent printer waited about 165 seconds for MAC auth. With it, about 10.
- **Give each port a critical role and a reject role.** Without them a ClearPass outage or a reject leaves the port with nothing.
- **CoA needs two lines, not one.** `radius dyn-authorization enable` plus a `radius dyn-authorization client` line per ClearPass node. Without the client line the request is dropped and only shows up as a counter.

## Four ClearPass nodes and how the switch decides one is dead

Four nodes go in one server group, and the switch walks the group in order. What decides whether it skips a node is reachability, and AOS-CX has two ways to learn it: a real request times out, or tracking finds out first.

Tracking is the one you want. With `radius-server tracking` set and `tracking enable` on each host, the switch sends its own Access-Request to every node on a timer and marks the node reachable or unreachable from the result. A client never has to wait out a dead node to discover it.

{{figure: fig-edge-cx-probe.svg | Tracking sends one probe per node per interval. Any reply marks the node reachable, an Accept or a Reject. Only silence marks it down.}}

Here's the part I didn't expect. On my bench (CX 10.18.1002 against ClearPass 6.11.1, 2026-09-26) I pointed tracking at a username ClearPass had never heard of. Every probe came back Access-Reject, and every one logged the server as reachable (event 2304). So tracking works with no account and no service on the ClearPass side. A Reject proves the node is up just as well as an Accept. If you set nothing, the switch probes as `radius-tracking-user` with an empty password, and every one of those is a reject.

So why build them? Two reasons.

First, noise. Every probe is an authentication in Access Tracker. Four nodes, one switch, a 60 second interval is 5,760 entries a day from that one switch, and if they're rejects they sit in the same filter you use to find real failures. At 300 seconds it's 1,152, which is plenty to catch a dead node in a four node cluster.

Second, a clean answer. If the probe lands in your 802.1X service, or worse in no service at all, a reject tells you the node's alive but tells you nothing about whether its policy engine works. A probe that's accepted by a service built for it is a positive answer: the node is up, the service matched, the local repository answered.

### The probe service

Build it once and every switch in the NAD group uses it.

1. **A local user.** Configuration, Identity, Local Users. Something like `svc-radius-probe`, a long random password, any throwaway role. Not an AD account: a lockout or a password expiry would make every switch decide every node is dead at once.
2. **A service, placed first.** RADIUS Enforcement (Generic). Rules: `Radius:IETF:User-Name EQUALS svc-radius-probe` AND `Connection:NAD-IP-Address BELONGS_TO_GROUP <SWITCH-NAD-GROUP>`. Authentication method `[PAP]`, source `[Local User Repository]`, enforcement `[Allow Access Profile]` and nothing else. No VLAN, no role.
3. **Open one probe in Access Tracker** and read the Input tab. Build any extra match rules from what your switch actually sends. I didn't capture the full attribute list of a CX tracking probe, so don't take my rules as complete.

Why not let it fall into the 802.1X service? The probe is plain PAP, not EAP. A typical dot1x service matches on things like NAS-Port-Type Ethernet and Service-Type Framed-User, so the probe often matches nothing and lands as "Service Categorization failed". And a MAC auth service expects the User-Name to be a MAC address. Its own service, first in the order, avoids both.

## 802.1X, then MAC auth, then the fallbacks

The default order on a CX port is 802.1X first, then MAC auth. That's the right order, and the defaults around it are wrong for a port where a printer might be plugged in.

On my bench, with `auth-precedence dot1x mac-auth` and every dot1x timer left alone, a silent client (no supplicant at all) waited **about 165 seconds** before the switch gave up on 802.1X and tried MAC auth. A printer that waits three minutes for its DHCP lease usually gives up first.

`initial-auth-response-timeout 10` under the port's dot1x authenticator cut that to **about 10 seconds**. It's the timer for the very first EAPOL response. A device that never answers is moved on quickly, and a laptop that answers is unaffected.

{{figure: fig-edge-cx-flow.svg | One port, four outcomes. A supplicant is authorized in a couple of seconds, a silent printer reaches MAC auth in about 10, a dead cluster gives the critical role, and a reject gives quarantine.}}

What that timer doesn't cover is a supplicant that starts EAP and then stalls, which is what a laptop with a broken PEAP profile does. It answered the first request, so the initial timer is already satisfied. `eapol-timeout 10` brought that case to about 122 seconds on my bench, and adding `max-eapol-requests 1` brought it to about 42.

You'll see `auth-precedence mac-auth dot1x` suggested to get printers on faster. It does: under 3 seconds. But a MAC auth accept ends the conversation, so a laptop whose MAC ClearPass knows never tries 802.1X at all. Leave dot1x first and fix the timers.

The two fallbacks:

- **All servers down.** dot1x times out, MAC auth times out, and `critical-role` applies. On my bench the client showed role `CRITICAL, Critical`, flags `--|c|-|s`, and the reason "Authentication Failed, Server-Timeout".
- **Rejected.** `reject-role` applies. I put it in a quarantine VLAN.

The switch only ever says **Server-Reject**. Never why. The reason lives in Access Tracker:

| What happened | Access Tracker |
|---|---|
| Wrong PEAP password | REJECT, error 216 "User authentication failed", alert "MSCHAP: Authentication failed" |
| Unknown MAC under [MAC AUTH] | REJECT, error 216, "[Endpoints Repository] localhost: User not found" |
| Supplicant didn't answer the retry | TIMEOUT, error 9002 "Request timed out", "Client did not complete EAP transaction" |

One more trap. If ClearPass returns an `Aruba-User-Role` the switch doesn't have, the client authenticates and is never authorized. No fallback, no log line on 10.18.1002. Role names are case sensitive and must match exactly.

## Phone and PC on one port

`aaa authentication port-access auth-mode multi-domain` gives the port one voice device and one data device. The voice device is whoever holds a role with `device-traffic-class voice`, so ClearPass decides which one is the phone by which role it returns.

{{figure: fig-edge-cx-mda.svg | Two sessions on one port. The phone's role adds the tagged voice VLAN and nothing else; the PC's VLAN comes from its own authorization.}}

Three things I'd get right first time:

1. **`allow-lldp-bpdu` on the port.** A port-access port drops LLDP from a client that hasn't authenticated. Without it, a phone that needs LLDP-MED to learn its voice VLAN never hears it.
2. **The phone's role only adds the voice VLAN.** `vlan trunk allowed <VOICE-VLAN>` and `device-traffic-class voice`. Don't pin `vlan trunk native` in it. The native VLAN is the data device's business, and a printer or a quarantined PC behind the phone should still land where its own authorization says.
3. **Mark the voice VLAN with `voice`.** That's what makes LLDP-MED advertise it as the voice network policy.

And one thing I'd avoid: an LLDP-MED device profile as a way to get phones on without ClearPass. On a secured port that's an open door, because any device can send the TIA OUI `00-12-BB` in an LLDP-MED frame and land in the phone role. If what you're worried about is an outage, `critical-voice-role` is the tool: HPE documents it for a multi-domain port whose servers go unreachable at reauthentication, so a phone that was working keeps its voice VLAN.

## CoA, accounting and TACACS

Three conversations, three ports, two directions. The one that trips people is CoA, because it's the only one ClearPass starts.

{{figure: fig-edge-cx-ports.svg | Who starts each conversation. The switch talks to ClearPass on 1812, 1813 and 49; ClearPass talks to the switch on 3799. The trap is command authorization turned on before ClearPass has a policy.}}

**CoA.** `radius dyn-authorization enable` turns on the listener on UDP 3799. It still drops everything until each ClearPass node is named with `radius dyn-authorization client <CPPMn-IP> secret-key ... vrf <MGMT-VRF>`. Without that line the request isn't refused, it's discarded and counted as an invalid client address in `show radius dyn-authorization`, which is easy to miss.

Pick the right enforcement profile on the ClearPass side. On my bench the switch's default strict mode NAKed a request that carried only Calling-Station-Id (Error-Cause Missing-Attribute). The ArubaOS Wireless Terminate Session profile sends exactly that and fails. The AOS-CX Disconnect profile worked (Disconnect-ACK), and the AOS-CX Bounce Switch Port profile was the only one the switch counted as a CoA. Bounce is the one to avoid on a phone port.

**Accounting.** `aaa accounting port-access start-stop interim 30 group CPPM`. ClearPass files the records against the session of the service that authenticated the client. It doesn't run a service's enforcement from accounting, so don't build policy that expects it to.

**TACACS.** The ClearPass TACACS profile header has a Privilege Level field. On my bench that alone got me "Permission denied" on the switch while Access Tracker showed ACCEPT. Add Shell `priv-lvl` (15 or 1) or a custom Shell attribute `Aruba-Admin-Role` (administrators, operators, auditors). If both are there, Aruba-Admin-Role wins. Every session asks for service `Aruba:common` before `shell`, so "Tacacs service=Aruba:common not enabled" in Access Tracker is harmless.

The trap is command authorization. `aaa authorization commands ssh group CPPM-TAC none` sends every command to ClearPass, and a user ClearPass doesn't know can't run anything, the local admin included ("Cannot execute command"). The `none` fallback only applies when every server is unreachable, not when one answers no. Turn it on last, from a TACACS admin session, with a rollback timer armed. And leave `aaa authentication allow-fail-through` off: it lets a login ClearPass rejected fall through to the local database, which is not what break glass is supposed to mean.

If you use downloadable roles, the switch needs the CA that signed ClearPass's HTTPS certificate as a `crypto pki ta-profile`. The factory self signed certificate is refused as a trust anchor. That's a post of its own.

## Edge hardening checklist

- Four ClearPass nodes in one RADIUS group and one TACACS group, all in the management VRF.
- Tracking on every host, its own account and service, 300 second interval.
- `critical-role`, `critical-voice-role` and `reject-role` on every port.
- A `radius dyn-authorization client` line for every node, not just the one you tested from.
- Port access accounting with an interim interval.
- TACACS login with `local` after the group, so local only works when every server is unreachable. Console stays local.
- Command authorization last, and only after the ClearPass TACACS policy is proven.
- `spanning-tree bpdu-guard` and `admin-edge` on every edge port, plus `loop-protect` for the unmanaged switch under a desk. On 10.18 `show interface brief` leaves the Reason column empty for a BPDU guard trip; `show spanning-tree` says Bpdu-Error. Recover with shutdown then no shutdown, or set `spanning-tree bpdu-guard timeout`.
- DHCP snooping on the user VLANs and `ipv4 source-lockdown` on the ports. Dynamic ARP inspection is a hardware feature on the 6200 and 6300; the Switch Simulator I validate against doesn't carry it, so check the exact syntax for your platform in HPE's security guide before you paste it.
- An SSH allow-list, as its own step: enabling it restarts SSH on every VRF and drops live sessions.
- Banner, a 15 minute CLI idle timeout, two NTP servers (802.1X logs and certificates both care what time it is), syslog.
- `checkpoint auto` before any AAA change.

## The config

Everything in angle brackets is yours to fill in. I keep management, RADIUS and TACACS in the management VRF; on 10.18 that also means `ssh server vrf` and `https-server vrf` for that VRF, or you can't log in over it.

Arm a rollback first. `checkpoint auto 10` rolls the config back after 10 minutes unless you confirm, and it rolls back as soon as the session that armed it ends unless you've run `checkpoint auto confirm`. That's exactly what you want around AAA: if your change locks you out, your session ends and the switch puts it back.

```term
edge-sw# checkpoint auto 10
edge-sw# configure terminal

hostname <SWITCH-NAME>
banner motd ^
Authorized use only. Activity is logged.
^
ntp server <NTP1-IP> iburst
ntp server <NTP2-IP> iburst
ntp enable
ntp vrf <MGMT-VRF>
logging <SYSLOG-IP> vrf <MGMT-VRF> severity info
cli-session
    timeout 15
ssh server vrf <MGMT-VRF>
https-server vrf <MGMT-VRF>
system serviceos password-prompt

! RADIUS: four nodes, tracked
radius-server tracking user-name svc-radius-probe password plaintext <PROBE-PASSWORD>
radius-server tracking interval 300
radius-server host <CPPM1-IP> key plaintext <RADIUS-KEY> vrf <MGMT-VRF> tracking enable
radius-server host <CPPM2-IP> key plaintext <RADIUS-KEY> vrf <MGMT-VRF> tracking enable
radius-server host <CPPM3-IP> key plaintext <RADIUS-KEY> vrf <MGMT-VRF> tracking enable
radius-server host <CPPM4-IP> key plaintext <RADIUS-KEY> vrf <MGMT-VRF> tracking enable
aaa group server radius CPPM
    server <CPPM1-IP> vrf <MGMT-VRF>
    server <CPPM2-IP> vrf <MGMT-VRF>
    server <CPPM3-IP> vrf <MGMT-VRF>
    server <CPPM4-IP> vrf <MGMT-VRF>

! CoA: enable, then name every node
radius dyn-authorization enable
radius dyn-authorization client <CPPM1-IP> secret-key plaintext <RADIUS-KEY> vrf <MGMT-VRF>
radius dyn-authorization client <CPPM2-IP> secret-key plaintext <RADIUS-KEY> vrf <MGMT-VRF>
radius dyn-authorization client <CPPM3-IP> secret-key plaintext <RADIUS-KEY> vrf <MGMT-VRF>
radius dyn-authorization client <CPPM4-IP> secret-key plaintext <RADIUS-KEY> vrf <MGMT-VRF>

! TACACS: login and accounting. Command authorization is step 2, below.
tacacs-server host <CPPM1-IP> key plaintext <TACACS-KEY> vrf <MGMT-VRF>
tacacs-server host <CPPM2-IP> key plaintext <TACACS-KEY> vrf <MGMT-VRF>
tacacs-server host <CPPM3-IP> key plaintext <TACACS-KEY> vrf <MGMT-VRF>
tacacs-server host <CPPM4-IP> key plaintext <TACACS-KEY> vrf <MGMT-VRF>
aaa group server tacacs CPPM-TAC
    server <CPPM1-IP> vrf <MGMT-VRF>
    server <CPPM2-IP> vrf <MGMT-VRF>
    server <CPPM3-IP> vrf <MGMT-VRF>
    server <CPPM4-IP> vrf <MGMT-VRF>
aaa authentication login ssh group CPPM-TAC local
aaa authentication login https-server group CPPM-TAC local
aaa authentication login console local
aaa accounting all-mgmt default start-stop group CPPM-TAC local
aaa accounting port-access start-stop interim 30 group CPPM

! VLANs and roles
vlan <DATA-VLAN>
    name DATA
    dhcpv4-snooping
vlan <VOICE-VLAN>
    name VOICE
    voice
    dhcpv4-snooping
vlan <PRINTER-VLAN>
    name Printers
    dhcpv4-snooping
vlan <QUAR-VLAN>
    name QUARANTINE
    dhcpv4-snooping
dhcpv4-snooping
port-access role EMPLOYEE
    vlan access <DATA-VLAN>
port-access role PRINTERS
    vlan access <PRINTER-VLAN>
port-access role PHONE
    device-traffic-class voice
    vlan trunk allowed <VOICE-VLAN>
port-access role QUARANTINE
    vlan access <QUAR-VLAN>
port-access role CRITICAL
    vlan access <DATA-VLAN>
port-access role CRITICAL-VOICE
    device-traffic-class voice
    vlan trunk allowed <VOICE-VLAN>
aaa authentication port-access dot1x authenticator
    radius server-group CPPM
    enable
aaa authentication port-access mac-auth
    radius server-group CPPM
    enable
spanning-tree
spanning-tree bpdu-guard timeout 300

! One edge port. Repeat or use a range.
interface <EDGE-PORT>
    no shutdown
    no routing
    vlan access <DATA-VLAN>
    spanning-tree bpdu-guard
    spanning-tree port-type admin-edge
    loop-protect
    ipv4 source-lockdown
    aaa authentication port-access auth-mode multi-domain
    aaa authentication port-access allow-lldp-bpdu
    aaa authentication port-access critical-role CRITICAL
    aaa authentication port-access critical-voice-role CRITICAL-VOICE
    aaa authentication port-access reject-role QUARANTINE
    aaa authentication port-access dot1x authenticator
        initial-auth-response-timeout 10
        eapol-timeout 10
        max-eapol-requests 1
        reauth
        enable
    aaa authentication port-access mac-auth
        enable

! Uplink trusts DHCP
interface <UPLINK-PORT>
    dhcpv4-snooping trust

end
edge-sw# checkpoint auto confirm
```

Then two separate steps, each with its own `checkpoint auto`, each confirmed from a fresh session before you close the old one:

```term
! Step 2: only after a TACACS admin login works and ClearPass returns Aruba-Admin-Role
aaa authorization commands ssh group CPPM-TAC none

! Step 3: drops every SSH session on the switch when it applies
ssh server allow-list
    ip <MGMT-SUBNET>
    enable
```

On the ClearPass side, each switch is a network device with the RADIUS key, the TACACS key, the Aruba vendor, and CoA on port 3799, in the NAD group the probe service matches. I return `Aruba-User-Role` with one of the role names above, spelled exactly the same.

## How to prove it works

**Tracking.** `show radius-server` puts a star in front of a server the switch has marked unreachable. `show radius-server detail` gives tracking per server. `show events -e 2304` is the reachable log. Then stop the RADIUS service on one node and watch it get a star within one interval, without a client having to fail first.

**A laptop.** `show port-access clients` should show `1x|c|-|s` with the role ClearPass returned. `show aaa authentication port-access interface all client-status` shows the full authentication and authorization blocks if it doesn't.

**A printer.** Same command, `ma` in the first flag. Time it from link up. With the template it should be around 10 seconds, not three minutes.

**The phone.** `show lldp neighbor-info <EDGE-PORT>` should show its LLDP-MED class and the voice network policy. `show port-access clients` should list two clients on the port, one with the voice device type.

**The fallbacks.** Block UDP 1812 to all four nodes from a test switch and bounce a port: `CRITICAL, Critical` with `--|c|-|s`. Put a bad password on a test laptop: `QUARANTINE`, and the reason in Access Tracker, not on the switch.

**CoA.** Send a disconnect from Access Tracker using the AOS-CX Disconnect profile. `show radius dyn-authorization` should count a Disconnect-ACK for that node. If the invalid client address counter moved instead, that node is missing its client line.

**Accounting and TACACS.** `show radius-server statistics authentication` for counters per server, and the Accounting tab of the session in Access Tracker. Log in over SSH as a TACACS user and check that you land as the role you meant before you go anywhere near step 2.

Tracking doesn't prove ClearPass will say yes. It proves ClearPass will answer. Build the probe account and its service so the answer it gets is one you'd actually want to read.
