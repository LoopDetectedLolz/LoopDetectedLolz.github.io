---
title: IBNS 2.0 Listens for CoA on the Wrong Port Until You Tell It Otherwise
slug: ibns-coa-wrong-port
date: 2026-10-03
tags: ClearPass, Cisco, 802.1X, Security
hero: hero-edge-nac-cisco.svg
summary: A Catalyst 9300 listens for RADIUS change of authorization on UDP 1700 out of the box, and ClearPass sends to 3799, so CoA fails silently until you add one line. Here's that line and the rest of an IBNS 2.0 edge port for a four node ClearPass cluster, laid out the same way as the AOS-CX version.
origin: Built while writing deployment templates for a four node ClearPass cluster
series: ClearPass at the Edge
series_order: 2
---

ClearPass sends a disconnect. Access Tracker says it went. The laptop doesn't move.

The switch never heard it. A Catalyst running IOS-XE listens for RADIUS change of authorization on UDP 1700 by default, and ClearPass sends to 3799, the port RFC 5176 assigned. Nothing on either side tells you the two disagree. `port 3799` under `aaa server radius dynamic-author` fixes it, and it's the line most templates I inherit are missing.

This is the second of three posts that build the same edge port against the same four node ClearPass cluster, in the same order. [The first was AOS-CX](cx-counts-a-reject-as-alive.html). This one is a Catalyst 9300 on IOS-XE 17.9 or later with IBNS 2.0, the class-map and policy-map style of identity configuration. Junos is next.

## Bottom line

- **`port 3799` under `aaa server radius dynamic-author`.** Cisco's default is 1700. ClearPass sends to 3799. Add a `client` line for each of the four nodes while you're there.
- **`dot1x timeout tx-period 10` on the port.** Cisco's documented arithmetic is (max-reauth-req + 1) x tx-period before 802.1X gives up. That's 90 seconds with the defaults and 30 with this.
- **`lldp run`.** It's off by default on a Catalyst. A Cisco phone gets by on CDP; anything else needs LLDP-MED to learn its voice VLAN.
- **The automate-tester and dead-criteria together.** The switch learns a node is dead from real requests timing out, and the tester is what brings it back.

## Four ClearPass nodes and how the switch decides one is dead

Four `radius server` blocks, one group, and the switch tries them in order. Two pieces of config decide when it stops trying one.

`radius-server dead-criteria time 5 tries 3` is the death sentence. Cisco's dead server detection guide says both conditions have to be met: no valid reply for 5 seconds since the last one, and 3 consecutive timeouts. Those are real client requests timing out, so somebody's laptop pays for the discovery.

`deadtime 15` on the group is how long a dead server sits out, in minutes. And `automate-tester username svc-radius-probe probe-on` on each server is how it gets back in: with `probe-on`, Cisco's load balancing guide says the tester only sends test packets while the server is marked dead.

{{figure: fig-edge-cisco-probe.svg | Real requests mark a node dead. The automate-tester probes only dead nodes and brings one back on any reply, an Accept or a Reject.}}

Here's the part that matches what I saw on AOS-CX. Cisco's guide says the tester doesn't need a successful authentication, "especially because no password was configured", and that a server returning Access-Reject is alive. So any answer is proof of life, and the probe account will be rejected every time because the switch never sends a real password for it.

### The probe service

Same idea as the CX post, and it's the same service if you have both kinds of switch in the cluster.

1. **A local user.** `svc-radius-probe` in Local Users, any throwaway role. Not AD: a lockout would make every switch call every node dead.
2. **A service, placed first.** RADIUS Enforcement (Generic). Rules: `Radius:IETF:User-Name EQUALS svc-radius-probe` AND `Connection:NAD-IP-Address BELONGS_TO_GROUP <SWITCH-NAD-GROUP>`. `[PAP]`, `[Local User Repository]`, `[Allow Access Profile]`, no VLAN, no role.
3. **Open one probe in Access Tracker** and build any extra rules from what your switch sends.

The difference on Cisco is that you should expect REJECT on every entry, because the tester has no password to send. That's fine. The service isn't there to say yes. It's there so the rejects are filed under a name you can filter out, instead of landing as "Service Categorization failed" next to your real failures. A plain PAP request with no EAP rarely matches an 802.1X service's rules, and a MAC auth service expects the User-Name to be a MAC.

Noise is lower here than on CX, because `probe-on` only probes dead servers. A healthy cluster sends no probes at all.

## 802.1X, then MAC auth, then the fallbacks

IBNS 2.0 puts the order in a policy map instead of on the port. The session starts with 802.1X; if the client doesn't answer or fails, the policy ends 802.1X and runs MAB; if MAB fails, it activates a quarantine template and authorizes the port into it.

{{figure: fig-edge-cisco-flow.svg | One port, four outcomes. A supplicant is authorized in seconds, a silent printer reaches MAB in about 30, a dead cluster gets the critical templates, and a MAB reject lands in quarantine.}}

The timer that matters is `dot1x timeout tx-period`. Cisco's 802.1X deployment guide gives the time before 802.1X times out as (max-reauth-req + 1) x tx-period. The defaults are 2 and 30 seconds, so a printer with no supplicant waits 90 seconds before MAB. With tx-period 10 it's 30.

The fallbacks, as the policy below writes them:

- **All servers down, client not yet authorized.** The `AAA_SVR_DOWN_UNAUTHD_HOST` class (`match result-type aaa-timeout` and `match authorization-status unauthorized`) activates `CRITICAL_DATA` and `CRITICAL_VOICE`, authorizes, and pauses reauthentication so the port doesn't keep asking a cluster that isn't there.
- **All servers down, client already authorized.** Pause reauthentication and leave it alone.
- **Servers back.** On `aaa-available`, a session in a critical template is cleared so it authenticates for real; anyone else has reauthentication resumed. `authentication critical recovery delay 1000` spaces that out so four hundred ports don't all hit ClearPass in the same second. 1000 ms is already the default; I write it out so the next person sees it.
- **MAB rejected.** Activate `QUARANTINE` and authorize. Note there's no Session-Timeout in that branch, so the client stays in quarantine until a CoA or `clear access-session` moves it. That's a decision, not an accident: ClearPass is the thing that should let it out.
- **A supplicant shows up late.** On `agent-found`, MAB is terminated and 802.1X starts, so a laptop that was quiet at boot doesn't stay a MAB session forever.

`dot1x critical eapol` sends an EAPOL-Success to a supplicant that was let in by the critical template, so the laptop thinks it's on and requests an address.

Printers get their VLAN from ClearPass with Tunnel-Type 13 (VLAN), Tunnel-Medium-Type 6 (802) and Tunnel-Private-Group-Id `Printers`. Cisco's guide accepts a VLAN name or number there. I use the name, so the same enforcement profile works on every switch whatever the VLAN number is, as long as the VLAN is named `Printers`.

## Phone and PC on one port

`access-session host-mode multi-domain` gives the port a voice domain and a data domain. The switch only puts a device in the voice domain when ClearPass says so: Cisco's 802.1X guide says the server has to send `cisco-av-pair` `device-traffic-class=voice`, and without it the phone is treated as a data device.

{{figure: fig-edge-cisco-mda.svg | Two sessions on one port. The phone is in the voice domain because ClearPass returned device-traffic-class=voice; the PC's VLAN comes from its own authorization.}}

The voice VLAN is `switchport voice vlan <VOICE-VLAN>` on the port. A Cisco phone learns it over CDP, which is on by default. Anything else learns it from LLDP-MED, and LLDP is off by default on a Catalyst until you `lldp run`. I turn it on everywhere; a third party phone that boots into the data VLAN is a support call.

The PC's VLAN comes from its own authorization, the native access VLAN unless ClearPass returns another one.

## CoA, accounting and TACACS

{{figure: fig-edge-cisco-ports.svg | Who starts each conversation. The switch talks to ClearPass on 1812, 1813 and 49; ClearPass talks to the switch on 3799, but only after port 3799 replaces Cisco's default of 1700.}}

**CoA.** `aaa server radius dynamic-author`, a `client <CPPMn-IP> server-key <RADIUS-KEY>` line per node, `port 3799`, and `auth-type any`. In ClearPass, the Cisco Reauthenticate Session profile and the Cisco Disconnect profile are the two I use. I avoid Bounce Host Port on phone ports: bouncing the link reboots a PoE phone, and that's a dropped call.

**Accounting.** `aaa accounting identity default start-stop group CPPM-RADIUS`. In IBNS 2.0, identity accounting covers 802.1X, MAB and web auth sessions. `aaa accounting update newinfo periodic 2880` sends an interim update when something new is learned and otherwise every 48 hours (the periodic value is minutes).

If you want ClearPass to profile from what the switch sees, the device sensor sends LLDP, CDP and DHCP attributes in accounting. A filter list does nothing on its own; it needs a `device-sensor filter-spec` line pointing at it and `device-sensor accounting`.

**TACACS.** Four `tacacs server` blocks on TCP 49, a group, and `aaa authentication login default group CPPM-TACACS local`. The `local` at the end is only reached when no server answers. A reject is final. The console gets its own list that's local only, so a ClearPass outage never costs you the console.

The trap is command authorization. Once `aaa authorization commands 15` is on, every command goes to ClearPass, and Cisco's command reference says config mode commands are authorized too by default. Turn it on halfway through a paste and the rest of the paste goes to ClearPass line by line, and any line ClearPass denies is rejected. `local if-authenticated` doesn't save you: the next method is tried only when no server answers, and a deny stops the list. So it goes on in its own step, after ClearPass has a TACACS command policy, from a session you're prepared to lose, with a revert timer armed.

## Edge hardening checklist

- Four nodes in one RADIUS group and one TACACS group, both with a source interface.
- Dead criteria, deadtime, and an automate-tester on every server.
- Critical data and voice templates, a quarantine template, and an `aaa-available` branch that clears critical sessions.
- `port 3799` and a dynamic-author client for every node.
- Identity accounting with interim updates.
- TACACS login with local after the group, a local only console list.
- Command authorization last, in its own change.
- `spanning-tree portfast` and `spanning-tree bpduguard enable` on edge ports, storm control on broadcast.
- DHCP snooping, dynamic ARP inspection on the user VLANs (it reads the snooping table), and a device-tracking policy.
- A management ACL on the vty lines and the HTTPS server, `login block-for` with a quiet mode ACL, type 6 password encryption, SSH only.
- Banner, exec timeout, NTP, syslog.
- `configure terminal revert timer` before any AAA change.

Two warnings on that list. Type 6 encryption ties every stored key to the master key; Cisco's own note says remove the master key and every type 6 secret is unusable, so record it somewhere that isn't the switch. And `authentication convert-to new-style` is how you move an old style config to IBNS 2.0, and Cisco says it can't be undone. `authentication display new-style` previews it and is reversible.

## The config

Everything in angle brackets is yours. I haven't run this exact paste on a 9300 on my bench; every line is checked against Cisco's 17.x configuration guides and command references, and I'd still paste it into one lab switch first.

Arm a revert first. `configure terminal revert timer 10` rolls back after 10 minutes unless you `configure confirm`. It works from the config archive, so set an archive path before you rely on it, which is also where `configure replace` finds its file later.

```term
edge-sw# configure terminal
edge-sw(config)# archive
edge-sw(config-archive)# path flash:archive
edge-sw(config-archive)# maximum 5
edge-sw(config-archive)# end
edge-sw# configure terminal revert timer 10


aaa new-model
aaa session-id common
!
! ---- RADIUS: four nodes ----
radius server CPPM1
 address ipv4 <CPPM1-IP> auth-port 1812 acct-port 1813
 key <RADIUS-KEY>
 automate-tester username svc-radius-probe probe-on
radius server CPPM2
 address ipv4 <CPPM2-IP> auth-port 1812 acct-port 1813
 key <RADIUS-KEY>
 automate-tester username svc-radius-probe probe-on
radius server CPPM3
 address ipv4 <CPPM3-IP> auth-port 1812 acct-port 1813
 key <RADIUS-KEY>
 automate-tester username svc-radius-probe probe-on
radius server CPPM4
 address ipv4 <CPPM4-IP> auth-port 1812 acct-port 1813
 key <RADIUS-KEY>
 automate-tester username svc-radius-probe probe-on
!
aaa group server radius CPPM-RADIUS
 server name CPPM1
 server name CPPM2
 server name CPPM3
 server name CPPM4
 ip radius source-interface <MGMT-INTERFACE>
 deadtime 15
!
radius-server dead-criteria time 5 tries 3
radius-server attribute 6 on-for-login-auth
radius-server attribute 8 include-in-access-req
radius-server attribute 25 access-request include
radius-server attribute 31 mac format ietf upper-case
!
aaa authentication dot1x default group CPPM-RADIUS
aaa authorization network default group CPPM-RADIUS
aaa accounting identity default start-stop group CPPM-RADIUS
aaa accounting update newinfo periodic 2880
!
! ---- CoA: ClearPass sends to 3799 ----
aaa server radius dynamic-author
 client <CPPM1-IP> server-key <RADIUS-KEY>
 client <CPPM2-IP> server-key <RADIUS-KEY>
 client <CPPM3-IP> server-key <RADIUS-KEY>
 client <CPPM4-IP> server-key <RADIUS-KEY>
 port 3799
 auth-type any
!
! ---- TACACS: login, exec, accounting ----
tacacs server CPPM1-TAC
 address ipv4 <CPPM1-IP>
 key <TACACS-KEY>
tacacs server CPPM2-TAC
 address ipv4 <CPPM2-IP>
 key <TACACS-KEY>
tacacs server CPPM3-TAC
 address ipv4 <CPPM3-IP>
 key <TACACS-KEY>
tacacs server CPPM4-TAC
 address ipv4 <CPPM4-IP>
 key <TACACS-KEY>
aaa group server tacacs+ CPPM-TACACS
 server name CPPM1-TAC
 server name CPPM2-TAC
 server name CPPM3-TAC
 server name CPPM4-TAC
 ip tacacs source-interface <MGMT-INTERFACE>
!
aaa authentication login default group CPPM-TACACS local
aaa authentication login CONSOLE local
aaa authorization exec default group CPPM-TACACS local if-authenticated
aaa accounting exec default start-stop group CPPM-TACACS
aaa accounting commands 15 default start-stop group CPPM-TACACS
!
! ---- 802.1X globals ----
dot1x system-auth-control
dot1x critical eapol
authentication critical recovery delay 1000
lldp run
!
vlan <DATA-VLAN>
 name DATA
vlan <VOICE-VLAN>
 name VOICE
vlan <PRINTER-VLAN>
 name Printers
vlan <QUAR-VLAN>
 name QUARANTINE
!
ip dhcp snooping vlan <DATA-VLAN>,<VOICE-VLAN>,<PRINTER-VLAN>,<QUAR-VLAN>
no ip dhcp snooping information option
ip dhcp snooping
ip arp inspection vlan <DATA-VLAN>,<VOICE-VLAN>,<PRINTER-VLAN>,<QUAR-VLAN>
!
device-tracking policy EDGE-TRACK
 tracking enable
device-tracking tracking auto-source
!
! ---- optional: profiling data to ClearPass ----
device-sensor filter-list lldp list LLDP-LIST
 tlv name system-name
 tlv name system-description
device-sensor filter-list dhcp list DHCP-LIST
 option name host-name
 option name class-identifier
 option name parameter-request-list
device-sensor filter-spec lldp include list LLDP-LIST
device-sensor filter-spec dhcp include list DHCP-LIST
device-sensor accounting
device-sensor notify all-changes
!
! ---- service templates ----
service-template CRITICAL_DATA
 vlan <DATA-VLAN>
service-template CRITICAL_VOICE
 voice vlan
service-template QUARANTINE
 vlan <QUAR-VLAN>
!
! ---- classes ----
class-map type control subscriber match-all AAA_SVR_DOWN_UNAUTHD_HOST
 match result-type aaa-timeout
 match authorization-status unauthorized
class-map type control subscriber match-all AAA_SVR_DOWN_AUTHD_HOST
 match result-type aaa-timeout
 match authorization-status authorized
class-map type control subscriber match-all DOT1X_FAILED
 match method dot1x
 match result-type method dot1x authoritative
class-map type control subscriber match-all DOT1X_NO_RESP
 match method dot1x
 match result-type method dot1x agent-not-found
class-map type control subscriber match-all MAB_FAILED
 match method mab
 match result-type method mab authoritative
class-map type control subscriber match-any IN_CRITICAL_AUTH
 match activated-service-template CRITICAL_DATA
 match activated-service-template CRITICAL_VOICE
class-map type control subscriber match-none NOT_IN_CRITICAL_AUTH
 match activated-service-template CRITICAL_DATA
 match activated-service-template CRITICAL_VOICE
!
! ---- the policy ----
policy-map type control subscriber EDGE-DOT1X-MAB
 event session-started match-all
  10 class always do-until-failure
   10 authenticate using dot1x priority 10
 event authentication-failure match-first
  10 class AAA_SVR_DOWN_UNAUTHD_HOST do-until-failure
   10 activate service-template CRITICAL_DATA
   20 activate service-template CRITICAL_VOICE
   30 authorize
   40 pause reauthentication
  20 class AAA_SVR_DOWN_AUTHD_HOST do-until-failure
   10 pause reauthentication
   20 authorize
  30 class DOT1X_FAILED do-until-failure
   10 terminate dot1x
   20 authenticate using mab priority 20
  40 class DOT1X_NO_RESP do-until-failure
   10 terminate dot1x
   20 authenticate using mab priority 20
  50 class MAB_FAILED do-until-failure
   10 terminate mab
   20 activate service-template QUARANTINE
   30 authorize
  60 class always do-until-failure
   10 terminate dot1x
   20 terminate mab
   30 authentication-restart 60
 event aaa-available match-all
  10 class IN_CRITICAL_AUTH do-until-failure
   10 clear-session
  20 class NOT_IN_CRITICAL_AUTH do-until-failure
   10 resume reauthentication
 event agent-found match-all
  10 class always do-until-failure
   10 terminate mab
   20 authenticate using dot1x priority 10
 event inactivity-timeout match-all
  10 class always do-until-failure
   10 clear-session
!
! ---- one edge port ----
interface <EDGE-PORT>
 description EDGE
 switchport mode access
 switchport access vlan <DATA-VLAN>
 switchport voice vlan <VOICE-VLAN>
 device-tracking attach-policy EDGE-TRACK
 authentication periodic
 authentication timer reauthenticate server
 access-session host-mode multi-domain
 access-session closed
 access-session port-control auto
 mab
 dot1x pae authenticator
 dot1x timeout tx-period 10
 dot1x max-reauth-req 2
 spanning-tree portfast
 spanning-tree bpduguard enable
 storm-control broadcast level 1.00
 service-policy type control subscriber EDGE-DOT1X-MAB
!
interface <UPLINK-PORT>
 ip dhcp snooping trust
 ip arp inspection trust
!
errdisable recovery cause bpduguard
errdisable recovery interval 300
!
! ---- management ----
ip domain name <DOMAIN>
crypto key generate rsa general-keys modulus 3072
ip ssh version 2
key config-key password-encrypt <MASTER-KEY>
password encryption aes
ip access-list standard MGMT-ACL
 permit <MGMT-SUBNET> <MGMT-WILDCARD>
login block-for 120 attempts 5 within 60
login quiet-mode access-class MGMT-ACL
no ip http server
ip http secure-server
ip http authentication aaa
ip http access-class ipv4 MGMT-ACL
ntp server <NTP1-IP>
ntp server <NTP2-IP>
logging host <SYSLOG-IP>
banner login ^C
Authorized use only. Activity is logged.
^C
line con 0
 login authentication CONSOLE
 exec-timeout 15 0
line vty 0 15
 access-class MGMT-ACL in
 exec-timeout 15 0
 transport input ssh
end
edge-sw# configure confirm
```

Then the second step, on its own, with its own revert timer, from a TACACS session, after ClearPass has a TACACS command policy that permits what your admins run:

```term
edge-sw# configure terminal revert timer 10
aaa authorization commands 15 default group CPPM-TACACS local if-authenticated
end
edge-sw# configure confirm
```

On the ClearPass side, each switch is a network device with the RADIUS and TACACS keys, the Cisco vendor, and CoA on port 3799, in the NAD group the probe service matches. Phones get `device-traffic-class=voice`. Printers get the three tunnel attributes with `Printers`. TACACS admins get Shell `priv-lvl` 15.

## How to prove it works

**Dead detection.** `show aaa servers` lists each server's state and dead time. Block RADIUS to one node, send a few authentications through, and watch it go DEAD after the criteria are met; unblock it and watch the tester bring it back. Access Tracker should show the probe rejects in your probe service while it's down.

**A laptop.** `show access-session interface <EDGE-PORT> details` shows the method (dot1x), the status (Authorized), the VLAN and the domain. A failure is clearer here than on most platforms: the method list shows which method failed.

**A printer.** Same command, method `mab`. Time it from link up. Around 30 seconds with the template.

**The phone.** `show access-session interface <EDGE-PORT>` should list two sessions, one in the VOICE domain. If the phone sits in DATA, ClearPass didn't send `device-traffic-class=voice`. `show lldp neighbors <EDGE-PORT> detail` for a non Cisco phone's LLDP-MED view.

**The fallbacks.** Block 1812 to all four nodes and bounce a test port: the session should show `CRITICAL_DATA` as an activated template. Give a test MAC no endpoint record: `QUARANTINE`, and it should stay there until ClearPass says otherwise.

**CoA.** `show aaa server radius dynamic-author` should name all four clients and port 3799. Send a reauthenticate from Access Tracker and check the session restarted. If ClearPass says it sent and the switch shows no request, look at the port before you look at the key.

**TACACS.** Log in over SSH as a TACACS user, check you land at the privilege level you meant, then check accounting arrived in Access Tracker before you go near step two.

A Catalyst does most things right out of the box and this one thing wrong for ClearPass. One line moves CoA to where ClearPass sends it; without it, every change of authorization fails and nothing reports it.
