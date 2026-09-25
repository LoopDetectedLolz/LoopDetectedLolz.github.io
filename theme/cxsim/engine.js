/* CX Sandbox engine. A modelled AOS-CX access switch with no DOM in it, so
   `node cxsimtest.js` can drive it the same way the widget does.

   CXSim.create(lesson) -> sim
     sim.exec(line)        -> { out: "text", prompt: "switch#" }
     sim.help(line)        -> "?" listing for a partial line
     sim.complete(line)    -> { line, options } for Tab
     sim.connect(id) / sim.disconnect(id) / sim.coa(id, role)
     sim.check()           -> [{desc, pass}]
     sim.save() / CXSim.create(lesson, saved)

   Output shapes follow the AOS-CX CLI, the wording is ours. It is a model of the box,
   not the box: every table it prints is computed from the config it was given.
   Addresses are RFC 5737, MACs are from the IEEE documentation block. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CXSim = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── models ──────────────────────────────────────────────────────────────
  var MODELS = {
    "6200F-12": { name: "6200F 12G CL4 2SFP+ 139W", pn: "JL725A", copper: 12, sfp: 2, sfpType: "SFP+", poe: true },
    "6200F-24": { name: "6200F 24G CL4 4SFP+ 370W", pn: "JL726A", copper: 24, sfp: 4, sfpType: "SFP+", poe: true },
    "6200F-48": { name: "6200F 48G CL4 4SFP+ 370W", pn: "JL727A", copper: 48, sfp: 4, sfpType: "SFP+", poe: true },
    "6300M-48": { name: "6300M 48G CL4 PoE 4SFP56", pn: "JL662A", copper: 48, sfp: 4, sfpType: "SFP56", poe: true }
  };
  var VERSION = "FL.10.15.1005";

  function portsFor(model, member) {
    var m = MODELS[model] || MODELS["6200F-12"], out = [], i;
    for (i = 1; i <= m.copper; i++) out.push({ name: member + "/1/" + i, type: "1GbT", copper: true });
    for (i = 1; i <= m.sfp; i++) out.push({ name: member + "/1/" + (m.copper + i), type: m.sfpType, copper: false });
    return out;
  }

  // ── small helpers ───────────────────────────────────────────────────────
  function pad(s, n, right) { s = String(s); while (s.length < n) s = right ? " " + s : s + " "; return s; }
  function isIp(s) { var p = s.split("."); return p.length === 4 && p.every(function (x) { return /^\d{1,3}$/.test(x) && +x <= 255; }); }
  function ipNum(s) { return s.split(".").reduce(function (a, x) { return (a * 256) + (+x); }, 0); }
  function numIp(n) { return [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join("."); }
  function maskOf(len) { return len === 0 ? 0 : (0xFFFFFFFF << (32 - len)) >>> 0; }
  function netOf(ip, len) { return (ipNum(ip) & maskOf(len)) >>> 0; }
  function inNet(ip, net, len) { return netOf(ip, len) === netOf(net, len); }
  function macNorm(m) { return (m || "").toLowerCase().replace(/[^0-9a-f]/g, "").replace(/(..)(?=.)/g, "$1:"); }
  function macCx(m) { return macNorm(m); }
  function tsClock(t) { var s = Math.floor(t / 1000), h = Math.floor(s / 3600) % 24, mi = Math.floor(s / 60) % 60; return pad(h, 2, true).replace(/ /g, "0") + ":" + pad(mi, 2, true).replace(/ /g, "0") + ":" + pad(s % 60, 2, true).replace(/ /g, "0"); }
  function uptime(sec) { var d = Math.floor(sec / 86400), h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60; return d + " days, " + h + " hours, " + m + " minutes"; }

  // port name ordering: member/slot/port
  function portKey(n) { var p = n.split("/").map(Number); return p[0] * 1e6 + p[1] * 1e3 + p[2]; }

  // ── the switch ──────────────────────────────────────────────────────────
  function Switch(lesson, saved) {
    this.lesson = lesson || {};
    this.modelId = this.lesson.model || "6200F-12";
    this.model = MODELS[this.modelId] || MODELS["6200F-12"];
    this.version = this.lesson.version || VERSION;
    this.boot = Date.now() - (this.lesson.uptime || 0) * 1000;
    this.tick = 0;                          // command counter, drives fake timestamps
    this.reset();
    if (saved) this.load(saved);
    else if (this.lesson.startConfig) this.apply(this.lesson.startConfig);
    this.startup = this.runningConfig();    // what the lesson booted with is the startup config
    this.dirtyMark = this.runningConfig();
    this.stack = [{ ctx: "exec" }];
    this.history = [];
  }

  Switch.prototype.reset = function () {
    var self = this;
    this.hostname = this.lesson.hostname || "switch";
    this.members = { 1: { model: this.modelId, role: "standby-less", links: {} } };
    this.vsf = { enabled: false, members: {} };  // members 2..n: {type, links: {1:[ports]}}
    this.vlans = { 1: { name: "DEFAULT_VLAN_1", desc: "" } };
    this.ifaces = {};
    portsFor(this.modelId, 1).forEach(function (p) { self.ifaces[p.name] = self.newIface(p); });
    this.lags = {};
    this.svis = {};
    this.radius = [];                       // {host, key, port, vrf}
    this.groups = {};                       // name -> {type:'radius', servers:[]}
    this.pa = { roles: {}, macAuth: false, dot1x: false, macAuthGroup: "", dot1xGroup: "", dynAuth: false };
    this.stp = { enable: false, mode: "mstp", priority: 8 };
    this.routes = [];                       // {prefix, len, nh, ifname}
    this.ospf = {};                         // proc -> {routerId, areas:{}, passive:[]}
    this.checkpoints = [];
    this.clients = {};                      // devId -> auth record
    this.devices = {};                      // devId -> {connected}
    this.errdisabled = {};
    this.log = [];
    (this.lesson.devices || []).forEach(function (d) { self.devices[d.id] = { connected: !!d.connected }; });
  };

  Switch.prototype.newIface = function (p) {
    return { name: p.name, type: p.type, copper: p.copper, shutdown: false, routing: false, mode: "access", access: 1,
      trunk: null, native: 1, nativeTag: false, lag: 0, desc: "", clientLimit: 0, precedence: null,
      macAuth: false, dot1x: false, critRole: "", rejectRole: "", adminEdge: false, bpduGuard: false, loopProtect: false,
      ip: null, ospf: null, mtu: 1500 };
  };

  Switch.prototype.now = function () { return Date.now() + this.tick * 1000; };
  Switch.prototype.dev = function (id) { return (this.lesson.devices || []).filter(function (d) { return d.id === id; })[0]; };
  Switch.prototype.devsOn = function (port) { var self = this; return (this.lesson.devices || []).filter(function (d) { return (d.ports || [d.port]).indexOf(port) >= 0 && self.devices[d.id] && self.devices[d.id].connected; }); };

  Switch.prototype.portNames = function () { return Object.keys(this.ifaces).sort(function (a, b) { return portKey(a) - portKey(b); }); };
  Switch.prototype.hasIface = function (n) { return !!this.ifaces[n]; };

  // ── link state ──────────────────────────────────────────────────────────
  Switch.prototype.linkUp = function (name) {
    var i = this.ifaces[name]; if (!i || i.shutdown || this.errdisabled[name]) return false;
    if (this.vsfPortOf(name)) return true;
    return this.devsOn(name).length > 0;
  };
  Switch.prototype.vsfPortOf = function (name) {
    var m = this.vsf.members, k;
    for (k in m) { var links = m[k].links || {}; for (var l in links) if (links[l].indexOf(name) >= 0) return { member: k, link: l }; }
    return null;
  };
  Switch.prototype.lagUp = function (id) {
    var self = this, members = this.lagMembers(id), lag = this.lags[id];
    if (!lag || lag.shutdown) return { up: false, active: [] };
    var active = members.filter(function (p) {
      if (!self.linkUp(p)) return false;
      var d = self.devsOn(p)[0]; if (!d || d.kind !== "switch" || !d.lacp) return lag.lacp === "off";
      if (lag.lacp === "off") return true;
      return d.lacp.lag === "any" || (d.lacp.ports || []).indexOf(p) >= 0;
    });
    return { up: active.length > 0, active: active };
  };
  Switch.prototype.lagMembers = function (id) { var self = this; return this.portNames().filter(function (p) { return self.ifaces[p].lag === +id; }); };

  // ── running config ──────────────────────────────────────────────────────
  Switch.prototype.runningConfig = function (showKeys) {
    var self = this, o = [];
    o.push("Current configuration:", "!", "!Version " + this.version, "!export-password: default", "hostname " + this.hostname);
    o.push("user admin group administrators password ciphertext <hidden>");
    Object.keys(this.vlans).map(Number).sort(function (a, b) { return a - b; }).forEach(function (v) {
      o.push("vlan " + v);
      if (self.vlans[v].name && !(v === 1 && self.vlans[v].name === "DEFAULT_VLAN_1")) o.push("    name " + self.vlans[v].name);
      if (self.vlans[v].desc) o.push("    description " + self.vlans[v].desc);
    });
    if (this.pa.macAuth || this.pa.dot1x || this.radius.length) o.push("radius dyn-authorization " + (this.pa.dynAuth ? "enable" : "disable"));
    this.radius.forEach(function (r) { o.push("radius-server host " + r.host + (r.key ? (showKeys ? " key plaintext " + r.key : " key ciphertext <hidden>") : "") + (r.vrf ? " vrf " + r.vrf : "")); });
    Object.keys(this.groups).forEach(function (g) {
      o.push("aaa group server radius " + g);
      self.groups[g].servers.forEach(function (s) { o.push("    server " + s); });
    });
    if (this.pa.dot1x || this.pa.dot1xGroup) {
      o.push("aaa authentication port-access dot1x authenticator");
      if (this.pa.dot1xGroup) o.push("    radius server-group " + this.pa.dot1xGroup);
      if (this.pa.dot1x) o.push("    enable");
    }
    if (this.pa.macAuth || this.pa.macAuthGroup) {
      o.push("aaa authentication port-access mac-auth");
      if (this.pa.macAuthGroup) o.push("    radius server-group " + this.pa.macAuthGroup);
      if (this.pa.macAuth) o.push("    enable");
    }
    Object.keys(this.pa.roles).forEach(function (r) {
      var role = self.pa.roles[r];
      o.push("port-access role " + r);
      if (role.desc) o.push("    description " + role.desc);
      if (role.vlan) o.push("    vlan access " + role.vlan);
    });
    Object.keys(this.vsf.members).forEach(function (m) {
      var mm = self.vsf.members[m];
      o.push("vsf member " + m, "    type " + (mm.type || self.model.pn).toLowerCase());
      Object.keys(mm.links || {}).forEach(function (l) { mm.links[l].forEach(function (p) { o.push("    link " + l + " " + p); }); });
    });
    if (this.stp.enable) { o.push("spanning-tree"); if (this.stp.mode !== "mstp") o.push("spanning-tree mode " + this.stp.mode); if (this.stp.priority !== 8) o.push("spanning-tree priority " + this.stp.priority); }
    Object.keys(this.lags).map(Number).sort(function (a, b) { return a - b; }).forEach(function (id) {
      var l = self.lags[id];
      o.push("interface lag " + id);
      if (l.desc) o.push("    description " + l.desc);
      o.push(l.shutdown ? "    shutdown" : "    no shutdown");
      o.push("    no routing");
      self.l2Lines(l, o);
      if (l.lacp !== "off") o.push("    lacp mode " + l.lacp);
    });
    this.portNames().forEach(function (n) {
      var i = self.ifaces[n], hasCfg;
      o.push("interface " + n);
      if (i.desc) o.push("    description " + i.desc);
      o.push(i.shutdown ? "    shutdown" : "    no shutdown");
      if (i.lag) { o.push("    lag " + i.lag); return; }
      if (i.routing) { if (i.ip) o.push("    ip address " + i.ip); if (i.ospf) o.push("    ip ospf " + i.ospf.proc + " area " + i.ospf.area); return; }
      o.push("    no routing");
      self.l2Lines(i, o);
      if (i.adminEdge) o.push("    spanning-tree port-type admin-edge");
      if (i.bpduGuard) o.push("    spanning-tree bpdu-guard");
      if (i.loopProtect) o.push("    loop-protect");
      if (i.clientLimit) o.push("    aaa authentication port-access client-limit " + i.clientLimit);
      if (i.critRole) o.push("    aaa authentication port-access critical-role " + i.critRole);
      if (i.rejectRole) o.push("    aaa authentication port-access reject-role " + i.rejectRole);
      if (i.dot1x) o.push("    aaa authentication port-access dot1x authenticator", "        enable");
      if (i.macAuth) o.push("    aaa authentication port-access mac-auth", "        enable");
      if (i.precedence) o.push("    aaa authentication port-access auth-precedence " + i.precedence.join(" "));
    });
    Object.keys(this.svis).map(Number).sort(function (a, b) { return a - b; }).forEach(function (v) {
      var s = self.svis[v];
      o.push("interface vlan " + v);
      if (s.desc) o.push("    description " + s.desc);
      if (s.shutdown) o.push("    shutdown");
      if (s.ip) o.push("    ip address " + s.ip);
      if (s.ospf) o.push("    ip ospf " + s.ospf.proc + " area " + s.ospf.area);
    });
    this.routes.forEach(function (r) { o.push("ip route " + r.prefix + "/" + r.len + " " + r.nh); });
    Object.keys(this.ospf).forEach(function (p) {
      var pr = self.ospf[p];
      o.push("router ospf " + p);
      if (pr.routerId) o.push("    router-id " + pr.routerId);
      Object.keys(pr.areas).forEach(function (a) { o.push("    area " + a); });
      pr.passive.forEach(function (i) { o.push("    passive-interface " + i); });
    });
    o.push("https-server vrf mgmt");
    return o.join("\n");
  };
  Switch.prototype.l2Lines = function (i, o) {
    if (i.mode === "access") o.push("    vlan access " + i.access);
    else {
      if (i.native !== 1 || i.nativeTag) o.push("    vlan trunk native " + i.native + (i.nativeTag ? " tag" : ""));
      o.push("    vlan trunk allowed " + (i.trunk ? i.trunk.slice().sort(function (a, b) { return a - b; }).join(",") : "all"));
    }
  };

  Switch.prototype.configSection = function (header) {
    var lines = this.runningConfig().split("\n"), out = [], on = false, i;
    for (i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (on) { if (/^\S/.test(l)) break; out.push(l); }
      else if (l === header) { on = true; out.push(l); }
    }
    return on ? out : null;
  };

  // apply a list of config lines (lesson start config, saved state) through the parser
  Switch.prototype.apply = function (lines) {
    var self = this, saved = this.stack, quiet = [];
    this.stack = [{ ctx: "exec" }, { ctx: "config" }];
    lines.forEach(function (l) { var r = self.run(l, true); if (r && /^(Invalid|Ambiguous|Incomplete)/.test(r.out)) quiet.push(l + " -> " + r.out); });
    this.stack = saved || [{ ctx: "exec" }];
    return quiet;
  };

  // the running config as the CLI lines the parser re-reads, parents before children
  Switch.prototype.configLines = function () {
    return this.runningConfig(true).split("\n").filter(function (l) {
      return l && l[0] !== "!" && !/^Current configuration|^user admin|^https-server/.test(l);
    }).map(function (l) { return l.trim(); });
  };

  Switch.prototype.save = function () {
    var self = this;
    return { config: this.configLines(), devices: this.devices, clients: this.clients, errdisabled: this.errdisabled, checkpoints: this.checkpoints, startup: this.startup };
  };
  Switch.prototype.load = function (s) {
    var self = this;
    this.reset();
    this.apply(s.config || []);
    Object.keys(s.devices || {}).forEach(function (k) { if (self.devices[k]) self.devices[k] = s.devices[k]; });
    this.errdisabled = s.errdisabled || {};
    this.checkpoints = s.checkpoints || [];
    this.reauthAll();
    if (s.startup) this.startup = s.startup;
  };

  // ── the parser ──────────────────────────────────────────────────────────
  // A command is a pattern of literals and <placeholders>. Literals accept unique prefixes.
  var HELP = {
    "show": "Show running system information", "configure": "Enter configuration context", "terminal": "From the terminal",
    "exit": "Leave the current context", "end": "Return to the exec context", "write": "Save the configuration", "memory": "Copy the running config to the startup config",
    "copy": "Copy a configuration", "running-config": "The running configuration", "startup-config": "The startup configuration", "checkpoint": "Configuration checkpoints",
    "ping": "Send ICMP echo requests", "clear": "Clear learned state", "sim": "Sandbox devices (not a switch command)",
    "hostname": "Set the system hostname", "vlan": "VLAN configuration", "interface": "Select an interface", "lag": "Link aggregation group",
    "radius-server": "RADIUS server settings", "host": "A RADIUS server address", "key": "Shared secret", "plaintext": "Key given in clear text", "vrf": "VRF the server is reached through",
    "radius": "RADIUS", "dyn-authorization": "RFC 5176 change of authorization and disconnect", "enable": "Turn on", "disable": "Turn off",
    "aaa": "Authentication, authorization and accounting", "group": "Server group", "server": "A server", "authentication": "Authentication settings", "port-access": "Port access (NAC) settings",
    "dot1x": "IEEE 802.1X", "authenticator": "Act as the 802.1X authenticator", "mac-auth": "MAC authentication", "server-group": "RADIUS server group to use", "client-limit": "Maximum clients on the port",
    "auth-precedence": "Order the methods are tried in", "critical-role": "Role applied when every RADIUS server is unreachable", "reject-role": "Role applied on Access-Reject",
    "role": "A port-access role", "description": "A description", "name": "A name", "access": "Untagged access VLAN", "trunk": "Trunk (tagged) VLANs", "allowed": "VLANs allowed on the trunk", "native": "Untagged VLAN on the trunk", "tag": "Tag the native VLAN", "all": "Every VLAN",
    "shutdown": "Administratively disable", "no": "Negate a command or set its default", "routing": "Layer 3 interface (routed port)", "lacp": "LACP settings", "mode": "Mode", "active": "Initiate LACP", "passive": "Respond to LACP only",
    "spanning-tree": "Spanning tree", "port-type": "Spanning tree port type", "admin-edge": "Edge port (goes straight to forwarding)", "bpdu-guard": "Disable the port if a BPDU arrives", "priority": "Bridge priority (multiplied by 4096)", "mstp": "Multiple spanning tree", "rpvst": "Rapid per-VLAN spanning tree",
    "loop-protect": "Loop protection", "ip": "IP settings", "address": "IP address", "route": "Static route", "ospf": "OSPFv2", "area": "OSPF area", "router": "Routing protocol", "router-id": "Router ID", "passive-interface": "Do not form adjacencies on this interface",
    "vsf": "Virtual switching framework (stacking)", "member": "Stack member", "type": "Member model", "link": "VSF link", "brief": "One line per entry", "detail": "Full detail", "version": "Software version", "system": "System information",
    "mac-address-table": "Learned MAC addresses", "lldp": "Link layer discovery", "neighbor-info": "Neighbours seen on LLDP", "interfaces": "Per-interface view", "aggregates": "Per-LAG view", "summary": "Summary", "neighbors": "OSPF neighbours",
    "clients": "Authenticated and failed clients", "client-status": "Per-client authentication status", "server-groups": "Configured server groups", "statistics": "Counters", "list": "List entries", "arp": "ARP table", "rollback": "Restore a checkpoint",
    "repetitions": "Number of echo requests", "connect": "Plug a device into its port", "disconnect": "Unplug a device", "coa": "Send a change of authorization from the fake RADIUS server", "status": "What is plugged in and how it authenticated", "reset": "Put the lab back to its starting state", "help": "How the sandbox commands work"
  };
  var PH = {
    "<1-4094>": ["VLAN id", function (t) { return /^\d+$/.test(t) && +t >= 1 && +t <= 4094; }],
    "<1-256>": ["Number 1 to 256", function (t) { return /^\d+$/.test(t) && +t >= 1 && +t <= 256; }],
    "<1-63>": ["Process id", function (t) { return /^\d+$/.test(t) && +t >= 1 && +t <= 63; }],
    "<0-15>": ["Priority 0 to 15", function (t) { return /^\d+$/.test(t) && +t >= 0 && +t <= 15; }],
    "<2-8>": ["Member 2 to 8", function (t) { return /^\d+$/.test(t) && +t >= 2 && +t <= 8; }],
    "<1-2>": ["Link 1 or 2", function (t) { return t === "1" || t === "2"; }],
    "<1-10>": ["Count", function (t) { return /^\d+$/.test(t) && +t >= 1 && +t <= 10; }],
    "<A.B.C.D>": ["IPv4 address", isIp],
    "<AREA>": ["Area id, a number or dotted form", function (t) { return isIp(t) || /^\d+$/.test(t); }],
    "<A.B.C.D/M>": ["IPv4 prefix", function (t) { var p = t.split("/"); return p.length === 2 && isIp(p[0]) && /^\d+$/.test(p[1]) && +p[1] <= 32; }],
    "<IFNAME>": ["Interface, e.g. 1/1/5 or 1/1/1-1/1/4", function (t) { return /^\d+\/\d+\/\d+(-\d+\/\d+\/\d+)?(,\d+\/\d+\/\d+(-\d+\/\d+\/\d+)?)*$/.test(t); }],
    "<PORT>": ["Interface, e.g. 1/1/5", function (t) { return /^\d+\/\d+\/\d+$/.test(t); }],
    "<VLIST>": ["VLAN list, e.g. 10,20,30-40, or all", function (t) { return /^(all|\d+(-\d+)?(,\d+(-\d+)?)*)$/.test(t); }],
    "<WORD>": ["Name", function (t) { return /^\S+$/.test(t); }],
    "<LINE>": ["Text", function () { return true; }],
    "<DEV>": ["Device id from the Devices panel", function (t) { return /^\S+$/.test(t); }]
  };

  var CMDS = {};                       // ctx -> [cmd]
  function cmd(ctx, pattern, fn, help) { (CMDS[ctx] = CMDS[ctx] || []).push({ p: pattern.split(" "), fn: fn, help: help || "" }); }
  function tokens(line) { return line.trim().split(/\s+/).filter(Boolean); }

  // match tokens against a pattern. returns {state:'full'|'partial'|'no', args, extra}
  function matchPattern(p, toks) {
    var args = [], i, exact = 0;
    for (i = 0; i < p.length; i++) {
      var pt = p[i], t = toks[i];
      if (t === undefined) return { state: "partial", args: args, at: i, exact: exact };
      if (pt[0] === "<") {
        if (pt === "<LINE>") { args.push(toks.slice(i).join(" ")); return { state: "full", args: args, exact: exact }; }
        if (!PH[pt][1](t)) return { state: "no" };
        args.push(t);
      } else {
        if (pt.indexOf(t.toLowerCase()) !== 0) return { state: "no" };
        if (pt === t.toLowerCase()) exact++;
        args.push(pt);
      }
    }
    if (toks.length > p.length) return { state: "no" };
    return { state: "full", args: args, exact: exact };
  }

  // the contexts a command may come from, nearest first. Config-level commands are reachable
  // from any sub-context (entering `interface 1/1/2` from inside `interface 1/1/1` works on CX).
  Switch.prototype.ctxChain = function () {
    var chain = [], i;
    for (i = this.stack.length - 1; i >= 0; i--) chain.push(i);
    return chain;
  };
  Switch.prototype.ctx = function () { return this.stack[this.stack.length - 1]; };
  Switch.prototype.push = function (c) { this.stack.push(c); };
  Switch.prototype.pop = function () { if (this.stack.length > 1) this.stack.pop(); };

  Switch.prototype.prompt = function () {
    var c = this.ctx(), h = this.hostname;
    switch (c.ctx) {
      case "exec": return h + "# ";
      case "config": return h + "(config)# ";
      case "if": return h + "(config-if" + (c.ifs.length > 1 ? "-<" + c.ifs[0] + "-" + c.ifs[c.ifs.length - 1] + ">" : "") + ")# ";
      case "lag": return h + "(config-lag-if)# ";
      case "vlan": return h + "(config-vlan-" + c.id + ")# ";
      case "svi": return h + "(config-if-vlan)# ";
      case "sg": return h + "(config-sg)# ";
      case "role": return h + "(config-pa-role)# ";
      case "dot1x": return h + "(config-dot1x-auth)# ";
      case "macauth": return h + "(config-macauth)# ";
      case "dot1x-if": return h + "(config-if-dot1x-auth)# ";
      case "macauth-if": return h + "(config-if-macauth)# ";
      case "vsf": return h + "(config-vsf-member-" + c.id + ")# ";
      case "ospf": return h + "(config-ospf-" + c.id + ")# ";
    }
    return h + "# ";
  };

  Switch.prototype.candidates = function () {
    // commands visible from here: this context, then each parent, then exec-anywhere
    var self = this, list = [];
    this.ctxChain().forEach(function (i) {
      var c = self.stack[i].ctx;
      (CMDS[c] || []).forEach(function (x) { list.push({ cmd: x, level: i }); });
    });
    (CMDS["*"] || []).forEach(function (x) { list.push({ cmd: x, level: -1 }); });
    return list;
  };

  Switch.prototype.run = function (line, quiet) {
    var self = this, toks = tokens(line), out;
    if (!toks.length) return { out: "", prompt: this.prompt() };
    this.tick++;
    var full = [], partial = false, lits = [];
    this.candidates().forEach(function (c) {
      var m = matchPattern(c.cmd.p, toks);
      if (m.state === "no") return;
      if (m.state === "full") full.push({ c: c, m: m }); else partial = true;
      c.cmd.p.forEach(function (pt, i) { if (i < toks.length && pt[0] !== "<") { (lits[i] = lits[i] || {})[pt] = 1; } });
    });
    for (var ai = 0; ai < toks.length; ai++) {
      var set = Object.keys(lits[ai] || {});
      if (set.length > 1 && set.indexOf(toks[ai].toLowerCase()) < 0) return { out: "Ambiguous input: " + toks[ai], prompt: this.prompt() };
    }
    if (!full.length) {
      if (!partial && outsideScope(toks)) return { out: "This command is not used in this scenario. (It exists on the real switch; the sandbox does not model it.)", prompt: this.prompt() };
      out = partial ? "Incomplete command." : "Invalid input: " + toks[toks.length - 1];
      return { out: out, prompt: this.prompt() };
    }
    // prefer the nearest context, then the most exact literal matches
    full.sort(function (a, b) { return (b.c.level - a.c.level) || (b.m.exact - a.m.exact); });
    if (full.length > 1 && full[0].c.level === full[1].c.level && full[0].m.exact === full[1].m.exact && full[0].c.cmd !== full[1].c.cmd
        && full[0].c.cmd.p.join(" ") !== full[1].c.cmd.p.join(" ")) {
      // two different commands tie: ambiguous unless one is the exact spelling
      return { out: "Ambiguous command: " + toks.join(" "), prompt: this.prompt() };
    }
    var pick = full[0];
    if (pick.c.level >= 0 && pick.c.level < this.stack.length - 1) this.stack = this.stack.slice(0, pick.c.level + 1);
    try { out = pick.c.cmd.fn.call(this, pick.m.args, toks) || ""; }
    catch (e) { out = "Error: " + (e.message || e); }
    this.validateStack();
    if (!quiet) this.history.push(line);
    return { out: out, prompt: this.prompt() };
  };

  // A context whose object was deleted underneath it (no vlan 10 from inside vlan 10, a
  // rollback, no interface lag 1 from inside the lag) drops back to the nearest live parent.
  Switch.prototype.validateStack = function () {
    var self = this, keep = [], alive = true;
    this.stack.forEach(function (c) {
      if (!alive) return;
      var ok = true;
      switch (c.ctx) {
        case "if": ok = (c.ifs || []).every(function (n) { return !!self.ifaces[n]; }); break;
        case "lag": ok = !!self.lags[c.id]; break;
        case "vlan": ok = !!self.vlans[c.id]; break;
        case "svi": ok = !!self.svis[c.id]; break;
        case "sg": ok = !!self.groups[c.id]; break;
        case "role": ok = !!self.pa.roles[c.id]; break;
        case "vsf": ok = !!self.vsf.members[c.id]; break;
        case "ospf": ok = !!self.ospf[c.id]; break;
      }
      if (ok) keep.push(c); else alive = false;
    });
    this.stack = keep.length ? keep : [{ ctx: "exec" }];
  };

  // Real CX commands this model does not carry. They get a plain answer instead of
  // "Invalid input", so a reader knows the box has the command and the lab does not need it.
  var OUTSIDE = ["ntp", "ssh", "snmp-server", "snmpv3", "dhcp-server", "dhcpv4-snooping", "dhcp", "ip dns", "ip source-interface", "banner", "user ", "clock", "logging", "vrf", "ip access-list", "ipv6", "access-list", "class ", "policy", "qos", "poe", "power-over-ethernet", "lldp", "cdp", "interface mgmt", "https-server", "led", "mirror", "arp", "router bgp", "router pim", "vrrp", "vsx", "evpn", "aaa authentication login", "aaa authorization", "aaa accounting", "tacacs-server", "boot", "reload", "erase", "show tech", "show log", "show event", "show power", "show environment", "show images", "show ip dhcp", "show ntp", "show ssh", "show snmp", "show lldp local", "show ip ospf database", "show ip ospf routes", "show interface vlan", "show interface lag", "show interface transceiver", "show interface statistics", "show poe", "show module", "show hardware", "show cpu", "show memory", "show capacities", "show boot", "show clock", "show ip arp", "show ip dns", "show vsx", "show mac-address", "show port-access mac-auth", "show port-access dot1x", "show port-access lldp", "show aaa authentication login", "show tacacs", "show user", "show session", "show ip igmp", "igmp", "multicast", "mld", "loop-protect vlan", "dhcpv4", "nd-snooping", "ip helper", "ip igmp", "rate-limit", "storm-control", "mtu", "speed", "duplex", "flow-control", "energy-efficient", "uplink", "vlan trunk allowed all", "ip client-tracker", "aaa authentication port-access cached-reauth", "aaa authentication port-access reauth", "port-access onboarding", "port-access policy", "port-access lldp-group", "port-access device-profile", "port-access mac-auth", "port-access dot1x", "trust", "spanning-tree link-type", "spanning-tree root-guard", "spanning-tree loop-guard", "spanning-tree tcn-guard", "spanning-tree cost", "spanning-tree port-priority", "spanning-tree config-name", "spanning-tree instance", "spanning-tree hello", "spanning-tree forward", "spanning-tree max", "session-timeout", "cli-session", "auto-confirm", "alias", "debug", "diagnostic", "top", "traceroute", "telnet", "dir", "profile", "system", "module", "update-management", "web-ui", "rest", "interface loopback", "interface tunnel", "ip mtu", "ip proxy-arp", "ip directed", "ip icmp", "ip routing", "ip ecmp", "ip route 0", "ip ospf network", "ip ospf cost", "ip ospf hello", "ip ospf dead", "ip ospf authentication", "ip ospf priority", "ip ospf passive", "ip ospf bfd", "default-information", "redistribute", "max-metric", "timers", "graceful", "network ", "neighbor", "no network", "vlan trunk native tag", "auto-vlan", "hash", "lacp rate", "lacp fallback", "port-security", "ip nat"];
  function outsideScope(toks) {
    var line = toks.join(" ").toLowerCase(), head = line.replace(/^no /, "");
    return OUTSIDE.some(function (o) { return head.indexOf(o) === 0 || line.indexOf(o) === 0; });
  }
  Switch.prototype.exec = Switch.prototype.run;

  // "?" help for a partial line. `line` is what the user typed before the ?
  Switch.prototype.help = function (line) {
    var toks = tokens(line), trailing = /\s$/.test(line) || !toks.length, partialTok = trailing ? "" : toks.pop();
    var seen = {}, rows = [];
    this.candidates().forEach(function (c) {
      var m = matchPattern(c.cmd.p, toks);
      if (m.state === "no") return;
      var at = toks.length;
      if (m.state === "full") { if (c.cmd.p.length === toks.length && !partialTok) { if (!seen["<cr>"]) { seen["<cr>"] = 1; rows.push(["<cr>", ""]); } } return; }
      var next = c.cmd.p[at]; if (!next) return;
      if (next[0] === "<") { if (partialTok && !PH[next][1](partialTok) && next !== "<LINE>") return; if (!seen[next]) { seen[next] = 1; rows.push([next, PH[next][0]]); } }
      else { if (partialTok && next.indexOf(partialTok.toLowerCase()) !== 0) return; if (!seen[next]) { seen[next] = 1; rows.push([next, c.cmd.help || HELP[next] || ""]); } }
    });
    if (!rows.length) return "Invalid input: " + (partialTok || toks[toks.length - 1] || "");
    rows.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    var w = Math.max.apply(null, rows.map(function (r) { return r[0].length; })) + 2;
    return rows.map(function (r) { return "  " + pad(r[0], w) + r[1]; }).join("\n");
  };

  // Tab completion: returns {line, options}
  Switch.prototype.complete = function (line) {
    var toks = tokens(line), trailing = /\s$/.test(line);
    if (trailing || !toks.length) return { line: line, options: [] };
    var partialTok = toks.pop(), opts = {};
    this.candidates().forEach(function (c) {
      var m = matchPattern(c.cmd.p, toks); if (m.state === "no") return;
      var next = c.cmd.p[toks.length]; if (!next || next[0] === "<") return;
      if (next.indexOf(partialTok.toLowerCase()) === 0) opts[next] = 1;
    });
    var list = Object.keys(opts).sort();
    if (list.length === 1) return { line: toks.concat(list[0]).join(" ") + " ", options: [] };
    if (list.length > 1) {
      var common = list[0], i; for (i = 1; i < list.length; i++) while (list[i].indexOf(common) !== 0) common = common.slice(0, -1);
      return { line: toks.concat(common).join(" "), options: list };
    }
    return { line: line, options: [] };
  };

  // ── interface ranges ────────────────────────────────────────────────────
  Switch.prototype.expandIf = function (spec) {
    var self = this, out = [], bad = null;
    spec.split(",").forEach(function (part) {
      var r = part.split("-");
      if (r.length === 1) { if (self.ifaces[part]) out.push(part); else bad = part; return; }
      var a = portKey(r[0]), b = portKey(r[1]);
      self.portNames().forEach(function (n) { var k = portKey(n); if (k >= Math.min(a, b) && k <= Math.max(a, b)) out.push(n); });
      if (!self.ifaces[r[0]] || !self.ifaces[r[1]]) bad = part;
    });
    return bad ? { error: "Interface " + bad + " does not exist on this switch." } : { ifs: out };
  };
  Switch.prototype.eachIf = function (fn) { var self = this, c = this.ctx(); (c.ifs || []).forEach(function (n) { fn(self.ifaces[n], n); }); };
  function parseVlist(s) {
    if (s === "all") return null;
    var out = []; s.split(",").forEach(function (p) { var r = p.split("-").map(Number); if (r.length === 1) out.push(r[0]); else for (var v = Math.min(r[0], r[1]); v <= Math.max(r[0], r[1]); v++) out.push(v); });
    return out.filter(function (v, i, a) { return v >= 1 && v <= 4094 && a.indexOf(v) === i; });
  }

  // ── exec-anywhere commands ──────────────────────────────────────────────
  cmd("*", "exit", function () { if (this.ctx().ctx === "exec") return "Use the Reset button to start over; there is nothing to log out of here."; this.pop(); });
  cmd("*", "end", function () { this.stack = [this.stack[0]]; });
  cmd("*", "configure terminal", function () { if (this.ctx().ctx !== "exec") return ""; this.push({ ctx: "config" }); });
  cmd("*", "configure", function () { if (this.ctx().ctx !== "exec") return ""; this.push({ ctx: "config" }); });
  cmd("*", "write memory", function () { this.startup = this.runningConfig(); return "Copying configuration: [Success]"; });
  cmd("*", "copy running-config startup-config", function () { this.startup = this.runningConfig(); return "Copying configuration: [Success]"; });
  cmd("*", "copy running-config checkpoint <WORD>", function (a) { this.checkpoints = this.checkpoints.filter(function (c) { return c.name !== a[3]; }); this.checkpoints.push({ name: a[3], config: this.runningConfig(), at: this.now() }); return "Copying configuration: [Success]"; });
  cmd("*", "checkpoint rollback <WORD>", function (a) {
    var cfg = a[2] === "startup-config" ? this.startup : (this.checkpoints.filter(function (c) { return c.name === a[2]; })[0] || {}).config;
    if (!cfg) return "Checkpoint " + a[2] + " does not exist.";
    var lines = cfg.split("\n").filter(function (l) { return l && l[0] !== "!" && !/^Current configuration|^user admin|^https-server/.test(l); }).map(function (l) { return l.trim(); });
    var devs = this.devices; this.reset(); this.devices = devs; this.apply(lines); this.reauthAll();
    this.stack = [{ ctx: "exec" }];
    return "Configuration restored from " + a[2] + ".";
  });
  cmd("*", "clear port-access clients", function () { this.clients = {}; this.reauthAll(); });
  cmd("*", "clear port-access clients interface <IFNAME>", function (a) { var r = this.expandIf(a[4]); if (r.error) return r.error; var self = this; r.ifs.forEach(function (n) { self.devsOn(n).forEach(function (d) { delete self.clients[d.id]; }); }); this.reauthAll(); });
  cmd("*", "ping <A.B.C.D>", function (a) { return this.ping(a[1], 5); });
  cmd("*", "ping <A.B.C.D> repetitions <1-10>", function (a) { return this.ping(a[1], +a[3]); });

  // ── config context ──────────────────────────────────────────────────────
  cmd("config", "hostname <WORD>", function (a) { if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,31}$/.test(a[1])) return "Hostname must be letters, digits, dots and hyphens, up to 32 characters."; this.hostname = a[1]; });
  cmd("config", "no hostname", function () { this.hostname = "switch"; });
  cmd("config", "vlan <1-4094>", function (a) { var v = +a[1]; if (!this.vlans[v]) this.vlans[v] = { name: "VLAN" + v, desc: "" }; this.push({ ctx: "vlan", id: v }); });
  cmd("config", "no vlan <1-4094>", function (a) {
    var v = +a[2], self = this; if (v === 1) return "VLAN 1 cannot be deleted."; if (!this.vlans[v]) return "VLAN " + v + " does not exist.";
    delete this.vlans[v]; delete this.svis[v];
    this.portNames().forEach(function (n) { var i = self.ifaces[n]; if (i.access === v) i.access = 1; if (i.trunk) i.trunk = i.trunk.filter(function (x) { return x !== v; }); });
    Object.keys(this.lags).forEach(function (l) { var i = self.lags[l]; if (i.access === v) i.access = 1; if (i.trunk) i.trunk = i.trunk.filter(function (x) { return x !== v; }); });
    this.reauthAll();
  });
  cmd("config", "interface <IFNAME>", function (a) { var r = this.expandIf(a[1]); if (r.error) return r.error; this.push({ ctx: "if", ifs: r.ifs }); });
  cmd("config", "interface lag <1-256>", function (a) {
    var id = +a[2]; if (!this.lags[id]) this.lags[id] = { name: "lag" + id, shutdown: false, routing: false, mode: "access", access: 1, trunk: null, native: 1, nativeTag: false, lacp: "off", desc: "" };
    this.push({ ctx: "lag", id: id });
  });
  cmd("config", "no interface lag <1-256>", function (a) { var id = +a[3], self = this; if (!this.lags[id]) return "LAG " + id + " does not exist."; delete this.lags[id]; this.portNames().forEach(function (n) { if (self.ifaces[n].lag === id) self.ifaces[n].lag = 0; }); });
  cmd("config", "interface vlan <1-4094>", function (a) { var v = +a[2]; if (!this.vlans[v]) return "VLAN " + v + " does not exist. Create it first with `vlan " + v + "`."; if (!this.svis[v]) this.svis[v] = { vlan: v, ip: null, shutdown: false, desc: "", ospf: null }; this.push({ ctx: "svi", id: v }); });
  cmd("config", "no interface vlan <1-4094>", function (a) { delete this.svis[+a[3]]; });
  cmd("config", "radius-server host <A.B.C.D> key plaintext <WORD>", function (a) { this.addRadius(a[2], a[5], ""); });
  cmd("config", "radius-server host <A.B.C.D> key plaintext <WORD> vrf <WORD>", function (a) { this.addRadius(a[2], a[5], a[7]); });
  cmd("config", "radius-server host <A.B.C.D> vrf <WORD>", function (a) { this.addRadius(a[2], "", a[4]); });
  cmd("config", "radius-server host <A.B.C.D>", function (a) { this.addRadius(a[2], "", ""); });
  cmd("config", "no radius-server host <A.B.C.D>", function (a) { var self = this; this.radius = this.radius.filter(function (r) { return r.host !== a[3]; }); Object.keys(this.groups).forEach(function (g) { self.groups[g].servers = self.groups[g].servers.filter(function (s) { return s !== a[3]; }); }); this.reauthAll(); });
  Switch.prototype.addRadius = function (host, key, vrf) {
    var r = this.radius.filter(function (x) { return x.host === host; })[0];
    if (!r) { r = { host: host, key: "", vrf: "" }; this.radius.push(r); }
    if (key) r.key = key; if (vrf) r.vrf = vrf; this.reauthAll();
  };
  cmd("config", "radius dyn-authorization enable", function () { this.pa.dynAuth = true; });
  cmd("config", "no radius dyn-authorization enable", function () { this.pa.dynAuth = false; });
  cmd("config", "radius dyn-authorization disable", function () { this.pa.dynAuth = false; });
  cmd("config", "aaa group server radius <WORD>", function (a) { if (a[4] === "radius") return "The group name `radius` is reserved for the built-in group of every configured server."; if (!this.groups[a[4]]) this.groups[a[4]] = { servers: [] }; this.push({ ctx: "sg", id: a[4] }); });
  cmd("config", "no aaa group server radius <WORD>", function (a) { delete this.groups[a[5]]; if (this.pa.dot1xGroup === a[5]) this.pa.dot1xGroup = ""; if (this.pa.macAuthGroup === a[5]) this.pa.macAuthGroup = ""; this.reauthAll(); });
  cmd("config", "aaa authentication port-access dot1x authenticator", function () { this.push({ ctx: "dot1x" }); });
  cmd("config", "no aaa authentication port-access dot1x authenticator", function () { this.pa.dot1x = false; this.pa.dot1xGroup = ""; this.reauthAll(); });
  cmd("config", "aaa authentication port-access mac-auth", function () { this.push({ ctx: "macauth" }); });
  cmd("config", "no aaa authentication port-access mac-auth", function () { this.pa.macAuth = false; this.pa.macAuthGroup = ""; this.reauthAll(); });
  cmd("config", "port-access role <WORD>", function (a) { if (!this.pa.roles[a[2]]) this.pa.roles[a[2]] = { vlan: 0, desc: "" }; this.push({ ctx: "role", id: a[2] }); });
  cmd("config", "no port-access role <WORD>", function (a) { delete this.pa.roles[a[3]]; this.reauthAll(); });
  cmd("config", "spanning-tree", function () { this.stp.enable = true; this.recheckL2(); });
  cmd("config", "no spanning-tree", function () { this.stp.enable = false; });
  cmd("config", "spanning-tree mode mstp", function () { this.stp.mode = "mstp"; });
  cmd("config", "spanning-tree mode rpvst", function () { this.stp.mode = "rpvst"; });
  cmd("config", "spanning-tree priority <0-15>", function (a) { this.stp.priority = +a[2]; });
  cmd("config", "no spanning-tree priority", function () { this.stp.priority = 8; });
  cmd("config", "vsf member <2-8>", function (a) { var id = +a[2]; if (!this.vsf.members[id]) this.vsf.members[id] = { type: "", links: {} }; this.push({ ctx: "vsf", id: id }); });
  cmd("config", "no vsf member <2-8>", function (a) { var id = +a[3], self = this; delete this.vsf.members[id]; this.portNames().forEach(function (n) { if (n.split("/")[0] === String(id)) delete self.ifaces[n]; }); });
  cmd("config", "ip route <A.B.C.D/M> <A.B.C.D>", function (a) { var p = a[2].split("/"); var prefix = numIp(netOf(p[0], +p[1])); this.routes = this.routes.filter(function (r) { return !(r.prefix === prefix && r.len === +p[1]); }); this.routes.push({ prefix: prefix, len: +p[1], nh: a[3] }); });
  cmd("config", "no ip route <A.B.C.D/M> <A.B.C.D>", function (a) { var p = a[3].split("/"); var prefix = numIp(netOf(p[0], +p[1])); this.routes = this.routes.filter(function (r) { return !(r.prefix === prefix && r.len === +p[1] && r.nh === a[4]); }); });
  cmd("config", "router ospf <1-63>", function (a) { var id = +a[2]; if (!this.ospf[id]) this.ospf[id] = { routerId: "", areas: {}, passive: [] }; this.push({ ctx: "ospf", id: id }); });
  cmd("config", "no router ospf <1-63>", function (a) { var id = +a[3], self = this; delete this.ospf[id]; Object.keys(this.svis).forEach(function (v) { if (self.svis[v].ospf && self.svis[v].ospf.proc === id) self.svis[v].ospf = null; }); });

  // ── vlan context ────────────────────────────────────────────────────────
  cmd("vlan", "name <WORD>", function (a) { this.vlans[this.ctx().id].name = a[1]; });
  cmd("vlan", "no name", function () { var v = this.ctx().id; this.vlans[v].name = v === 1 ? "DEFAULT_VLAN_1" : "VLAN" + v; });
  cmd("vlan", "description <LINE>", function (a) { this.vlans[this.ctx().id].desc = a[1]; });
  cmd("vlan", "no description", function () { this.vlans[this.ctx().id].desc = ""; });

  // ── physical interface context ──────────────────────────────────────────
  cmd("if", "shutdown", function () { this.eachIf(function (i) { i.shutdown = true; }); this.reauthAll(); });
  cmd("if", "no shutdown", function () { var self = this; this.eachIf(function (i, n) { i.shutdown = false; delete self.errdisabled[n]; }); this.reauthAll(); });
  cmd("if", "description <LINE>", function (a) { this.eachIf(function (i) { i.desc = a[1]; }); });
  cmd("if", "no description", function () { this.eachIf(function (i) { i.desc = ""; }); });
  cmd("if", "routing", function () { var self = this; this.eachIf(function (i) { i.routing = true; i.macAuth = false; i.dot1x = false; }); this.reauthAll(); });
  cmd("if", "no routing", function () { this.eachIf(function (i) { i.routing = false; i.ip = null; i.ospf = null; }); this.reauthAll(); });
  function l2Ctx(ctx) {
    cmd(ctx, "vlan access <1-4094>", function (a) {
      var v = +a[2]; if (!this.vlans[v]) return "VLAN " + v + " does not exist. Create it first with `vlan " + v + "`.";
      var bad = ""; this.eachTarget(function (i) { if (i.routing) bad = "Interface " + i.name + " is a routed port. Use `no routing` first."; else { i.mode = "access"; i.access = v; } }); this.reauthAll(); return bad;
    });
    cmd(ctx, "no vlan access", function () { this.eachTarget(function (i) { i.mode = "access"; i.access = 1; }); this.reauthAll(); });
    cmd(ctx, "vlan trunk allowed <VLIST>", function (a) {
      var list = parseVlist(a[3]), self = this, missing = list ? list.filter(function (v) { return !self.vlans[v]; }) : [];
      if (missing.length) return "VLAN " + missing[0] + " does not exist. Create it first with `vlan " + missing[0] + "`.";
      var bad = ""; this.eachTarget(function (i) { if (i.routing) bad = "Interface " + i.name + " is a routed port. Use `no routing` first."; else { i.mode = "trunk"; i.trunk = list; } }); this.reauthAll(); return bad;
    });
    cmd(ctx, "no vlan trunk allowed", function () { this.eachTarget(function (i) { i.mode = "access"; i.trunk = null; }); });
    cmd(ctx, "vlan trunk native <1-4094>", function (a) { var v = +a[3]; if (!this.vlans[v]) return "VLAN " + v + " does not exist."; this.eachTarget(function (i) { i.mode = "trunk"; i.native = v; i.nativeTag = false; if (!i.trunk) i.trunk = null; }); });
    cmd(ctx, "vlan trunk native <1-4094> tag", function (a) { var v = +a[3]; if (!this.vlans[v]) return "VLAN " + v + " does not exist."; this.eachTarget(function (i) { i.mode = "trunk"; i.native = v; i.nativeTag = true; }); });
    cmd(ctx, "no vlan trunk native", function () { this.eachTarget(function (i) { i.native = 1; i.nativeTag = false; }); });
  }
  Switch.prototype.eachTarget = function (fn) { var c = this.ctx(); if (c.ctx === "lag") fn(this.lags[c.id], "lag" + c.id); else this.eachIf(fn); };
  l2Ctx("if"); l2Ctx("lag");
  cmd("if", "lag <1-256>", function (a) {
    var id = +a[1], self = this; if (!this.lags[id]) return "LAG " + id + " does not exist. Create it first with `interface lag " + id + "`.";
    var bad = ""; this.eachIf(function (i, n) { if (i.macAuth || i.dot1x) bad = "Remove port-access from " + n + " before adding it to a LAG."; else i.lag = id; }); this.recheckL2(); return bad;
  });
  cmd("if", "no lag", function () { this.eachIf(function (i) { i.lag = 0; }); this.recheckL2(); });
  cmd("if", "spanning-tree port-type admin-edge", function () { this.eachIf(function (i) { i.adminEdge = true; }); this.recheckL2(); });
  cmd("if", "no spanning-tree port-type", function () { this.eachIf(function (i) { i.adminEdge = false; }); this.recheckL2(); });
  cmd("if", "spanning-tree bpdu-guard", function () { this.eachIf(function (i) { i.bpduGuard = true; }); this.recheckL2(); });
  cmd("if", "no spanning-tree bpdu-guard", function () { this.eachIf(function (i) { i.bpduGuard = false; }); this.recheckL2(); });
  cmd("if", "loop-protect", function () { this.eachIf(function (i) { i.loopProtect = true; }); this.recheckL2(); });
  cmd("if", "no loop-protect", function () { this.eachIf(function (i) { i.loopProtect = false; }); this.recheckL2(); });
  cmd("if", "ip address <A.B.C.D/M>", function (a) { var bad = ""; this.eachIf(function (i) { if (!i.routing) bad = "Interface " + i.name + " is a switched port. Use `routing` first, or put the address on an SVI."; else i.ip = a[2]; }); return bad; });
  cmd("if", "no ip address", function () { this.eachIf(function (i) { i.ip = null; }); });
  cmd("if", "ip ospf <1-63> area <AREA>", function (a) { return this.setOspf(+a[2], a[4]); });
  cmd("if", "no ip ospf", function () { this.eachIf(function (i) { i.ospf = null; }); });
  Switch.prototype.setOspf = function (proc, area) {
    if (!this.ospf[proc]) return "OSPF process " + proc + " does not exist. Create it first with `router ospf " + proc + "`.";
    var c = this.ctx(), bad = "";
    if (c.ctx === "svi") this.svis[c.id].ospf = { proc: proc, area: normArea(area) };
    else this.eachIf(function (i) { if (!i.routing) bad = "Interface " + i.name + " is a switched port. Use `routing` first."; else i.ospf = { proc: proc, area: normArea(area) }; });
    return bad;
  };
  function normArea(a) { return isIp(a) ? a : numIp(+a); }
  cmd("if", "aaa authentication port-access client-limit <1-256>", function (a) { this.eachIf(function (i) { i.clientLimit = +a[4]; }); this.reauthAll(); });
  cmd("if", "no aaa authentication port-access client-limit", function () { this.eachIf(function (i) { i.clientLimit = 0; }); this.reauthAll(); });
  cmd("if", "aaa authentication port-access auth-precedence dot1x mac-auth", function () { this.eachIf(function (i) { i.precedence = ["dot1x", "mac-auth"]; }); this.reauthAll(); });
  cmd("if", "aaa authentication port-access auth-precedence mac-auth dot1x", function () { this.eachIf(function (i) { i.precedence = ["mac-auth", "dot1x"]; }); this.reauthAll(); });
  cmd("if", "no aaa authentication port-access auth-precedence", function () { this.eachIf(function (i) { i.precedence = null; }); this.reauthAll(); });
  cmd("if", "aaa authentication port-access critical-role <WORD>", function (a) { if (!this.pa.roles[a[4]]) return "Role " + a[4] + " is not defined. Create it with `port-access role " + a[4] + "`."; this.eachIf(function (i) { i.critRole = a[4]; }); this.reauthAll(); });
  cmd("if", "no aaa authentication port-access critical-role", function () { this.eachIf(function (i) { i.critRole = ""; }); this.reauthAll(); });
  cmd("if", "aaa authentication port-access reject-role <WORD>", function (a) { if (!this.pa.roles[a[4]]) return "Role " + a[4] + " is not defined. Create it with `port-access role " + a[4] + "`."; this.eachIf(function (i) { i.rejectRole = a[4]; }); this.reauthAll(); });
  cmd("if", "no aaa authentication port-access reject-role", function () { this.eachIf(function (i) { i.rejectRole = ""; }); this.reauthAll(); });
  cmd("if", "aaa authentication port-access dot1x authenticator", function () { var bad = ""; this.eachIf(function (i) { if (i.routing) bad = "Port-access needs a switched port. Use `no routing` on " + i.name + " first."; if (i.lag) bad = i.name + " is a LAG member; port-access is not supported there."; }); if (bad) return bad; this.push({ ctx: "dot1x-if" }); });
  cmd("if", "no aaa authentication port-access dot1x authenticator", function () { this.eachIf(function (i) { i.dot1x = false; }); this.reauthAll(); });
  cmd("if", "aaa authentication port-access mac-auth", function () { var bad = ""; this.eachIf(function (i) { if (i.routing) bad = "Port-access needs a switched port. Use `no routing` on " + i.name + " first."; if (i.lag) bad = i.name + " is a LAG member; port-access is not supported there."; }); if (bad) return bad; this.push({ ctx: "macauth-if" }); });
  cmd("if", "no aaa authentication port-access mac-auth", function () { this.eachIf(function (i) { i.macAuth = false; }); this.reauthAll(); });
  cmd("dot1x-if", "enable", function () { this.stack.pop(); this.eachIf(function (i) { i.dot1x = true; }); this.stack.push({ ctx: "dot1x-if" }); this.reauthAll(); });
  cmd("dot1x-if", "no enable", function () { this.stack.pop(); this.eachIf(function (i) { i.dot1x = false; }); this.stack.push({ ctx: "dot1x-if" }); this.reauthAll(); });
  cmd("dot1x-if", "disable", function () { this.stack.pop(); this.eachIf(function (i) { i.dot1x = false; }); this.stack.push({ ctx: "dot1x-if" }); this.reauthAll(); });
  cmd("macauth-if", "enable", function () { this.stack.pop(); this.eachIf(function (i) { i.macAuth = true; }); this.stack.push({ ctx: "macauth-if" }); this.reauthAll(); });
  cmd("macauth-if", "no enable", function () { this.stack.pop(); this.eachIf(function (i) { i.macAuth = false; }); this.stack.push({ ctx: "macauth-if" }); this.reauthAll(); });
  cmd("macauth-if", "disable", function () { this.stack.pop(); this.eachIf(function (i) { i.macAuth = false; }); this.stack.push({ ctx: "macauth-if" }); this.reauthAll(); });

  // ── global dot1x / mac-auth ─────────────────────────────────────────────
  cmd("dot1x", "enable", function () { this.pa.dot1x = true; this.reauthAll(); });
  cmd("dot1x", "no enable", function () { this.pa.dot1x = false; this.reauthAll(); });
  cmd("dot1x", "disable", function () { this.pa.dot1x = false; this.reauthAll(); });
  cmd("dot1x", "radius server-group <WORD>", function (a) { if (!this.groups[a[2]] && a[2] !== "radius") return "Server group " + a[2] + " does not exist."; this.pa.dot1xGroup = a[2]; this.reauthAll(); });
  cmd("dot1x", "no radius server-group", function () { this.pa.dot1xGroup = ""; this.reauthAll(); });
  cmd("macauth", "enable", function () { this.pa.macAuth = true; this.reauthAll(); });
  cmd("macauth", "no enable", function () { this.pa.macAuth = false; this.reauthAll(); });
  cmd("macauth", "disable", function () { this.pa.macAuth = false; this.reauthAll(); });
  cmd("macauth", "radius server-group <WORD>", function (a) { if (!this.groups[a[2]] && a[2] !== "radius") return "Server group " + a[2] + " does not exist."; this.pa.macAuthGroup = a[2]; this.reauthAll(); });
  cmd("macauth", "no radius server-group", function () { this.pa.macAuthGroup = ""; this.reauthAll(); });

  // ── lag context ─────────────────────────────────────────────────────────
  cmd("lag", "shutdown", function () { this.lags[this.ctx().id].shutdown = true; this.recheckL2(); });
  cmd("lag", "no shutdown", function () { this.lags[this.ctx().id].shutdown = false; this.recheckL2(); });
  cmd("lag", "description <LINE>", function (a) { this.lags[this.ctx().id].desc = a[1]; });
  cmd("lag", "no routing", function () { this.lags[this.ctx().id].routing = false; });
  cmd("lag", "lacp mode active", function () { this.lags[this.ctx().id].lacp = "active"; this.recheckL2(); });
  cmd("lag", "lacp mode passive", function () { this.lags[this.ctx().id].lacp = "passive"; this.recheckL2(); });
  cmd("lag", "no lacp mode", function () { this.lags[this.ctx().id].lacp = "off"; this.recheckL2(); });

  // ── svi context ─────────────────────────────────────────────────────────
  cmd("svi", "ip address <A.B.C.D/M>", function (a) { this.svis[this.ctx().id].ip = a[2]; });
  cmd("svi", "no ip address", function () { this.svis[this.ctx().id].ip = null; });
  cmd("svi", "shutdown", function () { this.svis[this.ctx().id].shutdown = true; });
  cmd("svi", "no shutdown", function () { this.svis[this.ctx().id].shutdown = false; });
  cmd("svi", "description <LINE>", function (a) { this.svis[this.ctx().id].desc = a[1]; });
  cmd("svi", "ip ospf <1-63> area <AREA>", function (a) { return this.setOspf(+a[2], a[4]); });
  cmd("svi", "no ip ospf", function () { this.svis[this.ctx().id].ospf = null; });

  // ── server group, role, vsf, ospf ───────────────────────────────────────
  cmd("sg", "server <A.B.C.D>", function (a) { var g = this.groups[this.ctx().id]; if (!this.radius.some(function (r) { return r.host === a[1]; })) return "RADIUS server " + a[1] + " is not configured. Add it with `radius-server host " + a[1] + " key plaintext <key>` first."; if (g.servers.indexOf(a[1]) < 0) g.servers.push(a[1]); this.reauthAll(); });
  cmd("sg", "no server <A.B.C.D>", function (a) { var g = this.groups[this.ctx().id]; g.servers = g.servers.filter(function (s) { return s !== a[2]; }); this.reauthAll(); });
  cmd("role", "vlan access <1-4094>", function (a) { var v = +a[2]; if (!this.vlans[v]) return "VLAN " + v + " does not exist. Create it first with `vlan " + v + "`."; this.pa.roles[this.ctx().id].vlan = v; this.reauthAll(); });
  cmd("role", "no vlan access", function () { this.pa.roles[this.ctx().id].vlan = 0; this.reauthAll(); });
  cmd("role", "description <LINE>", function (a) { this.pa.roles[this.ctx().id].desc = a[1]; });
  cmd("vsf", "type <WORD>", function (a) {
    var m = this.vsf.members[this.ctx().id], id = this.ctx().id, self = this, pn = a[1].toUpperCase();
    var mid = Object.keys(MODELS).filter(function (k) { return MODELS[k].pn === pn; })[0];
    if (!mid) return "Unknown member type " + a[1] + ". This sandbox knows " + Object.keys(MODELS).map(function (k) { return MODELS[k].pn; }).join(", ") + ".";
    m.type = pn; m.model = mid;
    portsFor(mid, id).forEach(function (p) { if (!self.ifaces[p.name]) self.ifaces[p.name] = self.newIface(p); });
  });
  cmd("vsf", "link <1-2> <IFNAME>", function (a) { var m = this.vsf.members[this.ctx().id]; var r = this.expandIf(a[2]); if (r.error) return r.error; m.links[a[1]] = r.ifs; });
  cmd("vsf", "no link <1-2>", function (a) { delete this.vsf.members[this.ctx().id].links[a[2]]; });
  cmd("ospf", "router-id <A.B.C.D>", function (a) { this.ospf[this.ctx().id].routerId = a[1]; });
  cmd("ospf", "no router-id", function () { this.ospf[this.ctx().id].routerId = ""; });
  cmd("ospf", "area <AREA>", function (a) { this.ospf[this.ctx().id].areas[normArea(a[1])] = 1; });
  cmd("ospf", "no area <AREA>", function (a) { delete this.ospf[this.ctx().id].areas[normArea(a[2])]; });
  cmd("ospf", "passive-interface <WORD>", function (a) { var p = this.ospf[this.ctx().id]; if (p.passive.indexOf(a[1]) < 0) p.passive.push(a[1]); });
  cmd("ospf", "no passive-interface <WORD>", function (a) { var p = this.ospf[this.ctx().id]; p.passive = p.passive.filter(function (x) { return x !== a[2]; }); });

  // ── the fake ClearPass and the endpoints ────────────────────────────────
  // A lesson's radius block says which server addresses exist and what the shared secret
  // is. A device's auth block says what that server would answer for it.
  Switch.prototype.groupServers = function (name) {
    var self = this;
    if (!name || name === "radius") return this.radius.slice();
    var g = this.groups[name]; if (!g) return [];
    return g.servers.map(function (h) { return self.radius.filter(function (r) { return r.host === h; })[0]; }).filter(Boolean);
  };
  Switch.prototype.radiusReach = function (servers) {
    var lesson = this.lesson.radius || { servers: [], key: "" }, tried = [];
    for (var i = 0; i < servers.length; i++) {
      var s = servers[i], known = (lesson.servers || []).indexOf(s.host) >= 0;
      if (!known) { tried.push({ host: s.host, result: "timeout", why: "no server answers at " + s.host }); continue; }
      if (!s.key) { tried.push({ host: s.host, result: "timeout", why: "no shared secret configured, the request is silently dropped" }); continue; }
      if (s.key !== lesson.key) { tried.push({ host: s.host, result: "timeout", why: "shared secret mismatch, the server drops the request without a reply" }); continue; }
      tried.push({ host: s.host, result: "ok" }); return { server: s, tried: tried };
    }
    return { server: null, tried: tried };
  };

  Switch.prototype.authenticate = function (dev, method) {
    var iface = this.ifaces[dev.port], group = method === "dot1x" ? this.pa.dot1xGroup : this.pa.macAuthGroup;
    var servers = this.groupServers(group);
    var rec = { dev: dev.id, port: dev.port, mac: macCx(dev.mac), method: method, status: "Failed", role: "", vlan: iface.access, reason: "", server: "", user: method === "dot1x" ? (dev.user || "") : macCx(dev.mac), at: this.now(), tried: [] };
    if (!servers.length) { rec.reason = "No RADIUS server in group " + (group || "radius"); return this.applyFallback(rec, iface, "critical"); }
    var r = this.radiusReach(servers); rec.tried = r.tried;
    if (!r.server) { rec.reason = "RADIUS request timed out on every server"; return this.applyFallback(rec, iface, "critical"); }
    rec.server = r.server.host;
    var answer = (dev.auth || {})[method];
    if (!answer) { rec.reason = method === "dot1x" ? "Client does not speak 802.1X" : "Access-Reject (unknown MAC)"; return this.applyFallback(rec, iface, "reject"); }
    if (!answer.accept) { rec.reason = "Access-Reject" + (answer.why ? " (" + answer.why + ")" : ""); return this.applyFallback(rec, iface, "reject"); }
    if (answer.role) {
      var role = this.pa.roles[answer.role];
      if (!role) { rec.reason = "Role " + answer.role + " returned by RADIUS is not defined on the switch"; return this.applyFallback(rec, iface, "reject"); }
      rec.role = answer.role; rec.vlan = role.vlan || iface.access;
    } else if (answer.vlan) {
      if (!this.vlans[answer.vlan]) { rec.reason = "VLAN " + answer.vlan + " returned by RADIUS does not exist on the switch"; return this.applyFallback(rec, iface, "reject"); }
      rec.vlan = answer.vlan;
    }
    rec.status = "Success"; rec.reason = "Access-Accept"; return rec;
  };
  Switch.prototype.applyFallback = function (rec, iface, kind) {
    var roleName = kind === "critical" ? iface.critRole : iface.rejectRole;
    if (roleName && this.pa.roles[roleName]) { rec.status = "Success"; rec.role = roleName; rec.vlan = this.pa.roles[roleName].vlan || iface.access; rec.reason += "; " + (kind === "critical" ? "critical" : "reject") + " role applied"; rec.fallback = kind; }
    return rec;
  };

  Switch.prototype.nacOn = function (iface) {
    var dot1x = iface.dot1x && this.pa.dot1x, mac = iface.macAuth && this.pa.macAuth;
    return { dot1x: dot1x, mac: mac, any: dot1x || mac, ifOnly: (iface.dot1x || iface.macAuth) && !(dot1x || mac) };
  };

  // re-run every connected endpoint through the current config
  Switch.prototype.reauthAll = function () {
    var self = this, perPort = {};
    (this.lesson.devices || []).forEach(function (d) {
      var st = self.devices[d.id]; if (!st || !st.connected) { delete self.clients[d.id]; return; }
      if (d.kind === "switch" || d.kind === "router" || d.kind === "loop") { delete self.clients[d.id]; return; }
      var iface = self.ifaces[d.port]; if (!iface || !self.linkUp(d.port)) { delete self.clients[d.id]; return; }
      var nac = self.nacOn(iface);
      if (!nac.any) { self.clients[d.id] = { dev: d.id, port: d.port, mac: macCx(d.mac), method: "none", status: "Open", role: "", vlan: iface.mode === "access" ? iface.access : iface.native, reason: iface.routing ? "Routed port, no VLAN" : "No port-access on this port, the client is just on VLAN " + iface.access, at: self.now(), user: "" }; return; }
      perPort[d.port] = (perPort[d.port] || 0) + 1;
      if (perPort[d.port] > (iface.clientLimit || 1)) { self.clients[d.id] = { dev: d.id, port: d.port, mac: macCx(d.mac), method: "none", status: "Failed", role: "", vlan: 0, reason: "Client limit " + (iface.clientLimit || 1) + " reached on " + d.port, at: self.now(), user: "" }; return; }
      var order = iface.precedence || ["dot1x", "mac-auth"];
      var canDot1x = nac.dot1x && !!(d.auth && d.auth.dot1x), canMac = nac.mac;
      var methods = order.filter(function (m) { return m === "dot1x" ? canDot1x : canMac; });
      if (!methods.length) { self.clients[d.id] = { dev: d.id, port: d.port, mac: macCx(d.mac), method: nac.dot1x ? "dot1x" : "mac-auth", status: "Failed", role: "", vlan: 0, reason: nac.dot1x && !nac.mac ? "Client never answered the EAP identity request (no supplicant) and mac-auth is off" : "No usable method", at: self.now(), user: "" }; return; }
      var rec = null;
      for (var i = 0; i < methods.length; i++) { rec = self.authenticate(d, methods[i]); if (rec.status === "Success") break; }
      self.clients[d.id] = rec;
    });
  };

  Switch.prototype.connect = function (id) {
    var self = this, d = this.dev(id); if (!d) return "No device called " + id + " in this lab.";
    var ports = d.ports || [d.port], missing = ports.filter(function (p) { return !self.ifaces[p]; });
    if (missing.length) return d.name + " is cabled to " + missing[0] + ", which does not exist on this switch.";
    this.devices[id].connected = true; this.tick++;
    this.recheckL2(); this.reauthAll();
    var where = ports.join(" and ");
    if (ports.every(function (p) { return self.ifaces[p].shutdown; })) return d.name + " plugged into " + where + ". The port is shut down, so nothing happens.";
    if (ports.every(function (p) { return self.errdisabled[p]; })) return d.name + " plugged into " + where + ". The port is error-disabled (" + this.errdisabled[ports[0]] + ").";
    var c = this.clients[id];
    var line = d.name + " plugged into " + where + ": link up.";
    if (c) line += " " + (c.status === "Open" ? "No authentication on this port." : c.method + " " + c.status.toLowerCase() + (c.role ? ", role " + c.role : "") + (c.status === "Success" ? ", VLAN " + c.vlan : "") + (c.status !== "Success" ? ": " + c.reason : "") + ".");
    else if (d.kind === "switch" && d.lacp) { var lagId = this.ifaces[ports[0]].lag; line += lagId ? (this.lagUp(lagId).up ? " LACP agreed, lag" + lagId + " is up." : " lag" + lagId + " is configured but not up; see show lacp interfaces.") : " The partner is sending LACP but these ports are not in a LAG."; }
    else if (d.kind === "router") line += " The router is talking; give the switch an address on that segment to reach it.";
    return line;
  };
  Switch.prototype.disconnect = function (id) {
    var d = this.dev(id); if (!d) return "No device called " + id + " in this lab.";
    this.devices[id].connected = false; delete this.clients[id]; this.tick++;
    this.recheckL2(); this.reauthAll();
    return d.name + " unplugged from " + (d.ports || [d.port]).join(" and ") + ".";
  };
  Switch.prototype.coa = function (id, role) {
    var d = this.dev(id), c = this.clients[id]; if (!d) return "No device called " + id + " in this lab.";
    if (!c || c.status !== "Success" || c.method === "none") return "ClearPass has no session for " + d.name + " to change.";
    if (!this.pa.dynAuth) return "CoA-NAK: the switch is not listening for dynamic authorization (radius dyn-authorization enable is off).";
    if (!this.pa.roles[role]) return "CoA-NAK: role " + role + " is not defined on the switch.";
    c.role = role; c.vlan = this.pa.roles[role].vlan || this.ifaces[c.port].access; c.reason = "CoA applied"; c.at = this.now();
    return "CoA-ACK: " + d.name + " moved to role " + role + ", VLAN " + c.vlan + ".";
  };

  // ── L2 neighbours: LAG partner, BPDUs, loops ────────────────────────────
  Switch.prototype.recheckL2 = function () {
    var self = this;
    (this.lesson.devices || []).forEach(function (d) {
      var st = self.devices[d.id]; if (!st || !st.connected) return;
      var ports = d.ports || [d.port];
      ports.forEach(function (p) {
        var i = self.ifaces[p]; if (!i || i.shutdown || self.errdisabled[p]) return;
        if (d.kind === "loop") {
          if (i.loopProtect) self.errdisabled[p] = "loop-protect: the port heard its own probe";
          else if (self.stp.enable && !i.adminEdge) { /* STP blocks it, no err-disable */ }
          return;
        }
        if ((d.kind === "switch" || d.kind === "router") && d.bpdu !== false && self.stp.enable && i.bpduGuard) self.errdisabled[p] = "BPDU guard: a BPDU arrived on an edge port";
      });
    });
    this.reauthAll();
  };
  Switch.prototype.stpState = function (p) {
    var i = this.ifaces[p], self = this;
    if (!this.stp.enable) return { role: "-", state: this.linkUp(p) ? "Forwarding" : "Down" };
    if (!this.linkUp(p)) return { role: "Disabled", state: "Down" };
    var d = this.devsOn(p)[0];
    if (d && d.kind === "loop") return i.adminEdge ? { role: "Designated", state: "Forwarding" } : { role: "Alternate", state: "Blocking" };
    if (d && d.kind === "switch" && d.stpRoot) return { role: "Root", state: "Forwarding" };
    return { role: "Designated", state: "Forwarding" };
  };

  // ── L3: SVIs, routes, OSPF, ping ────────────────────────────────────────
  Switch.prototype.ifaceForIp = function (ip) {
    var self = this, hit = null;
    Object.keys(this.svis).forEach(function (v) { var s = self.svis[v]; if (s.ip && !s.shutdown && self.sviUp(+v)) { var p = s.ip.split("/"); if (inNet(ip, p[0], +p[1])) hit = { kind: "vlan", id: +v, ip: p[0], len: +p[1] }; } });
    this.portNames().forEach(function (n) { var i = self.ifaces[n]; if (i.routing && i.ip && self.linkUp(n)) { var p = i.ip.split("/"); if (inNet(ip, p[0], +p[1])) hit = { kind: "port", id: n, ip: p[0], len: +p[1] }; } });
    return hit;
  };
  Switch.prototype.sviUp = function (v) {
    var self = this, up = false;
    this.portNames().forEach(function (n) { var i = self.ifaces[n]; if (i.routing || !self.linkUp(n)) return; if (i.mode === "access" ? i.access === v : (!i.trunk || i.trunk.indexOf(v) >= 0 || i.native === v)) up = true; });
    return up && !!this.vlans[v];
  };
  // every routed device in the lesson, with how it is reached
  Switch.prototype.routerNeighbors = function () {
    var self = this, out = [];
    (this.lesson.devices || []).forEach(function (d) {
      if (d.kind !== "router" || !d.ip) return;
      var st = self.devices[d.id]; if (!st || !st.connected) return;
      var i = self.ifaces[d.port]; if (!i || !self.linkUp(d.port)) return;
      var local;
      if (i.routing) { if (i.ip) { var p = i.ip.split("/"); if (inNet(d.ip, p[0], +p[1])) local = { kind: "port", id: d.port, ip: p[0], len: +p[1], ospf: i.ospf }; } }
      else { var v = i.mode === "access" ? i.access : i.native; if (d.vlan && d.vlan !== v) v = (i.mode === "trunk" && (!i.trunk || i.trunk.indexOf(d.vlan) >= 0)) ? d.vlan : -1; var s = self.svis[v]; if (s && s.ip && !s.shutdown) { var q = s.ip.split("/"); if (inNet(d.ip, q[0], +q[1])) local = { kind: "vlan", id: v, ip: q[0], len: +q[1], ospf: s.ospf }; } }
      if (local) out.push({ dev: d, local: local });
    });
    return out;
  };
  Switch.prototype.ospfNeighbors = function () {
    var self = this, out = [];
    this.routerNeighbors().forEach(function (n) {
      var d = n.dev, l = n.local; if (!d.ospf || !l.ospf) return;
      var proc = self.ospf[l.ospf.proc]; if (!proc) return;
      var ifname = l.kind === "vlan" ? "vlan" + l.id : l.id;
      var passive = proc.passive.indexOf(ifname) >= 0;
      var state = "FULL", why = "";
      if (passive) { state = "-"; why = "passive"; }
      else if (normArea(d.ospf.area) !== l.ospf.area) { state = "-"; why = "area mismatch (" + normArea(d.ospf.area) + " vs " + l.ospf.area + ")"; }
      else if (d.ospf.hello && d.ospf.hello !== 10) { state = "-"; why = "hello timer mismatch"; }
      out.push({ dev: d, local: l, ifname: ifname, state: state, why: why, rid: d.ospf.routerId || d.ip, area: l.ospf.area, proc: l.ospf.proc });
    });
    return out;
  };
  Switch.prototype.routeTable = function () {
    var self = this, rows = [];
    Object.keys(this.svis).forEach(function (v) { var s = self.svis[v]; if (s.ip && !s.shutdown && self.sviUp(+v)) { var p = s.ip.split("/"); rows.push({ prefix: numIp(netOf(p[0], +p[1])), len: +p[1], via: "vlan" + v, type: "C", dist: 0, metric: 0 }); } });
    this.portNames().forEach(function (n) { var i = self.ifaces[n]; if (i.routing && i.ip && self.linkUp(n)) { var p = i.ip.split("/"); rows.push({ prefix: numIp(netOf(p[0], +p[1])), len: +p[1], via: n, type: "C", dist: 0, metric: 0 }); } });
    this.routes.forEach(function (r) { var l = self.ifaceForIp(r.nh); if (l) rows.push({ prefix: r.prefix, len: r.len, via: r.nh, type: "S", dist: 1, metric: 0, ifn: l.kind === "vlan" ? "vlan" + l.id : l.id }); });
    this.ospfNeighbors().forEach(function (n) {
      if (n.state !== "FULL") return;
      (n.dev.ospf.routes || []).forEach(function (r) { var p = r.split("/"); if (rows.some(function (x) { return x.prefix === p[0] && x.len === +p[1]; })) return; rows.push({ prefix: p[0], len: +p[1], via: n.dev.ip, type: "O", dist: 110, metric: 20, ifn: n.ifname }); });
    });
    rows.sort(function (a, b) { return ipNum(a.prefix) - ipNum(b.prefix) || a.len - b.len; });
    return rows;
  };
  Switch.prototype.lookup = function (ip) {
    var best = null; this.routeTable().forEach(function (r) { if (inNet(ip, r.prefix, r.len) && (!best || r.len > best.len)) best = r; }); return best;
  };
  Switch.prototype.reachable = function (ip) {
    // our own address?
    var self = this, own = false;
    Object.keys(this.svis).forEach(function (v) { var s = self.svis[v]; if (s.ip && s.ip.split("/")[0] === ip && !s.shutdown && self.sviUp(+v)) own = true; });
    if (own) return { ok: true, how: "local" };
    var r = this.lookup(ip); if (!r) return { ok: false, why: "No route to host" };
    var hosts = (this.lesson.hosts || []).concat((this.lesson.devices || []).filter(function (d) { return d.ip && self.devices[d.id] && self.devices[d.id].connected; }).map(function (d) { return { ip: d.ip, via: d.kind === "router" ? "direct" : "direct", port: d.port, vlan: d.vlan }; }));
    var h = hosts.filter(function (x) { return x.ip === ip; })[0];
    if (!h) return { ok: false, why: r.type === "C" ? "Destination unreachable (nobody answers on the segment)" : "Request timed out" };
    if (r.type === "C") {
      // directly connected: the host must actually be on that segment and its port must be up
      if (h.port) { if (!self.linkUp(h.port)) return { ok: false, why: "Destination host unreachable (its port is down)" }; }
      return { ok: true, how: "direct" };
    }
    // via a router: that router must be a live neighbour
    var nbr = this.routerNeighbors().filter(function (n) { return n.dev.ip === r.via || (r.type === "O"); })[0];
    if (!nbr) return { ok: false, why: "Request timed out (next hop " + r.via + " does not answer)" };
    if (h.behind && h.behind !== nbr.dev.id) return { ok: false, why: "Request timed out" };
    return { ok: true, how: "via " + r.via };
  };
  Switch.prototype.ping = function (ip, n) {
    var r = this.reachable(ip), out = ["PING " + ip + " (" + ip + ") 100(128) bytes of data."], i;
    if (r.ok) { for (i = 0; i < n; i++) out.push("108 bytes from " + ip + ": icmp_seq=" + (i + 1) + " ttl=64 time=" + (r.how === "local" ? "0.04" : (0.3 + (i % 3) * 0.1).toFixed(2)) + " ms"); out.push("", "--- " + ip + " ping statistics ---", n + " packets transmitted, " + n + " received, 0% packet loss, time " + (n * 1000 - 990) + "ms"); }
    else { for (i = 0; i < n; i++) out.push(/unreachable/i.test(r.why) ? "From " + ip + " icmp_seq=" + (i + 1) + " " + r.why : ""); out = out.filter(Boolean); out.push("", "--- " + ip + " ping statistics ---", n + " packets transmitted, 0 received, 100% packet loss, time " + (n * 1000) + "ms", "(" + r.why + ")"); }
    return out.join("\n");
  };

  // ── show commands ───────────────────────────────────────────────────────
  function table(head, rows, widths) {
    var w = widths || head.map(function (h, i) { return Math.max(h.length, Math.max.apply(null, rows.map(function (r) { return String(r[i]).length; }).concat([0]))); });
    var line = function (r) { return r.map(function (c, i) { return pad(c, w[i]); }).join("  ").replace(/\s+$/, ""); };
    return [line(head), w.map(function (n) { return pad("", n).replace(/ /g, "-"); }).join("  ")].concat(rows.map(line)).join("\n");
  }
  cmd("*", "show running-config", function () { return this.runningConfig(); });
  cmd("*", "show running-config interface <PORT>", function (a) { var s = this.configSection("interface " + a[3]); return s ? s.join("\n") : "Interface " + a[3] + " does not exist on this switch."; });
  cmd("*", "show running-config interface lag <1-256>", function (a) { var s = this.configSection("interface lag " + a[4]); return s ? s.join("\n") : "LAG " + a[4] + " does not exist."; });
  cmd("*", "show running-config interface vlan <1-4094>", function (a) { var s = this.configSection("interface vlan " + a[4]); return s ? s.join("\n") : "Interface vlan " + a[4] + " does not exist."; });
  cmd("*", "show running-config vlan", function () { return this.runningConfig().split("\n").filter(function (l, i, arr) { return /^vlan \d+/.test(l) || (/^    /.test(l) && /^vlan /.test(lastHeader(arr, i))); }).join("\n"); });
  function lastHeader(arr, i) { while (i >= 0 && /^    /.test(arr[i])) i--; return arr[i] || ""; }
  cmd("*", "show startup-config", function () { return this.startup; });
  cmd("*", "show version", function () {
    return ["-----------------------------------------------------------------------------", "CX Sandbox (a model of an AOS-CX switch, not HPE software)", "-----------------------------------------------------------------------------",
      "Version      : " + this.version + " (modelled)", "Build ID     : cx-sandbox:" + this.version, "Active Image : primary", "",
      "This is the Network Field Notes CX Sandbox. It imitates the shape of the CX CLI for", "teaching; the software, the wording and the bugs are its own. Not affiliated with or", "endorsed by Hewlett Packard Enterprise."].join("\n");
  });
  cmd("*", "show system", function () {
    var up = Math.floor((this.now() - this.boot) / 1000);
    return ["Hostname            : " + this.hostname, "System Description  : " + this.version, "System Contact      : ", "System Location     : ", "Vendor              : Aruba", "Product Name        : " + this.model.pn + " " + this.model.name,
      "Chassis Serial Nbr  : SG00000000", "Base MAC Address    : 00005e-005300", "ArubaOS-CX Version  : " + this.version, "Time Zone           : UTC", "", "Up Time             : " + uptime(up), "CPU Util (%)        : 3", "Memory Usage (%)    : 31"].join("\n");
  });
  cmd("*", "show vlan", function () { return this.showVlan(null); });
  cmd("*", "show vlan <1-4094>", function (a) { if (!this.vlans[+a[2]]) return "VLAN " + a[2] + " does not exist."; return this.showVlan(+a[2]); });
  Switch.prototype.vlanPorts = function (v) {
    var self = this, out = [];
    this.portNames().forEach(function (n) { var i = self.ifaces[n]; if (i.routing || i.lag) return; if (i.mode === "access" ? i.access === v : (i.native === v || !i.trunk || i.trunk.indexOf(v) >= 0)) out.push(n); });
    Object.keys(this.lags).forEach(function (l) { var i = self.lags[l]; if (i.mode === "access" ? i.access === v : (i.native === v || !i.trunk || i.trunk.indexOf(v) >= 0)) out.push("lag" + l); });
    return out;
  };
  Switch.prototype.showVlan = function (only) {
    var self = this, rows = [];
    Object.keys(this.vlans).map(Number).sort(function (a, b) { return a - b; }).forEach(function (v) {
      if (only && v !== only) return;
      var ports = self.vlanPorts(v), up = ports.some(function (p) { return /^lag/.test(p) ? self.lagUp(p.slice(3)).up : self.linkUp(p); });
      rows.push([v, self.vlans[v].name, up ? "up" : "down", up ? "ok" : "no_member_port_up", "static", ports.join(",") || ""]);
    });
    return table(["VLAN", "Name", "Status", "Reason", "Type", "Interfaces"], rows);
  };
  cmd("*", "show interface brief", function () {
    var self = this, rows = [];
    this.portNames().forEach(function (n) {
      var i = self.ifaces[n], up = self.linkUp(n), lnk = self.errdisabled[n] ? "down" : (up ? "up" : "down");
      var reason = self.errdisabled[n] ? "Error-disabled" : (i.shutdown ? "Administratively down" : (up ? "" : "Waiting for link"));
      rows.push([n, i.routing ? "" : (i.mode === "trunk" ? "trunk" : String(i.access)), i.routing ? "routed" : "access", i.type, i.lag ? "lag" + i.lag : (i.desc || ""), lnk, reason, up ? (i.copper ? "1000" : "10000") : "--"]);
    });
    return table(["Port", "Native VLAN", "Mode", "Type", "Description", "Status", "Reason", "Speed"], rows);
  });
  cmd("*", "show interface <PORT>", function (a) {
    var i = this.ifaces[a[2]]; if (!i) return "Interface " + a[2] + " does not exist on this switch.";
    var up = this.linkUp(a[2]), st = this.stpState(a[2]), o = [];
    o.push("Interface " + a[2] + " is " + (this.errdisabled[a[2]] ? "down (error-disabled: " + this.errdisabled[a[2]] + ")" : (up ? "up" : "down")));
    o.push(" Admin state is " + (i.shutdown ? "down" : "up"), " Link state: " + (up ? "up" : "down") + (up ? "" : (this.errdisabled[a[2]] ? "" : " (waiting for link)")), " Description: " + (i.desc || ""), " Hardware: Ethernet, MAC Address: 00:00:5e:00:53:" + pad((portKey(a[2]) % 256).toString(16), 2, true).replace(/ /g, "0"));
    o.push(" MTU " + i.mtu, " Type " + i.type, " Full-duplex", " Speed " + (up ? (i.copper ? "1000" : "10000") : "0") + " Mb/s", " Auto-negotiation is on", " Flow-control: off", " Error-control: off");
    if (i.lag) o.push(" Member of lag" + i.lag);
    if (!i.routing) o.push(" VLAN Mode: " + i.mode + (i.mode === "access" ? ", VLAN " + i.access : ", native " + i.native + ", allowed " + (i.trunk ? i.trunk.join(",") : "all")));
    if (i.routing && i.ip) o.push(" IPv4 address " + i.ip);
    if (this.stp.enable) o.push(" Spanning tree: " + st.role + " / " + st.state + (i.adminEdge ? " (admin-edge)" : "") + (i.bpduGuard ? " bpdu-guard" : ""));
    var nac = this.nacOn(i); if (i.dot1x || i.macAuth) o.push(" Port-access: " + (i.dot1x ? "dot1x " : "") + (i.macAuth ? "mac-auth " : "") + (nac.ifOnly ? "(configured here but not enabled globally)" : "(active)"));
    var devs = this.devsOn(a[2]); if (devs.length && up) o.push(" Connected (sandbox): " + devs.map(function (d) { return d.name; }).join(", "));
    o.push(" Rate collection interval: 300 seconds", " Rx", "          " + pad(up ? 1842 + this.tick * 7 : 0, 12, true) + " input packets", " Tx", "          " + pad(up ? 2210 + this.tick * 9 : 0, 12, true) + " output packets");
    return o.join("\n");
  });
  Switch.prototype.macRows = function () {
    var self = this, rows = [];
    (this.lesson.devices || []).forEach(function (d) {
      var st = self.devices[d.id]; if (!st || !st.connected || !d.mac) return;
      var ports = d.ports || [d.port];
      ports.forEach(function (p) {
        var i = self.ifaces[p]; if (!i || !self.linkUp(p) || i.routing) return;
        var vlan, via = i.lag ? "lag" + i.lag : p;
        if (i.lag) { var lu = self.lagUp(i.lag); if (!lu.up || lu.active.indexOf(p) < 0) return; if (rows.some(function (r) { return r[0] === macCx(d.mac) && r[2] === via; })) return; }
        var c = self.clients[d.id];
        if (c) { if (c.status === "Failed") return; vlan = c.vlan; }
        else vlan = i.mode === "access" ? i.access : (d.vlan || i.native);
        rows.push([macCx(d.mac), vlan, via, "dynamic"]);
      });
    });
    return rows;
  };
  cmd("*", "show mac-address-table", function () { var rows = this.macRows(); return "MAC age-time            : 300 seconds\nNumber of MAC addresses : " + rows.length + "\n\n" + table(["MAC Address", "VLAN", "Port", "Type"], rows); });
  cmd("*", "show mac-address-table vlan <1-4094>", function (a) { var rows = this.macRows().filter(function (r) { return r[1] === +a[3]; }); return "Number of MAC addresses : " + rows.length + "\n\n" + table(["MAC Address", "VLAN", "Port", "Type"], rows); });
  cmd("*", "show mac-address-table interface <PORT>", function (a) { var rows = this.macRows().filter(function (r) { return r[2] === a[3]; }); return "Number of MAC addresses : " + rows.length + "\n\n" + table(["MAC Address", "VLAN", "Port", "Type"], rows); });
  cmd("*", "show lldp neighbor-info", function () { return this.showLldp(null); });
  cmd("*", "show lldp neighbor-info <PORT>", function (a) { return this.showLldp(a[3]); });
  Switch.prototype.showLldp = function (only) {
    var self = this, rows = [];
    (this.lesson.devices || []).forEach(function (d) {
      var st = self.devices[d.id]; if (!st || !st.connected || !d.lldp) return;
      (d.ports || [d.port]).forEach(function (p, k) {
        if (only && p !== only) return; if (!self.linkUp(p)) return;
        var rp = Array.isArray(d.lldp.port) ? d.lldp.port[k] : d.lldp.port;
        rows.push([p, d.lldp.chassis || macCx(d.mac), rp || "", d.lldp.sys || d.name, (d.lldp.caps || "")]);
      });
    });
    if (only && !rows.length) return "No LLDP neighbour on " + only + ".";
    return "LLDP Neighbor Information\n=========================\n\nTotal Neighbor Entries          : " + rows.length + "\n\n" + table(["LOCAL-PORT", "CHASSIS-ID", "PORT-ID", "SYS-NAME", "CAPABILITIES"], rows);
  };
  cmd("*", "show lacp aggregates", function () {
    var self = this, o = [];
    Object.keys(this.lags).forEach(function (id) {
      var l = self.lags[id], lu = self.lagUp(id), mem = self.lagMembers(id);
      o.push("Aggregate name       : lag" + id, "Interfaces           : " + mem.join(" "), "Heartbeat rate       : Slow", "Aggregated interfaces: " + lu.active.join(" "), "Mode                 : " + l.lacp, "Hash                 : l3-src-dst", "Aggregate mode       : " + (lu.up ? "up" : "down"), "");
    });
    return o.length ? o.join("\n") : "No LAGs configured.";
  });
  cmd("*", "show lacp interfaces", function () {
    var self = this, rows = [];
    Object.keys(this.lags).forEach(function (id) {
      var l = self.lags[id], lu = self.lagUp(id);
      self.lagMembers(id).forEach(function (p) {
        var active = lu.active.indexOf(p) >= 0, d = self.devsOn(p)[0];
        var partnerOk = d && d.kind === "switch" && d.lacp && (d.lacp.lag === "any" || (d.lacp.ports || []).indexOf(p) >= 0);
        rows.push([p, "lag" + id, l.lacp === "off" ? "static" : (active ? "ALFNCD" : (self.linkUp(p) ? (partnerOk ? "ALFOEX" : "ALFOEX") : "ALFOEX")), l.lacp === "off" ? "" : (active ? (d.lacp.sysid || "00:00:5e:00:53:ff") : (self.linkUp(p) && !partnerOk ? "no LACP partner" : "")), active ? "Up" : "Down"]);
      });
    });
    return "State abbreviations :\nA - Active        P - Passive      F - Aggregable I - Individual\nS - Short-timeout L - Long-timeout N - InSync     O - OutofSync\nC - Collecting    D - Distributing X - State m/c expired  E - Default neighbor state\n\n" + table(["Intf", "Aggr", "State", "Partner", "Status"], rows);
  });
  cmd("*", "show spanning-tree", function () { return this.showStp(false); });
  cmd("*", "show spanning-tree summary", function () { return this.showStp(true); });
  Switch.prototype.showStp = function (summary) {
    var self = this;
    if (!this.stp.enable) return "Spanning tree is disabled. Enable it with `spanning-tree` in the config context.";
    var rootDev = (this.lesson.devices || []).filter(function (d) { return d.kind === "switch" && d.stpRoot && self.devices[d.id] && self.devices[d.id].connected && (d.ports || [d.port]).some(function (p) { return self.linkUp(p) && !self.errdisabled[p]; }); })[0];
    var o = ["Spanning tree status : Enabled   Protocol: " + (this.stp.mode === "mstp" ? "MSTP" : "RPVST"), ""];
    if (this.stp.mode === "mstp") o.push("MST0", "  Spanning tree status : Enabled", "  Root ID    Priority   : " + (rootDev ? (rootDev.stpPriority || 4096) : this.stp.priority * 4096), "             MAC-Address: " + (rootDev ? macCx(rootDev.mac) : "00:00:5e:00:53:00"), "             " + (rootDev ? "Root port: " + (rootDev.ports || [rootDev.port])[0] : "This bridge is the root"), "  Bridge ID  Priority   : " + this.stp.priority * 4096, "             MAC-Address: 00:00:5e:00:53:00", "");
    else o.push("  Root ID    Priority   : " + (rootDev ? (rootDev.stpPriority || 4096) : this.stp.priority * 4096), "             " + (rootDev ? "Root port: " + (rootDev.ports || [rootDev.port])[0] : "This bridge is the root"), "");
    if (summary) return o.join("\n");
    var rows = [];
    this.portNames().forEach(function (n) { var i = self.ifaces[n]; if (i.routing || i.lag) return; var st = self.stpState(n); if (!self.linkUp(n) && !self.errdisabled[n]) return; rows.push([n, self.errdisabled[n] ? "Disabled" : st.role, self.errdisabled[n] ? "Down" : st.state, 20000, 128, i.adminEdge ? "admin-edge" : (i.bpduGuard ? "" : "p2p"), i.bpduGuard ? "bpdu-guard" : ""]); });
    Object.keys(this.lags).forEach(function (l) { var lu = self.lagUp(l); if (!lu.up) return; rows.push(["lag" + l, "Root", "Forwarding", 10000, 128, "p2p", ""]); });
    return o.join("\n") + "\n" + table(["Port", "Role", "State", "Cost", "Priority", "Type", "Guard"], rows);
  };
  cmd("*", "show vsf", function () {
    var self = this, ids = Object.keys(this.vsf.members), o = ["VSF Stack ID   : 1", "MAC Address    : 00:00:5e:00:53:00", "Secondary      : " + (ids.length ? ids[0] : "none"), "Topology       : " + (ids.length ? "Chain" : "Standalone"), "Status         : Active", "Split Detect   : disabled", ""];
    var rows = [[1, self.model.pn, "Conductor", "OK"]];
    ids.forEach(function (m) { var mm = self.vsf.members[m], linked = Object.keys(mm.links || {}).some(function (l) { return mm.links[l].some(function (p) { return self.ifaces[p] && !self.ifaces[p].shutdown; }); }); rows.push([m, mm.type || "(no type)", m === ids[0] ? "Standby" : "Member", mm.type ? (linked ? "OK" : "Not-Provisioned (no link)") : "Not-Provisioned (no type)"]); });
    return o.join("\n") + table(["Mbr ID", "Type", "Role", "Status"], rows);
  });
  cmd("*", "show vsf link", function () {
    var self = this, rows = []; Object.keys(this.vsf.members).forEach(function (m) { var mm = self.vsf.members[m]; Object.keys(mm.links || {}).forEach(function (l) { mm.links[l].forEach(function (p) { rows.push([m, l, p, self.ifaces[p] && !self.ifaces[p].shutdown ? "Up" : "Down"]); }); }); });
    return rows.length ? table(["Mbr", "Link", "Interface", "State"], rows) : "No VSF links configured.";
  });
  cmd("*", "show ip interface brief", function () {
    var self = this, rows = [];
    this.portNames().forEach(function (n) { var i = self.ifaces[n]; if (i.routing) rows.push([n, i.ip || "No Address", self.linkUp(n) ? "up" : "down", "default"]); });
    Object.keys(this.svis).forEach(function (v) { var s = self.svis[v]; rows.push(["vlan" + v, s.ip || "No Address", s.shutdown ? "down (admin)" : (self.sviUp(+v) ? "up" : "down (no member port up)"), "default"]); });
    return rows.length ? table(["Interface", "IP Address", "Status", "VRF"], rows) : "No routed interfaces.";
  });
  cmd("*", "show ip route", function () {
    var rows = this.routeTable().map(function (r) { return [r.prefix + "/" + r.len, r.via + (r.ifn ? " (" + r.ifn + ")" : ""), r.type === "C" ? "connected" : (r.type === "S" ? "static" : "ospf"), "[" + r.dist + "/" + r.metric + "]"]; });
    return "Displaying ipv4 routes selected for forwarding\n\n'[x/y]' denotes [distance/metric]\n\n" + (rows.length ? table(["Prefix", "Nexthop", "Origin", "Distance"], rows) : "No routes.");
  });
  cmd("*", "show ip ospf neighbors", function () {
    var n = this.ospfNeighbors();
    if (!Object.keys(this.ospf).length) return "OSPF is not configured. Start with `router ospf 1`.";
    var rows = n.map(function (x) { return [x.rid, 1, x.state === "FULL" ? "FULL/DR" : "DOWN (" + x.why + ")", x.dev.ip, x.ifname]; });
    return "OSPF Process ID " + Object.keys(this.ospf)[0] + " VRF default\n\nTotal Number of Neighbors : " + n.filter(function (x) { return x.state === "FULL"; }).length + "\n\n" + (rows.length ? table(["Neighbor ID", "Priority", "State", "Nbr Address", "Interface"], rows) : "No neighbours heard.");
  });
  cmd("*", "show ip ospf interface", function () {
    var self = this, o = [];
    Object.keys(this.svis).forEach(function (v) { var s = self.svis[v]; if (s.ospf) o.push("Interface vlan" + v + " is " + (self.sviUp(+v) && !s.shutdown ? "up" : "down") + ", Process ID " + s.ospf.proc + ", Area " + s.ospf.area + (self.ospf[s.ospf.proc] && self.ospf[s.ospf.proc].passive.indexOf("vlan" + v) >= 0 ? " (passive)" : "") + ", IP " + (s.ip || "none") + ", Hello 10 Dead 40"); });
    this.portNames().forEach(function (n) { var i = self.ifaces[n]; if (i.ospf) o.push("Interface " + n + " is " + (self.linkUp(n) ? "up" : "down") + ", Process ID " + i.ospf.proc + ", Area " + i.ospf.area + ", IP " + (i.ip || "none") + ", Hello 10 Dead 40"); });
    return o.length ? o.join("\n") : "No OSPF interfaces.";
  });
  cmd("*", "show arp", function () {
    var self = this, rows = [];
    (this.lesson.devices || []).concat(this.lesson.hosts || []).forEach(function (d) { if (!d.ip || !d.mac) return; if (d.id && !(self.devices[d.id] && self.devices[d.id].connected)) return; var r = self.reachable(d.ip); if (r.ok && r.how === "direct") { var l = self.ifaceForIp(d.ip); rows.push([d.ip, macCx(d.mac), l ? (l.kind === "vlan" ? "vlan" + l.id : l.id) : "", "dynamic"]); } });
    return rows.length ? table(["IPv4 Address", "MAC", "Port", "State"], rows) : "No ARP entries.";
  });
  cmd("*", "show radius-server", function () {
    var self = this;
    if (!this.radius.length) return "No RADIUS servers configured. Add one with `radius-server host <A.B.C.D> key plaintext <key>`.";
    return "******* Global RADIUS Configuration *******\nShared-Secret: None\nTimeout: 5\nAuth-Type: pap\nRetries: 1\nTracking Time Interval (seconds): 300\nTracking Mode: authentication\n\n" + table(["Host", "Auth-Port", "Acct-Port", "VRF", "Shared-Secret", "Status"], this.radius.map(function (r) { var reach = self.radiusReach([r]); return [r.host, 1812, 1813, r.vrf || "default", r.key ? "configured" : "none", reach.server ? "reachable" : "unreachable"]; }));
  });
  cmd("*", "show radius-server detail", function () {
    var self = this; if (!this.radius.length) return "No RADIUS servers configured.";
    return this.radius.map(function (r) { var reach = self.radiusReach([r]); return "Host: " + r.host + "\n  Auth-Port: 1812  Acct-Port: 1813  VRF: " + (r.vrf || "default") + "\n  Shared-Secret: " + (r.key ? "configured" : "none") + "\n  Reachability (sandbox): " + (reach.server ? "the server answers" : reach.tried[0].why); }).join("\n\n");
  });
  cmd("*", "show radius-server statistics", function () {
    var self = this, o = [];
    this.radius.forEach(function (r) {
      var acc = 0, rej = 0, to = 0;
      Object.keys(self.clients).forEach(function (k) { var c = self.clients[k]; if (c.method === "none") return; (c.tried || []).forEach(function (t) { if (t.host === r.host && t.result === "timeout") to++; }); if (c.server === r.host) { if (c.reason.indexOf("Access-Accept") === 0) acc++; else rej++; } });
      o.push("Server Name   : " + r.host, "Auth-Port     : 1812", "Access Requests    : " + (acc + rej + to), "Access Accepts     : " + acc, "Access Rejects     : " + rej, "Timeouts           : " + to, "Bad Authenticators : 0", "Round Trip Time    : " + (to && !acc && !rej ? "n/a" : "12 ms"), "");
    });
    return o.length ? o.join("\n") : "No RADIUS servers configured.";
  });
  cmd("*", "show aaa server-groups", function () {
    var self = this, rows = [];
    rows.push(["radius", "radius", this.radius.map(function (r) { return r.host; }).join(", ") || "(none)", "built in, every configured server"]);
    Object.keys(this.groups).forEach(function (g) { rows.push([g, "radius", self.groups[g].servers.join(", ") || "(empty)", ""]); });
    return "******* AAA Mechanism RADIUS *******\n" + table(["Group Name", "Type", "Servers", "Note"], rows);
  });
  Switch.prototype.clientRows = function (filterPort) {
    var self = this, rows = [];
    (this.lesson.devices || []).forEach(function (d) { var c = self.clients[d.id]; if (!c || c.method === "none") return; if (filterPort && c.port !== filterPort) return; rows.push(c); });
    return rows.sort(function (a, b) { return portKey(a.port) - portKey(b.port); });
  };
  cmd("*", "show port-access clients", function () { return this.showClients(null, false); });
  cmd("*", "show port-access clients detail", function () { return this.showClients(null, true); });
  cmd("*", "show port-access clients interface <PORT>", function (a) { return this.showClients(a[4], false); });
  cmd("*", "show port-access clients interface <PORT> detail", function (a) { return this.showClients(a[4], true); });
  Switch.prototype.showClients = function (port, detail) {
    var self = this, rows = this.clientRows(port);
    if (!rows.length) {
      var open = Object.keys(this.clients).filter(function (k) { return self.clients[k].method === "none" && (!port || self.clients[k].port === port); });
      return "Port Access Clients\n\nNo port-access clients." + (open.length ? "\n(" + open.length + " device" + (open.length > 1 ? "s are" : " is") + " connected on ports without port-access; they never authenticated, they are simply on the access VLAN.)" : "");
    }
    if (!detail) return "Port Access Clients\n\nFlags: Authentication status Success (S), Failed (F), In Progress (I)\n\n" + table(["Port", "MAC-Address", "Onboarded Method", "Status", "Role", "VLAN", "Client Name"], rows.map(function (c) { return [c.port, c.mac, c.method === "dot1x" ? "dot1x" : "mac-auth", c.status === "Success" ? "S" : "F", c.role || (c.status === "Success" ? "-" : ""), c.status === "Success" ? c.vlan : "", c.user || ""]; }));
    return rows.map(function (c) {
      var o = ["Port: " + c.port, "  Client Name        : " + (c.user || ""), "  Client MAC         : " + c.mac, "  Onboarded Method   : " + (c.method === "dot1x" ? "dot1x" : "mac-auth"), "  Auth Status        : " + c.status, "  Auth Server        : " + (c.server || "none answered"), "  Role               : " + (c.role || "-"), "  VLAN               : " + (c.status === "Success" ? c.vlan : "-"), "  Reason             : " + c.reason];
      if (c.tried && c.tried.length) c.tried.forEach(function (t) { o.push("    " + t.host + ": " + (t.result === "ok" ? "answered" : "timeout, " + t.why)); });
      o.push("  Session Time       : " + Math.max(1, Math.floor((self.now() - c.at) / 1000)) + " s");
      return o.join("\n");
    }).join("\n\n");
  };
  cmd("*", "show aaa authentication port-access interface all client-status", function () { return this.showClients(null, true); });
  cmd("*", "show aaa authentication port-access interface <PORT> client-status", function (a) { return this.showClients(a[5], true); });
  cmd("*", "show port-access role", function () { var self = this, names = Object.keys(this.pa.roles); return names.length ? names.map(function (r) { return "Role Information:\n\nName  : " + r + "\nType  : local\n----------------------------------------------\n    Description       : " + (self.pa.roles[r].desc || "") + "\n    VLAN              : " + (self.pa.roles[r].vlan || "not set") + "\n    Reauthentication  : Disabled"; }).join("\n\n") : "No port-access roles defined."; });
  cmd("*", "show port-access role <WORD>", function (a) { var r = this.pa.roles[a[3]]; return r ? "Role Information:\n\nName  : " + a[3] + "\nType  : local\n----------------------------------------------\n    Description       : " + (r.desc || "") + "\n    VLAN              : " + (r.vlan || "not set") + "\n    Reauthentication  : Disabled" : "Role " + a[3] + " is not defined."; });
  cmd("*", "show checkpoint list", function () { var rows = this.checkpoints.map(function (c) { return [c.name, "user", tsClock(c.at)]; }); rows.unshift(["startup-config", "system", "boot"]); return table(["Name", "Type", "Written"], rows); });
  cmd("*", "show aaa authentication port-access", function () { return "Global 802.1X   : " + (this.pa.dot1x ? "Enabled" : "Disabled") + " (server group " + (this.pa.dot1xGroup || "radius") + ")\nGlobal MAC-auth : " + (this.pa.macAuth ? "Enabled" : "Disabled") + " (server group " + (this.pa.macAuthGroup || "radius") + ")\nDyn-authorization: " + (this.pa.dynAuth ? "Enabled" : "Disabled"); });

  // ── sandbox commands (not switch commands) ──────────────────────────────
  cmd("*", "sim connect <DEV>", function (a) { return this.connect(a[2]); });
  cmd("*", "sim disconnect <DEV>", function (a) { return this.disconnect(a[2]); });
  cmd("*", "sim coa <DEV> role <WORD>", function (a) { return this.coa(a[2], a[4]); });
  cmd("*", "sim status", function () {
    var self = this, rows = (this.lesson.devices || []).map(function (d) { var st = self.devices[d.id], c = self.clients[d.id]; return [d.id, d.name, (d.ports || [d.port]).join(","), st && st.connected ? "plugged in" : "unplugged", c ? (c.status === "Open" ? "no NAC, VLAN " + c.vlan : c.method + " " + c.status + (c.role ? " " + c.role : "")) : ""]; });
    return rows.length ? table(["Id", "Device", "Port", "Cable", "Auth"], rows) : "This lab has no devices.";
  });
  cmd("*", "sim reset", function () { return "__RESET__"; });
  cmd("*", "sim help", function () { return "sim commands are the sandbox talking, not the switch:\n  sim connect <id>       plug a device from the Devices panel into its port\n  sim disconnect <id>    unplug it\n  sim coa <id> role <r>  have the fake ClearPass send a change of authorization\n  sim status             what is plugged in and how it authenticated\n  sim reset              put the lab back to its starting state\nEverything else you type goes to the modelled switch."; });

  // ── lesson checks ───────────────────────────────────────────────────────
  Switch.prototype.check = function () {
    var self = this, checks = this.lesson.checks || [];
    return checks.map(function (c) {
      var pass = false, why = "";
      try {
        if (c.config) {
          var sec = c.config.context ? self.configSection(c.config.context) : self.runningConfig().split("\n");
          if (!sec) why = "no `" + c.config.context + "` section in the running config";
          else { var re = new RegExp(c.config.has); pass = sec.some(function (l) { return re.test(l.trim()); }); if (c.config.absent) pass = !pass; if (!pass) why = c.config.absent ? "still present" : "not found under " + (c.config.context || "the config"); }
        } else if (c.client) {
          var rec = self.clients[c.client.dev] || (c.client.port ? self.clientRows(c.client.port)[0] : null);
          if (!rec) why = "no client record; is the device plugged in?";
          else { pass = (!c.client.status || rec.status === c.client.status) && (!c.client.role || rec.role === c.client.role) && (!c.client.vlan || rec.vlan === c.client.vlan) && (!c.client.method || rec.method === c.client.method); if (!pass) why = rec.status + (rec.role ? " in role " + rec.role : "") + (rec.status === "Success" ? " on VLAN " + rec.vlan : ": " + rec.reason); }
        } else if (c.vlan) { var v = self.vlans[c.vlan.id]; pass = !!v && (!c.vlan.name || v.name === c.vlan.name); if (!pass) why = v ? "named " + v.name : "VLAN " + c.vlan.id + " does not exist"; }
        else if (c.lag) { var lu = self.lagUp(c.lag.id); pass = lu.up && (!c.lag.members || c.lag.members.every(function (m) { return lu.active.indexOf(m) >= 0; })); if (!pass) why = self.lags[c.lag.id] ? "lag" + c.lag.id + " has " + lu.active.length + " active member(s)" : "lag" + c.lag.id + " does not exist"; }
        else if (c.errdisabled) { pass = !!self.errdisabled[c.errdisabled.port] === (c.errdisabled.is !== false); if (!pass) why = self.errdisabled[c.errdisabled.port] ? "port is error-disabled" : "port is not error-disabled"; }
        else if (c.ospf) { var n = self.ospfNeighbors().filter(function (x) { return !c.ospf.dev || x.dev.id === c.ospf.dev; })[0]; pass = !!n && n.state === "FULL"; if (!pass) why = n ? "adjacency down: " + n.why : "no OSPF neighbour on any interface"; }
        else if (c.ping) { var r = self.reachable(c.ping.to); pass = r.ok === (c.ping.ok !== false); if (!pass) why = r.ok ? "reachable" : r.why; }
        else if (c.route) { var rt = self.routeTable().filter(function (x) { return x.prefix + "/" + x.len === c.route.prefix && (!c.route.type || x.type === c.route.type); })[0]; pass = !!rt; if (!pass) why = "no such route in the table"; }
        else if (c.hostname) { pass = self.hostname === c.hostname; if (!pass) why = "hostname is " + self.hostname; }
        else if (c.saved) { pass = self.startup === self.runningConfig(); if (!pass) why = "running config differs from startup"; }
        else if (c.stp) { var st = self.stpState(c.stp.port); pass = st.state === c.stp.state; if (!pass) why = "port is " + st.state; }
      } catch (e) { why = "check error: " + e.message; }
      return { desc: c.desc, pass: pass, why: why };
    });
  };

  // ── factory ─────────────────────────────────────────────────────────────
  return {
    MODELS: MODELS, VERSION: VERSION,
    create: function (lesson, saved) {
      var sw = new Switch(lesson, saved);
      return {
        sw: sw,
        exec: function (line) { return sw.run(line); },
        help: function (line) { return sw.help(line); },
        complete: function (line) { return sw.complete(line); },
        prompt: function () { return sw.prompt(); },
        connect: function (id) { return sw.connect(id); },
        disconnect: function (id) { return sw.disconnect(id); },
        coa: function (id, role) { return sw.coa(id, role); },
        check: function () { return sw.check(); },
        save: function () { return sw.save(); },
        devices: function () { return (lesson && lesson.devices || []).map(function (d) { var st = sw.devices[d.id], c = sw.clients[d.id]; return { id: d.id, name: d.name, kind: d.kind, port: (d.ports || [d.port]).join(", "), connected: !!(st && st.connected), auth: c || null, linkUp: (d.ports || [d.port]).some(function (p) { return sw.linkUp(p); }), errdisabled: sw.errdisabled[d.port] || "" }; }); },
        history: function () { return sw.history; }
      };
    }
  };
});
