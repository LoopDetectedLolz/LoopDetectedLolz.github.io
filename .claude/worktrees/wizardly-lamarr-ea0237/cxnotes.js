#!/usr/bin/env node
/* CX Sandbox command notes: theme/cxsim/notes.json is the source, this keeps it honest.
   `node cxnotes.js`          runs every example through the engine and checks each note's `rel`
                              (the releases whose command set takes the command) against the corpus; exit 1 if
                              an example is refused or a `rel` is stale.
   `node cxnotes.js --write`  recomputes `rel` for every note and writes notes.json back.
   cxsimtest.js requires this file and runs the same checks. After cxcorpus.py regenerates the corpus, run
   --write and read the diff: a release that gained or lost a command shows up here first. */
var fs = require("fs"), path = require("path");
var CX = require("./theme/cxsim/engine.js");
var FILE = path.join(__dirname, "theme", "cxsim", "notes.json");
var SANDBOX = JSON.parse(fs.readFileSync(path.join(__dirname, "theme", "cxsim", "lessons", "sandbox.json"), "utf8"));

// what every example may assume already exists: the VLANs, the RADIUS group and the roles the examples name
var PRE = ["vlan 10", "name STAFF", "vlan 20", "name PRINTERS", "vlan 30", "name VOICE", "voice", "vlan 99", "name AP-MGMT", "vlan 100", "name TRANSIT", "exit",
  "radius-server host 192.0.2.10 key plaintext cppm-lab-key", "aaa group server radius CLEARPASS", "server 192.0.2.10", "exit",
  "port-access role EMPLOYEE", "vlan access 10", "exit", "port-access role QUARANTINE", "vlan access 99", "exit", "port-access role GUEST", "vlan access 20", "exit",
  "port-access role VOICE", "device-traffic-class voice", "vlan trunk native 10", "vlan trunk allowed 30", "exit",
  "port-access role AP-TRUNK", "vlan trunk native 99", "vlan trunk allowed 10,20,99", "exit", "port-access role PBT-IOT", "vlan access 20", "exit",
  "port-access lldp-group APS", "match sys-desc AP-515", "exit"];
var REFUSED = /^(Invalid input|% |This command is not used|Command not supported|Error|\(sandbox\))/;

function bench(note) {
  var les = JSON.parse(JSON.stringify(SANDBOX)); if (note.m) les.model = note.m;
  var sim = CX.create(les);
  ["configure terminal"].concat(PRE, ["end"]).forEach(function (l) { sim.exec(l); });
  if (note.c !== "exec" && note.c !== "*") sim.exec("configure terminal");
  return sim;
}
function run(sim, line) { var r = sim.exec(line); if (sim.sw.pending) r = sim.exec("y"); return r; }

// every example line, run the way a reader would type it; returns the refusals
function examples(notes) {
  var bad = [];
  notes.forEach(function (n) {
    n.ex.forEach(function (ex, i) {
      var sim = bench(n);
      ex.forEach(function (line) {
        var out = String(run(sim, line).out), first = out.split("\n").filter(Boolean)[0] || "";
        if (REFUSED.test(out) || /^HTTP\/1\.1 [45]/.test(first)) bad.push(n.k + " example " + (i + 1) + ": " + line + " -> " + first);
      });
    });
  });
  return bad;
}

// The releases whose command set takes a note's command: the first example line that starts with the key's
// words, asked of the corpus once per release in the context the example builds. Sandbox commands say so.
function relOf(n) {
  if (/^sim /.test(n.k)) return "sandbox";
  var lit = [];
  n.k.split(" ").some(function (t) { if (t[0] === "<") return true; lit.push(t.toLowerCase()); });
  for (var i = 0; i < n.ex.length; i++) {
    for (var j = 0; j < n.ex[i].length; j++) {
      var toks = n.ex[i][j].split(/\s+/);
      if (toks.length < lit.length || !lit.every(function (w, k) { return toks[k].toLowerCase() === w; })) continue;
      var sim = bench(n);
      for (var p = 0; p < j; p++) run(sim, n.ex[i][p]);
      return CX.releases().filter(function (r) { var x = sim.sw.realLookup(toks, r); return !!x && x.state === "full"; });
    }
  }
  return null;
}
function stale(notes) {
  var bad = [];
  notes.forEach(function (n) {
    var want = relOf(n);
    if (want === null) bad.push(n.k + ": no example line starts with the command");
    else if (JSON.stringify(want) !== JSON.stringify(n.rel)) bad.push(n.k + ": rel is " + JSON.stringify(n.rel) + ", the corpus says " + JSON.stringify(want));
  });
  return bad;
}

module.exports = { FILE: FILE, examples: examples, stale: stale, relOf: relOf };

if (require.main === module) {
  var doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (process.argv.indexOf("--write") >= 0) {
    doc.notes.forEach(function (n) { var r = relOf(n); if (r !== null) n.rel = r; });
    fs.writeFileSync(FILE, JSON.stringify(doc, null, 1) + "\n");
    console.log("rel written for " + doc.notes.length + " notes");
  }
  var bad = examples(doc.notes).concat(stale(doc.notes));
  bad.forEach(function (b) { console.log("  " + b); });
  console.log(doc.notes.length + " notes, " + doc.notes.reduce(function (a, n) { return a + n.ex.length; }, 0) + " examples, " + bad.length + " problems");
  process.exit(bad.length ? 1 : 0);
}
