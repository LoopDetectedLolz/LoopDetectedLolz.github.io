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
has(s.exec("vlan").out, "Incomplete", "incomplete command");
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
has(s.exec("show version").out, "FL.10.15", "show version");
has(s.exec("show system").out, "Product Name        : JL725A", "show system model");
has(s.exec("show checkpoint list").out, "startup-config", "checkpoint list");
has(s.exec("copy running-config checkpoint before").out, "Success", "checkpoint written");
run(s, ["conf t", "vlan 44", "name TEMP", "end"]);
has(s.exec("show vlan").out, "TEMP", "vlan 44 exists");
has(s.exec("checkpoint rollback before").out, "restored", "rollback message");
ok(s.exec("show vlan").out.indexOf("TEMP") < 0, "vlan 44 gone after rollback");
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
eq(st.exec("type JL725A").out, "Invalid input: JL725A", "no error thrown after rollback");
run(st, ["conf t", "interface 1/1/5", "aaa authentication port-access mac-auth", "exit", "exit", "interface 1/1/5", "aaa authentication port-access mac-auth"]);
eq(st.prompt(), "switch(config-if-macauth)# ", "can re-enter the mac-auth sub-context after backing out");
eq(st.exec("enable").out, "", "enable works on re-entry");
has(st.exec("ntp server 192.0.2.5").out, "not used in this scenario", "real but unmodelled command gets the scenario message");
has(st.exec("show ntp status").out, "not used in this scenario", "same for a show");
has(st.exec("frobnicate").out, "Invalid input", "nonsense is still invalid");

// ── running config round trip ─────────────────────────────────────────────
section = "roundtrip";
run(s, ["conf t", "interface lag 1", "no routing", "vlan trunk allowed 10", "lacp mode active", "interface 1/1/13", "lag 1", "interface 1/1/5", "description printer port", "aaa authentication port-access mac-auth", "enable", "exit", "aaa authentication port-access client-limit 2", "spanning-tree port-type admin-edge", "spanning-tree bpdu-guard", "end"]);
var saved = s.save(), s2 = CX.create(lesson("sandbox"), saved);
eq(s2.exec("show running-config").out, s.exec("show running-config").out, "config survives save/load");

// ── NAC behaviour ─────────────────────────────────────────────────────────
section = "nac";
var L3 = lesson("nac-03-mac-auth"), n = CX.create(L3);
has(n.exec("show radius-server").out, "unreachable", "wrong key reads as unreachable");
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
has(n.exec("show radius-server statistics").out, "Access Accepts     : 1", "statistics count the accept");
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
ok((t.match(/  F  /g) || []).length === 3, "three failures at the start: " + t.split("\n").slice(-3).join(" | "));
run(r, ["conf t", "vlan 30", "name VOICE", "port-access role EMPLOYEE", "vlan access 10", "port-access role PRINTERS", "vlan access 20", "port-access role VOICE", "vlan access 30", "end"]);
allPass(r, "lab 5 solved");
has(r.exec("show mac-address-table vlan 30").out, "00:00:5e:00:53:03", "phone MAC in VLAN 30");

// precedence, client limit, critical role, CoA
var L6 = lesson("nac-06-precedence"), p = CX.create(L6);
has(p.connect("phone"), "mac-auth success, role VOICE", "dot1x reject falls through to mac-auth");
has(p.connect("pc-behind-phone"), "Client limit 1", "second client hits the limit");
run(p, ["conf t", "interface 1/1/3", "aaa authentication port-access client-limit 2", "end"]);
has(p.exec("show port-access clients interface 1/1/3").out, "EMPLOYEE", "client limit 2 lets the PC in");
has(p.exec("sim coa laptop role QUARANTINE").out, "CoA-NAK", "CoA refused before dyn-authorization");
run(p, ["conf t", "radius dyn-authorization enable", "end"]);
has(p.exec("sim coa laptop role QUARANTINE").out, "CoA-ACK", "CoA applied");
allPass(p, "lab 6 solved");
run(p, ["conf t", "interface 1/1/1", "aaa authentication port-access auth-precedence mac-auth dot1x", "end"]);
has(p.exec("show port-access clients interface 1/1/1 detail").out, "Onboarded Method   : dot1x", "mac-auth first then dot1x still lands on dot1x for an unknown MAC");
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
ok(/00:00:5e:00:53:08\s+10\s+1\/1\/8/.test(two.exec("show mac-address-table").out), "desk switch MAC on 1/1/8");
has(two.exec("show port-access clients").out, "never authenticated", "no NAC message");
run(two, ["conf t", "interface 1/1/3", "description Desk phone", "interface 1/1/8", "shutdown", "end"]);
allPass(two, "lab 2 solved");
has(two.exec("show interface brief").out, "Administratively down", "shutdown shows in brief");

// ── L2 ────────────────────────────────────────────────────────────────────
section = "l2";
var l2 = CX.create(lesson("l2-01-uplink"));
run(l2, ["conf t", "interface lag 1", "no routing", "vlan trunk allowed 10,20,30", "lacp mode active", "interface 1/1/13-1/1/14", "lag 1", "spanning-tree", "interface 1/1/1-1/1/12", "spanning-tree port-type admin-edge", "spanning-tree bpdu-guard", "end"]);
l2.connect("core-01"); l2.connect("desk-switch"); l2.connect("printer"); l2.connect("laptop"); l2.connect("phone");
has(l2.exec("show lacp aggregates").out, "Aggregated interfaces: 1/1/13 1/1/14", "both members aggregate");
has(l2.exec("show lacp interfaces").out, "ALFNCD", "LACP in sync");
has(l2.exec("show interface 1/1/8").out, "BPDU guard", "desk switch err-disabled");
has(l2.exec("show spanning-tree").out, "Root port: 1/1/13", "core is root");
has(l2.exec("show vlan 10").out, "lag1", "lag carries vlan 10");
allPass(l2, "l2 lab solved");
run(l2, ["conf t", "interface 1/1/8", "no shutdown", "end"]);
ok(l2.exec("show interface 1/1/8").out.indexOf("error-disabled") < 0, "no shutdown clears err-disable");
var l2b = CX.create(lesson("l2-01-uplink"));
run(l2b, ["conf t", "interface lag 1", "no routing", "interface 1/1/13-1/1/14", "lag 1", "end"]);
l2b.connect("core-01");
has(l2b.exec("show lacp interfaces").out, "static", "static lag against an LACP partner");
run(l2b, ["conf t", "interface lag 1", "lacp mode passive", "end"]);
has(l2b.exec("show lacp aggregates").out, "Aggregate mode       : up", "passive against an active partner comes up");
has(l2b.exec("show spanning-tree").out, "disabled", "stp off message");
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
has(l3.exec("show ip ospf neighbors").out, "No neighbours", "port down drops the adjacency");
has(l3.exec("show ip interface brief").out, "no member port up", "svi down without a port");
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
  ok(sim.exec("show vlan").out.indexOf("VLAN") === 0, f + " show vlan renders");
  ok(sim.exec("show interface brief").out.indexOf("Port") === 0, f + " show interface brief renders");
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

console.log((fail ? "FAILED " + fail + " of " : "passed ") + (pass + fail) + " checks");
process.exit(fail ? 1 : 0);
