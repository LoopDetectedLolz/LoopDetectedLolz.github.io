#!/usr/bin/env node
/* CX Sandbox engine tests. `node cxsimtest.js`. No browser.
   Drives theme/cxsim/engine.js the way the widget does: every lesson's intended solution
   must pass every check, wrong turns must fail for the reason the lesson teaches, and the
   parser must behave (prefixes, ambiguity, ?, Tab, no forms, context switching). */
var fs = require("fs"), path = require("path");
var CX = require("./theme/cxsim/engine.js");
var LDIR = path.join(__dirname, "theme", "cxsim", "lessons");
function lesson(id) { return JSON.parse(fs.readFileSync(path.join(LDIR, id + ".json"), "utf8")); }

var pass = 0, fail = 0, section = "";
function ok(cond, what) { if (cond) pass++; else { fail++; console.log("  FAIL [" + section + "] " + what); } }
function eq(a, b, what) { ok(a === b, what + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function has(s, sub, what) { ok(String(s).indexOf(sub) >= 0, (what || sub) + " in:\n" + String(s).split("\n").slice(0, 12).join("\n")); }
function run(sim, lines) { var last; lines.forEach(function (l) { last = sim.exec(l); }); return last; }
function allPass(sim, what) { var c = sim.check(); var bad = c.filter(function (x) { return !x.pass; }); ok(!bad.length, what + ": " + bad.map(function (x) { return x.desc + " (" + x.why + ")"; }).join("; ")); }

// ── parser ────────────────────────────────────────────────────────────────
section = "parser";
var s = CX.create(lesson("sandbox"));
eq(s.prompt(), "switch# ", "exec prompt");
eq(s.exec("conf t").prompt, "switch(config)# ", "conf t abbreviates configure terminal");
eq(s.exec("vl 10").prompt, "switch(config-vlan-10)# ", "vl is unique for vlan in config");
eq(s.exec("name STAFF").out, "", "vlan name");
eq(s.exec("int 1/1/1").prompt, "switch(config-if)# ", "interface from inside vlan context");
has(s.exec("no s").out, "Ambiguous", "no s is ambiguous in interface context");
eq(s.exec("no sh").out, "", "no sh is not ambiguous");
eq(s.exec("int 1/1/1-1/1/4").prompt, "switch(config-if-<1/1/1-1/1/4>)# ", "range prompt");
eq(s.exec("vlan access 10").out, "", "vlan access on a range");
has(s.exec("vlan access 77").out, "does not exist", "unknown vlan refused");
has(s.exec("bogus").out, "Invalid input", "invalid command");
has(s.exec("vlan").out, "% Command incomplete.", "incomplete command");
has(s.exec("int 9/9/9").out, "does not exist", "bad interface");
eq(s.exec("end").prompt, "switch# ", "end returns to exec");
has(s.help("sh"), "show", "? lists show");
has(s.help("show "), "running-config", "? after show");
has(s.help("show port-access "), "clients", "? deeper");
has(s.help("show vlan "), "<1-4094>", "? describes a placeholder");
eq(s.complete("show ver").line, "show version ", "tab completes a unique word");
ok(s.complete("show i").options.length >= 2, "tab lists options on a tie: " + s.complete("show i").options.join(","));
has(s.exec("show running-config").out, "vlan 10\n    name STAFF", "running config has the vlan");
has(s.exec("show running-config interface 1/1/2").out, "vlan access 10", "per interface running config");
eq(s.exec("configure").prompt, "switch(config)# ", "configure alone");
eq(s.exec("hostname access-01").prompt, "access-01(config)# ", "hostname changes the prompt");
has(s.exec("hostname bad name").out, "Invalid input", "hostname with a space is invalid");
has(s.exec("write memory").out, "Success", "write memory in config context");
has(s.exec("show startup-config").out, "hostname access-01", "startup config saved");
eq(s.exec("exit").prompt, "access-01# ", "exit from config");
has(s.exec("show version").out, "ML.10.18", "show version (6200 image prefix ML, 10.18 train)");
has(s.exec("show system").out, "Product Name           : R8Q72A 6200F 12G Class4 PoE 2G/2SFP+ 139W", "show system model (part number from HPE QuickSpecs)");
eq(s.exec("show checkpoint list").out, "Checkpoint list doesn't exist", "10.18 reads `list` as a checkpoint name");
has(s.exec("show checkpoint").out, "startup-config                    startup", "show checkpoint lists the startup config");
eq(s.exec("copy running-config checkpoint before").out, "Copying configuration: [Success]", "checkpoint written");
var ckl = s.exec("show checkpoint").out.split("\n");
has(ckl[1], "before                            checkpoint  User", "the new checkpoint is listed first, TYPE checkpoint, as the lab's listing had them");
ok(ckl.some(function (l) { return /^startup-config {20}startup {5}User/.test(l); }), "the startup config is in the list by date");
run(s, ["conf t", "vlan 44", "name TEMP", "end"]);
has(s.exec("show vlan").out, "TEMP", "vlan 44 exists");
eq(s.exec("checkpoint rollback before").out, "Copying configuration: [Success]", "rollback message");
ok(s.exec("show vlan").out.indexOf("TEMP") < 0, "vlan 44 gone after rollback");
has(s.exec("show checkpoint").out, "before", "a rollback keeps the checkpoint store");
has(s.exec("copy running-config checkpoint again").out, "An identical checkpoint already exists", "an identical checkpoint is refused");
eq(s.exec("checkpoint rollback nope").out, "Checkpoint nope doesn't exist", "rollback to a missing checkpoint");
has(s.exec("show checkpoint before").out, "Checkpoint configuration:", "show checkpoint <name> prints it");
has(s.exec("show vlan 10").out, "STAFF", "show vlan by id");
has(s.exec("sim help").out, "sim connect", "sim help");
has(s.exec("sim status").out, "unplugged", "sim status");

// ── contexts whose object vanished, and commands outside the model ────────
section = "stale";
var st = CX.create(lesson("sandbox"));
run(st, ["conf t", "vlan 33", "no vlan 33"]);
eq(st.prompt(), "switch(config)# ", "deleting the vlan you are in drops to config");
run(st, ["interface lag 4", "no interface lag 4"]);
eq(st.prompt(), "switch(config)# ", "deleting the lag you are in drops to config");
run(st, ["vlan 34", "interface vlan 34", "no interface vlan 34"]);
eq(st.prompt(), "switch(config)# ", "deleting the svi you are in drops to config");
run(st, ["vsf member 2", "type JL725A", "checkpoint rollback startup-config"]);
eq(st.prompt(), "switch# ", "rollback returns to exec");
eq(st.exec("type JL725A").out, "Invalid input: type", "no error thrown after rollback");
run(st, ["conf t", "interface 1/1/5", "aaa authentication port-access mac-auth", "exit", "exit", "interface 1/1/5", "aaa authentication port-access mac-auth"]);
eq(st.prompt(), "switch(config-if-macauth)# ", "can re-enter the mac-auth sub-context after backing out");
eq(st.exec("enable").out, "", "enable works on re-entry");
has(st.exec("ntp server 192.0.2.5").out, "not used in this scenario", "real but unmodelled command gets the scenario message");
has(st.exec("show ntp status").out, "not used in this scenario", "same for a show");
has(st.exec("frobnicate").out, "Invalid input", "nonsense is still invalid");

// ── shapes checked against AOS-CX Virtual.10.18.1002 on 2026-09-25 ──────────
section = "parity";
var px = CX.create(lesson("nac-06-precedence"));
has(px.exec("vlan 10").out, "Invalid input: vlan", "exec names the first token it cannot place");
eq(px.exec("show").out, "% Command incomplete.", "incomplete wording");
px.exec("conf t"); px.exec("interface 1/1/5");
eq(px.exec("no s").out, "% Ambiguous command.", "ambiguous wording");
eq(px.exec("aaa authentication port-access mac-auth").prompt, "access-01(config-if-macauth)# ", "macauth sub-context prompt");
px.exec("end");
var rc = px.exec("show running-config").out;
has(rc, "!Version AOS-CX ", "version banner line");
has(rc, "aaa group server radius CLEARPASS\n    server 192.0.2.10 priority 1\n!", "group block with priority and bang");
has(rc, "aaa group server radius radius\n    server 192.0.2.10 priority 1", "built-in radius group listed");
has(rc, "ssh server vrf mgmt\nvlan 1\n", "ssh server line then vlans");
has(rc, "interface mgmt\n    no shutdown\n    ip dhcp\nport-access role", "mgmt block before roles");
ok(rc.indexOf("port-access role EMPLOYEE") < rc.indexOf("aaa authentication port-access dot1x authenticator\n"), "roles before the global dot1x block");
has(px.exec("show running-config interface 1/1/5").out, "\n    exit", "per-interface view ends with exit");
var pz = CX.create(lesson("nac-03-mac-auth"));
has(pz.exec("show port-access clients").out, "No port-access clients found.", "empty clients wording");
has(pz.exec("show vlan").out, "1     DEFAULT_VLAN_1                    down    no_member_forwarding    default     1/1/9-1/1/16", "vlan 1 row shape");
pz.connect("printer");
has(pz.exec("show interface brief").out, "1/1/5          20      access --             yes     up                              1000    --", "brief row shape");
has(px.exec("show ip ospf neighbors").out, "No OSPF neighbor found on VRF default.", "no ospf wording");
eq(px.exec("show arp").out, "No ARP entries found.", "no arp wording");
has(px.exec("show port-access role").out, "Attributes overridden by RADIUS are prefixed by '*'.", "role header");
has(px.exec("show port-access role").out, "    Access VLAN                         : 10", "role vlan line");
has(px.exec("show aaa server-groups").out, "******* AAA Mechanism TACACS+ *******", "server groups header");
has(px.exec("show ip route").out, "Total Route Count : ", "route table footer");
// ? in a sub-context: that context's words plus end, exit, list, no and show, as captured in config-if-macauth
var hq = CX.create(lesson("sandbox")); run(hq, ["conf t", "interface 1/1/1", "aaa authentication port-access mac-auth"]);
eq(hq.help("").split("\n").map(function (l) { return l.trim().split(/\s+/)[0]; }).join(" "),
  "cached-reauth cached-reauth-period disable enable end exit list no quiet-period radius reauth reauth-period show", "? lists the sub-context only, as the box does");
ok(hq.help("").split("\n").every(function (l) { return l.length <= 79; }), "? lines stay within 79 characters");
eq(hq.help("").split("\n")[0].indexOf("Real"), 24, "the word column is the longest word (cached-reauth-period) plus two");

// ── port-access views in 10.18.1002's layout (lab captures 2026-09-26 and 2026-09-28) ───
section = "clients";
var pc = CX.create(lesson("sandbox"));
run(pc, ["conf t", "vlan 10", "vlan 20", "port-access role PRINTERS", "vlan access 20", "port-access role EMPLOYEE", "vlan access 10",
  "radius-server host 192.0.2.10 key plaintext cppm-lab-key", "aaa group server radius CLEARPASS", "server 192.0.2.10", "exit",
  "aaa authentication port-access mac-auth", "radius server-group CLEARPASS", "enable", "exit",
  "aaa authentication port-access dot1x authenticator", "radius server-group CLEARPASS", "enable", "exit",
  "interface 1/1/1-1/1/5", "aaa authentication port-access dot1x authenticator", "enable", "exit", "aaa authentication port-access mac-auth", "enable", "end"]);
pc.connect("laptop"); pc.connect("contractor"); pc.connect("printer");
var tb = pc.exec("show port-access clients").out;
has(tb, "Flags: Onboarding-Method|Mode|Device-Type|Status \n", "flags legend");
has(tb, "Port     Client-Name             IPv4-Address    User-Role                           VLAN            Flags    \n", "column header");
has(tb, "\n1/1/1    employee.user                           EMPLOYEE                            (u)10           1x|c|-|s", "802.1X success row");
has(tb, "\n1/1/5    00005e005305                            PRINTERS                            (u)20           ma|c|-|s", "MAC-auth success row: the name is the MAC-auth user name");
has(tb, "\n1/1/2    j.contractor                                                                                --|c|-|f", "failed row: no method, no role");
var dt = pc.exec("show port-access clients interface 1/1/5 detail").out;
has(dt, "Client 00:00:5e:00:53:05, 00005e005305\n======", "detail heading");
has(dt, "    Status          : mac-auth Authenticated", "mac-auth status");
has(dt, "    Auth Precedence : dot1x - Unauthenticated, mac-auth - Authenticated", "precedence after a supplicant timeout");
has(dt, "    Auth History    : mac-auth - Authenticated, ", "history newest first");
has(dt, "\n                      dot1x - Unauthenticated, Supplicant-Timeout, ", "history continuation line");
has(dt, "    Role   : PRINTERS\n    Status : Applied", "authorization applied");
has(dt, "Role Information:", "detail ends with the role");
var fd = pc.exec("show port-access clients interface 1/1/2 detail").out;
has(fd, "    Status          : Authentication Failed, Server-Reject", "reject status");
has(fd, "    Auth Precedence : dot1x - Unauthenticated, mac-auth - Held", "a rejected MAC is held");
has(pc.exec("show port-access clients mac 00:00:5e:00:53:05").out, "00005e005305", "filter by MAC");
ok(pc.exec("show port-access clients mac 00:00:5e:00:53:05").out.indexOf("employee.user") < 0, "the MAC filter shows one client");
has(pc.exec("show port-access clients role EMPLOYEE").out, "employee.user", "filter by role");
var cs = pc.exec("show aaa authentication port-access interface all client-status").out;
has(cs, "Port Access Client Status Details\n", "client-status heading");
ok(cs.indexOf("VLAN Details") < 0 && cs.indexOf("Client 00:00:5e:00:53:01, employee.user") >= 0, "client-status leaves out the VLAN block");
eq(pc.exec("show aaa authentication port-access").out, "% Command incomplete.", "10.18 needs more after show aaa authentication port-access");
eq(pc.exec("port-access log-off client mac 00:00:5e:00:53:01").out, "", "log a client off");
eq(pc.exec("port-access reauthenticate interface 1/1/5").out, "", "re-authenticate a port");
has(pc.exec("clear port-access clients").out, "Invalid input", "clear port-access clients does not exist on 10.18");
run(pc, ["conf t", "no port-access role EMPLOYEE", "end"]);
has(pc.exec("show port-access clients").out, "\n1/1/1    employee.user                                                                               1x|c|-|f", "role missing: 1x|c|-|f as captured");
has(pc.exec("show port-access clients interface 1/1/1 detail").out, "    Status          : dot1x Authenticated", "role missing still reads authenticated");
run(pc, ["conf t", "port-access role EMPLOYEE", "vlan access 10", "radius-server host 192.0.2.10 key plaintext wrong", "end"]);
var to = pc.exec("show port-access clients interface 1/1/1 detail").out;
has(to, "    Status          : Authentication Failed, Server-Timeout", "timeout status");
has(to, "    Auth Precedence : dot1x - Unauthenticated, mac-auth - Unauthenticated", "both methods tried");
has(to, "    Auth History    : mac-auth - Unauthenticated, Server-Timeout, ", "history on a timeout");
has(pc.exec("show port-access clients").out, "\n1/1/1    employee.user                                                                               --|c|-|f", "timeout row keeps the identity");

// ── the pipe, as 10.18 does it (captured 2026-09-28) ─────────────────────────
section = "pipe";
var pp = CX.create(lesson("nac-06-precedence"));
var rcAll = pp.exec("show running-config").out.replace(/\n$/, "").split("\n");
eq(pp.exec("show running-config | count").out, String(rcAll.length), "| count counts every line");
eq(pp.exec("show running-config | include vlan").out.split("\n").every(function (l) { return /vlan/.test(l); }), true, "| include keeps matching lines");
eq(pp.exec("show vlan | include VOICE").out.split("\n").filter(Boolean).length, 1, "| include on show vlan");
ok(pp.exec("show vlan | exclude VOICE").out.indexOf("VOICE") < 0, "| exclude drops matches");
eq(pp.exec("show running-config | include ^interface").out.split("\n")[0], "interface mgmt", "anchors work");
ok(pp.exec("show running-config | include \"vlan|interface\"").out.split("\n").length > 5, "quoted alternation works");
eq(pp.exec("show running-config | begin \"port-access role VOICE\"").out.split("\n")[0], "port-access role VOICE", "| begin starts at the first match");
eq(pp.exec("show running-config | include interface | count").out, String(rcAll.filter(function (l) { return /interface/.test(l); }).length), "filters chain");
eq(pp.exec("show running-config | section interface").out, "Command not supported.", "no | section on 10.18");
eq(pp.exec("show running-config | include -i VLAN").out, "Command not supported.", "no -i on 10.18");
eq(pp.exec("show vlan |").out, "Command not supported.", "a bare pipe");
eq(pp.exec("show vlan | include").out, "% Command incomplete.", "include without a pattern");
has(pp.exec("show vlan | line-number").out, "not used in this scenario", "line-number is real but not modelled");
eq(pp.help("show vlan | "), ["  begin        Displays the first line that matches the pattern string and ", "               specified number of lines before and after it ",
  "  count        Count the number of lines that match the specified string ", "  exclude      Displays lines that do not match the specified pattern string ",
  "  include      Displays lines that match the specified pattern string ", "  line-number  Displays line numbers along with the command output ",
  "  redirect     Saves the output from cli to a file "].join("\n"), "? after the pipe prints what the box printed");
eq(pp.exec("show vlan 99 | include QUARANTINE").out.split("\n").filter(Boolean).length, 1, "a pipe after arguments");
ok(pp.history().indexOf("show vlan | include VOICE") >= 0, "the whole piped line lands in history");

// ── real commands the sandbox does not model answer like the box (corpus 10.18) ─
section = "corpus";
var cc = CX.create(lesson("sandbox"));
has(cc.exec("show lldp local-device").out, "not used in this scenario", "real show, not modelled");
eq(cc.exec("show lldp foo").out, "Invalid input: foo", "names the first token the box would refuse");
eq(cc.exec("shw vlan").out, "Invalid input: shw", "a typo in the first word");
has(cc.exec("show running-config json").out, "not used in this scenario", "real variant of a modelled command");
has(cc.exec("diag cable-diagnostic test 1/1/1").out, "will cause a loss of link", "cable diagnostics ask first (hardware-only, from HPE's guide)");
eq(cc.prompt(), "Continue (y/n)? ", "the question is the prompt until it is answered");
eq(cc.exec("n").out, "", "no runs nothing");
has(cc.exec("diag cable-diagnostic show 1/1/1").out, "are not available", "no results until a test ran");
eq(cc.exec("no page").out, "", "no page is silent, as every script starts with it");
eq(cc.exec("page 24").out, "", "page with a length");
cc.exec("conf t");
has(cc.exec("ntp server 192.0.2.5").out, "not used in this scenario", "real config command");
eq(cc.exec("ntp bogus").out, "Invalid input: bogus", "wrong keyword under a real command");
cc.exec("interface 1/1/1");
has(cc.exec("lldp med poe").out, "not used in this scenario", "real interface command, not modelled");
eq(cc.exec("lldp med-tlv-select network-policy").out, "Invalid input: med-tlv-select", "not 10.18 syntax");
eq(cc.exec("speed auto 1g").out, "", "speed is modelled on hardware ports (the simulator hides it)");
eq(cc.exec("speed auto 1g 2.5g").out, "Invalid input: 2.5g", "a 1GbT port hides speeds it cannot do, as 10.09 and later do");
eq(cc.exec("speed banana").out, "Invalid input: banana", "speed still checks its words");
has(cc.help("lldp "), "Real ", "? under a real prefix merges the box's words");
cc.exec("end");
eq(cc.exec("show aaa authentication port-access").out, "% Command incomplete.", "incomplete when the box wants more");

// ── releases: syntax per release from the merged corpus, layouts where a release differs ─────
section = "release";
eq(CX.releases().join(" "), "10.15 10.16 10.17 10.18", "four releases harvested");
var rv = CX.create(lesson("sandbox"));
eq(rv.sw.release, "10.18", "newest by default");
has(rv.exec("sim release").out, "10.15, 10.16, 10.17, 10.18", "sim release lists them");
has(rv.exec("sim release 10.15").out, "ML.10.15.1060", "switching says what it runs");
has(rv.exec("show version").out, "ML.10.15.1060", "show version follows");
has(rv.exec("sim release 9.99").out, "Pick one of those", "unknown release refused");
run(rv, ["conf t", "radius-server host 192.0.2.10 key plaintext cppm-lab-key", "aaa group server radius CP"]);
var pr15 = rv.exec("server 192.0.2.10 priority 1").out;
has(pr15, "Invalid input: priority", "10.15 has no server priority");
has(pr15, "the syntax arrived in 10.16", "and the note says when it came");
eq(rv.exec("server 192.0.2.10").out, "", "plain server works in 10.15");
run(rv, ["end"]);
ok(/aaa group server radius CP\n    server 192\.0\.2\.10\n/.test(rv.exec("show running-config").out), "10.15 prints the server without priority");
ok(rv.exec("show running-config").out.indexOf("aaa group server radius radius") < 0, "10.15 does not print the built-in radius group");
rv.exec("sim release 10.16");
has(rv.exec("show running-config").out, "    server 192.0.2.10 priority 1\n!\naaa group server radius radius", "10.16 prints priority and the built-in group");
run(rv, ["conf t", "interface 1/1/1"]);
eq(rv.exec("aaa authentication port-access lldp-loop-guard enable").out, "Invalid input: lldp-loop-guard", "lldp-loop-guard is not in 10.16");
rv.exec("sim release 10.17");
has(rv.exec("aaa authentication port-access lldp-loop-guard enable").out, "not used in this scenario", "it is in 10.17");
eq(rv.exec("lldp med force-send").out, "Invalid input: force-send", "lldp med force-send is not in 10.17");
rv.exec("sim release 10.18");
has(rv.exec("lldp med force-send").out, "not used in this scenario", "it is in 10.18");
rv.exec("end");
var rl = CX.create(lesson("nac-03-mac-auth")); rl.connect("printer");
rl.exec("sim release 10.15");
has(rl.exec("show interface 1/1/5").out, " Link state: up for ", "10.15 says how long the link has been up");
ok(rl.exec("show interface 1/1/5").out.indexOf("Hardware port") < 0, "no Hardware port line before 10.17");
rl.exec("sim release 10.17");
has(rl.exec("show interface 1/1/5").out, " Link state: up\n", "10.16 and later just say up");
has(rl.exec("show interface 1/1/5").out, " Hardware port: 5 ", "10.17 added Hardware port");
var rs = CX.create(lesson("sandbox")); rs.exec("sim release 10.16"); var saved16 = rs.save();
eq(CX.create(lesson("sandbox"), saved16).sw.release, "10.16", "save and load keep the release");
// the labs still solve in every release: the gate only refuses what that release lacks
CX.releases().forEach(function (rel) {
  var l2r = CX.create(lesson("l2-01-uplink")); l2r.exec("sim release " + rel);
  run(l2r, ["conf t", "interface lag 1", "no shutdown", "no routing", "vlan trunk allowed 10,20,30", "lacp mode active", "interface 1/1/13-1/1/14", "lag 1", "spanning-tree", "interface 1/1/1-1/1/12", "spanning-tree port-type admin-edge", "spanning-tree bpdu-guard", "end"]);
  ["core-01", "desk-switch", "printer", "laptop", "phone"].forEach(function (d) { l2r.connect(d); });
  allPass(l2r, "L2 lab solves on " + rel);
  var legend = l2r.exec("show lacp interfaces").out;
  ok((legend.indexOf("IE - LACP Fallback mode is active") >= 0) === (rel === "10.18"), "LACP fallback legend only on 10.18 (" + rel + ")");
  var n3 = CX.create(lesson("nac-03-mac-auth")); n3.exec("sim release " + rel); n3.connect("printer");
  run(n3, ["conf t", "aaa authentication port-access mac-auth", "radius server-group CLEARPASS", "enable", "exit", "interface 1/1/5", "aaa authentication port-access mac-auth", "enable", "exit", "exit", "radius-server host 192.0.2.10 key plaintext cppm-lab-key", "port-access role PRINTERS", "vlan access 20", "end"]);
  allPass(n3, "lab 3 solves on " + rel);
});

// ── running config round trip ─────────────────────────────────────────────
section = "roundtrip";
run(s, ["conf t", "interface lag 1", "no routing", "vlan trunk allowed 10", "lacp mode active", "interface 1/1/13", "lag 1", "interface 1/1/5", "description printer port", "aaa authentication port-access mac-auth", "enable", "exit", "aaa authentication port-access client-limit 2", "spanning-tree port-type admin-edge", "spanning-tree bpdu-guard", "end"]);
var saved = s.save(), s2 = CX.create(lesson("sandbox"), saved);
eq(s2.exec("show running-config").out, s.exec("show running-config").out, "config survives save/load");

// ── NAC behaviour ─────────────────────────────────────────────────────────
section = "nac";
var L3 = lesson("nac-03-mac-auth"), n = CX.create(L3);
has(n.exec("show radius-server").out, "*192.0.2.10", "wrong key reads as unreachable (starred like the box)");
has(n.connect("printer"), "No authentication", "no NAC before it is enabled: printer just lands");
has(n.exec("show port-access clients").out, "No port-access clients", "clients table empty without NAC");
run(n, ["conf t", "aaa authentication port-access mac-auth", "radius server-group CLEARPASS", "enable", "exit", "interface 1/1/5", "aaa authentication port-access mac-auth", "enable", "end"]);
var c = n.exec("show port-access clients detail").out;
has(c, "timed out", "key mismatch times out");
has(c, "secret mismatch", "detail names the shared secret");
run(n, ["conf t", "radius-server host 192.0.2.10 key plaintext cppm-lab-key", "end"]);
c = n.exec("show port-access clients detail").out;
has(c, "Role PRINTERS returned by RADIUS is not defined", "role not defined fails the client");
run(n, ["conf t", "port-access role PRINTERS", "vlan access 20", "end"]);
c = n.exec("show port-access clients").out;
has(c, "S", "success flag"); has(c, "PRINTERS", "role in the table");
ok(/00:00:5e:00:53:05\s+20\s/.test(n.exec("show mac-address-table").out), "printer MAC learned in VLAN 20");
allPass(n, "lab 3 solved");
ok(/^    Access Accepts +: 1 *$/m.test(n.exec("show radius-server statistics authentication").out), "statistics count the accept");
eq(n.exec("show radius-server statistics").out, "% Command incomplete.", "10.18 wants authentication or accounting after statistics");
// mac-auth off globally but on per port: nothing happens
run(n, ["conf t", "aaa authentication port-access mac-auth", "no enable", "end"]);
has(n.exec("show interface 1/1/5").out, "not enabled globally", "interface shows the global gap");
has(n.exec("show port-access clients").out, "No port-access clients", "global disable turns NAC off");
run(n, ["conf t", "aaa authentication port-access mac-auth", "enable", "end"]);
has(n.exec("show port-access clients").out, "PRINTERS", "back on");
// shutting the port drops the client
run(n, ["conf t", "interface 1/1/5", "shutdown", "end"]);
has(n.exec("show port-access clients").out, "No port-access clients", "shutdown drops the session");
run(n, ["conf t", "interface 1/1/5", "no shutdown", "end"]);
has(n.exec("show port-access clients").out, "PRINTERS", "no shutdown brings it back");
has(n.disconnect("printer"), "unplugged", "disconnect");
has(n.exec("show port-access clients").out, "No port-access clients", "unplug drops the session");

// dot1x
var L4 = lesson("nac-04-dot1x"), d = CX.create(L4);
run(d, ["conf t", "aaa authentication port-access dot1x authenticator", "radius server-group CLEARPASS", "enable", "exit", "port-access role EMPLOYEE", "vlan access 10", "interface 1/1/1-1/1/2", "aaa authentication port-access dot1x authenticator", "enable", "end"]);
has(d.connect("laptop"), "dot1x success, role EMPLOYEE", "laptop passes dot1x");
has(d.connect("contractor"), "bad password", "contractor fails with the reason");
has(d.connect("printer"), "mac-auth success", "printer still on mac-auth");
allPass(d, "lab 4 solved");
// a printer on a dot1x-only port
run(d, ["conf t", "interface 1/1/5", "no aaa authentication port-access mac-auth", "aaa authentication port-access dot1x authenticator", "enable", "end"]);
has(d.exec("show port-access clients detail").out, "no supplicant", "printer cannot do dot1x");

// roles lab: everything fails until roles exist
var L5 = lesson("nac-05-roles"), r = CX.create(L5);
var t = r.exec("show port-access clients").out;
ok((t.match(/\|f$/gm) || []).length === 3, "three failures at the start: " + t.split("\n").slice(-4).join(" | "));
has(r.exec("show port-access clients detail").out, "    Status : Invalid", "RADIUS accepted a role the switch lacks: authorization Invalid");
run(r, ["conf t", "vlan 30", "name VOICE", "port-access role EMPLOYEE", "vlan access 10", "port-access role PRINTERS", "vlan access 20", "port-access role VOICE", "vlan access 30", "end"]);
allPass(r, "lab 5 solved");
has(r.exec("show mac-address-table vlan 30").out, "00:00:5e:00:53:03", "phone MAC in VLAN 30");

// precedence, client limit, critical role, CoA
var L6 = lesson("nac-06-precedence"), p = CX.create(L6);
has(p.connect("phone"), "mac-auth success, role VOICE", "dot1x reject falls through to mac-auth");
has(p.connect("pc-behind-phone"), "Client limit 1", "second client hits the limit");
run(p, ["conf t", "interface 1/1/3", "aaa authentication port-access client-limit 2", "end"]);
has(p.exec("show port-access clients interface 1/1/3").out, "EMPLOYEE", "client limit 2 lets the PC in");
has(p.exec("sim coa laptop role QUARANTINE").out, "No reply", "CoA unanswered before dyn-authorization");
run(p, ["conf t", "radius dyn-authorization enable", "end"]);
has(p.exec("sim coa laptop role QUARANTINE").out, "not a dynamic authorization client", "10.18 drops CoA from a server that is not a dyn-authorization client");
has(p.exec("show radius dyn-authorization").out, "Invalid Client Addresses in CoA Requests       : 1", "and counts it as an invalid client address");
has(p.exec("show radius dyn-authorization").out, "No RADIUS dynamic authorization client configured", "empty client list wording");
run(p, ["conf t", "radius dyn-authorization client 192.0.2.10 secret-key plaintext wrong-key", "end"]);
has(p.exec("sim coa laptop role QUARANTINE").out, "does not match", "a wrong CoA secret is dropped");
run(p, ["conf t", "radius dyn-authorization client 192.0.2.10 secret-key plaintext cppm-lab-key", "end"]);
has(p.exec("sim coa laptop role NOSUCH").out, "CoA-NAK", "CoA naming a missing role is NAKed");
has(p.exec("sim coa laptop role QUARANTINE").out, "CoA-ACK", "CoA applied");
has(p.exec("show radius dyn-authorization").out, "CoA ACKs                 : 1", "ACK counted");
has(p.exec("show running-config").out, "radius dyn-authorization client 192.0.2.10 secret-key ciphertext", "client line in the running config");
allPass(p, "lab 6 solved");
var p0 = CX.create(L6); p0.connect("phone"); run(p0, ["conf t", "interface 1/1/3", "aaa authentication port-access client-limit 2", "radius dyn-authorization enable", "end"]); p0.exec("sim coa laptop role QUARANTINE");
ok(p0.check().some(function (x) { return !x.pass && /QUARANTINE/.test(x.desc); }), "lab 6 is not solved by enable alone");
run(p, ["conf t", "interface 1/1/1", "aaa authentication port-access auth-precedence mac-auth dot1x", "end"]);
has(p.exec("show port-access clients interface 1/1/1 detail").out, "    Status          : dot1x Authenticated", "mac-auth first then dot1x still lands on dot1x for an unknown MAC");
has(p.exec("show port-access clients interface 1/1/1 detail").out, "Auth Precedence : mac-auth - Held, dot1x - Authenticated", "precedence line in the configured order");
run(p, ["conf t", "no radius-server host 192.0.2.10", "end"]);
has(p.exec("show port-access clients interface 1/1/1 detail").out, "No RADIUS server", "removing the server fails everyone");
run(p, ["conf t", "radius-server host 192.0.2.10 key plaintext wrong", "interface 1/1/1", "aaa authentication port-access critical-role QUARANTINE", "end"]);
has(p.exec("show port-access clients interface 1/1/1 detail").out, "critical role applied", "critical role on timeout");

// labs 1 and 2
section = "labs12";
var b = CX.create(lesson("nac-01-bench"));
run(b, ["configure", "hostname access-01", "vlan 10", "name STAFF", "vlan 20", "name PRINTERS", "interface 1/1/1-1/1/8", "no shutdown", "vlan access 10", "interface 1/1/5", "vlan access 20", "radius-server host 192.0.2.10 key plaintext cppm-lab-key", "aaa group server radius CLEARPASS", "server 192.0.2.10", "end", "write memory"]);
allPass(b, "lab 1 solved");
var b0 = CX.create(lesson("nac-01-bench")); ok(b0.check().filter(function (x) { return x.pass; }).length <= 1, "lab 1 starts with nothing (but the saved check) passing");
var two = CX.create(lesson("nac-02-discovery"));
has(two.exec("show lldp neighbor-info").out, "SEP00005E005303", "phone shows on LLDP");
ok(/00:00:5e:00:53:08\s+10\s+dynamic\s+1\/1\/8/.test(two.exec("show mac-address-table").out), "desk switch MAC on 1/1/8");
has(two.exec("show port-access clients").out, "never authenticated", "no NAC message");
run(two, ["conf t", "interface 1/1/3", "description Desk phone", "interface 1/1/8", "shutdown", "end"]);
allPass(two, "lab 2 solved");
has(two.exec("show interface brief").out, "Administratively down", "shutdown shows in brief");

// ── L2 ────────────────────────────────────────────────────────────────────
section = "l2";
var l2 = CX.create(lesson("l2-01-uplink"));
run(l2, ["conf t", "interface lag 1", "no routing", "vlan trunk allowed 10,20,30", "lacp mode active", "interface 1/1/13-1/1/14", "lag 1", "spanning-tree", "interface 1/1/1-1/1/12", "spanning-tree port-type admin-edge", "spanning-tree bpdu-guard", "end"]);
l2.connect("core-01");
// 10.18 creates a LAG administratively down (captured 2026-09-28): nothing forms until `no shutdown`
has(l2.exec("show interface lag 1").out, " Admin state is down ", "a new LAG is admin down");
has(l2.exec("show interface brief").out, "lag1           1       trunk  --             no      down    --                      auto    --", "down LAG row as captured");
has(l2.connect("core-01"), "not up", "connect explains the LAG is not up");
ok(l2.check().some(function (x) { return !x.pass && /lag 1 is up/.test(x.desc); }), "the lab is not solved while the LAG is shut");
run(l2, ["conf t", "interface lag 1", "no shutdown", "end"]);
has(l2.exec("show running-config interface lag 1").out, "interface lag 1\n    no shutdown", "no shutdown is written into the LAG block");
l2.connect("desk-switch"); l2.connect("printer"); l2.connect("laptop"); l2.connect("phone");
has(l2.exec("show interface brief").out, "lag1           1       trunk  --             yes     up      --                      2000    --", "up LAG row: Reason --, speed the sum of its members (two 1G copper ports on the 12-port 6200F)");
has(l2.exec("show interface lag 1").out, " Speed                       : 2000 Mb/s ", "LAG speed is the sum of the active members");
has(l2.exec("show lacp aggregates").out, "Interfaces       : 1/1/13 1/1/14", "both members listed"); has(l2.exec("show lacp interfaces").out, "1/1/14     lag1       14    1     ALFNCD", "both members aggregate");
has(l2.exec("show lacp interfaces").out, "ALFNCD", "LACP in sync");
has(l2.exec("show interface 1/1/8").out, "BPDU guard", "desk switch err-disabled");
has(l2.exec("show spanning-tree").out, "Root Port: lag1", "core is root");
has(l2.exec("show vlan 10").out, "lag1", "lag carries vlan 10");
allPass(l2, "l2 lab solved");
run(l2, ["conf t", "interface 1/1/8", "no shutdown", "end"]);
ok(l2.exec("show interface 1/1/8").out.indexOf("error-disabled") < 0, "no shutdown clears err-disable");
var l2b = CX.create(lesson("l2-01-uplink"));
run(l2b, ["conf t", "interface lag 1", "no shutdown", "no routing", "interface 1/1/13-1/1/14", "lag 1", "end"]);
l2b.connect("core-01");
ok(l2b.exec("show lacp interfaces").out.indexOf("ALF") < 0, "static lag shows no LACP state");
run(l2b, ["conf t", "interface lag 1", "lacp mode passive", "end"]);
has(l2b.exec("show lacp aggregates").out, "Aggregate mode   : Passive", "passive mode shown"); has(l2b.exec("show interface brief").out, "lag1           1       access --             yes     up", "passive against an active partner comes up");
has(l2b.exec("show spanning-tree").out, "Spanning-tree is disabled", "stp off message");
// vsf
run(l2b, ["conf t", "vsf member 2", "type JL725A", "link 1 1/1/14", "end"]);
has(l2b.exec("show vsf").out, "Standby", "member 2 listed");
eq(l2b.exec("show running-config interface 2/1/1").out.split("\n")[0], "interface 2/1/1", "member 2 ports exist");
has(l2b.exec("show vsf link").out, "1/1/14", "vsf link listed");

// ── L3 ────────────────────────────────────────────────────────────────────
section = "l3";
var l3 = CX.create(lesson("l3-01-routing"));
l3.connect("core-rtr"); l3.connect("laptop");
has(l3.exec("ping 203.0.113.1").out, "100% packet loss", "no SVI, no ping");
run(l3, ["conf t", "interface vlan 100", "ip address 203.0.113.2/24", "interface vlan 10", "ip address 192.0.2.1/24", "end"]);
has(l3.exec("ping 203.0.113.1").out, "0% packet loss", "router answers on the SVI");
has(l3.exec("ping 198.51.100.10").out, "No route", "no route yet");
run(l3, ["conf t", "ip route 0.0.0.0/0 203.0.113.1", "end"]);
has(l3.exec("ping 198.51.100.10").out, "0% packet loss", "default route reaches the server");
has(l3.exec("show ip route").out, "0.0.0.0/0", "static in the table");
run(l3, ["conf t", "router ospf 1", "router-id 203.0.113.2", "area 0.0.0.1", "interface vlan 100", "ip ospf 1 area 0.0.0.1", "end"]);
has(l3.exec("show ip ospf neighbors").out, "area mismatch", "wrong area explained");
run(l3, ["conf t", "router ospf 1", "area 0.0.0.0", "interface vlan 100", "ip ospf 1 area 0", "end"]);
has(l3.exec("show ip ospf neighbors").out, "FULL", "adjacency forms");
has(l3.exec("show ip route").out, "198.51.100.0/24", "ospf route learned");
has(l3.exec("show ip interface brief").out, "vlan100", "svi listed");
allPass(l3, "l3 lab solved");
has(l3.exec("show arp").out, "203.0.113.1", "arp has the router");
run(l3, ["conf t", "interface 1/1/13", "shutdown", "end"]);
has(l3.exec("show ip ospf neighbors").out, "No OSPF neighbor found", "port down drops the adjacency");
has(l3.exec("show ip interface brief").out, "vlan100          203.0.113.2/24            down/up", "svi down without a port");
// routed port
run(l3, ["conf t", "interface 1/1/12", "routing", "ip address 203.0.113.129/25", "end"]);
has(l3.exec("show running-config interface 1/1/12").out, "ip address 203.0.113.129/25", "routed port config");
has(l3.exec("show interface brief").out, "routed", "routed in brief");

// ── the ten scenarios: each intended solution passes, the wrong turns fail for the reason taught ──
section = "scenarios";
function notSolved(sim, what) { ok(sim.check().some(function (x) { return !x.pass; }), what); }
// 1 LLDP-MED
var s1 = CX.create(lesson("sc-01-lldp-med"));
notSolved(s1, "1: not solved at the start");
has(s1.exec("show lldp neighbor-info 1/1/3").out, "Neighbor Med Policy Unknown    : true", "1: the phone has no VLAN yet, as the lab's emulator advertised");
var s1b = CX.create(lesson("sc-01-lldp-med")); run(s1b, ["conf t", "interface 1/1/3", "vlan trunk native 10", "vlan trunk allowed 10,30", "end"]);
has(s1b.exec("show lldp neighbor-info 1/1/3").out, "Neighbor Med Policy Unknown    : true", "1: tagging 30 without marking it voice sends no policy");
run(s1, ["conf t", "vlan 30", "voice", "interface 1/1/3", "vlan trunk native 10", "vlan trunk allowed 10", "vlan trunk allowed 30", "end"]);
has(s1.exec("show running-config interface 1/1/3").out, "    vlan trunk allowed 10,30", "1: allowed lists add up");
var med = s1.exec("show lldp neighbor-info 1/1/3").out;
has(med, "Neighbor Med Policy VLAN ID    : 30", "1: the phone took VLAN 30"); has(med, "Neighbor Med Policy Priority   : 6", "1: priority 6"); has(med, "Neighbor Med Policy DSCP       : 46", "1: DSCP 46"); has(med, "Neighbor Device class          : CLASS_III", "1: class III");
ok(/00:00:5e:00:53:03\s+30\s/.test(s1.exec("show mac-address-table").out), "1: the phone is learned in VLAN 30");
has(s1.exec("show lldp neighbor-info 1/1/9").out, "Neighbor PoE information       : DOT3", "1: the AP asks for power over DOT3");
has(s1.exec("show vlan voice").out, "30    VOICE", "1: show vlan voice lists it");
allPass(s1, "1 solved");
// 2 device profiles
var s2 = CX.create(lesson("sc-02-device-profiles"));
notSolved(s2, "2: not solved at the start");
run(s2, ["conf t", "port-access lldp-group APS", "match sysname lab-ap", "exit", "port-access role AP-TRUNK", "vlan trunk native 99", "vlan trunk allowed 10,20,99", "exit", "port-access device-profile APS", "associate lldp-group APS", "associate role AP-TRUNK", "enable", "end"]);
eq(s2.exec("show port-access device-profile interface all").out, "No device-profile clients found.", "2: sysname matches whole names only, so lab-ap matches nothing");
run(s2, ["conf t", "port-access lldp-group APS", "no seq 10", "match sys-desc AP-515", "end"]);
allPass(s2, "2 solved");
has(s2.exec("show port-access clients").out, "\n1/1/9    00:00:5e:00:53:09                       AP-TRUNK                            multi           dp|c|-|s", "2: dp row as the lab printed one");
has(s2.exec("show port-access device-profile interface all").out, "  Port 1/1/9, Neighbor-Mac  00:00:5e:00:53:09\n    Profile Name:           : APS\n    LLDP Group:             : APS", "2: device-profile client block");
has(s2.exec("show port-access device-profile").out, "\n    Profile Name            : APS\n    LLDP Groups             : APS", "2: profile view");
has(s2.exec("show running-config").out, "port-access lldp-group APS\n     seq 10 match sys-desc AP-515\nport-access role AP-TRUNK", "2: group before role, rule five spaces in, as the box prints it");
has(s2.exec("show running-config").out, "port-access device-profile APS\n    enable\n    associate role AP-TRUNK\n    associate lldp-group APS", "2: profile block order");
var s2c = CX.create(lesson("sc-02-device-profiles")); run(s2c, ["conf t", "port-access lldp-group APS", "match sys-desc AP-515", "exit", "port-access role AP-TRUNK", "vlan trunk native 99", "exit", "port-access device-profile APS", "associate lldp-group APS", "associate role AP-TRUNK", "end"]);
ok(s2c.check().some(function (x) { return !x.pass && /lab-ap-01/.test(x.desc); }), "2: a profile that is not enabled does nothing");
// 3 multi-domain, and the trap the lab fell into
var s3 = CX.create(lesson("sc-03-multi-domain"));
notSolved(s3, "3: not solved at the start");
run(s3, ["conf t", "port-access lldp-group LLDP-MED-ENDPOINTS", "match vendor-oui 0012bb type 1", "exit", "port-access role VOICE", "device-traffic-class voice", "vlan trunk native 10", "vlan trunk allowed 30", "exit",
  "port-access device-profile PHONES", "associate lldp-group LLDP-MED-ENDPOINTS", "associate role VOICE", "enable", "exit", "interface 1/1/6", "aaa authentication port-access auth-mode multi-domain", "end"]);
has(s3.exec("show port-access clients").out, "1x|m|d|s", "3: the PC gets in beside the phone");
ok(s3.check().some(function (x) { return !x.pass && /voice device/.test(x.desc); }), "3: the phone is still not profiled: its LLDP is dropped");
eq(s3.exec("show lldp neighbor-info 1/1/6").out.indexOf("Neighbor Entries               : 0") > 0, true, "3: no LLDP neighbour on 1/1/6 until allow-lldp-bpdu");
run(s3, ["conf t", "interface 1/1/6", "aaa authentication port-access allow-lldp-bpdu", "end"]);
allPass(s3, "3 solved");
var t3 = s3.exec("show port-access clients").out;
has(t3, "\n1/1/6    00:00:5e:00:53:03                       VOICE                               (u)10,(t)30     dp|m|v|s", "3: phone row, as captured on 2026-09-28");
has(t3, "\n1/1/6    employee.user                           EMPLOYEE                            (u)10           1x|m|d|s", "3: PC row, as captured");
var d3 = s3.exec("show port-access clients mac 00:00:5e:00:53:03 detail").out;
has(d3, "\nDevice-Profile Client Status Details:\n\n  Port 1/1/6, Neighbor-Mac  00:00:5e:00:53:03\n    Profile Name:           : PHONES\n    LLDP Group:             : LLDP-MED-ENDPOINTS", "3: dp detail, as captured");
has(d3, "    Native VLAN                         : 10\n    Allowed Trunk VLANs                 : 30\n    Device Type                         : voice", "3: role information lines, as captured");
has(s3.exec("show vlan 30").out, "30    VOICE                             up      ok                      static      1/1/6", "3: the role makes 1/1/6 a VLAN 30 member, as captured");
has(s3.exec("show running-config interface 1/1/6").out, "    aaa authentication port-access auth-mode multi-domain", "3: multi-domain in the port block");
// 4 UBT and PBT
var s4 = CX.create(lesson("sc-04-ubt"));
notSolved(s4, "4: not solved at the start");
run(s4, ["conf t", "ubt-client-vlan 666", "ubt zone CAMPUS vrf default", "primary-controller ip 192.0.2.50", "exit", "end"]);
has(s4.exec("show ubt").out, "Admin State              : Disabled", "4: a zone is off until enabled");
run(s4, ["conf t", "ubt zone CAMPUS vrf default", "enable", "exit", "port-access role TUNNEL-EMPLOYEE", "gateway-zone zone CAMPUS gateway-role authenticated", "exit", "port-access role PBT-IOT", "gateway-zone zone CAMPUS gateway-role iot", "exit", "interface 1/1/4", "port-access fallback-role PBT-IOT", "end"]);
allPass(s4, "4 solved");
has(s4.exec("show ubt").out, "Operational State        : up", "4: zone up with the gateway reachable");
has(s4.exec("show ubt users count").out, "Total Number of Users using ubt Zone : CAMPUS is 2", "4: two users tunnelled");
has(s4.exec("show ubt brief").out, "CAMPUS       local-vlan   192.0.2.50                    default      Enabled     up", "4: brief row, captured layout");
has(s4.exec("show port-access role name TUNNEL-EMPLOYEE").out, "    Gateway Zone                        : CAMPUS\n    UBT Gateway Role                    : authenticated", "4: role lines, as captured");
has(s4.exec("show running-config").out, "ubt-client-vlan 666\nubt zone CAMPUS vrf default\n    primary-controller ip 192.0.2.50\n    enable", "4: UBT block, as captured");
run(s4, ["conf t", "interface 1/1/13", "shutdown", "end"]);
has(s4.exec("show ubt").out, "Operational State        : down", "4: no gateway, zone down, as on the lab switch");
// 5 multi-gig
var s5 = CX.create(lesson("sc-05-multigig"));
notSolved(s5, "5: not solved at the start");
has(s5.exec("show interface 1/1/1 physical").out, "1/1/1     --             up      up      1G       auto 1g", "5: pinned to 1G");
run(s5, ["conf t", "interface 1/1/1", "speed auto 2.5g", "end"]);
ok(s5.check().some(function (x) { return !x.pass && /5000/.test(x.desc); }), "5: offering 2.5G only gives 2.5G");
run(s5, ["conf t", "interface 1/1/1", "no speed", "interface 1/1/2", "speed auto", "end"]);
allPass(s5, "5 solved");
has(s5.exec("show interface brief").out, "1/1/1          99      access --             yes     up                              5000    --", "5: brief shows 5000");
has(s5.exec("show system").out, "JL660A", "5: the Smart Rate 6300M part number from QuickSpecs");
// 6 LACP
var s6 = CX.create(lesson("sc-06-lacp"));
notSolved(s6, "6: not solved at the start");
has(s6.exec("show lacp interfaces").out, "PLFOEX", "6: both ends passive, nobody starts");
run(s6, ["conf t", "interface lag 1", "lacp mode active", "end"]);
has(s6.exec("show lacp interfaces").out, "PSFNCD", "6: the partner asks for a short timeout");
run(s6, ["conf t", "interface lag 1", "lacp rate fast", "end"]);
has(s6.exec("show lacp interfaces").out, "ASFNCD", "6: this end fast too");
has(s6.exec("show lacp aggregates").out, "Heartbeat rate   : Fast", "6: aggregates says Fast");
allPass(s6, "6 solved");
// 7 debug
var s7 = CX.create(lesson("sc-07-debug"));
notSolved(s7, "7: not solved at the start");
eq(s7.exec("show debug").out, "Not configured", "7: nothing on, as the box says it");
run(s7, ["debug lldp event", "debug portaccess all"]);
has(s7.exec("show debug").out, "lldp               lldp_event                      debug", "7: show debug, captured layout");
s7.disconnect("phone"); s7.connect("phone");
has(s7.exec("show debug buffer module lldp").out, "|lldpd|LOG_DEBUG|AMM|-|LLDP|LLDP_EVENT|lldp_receive_neighbor_clear: intf 1/1/6", "7: the buffer shows the LLDP being dropped, in the lab's line format");
run(s7, ["conf t", "interface 1/1/6", "aaa authentication port-access allow-lldp-bpdu", "end"]);
has(s7.exec("show debug buffer module portaccess | include DEVICEPROFILE").out, "Neighbor SM State transition [NULL] -> [NEIGHBOR MATCHED] for MAC 00:00:5e:00:53:03 on port 1/1/6.", "7: the profile matches, as the lab logged");
has(s7.exec("show debug buffer module portaccess").out, "identity '00:00:5e:00:53:03' onboarded via device-profile successfully.", "7: onboarded line, as the lab logged");
allPass(s7, "7 solved");
eq(s7.exec("no debug destination buffer").out, "Given destination buffer severity level cannot be un-configured. It is the default configuration.", "7: the buffer is the default, as the box answers");
// 8 pipes
var s8 = CX.create(lesson("sc-08-pipes"));
var p8 = s8.exec("show mac-address-table | include 53:4c").out;
eq(p8.split("\n").length, 1, "8: one line"); has(p8, "1/1/38", "8: on 1/1/38");
has(s8.exec("show lldp neighbor-info | include CAM").out, "1/1/31", "8: the camera by its LLDP name");
run(s8, ["conf t", "interface 1/1/38", "shutdown", "interface 1/1/31", "description CAM-DOCK-1", "end"]);
allPass(s8, "8 solved");
// 9 REST
var s9 = CX.create(lesson("sc-09-rest"));
has(s9.exec("sim rest get /rest/v10.18/system/vlans").out, "### HTTP 401", "9: no session, 401");
has(s9.exec("sim rest post /rest/v10.18/login").out, "### HTTP 200", "9: login");
has(s9.exec("sim rest post /rest/v10.18/system/vlans {\"id\":40,\"name\":\"CAMERAS\"}").out, "### HTTP 201", "9: POST 201, as captured");
has(s9.exec("sim rest get /rest/v10.18/system/vlans/40?attributes=id,name,oper_state").out, "{\"id\":40,\"name\":\"CAMERAS\",\"oper_state\":\"down\"}", "9: one VLAN, captured shape");
has(s9.exec("sim rest patch /rest/v10.18/system/interfaces/1%2F1%2F4 {\"description\":\"camera 4\"}").out, "### HTTP 204", "9: PATCH 204");
has(s9.exec("sim rest post /rest/v10.18/cli {\"cmd\":\"show vlan 40\"}").out, "Command 'show vlan 40' not allowed\n### HTTP 403", "9: AnyCLI refuses what is not on its list, as captured");
has(s9.exec("sim rest post /rest/v10.18/cli {\"cmd\":\"show vlan\"}").out, "40    CAMERAS", "9: AnyCLI runs show vlan");
has(s9.exec("sim rest get /rest/v10.18/cli/commands").out, "\"show port-access clients onboarding-method device-profile\"", "9: the command list");
has(s9.exec("sim rest get /rest/v10.18/system/interfaces/1%2F1%2F4?attributes=name,vlan_mode,vlan_tag").out, "{\"name\":\"1/1/4\",\"vlan_mode\":\"access\",\"vlan_tag\":{\"10\":\"/rest/v10.18/system/vlans/10\"}}", "9: interface with URIs, captured shape");
allPass(s9, "9 solved");
// 10 cable diagnostics
var s10 = CX.create(lesson("sc-10-cable"));
has(s10.exec("show interface 1/1/7").out, "Waiting for link", "10: the port waits for a link");
has(s10.exec("diag cable-diagnostic test 1/1/7").out, "This command will cause a loss of link", "10: asks first");
eq(s10.exec("y").out, "", "10: runs on y");
var tdr = s10.exec("diag cable-diagnostic show 1/1/7").out;
has(tdr, "(1GbT)         3-6     open         >115        23 +/- 10", "10: pair 3-6 open at 23 m"); has(tdr, "faked hardware", "10: says the result is the sandbox's");
has(s10.exec("diag cable-diagnostic test 1/1/15").out, "Cable diagnostic is not supported on interface 1/1/15.", "10: not on an SFP+ port, the guide's wording");
run(s10, ["conf t", "interface 1/1/7", "shutdown", "description pair 3-6 open at 23 m", "end"]);
allPass(s10, "10 solved");

// ── every lesson loads and its start config applies cleanly ──────────────
section = "lessons";
fs.readdirSync(LDIR).forEach(function (f) {
  var L = lesson(f.replace(".json", "")), sim = CX.create(L);
  var quiet = sim.sw.apply([]);
  ok(Array.isArray(sim.check()), f + " checks run");
  var rc = sim.exec("show running-config").out;
  (L.startConfig || []).forEach(function (line) { if (/^(hostname|vlan \d|radius-server|aaa group|port-access role)/.test(line)) has(rc, line.split(" key ")[0], f + " start line applied: " + line); });
  ok(sim.exec("show vlan").out.indexOf("VLAN  Name") > 0, f + " show vlan renders");
  ok(sim.exec("show interface brief").out.indexOf("Port           Native") > 0, f + " show interface brief renders");
  (L.devices || []).forEach(function (dv) { ok(typeof sim.connect(dv.id) === "string", f + " connect " + dv.id); });
  ok(sim.exec("show mac-address-table").out.indexOf("MAC age-time") === 0, f + " mac table renders with everything plugged in");
  ok(sim.exec("show port-access clients detail").out.length > 0, f + " clients detail renders");
  ok(sim.exec("show spanning-tree").out.length > 0 && sim.exec("show lldp neighbor-info").out.length > 0 && sim.exec("show ip route").out.length > 0, f + " other shows render");
  var sv = sim.save(); var again = CX.create(L, sv);
  eq(again.exec("show running-config").out, sim.exec("show running-config").out, f + " save/load round trip");
});

// ── ? coverage: every literal in the tree has help text ──────────────────
section = "help";
var probe = CX.create(lesson("sandbox")); probe.exec("conf t");
["", "show ", "interface 1/1/1", "aaa ", "aaa authentication port-access ", "radius-server host 192.0.2.1 ", "spanning-tree ", "ip ", "router ospf 1"].forEach(function (pfx) { var h = probe.help(pfx); ok(h.indexOf("Invalid") < 0, "? for `" + pfx + "` answers: " + h.split("\n")[0]); });
probe.exec("interface 1/1/1");
has(probe.help("vlan trunk "), "allowed", "? inside vlan trunk");
var ifHelp = probe.help("");
["aaa", "vlan", "lag", "spanning-tree", "loop-protect", "routing", "shutdown", "description", "no", "exit", "show"].forEach(function (w) { has(ifHelp, "  " + w, "interface ? lists " + w); });
var noHelp = probe.help("no ");
has(noHelp, "shutdown", "no ? lists shutdown");
var lines = ifHelp.split("\n").filter(function (l) { return l.trim() && !/  \S+\s{2,}\S/.test(l); });
ok(lines.length === 0, "every interface-context word has help text: " + lines.join(" | "));
// every <placeholder> in the command table has a validator, or the parser throws on the line that reaches it
var esrc = fs.readFileSync(path.join(__dirname, "theme", "cxsim", "engine.js"), "utf8"), phKeys = {}, m1, cre = /cmd\(\s*"[^"]*",\s*"([^"]+)"/g, noPh = [];
(esrc.match(/var PH = \{[\s\S]*?\n  \};/) || [""])[0].replace(/"(<[^"]+>)"\s*:/g, function (x, k) { phKeys[k] = 1; });
while ((m1 = cre.exec(esrc))) m1[1].split(" ").forEach(function (tk) { if (tk[0] === "<" && !phKeys[tk]) noPh.push(tk + " in `" + m1[1] + "`"); });
ok(noPh.length === 0, "placeholders without a validator: " + noPh.join(", "));

console.log((fail ? "FAILED " + fail + " of " : "passed ") + (pass + fail) + " checks");
process.exit(fail ? 1 : 0);
