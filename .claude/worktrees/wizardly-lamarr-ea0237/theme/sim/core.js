/* Network Field Notes simulator core: namespace, deterministic randomness, and
   the whole of a tool's state carried in the URL so a link is an argument you
   can hand to somebody. No canvas and no DOM below this line. */
(function (root) {
  var NFN = root.NFN = root.NFN || {};

  /* mulberry32: small, fast, and the same sequence every time for a given seed,
     which is what makes a screenshot reproducible and a test meaningful */
  NFN.rng = function (seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  };

  NFN.clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  NFN.db = function (x) { return 10 * Math.log10(x); };
  NFN.lin = function (d) { return Math.pow(10, d / 10); };

  /* ── state in the hash ────────────────────────────────────────────────────
     Compact on purpose: #capacity/v1?bw=80&std=ax&g=120,ax11x2,voice;40,ax4x1,web
     A schema gives each field a default, a parser and a printer, so a missing or
     junk value falls back instead of throwing. */
  NFN.State = function (tool, schema) {
    var s = {};
    Object.keys(schema).forEach(function (k) { s[k] = schema[k].def; });

    function parse(hash) {
      var m = /^#?([^\/]+)\/v\d+\??(.*)$/.exec(hash || "");
      if (!m || m[1] !== tool) return false;
      m[2].split("&").forEach(function (pair) {
        var i = pair.indexOf("="); if (i < 0) return;
        var k = decodeURIComponent(pair.slice(0, i)), v = decodeURIComponent(pair.slice(i + 1));
        if (!schema[k]) return;
        try { var out = schema[k].get(v); if (out !== undefined && out !== null) s[k] = out; } catch (e) {}
      });
      return true;
    }

    function print() {
      var parts = [];
      Object.keys(schema).forEach(function (k) {
        var v = schema[k].put ? schema[k].put(s[k]) : String(s[k]);
        if (v !== null && v !== undefined && v !== schema[k].put_def) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
      });
      return "#" + tool + "/v1?" + parts.join("&");
    }

    return {
      v: s,
      get: function (k) { return s[k]; },
      set: function (k, val) { s[k] = val; return this; },
      fromHash: parse,
      toHash: print,
      /* writes the hash without adding a history entry for every keystroke */
      push: function () {
        /* a sandboxed frame can refuse both of these; a tool that works is worth
           more than a URL that updates, so never let this take the page down */
        try {
          if (root.history && root.history.replaceState) root.history.replaceState(null, "", print());
          else root.location.hash = print();
        } catch (e) {}
      }
    };
  };

  /* schema helpers */
  NFN.f = {
    num: function (def, lo, hi) { return { def: def, get: function (v) { var n = parseFloat(v); return isFinite(n) ? NFN.clamp(n, lo, hi) : undefined; } }; },
    int: function (def, lo, hi) { return { def: def, get: function (v) { var n = parseInt(v, 10); return isFinite(n) ? Math.round(NFN.clamp(n, lo, hi)) : undefined; } }; },
    pick: function (def, list) { return { def: def, get: function (v) { return list.indexOf(v) >= 0 ? v : undefined; } }; },
    bool: function (def) { return { def: def, get: function (v) { return v === "1" || v === "true"; }, put: function (x) { return x ? "1" : "0"; } }; },
    json: function (def, ser, de) { return { def: def, get: de, put: ser }; }
  };
})(typeof window !== "undefined" ? window : globalThis);
