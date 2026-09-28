// node comments/qatest.mjs [base]
//
// Drives a LOCAL `wrangler dev` of the comments Worker: questions held on lesson slugs, answers threaded,
// field-note comments unchanged, save codes (new, pull, push, limits), the Cowork monitor's SQL, and the
// daily cron. Never point it at the live Worker; it refuses to.
//
// Setup, from comments/ (the local D1 lives in comments/.wrangler, which git ignores):
//   printf 'ADMIN_TOKEN=test-admin\nIP_SALT=test-salt\nCODE_SALT=test-code-salt\n' > .dev.vars   # no TURNSTILE_SECRET: the gate is off locally
//   wrangler d1 execute nfn-comments --local --file=schema.sql
//   wrangler d1 execute nfn-comments --local --file=schema-sandbox.sql
//   wrangler d1 execute nfn-comments --local --file=schema-academy.sql
//   wrangler dev --local --port 8799 --test-scheduled
//   node qatest.mjs            (WRANGLER=/path/to/wrangler if it isn't on PATH)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8799";
if (/networkfieldnotes\.com/.test(BASE)) { console.error("refusing to run against the live Worker"); process.exit(2); }
const ADMIN = process.env.NFN_TEST_ADMIN || "test-admin";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRANGLER = process.env.WRANGLER || "wrangler";

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log("ok    " + name); }
  catch (e) { fail++; console.log("FAIL  " + name + "\n      " + (e && e.message || e)); }
}
function ok(v, msg) { if (!v) throw new Error(msg || "expected true"); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || "not equal") + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b)); }

let ipn = 10;
const freshIp = () => "198.51.100." + (ipn++);          // RFC 5737, one per test so rate limits don't bleed across tests
async function call(method, p, body, opt = {}) {
  const headers = { "content-type": "application/json", "cf-connecting-ip": opt.ip || freshIp() };
  if (opt.admin) headers.authorization = "Bearer " + ADMIN;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) });
  const text = await res.text();
  let data = {}; try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  return { status: res.status, data };
}
function sql(command) {
  const out = execFileSync(WRANGLER, ["d1", "execute", "nfn-comments", "--local", "--json", "--command", command], { cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const parsed = JSON.parse(out);
  return (parsed[0] && parsed[0].results) || [];
}
const iso = () => new Date().toISOString();
const LESSON = "academy-01-what-a-radio-actually-sends", NOTE = "vsx-upgrade-hitless";
const CODE_RE = /^[a-z]{3,8}(-[a-z]{3,8}){3}$/;

let code1 = "", q1 = 0, q2 = 0;

await t("a field-note comment is live straight away, as before", async () => {
  const r = await call("POST", "/v1/comments", { slug: NOTE, name: "Pat", email: "pat@example.com", body: "Saw this on 10.13 too." });
  eq(r.status, 201); ok(r.data.comment && r.data.comment.id);
  const g = await call("GET", "/v1/comments?slug=" + NOTE);
  const row = g.data.comments.find(c => c.id === r.data.comment.id);
  ok(row, "comment missing from the public GET"); eq(row.kind, "comment"); ok(!("email" in row), "email leaked");
});

await t("a lesson question is held, keeps no email, and hands back a code", async () => {
  const r = await call("POST", "/v1/comments", { slug: LESSON, name: "", email: "someone@example.com", body: "Why 6 dB and not 3?" });
  eq(r.status, 201); eq(r.data.question.state, "held"); ok(CODE_RE.test(r.data.code || ""), "no code: " + r.data.code);
  code1 = r.data.code; q1 = r.data.question.id;
  const g = await call("GET", "/v1/comments?slug=" + LESSON);
  ok(!g.data.comments.some(c => c.id === q1), "held question is public");
  const a = await call("GET", "/v1/admin/comments?state=held", undefined, { admin: true });
  const row = a.data.comments.find(c => c.id === q1);
  ok(row, "not in the held list"); eq(row.email, ""); eq(row.kind, "question"); eq(row.visible, 0); ok(row.code_hash && row.code_hash.length === 64, "code_hash");
});

await t("pull with the code returns the waiting question", async () => {
  const r = await call("POST", "/v1/progress/pull", { code: code1.toUpperCase().replace(/-/g, " ") });   // typed loosely on purpose
  eq(r.status, 200); ok(Array.isArray(r.questions) || Array.isArray(r.data.questions));
  const q = r.data.questions.find(x => x.id === q1);
  ok(q, "question missing"); eq(q.state, "held"); eq(q.answers, []);
});

await t("a second question with the same code gets no new code and lands under it", async () => {
  const r = await call("POST", "/v1/comments", { slug: "academy-02-bands-channels-widths", body: "Does DFS apply at 20 MHz?", code: code1 });
  eq(r.status, 201); eq(r.data.code, null); q2 = r.data.question.id;
  const p = await call("POST", "/v1/progress/pull", { code: code1 });
  eq(p.data.questions.map(q => q.id), [q1, q2]);
});

await t("an unknown code on a question gets a fresh code", async () => {
  const r = await call("POST", "/v1/comments", { slug: LESSON, body: "Another one.", code: "yagi-beacon-fresnel-lobe" });
  eq(r.status, 201); ok(CODE_RE.test(r.data.code || ""), "no fresh code");
});

await t("an admin reply with parent_id threads the answer and approves the question", async () => {
  const r = await call("POST", "/v1/admin/comments", { action: "reply", parent_id: q1, body: "Because distance doubles, and power falls with the square." }, { admin: true });
  eq(r.status, 201); eq(r.data.slug, LESSON);
  const g = await call("GET", "/v1/comments?slug=" + LESSON);
  const q = g.data.comments.find(c => c.id === q1), a = g.data.comments.find(c => c.id === r.data.id);
  ok(q, "question not public after the answer"); eq(q.kind, "question");
  ok(a, "answer not public"); eq(a.kind, "answer"); eq(a.parent_id, q1); eq(a.is_author, 1);
  const p = await call("POST", "/v1/progress/pull", { code: code1 });
  const mineQ = p.data.questions.find(x => x.id === q1);
  eq(mineQ.state, "live"); eq(mineQ.answers.length, 1);
});

await t("approve, then hide: a hidden question drops out of the asker's list", async () => {
  let r = await call("POST", "/v1/admin/comments", { action: "approve", id: q2 }, { admin: true });
  eq(r.status, 200);
  r = await call("POST", "/v1/admin/comments", { action: "approve", id: q2 }, { admin: true });
  eq(r.status, 404, "approving twice should say nothing is held");
  r = await call("POST", "/v1/admin/comments", { action: "hide", id: q2 }, { admin: true });
  eq(r.status, 200);
  const row = sql("SELECT state, visible FROM comments WHERE id = " + q2)[0];
  eq([row.state, row.visible], ["hidden", 0]);
  const p = await call("POST", "/v1/progress/pull", { code: code1 });
  ok(!p.data.questions.some(x => x.id === q2), "hidden question still listed");
});

await t("the monitor's four statements work as written", async () => {
  const r = await call("POST", "/v1/comments", { slug: LESSON, body: "My controller at 10.1.2.3 does this." });
  const id = r.data.question.id;
  sql("UPDATE comments SET state = 'live', visible = 1, body = 'My controller at <CONTROLLER-IP> does this.' WHERE id = " + id + " AND kind = 'question' AND state = 'held'");
  sql("INSERT INTO comments (slug, name, email, body, is_author, visible, ip_hash, ua, created_at, kind, state, parent_id, code_hash) VALUES ('" + LESSON + "', 'Dustin', '', 'Answer from the monitor.', 1, 1, '', 'author', '" + iso() + "', 'answer', 'live', " + id + ", '')");
  let g = await call("GET", "/v1/comments?slug=" + LESSON);
  const q = g.data.comments.find(c => c.id === id);
  ok(q && /CONTROLLER-IP/.test(q.body), "scrubbed question not public");
  ok(g.data.comments.some(c => c.parent_id === id && c.kind === "answer"), "monitor answer missing");
  const c = await call("POST", "/v1/comments", { slug: NOTE, body: "Nice post." });
  sql("INSERT INTO comments (slug, name, email, body, is_author, visible, ip_hash, ua, created_at, kind, state, parent_id, code_hash) VALUES ('" + NOTE + "', 'Dustin', '', 'Thanks.', 1, 1, '', 'author', '" + iso() + "', 'comment', 'live', " + c.data.comment.id + ", '')");
  sql("UPDATE comments SET state = 'hidden', visible = 0 WHERE id = " + c.data.comment.id);
  g = await call("GET", "/v1/comments?slug=" + NOTE);
  ok(!g.data.comments.some(x => x.id === c.data.comment.id), "hidden comment still public");
  ok(g.data.comments.some(x => x.parent_id === c.data.comment.id && x.is_author === 1), "reply missing");
  eq(sql("SELECT COUNT(*) AS n FROM comments WHERE (visible = 1) <> (state = 'live')")[0].n, 0, "visible and state disagree somewhere");
});

let code2 = "";
await t("new code, pull, push, and the once-a-minute write limit", async () => {
  const ip = freshIp();
  let r = await call("POST", "/v1/progress/new", { token: "local", data: { w: { "1": { read: "2026-09-20" } }, junk: 1 } }, { ip });
  eq(r.status, 201); ok(CODE_RE.test(r.data.code)); code2 = r.data.code;
  eq(r.data.data.w, { "1": { read: "2026-09-20" } });
  r = await call("POST", "/v1/progress/push", { code: code2, data: { w: { "1": { read: "2026-09-25", lab: "2026-09-26" } } } }, { ip });
  eq(r.status, 200); eq(r.data.stored, false, "first change inside a minute of the mint should wait"); ok(r.data.retry_after > 0);
  sql("UPDATE progress SET written_at = '2026-01-01T00:00:00.000Z'");   // pretend the minute has passed
  r = await call("POST", "/v1/progress/push", { code: code2, data: { w: { "1": { read: "2026-09-25", lab: "2026-09-26" } } } }, { ip });
  eq(r.data.stored, true); eq(r.data.data.w["1"], { lab: "2026-09-26", read: "2026-09-20" });
  r = await call("POST", "/v1/progress/push", { code: code2, data: { w: { "2": { read: "2026-09-27" } } } }, { ip });
  eq(r.data.stored, false, "second change inside the minute should wait");
  r = await call("POST", "/v1/progress/push", { code: code2, data: { w: { "1": { read: "2026-09-21" } } } }, { ip });
  eq(r.data.stored, true, "a push that changes nothing is fine");
  r = await call("POST", "/v1/progress/pull", { code: code2 }, { ip });
  eq(r.data.data.w, { "1": { lab: "2026-09-26", read: "2026-09-20" } });
  eq(r.data.questions, []);
});

await t("ten misses in an hour from one address, then 429", async () => {
  const ip = freshIp();
  for (let i = 0; i < 10; i++) {
    const r = await call("POST", "/v1/progress/pull", { code: "not-a-real-code-at" + "abcdefghij"[i] }, { ip });
    eq(r.status, 404);
  }
  const r = await call("POST", "/v1/progress/pull", { code: code2 }, { ip });
  eq(r.status, 429, "even a good code waits once the address has missed ten times");
  const other = await call("POST", "/v1/progress/pull", { code: code2 });
  eq(other.status, 200, "another address is unaffected");
});

await t("five new codes an hour from one address, then 429", async () => {
  const ip = freshIp();
  for (let i = 0; i < 5; i++) eq((await call("POST", "/v1/progress/new", { token: "local" }, { ip })).status, 201);
  eq((await call("POST", "/v1/progress/new", { token: "local" }, { ip })).status, 429);
});

await t("an oversized push is refused", async () => {
  const big = { code: code2, data: { seen: {} } };
  for (let i = 1; i < 900; i++) big.data.seen[String(i)] = "2026-09-14T10:00:00.000Z";
  const r = await call("POST", "/v1/progress/push", big);
  eq(r.status, 413);
});

await t("the CX Sandbox events still land", async () => {
  const r = await call("POST", "/v1/sandbox/events", { sid: "s-qatest-0001", page: "/sandbox.html", events: [{ lesson: "nac-01-bench", ev: "start" }] });
  eq(r.status, 200); eq(r.data.stored, 1);
});

await t("the daily cron prunes year-old codes and old rate-limit rows", async () => {
  const r = await call("POST", "/v1/comments", { slug: LESSON, body: "An old question." });
  const id = r.data.question.id;
  sql("UPDATE progress SET updated_at = '2024-01-01T00:00:00.000Z' WHERE code_hash = (SELECT code_hash FROM comments WHERE id = " + id + ")");
  sql("INSERT INTO code_misses (ip_hash, created_at) VALUES ('old', '2024-01-01T00:00:00.000Z')");
  let fired = 0;
  for (const p of ["/cdn-cgi/handler/scheduled", "/__scheduled", "/cdn-cgi/local/scheduled"]) {
    const res = await fetch(BASE + p + "?cron=17+9+*+*+*").catch(() => null);
    if (res && res.status < 400) { fired = 1; break; }
  }
  ok(fired, "could not trigger the scheduled handler (start wrangler dev with --test-scheduled)");
  eq(sql("SELECT code_hash FROM comments WHERE id = " + id)[0].code_hash, "", "question still linked to an expired code");
  eq(sql("SELECT COUNT(*) AS n FROM progress WHERE updated_at < '2025-01-01'")[0].n, 0, "expired code still stored");
  eq(sql("SELECT COUNT(*) AS n FROM code_misses WHERE ip_hash = 'old'")[0].n, 0, "old miss still stored");
  ok(sql("SELECT COUNT(*) AS n FROM progress")[0].n > 0, "the cron deleted live codes too");
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
