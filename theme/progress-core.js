/* Network Field Notes: the Academy progress core.
 *
 * Pure functions: no DOM, no storage, no network. theme/progress.js uses it in the page,
 * comments/worker.js uses it on the server, progresstest.js tests it. The page and the Worker run
 * the same merge, so a push from any device lands the same way whatever order it arrives in.
 *
 * A progress record:
 *   { "v": 1,
 *     "w":    { "<lesson number>": { "read": "YYYY-MM-DD", "lab": "...", "game": "...", "check": [0|1, 0|1, 0|1] } },
 *     "labs": { "<CX Sandbox lab id>": "YYYY-MM-DD" },
 *     "seen": { "<question id>": "<ISO time the reader last saw that question's answers>" } }
 *
 * Merge rules: dates keep the earliest, checks OR together, seen keeps the latest, anything else is
 * dropped. That makes merge commutative, associative and idempotent, which progresstest.js proves.
 * Nothing can be un-done by a merge, so the page never offers an undo that would not stick.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) root.NFNProgressCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var V = 1;
  var MAX_BYTES = 16384;            // the Worker refuses a record bigger than this
  var MAX_LESSON = 60;              // room for a second track's numbering later
  var CHECKS = 3;                   // every lesson ends with three questions
  var FIELDS = ["read", "lab", "game"];
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
  var LAB_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
  var QID_RE = /^[1-9]\d{0,11}$/;
  var LESSON_RE = /^[1-9]\d?$/;
  var CODE_RE = /^[a-z]{3,8}(?:-[a-z]{3,8}){3}$/;

  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }

  /* "Yagi Beacon, fresnel lobe" and "yagi-beacon-fresnel-lobe" are the same code */
  function normaliseCode(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function isCodeShape(s) { return CODE_RE.test(String(s == null ? "" : s)); }

  function today(d) { return (d || new Date()).toISOString().slice(0, 10); }
  function nowIso(d) { return (d || new Date()).toISOString(); }
  function emptyProgress() { return { labs: {}, seen: {}, v: V, w: {} }; }   // already in canonical key order

  function cleanLesson(x) {
    if (!isObj(x)) return null;
    var o = {}, any = false;
    FIELDS.forEach(function (k) {
      if (typeof x[k] === "string" && DATE_RE.test(x[k])) { o[k] = x[k]; any = true; }
    });
    if (Array.isArray(x.check)) {
      var c = [], hit = false;
      for (var i = 0; i < CHECKS; i++) {
        var on = x.check[i] === 1 || x.check[i] === true;
        c.push(on ? 1 : 0);
        if (on) hit = true;
      }
      if (hit) { o.check = c; any = true; }
    }
    return any ? o : null;
  }

  /* anything in, a clean record out; never throws */
  function validate(d) {
    var out = emptyProgress();
    if (!isObj(d)) return out;
    if (isObj(d.w)) Object.keys(d.w).forEach(function (k) {
      if (!LESSON_RE.test(k) || +k > MAX_LESSON) return;
      var l = cleanLesson(d.w[k]);
      if (l) out.w[k] = l;
    });
    if (isObj(d.labs)) Object.keys(d.labs).forEach(function (k) {
      if (LAB_RE.test(k) && typeof d.labs[k] === "string" && DATE_RE.test(d.labs[k])) out.labs[k] = d.labs[k];
    });
    if (isObj(d.seen)) Object.keys(d.seen).forEach(function (k) {
      if (QID_RE.test(k) && typeof d.seen[k] === "string" && TS_RE.test(d.seen[k])) out.seen[k] = d.seen[k];
    });
    return canonical(out);
  }

  function earliest(a, b) { return !a ? (b || "") : !b ? a : (a < b ? a : b); }
  function latest(a, b) { return !a ? (b || "") : !b ? a : (a > b ? a : b); }
  function union(x, y) {
    var s = {};
    Object.keys(x).forEach(function (k) { s[k] = 1; });
    Object.keys(y).forEach(function (k) { s[k] = 1; });
    return Object.keys(s);
  }

  function merge(a, b) {
    a = validate(a); b = validate(b);
    var out = emptyProgress();
    union(a.w, b.w).forEach(function (k) {
      var x = a.w[k] || {}, y = b.w[k] || {}, o = {};
      FIELDS.forEach(function (f) { var v = earliest(x[f], y[f]); if (v) o[f] = v; });
      if (x.check || y.check) {
        var c = [];
        for (var i = 0; i < CHECKS; i++) c.push(((x.check && x.check[i]) || (y.check && y.check[i])) ? 1 : 0);
        o.check = c;
      }
      out.w[k] = o;
    });
    union(a.labs, b.labs).forEach(function (k) { out.labs[k] = earliest(a.labs[k], b.labs[k]); });
    union(a.seen, b.seen).forEach(function (k) { out.seen[k] = latest(a.seen[k], b.seen[k]); });
    return canonical(out);
  }

  /* same content, same string: keys sorted at every level */
  function canonical(p) {
    if (Array.isArray(p)) return p.map(canonical);
    if (!isObj(p)) return p;
    var r = {};
    Object.keys(p).sort().forEach(function (k) { r[k] = canonical(p[k]); });
    return r;
  }
  function serialise(p) { return JSON.stringify(validate(p)); }
  function same(a, b) { return serialise(a) === serialise(b); }

  /* what a lesson card or the progress card shows */
  function lessonState(p, n) {
    var l = (p && p.w && p.w[String(n)]) || {};
    var checks = 0;
    (l.check || []).forEach(function (x) { if (x) checks++; });
    return { read: l.read || "", lab: l.lab || "", game: l.game || "", checks: checks };
  }
  function readCount(p) {
    var n = 0;
    Object.keys((p && p.w) || {}).forEach(function (k) { if (p.w[k].read) n++; });
    return n;
  }
  function labCount(p, ids) {
    var n = 0, labs = (p && p.labs) || {};
    (ids || Object.keys(labs)).forEach(function (k) { if (labs[k]) n++; });
    return n;
  }

  return {
    V: V, MAX_BYTES: MAX_BYTES, CHECKS: CHECKS,
    normaliseCode: normaliseCode, isCodeShape: isCodeShape, today: today, nowIso: nowIso,
    emptyProgress: emptyProgress, validate: validate, merge: merge, canonical: canonical,
    serialise: serialise, same: same, lessonState: lessonState, readCount: readCount, labCount: labCount
  };
});
