// node progresstest.js
// The Academy progress core (theme/progress-core.js) and the save-code words (comments/words.js):
// merge laws on random records, validation, code shape, the size cap, and the word list's rules.
"use strict";
const C = require("./theme/progress-core.js");
const WORDS = require("./comments/words.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.log("FAIL  " + name + "\n      " + (e && e.message || e)); }
}
function eq(a, b, msg) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((msg || "not equal") + "\n      got      " + x + "\n      expected " + y);
}
function ok(v, msg) { if (!v) throw new Error(msg || "expected true"); }

// seeded, so a failure is the same failure next time
let seed = 0x2f6e2b1;
function rnd() { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; }
const pick = a => a[Math.floor(rnd() * a.length)];
const pad = n => String(n).padStart(2, "0");
const rdate = () => "2026-" + pad(1 + Math.floor(rnd() * 12)) + "-" + pad(1 + Math.floor(rnd() * 28));
const rts = () => rdate() + "T" + pad(Math.floor(rnd() * 24)) + ":" + pad(Math.floor(rnd() * 60)) + ":00.000Z";
const SLUGS = ["pmf-broke-the-printers", "academy-10-capacity-not-coverage", "mdns-bridge-mode-airtime", "wifi-takes-turns"];
const LABS = ["nac-01-bench", "nac-03-mac-auth", "sc-06-lacp", "l2-01-uplink", "sandbox"];

function rprog() {
  const p = { v: 1, w: {}, labs: {}, seen: {} };
  for (let i = Math.floor(rnd() * 6); i > 0; i--) {
    const l = {};
    if (rnd() < 0.6) l.read = rdate();
    if (rnd() < 0.4) l.lab = rdate();
    if (rnd() < 0.3) l.game = rdate();
    if (rnd() < 0.5) l.check = [rnd() < 0.5 ? 1 : 0, rnd() < 0.5 ? 1 : 0, rnd() < 0.5 ? 1 : 0];
    p.w[String(1 + Math.floor(rnd() * 12))] = l;
  }
  for (let i = Math.floor(rnd() * 3); i > 0; i--) p.labs[pick(LABS)] = rdate();
  for (let i = Math.floor(rnd() * 3); i > 0; i--) p.seen[String(1 + Math.floor(rnd() * 50))] = rts();
  if (rnd() < 0.7) { p.p = {}; for (let i = Math.floor(rnd() * 4); i > 0; i--) p.p[pick(SLUGS)] = rdate(); }
  if (rnd() < 0.2) p.p = Object.assign(p.p || {}, { "Bad Slug": rdate(), "wifi-takes-turns-x": "soon" });
  // junk the validator has to drop
  if (rnd() < 0.2) p.extra = { x: 1 };
  if (rnd() < 0.2) p.w["0"] = { read: rdate() };
  if (rnd() < 0.2) p.labs["Not An Id"] = rdate();
  if (rnd() < 0.2) p.seen["7"] = "yesterday";
  if (rnd() < 0.2) p.w["3"] = { read: "last week", check: "yes" };
  return p;
}

const N = 600;
t("merge is commutative", () => { for (let i = 0; i < N; i++) { const a = rprog(), b = rprog(); eq(C.merge(a, b), C.merge(b, a)); } });
t("merge is associative", () => { for (let i = 0; i < N; i++) { const a = rprog(), b = rprog(), c = rprog(); eq(C.merge(C.merge(a, b), c), C.merge(a, C.merge(b, c))); } });
t("merge is idempotent", () => { for (let i = 0; i < N; i++) { const a = rprog(); eq(C.merge(a, a), C.validate(a)); } });
t("an empty record changes nothing", () => { for (let i = 0; i < N; i++) { const a = rprog(); eq(C.merge(a, C.emptyProgress()), C.validate(a)); } });
t("merge output is already valid", () => { for (let i = 0; i < N; i++) { const m = C.merge(rprog(), rprog()); eq(C.validate(m), m); } });
t("merge never loses anything either side had", () => {
  for (let i = 0; i < N; i++) {
    const a = C.validate(rprog()), b = C.validate(rprog()), m = C.merge(a, b);
    [a, b].forEach(x => {
      Object.keys(x.w).forEach(k => ["read", "lab", "game"].forEach(f => { if (x.w[k][f]) ok(m.w[k][f] && m.w[k][f] <= x.w[k][f], "lost lesson " + k + " " + f); }));
      Object.keys(x.labs).forEach(k => ok(m.labs[k] && m.labs[k] <= x.labs[k], "lost lab " + k));
      Object.keys(x.seen).forEach(k => ok(m.seen[k] && m.seen[k] >= x.seen[k], "lost seen " + k));
      Object.keys(x.p).forEach(k => ok(m.p[k] && m.p[k] >= x.p[k], "lost post " + k));
    });
  }
});
t("dates keep the earliest, checks OR, seen keeps the latest", () => {
  const a = { w: { "2": { read: "2026-09-20", check: [1, 0, 0] } }, labs: { "sc-06-lacp": "2026-09-22" }, seen: { "9": "2026-09-01T10:00:00.000Z" } };
  const b = { w: { "2": { read: "2026-09-18", lab: "2026-09-25", check: [0, 0, 1] } }, labs: { "sc-06-lacp": "2026-09-21" }, seen: { "9": "2026-09-03T10:00:00.000Z" } };
  eq(C.merge(a, b), { labs: { "sc-06-lacp": "2026-09-21" }, p: {}, seen: { "9": "2026-09-03T10:00:00.000Z" }, v: 1,
    w: { "2": { check: [1, 0, 1], lab: "2026-09-25", read: "2026-09-18" } } });
});
t("validate drops junk and never throws", () => {
  [null, undefined, 5, "x", [], [1, 2], { w: null }, { w: [] }, { w: { "1": "read" } }, { labs: [1] }, { seen: { "a": "b" } },
   { w: { "99": { read: "2026-01-01" } } }, { w: { "1": { check: [0, 0, 0] } } }, JSON.parse('{"__proto__":{"x":1}}')]
    .forEach(x => eq(C.validate(x), C.emptyProgress()));
  eq(C.validate({ w: { "1": { read: "2026-09-10", nope: 1 } }, v: 7 }), { labs: {}, p: {}, seen: {}, v: 1, w: { "1": { read: "2026-09-10" } } });
});
t("a heavy record still fits under the cap", () => {
  const p = { w: {}, labs: {}, seen: {} };
  for (let i = 1; i <= 12; i++) p.w[i] = { read: "2026-09-10", lab: "2026-09-11", game: "2026-09-12", check: [1, 1, 1] };
  for (let i = 0; i < 19; i++) p.labs["sc-" + pad(i) + "-a-long-lab-name"] = "2026-09-13";
  for (let i = 1; i <= 200; i++) p.seen[String(1000 + i)] = "2026-09-14T10:00:00.000Z";
  p.p = {}; for (let i = 1; i <= 120; i++) p.p["a-post-slug-of-typical-length-" + i + "-x"] = "2026-09-15";
  const n = C.serialise(p).length;
  ok(n < C.MAX_BYTES, "a heavy record is " + n + " bytes");
});
t("codes normalise the way people type them", () => {
  eq(C.normaliseCode("Yagi Beacon, fresnel lobe"), "yagi-beacon-fresnel-lobe");
  eq(C.normaliseCode("  yagi--beacon  fresnel.lobe "), "yagi-beacon-fresnel-lobe");
  eq(C.normaliseCode(null), "");
  ok(C.isCodeShape("yagi-beacon-fresnel-lobe"));
  ok(!C.isCodeShape("yagi-beacon-fresnel"), "three words");
  ok(!C.isCodeShape("yagi-beacon-fresnel-lobe-mast"), "five words");
  ok(!C.isCodeShape("yagi-beacon-fresnel-lobe1"), "digit");
  ok(!C.isCodeShape("ab-beacon-fresnel-lobe"), "two letters");
  ok(!C.isCodeShape("Yagi-beacon-fresnel-lobe"), "capital");
});
t("progress card helpers", () => {
  const p = C.validate({ w: { "1": { read: "2026-09-10", check: [1, 0, 1] }, "3": { lab: "2026-09-11" } }, labs: { "nac-01-bench": "2026-09-12" } });
  eq(C.lessonState(p, 1), { read: "2026-09-10", lab: "", game: "", checks: 2 });
  eq(C.readCount(p), 1);
  eq(C.labCount(p, ["nac-01-bench", "sc-06-lacp"]), 1);
});

t("post marks keep the latest, and a change after the mark flags", () => {
  const a = { p: { "pmf-broke-the-printers": "2026-09-20" } }, b = { p: { "pmf-broke-the-printers": "2026-09-28" } };
  eq(C.merge(a, b).p, { "pmf-broke-the-printers": "2026-09-28" });
  const r = C.validate({ p: { "wifi-takes-turns": "2026-09-10" }, w: { "10": { read: "2026-09-12" } } });
  eq(C.postRead(r, "wifi-takes-turns", 0), "2026-09-10");
  eq(C.postRead(r, "academy-10-capacity-not-coverage", 10), "2026-09-12");
  ok(C.changedSince(r, "wifi-takes-turns", 0, "2026-09-29"), "changed after the mark");
  ok(!C.changedSince(r, "wifi-takes-turns", 0, "2026-09-10"), "changed the day it was marked");
  ok(!C.changedSince(r, "never-read", 0, "2026-09-29"), "never marked read, no flag");
  ok(!C.changedSince(r, "wifi-takes-turns", 0, ""), "no change noted");
  ok(!C.changedSince(C.merge(r, { p: { "wifi-takes-turns": "2026-09-30" } }), "wifi-takes-turns", 0, "2026-09-29"), "update marked read");
});
t("the post map is capped and junk is dropped first", () => {
  const p = { p: { "BAD": "2026-09-01" } };
  for (let i = 0; i < 500; i++) p.p["post-" + String(i).padStart(3, "0")] = "2026-09-01";
  const v = C.validate(p);
  eq(Object.keys(v.p).length, 120);
  ok(!v.p.BAD && v.p["post-000"], "kept the first 120 valid slugs");
});

// the word list
const SET = new Set(WORDS);
t("1,024 unique words", () => { eq(WORDS.length, 1024); eq(SET.size, 1024); });
t("every word is 3 to 8 lowercase letters", () => { const bad = WORDS.filter(w => !/^[a-z]{3,8}$/.test(w)); eq(bad, []); });
t("no plural or tense pairs", () => {
  const bad = WORDS.filter(w => ["s", "es", "d", "ed", "r", "er", "ing"].some(e => SET.has(w + e)));
  eq(bad, []);
});
t("no two words one letter apart", () => {
  function one(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a.length === b.length) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d === 1; }
    if (a.length > b.length) [a, b] = [b, a];
    for (let i = 0; i < b.length; i++) if (b.slice(0, i) + b.slice(i + 1) === a) return true;
    return false;
  }
  const bad = [];
  for (let i = 0; i < WORDS.length; i++) for (let j = i + 1; j < WORDS.length; j++) if (one(WORDS[i], WORDS[j])) bad.push(WORDS[i] + "/" + WORDS[j]);
  eq(bad, []);
});
t("a code drawn the way the Worker draws one has the right shape", () => {
  for (let i = 0; i < 200; i++) {
    const idx = Array.from({ length: 4 }, () => Math.floor(rnd() * 65536) & 1023);
    ok(C.isCodeShape(idx.map(k => WORDS[k]).join("-")));
  }
});

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
