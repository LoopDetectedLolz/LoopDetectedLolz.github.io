---
title: Junos 802.1X With ClearPass: Plan for the First Timeout
slug: junos-dot1x-first-timeout
date: 2026-10-04
tags: ClearPass, Juniper, 802.1X, Security
hero: hero-edge-nac-junos.svg
summary: An EX switch has no RADIUS health probe for 802.1X. It learns a ClearPass node is dead when a real client's request times out, and it puts the node back on a timer without checking. Here's how to size that first timeout for a four node cluster, and the rest of the edge port on Junos.
origin: Built while writing deployment templates for a four node ClearPass cluster
series: ClearPass at the Edge
series_order: 3
---

On AOS-CX the switch probes ClearPass on a timer. On a Catalyst, a tester brings a dead node back. On an EX, nothing probes anything.

Junos learns a RADIUS server is dead the expensive way: a real client's request goes unanswered until the timeout and retries run out, server after server. And it puts a dead server back in the list when `revert-interval` expires, without checking whether it's alive. I looked for a probe, a keepalive or Status-Server in Juniper's EX documentation and didn't find one. So somebody always pays for the first timeout. The job is to make it short and make what happens next predictable.

This is the third of three posts that build the same edge port against the same four node ClearPass cluster, in the same order. [AOS-CX](cx-counts-a-reject-as-alive.html) and [Cisco IOS-XE](ibns-coa-wrong-port.html) came first. This one is an EX4100 or EX4400 on Junos 23.4 or 24.x with the ELS command line. I don't have a 23.4 or 24.x switch on my bench, so the syntax here is from Juniper's documentation and the timing is from an EX4300 on 21.4, labelled where it's used.

## Bottom line

- **Size the RADIUS timeout for four dead servers, not one.** Juniper's defaults are 3 tries of 3 seconds per server, tried in order. Four unreachable nodes is 36 seconds of RADIUS alone before the switch gives up on a request.
- **`server-fail` and `server-fail-voip` on every port.** The default is `deny`. A ClearPass outage without them is an outage for every port.
- **`authentication-order tacplus`, not `[ tacplus password ]`.** With `password` in the list, a login ClearPass rejects falls through to the local password.
- **`mac-radius authentication-protocol pap`.** MAC RADIUS on Junos defaults to EAP-MD5, which is not what ClearPass sees from the other two platforms.

## Four ClearPass nodes and how the switch decides one is dead

Juniper's RADIUS server guide says the switch tries each server `retry` times, waiting `timeout` seconds each, in order, until one answers or every server has run out. Defaults are 3 and 3. There's no separate dead timer and no test request: the request that times out is a real one, from a real client.

{{figure: fig-edge-junos-probe.svg | Nothing probes. A real request walks the four nodes in order; a node that doesn't answer is skipped until revert-interval expires, and then it's simply back in the list.}}

Two things follow.

**The first client pays.** With all four nodes unreachable, one request costs up to 36 seconds at the defaults before the port's `server-fail` action runs. I drop `retry` to 2 so that's 24. On my bench (an EX4300 on Junos 21.4R1.12, 2026-09-25) a port with `server-fail permit` sat in Connecting for about 90 seconds before the fallback applied, because the 802.1X layer has its own timers on top of RADIUS. Juniper doesn't publish a formula for that total, so measure it on your release before you promise anybody a number. When the client on the port was another 802.1X switch, the link looked dead for two to three minutes. It wasn't broken. It was waiting.

**Coming back isn't a test.** `revert-interval` is how long a dead server sits out before it's tried again. Juniper's two reference pages for it disagree on the default (60 seconds on one, 600 on the other), so I set it explicitly. When it expires the node is back in the list whether it's up or not, and if it's still down, the next real request pays again.

The only thing that rechecks on purpose is server-fail itself. Juniper's server fail fallback page says that once a session is in fallback, the switch periodically tries to authenticate that session again, and when a server answers, it reauthenticates everything held in server-fail. That's a real Access-Request, not a probe, but it's what gets a port out of fallback without anyone touching it.

### The probe service

In the CX and Cisco posts I build a ClearPass local user and its own service so health probes have somewhere to land. Junos sends no probes, so there's nothing for it to catch. If the same cluster serves CX or Catalyst switches, keep the service; it costs nothing here. What Junos needs instead is something outside the switch watching ClearPass, because the switch won't tell you a node is down until a client finds out.

Mist is the same story from what I can see: its wired port profiles have a "bypass authentication when server is down" option, which is the same idea as `server-fail permit`, and I found no switch side RADIUS health check.

## 802.1X, then MAC RADIUS, then the fallbacks

`authentication-order [ dot1x mac-radius ]` is the default shape: 802.1X first, MAC RADIUS when the client doesn't answer EAPOL. Juniper also allows `[ mac-radius dot1x ]` if you want MAC RADIUS first. I keep 802.1X first for the same reason as on CX: a MAC accept would end the conversation for a laptop ClearPass happens to know by MAC.

{{figure: fig-edge-junos-flow.svg | One port, four outcomes. A supplicant is authorized in seconds, a silent printer waits out the EAPOL timers, a dead cluster runs server-fail after the RADIUS timeouts, and a reject lands in quarantine.}}

The EAPOL timers are `transmit-period` (default 30) and `maximum-requests` (default 2). Juniper documents both defaults; I didn't find a published formula for exactly when MAC RADIUS starts. Cisco documents its equivalent as (requests + 1) x period, which would make the Junos defaults 90 seconds. I set `transmit-period 10` and time a printer on the first switch.

Two Junos specifics that bite with ClearPass:

- **MAC RADIUS is EAP-MD5 by default.** `mac-radius authentication-protocol pap` makes it plain PAP with the MAC as the User-Name, which is what ClearPass's MAC auth service expects. Juniper's own ClearPass example says ClearPass recognises MAC auth when the User-Name equals the Client-MAC-Address.
- **`mac-radius restrict` means MAC RADIUS only.** The switch drops 802.1X frames on that port. Right for a printer port you're sure of; wrong for a general edge port.

The fallbacks:

- **All servers down.** `server-fail` takes `deny` (the default), `permit`, `use-cache` (keep sessions that were already authenticated) or `vlan-name`. I use `vlan-name DATA` for data and `server-fail-voip permit` so phones keep the voice VLAN.
- **Rejected.** `server-reject-vlan` is documented for an 802.1X reject. For a MAC RADIUS client I don't lean on it: an unknown MAC gets an Accept into `QUARANTINE` from ClearPass instead, so the quarantine decision is visible in Access Tracker as an enforcement result rather than a reject.

Dynamic VLANs work by name. Tunnel-Type VLAN, Tunnel-Medium-Type 802 and Tunnel-Private-Group-Id `Printers`, and Juniper's guide says the value can be the VLAN name or ID. The VLAN has to exist on the switch with that name.

## Phone and PC on one port

Junos calls it multi-domain, and it's its own statement under the authenticator interface: `multi-domain { max-data-session 1; }`. Not a supplicant mode. It arrived in 18.3R1. One voice session, not configurable, plus however many data sessions you allow.

{{figure: fig-edge-junos-mda.svg | Two sessions on one port. The phone learns the voice VLAN from LLDP-MED and ClearPass marks it as voice; the PC's VLAN comes from its own authorization.}}

The voice VLAN is `switch-options voip interface <EDGE-IF>.0 vlan VOICE`, and `protocols lldp-med interface <EDGE-IF>` advertises it to the phone. Juniper's own ClearPass example has the phone's enforcement profile return `Juniper-VoIP-Vlan`, which is what I do. The PC's VLAN is its own authorization: the access VLAN unless ClearPass returns another.

## CoA, accounting and TACACS

{{figure: fig-edge-junos-ports.svg | Who starts each conversation. The switch talks to ClearPass on 1812, 1813 and 49; ClearPass talks to the switch on 3799, which an EX already listens on. The trap is a TACACS reject falling through to the local password.}}

**CoA.** The good news for once. Juniper says an EX listens for unsolicited RADIUS requests on UDP 3799 and accepts them from any configured RADIUS server, using that server's secret. No extra block, no client list. `dynamic-request-port` under the server changes the port if you ever need to. Disconnect and CoA are supported, and from 17.3 a CoA carrying `Juniper-AV-Pair = "Port-Bounce"` bounces the port; a port can opt out with `ignore-port-bounce`, which I'd use on phone ports.

**Accounting.** `accounting { order radius; accounting-stop-on-failure; accounting-stop-on-access-deny; }` in the access profile, plus an interim interval. ClearPass files it against the authenticating service's session, same as the other two.

**TACACS.** Four `tacplus-server` entries on TCP 49, and then the line that matters: `authentication-order tacplus`. Juniper's authentication order page says that with `[ tacplus password ]`, a reject from TACACS falls through to the local password. With `tacplus` alone, a reject is final and the local password is only used when no server answers. That's break glass. The other is a second chance for anyone who knows a local password.

ClearPass answers with service `junos-exec` and `local-user-name` set to a template account on the switch. A user ClearPass accepts without a `local-user-name` lands as the `remote` template, so `remote` gets the least you can give it, read only, and admins are mapped to a template with more. Junos does command authorization through the template's class plus any `allow-commands` or `deny-commands` ClearPass returns. A `deny-commands` regex is easy to get too broad, so test it from a second session before you close the first.

There's no separate console login list on Junos. The console follows the same order, and with `authentication-order tacplus` the local account still works there when no server answers.

## Edge hardening checklist

- Four nodes in the access profile, `retry` and `timeout` sized for all four failing, `revert-interval` set explicitly.
- `server-fail`, `server-fail-voip`, and a quarantine VLAN.
- MAC RADIUS as PAP.
- RADIUS accounting with stop on failure and on deny, and an interim interval.
- `authentication-order tacplus`, a least privilege `remote` template, a local break glass account.
- `bpdu-block` on edge ports with a `disable-timeout`, RSTP `edge`.
- Storm control. ELS already applies a default profile at 80 percent; set your own lower.
- `dhcp-security` per VLAN with ARP inspection and IP source guard, uplink in a trusted group.
- A loopback filter that only lets SSH in from the management network, and lets RADIUS replies and CoA through.
- `ssh root-login deny`, a login message, an idle timeout on every login class, two NTP servers, syslog.
- `commit confirmed` on every AAA change.

## The config

Everything in angle brackets is yours. This is `set` form for a current ELS release, written from Juniper's documentation; I'd load it on one lab switch with `commit check` before anything else. `commit confirmed 10` rolls it back in 10 minutes unless you `commit` again.

```term
# ---- RADIUS: four nodes ----
set access radius-server <CPPM1-IP> port 1812 accounting-port 1813
set access radius-server <CPPM1-IP> secret "<RADIUS-KEY>"
set access radius-server <CPPM1-IP> source-address <SWITCH-MGMT-IP>
set access radius-server <CPPM1-IP> retry 2 timeout 3
set access radius-server <CPPM2-IP> port 1812 accounting-port 1813
set access radius-server <CPPM2-IP> secret "<RADIUS-KEY>"
set access radius-server <CPPM2-IP> source-address <SWITCH-MGMT-IP>
set access radius-server <CPPM2-IP> retry 2 timeout 3
set access radius-server <CPPM3-IP> port 1812 accounting-port 1813
set access radius-server <CPPM3-IP> secret "<RADIUS-KEY>"
set access radius-server <CPPM3-IP> source-address <SWITCH-MGMT-IP>
set access radius-server <CPPM3-IP> retry 2 timeout 3
set access radius-server <CPPM4-IP> port 1812 accounting-port 1813
set access radius-server <CPPM4-IP> secret "<RADIUS-KEY>"
set access radius-server <CPPM4-IP> source-address <SWITCH-MGMT-IP>
set access radius-server <CPPM4-IP> retry 2 timeout 3

set access profile CPPM authentication-order radius
set access profile CPPM radius authentication-server [ <CPPM1-IP> <CPPM2-IP> <CPPM3-IP> <CPPM4-IP> ]
set access profile CPPM radius accounting-server [ <CPPM1-IP> <CPPM2-IP> <CPPM3-IP> <CPPM4-IP> ]
set access profile CPPM radius options revert-interval 300
set access profile CPPM accounting order radius
set access profile CPPM accounting accounting-stop-on-failure
set access profile CPPM accounting accounting-stop-on-access-deny
set access profile CPPM accounting update-interval 30

# ---- VLANs, DHCP security ----
set vlans DATA vlan-id <DATA-VLAN>
set vlans VOICE vlan-id <VOICE-VLAN>
set vlans Printers vlan-id <PRINTER-VLAN>
set vlans QUARANTINE vlan-id <QUAR-VLAN>
set vlans DATA forwarding-options dhcp-security arp-inspection
set vlans DATA forwarding-options dhcp-security ip-source-guard
set vlans DATA forwarding-options dhcp-security group UPLINK overrides trusted
set vlans DATA forwarding-options dhcp-security group UPLINK interface <UPLINK-IF>
# repeat the four dhcp-security lines for VOICE, Printers and QUARANTINE

# ---- one edge port ----
set interfaces <EDGE-IF> unit 0 family ethernet-switching interface-mode access
set interfaces <EDGE-IF> unit 0 family ethernet-switching vlan members DATA
set interfaces <EDGE-IF> unit 0 family ethernet-switching storm-control EDGE-STORM
set switch-options voip interface <EDGE-IF>.0 vlan VOICE
set switch-options voip interface <EDGE-IF>.0 forwarding-class expedited-forwarding
set protocols lldp interface all
set protocols lldp-med interface <EDGE-IF>
set protocols rstp interface <EDGE-IF> edge
set protocols layer2-control bpdu-block interface <EDGE-IF>
set protocols layer2-control bpdu-block disable-timeout 300
set forwarding-options storm-control-profiles EDGE-STORM all bandwidth-level 5000

# ---- 802.1X and MAC RADIUS ----
set protocols dot1x authenticator authentication-profile-name CPPM
set protocols dot1x authenticator interface <EDGE-IF> multi-domain max-data-session 1
set protocols dot1x authenticator interface <EDGE-IF> authentication-order [ dot1x mac-radius ]
set protocols dot1x authenticator interface <EDGE-IF> mac-radius authentication-protocol pap
set protocols dot1x authenticator interface <EDGE-IF> transmit-period 10
set protocols dot1x authenticator interface <EDGE-IF> maximum-requests 2
set protocols dot1x authenticator interface <EDGE-IF> reauthentication 3600
set protocols dot1x authenticator interface <EDGE-IF> server-fail vlan-name DATA
set protocols dot1x authenticator interface <EDGE-IF> server-fail-voip permit
set protocols dot1x authenticator interface <EDGE-IF> server-reject-vlan QUARANTINE
set protocols dot1x authenticator interface <EDGE-IF> ignore-port-bounce

# ---- TACACS ----
set system tacplus-server <CPPM1-IP> secret "<TACACS-KEY>" source-address <SWITCH-MGMT-IP> single-connection
set system tacplus-server <CPPM2-IP> secret "<TACACS-KEY>" source-address <SWITCH-MGMT-IP> single-connection
set system tacplus-server <CPPM3-IP> secret "<TACACS-KEY>" source-address <SWITCH-MGMT-IP> single-connection
set system tacplus-server <CPPM4-IP> secret "<TACACS-KEY>" source-address <SWITCH-MGMT-IP> single-connection
set system authentication-order tacplus
set system login class NOC-RO permissions view
set system login class NOC-RO idle-timeout 15
set system login class NET-ADMIN permissions all
set system login class NET-ADMIN idle-timeout 15
set system login user remote class NOC-RO
set system login user netadmin class NET-ADMIN
set system login user breakglass class super-user authentication encrypted-password "<HASH>"
set system accounting events [ login change-log interactive-commands ]
set system accounting destination tacplus

# ---- management ----
set system host-name <SWITCH-NAME>
set system login message "Authorized use only. Activity is logged."
set system services ssh root-login deny
set system ntp server <NTP1-IP>
set system ntp server <NTP2-IP>
set system syslog host <SYSLOG-IP> any notice
set system syslog host <SYSLOG-IP> authorization info
set policy-options prefix-list MGMT <MGMT-SUBNET>
set firewall family inet filter PROTECT-RE term SSH-MGMT from source-prefix-list MGMT
set firewall family inet filter PROTECT-RE term SSH-MGMT from protocol tcp
set firewall family inet filter PROTECT-RE term SSH-MGMT from destination-port ssh
set firewall family inet filter PROTECT-RE term SSH-MGMT then accept
set firewall family inet filter PROTECT-RE term SSH-OTHER from protocol tcp
set firewall family inet filter PROTECT-RE term SSH-OTHER from destination-port ssh
set firewall family inet filter PROTECT-RE term SSH-OTHER then discard
set firewall family inet filter PROTECT-RE term EVERYTHING-ELSE then accept
set interfaces lo0 unit 0 family inet filter input PROTECT-RE

commit check
commit confirmed 10
```

Check the result with `show | compare` before the confirm, log in from a second session as a TACACS user, and only then `commit`.

The loopback filter is deliberately narrow: it closes SSH to everything but the management prefix and accepts the rest, so RADIUS replies, CoA on 3799, NTP and syslog still get through. Tighten it further once you've listed what the switch actually needs.

On the ClearPass side, each switch is a network device with the RADIUS and TACACS keys and the Juniper vendor, in the NAD group your services match. Phones get `Juniper-VoIP-Vlan`. Printers get the three tunnel attributes with `Printers`. Unknown MACs get an Accept into `QUARANTINE`. TACACS admins get `junos-exec` with `local-user-name` `netadmin`.

## How to prove it works

**The first timeout.** Block 1812 to all four nodes from one test switch and connect a laptop. Time it from link up to `server-fail` with a stopwatch, on your release, and write the number down. That's the number your help desk will hear about. Then unblock one node and watch held sessions reauthenticate on their own.

**A laptop.** `show dot1x interface <EDGE-IF> detail` should show the supplicant authenticated by RADIUS and the VLAN it landed in.

**A printer.** Same command, authenticated by MAC RADIUS. If ClearPass shows nothing at all, check the authentication protocol before anything else: an EAP-MD5 MAC request that no service expects looks a lot like silence.

**The phone.** `show lldp neighbors interface <EDGE-IF>` for the LLDP-MED view, and `show dot1x interface <EDGE-IF> detail` should show two sessions, one of them voice.

**CoA.** Send a disconnect from Access Tracker. The session should drop and come back. Nothing to configure on the switch, which is why it's the first thing to blame on ClearPass when it doesn't work: the shared secret ClearPass uses for CoA has to be the one in `access radius-server`.

**TACACS.** Log in as a TACACS user and run `show cli authorization` to see the class and permissions you landed with. Then try a user ClearPass rejects and make sure they don't get in with a local password.

A Junos switch won't tell you a ClearPass node is down until a client finds out. Make that first timeout short, make the fallback land somewhere useful, and time it on your release before anybody else does.
