/* Network Field Notes: Academy progress in the browser, and the save code.
 *
 * Progress lives in localStorage first ("nfn:progress", the record theme/progress-core.js describes). A save
 * code ("nfn:code", four words) copies it to the comments Worker so a reader can pick up on another device and
 * find the answers to their questions. No account, no email. No code exists until the reader asks a question,
 * taps "Get a code", or accepts the one offer after their first lesson.
 *
 * Inlined on every Academy lesson, academy.html and sandbox.html, after progress-core.js and after
 * window.NFN_CFG = {api, sitekey, lesson}. An empty api keeps everything in this browser.
 *
 * window.NFNProgress
 *   get()               a copy of the record          code()            the save code here, or ""
 *   mark(field, i)      this lesson: "read" | "lab" | "game" | "check" (i = question 0 to 2)
 *   lab(id)             a CX Sandbox lab passed        seen(ids)         the reader has seen these answers
 *   questions()         the reader's own questions from the last pull, held and live, with answers
 *   getCode(token)      make a code (Turnstile token)  useCode(words)    restore: adopt a code and merge into it
 *   adopt(code)         take the fresh code a question came back with
 *   addMine(q)          a question just asked, so it shows as waiting straight away
 *   onChange(fn)        after any change or pull       renderCode(el, c) the words, Copy, Show QR
 *   turnstileToken()    the token from any Turnstile widget on the page, then resetTurnstile()
 * Games call mark("game") when their last level finishes; cxsim calls lab(id) when a lab passes.
 */
(function () {
  "use strict";
  var Core = window.NFNProgressCore;
  if (!Core || window.NFNProgress) return;
  var CFG = window.NFN_CFG || {};
  var API = String(CFG.api || "").replace(/\/+$/, "");
  var LESSON = CFG.lesson ? String(CFG.lesson) : "";
  var K_DATA = "nfn:progress", K_CODE = "nfn:code", K_DIRTY = "nfn:dirty", K_OFFER = "nfn:offered";

  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function parse(s) { try { return JSON.parse(s || "null"); } catch (e) { return null; } }

  var data = Core.validate(parse(load(K_DATA)));
  var code = Core.isCodeShape(load(K_CODE)) ? load(K_CODE) : "";
  var dirty = !!code && load(K_DIRTY) === "1";
  var mine = [], listeners = [], pushTimer = null, pulled = false;

  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function persist() { save(K_DATA, JSON.stringify(data)); }
  function setDirty(v) { dirty = !!v && !!code; save(K_DIRTY, dirty ? "1" : null); }

  function change(patch) {
    var next = Core.merge(data, patch);
    if (Core.same(next, data)) return;
    data = next; persist();
    if (code) { setDirty(true); schedulePush(3000); }
    emit();
  }

  function mark(field, i) {
    if (!LESSON) return;
    var l = {}, w = {};
    if (field === "check") { if (!(i >= 0 && i < Core.CHECKS)) return; l.check = [0, 0, 0]; l.check[i] = 1; }
    else if (field === "read" || field === "lab" || field === "game") l[field] = Core.today();
    else return;
    w[LESSON] = l;
    change({ w: w });
  }
  function lab(id) { var labs = {}; labs[String(id)] = Core.today(); change({ labs: labs }); }
  function seen(ids) {
    var s = {}, t = Core.nowIso();
    (ids || []).forEach(function (id) { s[String(id)] = t; });
    if (Object.keys(s).length) change({ seen: s });
  }

  // ── the Worker ──────────────────────────────────────────────────────────
  function post(path, body, keepalive) {
    return fetch(API + path, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), keepalive: !!keepalive, cache: "no-store"
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { d = d || {}; d._status = r.status; return d; });
    });
  }

  function pull() {
    if (!API || !code) return Promise.resolve(null);
    return post("/v1/progress/pull", { code: code }).then(function (d) {
      if (d._status === 200) {
        var next = Core.merge(data, d.data);
        var ahead = !Core.same(next, d.data);          // this browser holds something the server doesn't
        data = next; persist();
        mine = Array.isArray(d.questions) ? d.questions : [];
        pulled = true;
        if (ahead) { setDirty(true); schedulePush(1500); }
        emit();
      } else if (d._status === 404) {
        // the code expired (a year unused): keep the progress, forget the code
        code = ""; save(K_CODE, null); setDirty(false); mine = []; emit();
      }
      return d;
    }).catch(function () { return null; });
  }

  function push(keepalive) {
    if (!API || !code || !dirty) return;
    clearTimeout(pushTimer); pushTimer = null;
    post("/v1/progress/push", { code: code, data: data }, keepalive).then(function (d) {
      if (d._status !== 200) return;
      var next = Core.merge(data, d.data);
      if (!Core.same(next, data)) { data = next; persist(); emit(); }
      if (d.stored) setDirty(false);
      else if (d.retry_after) schedulePush((+d.retry_after + 1) * 1000);
    }).catch(function () {});
  }
  function schedulePush(ms) { clearTimeout(pushTimer); pushTimer = setTimeout(function () { push(false); }, ms); }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") push(true); });
  window.addEventListener("pagehide", function () { push(true); });

  function adopt(c, serverData) {
    code = c; save(K_CODE, c);
    var next = Core.merge(data, serverData || {});
    data = next; persist();
    setDirty(!Core.same(next, serverData || {}));
    if (dirty) schedulePush(1500);
    emit();
  }

  function getCode(token) {
    if (!API) return Promise.reject(new Error("Codes are switched off on this copy of the site."));
    if (code) return Promise.resolve(code);
    return post("/v1/progress/new", { token: token || "", data: data }).then(function (d) {
      if (d._status === 201 && Core.isCodeShape(d.code)) { adopt(d.code, d.data); return code; }
      throw new Error(d.error || "That didn't work. Try again in a minute.");
    });
  }

  function useCode(words) {
    var c = Core.normaliseCode(words);
    if (!Core.isCodeShape(c)) return Promise.reject(new Error("That code doesn't look right. It's four words."));
    if (!API) return Promise.reject(new Error("Codes are switched off on this copy of the site."));
    return post("/v1/progress/pull", { code: c }).then(function (d) {
      if (d._status !== 200) throw new Error(d.error || "That code doesn't look right.");
      mine = Array.isArray(d.questions) ? d.questions : [];
      pulled = true;
      adopt(c, d.data);
      return c;
    });
  }

  function addMine(q) { if (q && q.id) { mine = mine.filter(function (x) { return x.id !== q.id; }).concat([q]); emit(); } }

  // ── small UI pieces ─────────────────────────────────────────────────────
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    return new Promise(function (res, rej) {
      var a = el("textarea"); a.value = t; a.setAttribute("readonly", ""); a.style.position = "fixed"; a.style.opacity = "0";
      document.body.appendChild(a); a.select();
      try { document.execCommand("copy") ? res() : rej(); } catch (e) { rej(e); }
      document.body.removeChild(a);
    });
  }

  var qrLoading = null;
  function loadQR() {
    if (window.qrcode) return Promise.resolve();
    if (qrLoading) return qrLoading;
    qrLoading = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "/theme/vendor/qrcode.js";           // same origin, loaded only when somebody asks for the QR
      s.onload = function () { res(); };
      s.onerror = function () { qrLoading = null; rej(new Error("qr")); };
      document.head.appendChild(s);
    });
    return qrLoading;
  }
  function restoreLink(c) { return location.origin + "/academy.html#code=" + c; }

  function renderCode(host, c) {
    host.textContent = "";
    var box = el("div", "nfn-code");
    box.appendChild(el("code", "nfn-code-w", c));
    var row = el("div", "nfn-code-row");
    var copy = el("button", "btn nfn-btn", "Copy"); copy.type = "button";
    var show = el("button", "btn nfn-btn", "Show QR"); show.type = "button";
    var qr = el("div", "nfn-qr"); qr.hidden = true;
    copy.addEventListener("click", function () {
      copyText(c).then(function () { copy.textContent = "Copied"; }, function () { copy.textContent = "Select and copy it"; });
      setTimeout(function () { copy.textContent = "Copy"; }, 1800);
    });
    show.addEventListener("click", function () {
      if (!qr.hidden) { qr.hidden = true; show.textContent = "Show QR"; return; }
      loadQR().then(function () {
        var q = window.qrcode(0, "M");
        q.addData(restoreLink(c)); q.make();
        qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 16, scalable: true, title: "Scan to open the Academy with this code" });
        qr.appendChild(el("span", "nfn-qr-cap", "Scan it with the other device's camera."));
        qr.hidden = false; show.textContent = "Hide QR";
      }, function () {
        qr.textContent = "The QR code didn't load. Type the four words instead.";
        qr.hidden = false;
      });
    });
    row.appendChild(copy); row.appendChild(show);
    box.appendChild(row); box.appendChild(qr);
    host.appendChild(box);
  }

  function turnstileToken() {
    var inputs = document.querySelectorAll('[name="cf-turnstile-response"]');
    for (var i = 0; i < inputs.length; i++) if (inputs[i].value) return inputs[i].value;
    return "";
  }
  function resetTurnstile() { if (window.turnstile) { try { window.turnstile.reset(); } catch (e) {} } }

  var loadedTurnstile = false;
  function ensureTurnstile(host) {
    // an invisible-unless-needed widget, for pages whose only Turnstile need is making a code
    if (!CFG.sitekey || !host || host.querySelector(".cf-turnstile")) return;
    var box = el("div", "cf-turnstile");
    box.setAttribute("data-sitekey", CFG.sitekey);
    box.setAttribute("data-theme", "dark");
    box.setAttribute("data-appearance", "interaction-only");
    host.appendChild(box);
    if (loadedTurnstile || document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')) { if (window.turnstile) { try { window.turnstile.render(box); } catch (e) {} } return; }
    loadedTurnstile = true;
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }

  // ── lesson pages: the progress card, the self-check, "read" ─────────────
  function lessonPage() {
    var card = document.getElementById("prog");
    var hasCheck = !!document.querySelector(".prose ol.selfcheck");

    function paintCard() {
      if (!card) return;
      var st = Core.lessonState(data, LESSON);
      var set = function (k, done, text) {
        var li = card.querySelector('[data-k="' + k + '"]'); if (!li) return;
        li.classList.toggle("done", !!done);
        var b = li.querySelector("b"); if (b && text != null) b.textContent = text;
      };
      set("read", st.read, st.read ? "Done" : "When you reach the end");
      set("lab", st.lab, null);
      set("check", st.checks === Core.CHECKS, st.checks + " of " + Core.CHECKS);
      set("game", st.game, st.game ? "Done" : "Not yet");
      card.querySelectorAll("[data-nfn-lab]").forEach(function (b) { labButton(b, st.lab); });
      var note = card.querySelector(".prog-note");
      if (note) note.textContent = code ? "Saved to your code" : "Saved in this browser";
      var foot = card.querySelector(".prog-code");
      if (!foot) return;
      if (code) { if (foot.getAttribute("data-code") !== code) { foot.setAttribute("data-code", code); renderCode(foot, code); } return; }
      foot.removeAttribute("data-code");
      if (API && st.read && load(K_OFFER) !== "1") offer(foot); else foot.textContent = "";
    }

    function offer(foot) {
      if (foot.querySelector(".prog-offer")) return;
      foot.textContent = "";
      var o = el("div", "prog-offer");
      o.appendChild(el("p", "", "Want this on another device too? A code copies your progress so you can pick it up anywhere. No account, no email."));
      var row = el("div", "nfn-code-row");
      var yes = el("button", "btn nfn-btn", "Get a code"); yes.type = "button";
      var no = el("button", "btn nfn-btn", "No thanks"); no.type = "button";
      var say = el("span", "nfn-say"); say.setAttribute("role", "status");
      yes.addEventListener("click", function () {
        var tok = turnstileToken();
        if (CFG.sitekey && !tok) { say.textContent = "Give the spam check a second, then try again."; return; }
        yes.disabled = true; say.textContent = "Making your code.";
        getCode(tok).then(function () { save(K_OFFER, "1"); resetTurnstile(); paintCard(); },
          function (e) { yes.disabled = false; say.textContent = e.message; resetTurnstile(); });
      });
      no.addEventListener("click", function () { save(K_OFFER, "1"); foot.textContent = ""; });
      row.appendChild(yes); row.appendChild(no); row.appendChild(say);
      o.appendChild(row); foot.appendChild(o);
    }

    // self-check: a reveal per question, then Got it / Not yet
    var qs = document.querySelectorAll(".prose ol.selfcheck > li");
    function paintChecks() {
      var l = (data.w && data.w[LESSON]) || {}, c = l.check || [];
      qs.forEach(function (li, i) { li.classList.toggle("got", !!c[i]); var s = li.querySelector(".sc-say"); if (s && c[i]) s.textContent = "Got it."; });
    }
    qs.forEach(function (li, i) {
      var d = li.querySelector("details"), grade = li.querySelector(".sc-grade"), say = li.querySelector(".sc-say");
      if (!d || !grade) return;
      d.addEventListener("toggle", function () { grade.hidden = !d.open; });
      var got = li.querySelector(".sc-got"), not = li.querySelector(".sc-not");
      if (got) got.addEventListener("click", function () { mark("check", i); if (say) say.textContent = "Got it."; });
      if (not) not.addEventListener("click", function () { if (say) say.textContent = "Fair enough. Have another read of the section and come back to it."; });
    });

    // "I ran this lab": in the card, and anywhere a lesson put {{labdone}}
    document.querySelectorAll("[data-nfn-lab]").forEach(function (b) {
      b.addEventListener("click", function () { mark("lab"); });
    });
    function labButton(b, done) { b.disabled = !!done; b.textContent = done ? "Lab done" : "I ran this lab"; b.classList.toggle("done", !!done); }
    function paintLabButtons() { var st = Core.lessonState(data, LESSON); document.querySelectorAll("[data-nfn-lab]").forEach(function (b) { labButton(b, st.lab); }); }

    // read: the Three questions heading (or the end of the text) in view, after at least 30 seconds here
    (function watchRead() {
      if (Core.lessonState(data, LESSON).read) return;
      var target = null;
      document.querySelectorAll(".prose h2").forEach(function (h) { if (!target && /three questions/i.test(h.textContent)) target = h; });
      if (!target) { var p = document.querySelector(".post-body .prose"); target = p && p.lastElementChild; }
      if (!target || !("IntersectionObserver" in window)) return;
      var t0 = Date.now(), reached = false, timer = null;
      function check() { if (reached && Date.now() - t0 >= 30000) { io.disconnect(); clearTimeout(timer); mark("read"); } }
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          reached = true; check();
          if (!timer) timer = setTimeout(check, Math.max(0, 30000 - (Date.now() - t0)) + 60);
        });
      });
      io.observe(target);
    })();

    onChange(function () { paintCard(); paintChecks(); paintLabButtons(); });
    paintCard(); paintChecks(); paintLabButtons();
    if (card && !hasCheck) { var ck = card.querySelector('[data-k="check"]'); if (ck) ck.hidden = true; }
  }

  // ── academy.html: pips, counts, new-answer badges, the code box ─────────
  function academyPage() {
    var cards = document.querySelectorAll(".lesson.live[data-lesson]");
    var readEl = document.getElementById("acad-read"), labsEl = document.getElementById("acad-labs");
    var box = document.getElementById("codebox");

    function answeredUnseen() {
      var by = {};
      mine.forEach(function (q) {
        var last = "";
        (q.answers || []).forEach(function (a) { if (a.is_author && a.created_at > last) last = a.created_at; });
        if (last && !(data.seen[String(q.id)] >= last)) by[q.slug] = true;
      });
      return by;
    }

    function paint() {
      var fresh = answeredUnseen();
      cards.forEach(function (c) {
        var n = c.getAttribute("data-lesson"), st = Core.lessonState(data, n);
        var pips = c.querySelector(".pips"); if (!pips) return;
        pips.textContent = "";
        var any = false;
        [["read", "Read", !!st.read], ["lab", "Lab", !!st.lab],
         ["check", "Self-check", st.checks === Core.CHECKS, c.getAttribute("data-check") === "1"],
         ["game", "Game", !!st.game, c.getAttribute("data-game") === "1"]].forEach(function (p) {
          if (p.length > 3 && !p[3]) return;
          var i = el("i", "pip" + (p[2] ? " on" : ""));
          i.title = p[1] + (p[2] ? ": done" : ": not yet");
          i.setAttribute("aria-label", i.title);
          pips.appendChild(i);
          if (p[2]) any = true;
        });
        pips.hidden = !any;
        var badge = c.querySelector(".ans-badge");
        if (badge) badge.hidden = !fresh[c.getAttribute("data-slug")];
      });
      var nRead = Core.readCount(data);
      if (readEl) { readEl.textContent = nRead + " of " + (readEl.getAttribute("data-total") || cards.length) + " read"; readEl.hidden = !nRead; }
      if (labsEl) {
        var ids = (labsEl.getAttribute("data-labs") || "").split(",").filter(Boolean);
        var nLabs = Core.labCount(data, ids);
        labsEl.textContent = nLabs + " of " + ids.length + " labs passed"; labsEl.hidden = !nLabs;
      }
      if (box) paintBox();
    }

    function paintBox() {
      var ui = box.querySelector(".cb-ui"); if (!ui) return;
      if (!API) { box.hidden = true; return; }
      if (code) {
        if (ui.getAttribute("data-code") === code) return;
        ui.setAttribute("data-code", code);
        ui.textContent = "";
        ui.appendChild(el("p", "cb-lead", "Your code. Type it, or scan the QR, on the other device."));
        var holder = el("div"); ui.appendChild(holder); renderCode(holder, code);
        var other = el("button", "btn nfn-btn cb-other", "Use a different code"); other.type = "button";
        other.addEventListener("click", function () { ui.removeAttribute("data-code"); restoreForm(ui, true); });
        ui.appendChild(other);
        return;
      }
      if (ui.getAttribute("data-code") === "none") return;
      ui.setAttribute("data-code", "none");
      ui.textContent = "";
      var get = el("button", "btn nfn-btn", "Get a code"); get.type = "button";
      var say = el("span", "nfn-say"); say.setAttribute("role", "status");
      get.addEventListener("click", function () {
        var tok = turnstileToken();
        if (CFG.sitekey && !tok) { say.textContent = "Give the spam check a second, then try again."; return; }
        get.disabled = true; say.textContent = "Making your code.";
        getCode(tok).then(function () { resetTurnstile(); }, function (e) { get.disabled = false; say.textContent = e.message; resetTurnstile(); });
      });
      var row = el("div", "nfn-code-row"); row.appendChild(get); row.appendChild(say);
      ui.appendChild(row);
      restoreForm(ui, false);
      ensureTurnstile(ui);
    }

    function restoreForm(ui, switching) {
      if (switching) ui.textContent = "";
      var f = el("form", "cb-restore"); f.setAttribute("novalidate", "");
      var lab = el("label", "cb-f");
      lab.appendChild(el("span", "", "Have a code? Type it here."));
      var inp = el("input"); inp.type = "text"; inp.autocomplete = "off"; inp.autocapitalize = "none"; inp.spellcheck = false;
      inp.placeholder = "four words"; inp.setAttribute("aria-label", "Your save code");
      lab.appendChild(inp); f.appendChild(lab);
      var go = el("button", "btn nfn-btn", "Use it"); go.type = "submit";
      var say = el("span", "nfn-say"); say.setAttribute("role", "status");
      var row = el("div", "nfn-code-row"); row.appendChild(go); row.appendChild(say); f.appendChild(row);
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var c = Core.normaliseCode(inp.value);
        if (code && c !== code && !window.confirm("This browser already has a code. Switch to this one? What's saved here comes with you.")) return;
        go.disabled = true; say.textContent = "Checking.";
        useCode(inp.value).then(function () { say.textContent = ""; }, function (err) { go.disabled = false; say.textContent = err.message; });
      });
      ui.appendChild(f);
    }

    // a QR scan lands here as academy.html#code=four-words-like-this
    var m = /[#&]code=([a-z-]+)/i.exec(location.hash);
    if (m) {
      var c = Core.normaliseCode(m[1]);
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
      if (c && c !== code && (!code || window.confirm("Switch this browser to the code you scanned? What's saved here comes with you."))) {
        useCode(c).then(null, function (err) { if (box) { var ui = box.querySelector(".cb-ui"); if (ui) { ui.removeAttribute("data-code"); var s = el("p", "nfn-say", err.message); ui.appendChild(s); } } });
      }
    }

    onChange(paint);
    paint();
  }

  // ── sandbox.html: a tick on every lab that has passed ───────────────────
  function sandboxPage() {
    function paint() {
      document.querySelectorAll(".sb-pill[data-lab]").forEach(function (p) {
        var on = !!(data.labs && data.labs[p.getAttribute("data-lab")]);
        p.classList.toggle("passed", on);
        if (on) p.setAttribute("title", "Lab passed"); else p.removeAttribute("title");
      });
    }
    onChange(paint);
    paint();
  }

  function onChange(fn) { if (typeof fn === "function") listeners.push(fn); }

  window.NFNProgress = {
    core: Core,
    get: function () { return JSON.parse(JSON.stringify(data)); },
    code: function () { return code; },
    pulled: function () { return pulled; },
    mark: mark, lab: lab, seen: seen,
    questions: function () { return mine.slice(); },
    getCode: getCode, useCode: useCode, adopt: function (c) { if (Core.isCodeShape(c)) adopt(c, {}); }, addMine: addMine,
    onChange: onChange, renderCode: renderCode, turnstileToken: turnstileToken, resetTurnstile: resetTurnstile,
    _push: function () { setDirty(true); push(false); }       // for tests
  };

  function boot() {
    if (LESSON) lessonPage();
    if (document.getElementById("codebox") || document.querySelector(".lesson.live[data-lesson]")) academyPage();
    if (document.querySelector(".sb-pill[data-lab]")) sandboxPage();
    pull();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
