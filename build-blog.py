#!/usr/bin/env python3
"""Build the single-file blog site from posts/*.md and graphics/*.svg.

Usage:  python3 build-blog.py            -> writes index.html next to this script
Posts:  markdown with a front-matter block (title, slug, date, tags, hero, summary, origin)
Graphics: inline SVG files referenced by name from front-matter `hero`
"""
import os, re, sys, glob, html, datetime, json
try:
    import markdown
except ImportError:
    sys.exit("pip install markdown --break-system-packages")

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = {
    "name": "Ask Me How I Know",
    "tagline": "Field notes from campus networks, wireless, NAC, and the forum threads that keep asking the same question.",
    "author": "Dustin Burns",
    "role": "Lead Mobility Engineer · HPE Aruba Networking and HPE Juniper",
    "airheads": "https://airheads.hpe.com/profile?UserKey=94e7a1d9-a7e0-4e9f-abbc-faa06c06b759",
}

# Public root of the site, no trailing slash. Change this one line when a
# custom domain goes live, then rerun the build.
BASE_URL = "https://loopdetectedlolz.github.io"
CUSTOM_DOMAIN = ""   # e.g. "askmehowiknow.blog" -> writes a CNAME file


def svg(name):
    p = os.path.join(ROOT, "graphics", name)
    if not os.path.exists(p):
        return f'<div class="missing">missing graphic: {html.escape(name)}</div>'
    s = open(p, encoding="utf-8").read()
    s = re.sub(r'<\?xml[^>]*\?>', '', s).strip()
    return s

def parse_post(path):
    raw = open(path, encoding="utf-8").read()
    m = re.match(r'^---\n(.*?)\n---\n(.*)$', raw, re.S)
    if not m:
        sys.exit(f"no front matter: {path}")
    meta = {}
    for line in m.group(1).splitlines():
        if ':' in line:
            k, v = line.split(':', 1)
            meta[k.strip()] = v.strip()
    body = m.group(2)
    body = re.sub(r'```mermaid.*?```', '', body, flags=re.S)  # hero SVGs carry the diagrams
    words = len(re.findall(r'\w+', body))
    meta["readtime"] = max(2, round(words / 220))
    meta["tags"] = [t.strip() for t in meta.get("tags", "").split(",") if t.strip()]
    meta["html"] = markdown.markdown(body, extensions=["fenced_code", "tables"])
    meta["date_obj"] = datetime.date.fromisoformat(meta["date"])
    meta["date_h"] = meta["date_obj"].strftime("%b %d, %Y").replace(" 0", " ")
    return meta

posts = sorted((parse_post(p) for p in glob.glob(os.path.join(ROOT, "posts", "*.md"))),
               key=lambda m: m["date_obj"], reverse=True)
if not posts:
    sys.exit("no posts")

def tagchips(tags):
    return "".join(f'<span class="chip">{html.escape(t)}</span>' for t in tags)

def card(p, featured=False):
    cls = "card featured" if featured else "card"
    return f'''
<a class="{cls}" href="p/{p["slug"]}.html">
  <div class="card-art">{svg(p["hero"])}</div>
  <div class="card-body">
    <div class="eyebrow">{html.escape(p["date_h"])} · {p["readtime"]} min read</div>
    <h3>{html.escape(p["title"])}</h3>
    <p>{html.escape(p["summary"])}</p>
    <div class="chips">{tagchips(p["tags"])}</div>
  </div>
</a>'''

def post_view(i, p):
    prev = posts[i + 1] if i + 1 < len(posts) else None
    nxt = posts[i - 1] if i > 0 else None
    nav = ""
    if prev: nav += f'<a class="pn" href="#/post/{prev["slug"]}"><span class="eyebrow">Older</span>{html.escape(prev["title"])}</a>'
    if nxt: nav += f'<a class="pn right" href="#/post/{nxt["slug"]}"><span class="eyebrow">Newer</span>{html.escape(nxt["title"])}</a>'
    return f'''
<article class="post view" id="post-{p["slug"]}" data-title="{html.escape(p["title"])}">
  <a class="back" href="#/">← All posts</a>
  <div class="eyebrow">{html.escape(p["date_h"])} · {p["readtime"]} min read</div>
  <h1>{html.escape(p["title"])}</h1>
  <p class="lede">{html.escape(p["summary"])}</p>
  <div class="chips">{tagchips(p["tags"])}</div>
  <div class="hero-art">{svg(p["hero"])}</div>
  <div class="origin"><span class="eyebrow">Where this came from</span>{html.escape(p.get("origin",""))}</div>
  <div class="prose">{p["html"]}</div>
  <div class="postnav">{nav}</div>
</article>'''

featured = posts[0]
cards_html = "".join(card(p) for p in posts[1:])
views_html = "".join(post_view(i, p) for i, p in enumerate(posts))
year = datetime.date.today().year

CSS = """
:root{color-scheme:dark;--bg:#0B0F14;--panel:#141C26;--panel2:#18222E;--line:#243040;--txt:#F2F5F8;--muted:#8A99AB;--dim:#5C6B7D;--acc:#8FDB69;--amber:#E0B34E;--blue:#7AB8E8;--red:#F0705F}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--txt);font:16px/1.6 Inter,"Segoe UI",system-ui,-apple-system,sans-serif}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
code,pre{font-family:ui-monospace,Menlo,Consolas,monospace}
.wrap{max-width:1080px;margin:0 auto;padding:0 22px}
header.top{position:sticky;top:0;z-index:5;background:rgba(11,15,20,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;gap:14px;height:64px}
.brand{display:flex;align-items:center;gap:10px;color:var(--txt);font-weight:800;letter-spacing:.2px}
.brand svg{width:34px;height:34px}
.brand:hover{text-decoration:none}
nav.pills{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
nav.pills a{padding:6px 12px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:13px;font-weight:600}
nav.pills a.on,nav.pills a:hover{color:#0B0F14;background:var(--acc);border-color:var(--acc);text-decoration:none}
.eyebrow{color:var(--acc);font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700}
.hero{padding:56px 0 28px}
.hero h1{font-size:clamp(34px,5vw,56px);line-height:1.05;margin:10px 0 14px;letter-spacing:-.5px}
.hero p.tag{color:var(--muted);font-size:18px;max-width:680px;margin:0 0 22px}
.btns{display:flex;gap:10px;flex-wrap:wrap}
.btn{padding:10px 16px;border-radius:10px;font-weight:700;border:1px solid var(--line);color:var(--txt);background:var(--panel)}
.btn.primary{background:var(--acc);color:#0B0F14;border-color:var(--acc)}
.btn:hover{text-decoration:none;filter:brightness(1.08)}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 14px;min-width:120px}
.stat b{display:block;font-size:22px}.stat span{color:var(--muted);font-size:12px}
section{padding:26px 0}
h2.sec{font-size:24px;margin:6px 0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;color:var(--txt);transition:transform .15s,border-color .15s}
.card:hover{transform:translateY(-2px);border-color:var(--acc);text-decoration:none}
.card-art svg{display:block;width:100%;height:auto}
.card-body{padding:16px}
.card h3{margin:6px 0 8px;font-size:18px;line-height:1.3}
.card p{color:var(--muted);margin:0 0 12px;font-size:14px}
.card.featured{grid-column:1/-1;display:grid;grid-template-columns:1.3fr 1fr}
.card.featured .card-art{border-right:1px solid var(--line)}
.card.featured h3{font-size:26px}
.card.featured p{font-size:16px}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{font-size:11px;font-weight:700;letter-spacing:.5px;padding:3px 9px;border-radius:999px;background:#0F1620;border:1px solid var(--line);color:var(--muted)}
.view{display:none}.view.on{display:block}
article.post{max-width:760px;margin:0 auto;padding:30px 0 60px}
article.post h1{font-size:clamp(28px,4vw,42px);line-height:1.1;margin:8px 0 10px;letter-spacing:-.4px}
.lede{color:var(--muted);font-size:18px;margin:0 0 14px}
.back{display:inline-block;margin-bottom:16px;color:var(--muted);font-size:14px}
.hero-art{margin:20px 0 14px;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.hero-art svg{display:block;width:100%;height:auto}
.origin{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--amber);border-radius:10px;padding:12px 16px;color:var(--muted);font-size:14px;margin:0 0 22px}
.origin .eyebrow{display:block;color:var(--amber);margin-bottom:2px}
.prose h2{font-size:22px;margin:34px 0 10px;padding-top:6px}
.prose h3{font-size:18px;margin:26px 0 8px}
.prose p{margin:0 0 16px}
.prose strong{color:#fff}
.prose blockquote{margin:0 0 16px;padding:10px 16px;border-left:3px solid var(--blue);background:var(--panel);color:var(--muted);border-radius:0 8px 8px 0}
.prose pre{background:#0F1620;border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow:auto;font-size:13px;line-height:1.5;margin:0 0 18px}
.prose code{background:#0F1620;border:1px solid var(--line);border-radius:5px;padding:1px 6px;font-size:.9em;color:var(--acc)}
.prose pre code{background:none;border:0;padding:0;color:#D8E4EE}
.prose table{width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px}
.prose th{background:#0F1620;color:var(--acc);text-align:left;padding:9px 10px;border:1px solid var(--line);font-size:12px;letter-spacing:.5px;text-transform:uppercase}
.prose td{padding:9px 10px;border:1px solid var(--line);vertical-align:top}
.prose tr:nth-child(even) td{background:#121A24}
.prose ul,.prose ol{margin:0 0 16px;padding-left:22px}
.prose li{margin:4px 0}
.postnav{display:flex;gap:12px;margin-top:40px;border-top:1px solid var(--line);padding-top:20px}
.pn{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;color:var(--txt);font-weight:600}
.pn.right{text-align:right}.pn .eyebrow{display:block;margin-bottom:2px}.pn:hover{border-color:var(--acc);text-decoration:none}
.two{display:grid;grid-template-columns:1.1fr .9fr;gap:22px;align-items:start}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px}
.panel h3{margin:0 0 8px}
.panel p{color:var(--muted);margin:0 0 10px}
.panel ul{margin:0;padding-left:20px;color:var(--muted)}
.panel li{margin:6px 0}
.panel li b{color:var(--txt)}
.wide svg{display:block;width:100%;height:auto;border-radius:12px}
.about{display:grid;grid-template-columns:200px 1fr;gap:24px;align-items:start}
.avatar{width:200px;height:200px;border-radius:16px;background:linear-gradient(160deg,#18222E,#0F1620);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--acc);font-size:64px;font-weight:800}
.contact{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
footer{border-top:1px solid var(--line);padding:28px 0;color:var(--dim);font-size:13px}
footer .wrap{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.5px}
.badge.green{background:#15351D;color:#7EE08A;border:1px solid #2E6B3A}
.badge.amber{background:#3A2E12;color:#E0B34E;border:1px solid #6B5320}
.badge.blue{background:#14293A;color:#7AB8E8;border:1px solid #2B5378}
.ep{display:grid;grid-template-columns:auto 1fr;gap:12px;padding:10px 0;border-top:1px solid var(--line);align-items:baseline}
.ep .n{font-family:ui-monospace,Menlo,monospace;color:var(--acc);font-weight:700}
.ep b{display:block}
.ep span{color:var(--muted);font-size:14px}
.missing{padding:20px;color:var(--red)}
@media (max-width:820px){.card.featured{grid-template-columns:1fr}.card.featured .card-art{border-right:0;border-bottom:1px solid var(--line)}.two,.about{grid-template-columns:1fr}.avatar{width:120px;height:120px;font-size:40px}}
"""

JS = """
(function(){
  const views=[...document.querySelectorAll('.view')];
  const pills=[...document.querySelectorAll('nav.pills a')];
  function show(id){
    views.forEach(v=>v.classList.toggle('on',v.id===id));
    const sec=id.startsWith('post-')?'home':id;
    pills.forEach(p=>p.classList.toggle('on',p.dataset.v===sec));
    const t=document.getElementById(id);
    document.title=(t&&t.dataset.title?t.dataset.title+' · ':'')+'%NAME%';
    window.scrollTo({top:0});
  }
  function route(){
    const h=location.hash||'#/';
    const m=h.match(/^#\\/post\\/([\\w-]+)/);
    if(m) return location.replace('p/'+m[1]+'.html');
    const s=h.replace(/^#\\/?/,'')||'home';
    show(document.getElementById(s)?s:'home');
  }
  window.addEventListener('hashchange',route); route();
})();
""".replace("%NAME%", SITE["name"])

page = f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(SITE["name"])}</title>
<meta name="description" content="{html.escape(SITE["tagline"])}">
<link rel="canonical" href="{BASE_URL}/">
<link rel="alternate" type="application/rss+xml" title="{html.escape(SITE["name"])}" href="{BASE_URL}/rss.xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{html.escape(SITE["name"])}">
<meta property="og:title" content="{html.escape(SITE["name"])}">
<meta property="og:description" content="{html.escape(SITE["tagline"])}">
<meta property="og:url" content="{BASE_URL}/">
<meta property="og:image" content="{BASE_URL}/og/home.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{html.escape(SITE["name"])}">
<meta name="twitter:description" content="{html.escape(SITE["tagline"])}">
<meta name="twitter:image" content="{BASE_URL}/og/home.png">
<style>{CSS}</style></head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="#/">{svg("mark.svg")}<span>{html.escape(SITE["name"])}</span></a>
  <nav class="pills">
    <a href="#/" data-v="home">Posts</a>
    <a href="#/community" data-v="community">Community</a>
    <a href="#/about" data-v="about">About</a>
  </nav>
</div></header>

<main class="wrap">

<div class="view" id="home" data-title="">
  <div class="hero">
    <div class="eyebrow">{html.escape(SITE["author"])} · {html.escape(SITE["role"])}</div>
    <h1>{html.escape(SITE["name"])}</h1>
    <p class="tag">{html.escape(SITE["tagline"])}</p>
    <div class="btns"><a class="btn primary" href="p/{featured["slug"]}.html">Read the latest</a><a class="btn" href="#/about">Who's writing this</a></div>
    <div class="stats">
      <div class="stat"><b>{len(posts)}</b><span>field notes</span></div>
      <div class="stat"><b>69</b><span>forum replies since July</span></div>
      <div class="stat"><b>6</b><span>Best Answers</span></div>
      <div class="stat"><b>20+</b><span>years in the field</span></div>
    </div>
  </div>
  <section>
    <div class="eyebrow">Latest</div>
    <div class="grid">{card(featured, featured=True)}</div>
  </section>
  <section>
    <div class="eyebrow">More field notes</div>
    <div class="grid">{cards_html}</div>
  </section>
  <section>
    <div class="eyebrow">On deck</div>
    <div class="grid">
      <div class="card"><div class="card-body"><span class="badge amber">DRAFTING</span><h3>EAP-TLS in ClearPass: the ask list is half the project</h3><p>We own ClearPass. The customer owns the Windows CA and Intune. Everything that goes wrong goes wrong in the gap, so here's the ask list and why OCSP isn't optional.</p></div></div>
      <div class="card"><div class="card-body"><span class="badge amber">DRAFTING</span><h3>Wi-Fi 7 without the marketing</h3><p>What the features actually are, when deploying it makes sense, and which ones you turn on without thinking versus which ones you test first.</p></div></div>
      <div class="card"><div class="card-body"><span class="badge blue">CANDIDATE</span><h3>Shared vs local profiles in New Central</h3><p>They look identical in the UI, they're a different object class, and several features silently refuse to work with the wrong one.</p></div></div>
    </div>
  </section>
</div>


<div class="view" id="community" data-title="Community">
  <section>
    <div class="eyebrow">HPE Airheads</div>
    <h2 class="sec">Where the posts come from</h2>
    <div class="wide">{svg("stats.svg")}</div>
  </section>
  <section class="two">
    <div class="panel">
      <h3>The rule for turning a thread into a post</h3>
      <p>I answer a lot of forum threads. Most of them are one-offs. A topic earns a write-up here when it clears a bar I've been keeping myself honest with:</p>
      <ul>
        <li><b>Same root cause, three different titles.</b> "6 GHz radio stays down," "radio disabled due to low power," and "new AP slower than the old one" are one problem.</li>
        <li><b>A misconception, not a bug.</b> People misunderstanding how a feature or a piece of hardware behaves. Bugs get fixed; misconceptions get re-asked forever.</li>
        <li><b>Stable enough to write down.</b> If the answer changes every maintenance release, it's a forum reply, not a post.</li>
        <li><b>A post lets me answer the next thread with a link.</b> That's the whole point.</li>
      </ul>
    </div>
    <div class="panel">
      <h3>What I've noticed after seventy replies</h3>
      <p>The threads that go unanswered longest aren't the hard ones. They're the mis-filed ones: an AOS-CX question on the Comware board, an Instant question on a switching board. Nobody who knows the answer is reading that board.</p>
      <p>The second pattern is a plan with a trap in it. The poster's end goal is achievable, but the exact steps they've written down will do something they don't expect. Those are the replies worth the most, because the thread looks fine until you read the plan as a sequence.</p>
      <p>And the best answers I've written weren't the longest. The 6410 VSX one was three short paragraphs and a question. The question was the answer.</p>
      <div class="chips" style="margin-top:12px"><span class="badge green">MVP EXPERT</span><span class="chip">Wireless Access</span><span class="chip">Security</span><span class="chip">Wired Intelligent Edge</span><span class="chip">Cloud Managed Networks</span><span class="chip">Comware</span></div>
    </div>
  </section>
  <section>
    <div class="panel">
      <h3>Recent threads that turned into something</h3>
      <div class="ep"><span class="n">BEST</span><div><b>c6400 VSX peer failing to forward traffic during upgrade</b><span>Manual reboot, 180 second linkup delay, BGP holdtimer. Marked Best Answer inside a day and became the VSX post above.</span></div></div>
      <div class="ep"><span class="n">CONFIRMED</span><div><b>Migrating Instant APs from AirWave to AOS-8 controllers</b><span>The one-AP pilot that would have converted all hundred. The poster changed the plan to an isolated cluster of one.</span></div></div>
      <div class="ep"><span class="n">CONFIRMED</span><div><b>Comware 5140 port-based MAC auth</b><span>No dynamic port mode for MAC auth on Comware; make the AP an 802.1X supplicant instead. An HPE engineer independently landed on the same answer.</span></div></div>
      <div class="ep"><span class="n">CONFIRMED</span><div><b>New Central blocking VLAN creation on AOS-S</b><span>Library versus local profile model. Looks identical in the UI, isn't.</span></div></div>
      <div class="ep"><span class="n">BEST</span><div><b>AOS-10 Framed-IP missing from Accounting-Start</b><span>Where the IP actually shows up in the accounting stream and why the start record can't carry it.</span></div></div>
    </div>
  </section>
</div>


<div class="view" id="about" data-title="About">
  <section class="about">
    <div class="avatar">DB</div>
    <div>
      <div class="eyebrow">About</div>
      <h2 class="sec">{html.escape(SITE["author"])}</h2>
      <p style="color:var(--muted);font-size:17px">I design, migrate, and fix campus networks for a living: HPE Aruba Networking wireless and switching, ClearPass and NAC, Juniper Mist, and the Ekahau surveys that decide where the APs actually go. Twenty-some years of it, most of that in New England, currently as Lead Mobility Engineer on the Campus and Mobility team at WEI.</p>
      <p style="color:var(--muted)">This site is mine. The opinions are mine, the mistakes are mine, and the configs are scrubbed placeholders, so don't paste them anywhere you care about without reading them first. Customers are never named. Forum posters are only ever "somebody."</p>
      <p style="color:var(--muted)">I spend a lot of evenings on HPE Airheads answering the same questions in different clothes, which is where most of these posts come from. If you've got a plan with a trap in it, a doc that contradicts itself, or a room full of APs that "feel slow," I'd like to hear about it.</p>
      <div class="contact">
        <a class="btn primary" href="{SITE["airheads"]}" target="_blank" rel="noopener">Find me on Airheads</a>
      </div>
      <div class="chips" style="margin-top:18px"><span class="chip">HPE Aruba Networking</span><span class="chip">AOS-CX</span><span class="chip">AOS-8 / AOS-10</span><span class="chip">ClearPass</span><span class="chip">Central</span><span class="chip">Juniper Mist</span><span class="chip">Ekahau</span><span class="chip">Wi-Fi 6E / 7</span><span class="chip">EVPN-VXLAN</span></div>
    </div>
  </section>
</div>

</main>
<footer><div class="wrap"><span>© {year} {html.escape(SITE["author"])}. Personal site. Configs are placeholders; customers are never named.</span><span>Built from {len(posts)} posts and {len(glob.glob(os.path.join(ROOT,"graphics","*.svg")))} hand-drawn graphics.</span></div></footer>
<script>{JS}</script>
</body></html>'''

out = os.path.join(ROOT, "index.html")
open(out, "w", encoding="utf-8").write(page)
print(f"wrote {out} ({len(page)//1024} KB), {len(posts)} posts")
for p in posts:
    print(f"  {p['date']}  {p['title']}  [{p['hero']}]")

# ─────────────────────────────────────────────────────────────────────────────
# Multi-page output: one real HTML file per post, OG cards, sitemap, RSS.
# Placeholders use @@TOKEN@@ rather than % or {} so CSS survives untouched.
# ─────────────────────────────────────────────────────────────────────────────
import subprocess, textwrap, email.utils, shutil

E = lambda t: html.escape(str(t), quote=True)

PAGE_SHELL = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>@@TITLE@@</title>
<meta name="description" content="@@DESC@@">
<link rel="canonical" href="@@URL@@">
<link rel="alternate" type="application/rss+xml" title="@@SITENAME@@" href="@@BASE@@/rss.xml">
<meta property="og:type" content="article">
<meta property="og:site_name" content="@@SITENAME@@">
<meta property="og:title" content="@@TITLE@@">
<meta property="og:description" content="@@DESC@@">
<meta property="og:url" content="@@URL@@">
<meta property="og:image" content="@@OGIMG@@">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="article:published_time" content="@@DATE@@">
<meta property="article:author" content="@@AUTHOR@@">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="@@TITLE@@">
<meta name="twitter:description" content="@@DESC@@">
<meta name="twitter:image" content="@@OGIMG@@">
<script type="application/ld+json">@@JSONLD@@</script>
<style>@@CSS@@</style></head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="../">@@MARK@@<span>@@SITENAME@@</span></a>
  <nav class="pills">
    <a href="../">Posts</a>
    <a href="../#/community">Community</a>
    <a href="../#/about">About</a>
  </nav>
</div></header>
<main class="wrap">
@@BODY@@
</main>
<footer><div class="wrap"><span>&copy; @@YEAR@@ @@AUTHOR@@. Personal site. Configs are placeholders; customers are never named.</span><span><a href="../rss.xml">RSS</a></span></div></footer>
</body></html>
"""

def og_card(title, eyebrow, path):
    """Render a 1200x630 preview card via rsvg-convert."""
    lines = textwrap.wrap(title, 26)[:4]
    y0 = 300 - (len(lines) - 1) * 37
    tspans = "".join(
        '<text x="80" y="%d" fill="#F2F5F8" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" '
        'font-size="62" font-weight="700">%s</text>' % (y0 + i * 74, E(l))
        for i, l in enumerate(lines))
    svg_doc = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">'
        '<rect width="1200" height="630" fill="#0B0F14"/>'
        '<rect x="0" y="0" width="1200" height="8" fill="#8FDB69"/>'
        '<text x="80" y="120" fill="#8FDB69" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" '
        'font-size="26" font-weight="700" letter-spacing="4">' + E(eyebrow.upper()) + '</text>'
        + tspans +
        '<text x="80" y="556" fill="#8A99AB" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" '
        'font-size="27">' + E(SITE["author"]) + '  &#183;  ' + E(SITE["name"]) + '</text>'
        '<rect x="80" y="576" width="120" height="5" fill="#8FDB69"/>'
        '</svg>')
    tmp = os.path.join(ROOT, "_og_tmp.svg")
    open(tmp, "w", encoding="utf-8").write(svg_doc)
    subprocess.run(["rsvg-convert", "-w", "1200", "-h", "630", tmp, "-o", path], check=True)
    os.remove(tmp)

# ── directories ──────────────────────────────────────────────────────────────
POSTDIR = os.path.join(ROOT, "p")
OGDIR = os.path.join(ROOT, "og")
for d in (POSTDIR, OGDIR):
    os.makedirs(d, exist_ok=True)

MARK = svg("mark.svg")

# ── one page per post ────────────────────────────────────────────────────────
for i, p in enumerate(posts):
    prev = posts[i + 1] if i + 1 < len(posts) else None
    nxt = posts[i - 1] if i > 0 else None
    nav = ""
    if prev:
        nav += '<a class="pn" href="%s.html"><span class="eyebrow">Older</span>%s</a>' % (prev["slug"], E(prev["title"]))
    if nxt:
        nav += '<a class="pn right" href="%s.html"><span class="eyebrow">Newer</span>%s</a>' % (nxt["slug"], E(nxt["title"]))

    url = "%s/p/%s.html" % (BASE_URL, p["slug"])
    ogimg = "%s/og/%s.png" % (BASE_URL, p["slug"])
    og_card(p["title"], p["tags"][0] if p["tags"] else "Field note",
            os.path.join(OGDIR, p["slug"] + ".png"))

    jsonld = json.dumps({
        "@context": "https://schema.org", "@type": "BlogPosting",
        "headline": p["title"], "description": p["summary"],
        "datePublished": p["date"], "image": ogimg,
        "author": {"@type": "Person", "name": SITE["author"]},
        "publisher": {"@type": "Person", "name": SITE["author"]},
        "mainEntityOfPage": url, "keywords": ", ".join(p["tags"]),
    })

    body = ('<article class="post">'
            '<a class="back" href="../">&larr; All field notes</a>'
            '<div class="eyebrow">' + E(p["date_h"]) + ' &#183; ' + str(p["readtime"]) + ' min read</div>'
            '<h1>' + E(p["title"]) + '</h1>'
            '<p class="lede">' + E(p["summary"]) + '</p>'
            '<div class="chips">' + tagchips(p["tags"]) + '</div>'
            '<div class="hero-art">' + svg(p["hero"]) + '</div>'
            '<div class="origin"><span class="eyebrow">Where this came from</span>' + E(p.get("origin", "")) + '</div>'
            '<div class="prose">' + p["html"] + '</div>'
            '<div class="postnav">' + nav + '</div>'
            '</article>')

    page_html = PAGE_SHELL
    for token, val in (("@@TITLE@@", E(p["title"])), ("@@DESC@@", E(p["summary"])),
                       ("@@URL@@", url), ("@@OGIMG@@", ogimg), ("@@DATE@@", p["date"]),
                       ("@@AUTHOR@@", E(SITE["author"])), ("@@SITENAME@@", E(SITE["name"])),
                       ("@@BASE@@", BASE_URL), ("@@JSONLD@@", jsonld), ("@@CSS@@", CSS),
                       ("@@MARK@@", MARK), ("@@BODY@@", body), ("@@YEAR@@", str(year))):
        page_html = page_html.replace(token, val)
    open(os.path.join(POSTDIR, p["slug"] + ".html"), "w", encoding="utf-8").write(page_html)

# ── home OG card ─────────────────────────────────────────────────────────────
og_card(SITE["tagline"][:110], "Field notes", os.path.join(OGDIR, "home.png"))

# ── sitemap ──────────────────────────────────────────────────────────────────
urls = ['<url><loc>%s/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>' % BASE_URL]
urls += ['<url><loc>%s/p/%s.html</loc><lastmod>%s</lastmod><priority>0.8</priority></url>'
         % (BASE_URL, p["slug"], p["date"]) for p in posts]
open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8").write(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(urls) + '\n</urlset>\n')

# ── RSS ──────────────────────────────────────────────────────────────────────
def rfc822(d):
    return email.utils.format_datetime(datetime.datetime.combine(d, datetime.time(12, 0),
                                       tzinfo=datetime.timezone.utc))

items = "".join(
    '<item><title>%s</title><link>%s/p/%s.html</link><guid isPermaLink="true">%s/p/%s.html</guid>'
    '<pubDate>%s</pubDate><description>%s</description>%s</item>\n'
    % (E(p["title"]), BASE_URL, p["slug"], BASE_URL, p["slug"], rfc822(p["date_obj"]),
       E(p["summary"]), "".join('<category>%s</category>' % E(t) for t in p["tags"]))
    for p in posts)

open(os.path.join(ROOT, "rss.xml"), "w", encoding="utf-8").write(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>\n'
    '<title>%s</title>\n<link>%s/</link>\n<description>%s</description>\n'
    '<language>en-us</language>\n<lastBuildDate>%s</lastBuildDate>\n'
    '<atom:link href="%s/rss.xml" rel="self" type="application/rss+xml"/>\n%s</channel></rss>\n'
    % (E(SITE["name"]), BASE_URL, E(SITE["tagline"]), rfc822(posts[0]["date_obj"]), BASE_URL, items))

# ── robots, Pages housekeeping ───────────────────────────────────────────────
open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8").write(
    "User-agent: *\nAllow: /\nSitemap: %s/sitemap.xml\n" % BASE_URL)
open(os.path.join(ROOT, ".nojekyll"), "w", encoding="utf-8").write("")
cname = os.path.join(ROOT, "CNAME")
if CUSTOM_DOMAIN:
    open(cname, "w", encoding="utf-8").write(CUSTOM_DOMAIN + "\n")
elif os.path.exists(cname):
    os.remove(cname)

print("  + %d post pages in p/, %d OG cards in og/, sitemap.xml, rss.xml, robots.txt"
      % (len(posts), len(posts) + 1))
print("  base URL: %s" % BASE_URL)
