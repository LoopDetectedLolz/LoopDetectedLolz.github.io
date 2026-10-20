/* CX script builder: answers in, a paste-ready AOS-CX config out, one block at a time with why each block is
   there. Pure: no DOM, no network, so cxsimtest.js can hold every combination to two standards: every line is
   syntax the picked release takes (CXSim.syntax) and the sandbox engine accepts the lot when it is pasted in. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./engine.js"));
  else root.CXBuild = factory(root.CXSim);
})(typeof self !== "undefined" ? self : this, function (CXSim) {
  "use strict";

  var DEFAULTS = {
    model: "6200F-24", release: "", hostname: "idf2-sw1",
    features: { access: true, nac: true, phones: true, aps: true, uplink: true, ubt: false, mgmt: true, harden: true },
    access: { ports: "1/1/1-1/1/20", vlan: 10, vlanName: "STAFF" },
    nac: { servers: "192.0.2.10, 192.0.2.11", secret: "", group: "CLEARPASS", role: "EMPLOYEE", critRole: "CRITICAL", critVlan: 10, coa: true, macauth: true },
    phones: { vlan: 30, vlanName: "VOICE" },
    aps: { ports: "1/1/21-1/1/24", mgmtVlan: 99, mgmtName: "AP-MGMT", tagged: "10,30", match: "AP-515" },
    uplink: { lag: 1, ports: "1/1/27-1/1/28", native: 99, rateFast: true, desc: "uplink to core" },
    ubt: { zone: "CAMPUS", primary: "192.0.2.50", backup: "", clientVlan: 666, gwRole: "authenticated" },
    mgmt: { vlan: 99, ip: "192.0.2.21/24", gw: "192.0.2.1" },
    time: { ntp: "192.0.2.30, 192.0.2.31", syslog: "192.0.2.40" },
    harden: { allow: "192.0.2.0/24", banner: "Authorized use only. Activity on this switch is logged." }
  };

  // ── helpers ───────────────────────────────────────────────────────────────
  function isIp(t) { var p = String(t).split("."); return p.length === 4 && p.every(function (x) { return /^\d{1,3}$/.test(x) && +x <= 255; }); }
  function isPrefix(t) { var p = String(t).split("/"); return p.length === 2 && isIp(p[0]) && /^\d+$/.test(p[1]) && +p[1] <= 32; }
  function list(s) { return String(s || "").split(/[\s,]+/).filter(Boolean); }
  function word(s) { return /^[A-Za-z0-9_.-]{1,32}$/.test(String(s || "")); }
  function portsOf(modelId) {
    var m = CXSim.MODELS[modelId], out = [], n = 0; if (!m) return out;
    m.ports.forEach(function (g) { for (var i = 0; i < g[0]; i++) { n++; out.push({ name: "1/1/" + n, type: g[1], poe: !!g[2] }); } });
    return out;
  }
  function expand(spec, names) {
    var out = [], bad = [];
    String(spec || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (part) {
      var r = part.split("-");
      if (r.length === 1) { if (names.indexOf(part) >= 0) out.push(part); else bad.push(part); return; }
      var a = names.indexOf(r[0]), b = names.indexOf(r[1]);
      if (a < 0 || b < 0 || b < a) { bad.push(part); return; }
      for (var i = a; i <= b; i++) out.push(names[i]);
    });
    return { ports: out, bad: bad };
  }
  function span(ports, names) {
    var idx = ports.map(function (p) { return names.indexOf(p); }).sort(function (a, b) { return a - b; }), out = [], i = 0;
    while (i < idx.length) { var j = i; while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++; out.push(j > i ? names[idx[i]] + "-" + names[idx[j]] : names[idx[i]]); i = j + 1; }
    return out.join(",");
  }
  function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b || {}) o[k] = (a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) ? merge(a[k], b[k]) : b[k]; return o; }

  // ── the build ─────────────────────────────────────────────────────────────
  function build(input) {
    var A = merge(DEFAULTS, input || {}), F = A.features, problems = [], blocks = [];
    var rels = CXSim.releases(), release = rels.indexOf(A.release) >= 0 ? A.release : rels[rels.length - 1];
    var names = portsOf(A.model).map(function (p) { return p.name; });
    if (!names.length) problems.push("Pick a switch model.");
    function need(ok, msg) { if (!ok) problems.push(msg); return ok; }
    function vid(v, what) { v = +v; need(v >= 2 && v <= 4094, what + " must be a VLAN from 2 to 4094."); return v; }
    function portSet(spec, what) { var e = expand(spec, names); need(!e.bad.length, what + ": " + e.bad.join(", ") + " is not a port on a " + A.model + " (ports run 1/1/1 to " + names[names.length - 1] + ")."); need(e.ports.length > 0 || !String(spec).trim(), what + " needs at least one port."); return e.ports; }
    need(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/.test(A.hostname), "The hostname takes letters, digits, dots, dashes and underscores, up to 32.");

    // what each feature uses
    var vlans = {}, used = {};
    function vlan(id, name, extra) { if (!vlans[id]) vlans[id] = { name: name, voice: false }; if (extra && extra.voice) vlans[id].voice = true; }
    var acc = F.access ? portSet(A.access.ports, "Desk ports") : [], aps = F.aps ? portSet(A.aps.ports, "AP ports") : [], upl = F.uplink ? portSet(A.uplink.ports, "Uplink ports") : [];
    [[acc, "desk"], [aps, "AP"], [upl, "uplink"]].forEach(function (x, i, all) { all.slice(i + 1).forEach(function (y) { var both = x[0].filter(function (p) { return y[0].indexOf(p) >= 0; }); need(!both.length, both.join(", ") + " is both a " + x[1] + " port and an " + y[1] + " port."); }); });
    var dataV = F.access ? vid(A.access.vlan, "The desk VLAN") : 0, voiceV = F.phones ? vid(A.phones.vlan, "The voice VLAN") : 0, apV = F.aps ? vid(A.aps.mgmtVlan, "The AP management VLAN") : 0;
    if (F.access) { need(word(A.access.vlanName), "The desk VLAN name is one word."); vlan(dataV, A.access.vlanName); }
    if (F.phones) { need(F.access, "Phones sit on desk ports: turn on desk ports too."); need(word(A.phones.vlanName), "The voice VLAN name is one word."); need(voiceV !== dataV, "The voice VLAN has to differ from the desk VLAN."); vlan(voiceV, A.phones.vlanName, { voice: true }); }
    var apTagged = F.aps ? list(A.aps.tagged).map(Number).filter(function (v) { return v !== apV; }) : [];
    if (F.aps) { need(word(A.aps.mgmtName), "The AP VLAN name is one word."); need(word(A.aps.match), "The word to match in the AP's LLDP description is one word."); vlan(apV, A.aps.mgmtName); apTagged.forEach(function (v) { need(v >= 1 && v <= 4094, "AP tagged VLANs are numbers from 1 to 4094."); if (!vlans[v] && v !== 1) vlan(v, "VLAN" + v); }); }
    var servers = F.nac ? list(A.nac.servers) : [], secret = String(A.nac.secret || "").trim() || "CHANGE-ME";
    if (F.nac) {
      need(F.access, "802.1X runs on desk ports: turn on desk ports too.");
      need(servers.length >= 1 && servers.every(isIp), "ClearPass addresses are IPv4 addresses, comma separated.");
      need(!/\s/.test(secret), "The shared secret has no spaces.");
      need(word(A.nac.group) && word(A.nac.role) && word(A.nac.critRole), "Group and role names are one word each.");
      if (+A.nac.critVlan) vlan(vid(A.nac.critVlan, "The critical role's VLAN"), +A.nac.critVlan === dataV ? A.access.vlanName : "CRITICAL");
    }
    var ubtV = F.ubt ? vid(A.ubt.clientVlan, "The tunnel client VLAN") : 0;
    if (F.ubt) { need(F.nac, "Tunneling rides on a role ClearPass hands out: turn on 802.1X too."); need(isIp(A.ubt.primary) && (!A.ubt.backup || isIp(A.ubt.backup)), "Gateway addresses are IPv4 addresses."); need(word(A.ubt.zone) && word(A.ubt.gwRole), "Zone and gateway role are one word each."); vlan(ubtV, "UBT-CLIENT"); }
    var mgV = F.mgmt ? vid(A.mgmt.vlan, "The management VLAN") : 0;
    if (F.mgmt) { need(isPrefix(A.mgmt.ip), "The switch address is an address with a mask length, like 192.0.2.21/24."); need(isIp(A.mgmt.gw), "The default gateway is an IPv4 address."); if (!vlans[mgV]) vlan(mgV, "MGMT"); }
    var ntp = list(A.time.ntp).filter(Boolean), syslog = String(A.time.syslog || "").trim();
    need(ntp.every(isIp), "NTP servers are IPv4 addresses, comma separated."); need(!syslog || isIp(syslog), "The syslog server is an IPv4 address.");
    var upNative = F.uplink ? vid(A.uplink.native, "The uplink native VLAN") : 0;
    if (F.uplink) { need(+A.uplink.lag >= 1 && +A.uplink.lag <= 256, "The LAG number runs from 1 to 256."); need(upl.length >= 2, "A LAG wants at least two member ports."); if (!vlans[upNative]) vlan(upNative, "NATIVE"); }
    if (F.harden) need(!A.harden.allow || isPrefix(A.harden.allow) || isIp(A.harden.allow), "The SSH allow-list entry is an address or a prefix.");

    function block(id, title, why, lines, proof) { blocks.push({ id: id, title: title, why: why, lines: lines, proof: proof || [] }); }
    var vids = Object.keys(vlans).map(Number).sort(function (a, b) { return a - b; });

    block("hostname", "Name the switch", "The name shows in the prompt, in LLDP to the neighbors, and in every log line. Put the location in it.", ["hostname " + A.hostname], ["show system"]);
    var vl = []; vids.forEach(function (v) { vl.push("vlan " + v, "    name " + vlans[v].name); if (vlans[v].voice) vl.push("    voice"); vl.push("    exit"); });
    block("vlans", "VLANs first", "A port, a role or a trunk cannot use a VLAN that does not exist, so they come before anything that names them." + (F.phones ? " The voice VLAN is marked voice, which is what lets LLDP-MED hand it to phones." : ""), vl, ["show vlan"]);
    block("stp", "Spanning tree on", "MSTP, the default mode. Without it one patch cable looped between two wall ports takes a VLAN down.", ["spanning-tree"], ["show spanning-tree"]);
    var tl = []; ntp.forEach(function (s) { tl.push("ntp server " + s + " iburst"); }); if (ntp.length) tl.push("ntp enable"); if (syslog) tl.push("logging " + syslog);
    if (tl.length) block("time", "Time and logs", "Logs, certificates and 802.1X all care what time it is, so two NTP servers. A syslog server keeps the story after the switch's own log has rolled over.", tl, ["show ntp status", "show logging"]);

    if (F.nac) {
      var rl = [];
      servers.forEach(function (s) { rl.push("radius-server host " + s + " key plaintext " + secret); });
      rl.push("aaa group server radius " + A.nac.group); servers.forEach(function (s) { rl.push("    server " + s); }); rl.push("    exit");
      if (A.nac.coa) { rl.push("radius dyn-authorization enable"); servers.forEach(function (s) { rl.push("radius dyn-authorization client " + s + " secret-key plaintext " + secret); }); }
      block("radius", "Point the switch at ClearPass", "Each ClearPass node with its shared secret, then a group that holds them: port access points at the group, never at a server." + (servers.length < 2 ? " One server is a single point of failure for every port; add the second node before go-live." : "") + (A.nac.coa ? " dyn-authorization lets ClearPass change or end a session later (CoA); on 10.18 each node needs its own client line or its requests are dropped." : "") + (secret === "CHANGE-ME" ? " Replace CHANGE-ME with the shared secret before pasting. The running config will show it as ciphertext." : ""), rl, ["show radius-server", "show aaa server-groups"]);
      var gl = ["aaa authentication port-access dot1x authenticator", "    radius server-group " + A.nac.group, "    enable", "    exit"];
      if (A.nac.macauth) gl.push("aaa authentication port-access mac-auth", "    radius server-group " + A.nac.group, "    enable", "    exit");
      block("pa-global", "Switch port access on", "802.1X" + (A.nac.macauth ? " and MAC authentication" : "") + " each need enable twice: once here for the switch, and once on every port. With either missing nothing authenticates.", gl, ["show aaa authentication port-access interface all client-status"]);
    }

    var roles = [];
    if (F.nac) {
      roles.push("port-access role " + A.nac.role, "    vlan access " + dataV);
      if (F.ubt) roles.push("    gateway-zone zone " + A.ubt.zone + " gateway-role " + A.ubt.gwRole);
      roles.push("    exit");
      if (+A.nac.critVlan) roles.push("port-access role " + A.nac.critRole, "    vlan access " + (+A.nac.critVlan), "    exit");
    }
    if (F.phones) roles.push("port-access role " + "VOICE", "    device-traffic-class voice", "    vlan trunk native " + dataV, "    vlan trunk allowed " + voiceV, "    exit");
    if (F.aps) roles.push("port-access role AP-TRUNK", "    vlan trunk native " + apV, "    vlan trunk allowed " + [apV].concat(apTagged).sort(function (a, b) { return a - b; }).join(","), "    exit");
    if (roles.length) block("roles", "Roles: what a device gets once it is in", "A role is a VLAN setup the switch hands out. " + (F.nac ? A.nac.role + " is what ClearPass names for staff (Aruba-User-Role); the switch must have it or the client fails authorization. " + (+A.nac.critVlan ? A.nac.critRole + " is where clients go when every RADIUS server stops answering. " : "") : "") + (F.phones ? "The phone role is the voice device on a multi-domain port: data native, voice tagged. " : "") + (F.aps ? "AP-TRUNK turns an AP port into a trunk: management untagged, the SSID VLANs tagged. " : "") + (F.ubt ? "gateway-zone sends that role's traffic through the tunnel to the gateway cluster." : ""), roles, ["show port-access role"]);

    var dp = [];
    if (F.phones) dp.push("port-access lldp-group LLDP-MED-ENDPOINTS", "    seq 10 match vendor-oui 0012bb type 1", "    exit", "port-access device-profile PHONES", "    associate lldp-group LLDP-MED-ENDPOINTS", "    associate role " + "VOICE", "    enable", "    exit");
    if (F.aps) dp.push("port-access lldp-group APS", "    seq 10 match sys-desc " + A.aps.match, "    exit", "port-access device-profile APS", "    associate lldp-group APS", "    associate role AP-TRUNK", "    enable", "    exit");
    if (dp.length) block("profiles", "Recognize phones and APs by what they say on LLDP", (F.phones ? "Every LLDP-MED device sends the TIA's OUI, 0012bb, in its capabilities TLV, so that one rule catches phones of any brand. " : "") + (F.aps ? "APs are matched on a word in their LLDP system description: sys-desc matches when the description contains it. Check yours with show lldp neighbor-info on an AP port before you trust " + A.aps.match + ". " : "") + "A profile gives the matched device its role without ClearPass knowing it.", dp, ["show port-access device-profile", "show lldp neighbor-info"]);

    if (F.ubt) block("ubt", "Tunnels to the gateways", "The zone names the gateway cluster; ubt-client-vlan is the VLAN tunneled clients use on the switch. Keep that VLAN for this and nothing else.", ["ubt-client-vlan " + ubtV, "ubt zone " + A.ubt.zone + " vrf default", "    primary-controller ip " + A.ubt.primary].concat(A.ubt.backup ? ["    backup-controller ip " + A.ubt.backup] : []).concat(["    enable", "    exit"]), ["show ubt", "show ubt users all"]);

    if (F.uplink) {
      var allowed = vids.slice();
      var ul = ["interface lag " + (+A.uplink.lag), "    no shutdown", "    description " + (A.uplink.desc || "uplink"), "    no routing", "    vlan trunk native " + upNative, "    vlan trunk allowed " + allowed.join(","), "    lacp mode active"];
      if (A.uplink.rateFast) ul.push("    lacp rate fast");
      ul.push("    exit", "interface " + span(upl, names), "    no shutdown", "    lag " + (+A.uplink.lag), "    exit");
      block("uplink", "The uplink, as a LAG", "Build the LAG first, then put the ports in it: VLAN settings live on the LAG. A new LAG is shut on 10.18 until no shutdown. lacp mode active means both ends check each other before a member carries traffic" + (A.uplink.rateFast ? ", and rate fast notices a dead member in about three seconds" : "") + ". The trunk carries every VLAN this switch uses, no more.", ul, ["show lacp interfaces", "show lacp aggregates", "show interface brief"]);
    }

    if (F.access) {
      var pl = ["interface " + span(acc, names), "    no shutdown", "    no routing", "    vlan access " + dataV];
      if (F.phones) pl.push("    aaa authentication port-access auth-mode multi-domain", "    aaa authentication port-access allow-lldp-bpdu");
      if (F.nac) {
        pl.push("    aaa authentication port-access dot1x authenticator", "        enable", "        exit");
        if (A.nac.macauth) pl.push("    aaa authentication port-access mac-auth", "        enable", "        exit");
        if (+A.nac.critVlan) pl.push("    aaa authentication port-access critical-role " + A.nac.critRole);
      }
      pl.push("    spanning-tree port-type admin-edge", "    spanning-tree bpdu-guard", "    loop-protect", "    exit");
      block("desk", "Desk ports", "Access ports in VLAN " + dataV + "." + (F.nac ? " 802.1X first, MAC auth for what has no supplicant" + (+A.nac.critVlan ? ", and the critical role when ClearPass is unreachable" : "") + "." : "") + (F.phones ? " Multi-domain takes one phone and one PC; allow-lldp-bpdu lets the phone's LLDP in before it authenticates, which the phone profile needs." : "") + " admin-edge forwards at once for a laptop's DHCP timer, BPDU guard shuts the port if a switch appears, and loop-protect catches a loop through one that swallows BPDUs.", pl, F.nac ? ["show port-access clients", "show interface brief"] : ["show interface brief"]);
    }
    if (F.aps) block("aps", "AP ports", "Plain access in the AP management VLAN until LLDP says an AP is there; then the APS profile turns the port into the AP-TRUNK trunk. An AP that has not been recognized can still reach its controller.", ["interface " + span(aps, names), "    no shutdown", "    description access point", "    no routing", "    vlan access " + apV, "    spanning-tree port-type admin-edge", "    spanning-tree bpdu-guard", "    exit"], ["show port-access clients onboarding-method device-profile", "show lldp neighbor-info"]);

    if (F.mgmt) block("mgmt", "An address to manage it by", "The switch's own address in VLAN " + mgV + ", a default route, and SSH in the default VRF. The SVI comes up when any port in the VLAN is up.", ["interface vlan " + mgV, "    ip address " + A.mgmt.ip, "    exit", "ip route 0.0.0.0/0 " + A.mgmt.gw, "ssh server vrf default"], ["show ip interface brief", "show ip route"]);

    if (F.harden) {
      var hl = ["password complexity", "    minimum-length 14", "    lowercase-count 1", "    uppercase-count 1", "    numeric-count 1", "    special-char-count 1", "    history-count 5", "    enable", "    exit",
        "cli-session", "    timeout 15", "    exit"];
      if (A.harden.allow) hl.push("ssh server allow-list", "    " + (isPrefix(A.harden.allow) ? "ip " + A.harden.allow : "ip " + A.harden.allow), "    enable", "    exit");
      hl.push("ssh ciphers aes256-gcm@openssh.com aes128-gcm@openssh.com aes256-ctr aes128-ctr", "ssh macs hmac-sha2-512-etm@openssh.com hmac-sha2-256-etm@openssh.com hmac-sha2-512 hmac-sha2-256",
        "aaa accounting all-mgmt default start-stop local", "system serviceos password-prompt", "https-server session-timeout 5");
      if (A.harden.banner) hl.push("banner motd ^", String(A.harden.banner).replace(/\^/g, ""), "^");
      block("harden", "Harden it", "Mapped to the CIS benchmark for CX switches by control number: password rules (1.1.3), idle CLI sessions closed at 15 minutes (1.1.8), SSH only from the management subnet (1.2.2) with the algorithms pinned (1.2.4), local accounting (1.5.4.1), a ServiceOS password (1.10.1), shorter web sessions (1.9.2) and a login banner (1.12). Still to do by hand: service export-password (1.1.4), the admin password at the masked prompt (1.1.6), and NTP authentication (1.3.1), which needs the key your NTP servers use.", hl, ["show running-config | include ssh", "show ssh server"]);
    }

    var lines = []; blocks.forEach(function (b) { lines = lines.concat(b.lines); });
    return { release: release, model: A.model, answers: A, blocks: blocks, lines: lines, config: lines.join("\n") + "\n", problems: problems };
  }

  // Hold a build to the two standards: the release's command set takes every line (lines in contexts the command
  // lists do not cover are counted, not judged), and the sandbox engine takes the lot pasted into a fresh switch.
  function verify(b) {
    var out = { syntaxOk: 0, syntaxBad: [], notChecked: 0, engineBad: [], engineScope: 0 };
    var CK = typeof module === "object" && module.exports ? require("./checker.js") : (typeof self !== "undefined" ? self.CXCheck : null);
    if (CK) CK.parse(b.config).lines.forEach(function (ln) {
      if (!ln.ctx) { out.notChecked++; return; }
      var r = CXSim.syntax(ln.ctx, ln.text, b.release);
      if (!r) out.notChecked++; else if (r.state === "full") out.syntaxOk++; else out.syntaxBad.push(ln.text + " -> " + r.error);
    });
    var sim = CXSim.create({ id: "builder", model: b.model, release: b.release }), inBanner = "", skipDeeper = -1;
    sim.exec("configure terminal");
    b.lines.forEach(function (l) {
      var t = l.trim(), indent = l.length - l.replace(/^ +/, "").length;
      if (inBanner) { if (t.indexOf(inBanner) >= 0) inBanner = ""; return; }
      // a block the sandbox does not model (password complexity, cli-session, ssh allow-list): its lines go with it
      if (skipDeeper >= 0) { if (indent > skipDeeper) { out.engineScope++; return; } skipDeeper = -1; }
      var bm = /^banner (motd|exec) (\S)$/.exec(t); if (bm) inBanner = bm[2];
      var r = sim.exec(t), o = String(r.out || "");
      if (/^This command is not used in this scenario/.test(o)) { out.engineScope++; skipDeeper = indent; }
      else if (/^(Invalid input|% |Command not supported|Error)/.test(o) || / does not exist| is not defined|first\.$/.test(o)) out.engineBad.push(t + " -> " + o.split("\n")[0]);
    });
    out.sim = sim;
    return out;
  }

  return { DEFAULTS: DEFAULTS, build: build, verify: verify, portsOf: portsOf };
});
