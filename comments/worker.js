/**
 * Comments for networkfieldnotes.com. Cloudflare Worker plus D1.
 *
 * Public:  GET  /v1/comments?slug=<slug>   visible comments, no email, no address
 *          POST /v1/comments               {slug, name, email, body, website, token}
 * Admin:   GET  /v1/admin/comments[?slug=] everything, hidden ones and emails included
 *          POST /v1/admin/comments         {action: hide|show|delete|reply, id?, slug?, body?}
 *          Authorization: Bearer <ADMIN_TOKEN>
 *
 * Sandbox:  POST /v1/sandbox/events        {sid, page, events:[{lesson, ev, cmd?, err?, n?, total?}]}
 *           GET  /v1/admin/sandbox[?days=30] raw events for cxstats.py (Bearer ADMIN_TOKEN)
 *           Table sandbox_events, see schema-sandbox.sql. No IP stored, only its salted hash for the rate limit.
 *
 * Secrets: TURNSTILE_SECRET, ADMIN_TOKEN, IP_SALT.  Var: ALLOWED_ORIGIN.  Binding: DB.
 */

const LIMITS = { body: 2000, name: 60, email: 200, perHour: 5, minGapSec: 20, list: 300, sbBatch: 50, sbPerHour: 1500, sbRows: 20000 };
const SB_EVENTS = new Set(["start", "err", "check", "done", "reset", "jserror", "hint", "connect"]);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

const json = (data, status, origin) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin,
    "cache-control": "no-store",
    "vary": "origin",
  },
});

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
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

    try {
      if (path === "/v1/comments" && request.method === "GET") {
        const slug = clean(url.searchParams.get("slug"), 80);
        if (!SLUG_RE.test(slug)) return json({ error: "bad slug" }, 400, origin);
        const { results } = await env.DB.prepare(
          "SELECT id, name, body, is_author, created_at FROM comments WHERE slug = ? AND visible = 1 ORDER BY created_at ASC LIMIT ?"
        ).bind(slug, LIMITS.list).all();
        return json({ slug, count: results.length, comments: results }, 200, origin);
      }

      if (path === "/v1/comments" && request.method === "POST") {
        const input = await request.json().catch(() => null);
        if (!input) return json({ error: "bad request" }, 400, origin);
        if (clean(input.website, 50)) return json({ ok: true }, 200, origin);   // honeypot: answer politely, store nothing

        const slug = clean(input.slug, 80);
        const name = clean(input.name, LIMITS.name);
        const email = clean(input.email, LIMITS.email);
        const body = cleanBody(input.body);

        if (!SLUG_RE.test(slug)) return json({ error: "bad slug" }, 400, origin);
        if (body.length < 2) return json({ error: "Write something first." }, 400, origin);
        if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
          return json({ error: "That email address does not look right." }, 400, origin);
        }

        const ip = request.headers.get("cf-connecting-ip") || "";
        if (!await verifyTurnstile(input.token, ip, env.TURNSTILE_SECRET)) {
          return json({ error: "The spam check did not pass. Reload the page and try again." }, 403, origin);
        }

        const ipHash = ip ? await sha256(ip + (env.IP_SALT || "")) : "";
        if (ipHash) {
          const since = new Date(Date.now() - 3600e3).toISOString();
          const row = await env.DB.prepare(
            "SELECT COUNT(*) AS n, MAX(created_at) AS last FROM comments WHERE ip_hash = ? AND created_at > ?"
          ).bind(ipHash, since).first();
          if (row && row.n >= LIMITS.perHour) return json({ error: "That is enough comments for one hour." }, 429, origin);
          if (row && row.last && (Date.now() - Date.parse(row.last)) < LIMITS.minGapSec * 1000) {
            return json({ error: "Give it a few seconds." }, 429, origin);
          }
        }

        const now = new Date().toISOString();
        const res = await env.DB.prepare(
          "INSERT INTO comments (slug, name, email, body, is_author, visible, ip_hash, ua, created_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?)"
        ).bind(slug, name, email, body, ipHash, clean(request.headers.get("user-agent"), 200), now).run();

        return json({ ok: true, comment: { id: res.meta.last_row_id, name, body, is_author: 0, created_at: now } }, 201, origin);
      }

      if (path === "/v1/admin/comments" && request.method === "GET") {
        if (!isAdmin()) return json({ error: "no" }, 401, origin);
        const slug = clean(url.searchParams.get("slug"), 80);
        const stmt = slug
          ? env.DB.prepare("SELECT * FROM comments WHERE slug = ? ORDER BY created_at DESC LIMIT ?").bind(slug, LIMITS.list)
          : env.DB.prepare("SELECT * FROM comments ORDER BY created_at DESC LIMIT ?").bind(LIMITS.list);
        const { results } = await stmt.all();
        return json({ count: results.length, comments: results }, 200, origin);
      }

      if (path === "/v1/admin/comments" && request.method === "POST") {
        if (!isAdmin()) return json({ error: "no" }, 401, origin);
        const input = await request.json().catch(() => ({}));
        const id = parseInt(input.id, 10);

        if (input.action === "hide" || input.action === "show") {
          if (!id) return json({ error: "need an id" }, 400, origin);
          await env.DB.prepare("UPDATE comments SET visible = ? WHERE id = ?")
            .bind(input.action === "show" ? 1 : 0, id).run();
          return json({ ok: true }, 200, origin);
        }
        if (input.action === "delete") {
          if (!id) return json({ error: "need an id" }, 400, origin);
          await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
          return json({ ok: true }, 200, origin);
        }
        if (input.action === "reply") {
          const slug = clean(input.slug, 80);
          const body = cleanBody(input.body);
          if (!SLUG_RE.test(slug) || body.length < 2) return json({ error: "need a slug and a body" }, 400, origin);
          const now = new Date().toISOString();
          const res = await env.DB.prepare(
            "INSERT INTO comments (slug, name, email, body, is_author, visible, ip_hash, ua, created_at) VALUES (?, ?, '', ?, 1, 1, '', 'author', ?)"
          ).bind(slug, clean(input.name, LIMITS.name) || "Dustin", body, now).run();
          return json({ ok: true, id: res.meta.last_row_id }, 201, origin);
        }
        return json({ error: "unknown action" }, 400, origin);
      }

      if (path === "/v1/sandbox/events" && request.method === "POST") {
        const input = await request.json().catch(() => null);
        if (!input || !Array.isArray(input.events)) return json({ error: "bad request" }, 400, origin);
        const sid = clean(input.sid, 40);
        const page = clean(input.page, 120);
        if (!/^[a-z0-9-]{8,40}$/.test(sid)) return json({ error: "bad sid" }, 400, origin);
        const ip = request.headers.get("cf-connecting-ip") || "";
        const ipHash = ip ? await sha256(ip + (env.IP_SALT || "")) : "";
        if (ipHash) {
          const since = new Date(Date.now() - 3600e3).toISOString();
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
};
