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
has(s.exec("show system").out, "Product Name           : JL725A", "show system model");
eq(s.exec("show checkpoint list").out, "Checkpoint list doesn't exist", "10.18 reads `list` as a checkpoint name");
has(s.exec("show checkpoint").out, "startup-config                    startup", "show checkpoint lists the startup config");
eq(s.exec("copy running-config checkpoint before").out, "Copying configuration: [Success]", "checkpoint written");
has(s.exec("show checkpoint").out, "before                            latest", "the new checkpoint is the latest");
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
has(pz.exec("show vlan").out, "1     DEFAULT_VLAN_1                    down    no_member_forwarding    default     1/1/9-1/1/14", "vlan 1 row shape");
pz.connect("printer");
has(pz.exec("show interface brief").out, "1/1/5          20      access --             yes     up                              1000    --", "brief row shape");
has(px.exec("show ip ospf neighbors").out, "No OSPF neighbor found on VRF default.", "no ospf wording");
eq(px.exec("show arp").out, "No ARP entries found.", "no arp wording");
has(px.exec("show port-access role").out, "Attributes overridden by RADIUS are prefixed by '*'.", "role header");
has(px.exec("show port-access role").out, "    Access VLAN                         : 10", "role vlan line");
has(px.exec("show aaa server-groups").out, "******* AAA Mechanism TACACS+ *******", "server groups header");
has(px.exec("show ip route").out, "Total Route Count : ", "route table footer");

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
has(cc.exec("show lldp neighbor-info detail").out, "not used in this scenario", "real show, not modelled");
eq(cc.exec("show lldp foo").out, "Invalid input: foo", "names the first token the box would refuse");
eq(cc.exec("shw vlan").out, "Invalid input: shw", "a typo in the first word");
has(cc.exec("show running-config json").out, "not used in this scenario", "real variant of a modelled command");
has(cc.exec("diag cable-diagnostic test 1/1/1").out, "not used in this scenario", "cable diagnostics exist on 10.18");
eq(cc.exec("no page").out, "", "no page is silent, as every script starts with it");
eq(cc.exec("page 24").out, "", "page with a length");
cc.exec("conf t");
has(cc.exec("ntp server 192.0.2.5").out, "not used in this scenario", "real config command");
eq(cc.exec("ntp bogus").out, "Invalid input: bogus", "wrong keyword under a real command");
cc.exec("interface 1/1/1");
has(cc.exec("lldp med network-policy").out, "not used in this scenario", "real interface command, not modelled");
eq(cc.exec("lldp med-tlv-select network-policy").out, "Invalid input: med-tlv-select", "not 10.18 syntax");
has(cc.exec("speed auto 1g 2.5g").out, "not used in this scenario", "speed is hardware-only (hardware.txt), the simulator hides it");
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
has(l2.exec("show interface brief").out, "lag1           1       trunk  --             yes     up      --                      20000   --", "up LAG row: Reason --, speed the sum of its members");
has(l2.exec("show interface lag 1").out, " Speed                       : 20000 Mb/s ", "LAG speed is the sum of the active members");
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
