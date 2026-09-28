/* CX config checker: paste an AOS-CX running-config, get findings back. Runs entirely in the browser (or under
   Node for the tests); it never makes a request. Four kinds of finding:
     syntax     every line asked of the real command set of the release picked (theme/cxsim/corpus/aoscx.js through
                CXSim.syntax), so a line a release will not take, and the release that does, both show up
     reference  something named that is never defined: a VLAN, a role, a RADIUS group or server, an LLDP group,
                a LAG, a tunnel zone, an OSPF process
     hardening  the CIS HPE Aruba Networking CX Switch benchmark, mapped by control number only (the CIS text is
                not reproduced); what can be read from a config is checked, the rest is listed as manual
     practice   the habits that keep a campus access switch out of trouble
   Each finding says why, and where there is one, the lines that fix it. Fix lines are checked against the
   command set in cxsimtest.js, so a suggestion is never syntax the switch would refuse. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./engine.js"));
  else root.CXCheck = factory(root.CXSim);
})(typeof self !== "undefined" ? self : this, function (CXSim) {
  "use strict";

  // ── reading the config ────────────────────────────────────────────────────
  // A running-config indents a context's lines by four under the line that opened it (five for LLDP group rules,
  // eight for a nested block). The context a line is checked in follows from the line that opened its block.
  function childCtx(text, parent) {
    if (parent === "config") {
      if (/^interface (\d+\/\d+\/\d+)([-,]\d+\/\d+\/\d+)*$/.test(text)) return "if";
      if (/^interface lag \d+$/.test(text)) return "lag";
      if (/^interface vlan \d+$/.test(text)) return "svi";
      if (/^vlan [\d,-]+$/.test(text)) return "vlan";
      if (/^aaa group server radius \S+$/.test(text)) return "sg";
      if (/^port-access role \S+$/.test(text)) return "pa-role";
      if (/^port-access lldp-group \S+$/.test(text)) return "lldp-group";
      if (/^port-access device-profile \S+$/.test(text)) return "device-profile";
      if (/^ubt zone \S+ vrf \S+$/.test(text)) return "ubt-zone";
      if (/^router ospf \d+/.test(text)) return "ospf";
      if (text === "aaa authentication port-access dot1x authenticator") return "dot1x";
      if (text === "aaa authentication port-access mac-auth") return "macauth";
      return "";
    }
    if (parent === "if") {
      if (text === "aaa authentication port-access dot1x authenticator") return "if-dot1x";
      if (text === "aaa authentication port-access mac-auth") return "if-macauth";
    }
    return "";
  }
  function parse(text) {
    var out = { lines: [], version: "", exportDefault: false, blocks: [], banners: [] }, stack = [{ indent: -1, ctx: "config", block: null }], delim = "";
    String(text || "").replace(/\r/g, "").replace(/\t/g, "    ").split("\n").forEach(function (raw, idx) {
      var n = idx + 1, t = raw.replace(/\s+$/, ""), trimmed = t.trim();
      // a banner's text runs until its delimiter comes back; none of it is a command
      if (delim) { if (trimmed.indexOf(delim) >= 0) delim = ""; return; }
      if (!trimmed) return;
      var bm = /^banner (motd|exec) (\S)$/.exec(trimmed);
      if (bm) { delim = bm[2]; out.banners.push(bm[1]); }
      var vm = /^!\s*Version AOS-CX \S*?(\d+\.\d+)\.\d+/.exec(trimmed); if (vm) out.version = vm[1];
      if (/^!\s*export-password:\s*default/.test(trimmed)) out.exportDefault = true;
      if (trimmed[0] === "!" || /^Current configuration:?$/.test(trimmed)) return;
      var indent = t.length - t.replace(/^ +/, "").length;
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
      var top = stack[stack.length - 1], ln = { n: n, text: trimmed, indent: indent, ctx: top.ctx, block: top.block };
      out.lines.push(ln);
      var kid = top.ctx ? childCtx(trimmed, top.ctx) : "";
      // a line that opens a block: its children are checked in kid (or not at all when the corpus lacks it)
      var block = { line: ln, ctx: kid, kids: [], parent: top.block };
      if (top.block) top.block.kids.push(ln); else out.blocks.push(block);
      ln.opens = block;
      stack.push({ indent: indent, ctx: kid, block: block });
    });
    return out;
  }

  // ── what the config says ──────────────────────────────────────────────────
  function portKey(p) { var a = p.split("/"); return (+a[0]) * 1e6 + (+a[1]) * 1e3 + (+a[2]); }
  function expandPorts(spec) {
    var out = [];
    spec.split(",").forEach(function (part) {
      var r = part.split("-");
      if (r.length === 1) { out.push(part); return; }
      var a = r[0].split("/"), b = r[1].split("/");
      if (a[0] !== b[0] || a[1] !== b[1]) { out.push(r[0], r[1]); return; }
      for (var i = +a[2]; i <= +b[2] && i - +a[2] < 400; i++) out.push(a[0] + "/" + a[1] + "/" + i);
    });
    return out;
  }
  function vlanList(spec) {
    var out = [];
    if (spec === "all") return out;
    spec.split(",").forEach(function (p) { var r = p.split("-"); if (r.length === 1) out.push(+r[0]); else for (var i = +r[0]; i <= +r[1] && i - +r[0] < 4094; i++) out.push(i); });
    return out.filter(function (v) { return v >= 1 && v <= 4094; });
  }
  function kidsOf(ln) { return ln.opens ? ln.opens.kids : []; }
  function model(p) {
    var m = { hostname: "", vlans: {}, ports: {}, lags: {}, svis: {}, roles: {}, groups: {}, servers: {}, lldpGroups: {}, profiles: {}, zones: {}, ospf: {},
      refs: { vlan: [], role: [], group: [], server: [], lldpGroup: [], lag: [], zone: [], ospf: [] }, top: {} , vsf: [] };
    function ref(kind, name, ln) { m.refs[kind].push({ name: name, ln: ln }); }
    p.lines.forEach(function (ln) {
      var t = ln.text, x;
      if (ln.indent === 0) (m.top[t.split(" ")[0]] = m.top[t.split(" ")[0]] || []).push(ln);
      if (ln.ctx === "config" && ln.indent === 0) {
        if ((x = /^hostname (\S+)/.exec(t))) m.hostname = x[1];
        else if ((x = /^vlan ([\d,-]+)$/.exec(t))) vlanList(x[1]).forEach(function (v) { m.vlans[v] = { ln: ln, name: "" }; kidsOf(ln).forEach(function (k) { var nm = /^name (.+)$/.exec(k.text); if (nm) m.vlans[v].name = nm[1]; }); });
        else if ((x = /^interface ((\d+\/\d+\/\d+)([-,]\d+\/\d+\/\d+)*)$/.exec(t))) expandPorts(x[1]).forEach(function (pn) { var e = m.ports[pn] = m.ports[pn] || { ln: ln, lines: [] }; e.lines = e.lines.concat(kidsOf(ln)); });
        else if ((x = /^interface lag (\d+)$/.exec(t))) m.lags[x[1]] = { ln: ln, lines: kidsOf(ln), members: [] };
        else if ((x = /^interface vlan (\d+)$/.exec(t))) m.svis[x[1]] = { ln: ln, lines: kidsOf(ln) };
        else if ((x = /^port-access role (\S+)$/.exec(t))) m.roles[x[1]] = { ln: ln, lines: kidsOf(ln), used: false };
        else if ((x = /^aaa group server radius (\S+)$/.exec(t))) m.groups[x[1]] = { ln: ln, servers: kidsOf(ln).map(function (k) { var s = /^server (\S+)/.exec(k.text); return s ? { ip: s[1], ln: k } : null; }).filter(Boolean), used: false };
        else if ((x = /^radius-server host (\S+)(.*)$/.exec(t))) m.servers[x[1]] = { ln: ln, vrf: (/ vrf (\S+)/.exec(x[2]) || [])[1] || "default" };
        else if ((x = /^port-access lldp-group (\S+)$/.exec(t))) m.lldpGroups[x[1]] = { ln: ln, used: false, rules: kidsOf(ln).length };
        else if ((x = /^port-access device-profile (\S+)$/.exec(t))) m.profiles[x[1]] = { ln: ln, lines: kidsOf(ln) };
        else if ((x = /^ubt zone (\S+) vrf (\S+)$/.exec(t))) m.zones[x[1]] = { ln: ln, lines: kidsOf(ln) };
        else if ((x = /^router ospf (\d+)/.exec(t))) m.ospf[x[1]] = { ln: ln };
        else if ((x = /^ubt-client-vlan (\d+)$/.exec(t))) ref("vlan", +x[1], ln);
        else if ((x = /^vsf member (\d+)$/.exec(t))) kidsOf(ln).forEach(function (k) { var l = /^link \d+ (\S+)$/.exec(k.text); if (l) m.vsf.push({ member: x[1], ports: l[1], ln: k }); });
      }
      // references, wherever they sit
      if ((x = /^vlan access (\d+)$/.exec(t))) ref("vlan", +x[1], ln);
      if ((x = /^vlan trunk native (\d+)$/.exec(t))) ref("vlan", +x[1], ln);
      if ((x = /^vlan trunk allowed ([\d,-]+)$/.exec(t))) vlanList(x[1]).forEach(function (v) { ref("vlan", v, ln); });
      if ((x = /^radius server-group (\S+)$/.exec(t))) ref("group", x[1], ln);
      if ((x = /^aaa (?:authentication|accounting|authorization) .* group ((?:\S+ ?)+)$/.exec(t))) x[1].split(" ").forEach(function (g) { if (!/^(local|none|radius|tacacs)$/.test(g)) ref("group", g, ln); });
      if (ln.ctx === "sg" && (x = /^server (\S+)/.exec(t))) ref("server", x[1], ln);
      if ((x = /^aaa authentication port-access (?:critical-role|reject-role|auth-role|preauth-role|critical-voice-role) (\S+)$/.exec(t))) ref("role", x[1], ln);
      if ((x = /^port-access fallback-role (\S+)$/.exec(t))) ref("role", x[1], ln);
      if (ln.ctx === "device-profile" && (x = /^associate role (\S+)$/.exec(t))) ref("role", x[1], ln);
      if (ln.ctx === "device-profile" && (x = /^associate lldp-group (\S+)$/.exec(t))) ref("lldpGroup", x[1], ln);
      if (ln.ctx === "if" && (x = /^lag (\d+)$/.exec(t))) ref("lag", x[1], ln);
      if ((x = /^gateway-zone zone (\S+)/.exec(t))) ref("zone", x[1], ln);
      if ((x = /^ip ospf (\d+) area/.exec(t))) ref("ospf", x[1], ln);
    });
    m.refs.lag.forEach(function (r) { if (m.lags[r.name]) m.lags[r.name].members.push(r.ln); });
    return m;
  }

  // ── findings ──────────────────────────────────────────────────────────────
  var SEV = { error: 0, warn: 1, info: 2 };
  function has(lines, re) { return lines.some(function (l) { return re.test(l.text); }); }
  function anyTop(p, re) { return p.lines.some(function (l) { return l.indent === 0 && re.test(l.text); }); }
  function portsWith(m, fn) { return Object.keys(m.ports).sort(function (a, b) { return portKey(a) - portKey(b); }).filter(function (pn) { return fn(m.ports[pn].lines, pn); }); }
  function span(ports) {
    // 1/1/1-1/1/4,1/1/9: how a switch spells a port list, shortest first
    var out = [], i = 0;
    while (i < ports.length) {
      var j = i; while (j + 1 < ports.length && portKey(ports[j + 1]) === portKey(ports[j]) + 1) j++;
      out.push(j > i ? ports[i] + "-" + ports[j] : ports[i]); i = j + 1;
    }
    return out.join(",");
  }
  function isAccess(lines) { return has(lines, /^vlan access \d+$/) || has(lines, /^aaa authentication port-access /) || has(lines, /^port-access /); }
  function isTrunk(lines) { return has(lines, /^vlan trunk /); }
  function isDefaultOnly(lines) { return lines.every(function (l) { return /^(no shutdown|no routing|vlan access 1)$/.test(l.text); }); }

  function check(text, opts) {
    opts = opts || {};
    var rels = CXSim && CXSim.releases ? CXSim.releases() : [], p = parse(text), m = model(p), F = [], manual = [];
    var release = opts.release && rels.indexOf(opts.release) >= 0 ? opts.release : (rels.indexOf(p.version) >= 0 ? p.version : rels[rels.length - 1]);
    function add(f) { F.push(f); }
    var checked = 0, unchecked = {};

    // syntax, line by line, in the context each line belongs to
    p.lines.forEach(function (ln) {
      if (!ln.ctx) { var at = ln.block ? ln.block.line.text.split(" ").slice(0, 2).join(" ") : "?"; unchecked[at] = (unchecked[at] || 0) + 1; return; }
      var r = CXSim.syntax(ln.ctx, ln.text, release);
      if (!r) { unchecked[ln.ctx] = (unchecked[ln.ctx] || 0) + 1; return; }
      checked++;
      if (r.state === "full") return;
      var takes = rels.filter(function (x) { var s = CXSim.syntax(ln.ctx, ln.text, x); return s && s.state === "full"; });
      var said = r.error.replace(/\.$/, "");
      if (takes.length) add({ sev: "error", kind: "syntax", line: ln.n, text: ln.text, title: release + " does not take this line",
        why: "The " + release + " command set answers " + said + ". In " + takes.join(", ") + " it is valid, so this config was written for " + (takes.length === 1 ? "that release" : "one of those") + "." });
      else if (r.state === "invalid" && r.at === 0) add({ sev: "warn", kind: "syntax", line: ln.n, text: ln.text, title: "A command no release here knows",
        why: "Every release from " + rels[0] + " to " + rels[rels.length - 1] + " answers " + said + ". Either a typo, or a hardware-only command the Switch Simulator hides (PoE, VSF, some speeds): check it against the CLI reference for your platform." });
      else add({ sev: "error", kind: "syntax", line: ln.n, text: ln.text, title: r.state === "partial" ? "An unfinished line" : "The switch would refuse this line",
        why: "Every release from " + rels[0] + " to " + rels[rels.length - 1] + " answers " + said + "." + (r.state === "invalid" ? " The command is real; the word it stops at is not what it expects there." : "") });
    });

    // references: named but never defined
    var BUILTIN_GROUPS = { local: 1, none: 1, radius: 1, tacacs: 1 };
    var seenRef = {};
    function missing(kind, name, ln, title, why, fix) { var k = kind + ":" + name; if (seenRef[k]) { seenRef[k].also.push(ln.n); return; } seenRef[k] = { sev: "error", kind: "reference", line: ln.n, text: ln.text, title: title, why: why, fix: fix, also: [] }; add(seenRef[k]); }
    m.refs.vlan.forEach(function (r) { if (!m.vlans[r.name] && r.name !== 1) missing("vlan", r.name, r.ln, "VLAN " + r.name + " is never created", "A port, role or tunnel names VLAN " + r.name + " but there is no vlan " + r.name + " in the config. The switch refuses the line until the VLAN exists.", ["vlan " + r.name, "    name VLAN" + r.name]); });
    m.refs.group.forEach(function (r) { if (!m.groups[r.name] && !BUILTIN_GROUPS[r.name]) missing("group", r.name, r.ln, "RADIUS group " + r.name + " is never defined", "Authentication points at server group " + r.name + ", which the config never creates, so every request fails.", ["aaa group server radius " + r.name, "    server 192.0.2.10"]); else if (m.groups[r.name]) m.groups[r.name].used = true; });
    m.refs.server.forEach(function (r) { if (!m.servers[r.name]) missing("server", r.name, r.ln, "Server " + r.name + " is in a group but not defined", "A group lists " + r.name + " but there is no radius-server host line for it, so there is no shared secret and nothing to send to.", ["radius-server host " + r.name + " key plaintext <SHARED-SECRET>"]); });
    m.refs.role.forEach(function (r) { if (!m.roles[r.name]) missing("role", r.name, r.ln, "Role " + r.name + " is named but not defined", "A local role has to exist on the switch before a port, a profile or a fallback can hand it out. Clients assigned " + r.name + " would fail authorization.", ["port-access role " + r.name, "    vlan access <VLAN>"]); else m.roles[r.name].used = true; });
    m.refs.lldpGroup.forEach(function (r) { if (!m.lldpGroups[r.name]) missing("lldp", r.name, r.ln, "LLDP group " + r.name + " is associated but not defined", "The device profile can never match, because the group it points at does not exist.", ["port-access lldp-group " + r.name, "    match sys-desc <TEXT>"]); else m.lldpGroups[r.name].used = true; });
    m.refs.lag.forEach(function (r) { if (!m.lags[r.name]) missing("lag", r.name, r.ln, "Port joins LAG " + r.name + ", which does not exist", "Create the LAG first; the member's VLAN settings come from it.", ["interface lag " + r.name, "    no shutdown", "    lacp mode active"]); });
    m.refs.zone.forEach(function (r) { if (!m.zones[r.name]) missing("zone", r.name, r.ln, "Tunnel zone " + r.name + " is not defined", "A role tunnels to zone " + r.name + " but there is no ubt zone " + r.name + ", so its clients have nowhere to go.", ["ubt zone " + r.name + " vrf default", "    primary-controller ip 192.0.2.50", "    enable"]); });
    m.refs.ospf.forEach(function (r) { if (!m.ospf[r.name]) missing("ospf", r.name, r.ln, "OSPF process " + r.name + " is not running", "An interface joins OSPF process " + r.name + " but there is no router ospf " + r.name + ".", ["router ospf " + r.name, "    router-id 203.0.113.2", "    area 0.0.0.0"]); });
    m.vsf.forEach(function (v) { if (v.ports.split(/[-,]/).some(function (pp) { return pp.split("/")[0] !== v.member; })) add({ sev: "error", kind: "reference", line: v.ln.n, text: v.ln.text, title: "VSF link on another member's port", why: "A member's stack links are its own ports: " + v.member + "/1/x for member " + v.member + ". (HPE VSF guide; the Switch Simulator has no VSF to check against.)" }); });

    // defined but never used
    Object.keys(m.vlans).forEach(function (v) {
      if (+v === 1) return;
      var used = m.refs.vlan.some(function (r) { return r.name === +v; }) || m.svis[v];
      if (!used) add({ sev: "info", kind: "unused", line: m.vlans[v].ln.n, text: m.vlans[v].ln.text, title: "VLAN " + v + " is not used here", why: "No port, trunk, role or SVI on this switch carries it. Fine if it only passes through on a trunk that allows all, otherwise it is clutter." });
      else if (!m.vlans[v].name) add({ sev: "info", kind: "practice", line: m.vlans[v].ln.n, text: m.vlans[v].ln.text, title: "VLAN " + v + " has no name", why: "Names show up in show vlan and LLDP. The next person reads those, not your ticket.", fix: ["vlan " + v, "    name <PURPOSE>"] });
    });
    Object.keys(m.roles).forEach(function (r) { if (!m.roles[r].used) add({ sev: "info", kind: "unused", line: m.roles[r].ln.n, text: m.roles[r].ln.text, title: "Role " + r + " is not referenced in the config", why: "Nothing on the switch hands it out. That is normal when ClearPass assigns it with Aruba-User-Role; if not, it is dead weight." }); });
    Object.keys(m.groups).forEach(function (g) { if (!m.groups[g].used && !BUILTIN_GROUPS[g]) add({ sev: "info", kind: "unused", line: m.groups[g].ln.n, text: m.groups[g].ln.text, title: "RADIUS group " + g + " is not used", why: "No authentication, accounting or port-access block points at it." }); });
    Object.keys(m.lldpGroups).forEach(function (g) { if (!m.lldpGroups[g].used) add({ sev: "info", kind: "unused", line: m.lldpGroups[g].ln.n, text: m.lldpGroups[g].ln.text, title: "LLDP group " + g + " is not associated", why: "No device profile uses it, so it matches nothing." }); });
    Object.keys(m.lags).forEach(function (l) { if (!m.lags[l].members.length) add({ sev: "info", kind: "unused", line: m.lags[l].ln.n, text: m.lags[l].ln.text, title: "LAG " + l + " has no members", why: "No port says lag " + l + "." }); });

    // practice
    var accessPorts = portsWith(m, function (ls) { return isAccess(ls) && !has(ls, /^lag \d+$/); });
    var paPorts = portsWith(m, function (ls) { return has(ls, /^aaa authentication port-access (dot1x authenticator|mac-auth)$/); });
    var trunkPorts = portsWith(m, function (ls) { return isTrunk(ls); });
    if (!anyTop(p, /^spanning-tree( mode \S+)?$/)) add({ sev: "warn", kind: "practice", title: "Spanning tree is off", why: "Without it one looped patch cable takes the VLAN down. MSTP is the default mode once it is on.", fix: ["spanning-tree"] });
    Object.keys(m.lags).forEach(function (l) {
      var ls = m.lags[l].lines;
      if (!has(ls, /^lacp mode (active|passive)$/)) add({ sev: "warn", kind: "practice", line: m.lags[l].ln.n, text: m.lags[l].ln.text, title: "LAG " + l + " is static", why: "Without lacp mode nothing checks the other end, so a member cabled to the wrong box still forwards.", fix: ["interface lag " + l, "    lacp mode active"] });
      if (!has(ls, /^no shutdown$/)) add({ sev: "warn", kind: "practice", line: m.lags[l].ln.n, text: m.lags[l].ln.text, title: "LAG " + l + " is administratively down", why: "A new LAG is shut on 10.18 until no shutdown. Nothing forms while it is.", fix: ["interface lag " + l, "    no shutdown"] });
    });
    var allowAll = p.lines.filter(function (l) { return l.text === "vlan trunk allowed all"; });
    if (allowAll.length) add({ sev: "warn", kind: "practice", line: allowAll[0].n, text: allowAll[0].text, title: "A trunk allows every VLAN", why: "Every VLAN, including ones created later for something else, crosses the link. List the ones the far end needs." + (allowAll.length > 1 ? " " + allowAll.length + " trunks do this." : "") });
    var native1 = trunkPorts.filter(function (pn) { var ls = m.ports[pn].lines; return !has(ls, /^vlan trunk native (?!1$)\d+$/); });
    if (native1.length) add({ sev: "info", kind: "practice", title: "Trunks with native VLAN 1: " + span(native1), why: "VLAN 1 is the default everywhere, so untagged frames end up there by accident. Pick the native VLAN on purpose.", fix: ["interface " + span(native1), "    vlan trunk native <VLAN>"] });
    var noCrit = paPorts.filter(function (pn) { return !has(m.ports[pn].lines, /^aaa authentication port-access critical-role \S+$/); });
    if (noCrit.length) add({ sev: "warn", kind: "practice", title: "No critical role on " + span(noCrit), why: "When every RADIUS server times out these ports give their clients nothing. A critical role is the decision about what a building does when ClearPass is unreachable.", fix: ["interface " + span(noCrit), "    aaa authentication port-access critical-role <ROLE>"] });
    var nServers = Object.keys(m.servers).length;
    if ((paPorts.length || Object.keys(m.groups).length) && nServers === 1) add({ sev: "warn", kind: "practice", line: m.servers[Object.keys(m.servers)[0]].ln.n, text: m.servers[Object.keys(m.servers)[0]].ln.text, title: "One RADIUS server", why: "Every port-access port depends on it. Add the second ClearPass node to the group before go-live.", fix: ["radius-server host 192.0.2.11 key plaintext <SHARED-SECRET>", "aaa group server radius <GROUP>", "    server 192.0.2.11"] });
    if (paPorts.length && !anyTop(p, /^radius dyn-authorization enable$/)) add({ sev: "info", kind: "practice", title: "No change of authorization", why: "Without radius dyn-authorization ClearPass cannot bounce or re-role a client after the fact, which most NAC designs lean on.", fix: ["radius dyn-authorization enable", "radius dyn-authorization client 192.0.2.10 secret-key plaintext <SHARED-SECRET>"] });
    if (anyTop(p, /^radius dyn-authorization enable$/) && !anyTop(p, /^radius dyn-authorization client /)) add({ sev: "warn", kind: "practice", title: "CoA is on but no server may send it", why: "On 10.18 each server that sends CoA needs a radius dyn-authorization client line. Without one every request is dropped and counted as an invalid client.", fix: ["radius dyn-authorization client 192.0.2.10 secret-key plaintext <SHARED-SECRET>"] });
    ["dot1x authenticator", "mac-auth"].forEach(function (meth) {
      var on = portsWith(m, function (ls) { return has(ls, new RegExp("^aaa authentication port-access " + meth + "$")); });
      var glob = p.lines.filter(function (l) { return l.indent === 0 && l.text === "aaa authentication port-access " + meth; })[0];
      if (on.length && (!glob || !kidsOf(glob).some(function (k) { return k.text === "enable"; }))) add({ sev: "warn", kind: "practice", title: (meth === "mac-auth" ? "MAC auth" : "802.1X") + " is on the ports but not switched on globally", why: "Port-access needs enable in both places: the global block and each port. With one missing nothing authenticates.", fix: ["aaa authentication port-access " + meth, "    radius server-group <GROUP>", "    enable"] });
    });
    var noEdge = accessPorts.filter(function (pn) { return !has(m.ports[pn].lines, /^spanning-tree port-type admin-edge$/); });
    if (noEdge.length) add({ sev: "info", kind: "practice", title: "Access ports without admin-edge: " + span(noEdge), why: "An edge port forwards at once instead of waiting through spanning tree, which is what a laptop's DHCP timer wants.", fix: ["interface " + span(noEdge), "    spanning-tree port-type admin-edge"] });
    var noLoop = accessPorts.filter(function (pn) { return !has(m.ports[pn].lines, /^loop-protect$/); });
    if (noLoop.length && accessPorts.length) add({ sev: "info", kind: "practice", title: "No loop-protect on " + span(noLoop), why: "BPDU guard misses a loop through an unmanaged switch that drops BPDUs. Loop-protect catches it.", fix: ["interface " + span(noLoop), "    loop-protect"] });
    if (!anyTop(p, /^logging \S+/)) add({ sev: "warn", kind: "practice", title: "No syslog server", why: "When something happens at 2 a.m. the switch's own log has rolled over by morning.", fix: ["logging 192.0.2.40 vrf mgmt"] });
    var trunksNoDesc = trunkPorts.filter(function (pn) { return !has(m.ports[pn].lines, /^description /); });
    if (trunksNoDesc.length) add({ sev: "info", kind: "practice", title: "Trunks without a description: " + span(trunksNoDesc), why: "Uplinks are the ports people need to find in a hurry. Say what is on the other end.", fix: ["interface " + trunksNoDesc[0], "    description uplink to <NEIGHBOUR>"] });

    // hardening, CIS HPE Aruba Networking CX Switch benchmark by control number
    function cis(id, sev, title, why, fix, line) { add({ sev: sev, kind: "hardening", cis: id, title: title, why: why, fix: fix, line: line ? line.n : undefined, text: line ? line.text : undefined }); }
    if (!anyTop(p, /^password complexity$/)) cis("1.1.3", "warn", "No password complexity policy", "Local passwords can be anything. Set minimum length, character classes and history, then enable it.", ["password complexity", "    minimum-length 14", "    lowercase-count 1", "    uppercase-count 1", "    numeric-count 1", "    special-char-count 1", "    history-count 5", "    enable"]);
    if (p.exportDefault) cis("1.1.4", "warn", "Factory export password", "The config says export-password: default, so exported secrets decrypt on any CX switch. service export-password asks for your own.", ["service export-password"]);
    var cli = p.lines.filter(function (l) { return l.indent === 0 && l.text === "cli-session"; })[0], tmo = cli && kidsOf(cli).map(function (k) { return /^timeout (\d+)$/.exec(k.text); }).filter(Boolean)[0];
    if (!cli || !tmo || +tmo[1] > 15 || +tmo[1] === 0) cis("1.1.8", "warn", "Idle CLI sessions are not closed within 15 minutes", "The benchmark wants idle SSH and console sessions ended in 15 minutes or less, and this config does not set it. It also limits sessions per user; set that to your policy.", ["cli-session", "    timeout 15"], cli);
    p.lines.filter(function (l) { return l.indent === 0 && /^telnet server vrf \S+$/.test(l.text); }).forEach(function (l) { cis("1.1.9", "warn", "Telnet is on", "Telnet sends the password in clear. SSH only.", ["no " + l.text], l); });
    if (!anyTop(p, /^ssh server allow-list$/)) cis("1.2.2", "warn", "SSH answers anyone", "No allow-list, so any address that can reach the switch can try passwords. List the management subnets.", ["ssh server allow-list", "    ip 192.0.2.0/24", "    enable"]);
    if (!anyTop(p, /^ssh ciphers /)) cis("1.2.4", "info", "SSH algorithms are the defaults", "The defaults keep older algorithms for compatibility. Pin the ones your policy approves.", ["ssh ciphers aes256-gcm@openssh.com aes128-gcm@openssh.com aes256-ctr aes128-ctr", "ssh macs hmac-sha2-512-etm@openssh.com hmac-sha2-256-etm@openssh.com hmac-sha2-512 hmac-sha2-256"]);
    var ntpServers = p.lines.filter(function (l) { return l.indent === 0 && /^ntp server /.test(l.text); });
    if (ntpServers.length && !anyTop(p, /^ntp authentication$/)) cis("1.3.1", "warn", "NTP is not authenticated", "The switch believes whatever answers on UDP 123. Logs, certificates and 802.1X all care what time it is.", ["ntp authentication", "ntp authentication-key 1 sha1 <NTP-KEY>", "ntp server 192.0.2.30 key-id 1 iburst"]);
    if (ntpServers.length < 2 || !anyTop(p, /^ntp enable$/)) cis("1.3.2", "warn", ntpServers.length ? (anyTop(p, /^ntp enable$/) ? "One NTP server" : "NTP is not enabled") : "No NTP servers", "Two or more servers, and ntp enable, so time survives one of them going away.", ["ntp server 192.0.2.30 iburst", "ntp server 192.0.2.31 iburst", "ntp enable"]);
    p.lines.filter(function (l) { return /^snmp-server community (public|private)$/.test(l.text); }).forEach(function (l) { cis("1.4.1.1", "warn", "Default SNMP community", "public and private are the first two words every scanner tries. Use SNMPv3, or a long community limited by an access list.", ["no " + l.text], l); });
    if (!anyTop(p, /^aaa authorization commands \S+ group .*local/)) cis("1.5.3.1", "info", "Command authorization is not set to local", "The benchmark wants the switch's own role-based rules to decide what each user may run.", ["aaa authorization commands ssh group local", "aaa authorization commands console group local"]);
    if (!anyTop(p, /^aaa accounting all-mgmt \S+ start-stop .*local/)) cis("1.5.4.1", "warn", "No local accounting", "What an admin did is kept on the switch too, so it survives the AAA server being down.", ["aaa accounting all-mgmt default start-stop local"]);
    p.lines.filter(function (l) { return /tftp:\/\//i.test(l.text) || /^tftp-server/.test(l.text); }).forEach(function (l) { cis("1.8.1.1", "warn", "TFTP in the config", "Files cross the network in clear. SCP or SFTP instead.", null, l); });
    p.lines.filter(function (l) { return l.indent === 0 && /^https-server vrf \S+$/.test(l.text); }).forEach(function (l) { cis("1.9.1", "info", "Web UI and REST are on in vrf " + l.text.split(" ")[2], "That is the default. If nobody manages the switch over HTTPS in this VRF, turn it off there.", ["no " + l.text], l); });
    if (p.lines.some(function (l) { return l.indent === 0 && /^https-server vrf /.test(l.text); }) && !anyTop(p, /^https-server session-timeout \d+$/)) cis("1.9.2", "info", "Web sessions time out after the default 20 minutes", "Shorter is better when only people use the web UI.", ["https-server session-timeout 5"]);
    if (!anyTop(p, /^system serviceos password-prompt$/)) cis("1.10.1", "warn", "ServiceOS has no password", "Anyone at the console can break into ServiceOS during boot, as admin, with no password.", ["system serviceos password-prompt"]);
    if (!anyTop(p, /^banner motd /)) cis("1.12", "warn", "No login banner", "A banner saying the switch is for authorized use only goes up before login.", ["banner motd ^", "Authorized use only. Activity on this switch is logged.", "^"]);
    if (!anyTop(p, /^job /) || !anyTop(p, /^schedule /)) cis("1.13", "info", "No scheduled config backup", "A job and a schedule that copy the running config off the switch, over SFTP or SCP, every day. Central backs it up too if the switch is managed.", null);
    if (!m.hostname || /^(switch|aruba|hpe)$/i.test(m.hostname)) cis("1.14", "warn", m.hostname ? "Default hostname" : "No hostname", "Logs, alerts and LLDP all show this name. Say where the switch is.", ["hostname idf2-sw1"]);
    var idle = portsWith(m, function (ls) { return !ls.length || isDefaultOnly(ls); });
    if (idle.length) cis("2.1.3", "info", "Ports enabled with nothing configured: " + span(idle), "If nothing is plugged into them, shut them. An open port in a meeting room is a network jack for anyone.", ["interface " + span(idle), "    shutdown"]);
    var noGuard = accessPorts.filter(function (pn) { return !has(m.ports[pn].lines, /^spanning-tree bpdu-guard$/); });
    if (noGuard.length) cis("4.2.1", "warn", "No BPDU guard on access ports " + span(noGuard), "A switch plugged into a desk port should shut that port, not join your spanning tree.", ["interface " + span(noGuard), "    spanning-tree bpdu-guard"]);
    var noRoot = accessPorts.filter(function (pn) { return !has(m.ports[pn].lines, /^spanning-tree root-guard$/); });
    if (noRoot.length) cis("4.2.2", "info", "No root guard on access ports " + span(noRoot), "Root guard stops a port from ever leading to the root bridge. Access ports never should.", ["interface " + span(noRoot), "    spanning-tree root-guard"]);
    if (!anyTop(p, /^user-group \S+$/)) cis("1.1.1", "info", "No custom user groups", "The benchmark wants a group for security staff that can read logs and do little else, and custom groups that allow only listed commands (1.1.7).", null);
    manual.push(
      { cis: "1.1.2", title: "Passwords and secrets typed at the masked prompt", how: "Enter them interactively (user admin password, radius-server host <ip> key) so they never sit in the command history. A config cannot show how they were typed." },
      { cis: "1.1.6", title: "A strong admin password", how: "The config only holds ciphertext. Change it with user admin password." },
      { cis: "1.2.6", title: "A strong SSH host key", how: "Regenerate with ssh host-key ecdsa ecdsa-sha2-nistp256 or ed25519; the key is not in the config." },
      { cis: "1.7.1", title: "Signed firmware only", how: "The switch checks HPE's signature at download and boot. Load images from HPE, check show version afterwards." },
      { cis: "2.1.2", title: "Front panel factory reset stays off", how: "That is the default; the config does not show it. Check it on the box." });

    F.sort(function (a, b) { return (SEV[a.sev] - SEV[b.sev]) || ((a.line || 1e9) - (b.line || 1e9)); });
    var summary = { error: 0, warn: 0, info: 0 }; F.forEach(function (f) { summary[f.sev]++; });
    var unc = Object.keys(unchecked).map(function (k) { return { where: k, lines: unchecked[k] }; });
    return { release: release, detected: p.version || "", lines: p.lines.length, checked: checked, unchecked: unc, findings: F, manual: manual, summary: summary, hostname: m.hostname };
  }

  return { check: check, parse: parse };
});
