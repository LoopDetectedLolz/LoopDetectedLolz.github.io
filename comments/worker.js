/**
 * Comments, Academy questions and save codes for networkfieldnotes.com. Cloudflare Worker plus D1.
 *
 * Public:  GET  /v1/comments?slug=<slug>      visible rows, oldest first, no email, no address. Each row carries kind
 *                                             and parent_id so a lesson page can nest answers under questions.
 *          POST /v1/comments                  {slug, name, email, body, website, token, code?}
 *                                             On an Academy lesson (QA_SLUG_RE) the row is a question: held until
 *                                             Dustin approves it, never stored with an email, and the reply carries
 *                                             a save code when the asker had none.
 *          POST /v1/progress/new              {token, data?}  -> {code, data}
 *          POST /v1/progress/pull             {code}          -> {data, questions}
 *          POST /v1/progress/push             {code, data}    -> {data, stored, retry_after?}
 * Admin:   GET  /v1/admin/comments[?slug=][&state=held|live|hidden]
 *          POST /v1/admin/comments            {action: hide|show|approve|delete|reply, id?, slug?, parent_id?, body?, name?}
 *          Authorization: Bearer <ADMIN_TOKEN>
 * Sandbox: POST /v1/sandbox/events        {sid, page, events:[{lesson, ev, cmd?, err?, n?, total?}]}
 *          GET  /v1/admin/sandbox[?days=30] raw events for cxstats.py (Bearer ADMIN_TOKEN)
 *          Table sandbox_events, see schema-sandbox.sql. No IP stored, only its salted hash for the rate limit.
 * Cron:    daily, see wrangler.toml: prunes the rate-limit rows and the save codes nobody used for a year.
 *
 * Save codes are four words from words.js. Only a keyed hash of a code is stored (HMAC with CODE_SALT), and codes
 * only ever travel in POST bodies, so they stay out of URLs and logs.
 *
 * The Cowork Q&A monitor writes to `comments` with plain SQL. The columns and values it relies on (kind, state,
 * parent_id, code_hash; visible always equal to state = 'live') are a contract: CLAUDE.md, "Comments", lists them.
 *
 * Secrets: TURNSTILE_SECRET, ADMIN_TOKEN, IP_SALT, CODE_SALT.  Var: ALLOWED_ORIGIN.  Binding: DB.
 */
import Core from "../theme/progress-core.js";
import WORDS from "./words.js";

const LIMITS = { body: 2000, name: 60, email: 200, perHour: 5, minGapSec: 20, list: 300, sbBatch: 50, sbPerHour: 1500, sbRows: 20000,
                 codesPerHour: 5, missesPerHour: 10, pushGapSec: 60, touchSec: 86400, progressBytes: Core.MAX_BYTES, mine: 50 };
const SB_EVENTS = new Set(["start", "err", "check", "done", "reset", "jserror", "hint", "connect"]);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const QA_SLUG_RE = /^(academy|nac)-\d{2}-/;        // Academy lessons take questions, held for approval
const STATES = new Set(["held", "live", "hidden"]);

const json = (data, status, origin) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin,
    "cache-control": "no-store",
    "vary": "origin",
  },
});

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

async function sha256(text) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

function clean(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanBody(value) {
  // keep paragraph breaks, drop control characters, collapse runs of blank lines
  return String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, LIMITS.body);
}

async function verifyTurnstile(token, ip, secret) {
  if (!secret) return true;               // no secret set means the gate is deliberately off
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const out = await res.json().catch(() => ({ success: false }));
  return out.success === true;
}

// ── save codes ────────────────────────────────────────────────────────────────
// A code is only ever looked up by its keyed hash, so words.js can change later without breaking old codes.
async function codeHash(env, raw) {
  const code = Core.normaliseCode(raw);
  return Core.isCodeShape(code) ? hmacHex(env.CODE_SALT, code) : null;
}

function drawCode() {
  const r = new Uint16Array(4);
  crypto.getRandomValues(r);
  return Array.from(r, n => WORDS[n & 1023]).join("-");   // 65,536 is a multiple of 1,024, so the mask stays uniform
}

async function mintCode(env, dataText, now) {
  for (let i = 0; i < 5; i++) {
    const code = drawCode(), hash = await hmacHex(env.CODE_SALT, code);
    const res = await env.DB.prepare(
      "INSERT OR IGNORE INTO progress (code_hash, data, created_at, updated_at, written_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(hash, dataText, now, now, now).run();
    if (res.meta && res.meta.changes === 1) return { code, hash };
  }
  throw new Error("no free save code after five draws");
}

const isoAgo = sec => new Date(Date.now() - sec * 1000).toISOString();
const ageSec = iso => (Date.now() - Date.parse(iso || 0)) / 1000;

async function countSince(env, table, ipHash, sec) {
  // table is one of two fixed names, never user input
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM " + table + " WHERE ip_hash = ? AND created_at > ?").bind(ipHash, isoAgo(sec)).first();
  return (row && row.n) || 0;
}

function parseData(text) {
  try { return JSON.parse(text); } catch (e) { return {}; }
}

// the caller's own questions, held or live, each with the answers that are live
async function mine(env, hash) {
  const { results: qs } = await env.DB.prepare(
    "SELECT id, slug, name, body, state, created_at FROM comments WHERE code_hash = ? AND kind = 'question' AND state IN ('held', 'live') ORDER BY created_at ASC LIMIT ?"
  ).bind(hash, LIMITS.mine).all();
  if (!qs.length) return [];
  const ids = qs.map(q => q.id);
  const { results: as } = await env.DB.prepare(
    "SELECT id, parent_id, name, body, is_author, created_at FROM comments WHERE parent_id IN (" + ids.map(() => "?").join(",") + ") AND visible = 1 ORDER BY created_at ASC"
  ).bind(...ids).all();
  return qs.map(q => Object.assign({}, q, { answers: as.filter(a => a.parent_id === q.id) }));
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "https://networkfieldnotes.com";
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-max-age": "86400",
      }});
    }

    const isAdmin = () => {
      const header = request.headers.get("authorization") || "";
      return Boolean(env.ADMIN_TOKEN) && header === "Bearer " + env.ADMIN_TOKEN;
    };
    const ip = request.headers.get("cf-connecting-ip") || "";
    const ipHashOf = async () => (ip ? sha256(ip + (env.IP_SALT || "")) : "");

    try {
      if (path === "/v1/comments" && request.method === "GET") {
        const slug = clean(url.searchParams.get("slug"), 80);
        if (!SLUG_RE.test(slug)) return json({ error: "bad slug" }, 400, origin);
        const { results } = await env.DB.prepare(
          "SELECT id, name, body, is_author, created_at, kind, parent_id FROM comments WHERE slug = ? AND visible = 1 ORDER BY created_at ASC LIMIT ?"
        ).bind(slug, LIMITS.list).all();
        return json({ slug, count: results.length, comments: results }, 200, origin);
      }

      if (path === "/v1/comments" && request.method === "POST") {
        const input = await request.json().catch(() => null);
        if (!input) return json({ error: "bad request" }, 400, origin);
        if (clean(input.website, 50)) return json({ ok: true }, 200, origin);   // honeypot: answer politely, store nothing

        const slug = clean(input.slug, 80);
        const qa = QA_SLUG_RE.test(slug);
        const name = clean(input.name, LIMITS.name);
        const email = qa ? "" : clean(input.email, LIMITS.email);                // a lesson question never keeps an email
        const body = cleanBody(input.body);

        if (!SLUG_RE.test(slug)) return json({ error: "bad slug" }, 400, origin);
        if (body.length < 2) return json({ error: "Write something first." }, 400, origin);
        if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
          return json({ error: "That email address does not look right." }, 400, origin);
        }

        if (!await verifyTurnstile(input.token, ip, env.TURNSTILE_SECRET)) {
          return json({ error: "The spam check did not pass. Reload the page and try again." }, 403, origin);
        }

        const ipHash = await ipHashOf();
        if (ipHash) {
          const since = isoAgo(3600);
          const row = await env.DB.prepare(
            "SELECT COUNT(*) AS n, MAX(created_at) AS last FROM comments WHERE ip_hash = ? AND created_at > ?"
          ).bind(ipHash, since).first();
          if (row && row.n >= LIMITS.perHour) return json({ error: "That is enough " + (qa ? "questions" : "comments") + " for one hour." }, 429, origin);
          if (row && row.last && (Date.now() - Date.parse(row.last)) < LIMITS.minGapSec * 1000) {
            return json({ error: "Give it a few seconds." }, 429, origin);
          }
        }

        const now = new Date().toISOString();
        const ua = clean(request.headers.get("user-agent"), 200);

        if (!qa) {
          const res = await env.DB.prepare(
            "INSERT INTO comments (slug, name, email, body, is_author, visible, ip_hash, ua, created_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?)"
          ).bind(slug, name, email, body, ipHash, ua, now).run();
          return json({ ok: true, comment: { id: res.meta.last_row_id, name, body, is_author: 0, created_at: now } }, 201, origin);
        }

        // a lesson question: held for Dustin, tied to the asker's save code so they can come back for the answer
        let code = null, hash = "";
        if (env.CODE_SALT) {
          const given = input.code ? await codeHash(env, input.code) : null;
          if (given && await env.DB.prepare("SELECT 1 AS x FROM progress WHERE code_hash = ?").bind(given).first()) {
            hash = given;
          } else {
            const m = await mintCode(env, JSON.stringify(Core.emptyProgress()), now);
            code = m.code; hash = m.hash;
          }
        }
        const res = await env.DB.prepare(
          "INSERT INTO comments (slug, name, email, body, is_author, visible, ip_hash, ua, created_at, kind, state, parent_id, code_hash) VALUES (?, ?, '', ?, 0, 0, ?, ?, ?, 'question', 'held', NULL, ?)"
        ).bind(slug, name, body, ipHash, ua, now, hash).run();
        return json({ ok: true, question: { id: res.meta.last_row_id, slug, name, body, state: "held", created_at: now, answers: [] }, code }, 201, origin);
      }

      if (path === "/v1/admin/comments" && request.method === "GET") {
        if (!isAdmin()) return json({ error: "no" }, 401, origin);
        const slug = clean(url.searchParams.get("slug"), 80);
        const state = clean(url.searchParams.get("state"), 10);
        const where = [], args = [];
        if (slug) { where.push("slug = ?"); args.push(slug); }
        if (STATES.has(state)) { where.push("state = ?"); args.push(state); }
        args.push(LIMITS.list);
        const { results } = await env.DB.prepare(
          "SELECT * FROM comments" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY created_at DESC LIMIT ?"
        ).bind(...args).all();
        return json({ count: results.length, comments: results }, 200, origin);
      }

      if (path === "/v1/admin/comments" && request.method === "POST") {
        if (!isAdmin()) return json({ error: "no" }, 401, origin);
        const input = await request.json().catch(() => ({}));
        const id = parseInt(input.id, 10);

        if (input.action === "hide" || input.action === "show") {
          if (!id) return json({ error: "need an id" }, 400, origin);
          const show = input.action === "show";
          await env.DB.prepare("UPDATE comments SET visible = ?, state = ? WHERE id = ?")
            .bind(show ? 1 : 0, show ? "live" : "hidden", id).run();
          return json({ ok: true }, 200, origin);
        }
        if (input.action === "approve") {
          if (!id) return json({ error: "need an id" }, 400, origin);
          const res = await env.DB.prepare("UPDATE comments SET visible = 1, state = 'live' WHERE id = ? AND state = 'held'").bind(id).run();
          if (!res.meta.changes) return json({ error: "nothing held with that id" }, 404, origin);
          return json({ ok: true }, 200, origin);
        }
        if (input.action === "delete") {
          if (!id) return json({ error: "need an id" }, 400, origin);
          await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
          return json({ ok: true }, 200, origin);
        }
        if (input.action === "reply") {
          const body = cleanBody(input.body);
          const name = clean(input.name, LIMITS.name) || "Dustin";
          const now = new Date().toISOString();
          const parentId = parseInt(input.parent_id, 10);
          if (body.length < 2) return json({ error: "need a body" }, 400, origin);
          if (parentId) {
            // threaded: an answer under a question approves the question in the same batch
            const parent = await env.DB.prepare("SELECT id, slug, kind FROM comments WHERE id = ?").bind(parentId).first();
            if (!parent) return json({ error: "no comment with that id" }, 404, origin);
            const kind = parent.kind === "question" ? "answer" : "comment";
            const out = await env.DB.batch([
              env.DB.prepare("UPDATE comments SET visible = 1, state = 'live' WHERE id = ? AND state = 'held'").bind(parentId),
              env.DB.prepare(
                "INSERT INTO comments (slug, name, email, body, is_author, visible, ip_hash, ua, created_at, kind, state, parent_id, code_hash) VALUES (?, ?, '', ?, 1, 1, '', 'author', ?, ?, 'live', ?, '')"
              ).bind(parent.slug, name, body, now, kind, parentId),
            ]);
            return json({ ok: true, id: out[1].meta.last_row_id, slug: parent.slug }, 201, origin);
          }
          const slug = clean(input.slug, 80);
          if (!SLUG_RE.test(slug)) return json({ error: "need a slug or a parent_id" }, 400, origin);
          const res = await env.DB.prepare(
            "INSERT INTO comments (slug, name, email, body, is_author, visible, ip_hash, ua, created_at) VALUES (?, ?, '', ?, 1, 1, '', 'author', ?)"
          ).bind(slug, name, body, now).run();
          return json({ ok: true, id: res.meta.last_row_id }, 201, origin);
        }
        return json({ error: "unknown action" }, 400, origin);
      }

      if (path.startsWith("/v1/progress/") && request.method === "POST") {
        if (!env.CODE_SALT) return json({ error: "Save codes aren't switched on yet." }, 503, origin);
        const raw = await request.text();
        if (raw.length > LIMITS.progressBytes + 1024) return json({ error: "That is more than a progress record." }, 413, origin);
        let input = null;
        try { input = JSON.parse(raw); } catch (e) { input = null; }
        if (!input || typeof input !== "object") return json({ error: "bad request" }, 400, origin);
        const ipHash = await ipHashOf();
        const now = new Date().toISOString();

        if (path === "/v1/progress/new") {
          if (!await verifyTurnstile(input.token, ip, env.TURNSTILE_SECRET)) {
            return json({ error: "The spam check did not pass. Reload the page and try again." }, 403, origin);
          }
          if (ipHash && await countSince(env, "code_mints", ipHash, 3600) >= LIMITS.codesPerHour) {
            return json({ error: "That is plenty of codes for one hour." }, 429, origin);
          }
          const data = Core.validate(input.data);
          const m = await mintCode(env, JSON.stringify(data), now);
          if (ipHash) await env.DB.prepare("INSERT INTO code_mints (ip_hash, created_at) VALUES (?, ?)").bind(ipHash, now).run();
          return json({ code: m.code, data }, 201, origin);
        }

        if (path === "/v1/progress/pull" || path === "/v1/progress/push") {
          if (ipHash && await countSince(env, "code_misses", ipHash, 3600) >= LIMITS.missesPerHour) {
            return json({ error: "Too many tries. Give it an hour." }, 429, origin);
          }
          const hash = await codeHash(env, input.code);
          const row = hash ? await env.DB.prepare("SELECT data, updated_at, written_at FROM progress WHERE code_hash = ?").bind(hash).first() : null;
          if (!row) {
            if (ipHash) await env.DB.prepare("INSERT INTO code_misses (ip_hash, created_at) VALUES (?, ?)").bind(ipHash, now).run();
            return json({ error: "That code doesn't look right." }, 404, origin);
          }
          const stored = Core.validate(parseData(row.data));
          const touch = () => env.DB.prepare("UPDATE progress SET updated_at = ? WHERE code_hash = ?").bind(now, hash).run();

          if (path === "/v1/progress/pull") {
            if (ageSec(row.updated_at) > LIMITS.touchSec) await touch();   // once a day is plenty for the year-long expiry
            return json({ data: stored, questions: await mine(env, hash) }, 200, origin);
          }

          const merged = Core.merge(stored, input.data);
          const text = JSON.stringify(merged);
          if (text.length > LIMITS.progressBytes) return json({ error: "That is more than a progress record." }, 413, origin);
          if (text === JSON.stringify(stored)) {
            if (ageSec(row.updated_at) > LIMITS.touchSec) await touch();
            return json({ data: merged, stored: true }, 200, origin);
          }
          const wait = LIMITS.pushGapSec - ageSec(row.written_at);
          if (wait > 0) return json({ data: merged, stored: false, retry_after: Math.ceil(wait) }, 200, origin);
          await env.DB.prepare("UPDATE progress SET data = ?, updated_at = ?, written_at = ? WHERE code_hash = ?").bind(text, now, now, hash).run();
          return json({ data: merged, stored: true }, 200, origin);
        }
      }

      if (path === "/v1/sandbox/events" && request.method === "POST") {
        const input = await request.json().catch(() => null);
        if (!input || !Array.isArray(input.events)) return json({ error: "bad request" }, 400, origin);
        const sid = clean(input.sid, 40);
        const page = clean(input.page, 120);
        if (!/^[a-z0-9-]{8,40}$/.test(sid)) return json({ error: "bad sid" }, 400, origin);
        const ipHash = await ipHashOf();
        if (ipHash) {
          const since = isoAgo(3600);
          const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sandbox_events WHERE ip_hash = ? AND created_at > ?").bind(ipHash, since).first();
          if (row && row.n >= LIMITS.sbPerHour) return json({ ok: true, dropped: true }, 200, origin);
        }
        const now = new Date().toISOString();
        const stmt = env.DB.prepare("INSERT INTO sandbox_events (sid, page, lesson, ev, cmd, err, n, total, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        const batch = [];
        for (const e of input.events.slice(0, LIMITS.sbBatch)) {
          if (!e || !SB_EVENTS.has(e.ev)) continue;
          const lesson = clean(e.lesson, 60);
          if (!SLUG_RE.test(lesson)) continue;
          batch.push(stmt.bind(sid, page, lesson, e.ev, clean(e.cmd, 160), clean(e.err, 60), Number.isFinite(+e.n) ? +e.n : null, Number.isFinite(+e.total) ? +e.total : null, ipHash, now));
        }
        if (batch.length) await env.DB.batch(batch);
        return json({ ok: true, stored: batch.length }, 200, origin);
      }

      if (path === "/v1/admin/sandbox" && request.method === "GET") {
        if (!isAdmin()) return json({ error: "no" }, 401, origin);
        const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("days") || "30", 10) || 30));
        const since = new Date(Date.now() - days * 86400e3).toISOString();
        const { results } = await env.DB.prepare(
          "SELECT id, sid, page, lesson, ev, cmd, err, n, total, created_at FROM sandbox_events WHERE created_at > ? ORDER BY created_at ASC LIMIT ?"
        ).bind(since, LIMITS.sbRows).all();
        return json({ days, count: results.length, events: results }, 200, origin);
      }

      return json({ error: "not found" }, 404, origin);
    } catch (err) {
      return json({ error: "server error", detail: String((err && err.message) || err) }, 500, origin);
    }
  },

  // daily housekeeping (wrangler.toml [triggers]): the rate-limit rows, and save codes nobody has used for a year
  async scheduled(controller, env, ctx) {
    const twoDays = isoAgo(2 * 86400), year = isoAgo(365 * 86400);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM code_misses WHERE created_at < ?").bind(twoDays),
      env.DB.prepare("DELETE FROM code_mints WHERE created_at < ?").bind(twoDays),
      env.DB.prepare("UPDATE comments SET code_hash = '' WHERE code_hash <> '' AND code_hash IN (SELECT code_hash FROM progress WHERE updated_at < ?)").bind(year),
      env.DB.prepare("DELETE FROM progress WHERE updated_at < ?").bind(year),
    ]);
  },
};
