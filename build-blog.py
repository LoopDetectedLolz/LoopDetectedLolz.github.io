#!/usr/bin/env python3
"""Build Network Field Notes from posts/*.md and graphics/*.svg.

Design system: theme/style.css and theme/app.js, per DESIGN-KIT.md.
Usage: python3 build-blog.py   ->  index.html, p/<slug>.html, socials.html, og/, sitemap, rss
"""
import os, re, sys, glob, html, json, datetime, subprocess, shutil, textwrap, email.utils

try:
    import markdown
except ImportError:
    sys.exit("python3 -m pip install --user markdown")

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = {
    "name": "Network Field Notes",
    "tagline": "Campus networks, wireless, NAC, and the forum threads that keep asking the same question.",
    "author": "Dustin Burns",
    "role": "Lead Mobility Engineer · HPE Aruba Networking and HPE Juniper Networking",
    "airheads": "https://airheads.hpe.com/profile?UserKey=94e7a1d9-a7e0-4e9f-abbc-faa06c06b759",
    "linkedin": "https://www.linkedin.com/in/dustinburns3020/",
}
COMMENTS_API = "https://api.networkfieldnotes.com"   # empty this line to turn comments off everywhere
TURNSTILE_SITEKEY = "0x4AAAAAAE0IseyiQ4X9zk6r"   # public half of the Turnstile widget, safe in the page
SANDBOX_API = COMMENTS_API                        # the CX Sandbox sends anonymous usage events here; empty it to send nothing
# Local end-to-end tests only: point a throwaway copy of the site at `wrangler dev` and Turnstile's test key.
# Never set these for a real build; the build says so on every run when they are.
if os.environ.get("NFN_TEST_API"):
    COMMENTS_API = SANDBOX_API = os.environ["NFN_TEST_API"]
    TURNSTILE_SITEKEY = os.environ.get("NFN_TEST_SITEKEY", TURNSTILE_SITEKEY)
    print("TEST BUILD: comments, questions and codes point at %s. Do not commit or push this build." % COMMENTS_API, file=sys.stderr)
BASE_URL = "https://networkfieldnotes.com"
CUSTOM_DOMAIN = "networkfieldnotes.com"

E = lambda t: html.escape(str(t), quote=True)
CSS = open(os.path.join(ROOT, "theme", "style.css"), encoding="utf-8").read()
JS = open(os.path.join(ROOT, "theme", "app.js"), encoding="utf-8").read()
GROUND_JS = open(os.path.join(ROOT, "theme", "ground.js"), encoding="utf-8").read()

def svg(name):
    p = os.path.join(ROOT, "graphics", name)
    if not os.path.exists(p):
        return '<div class="panel panel-pad">missing graphic: %s</div>' % E(name)
    s = open(p, encoding="utf-8").read()
    return re.sub(r'<\?xml[^>]*\?>', '', s).strip()

# mascot pose by subject; front matter `bot:` overrides
BOTS = [
    (("survey", "ekahau", "heatmap", "channel"), "nfn-bot-survey.svg"),
    (("clearpass", "saml", "entra", "nac", "eap-tls", "intune", "radius"), "nfn-bot-lab.svg"),
    (("switching", "aos-cx", "vsx", "poe", "switch"), "nfn-bot-switchwork.svg"),
    (("wireless", "wi-fi", "airtime", "mdns", "rf"), "nfn-bot-signal.svg"),
]
def bot_for(meta):
    if meta.get("bot"):
        return meta["bot"]
    hay = " ".join(meta.get("tags", []) + [meta.get("title", "")]).lower()
    for keys, f in BOTS:
        if any(re.search(r"(?<![a-z])" + re.escape(k) + r"(?![a-z])", hay) for k in keys):
            return f
    return "nfn-bot-think.svg"

# ── "what the box said" terminal blocks ──────────────────────────────────────
# ```term fences become a terminal panel. Lines that look like a prompt get the prompt colour,
# lines ending in "  <<" get highlighted (the marker is removed).
_PROMPT = re.compile(r'^(\(?[\w.-]+\)?\s?[#$>]\s|[\w.-]+[#>]\s|\$\s|C:\\[^>]*>\s?)')
def terminalize(h):
    def one(m):
        code = html.unescape(m.group(1))
        out = []
        for line in code.rstrip("\n").split("\n"):
            hot = line.endswith("  <<")
            if hot: line = line[:-4].rstrip()
            pm = _PROMPT.match(line)
            if pm:
                line = '<span class="pr">%s</span>%s' % (E(pm.group(0)), E(line[pm.end():]))
            else:
                line = E(line)
            out.append('<span class="ln%s">%s</span>' % (" hot" if hot else "", line or " "))
        return ('<div class="term"><div class="term-bar"><i></i><i></i><i></i><b>what the box said</b></div>'
                '<pre><code>%s</code></pre></div>' % "".join(out))
    return re.sub(r'<pre><code class="language-term">(.*?)</code></pre>', one, h, flags=re.S)

def widget(name, up="../"):
    path = os.path.join(ROOT, "theme", "widgets", name + ".html")
    return open(path, encoding="utf-8").read() if os.path.exists(path) else ""

def comments_block(p):
    """Comment section for a post. Off when COMMENTS_API is empty or the post says comments: off."""
    if not COMMENTS_API or str(p.get("comments", "")).strip().lower() in ("off", "no", "false"):
        return ""
    return (widget("comments")
            .replace("__SLUG__", E(p["slug"]))
            .replace("__API__", E(COMMENTS_API.rstrip("/")))
            .replace("__SITEKEY__", E(TURNSTILE_SITEKEY)))

# ── Academy: questions, progress, save codes, the self-check ─────────────────
# theme/progress-core.js is the record and its merge (the Worker runs the same file), theme/progress.js the
# browser side, theme/progress.css the look. Lessons, academy.html and sandbox.html only; field notes get none of it.
PROGRESS_CORE = open(os.path.join(ROOT, "theme", "progress-core.js"), encoding="utf-8").read()
PROGRESS_JS = open(os.path.join(ROOT, "theme", "progress.js"), encoding="utf-8").read()
PROGRESS_CSS = open(os.path.join(ROOT, "theme", "progress.css"), encoding="utf-8").read()

def progress_scripts(lesson=0):
    cfg = {"api": COMMENTS_API.rstrip("/"), "sitekey": TURNSTILE_SITEKEY}
    if lesson:
        cfg["lesson"] = int(lesson)
    js = lambda s: s.replace("</", "<\\/")
    return ('<style>%s</style><script>window.NFN_CFG=%s;</script><script>%s</script><script>%s</script>'
            % (PROGRESS_CSS, json.dumps(cfg), js(PROGRESS_CORE), js(PROGRESS_JS)))

def has_game(p):
    """A lesson's game is any interactive widget that reports its last level to NFNProgress."""
    return bool(p.get("interactive")) and "NFNProgress" in widget(p["interactive"])

def progress_block(p):
    check = '<li data-k="check"><i class="pip"></i><span>Self-check</span><b>0 of 3</b></li>' if p.get("selfcheck") else ""
    game = '<li data-k="game"><i class="pip"></i><span>Game</span><b>Not yet</b></li>' if has_game(p) else ""
    return widget("progress").replace("__CHECK__", check).replace("__GAME__", game)

def qa_block(p):
    """Ask about this lesson: questions held for Dustin, answers threaded under them, the asker's save code."""
    if not COMMENTS_API or str(p.get("comments", "")).strip().lower() in ("off", "no", "false"):
        return ""
    return (widget("qa")
            .replace("__SLUG__", E(p["slug"]))
            .replace("__API__", E(COMMENTS_API.rstrip("/")))
            .replace("__SITEKEY__", E(TURNSTILE_SITEKEY)))

def codebox_block():
    if not COMMENTS_API:
        return ""
    return ('<section class="codebox g-card" id="codebox" data-rise><div><h3>Continue on another device</h3>'
            '<p>Your progress lives in this browser. A code copies it to my server so you can pick it up on another device. '
            'Codes nobody uses for a year get deleted.</p></div><div class="cb-ui"></div></section>')

SC_RE = re.compile(r'(<h2>Three questions</h2>\s*)<ol>(.*?)</ol>\s*<h2>Answers</h2>\s*<ol>(.*?)</ol>', re.S)
LI_RE = re.compile(r'<li>(.*?)</li>', re.S)
def selfcheck(html):
    """'## Three questions' followed by '## Answers' (same numbering) becomes a self-check: each answer behind a
    reveal, Got it and Not yet under it. Plain <details>, so the answers still open without JavaScript."""
    m = SC_RE.search(html)
    if not m:
        return html, False
    qs, ans = LI_RE.findall(m.group(2)), LI_RE.findall(m.group(3))
    if not qs or len(qs) != len(ans):
        sys.exit("self-check: %d questions against %d answers" % (len(qs), len(ans)))
    items = "".join(
        '<li class="sc-q"><div class="sc-text">%s</div><details class="sc-a"><summary>Show answer</summary>'
        '<div class="sc-body">%s</div><div class="sc-grade" hidden><button type="button" class="chip sc-got">Got it</button>'
        '<button type="button" class="chip sc-not">Not yet</button><span class="sc-say" role="status"></span></div></details></li>'
        % (q, a) for q, a in zip(qs, ans))
    return html[:m.start()] + m.group(1) + '<ol class="selfcheck">' + items + '</ol>' + html[m.end():], True

LABDONE_RE = re.compile(r'<p>\{\{labdone\}\}</p>')
def labdone(html):
    """{{labdone}} on its own line at the end of a lesson's lab section: the progress card's "I ran this lab" button, inline."""
    return LABDONE_RE.sub('<div class="labdone"><button type="button" class="btn nfn-btn" data-nfn-lab>I ran this lab</button></div>', html)

def series_nav(p):
    if not p["series"]: return ""
    members = sorted([q for q in posts if q["series"] == p["series"]], key=lambda q: q["series_order"])
    if len(members) < 2: return ""
    idx = members.index(p)
    tiles = "".join(
        '<a class="ser-step%s" href="%s.html"><span class="ser-n">%d</span><span class="ser-t">%s</span>%s</a>' % (
            " here" if q is p else (" next" if i == idx + 1 else ""), E(q["slug"]), i + 1, E(q["title"]),
            '<span class="ser-tag">You are here</span>' if q is p else ('<span class="ser-tag">Next</span>' if i == idx + 1 else ""))
        for i, q in enumerate(members))
    return ('<section class="series g-card" data-rise><span class="eyebrow">Reading path</span>'
            '<h3>%s <span class="meta">part %d of %d</span></h3><div class="ser-steps">%s</div></section>'
            % (E(p["series"]), idx + 1, len(members), tiles))

FIG_RE = re.compile(r'<p>\{\{figure:\s*([^|}]+?)\s*(?:\|\s*(.*?)\s*)?\}\}</p>', re.S)
def figures(html):
    """{{figure: name.svg | optional caption}} on its own line becomes an inlined figure."""
    def one(m):
        cap = (m.group(2) or "").strip()
        return '<figure class="figure panel">%s%s</figure>' % (
            svg(m.group(1).strip()),
            '<figcaption>%s</figcaption>' % cap if cap else '')
    return FIG_RE.sub(one, html)

WIDGET_RE = re.compile(r'<p>\{\{widget:\s*([a-z0-9-]+)\s*\}\}</p>')
def widgets(html):
    """{{widget: name}} on its own line inlines theme/widgets/<name>.html in the body, for a
    teaching device that belongs beside a paragraph rather than under the hero."""
    def one(m):
        w = widget(m.group(1))
        if not w: sys.exit("no widget theme/widgets/%s.html" % m.group(1))
        return w
    return WIDGET_RE.sub(one, html)

# ── CX Sandbox ───────────────────────────────────────────────────────────────
# {{cxsim: lesson-id}} (or {{cxsim}} for the free sandbox) on its own line becomes a modelled
# AOS-CX terminal. The lesson JSON from theme/cxsim/lessons/ is inlined into the div and the
# engine plus widget are appended once per page, so the post works offline like everything else.
CXSIM_RE = re.compile(r'<p>\{\{cxsim(?::\s*([^}]+?))?\s*\}\}</p>')
def cxsim(html):
    def one(m):
        lid = (m.group(1) or "sandbox").strip()
        path = os.path.join(ROOT, "theme", "cxsim", "lessons", lid + ".json")
        if not os.path.exists(path):
            sys.exit("no lesson theme/cxsim/lessons/%s.json" % lid)
        data = json.dumps(json.load(open(path, encoding="utf-8")), separators=(",", ":")).replace("</", "<\\/")
        return '<div class="cxsim widget" data-lesson="%s"><script type="application/json">%s</script></div>' % (E(lid), data)
    return CXSIM_RE.sub(one, html)
def cxsim_block():
    engine = open(os.path.join(ROOT, "theme", "cxsim", "engine.js"), encoding="utf-8").read()
    # the real 10.18 command set (cxcorpus.py), loaded before the engine so an unmodelled command gets the box's answer
    cpath = os.path.join(ROOT, "theme", "cxsim", "corpus", "aoscx.js")
    corpus = "<script>%s</script>" % open(cpath, encoding="utf-8").read().replace("</", "<\\/") if os.path.exists(cpath) else ""
    # the command notes (theme/cxsim/notes.json, checked by cxnotes.js) feed the widget's About this command panel
    npath = os.path.join(ROOT, "theme", "cxsim", "notes.json")
    notes = "<script>self.CXNotes=%s;</script>" % json.dumps(json.load(open(npath, encoding="utf-8")), separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/") if os.path.exists(npath) else ""
    return "%s%s<script>%s</script>%s" % (corpus, notes, engine, widget("cxsim").replace("__SBAPI__", E(SANDBOX_API.rstrip("/"))))

def parse_post(path):
    raw = open(path, encoding="utf-8").read()
    m = re.match(r'^---\n(.*?)\n---\n(.*)$', raw, re.S)
    if not m:
        sys.exit("no front matter: %s" % path)
    meta = {}
    for line in m.group(1).splitlines():
        if ':' in line:
            k, v = line.split(':', 1)
            meta[k.strip()] = v.strip()
    body = re.sub(r'```mermaid.*?```', '', m.group(2), flags=re.S)
    meta["readtime"] = max(2, round(len(re.findall(r'\w+', body)) / 220))
    meta["tags"] = [t.strip() for t in meta.get("tags", "").split(",") if t.strip()]
    rendered = terminalize(markdown.markdown(body, extensions=["fenced_code", "tables"]))
    meta["cxsim"] = bool(CXSIM_RE.search(rendered))
    rendered, meta["selfcheck"] = selfcheck(rendered)
    meta["html"] = labdone(cxsim(widgets(figures(rendered))))
    meta["series"] = meta.get("series", "").strip()
    meta["series_order"] = int(meta.get("series_order", "0") or 0)
    meta["interactive"] = meta.get("interactive", "").strip()
    meta["date_obj"] = datetime.date.fromisoformat(meta["date"])
    meta["date_h"] = meta["date_obj"].strftime("%b %d, %Y").replace(" 0", " ")
    meta["bot_explicit"] = bool(meta.get("bot"))
    meta["bot"] = bot_for(meta)
    return meta

posts = sorted((parse_post(p) for p in glob.glob(os.path.join(ROOT, "posts", "*.md"))),
               key=lambda m: m["date_obj"], reverse=True)
if not posts:
    sys.exit("no posts")
year = datetime.date.today().year
featured = next((p for p in posts if not p.get("academy")), posts[0])   # index hero is the latest field note; Academy has its own

# ── categories, sources ─────────────────────────────────────────────────────
CAT_MAP = {"clearpass": "NAC", "process": "Docs", "documentation": "Docs", "switching": "Switching", "wireless": "Wireless"}
CAT_CLASS = {"Wireless": "c-green", "NAC": "c-blue", "Lab": "c-red", "Academy": "c-orange"}
def category(p):
    if any(t.lower() in ("survey", "ekahau") for t in p["tags"]):
        return "RF survey"
    first = (p["tags"][0] if p["tags"] else "Field note")
    return CAT_MAP.get(first.lower(), first)
def source(p):
    o = p.get("origin", "").lower()
    if "reddit" in o: return "Reddit thread"
    if "airheads" in o or "thread" in o: return "Airheads thread"
    if "lab" in o: return "Lab build"
    if "engagement" in o or "customer" in o or "site" in o: return "Field engagement"
    return "Field note"
for p in posts:
    p["cat"] = category(p); p["src"] = source(p)
    if p["src"] == "Lab build": p["cat"] = "Lab"
    p["academy"] = int(p.get("academy", "0") or 0)
    if p["academy"]:
        p["cat"] = "Academy"; p["src"] = "Wireless Academy"
        p["series"] = "Wireless Academy"; p["series_order"] = p["academy"]
        if not p["bot_explicit"]: p["bot"] = "nfn-bot-think.svg"
    p["ccls"] = CAT_CLASS.get(p["cat"], "")
from collections import Counter
_cnt = Counter(p["cat"] for p in posts)
CATS = [c for c, _ in _cnt.most_common()]
_acad = [p for p in posts if p["academy"]]
if _acad:
    print("self-check: %d of %d lessons have an Answers section" % (sum(1 for p in _acad if p["selfcheck"]), len(_acad)))

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">')
ICO_SEARCH = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">'
              '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>')
ICO_CHAT = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/></svg>')
ICO_BACK = ('<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M14 6l-6 6 6 6"/></svg>')

def head(title, desc, url, ogimg, up="", extra="", active="posts", search=False, theme="", wide=False):
    root = up or "/"
    nav = ('<a class="pill%s" href="%s">Posts</a>' % (" on" if active == "posts" else "", root))
    nav += '<a class="pill%s" href="%sacademy.html">Academy</a>' % (" on" if active == "academy" else "", up)
    nav += '<a class="pill%s" href="%stools.html">Tools</a>' % (" on" if active == "tools" else "", up)
    nav += '<a class="pill%s" href="%sabout.html">About</a>' % (" on" if active == "about" else "", up)
    if search:
        nav += '<a class="pill outline" id="search-toggle" href="#search" aria-label="Search">%s<span>Search</span></a>' % ICO_SEARCH
    else:
        nav += '<a class="pill outline" href="%sindex.html#search">%s<span>Search</span></a>' % (up, ICO_SEARCH)
    body_cls = (' class="%s"' % theme) if theme else ""
    searchbox = '<div class="search" id="search"><input id="q" type="search" placeholder="Search field notes" autocomplete="off"></div>' if search else ""
    return f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{E(title)}</title>
<meta name="description" content="{E(desc)}">
<link rel="canonical" href="{url}">
<link rel="icon" type="image/svg+xml" href="/logo/nfn-favicon.svg">
<link rel="icon" type="image/png" sizes="512x512" href="/logo/nfn-favicon-512.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="{E(SITE["name"])}" href="{BASE_URL}/rss.xml">
<meta property="og:site_name" content="{E(SITE["name"])}">
<meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{ogimg}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{E(title)}">
<meta name="twitter:description" content="{E(desc)}">
<meta name="twitter:image" content="{ogimg}">
{extra}
{FONTS}
<style>{CSS}</style></head>
<body{body_cls}>
<div class="ground"></div>
<canvas id="nfn-fx" aria-hidden="true"></canvas>
<div class="gx-pane" aria-hidden="true"></div>
<div class="gx-grain" aria-hidden="true"></div>
<div class="page">
<header class="hdr"><div class="wrap{" wide" if wide else ""}"><div class="hdr-in g-chrome">
  <a class="brand" href="{root}"><span class="mk"><img src="{up}logo/nfn-mark-dark.svg" alt="" width="26" height="26"></span><span class="wm">{E(SITE["name"])}</span></a>
  <nav class="nav">{nav}</nav>
  {searchbox}
</div></div></header>
<main class="wrap{" wide" if wide else ""}">'''

def foot(bot, up="", wide=False):
    return f'''</main>
<a class="rig" href="{up}socials.html" data-origin="genie" aria-label="Where else to find me"><img src="{up}character/{bot}" alt="" width="104" height="104"></a>
<footer><div class="wrap{" wide" if wide else ""}">
  <span>&copy; {year} {E(SITE["author"])}. Personal site. Configs are placeholders; customers are never named.</span>
  <span><a href="/rss.xml">RSS</a></span>
</div></footer>
</div>
<script>{JS}</script>
<script>{GROUND_JS}</script>
</body></html>'''


def card(p, featured=False):
    text = (p["title"] + " " + p["summary"] + " " + " ".join(p["tags"])).lower()
    ins = " data-inseries" if p["slug"] in IN_SERIES else ""
    # the featured post already sits in the hero; its card only appears once a filter or search is active
    return f'''<a class="card g-card{" hidden" if featured else ""}" href="p/{p["slug"]}.html" data-origin="zoom" data-rise data-cat="{E(p["cat"])}" data-text="{E(text)}"{ins}{" data-featured" if featured else ""}>
  <div class="card-top"><span class="tag {p["ccls"]}">{E(p["cat"])}</span><span class="meta">{("Lesson %d" % p["academy"]) if p.get("academy") else E(p["date_obj"].strftime("%b %d").replace(" 0"," "))}</span></div>
  <h3 class="h-card">{E(p["title"])}</h3>
  <p>{E(p["summary"])}</p>
  <div class="card-foot"><span class="src">{ICO_CHAT}{E(p["src"])}</span><b>{p["readtime"]} min</b></div>
</a>'''

# ── series grouping ─────────────────────────────────────────────────────────
# A series with two or more posts collapses into one tile. Every post still gets
# its own card so search can find it; the card just hides until a query is typed.
_by_series = {}
for _p in posts:
    _s = (_p.get("series") or "").strip()
    if _s:
        _by_series.setdefault(_s, []).append(_p)
SERIES = {k: sorted(v, key=lambda x: int(x.get("series_order") or 0))
          for k, v in _by_series.items() if len(v) >= 2}
IN_SERIES = {q["slug"] for v in SERIES.values() for q in v}
RAIL_C = {"Wireless": "#8CE05E", "NAC": "#2FA8E0", "Lab": "#F0705F", "Academy": "#F5A524"}

def series_tile(name, parts):
    cat = Counter(q["cat"] for q in parts).most_common(1)[0][0]
    cats = "|".join(sorted({q["cat"] for q in parts}))
    items = "".join(
        '<li><a href="p/%s.html" data-origin="zoom"><b>%d</b><span>%s</span></a></li>'
        % (q["slug"], i + 1, E(q["title"])) for i, q in enumerate(parts))
    tile = ('<div class="card g-card series-card" data-rise data-cat="%s" data-series>'
            '<div class="card-top"><span class="tag %s">%s</span>'
            '<span class="parts">%d parts</span></div>'
            '<h3 class="h-card">%s</h3><ol class="series-list">%s</ol></div>'
            % (E(cats), CAT_CLASS.get(cat, ""), E(cat), len(parts), E(name), items))
    return max(q["date_obj"] for q in parts), tile

# ── index ───────────────────────────────────────────────────────────────────
index = head(SITE["name"], SITE["tagline"], BASE_URL + "/", BASE_URL + "/og/home.png", search=True, wide=True)
rail = ('<button class="cat on" type="button" data-cat="all">'
        '<i></i><span>All</span><b>%d</b></button>' % len(posts)) + "".join(
    '<button class="cat" type="button" data-cat="%s" style="--c:%s">'
    '<i></i><span>%s</span><b>%d</b></button>'
    % (E(c), RAIL_C.get(c, "rgba(255,255,255,0.30)"), E(c), _cnt[c]) for c in CATS)
_tiles = [series_tile(k, v) for k, v in SERIES.items()]
_tiles += [(p["date_obj"], card(p, featured=(p is featured))) for p in posts]
_tiles.sort(key=lambda t: t[0], reverse=True)
cards = "".join(h for _, h in _tiles)
# the banner sends demo/nfn-ping.pcap frame 1 bit for bit; make-pcap.py regenerates the hex and field map
# demo/traffic.json (from make-pcap.py) carries every flow the banner can send: frames as hex, field maps, app-layer view, demo keys
_tj = open(os.path.join(ROOT, "demo", "traffic.json"), encoding="utf-8").read().strip()
qam = widget("qam").replace('<section class="qam g-card" id="qam"',
    '<section class="qam g-card" id="qam" data-title="%s" data-traffic="%s"' % (E(featured["title"]), E(_tj)), 1)
index += f'''
<section class="hero g-hero rise" data-view="pop">
  <div class="sheen"></div><div class="glow"></div>
  <span class="tag green"><span class="dot"></span>Latest field note</span>
  <h1 class="h-hero">{E(featured["title"])}</h1>
  <p class="lede">{E(featured["summary"])}</p>
  <div class="row">
    <a class="btn cta" href="p/{featured["slug"]}.html" data-origin="zoom">Read the writeup</a>
    <span class="meta">{featured["readtime"]} min &#183; {E(featured["date_h"])}</span>
  </div>
</section>

<div class="browse">
  <nav class="cat-rail" aria-label="Filter posts by category"><span class="eyebrow">Filter</span>{rail}</nav>
  <section class="browse-main">
    <div class="grid" id="posts">
      {cards}
    </div>
    <div class="empty">Nothing matches that. Try a broader word, or clear the filter.</div>
  </section>
</div>

<section class="band g-card" data-rise>
  <div>
    <h3>Field notes, not a newsletter</h3>
    <p>{E(SITE["tagline"])}</p>
  </div>
</section>
''' + foot("nfn-bot-wave.svg", wide=True)
open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8").write(index)

# ── post pages ──────────────────────────────────────────────────────────────
os.makedirs(os.path.join(ROOT, "p"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "og"), exist_ok=True)
for i, p in enumerate(posts):
    prev = posts[i + 1] if i + 1 < len(posts) else None
    nxt = posts[i - 1] if i > 0 else None
    nav = ""
    if prev: nav += '<a class="pn g-card" href="%s.html"><span class="eyebrow">Older</span>%s</a>' % (prev["slug"], E(prev["title"]))
    if nxt:  nav += '<a class="pn g-card" href="%s.html"><span class="eyebrow">Newer</span>%s</a>' % (nxt["slug"], E(nxt["title"]))
    url = "%s/p/%s.html" % (BASE_URL, p["slug"]); ogimg = "%s/og/%s.png" % (BASE_URL, p["slug"])
    jsonld = json.dumps({"@context": "https://schema.org", "@type": "BlogPosting", "headline": p["title"],
        "description": p["summary"], "datePublished": p["date"], "image": ogimg,
        "author": {"@type": "Person", "name": SITE["author"]}, "publisher": {"@type": "Person", "name": SITE["author"]},
        "mainEntityOfPage": url, "keywords": ", ".join(p["tags"])})
    extra = ('<meta property="og:type" content="article"><meta property="article:published_time" content="%s">'
             '<meta property="article:author" content="%s"><script type="application/ld+json">%s</script>'
             % (p["date"], E(SITE["author"]), jsonld))
    page = head(p["title"], p["summary"], url, ogimg, up="../", extra=extra, active=("academy" if p["academy"] else ""), theme=("acad" if p["academy"] else ""))
    page += f'''
<div class="narrow">{progress_scripts(p["academy"]) if p["academy"] else ""}
  <div class="backbar"><a class="btn" href="../{"academy.html" if p["academy"] else ""}">{ICO_BACK}&nbsp;{"Academy" if p["academy"] else "All posts"}</a></div>
  <article>
    <header class="post-head g-hero cat-{E(p["cat"].replace(" ","-"))}" data-view="zoom">
      <div class="row" style="margin:0"><a class="tag {p["ccls"]}" href="../index.html#cat={E(p["cat"])}" title="All {E(p["cat"])} posts">{E(p["cat"])}</a><span class="meta">{("Lesson %d" % p["academy"]) if p.get("academy") else E(p["date_h"])} &#183; {p["readtime"]} min</span></div>
      <h1 class="h-hero">{E(p["title"])}</h1>
    </header>
    <div class="post-body g-card" data-rise>
      <div class="figure panel">{svg(p["hero"])}</div>
      {widget(p["interactive"]) if p["interactive"] else ""}
      <div class="callout origin"><span class="eyebrow">Where this came from</span>{E(p.get("origin",""))}</div>
      <div class="prose">{p["html"]}</div>
      {cxsim_block() if p["cxsim"] else ""}
    </div>
    {progress_block(p) if p["academy"] else ""}{series_nav(p)}
    {qa_block(p) if p["academy"] else comments_block(p)}
    <section class="end g-card" data-rise>
      <h3>More field notes</h3>
      <div class="postnav">{nav}</div>
    </section>
  </article>
</div>
''' + foot(p["bot"], "../")
    open(os.path.join(ROOT, "p", p["slug"] + ".html"), "w", encoding="utf-8").write(page)

# ── about ───────────────────────────────────────────────────────────────────
KIT = [
    ("Ekahau Sidekick 2 + laptop", "Walks the building so the heatmap doesn't have to guess. Still can't see channel 173.",
     '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="12" rx="3"/><path d="M12 7V3M9 3h6"/><circle cx="12" cy="13" r="2.5"/></svg>'),
    ("Console cable, USB-C serial", "The only management plane that has never had an outage.",
     '<svg viewBox="0 0 24 24"><rect x="3" y="9" width="7" height="6" rx="1.5"/><path d="M10 12h4M14 9h4a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3h-4zM5 9V6M8 9V6"/></svg>'),
    ("PoE tester", "Settles the \"but the switch says bt\" argument in about four seconds.",
     '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M13 7l-3 5h4l-3 5"/></svg>'),
    ("Label maker, punch-down, cable tester", "Nobody blogs about this part. Everybody uses it.",
     '<svg viewBox="0 0 24 24"><path d="M3 12l7-7h8a3 3 0 0 1 3 3v8l-7 7z"/><circle cx="16" cy="8" r="1.5"/></svg>'),
]
kit_html = "".join(
    '<div class="kit-item" tabindex="0"><span class="kit-ico">%s</span><b>%s</b><span class="kit-line">%s</span></div>' % (ic, E(n), E(l))
    for n, l, ic in KIT)
about = head("About · " + SITE["name"], "Who writes Network Field Notes and why.", BASE_URL + "/about.html", BASE_URL + "/og/home.png", active="about")
about += f'''
<div class="narrow">
  <section class="about g-hero" data-view="pop" style="position:relative">
    <div><span class="eyebrow">About</span><h1 class="h-hero" style="margin-top:14px">{E(SITE["author"])}</h1>
    <p class="lede" style="margin-top:10px">{E(SITE["role"])}</p></div>
    <div class="prose">
      <p>I design, migrate, and fix campus networks for a living: HPE Aruba Networking wireless and switching, ClearPass and NAC, Juniper Mist, and the Ekahau surveys that decide where the APs actually go. Twenty-some years of it, most of that in New England, currently as Lead Mobility Engineer on the Campus and Mobility team at WEI.</p>
      <p>This site is mine. The opinions are mine, the mistakes are mine, and the configs are scrubbed placeholders, so don't paste them anywhere you care about without reading them first. Customers are never named. Forum posters are only ever "somebody."</p>
      <p>I spend a lot of evenings on HPE Airheads answering the same questions in different clothes, which is where most of these posts come from.</p>
    </div>
    <div class="chips">{"".join('<span class="tag">%s</span>' % E(c) for c in ["HPE Aruba Networking","AOS-CX","AOS-8 / AOS-10","ClearPass","Central","Juniper Mist","Ekahau","Wi-Fi 6E / 7","EVPN-VXLAN"])}</div>
  </section>
  <section class="kit g-card" data-rise>
    <span class="eyebrow">In the bag</span>
    <div class="kit-grid">{kit_html}</div>
  </section>
</div>
''' + foot("nfn-bot-wave.svg")
open(os.path.join(ROOT, "about.html"), "w", encoding="utf-8").write(about)


# ── Wireless Academy ─────────────────────────────────────────────────────────
ACADEMY = [
    ("What a Radio Actually Sends", "Frequency, wavelength, amplitude. mW, dBm and dB, and the two rules that let you do the math in your head.", "Read RSSI on an Aruba AP and a Mist AP, double the distance, watch it fall about 6 dB. Confirm on the Sidekick."),
    ("Bands, Channels and Widths", "2.4, 5 and 6 GHz, the U-NII blocks, DFS, and what a wider channel actually costs.", "Change channel width on both platforms and watch client PHY rates and airtime move."),
    ("The Link Budget", "EIRP, antenna gain, receive sensitivity, free space path loss. Where the signal goes.", "Predict RSSI at 10 m, measure it, explain the gap."),
    ("Modulation and Data Rates", "MCS, coding rate, spatial streams. Why \"speed\" is a table, not a number.", "Read the PHY rate in the Central and Mist client views and work the MCS table backwards, force a lower rate, measure throughput."),
    ("Airtime Is the Only Resource", "Half duplex, contention, PHY rate versus throughput, and the overhead nobody budgets for.", "Count the beacon tax, run a slow laptop beside a fast one, then raise the floor and watch it leave."),
    ("Interference From Yourself", "Co-channel and adjacent-channel interference, reuse, cell overlap.", "Two APs on one channel. Count retries, watch airtime."),
    ("Noise, SNR, and Why RSSI Lies", "Noise floor, SNR, and what a spectrum analyser shows that a Wi-Fi card can't.", "Spectrum view with a real interferer. RSSI stays put, SNR collapses."),
    ("Joining a Network", "Probe, authentication, association, the 4-way handshake, EAP. What happens before the first packet.", "Capture a join on Mist and on Aruba, then read the same join in ClearPass Access Tracker."),
    ("Roaming: the Client Decides", "Thresholds, 802.11k/v/r, sticky clients, and why the AP can only suggest.", "A walk test with the Mist client timeline and the Central client events."),
    ("Capacity, Not Coverage", "Clients per radio, cell size, minimum basic rate, application budgets.", "Raise the minimum basic rate on both platforms and watch the cell shrink."),
    ("Surveys and What a Heatmap Can't See", "Predictive, AP-on-a-stick, validation. Channel lists and blind spots.", "A one-room passive survey on the Sidekick, cross-checked against the AP's real channel."),
    ("A Troubleshooting Method", "Client, RF, infrastructure, upstream. Which tool shows which layer.", "Break it three ways and find each one with the right tool."),
]
academy_posts = {p["academy"]: p for p in posts if p["academy"]}
acad_items = []
for i, (t, blurb, lab) in enumerate(ACADEMY, 1):
    q = academy_posts.get(i)
    if q:
        acad_items.append('<a class="lesson g-card live" href="p/%s.html" data-origin="zoom" data-rise data-lesson="%d" data-slug="%s" data-check="%d" data-game="%d"><span class="ser-n">Lesson %d<span class="pips" hidden></span></span><span class="ans-badge" hidden>New answer</span><b>%s</b><p>%s</p><span class="lab"><span class="eyebrow">Lab</span>%s</span><span class="meta">%d min</span></a>'
                          % (E(q["slug"]), i, E(q["slug"]), 1 if q["selfcheck"] else 0, 1 if has_game(q) else 0, i, E(q["title"]), E(q["summary"]), E(lab), q["readtime"]))
    else:
        acad_items.append('<div class="lesson g-card soon" data-rise><span class="ser-n">Lesson %d</span><b>%s</b><p>%s</p><span class="lab"><span class="eyebrow">Lab</span>%s</span><span class="meta">Planned</span></div>'
                          % (i, E(t), E(blurb), E(lab)))
live_n = len(academy_posts)
start_btn = ('<a class="btn cta" href="p/%s.html" data-origin="zoom">Start with lesson 1</a>' % E(academy_posts[1]["slug"])) if 1 in academy_posts else ""
acad = head("Wireless Academy · " + SITE["name"], "Twelve lessons on wireless fundamentals, each with a lab you can run on Aruba and Mist gear.", BASE_URL + "/academy.html", BASE_URL + "/og/academy.png", active="academy", theme="acad")
acad += f'''{progress_scripts()}
<section class="hero g-hero rise acad-hero" data-view="pop">
  <div class="sheen"></div><div class="glow"></div>
  <span class="tag c-orange"><span class="dot"></span>Wireless Academy</span>
  <h1 class="h-hero">The theory, and the lab that proves it</h1>
  <p class="lede">Twelve lessons on how Wi-Fi actually works, pitched at the engineer who runs a network but never got taught why. Each one ends with something you can go and measure on an Aruba AP, a Mist AP, and a Sidekick, because a number you measured yourself is the only kind that sticks.</p>
  <div class="row">
    {start_btn}
    <span class="meta">{live_n} of {len(ACADEMY)} published</span><span class="meta" id="acad-read" data-total="{len(ACADEMY)}" hidden></span>
  </div>
</section>
<section class="acad-why g-card" data-rise>
  <span class="eyebrow">Why orange</span>
  <p>The colour is a nod to the Airheads community. My first expert-level certification came out of an AOS 6 lab and a stack of forum posts by people who answered questions they didn't have to. This section is me paying that forward.</p>
</section>
<section>
  <div class="lessons">{"".join(acad_items)}</div>
</section>
{codebox_block()}
<section class="band g-card" data-rise>
  <div>
    <h3>Type on a switch first</h3>
    <p>The CX Sandbox is a modelled AOS-CX switch in the page: VLANs, MAC auth, 802.1X and roles against a fake ClearPass, device profiles, voice VLANs, tunnelling, a LAG, spanning tree, an SVI and OSPF. Eighteen labs with checks, or a blank switch to poke at.</p>
    <span class="meta" id="acad-labs" data-labs="__SANDBOX_LABS__" hidden></span>
  </div>
  <a class="btn" href="sandbox.html" data-origin="zoom">Open the sandbox</a>
</section>
''' + foot("nfn-bot-think.svg")

# ── CX Sandbox pages ─────────────────────────────────────────────────────────
# sandbox.html is the switch; cx-notes.html, cx-check.html, cx-build.html and cx-guide.html are the pages around
# it. A strip of outline pills ties the five together (the orange ring stays the nav's alone).
CX_PAGES = [("sandbox", "sandbox.html", "Sandbox"), ("notes", "cx-notes.html", "Command notes"), ("check", "cx-check.html", "Config checker"),
            ("build", "cx-build.html", "Script builder"), ("guide", "cx-guide.html", "Releases and hardening")]
def cx_tools(active):
    return ('<nav class="cx-tools" aria-label="CX Sandbox pages">%s</nav>' % "".join(
        '<a class="pill %s" href="%s"%s>%s</a>' % ("soft" if k == active else "outline", href, ' aria-current="page"' if k == active else "", E(name))
        for k, href, name in CX_PAGES))
CX_TOOLS_CSS = ('<style>.cx-tools{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 var(--s4)}.cx-tools .pill{font-weight:600}'
                '.cx-tools .pill.soft{box-shadow:inset 0 0 0 1px rgba(255,255,255,0.18)}</style>')

# ── CX Sandbox page: every lab, one picker ──────────────────────────────────
SANDBOX_LABS = ["sandbox", "nac-01-bench", "nac-02-discovery", "nac-03-mac-auth", "nac-04-dot1x", "nac-05-roles", "nac-06-precedence", "l2-01-uplink", "l3-01-routing",
                "sc-01-lldp-med", "sc-02-device-profiles", "sc-03-multi-domain", "sc-04-ubt", "sc-05-multigig", "sc-06-lacp", "sc-07-debug", "sc-08-pipes", "sc-09-rest", "sc-10-cable"]
# the picker, in groups: the blank switch, the Zero to NAC track, switching and routing, the ten scenarios
SANDBOX_GROUPS = [("Free play", ["sandbox"]), ("Zero to NAC", [l for l in SANDBOX_LABS if l.startswith("nac-")]),
                  ("Switching and routing", ["l2-01-uplink", "l3-01-routing"]), ("Scenarios", [l for l in SANDBOX_LABS if l.startswith("sc-")])]
def _lab_meta(lid):
    return json.load(open(os.path.join(ROOT, "theme", "cxsim", "lessons", lid + ".json"), encoding="utf-8"))
def _pill_label(lid):
    t = _lab_meta(lid)["title"]
    t = re.sub(r"^Scenario (\d+): ", r"\1: ", t)
    return t.replace("Lab ", "").replace("Switching lab: ", "L2: ").replace("Routing lab: ", "L3: ").replace("CX Sandbox", "Free play")
open(os.path.join(ROOT, "academy.html"), "w", encoding="utf-8").write(acad.replace("__SANDBOX_LABS__", E(",".join(l for l in SANDBOX_LABS if l != "sandbox"))))
sb_pills = "".join('<div class="sb-group"><span class="eyebrow">%s</span><div class="sb-row">%s</div></div>' % (E(g), "".join(
    '<button class="pill sb-pill%s" type="button" data-lab="%s">%s</button>' % (" on" if lid == "sandbox" else "", E(lid), E(_pill_label(lid))) for lid in labs))
    for g, labs in SANDBOX_GROUPS)
sb_labs = "".join('<div class="sb-lab" data-lab="%s"%s>%s</div>' % (E(lid), "" if i == 0 else ' hidden', cxsim('<p>{{cxsim: %s}}</p>' % lid)) for i, lid in enumerate(SANDBOX_LABS))
sb = head("CX Sandbox · " + SITE["name"], "A modelled HPE Aruba Networking CX switch you can type on: VLANs, MAC auth, 802.1X, roles and device profiles against a fake ClearPass, voice VLANs, tunnelling, LACP, REST and cable tests. Eighteen labs with checks and a blank switch.", BASE_URL + "/sandbox.html", BASE_URL + "/og/sandbox.png", active="academy")
sb += f'''{progress_scripts()}
<section class="sim-intro">
  <span class="tag c-blue"><span class="dot"></span>CX Sandbox</span>
  <h1 class="h-hero">A switch you can type on</h1>
  <p class="lede">A modelled AOS-CX access switch, in the page, with a fake ClearPass behind it. It answers <code>?</code> and Tab the way the box does, keeps a running config, and the devices on the bench authenticate or fail against whatever you configured. Pick a lab and it sets the bench up and checks your work; Free play is a blank 6200F. It is a model, not the real switch: the output shapes were checked line by line against AOS-CX 10.18.1002 running on my own bench, last on September 28, 2026, and the wording where it differs is mine. The command lists of 10.15 through 10.18 sit behind it, so a real command it doesn't model says so, a line the box would refuse gets the box's own error, and the picker in the corner of the terminal switches which release's syntax you get. Pipes work too: <code>include</code>, <code>exclude</code>, <code>begin</code> and <code>count</code>. Where it fakes hardware (link speed, PoE, the cable tester, a gateway to tunnel to) it says so on the screen.</p>
</section>
{CX_TOOLS_CSS}{cx_tools("sandbox")}
<nav class="sb-picker" aria-label="Labs">{sb_pills}</nav>
{sb_labs}
{cxsim_block()}
<script>
(function(){{
  var pills=document.querySelectorAll('.sb-pill'),labs=document.querySelectorAll('.sb-lab');
  function show(id){{var found=false;labs.forEach(function(l){{var on=l.getAttribute('data-lab')===id;l.hidden=!on;if(on)found=true;}});if(!found)return show('sandbox');pills.forEach(function(p){{p.classList.toggle('on',p.getAttribute('data-lab')===id);}});}}
  pills.forEach(function(p){{p.addEventListener('click',function(){{var id=p.getAttribute('data-lab');show(id);try{{history.replaceState(null,'','#lab='+id);}}catch(e){{}}}});}});
  var m=/[#&]lab=([a-z0-9-]+)/.exec(location.hash);if(m)show(m[1]);
  window.addEventListener('hashchange',function(){{var m=/[#&]lab=([a-z0-9-]+)/.exec(location.hash);if(m)show(m[1]);}});
}})();
</script>
<section class="band g-card" data-rise>
  <div>
    <h3>Where the labs come from</h3>
    <p>The six NAC labs follow the Zero to NAC track on one bench: a 6200F and a ClearPass that answers the way the lab says it does. Run the same steps on real gear and the show commands will look familiar, with the box's own wording.</p>
  </div>
  <a class="btn" href="academy.html">Back to the Academy</a>
</section>
''' + foot("nfn-bot-switchwork.svg")
open(os.path.join(ROOT, "sandbox.html"), "w", encoding="utf-8").write(sb)

# ── CX command notes: every note the sandbox shows, on one page ──────────────
# theme/cxsim/notes.json is the source (cxnotes.js checks every example against the engine and every release
# claim against the corpus). The four diagrams sit in the group they explain, with the habits that go with them.
CX_NOTES = json.load(open(os.path.join(ROOT, "theme", "cxsim", "notes.json"), encoding="utf-8"))
CX_RELS = [v[0] for v in json.loads(re.search(r'"v":(\[\[.*?\]\])', open(os.path.join(ROOT, "theme", "cxsim", "corpus", "aoscx.js"), encoding="utf-8").read()).group(1))]
CX_FIGS = {
    "fig-cx-radius": ("RADIUS", "802.1X against ClearPass, from link up to a change of authorization.", [
        "Two RADIUS servers in the group before go-live. One server is a single point of failure for every port.",
        "A critical role on every port-access port, so a ClearPass outage ends somewhere you chose.",
        "radius dyn-authorization client for each ClearPass node, or CoA and Disconnect fail without a sound.",
        "Auth failing? Look in Access Tracker first. No entry at all means the request never arrived: secret, address or VRF."]),
    "fig-cx-lldp-med": ("LLDP", "LLDP-MED on a phone port: the phone speaks first, the switch answers with the voice VLAN.", [
        "Make the voice VLAN a real VLAN with voice set, tag it on the phone port, and leave the data VLAN native.",
        "No network policy on the phone? Check the phone sends LLDP-MED before touching the switch.",
        "On a NAC port add allow-lldp-bpdu, or LLDP from the phone is dropped before anything reads it."]),
    "fig-cx-lacp": ("LAGs and LACP", "LACP bringing up a two-member LAG, and the flags that prove it.", [
        "Build the LAG first, then add members, then no shutdown the LAG. Settings live on the LAG.",
        "lacp mode active on both ends. A static LAG only where the far end cannot speak LACP.",
        "lacp rate fast on both ends notices a dead member in about three seconds instead of ninety.",
        "Done means ALFNCD for actor and partner on every member in show lacp interfaces."]),
    "fig-cx-mda": ("Port access", "Multi-domain authentication: a phone and the PC behind it, each with its own role.", [
        "Multi-domain is one voice device plus one data device. More PCs behind a phone: raise client-limit multi-domain.",
        "The phone's role carries device-traffic-class voice, a native data VLAN and the voice VLAN tagged.",
        "Test the failure path before users do: take ClearPass away and read what the phone and the PC get."]),
}
def cx_slug(k):
    return "n-" + re.sub(r"[^a-z0-9]+", "-", re.sub(r"<[^>]*>", "x", k.lower())).strip("-")
_slugs = [cx_slug(n["k"]) for n in CX_NOTES["notes"]]
assert len(_slugs) == len(set(_slugs)), "two notes share an anchor"
def cx_syntax(k):
    return " ".join('<i>%s</i>' % E(w) if w.startswith("<") else E(w) for w in k.split(" "))
def cx_rel(n):
    r = n.get("rel")
    if r == "sandbox": return "A sandbox command, not a switch command."
    if not r: return "Not in the Switch Simulator's command set for %s to %s. Syntax from HPE's guides." % (CX_RELS[0], CX_RELS[-1])
    if len(r) == len(CX_RELS): return "In every release here, %s to %s." % (CX_RELS[0], CX_RELS[-1])
    return "In %s. Not in %s." % (", ".join(r), ", ".join(x for x in CX_RELS if x not in r))
def cx_note_html(n):
    calls = "".join('<div class="cxn-call ver"><b>Changed:</b> %s</div>' % E(v) for v in n.get("v", []))
    if n.get("fake"): calls += '<div class="cxn-call fake"><b>Where the sandbox pretends:</b> %s</div>' % E(n["fake"])
    if n.get("tip"): calls += '<div class="cxn-call tip"><b>Habit:</b> %s</div>' % E(n["tip"])
    ex = "".join('<span class="ln">%s</span>' % E(l) for i, e in enumerate(n["ex"]) for l in ([""] if i else []) + e)
    see = "".join('<a href="#%s">%s</a>' % (cx_slug(k), E(k)) for k in n.get("see", []))
    words = " ".join([n["k"], n["t"], n["w"], n["g"]] + [l for e in n["ex"] for l in e]).lower()
    return ('<article class="cxn g-card" id="%s" data-q="%s"><div class="cxn-syn"><code>%s</code></div><h3>%s</h3><p>%s</p>'
            '<p class="cxn-rel">%s</p>%s<div class="term"><div class="term-bar"><i></i><i></i><i></i><b>try it in the sandbox</b></div><pre><code>%s</code></pre></div>%s</article>'
            % (cx_slug(n["k"]), E(words), cx_syntax(n["k"]), E(n["t"]), E(n["w"]), E(cx_rel(n)), calls, ex,
               '<p class="cxn-see"><span>Goes with</span>%s</p>' % see if see else ""))
def cx_fig_html(fid):
    grp, cap, tips = CX_FIGS[fid]
    return ('<figure class="figure panel cxn-fig" id="%s">%s<figcaption>%s</figcaption><ul class="cxn-tips">%s</ul></figure>'
            % (fid, svg(fid + ".svg"), E(cap), "".join("<li>%s</li>" % E(t) for t in tips)))
_groups = CX_NOTES["groups"]
def _gid(g): return "g-" + re.sub(r"[^a-z0-9]+", "-", g.lower()).strip("-")
cxn_body = "".join('<section class="cxn-group" id="%s"><h2>%s</h2>%s<div class="cxn-list">%s</div></section>' % (
    _gid(g), E(g), "".join(cx_fig_html(f) for f, v in CX_FIGS.items() if v[0] == g),
    "".join(cx_note_html(n) for n in CX_NOTES["notes"] if n["g"] == g)) for g in _groups)
cxn_nav = "".join('<a class="pill outline" href="#%s">%s</a>' % (_gid(g), E(g)) for g in _groups)
CXN_DESC = "Every command the CX Sandbox has a note for: what it does, examples to type, what changed from AOS-CX 10.15 to 10.18, where the sandbox fakes hardware, and diagrams of 802.1X, LLDP-MED, LACP and a phone with a PC behind it."
cxn = head("CX command notes · " + SITE["name"], CXN_DESC, BASE_URL + "/cx-notes.html", BASE_URL + "/og/cx-notes.png", active="academy")
cxn += f'''
{CX_TOOLS_CSS}
<style>
.cxn-bar{{margin:0 0 var(--s3)}}
.cxn-bar input{{width:100%;max-width:520px;min-height:44px;font:16px var(--sans);color:var(--text);background:var(--solid);border:1px solid var(--line);border-radius:var(--r-pill);padding:0 var(--s4);outline:none}}
.cxn-bar input:focus{{border-color:var(--blue-light)}}
.cxn-groups{{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 var(--s5)}}
.cxn-groups .pill{{min-height:40px}}
.cxn-group{{margin:0 0 var(--s7)}}
.cxn-group h2{{font-size:24px;letter-spacing:-0.02em;margin:0 0 var(--s4)}}
.cxn-list{{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr));gap:var(--s4)}}
.cxn{{padding:var(--s4) var(--s5);min-width:0}}
.cxn-syn code{{font:13px/1.5 var(--mono);color:var(--text);overflow-wrap:anywhere}}
.cxn-syn i{{font-style:normal;color:var(--text-muted)}}
.cxn h3{{font-size:17px;margin:6px 0 6px;letter-spacing:-0.01em}}
.cxn p{{color:var(--text-dim);font-size:15px;line-height:1.6;margin:0 0 10px}}
.cxn .cxn-rel{{font:12px/1.5 var(--mono);color:var(--text-muted)}}
.cxn-call{{font-size:14px;line-height:1.55;color:var(--text-dim);padding:8px 12px;margin:0 0 8px;border-left:3px solid var(--blue-light);background:rgba(79,189,234,0.08);border-radius:0 10px 10px 0}}
.cxn-call b{{color:var(--text)}}
.cxn-call.fake{{border-left-color:var(--teal);background:rgba(94,210,218,0.08)}}
.cxn-call.tip{{border-left-color:var(--green);background:rgba(140,224,94,0.07)}}
.cxn .term{{margin:var(--s3) 0 var(--s2)}}
.cxn .term pre{{margin:0;border:0;border-radius:0;background:none;padding:var(--s3) var(--s4);overflow:auto;font:13px/1.55 var(--mono)}}
.cxn-see{{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:13px}}
.cxn-see span{{font:600 11px var(--mono);letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted)}}
.cxn-see a{{font:12.5px var(--mono);color:var(--blue-light);display:inline-flex;align-items:center;min-height:38px}}
.cxn-fig{{margin:0 0 var(--s5)}}
.cxn-tips{{margin:var(--s3) 0 0;padding-left:1.2em;color:var(--text-dim);font-size:14.5px;line-height:1.6}}
.cxn-tips li{{margin:0 0 4px}}
.cxn-none{{color:var(--text-muted);display:none}}
@media (max-width:700px){{.cxn{{padding:var(--s3) var(--s4)}}}}
</style>
<section class="sim-intro">
  <span class="tag c-blue"><span class="dot"></span>CX Sandbox</span>
  <h1 class="h-hero">The commands, one note each</h1>
  <p class="lede">What each command does, two or three examples you can type into the <a href="sandbox.html">sandbox</a>, what changed between AOS-CX {CX_RELS[0]} and {CX_RELS[-1]}, and where the sandbox fakes hardware instead of reproducing it. Every example is run through the sandbox before this page is built, and every release line comes from the command lists I pulled off the Switch Simulator for each release. The same notes show up beside the terminal as you type.</p>
</section>
{cx_tools("notes")}
<div class="cxn-bar"><input type="search" id="cxn-q" placeholder="Filter: lacp, radius, voice, 1/1/1" aria-label="Filter the command notes" autocomplete="off"></div>
<nav class="cxn-groups" aria-label="Groups">{cxn_nav}</nav>
{cxn_body}
<p class="cxn-none" id="cxn-none">Nothing matches that. Try a shorter word.</p>
<script>
(function(){{
  var q=document.getElementById('cxn-q'),cards=document.querySelectorAll('.cxn'),groups=document.querySelectorAll('.cxn-group'),none=document.getElementById('cxn-none');
  function run(){{var v=q.value.trim().toLowerCase(),shown=0;cards.forEach(function(c){{var on=!v||c.getAttribute('data-q').indexOf(v)>=0;c.hidden=!on;if(on)shown++;}});
    groups.forEach(function(g){{var any=g.querySelector('.cxn:not([hidden])');g.hidden=!!v&&!any;var f=g.querySelectorAll('.cxn-fig');f.forEach(function(x){{x.hidden=!!v;}});}});
    none.style.display=shown?'none':'block';}}
  q.addEventListener('input',run);
}})();
</script>
''' + foot("nfn-bot-switchwork.svg")
open(os.path.join(ROOT, "cx-notes.html"), "w", encoding="utf-8").write(cxn)

# ── CX config checker: paste a config, findings back, nothing leaves the page ─
# theme/cxsim/checker.js does the work with the engine's copy of the real command sets. The page carries a
# Content-Security-Policy with connect-src 'none', so the browser itself refuses any request the page might try
# after it has loaded; the promise on the page is enforced, not just written down.
def _js(path):
    return open(os.path.join(ROOT, *path.split("/")), encoding="utf-8").read().replace("</", "<\\/")
CX_CSP = ('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; '
          'style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; font-src \'self\' https://fonts.gstatic.com; img-src \'self\' data:; '
          'connect-src \'none\'; form-action \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; worker-src \'none\'">')
CX_ENGINE_BUNDLE = "<script>%s</script><script>%s</script>" % (_js("theme/cxsim/corpus/aoscx.js"), _js("theme/cxsim/engine.js"))
cxc_sample = open(os.path.join(ROOT, "theme", "cxsim", "samples", "check-sample.cfg"), encoding="utf-8").read().replace("</", "<\\/")
cxc_rel_opts = "".join('<option value="%s">%s</option>' % (r, r) for r in reversed(CX_RELS))
CXC_DESC = "Paste an AOS-CX running config and get findings back: syntax each release would refuse, names that are never defined, CIS benchmark controls by number, and campus habits. It runs in your browser; the config never leaves the page."
cxc = head("CX config checker · " + SITE["name"], CXC_DESC, BASE_URL + "/cx-check.html", BASE_URL + "/og/cx-check.png", active="academy", extra=CX_CSP)
cxc += f'''
{CX_TOOLS_CSS}
<style>
.cxc-safe{{display:flex;gap:14px;align-items:flex-start;padding:var(--s4) var(--s5);margin:0 0 var(--s4)}}
.cxc-safe svg{{flex:none;width:28px;height:28px;margin-top:2px}}
.cxc-safe h2{{font-size:18px;margin:0 0 6px}}
.cxc-safe p{{margin:0 0 6px;color:var(--text-dim);font-size:15px;line-height:1.6}}
.cxc-safe p:last-child{{margin:0}}
.cxc-in{{padding:var(--s4) var(--s5);margin:0 0 var(--s4)}}
.cxc-in textarea{{display:block;width:100%;min-height:300px;resize:vertical;font:13.5px/1.5 var(--mono);color:var(--text);background:rgba(3,10,16,0.72);border:1px solid var(--line);border-radius:var(--r-inner);padding:var(--s3) var(--s4);outline:none;white-space:pre;overflow:auto}}
.cxc-in textarea:focus{{border-color:var(--blue-light)}}
.cxc-row{{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:var(--s3)}}
.cxc-row label{{display:inline-flex;align-items:center;gap:8px;font:12px var(--mono);color:var(--text-muted)}}
.cxc-row select{{font:13px var(--mono);color:var(--text);background:rgba(255,255,255,0.06);border:1px solid var(--line);border-radius:var(--r-pill);min-height:44px;padding:0 12px}}
.cxc-row .btn{{border:0;cursor:pointer;font:600 15px var(--sans)}}
.cxc-row .pill{{cursor:pointer;font:600 13.5px var(--sans)}}
.cxc-row input[type=file]{{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}}
.cxc-sum{{padding:var(--s4) var(--s5);margin:0 0 var(--s4);display:none}}
.cxc-sum.on{{display:block}}
.cxc-sum h2{{font-size:20px;margin:0 0 8px}}
.cxc-sum p{{margin:0;color:var(--text-dim);font-size:15px;line-height:1.6}}
.cxc-counts{{display:flex;flex-wrap:wrap;gap:8px;margin:var(--s3) 0 0}}
.cxc-counts button{{font:600 13px var(--sans);min-height:40px;padding:0 14px;border-radius:var(--r-pill);border:1px solid var(--line);background:rgba(255,255,255,0.05);color:var(--text-dim);cursor:pointer}}
.cxc-counts button.on{{background:rgba(255,255,255,0.12);color:var(--text);border-color:rgba(255,255,255,0.3)}}
.cxc-list{{display:grid;gap:var(--s3)}}
.cxc-f{{padding:var(--s3) var(--s4)}}
.cxc-f header{{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 6px}}
.cxc-f h3{{font-size:16px;margin:0;letter-spacing:-0.01em}}
.cxc-sev{{font:700 10.5px var(--mono);letter-spacing:0.12em;text-transform:uppercase;border-radius:var(--r-pill);padding:4px 9px}}
.cxc-sev.error{{background:var(--orange);color:var(--ink)}}
.cxc-sev.warn{{border:1px solid rgba(245,165,36,0.7);color:#ffd28a}}
.cxc-sev.info{{border:1px solid var(--line);color:var(--text-muted)}}
.cxc-tag{{font:11px var(--mono);color:var(--blue-light);border:1px solid rgba(79,189,234,0.45);border-radius:var(--r-pill);padding:3px 8px}}
.cxc-f .ln{{font:12.5px/1.5 var(--mono);color:var(--text);background:rgba(3,10,16,0.55);border:1px solid var(--line);border-radius:8px;padding:6px 10px;margin:6px 0;overflow-x:auto;white-space:pre}}
.cxc-f .ln b{{color:var(--text-muted);font-weight:400;margin-right:10px}}
.cxc-f p{{margin:0 0 6px;color:var(--text-dim);font-size:14.5px;line-height:1.6}}
.cxc-fix{{position:relative;margin:8px 0 0}}
.cxc-fix pre{{margin:0;font:12.5px/1.5 var(--mono);color:var(--text);background:rgba(140,224,94,0.06);border:1px solid rgba(140,224,94,0.35);border-radius:8px;padding:8px 12px;overflow-x:auto}}
.cxc-fix button{{position:absolute;top:4px;right:4px;font:600 11.5px var(--sans);color:var(--text-dim);background:rgba(3,10,16,0.8);border:1px solid var(--line);border-radius:var(--r-pill);min-height:38px;padding:0 12px;cursor:pointer}}
.cxc-man{{padding:var(--s4) var(--s5);margin:var(--s4) 0 0;display:none}}
.cxc-man.on{{display:block}}
.cxc-man h2{{font-size:18px;margin:0 0 8px}}
.cxc-man li{{color:var(--text-dim);font-size:14.5px;line-height:1.6;margin:0 0 6px}}
.cxc-man b{{color:var(--text)}}
@media (max-width:700px){{.cxc-in,.cxc-safe,.cxc-sum,.cxc-man{{padding:var(--s3) var(--s4)}}.cxc-in textarea{{font-size:16px}}}}
</style>
<section class="sim-intro">
  <span class="tag c-blue"><span class="dot"></span>CX Sandbox</span>
  <h1 class="h-hero">Paste a config, get findings back</h1>
  <p class="lede">Drop in an AOS-CX running config. Every line is checked against the real command set of the release you pick, from {CX_RELS[0]} to {CX_RELS[-1]}, every name it uses is checked against what it defines, and the rest is held up to the CIS benchmark for CX switches, by control number, and to the habits that keep a campus access switch out of trouble. Each finding says why, and most come with the lines that fix them.</p>
</section>
{cx_tools("check")}
<section class="cxc-safe g-card" aria-labelledby="cxc-safe-h">
  <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M14 2 4 6v7c0 6.2 4.2 11.2 10 13 5.8-1.8 10-6.8 10-13V6z" fill="none" stroke="#8CE05E" stroke-width="2"/><path d="m9.5 14 3 3 6-6.5" fill="none" stroke="#8CE05E" stroke-width="2"/></svg>
  <div>
    <h2 id="cxc-safe-h">Your config never leaves this page</h2>
    <p>The checker is code that came down with the page. It reads the box below and nothing else, and it runs in this tab. Nothing is uploaded, stored or logged, and there is no analytics on this page.</p>
    <p>That is enforced, not just promised: the page carries a Content-Security-Policy with <code>connect-src 'none'</code>, so your browser refuses any network request it might try once it has loaded. Open the network tab in your browser's developer tools, paste, check, and watch it stay empty. Close the tab and the config is gone.</p>
    <p>What that cannot cover: browser extensions can read any page you open. Secrets in a running config are already ciphertext, but hostnames and addresses still say a lot about a network, so follow your own policy on where configs go.</p>
  </div>
</section>
<section class="cxc-in g-card">
  <label for="cxc-text" class="eyebrow">Running config</label>
  <textarea id="cxc-text" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="Paste the output of show running-config here"></textarea>
  <div class="cxc-row">
    <button class="btn cta" type="button" id="cxc-go">Check it</button>
    <label>Release <select id="cxc-rel" aria-label="AOS-CX release to check against"><option value="">From the config</option>{cxc_rel_opts}</select></label>
    <button class="pill outline" type="button" id="cxc-file-btn">Open a file</button><input type="file" id="cxc-file" accept=".txt,.cfg,.conf,.log,text/plain" aria-label="Open a config file">
    <button class="pill outline" type="button" id="cxc-sample-btn">Try a sample</button>
    <button class="pill outline" type="button" id="cxc-clear">Clear</button>
  </div>
</section>
<section class="cxc-sum g-card" id="cxc-sum" aria-live="polite"></section>
<div class="cxc-list" id="cxc-list"></div>
<section class="cxc-man g-card" id="cxc-man"></section>
<script type="text/plain" id="cxc-sample">{cxc_sample}</script>
{CX_ENGINE_BUNDLE}
<script>{_js("theme/cxsim/checker.js")}</script>
<script>
(function(){{
  var ta=document.getElementById('cxc-text'),rel=document.getElementById('cxc-rel'),sum=document.getElementById('cxc-sum'),list=document.getElementById('cxc-list'),man=document.getElementById('cxc-man'),filter='all',last=null;
  function el(t,c,x){{var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}}
  var KIND={{syntax:'Syntax',reference:'References',hardening:'CIS benchmark',practice:'Practice',unused:'Unused'}};
  function render(){{
    list.innerHTML='';var r=last;if(!r)return;
    r.findings.forEach(function(f){{
      if(filter!=='all'&&f.kind!==filter&&f.sev!==filter)return;
      var c=el('article','cxc-f g-card'),h=el('header');
      h.appendChild(el('span','cxc-sev '+f.sev,f.sev==='warn'?'warning':f.sev));
      if(f.cis)h.appendChild(el('span','cxc-tag','CIS '+f.cis));else h.appendChild(el('span','cxc-tag',KIND[f.kind]||f.kind));
      h.appendChild(el('h3','',f.title));c.appendChild(h);
      if(f.line){{var ln=el('div','ln');ln.appendChild(el('b','','line '+f.line));ln.appendChild(document.createTextNode(f.text||''));c.appendChild(ln);}}
      c.appendChild(el('p','',f.why+(f.also&&f.also.length?' Also on line'+(f.also.length>1?'s ':' ')+f.also.join(', ')+'.':'')));
      if(f.fix&&f.fix.length){{var fx=el('div','cxc-fix'),pre=el('pre','',f.fix.join('\\n')),b=el('button','','Copy');b.type='button';
        b.addEventListener('click',function(){{try{{navigator.clipboard.writeText(f.fix.join('\\n')).then(function(){{b.textContent='Copied';setTimeout(function(){{b.textContent='Copy';}},1400);}});}}catch(e){{}}}});
        fx.appendChild(pre);fx.appendChild(b);c.appendChild(fx);}}
      list.appendChild(c);
    }});
    if(!list.childNodes.length)list.appendChild(el('p','meta','Nothing in this group.'));
  }}
  function run(){{
    var t=ta.value;if(!t.trim()){{sum.className='cxc-sum g-card on';sum.innerHTML='';sum.appendChild(el('p','','Paste a running config first, or try the sample.'));list.innerHTML='';man.className='cxc-man g-card';return;}}
    var r=CXCheck.check(t,{{release:rel.value}});last=r;filter='all';
    sum.className='cxc-sum g-card on';sum.innerHTML='';
    var s=r.summary;sum.appendChild(el('h2','',(r.hostname?r.hostname+': ':'')+s.error+' error'+(s.error===1?'':'s')+', '+s.warn+' warning'+(s.warn===1?'':'s')+', '+s.info+' note'+(s.info===1?'':'s')));
    var un=r.unchecked.reduce(function(a,u){{return a+u.lines;}},0);
    sum.appendChild(el('p','','Checked '+r.checked+' of '+r.lines+' lines against the '+r.release+' command set'+(r.detected?(rel.value&&rel.value!==r.detected?' (the config says '+r.detected+')':' (the release the config names)'):'')+'.'+(un?' '+un+' line'+(un===1?'':'s')+' under '+r.unchecked.map(function(u){{return u.where;}}).join(', ')+' sit in contexts the command lists do not cover, so their syntax was not checked.':'')));
    var counts=el('div','cxc-counts'),kinds={{}};r.findings.forEach(function(f){{kinds[f.kind]=(kinds[f.kind]||0)+1;}});
    [['all','All '+r.findings.length],['error','Errors '+s.error]].concat(Object.keys(KIND).filter(function(k){{return kinds[k];}}).map(function(k){{return [k,KIND[k]+' '+kinds[k]];}})).forEach(function(x){{
      var b=el('button',x[0]===filter?'on':'',x[1]);b.type='button';b.addEventListener('click',function(){{filter=x[0];counts.querySelectorAll('button').forEach(function(y){{y.className=y===b?'on':'';}});render();}});counts.appendChild(b);}});
    sum.appendChild(counts);render();
    man.className='cxc-man g-card on';man.innerHTML='';man.appendChild(el('h2','','Checks a config cannot show'));
    var ul=el('ul');r.manual.forEach(function(m){{var li=el('li');li.appendChild(el('b','','CIS '+m.cis+': '+m.title+'. '));li.appendChild(document.createTextNode(m.how));ul.appendChild(li);}});man.appendChild(ul);
  }}
  document.getElementById('cxc-go').addEventListener('click',run);
  document.getElementById('cxc-sample-btn').addEventListener('click',function(){{ta.value=document.getElementById('cxc-sample').textContent.replace(/^\\n/,'');run();}});
  document.getElementById('cxc-clear').addEventListener('click',function(){{ta.value='';last=null;sum.className='cxc-sum g-card';list.innerHTML='';man.className='cxc-man g-card';ta.focus();}});
  var fi=document.getElementById('cxc-file');document.getElementById('cxc-file-btn').addEventListener('click',function(){{fi.click();}});
  fi.addEventListener('change',function(){{var f=fi.files&&fi.files[0];if(!f)return;var rd=new FileReader();rd.onload=function(){{ta.value=String(rd.result||'');run();}};rd.readAsText(f);fi.value='';}});
  ta.addEventListener('keydown',function(e){{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){{e.preventDefault();run();}}}});
  // a config handed over by the script builder: read once, deleted at once
  if(/#import/.test(location.hash)){{try{{var im=JSON.parse(localStorage.getItem('cxcheck:import')||'null');localStorage.removeItem('cxcheck:import');
    if(im&&im.config&&Date.now()-(im.at||0)<600000){{ta.value=im.config;if(im.release)rel.value=im.release;run();}}history.replaceState(null,'',location.pathname);}}catch(e){{}}}}
  window.__cxc={{run:run}};
}})();
</script>
''' + foot("nfn-bot-switchwork.svg")
open(os.path.join(ROOT, "cx-check.html"), "w", encoding="utf-8").write(cxc)

# ── CX script builder: pick, answer, paste ───────────────────────────────────
# theme/cxsim/builder.js builds the config; the page checks every build against the release's command set and
# pastes it into a hidden sandbox switch before showing it. Same CSP as the checker: a shared secret typed here
# stays here.
cxb_models = "".join('<option value="%s"%s>%s</option>' % (k, " selected" if k == "6200F-24" else "", E(k)) for k in ["6200F-12", "6200F-24", "6200F-48", "6300M-48", "6300M-24SR5"])
CXB_DESC = "Pick what an AOS-CX access switch needs, answer a few questions, and get a paste-ready config with every block explained, checked against the release's real command set and pasted into a sandbox switch first."
cxb = head("CX script builder · " + SITE["name"], CXB_DESC, BASE_URL + "/cx-build.html", BASE_URL + "/og/cx-build.png", active="academy", extra=CX_CSP)
def _f(fid, label, value, hint="", kind="text", wide=False):
    return ('<label class="cxb-f%s"><span>%s</span><input type="%s" id="%s" value="%s" spellcheck="false" autocomplete="off" autocapitalize="off">%s</label>'
            % (" wide" if wide else "", E(label), kind, fid, E(value), '<small>%s</small>' % E(hint) if hint else ""))
def _feat(fid, label, on, body, sub=""):
    return ('<fieldset class="cxb-feat g-card" data-feat="%s"><legend><label class="cxb-tog"><input type="checkbox" id="f-%s"%s> <b>%s</b></label>%s</legend><div class="cxb-body">%s</div></fieldset>'
            % (fid, fid, " checked" if on else "", E(label), '<small>%s</small>' % E(sub) if sub else "", body))
cxb_form = "".join([
    '<fieldset class="cxb-feat g-card cxb-base"><legend><b>The switch</b></legend><div class="cxb-body">'
    '<label class="cxb-f"><span>Model</span><select id="b-model">%s</select></label>'
    '<label class="cxb-f"><span>AOS-CX release</span><select id="b-release">%s</select></label>%s%s%s</div></fieldset>'
    % (cxb_models, cxc_rel_opts, _f("b-hostname", "Hostname", "idf2-sw1", "Put the location in it"), _f("b-ntp", "NTP servers", "192.0.2.30, 192.0.2.31", "Two, comma separated"), _f("b-syslog", "Syslog server", "192.0.2.40")),
    _feat("access", "Desk ports", True, _f("b-acc-ports", "Ports", "1/1/1-1/1/20", "A range like 1/1/1-1/1/20") + _f("b-acc-vlan", "Data VLAN", "10", kind="number") + _f("b-acc-name", "Its name", "STAFF")),
    _feat("nac", "802.1X and MAC auth with ClearPass", True, _f("b-nac-servers", "ClearPass addresses", "192.0.2.10, 192.0.2.11", "Every node, comma separated", wide=True)
          + _f("b-nac-secret", "Shared secret", "", "Left empty, the config says CHANGE-ME") + _f("b-nac-group", "Server group", "CLEARPASS") + _f("b-nac-role", "Staff role", "EMPLOYEE", "The name ClearPass sends")
          + _f("b-nac-crit", "Critical role", "CRITICAL", "When ClearPass is unreachable") + _f("b-nac-critvlan", "Its VLAN", "10", kind="number")
          + '<label class="cxb-c"><input type="checkbox" id="b-nac-coa" checked> Change of authorization (CoA)</label><label class="cxb-c"><input type="checkbox" id="b-nac-mac" checked> MAC auth for what has no supplicant</label>'),
    _feat("phones", "IP phones with a PC behind them", True, _f("b-ph-vlan", "Voice VLAN", "30", kind="number") + _f("b-ph-name", "Its name", "VOICE"), "LLDP-MED, multi-domain"),
    _feat("aps", "Access points", True, _f("b-ap-ports", "Ports", "1/1/21-1/1/24") + _f("b-ap-vlan", "AP management VLAN", "99", kind="number") + _f("b-ap-name", "Its name", "AP-MGMT")
          + _f("b-ap-tagged", "SSID VLANs to tag", "10,30") + _f("b-ap-match", "Word in the AP's LLDP description", "AP-515", "Check with show lldp neighbor-info"), "recognised by LLDP"),
    _feat("uplink", "Uplink LAG", True, _f("b-up-lag", "LAG number", "1", kind="number") + _f("b-up-ports", "Member ports", "1/1/27-1/1/28") + _f("b-up-native", "Native VLAN", "99", kind="number")
          + _f("b-up-desc", "Description", "uplink to core") + '<label class="cxb-c"><input type="checkbox" id="b-up-fast" checked> lacp rate fast</label>'),
    _feat("ubt", "Tunnel staff traffic to gateways (UBT)", False, _f("b-ubt-zone", "Zone", "CAMPUS") + _f("b-ubt-primary", "Primary gateway", "192.0.2.50") + _f("b-ubt-backup", "Backup gateway", "")
          + _f("b-ubt-vlan", "Tunnel client VLAN", "666", kind="number") + _f("b-ubt-role", "Gateway role", "authenticated")),
    _feat("mgmt", "An address to manage it by", True, _f("b-mg-vlan", "Management VLAN", "99", kind="number") + _f("b-mg-ip", "Switch address", "192.0.2.21/24") + _f("b-mg-gw", "Default gateway", "192.0.2.1")),
    _feat("harden", "Harden it (CIS by control number)", True, _f("b-h-allow", "SSH allowed from", "192.0.2.0/24", "Your management subnet") + _f("b-h-banner", "Login banner", "Authorized use only. Activity on this switch is logged.", wide=True)),
])
cxb += f'''
{CX_TOOLS_CSS}
<style>
.cxb{{display:grid;grid-template-columns:minmax(0,440px) minmax(0,1fr);gap:var(--s5);align-items:stretch;height:calc(100vh - 150px);min-height:560px}}
.cxb-form{{display:grid;gap:var(--s3);align-content:start;overflow:auto;padding:2px 6px 2px 2px;overscroll-behavior:contain}}
.cxb-jump{{display:none}}
.cxb-feat{{margin:0;padding:var(--s3) var(--s4) var(--s4);border:1px solid var(--line);min-width:0}}
.cxb-feat legend{{padding:0 4px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}}
.cxb-feat legend small{{color:var(--text-muted);font:12px var(--mono)}}
.cxb-feat.off .cxb-body{{display:none}}
.cxb-tog{{display:inline-flex;align-items:center;gap:10px;min-height:40px;cursor:pointer}}
.cxb-tog input,.cxb-c input{{width:20px;height:20px;accent-color:#8CE05E}}
.cxb-body{{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;margin-top:6px}}
.cxb-f{{display:flex;flex-direction:column;gap:4px;min-width:0}}
.cxb-f.wide{{grid-column:1/-1}}
.cxb-f span{{font:12px var(--mono);color:var(--text-muted)}}
.cxb-f input,.cxb-f select{{min-height:42px;font:14px var(--mono);color:var(--text);background:rgba(3,10,16,0.6);border:1px solid var(--line);border-radius:10px;padding:0 10px;width:100%;min-width:0}}
.cxb-f input:focus,.cxb-f select:focus{{outline:none;border-color:var(--blue-light)}}
.cxb-f small{{font-size:12px;color:var(--text-muted)}}
.cxb-c{{grid-column:1/-1;display:flex;align-items:center;gap:10px;min-height:38px;font-size:14px;color:var(--text-dim);cursor:pointer}}
.cxb-out{{overflow:auto;padding:var(--s4) var(--s5);min-width:0;overscroll-behavior:contain}}
.cxb-stat{{font-size:14.5px;line-height:1.6;color:var(--text-dim);margin:0 0 var(--s3)}}
.cxb-stat b{{color:var(--text)}}
.cxb-stat.bad{{color:#ffd28a}}
.cxb-stat ul{{margin:6px 0 0;padding-left:1.2em}}
.cxb-acts{{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 var(--s4)}}
.cxb-acts .btn{{border:0;cursor:pointer;font:600 15px var(--sans)}}
.cxb-acts .pill{{cursor:pointer;font:600 13.5px var(--sans)}}
.cxb-blk{{margin:0 0 var(--s4);padding:0 0 var(--s4);border-bottom:1px solid var(--line)}}
.cxb-blk:last-child{{border-bottom:0}}
.cxb-blk h3{{font-size:16px;margin:0 0 4px}}
.cxb-blk p{{margin:0 0 8px;color:var(--text-dim);font-size:14.5px;line-height:1.6}}
.cxb-blk pre{{margin:0;font:12.5px/1.55 var(--mono);color:var(--text);background:rgba(3,10,16,0.6);border:1px solid var(--line);border-radius:10px;padding:10px 12px;overflow-x:auto}}
.cxb-blk .proof{{margin-top:6px;font:12px var(--mono);color:var(--text-muted)}}
.cxb-note{{font-size:13px;color:var(--text-muted);line-height:1.55;margin:var(--s3) 0 0}}
@media (max-width:960px){{.cxb{{grid-template-columns:minmax(0,1fr);height:auto;min-height:0}}.cxb-form{{overflow:visible;padding:0}}.cxb-out{{overflow:visible}}.cxb-jump{{display:inline-flex}}}}
@media (max-width:520px){{.cxb-body{{grid-template-columns:minmax(0,1fr)}}.cxb-out{{padding:var(--s3) var(--s4)}}.cxb-f input,.cxb-f select{{font-size:16px}}}}
</style>
<section class="sim-intro">
  <span class="tag c-blue"><span class="dot"></span>CX Sandbox</span>
  <h1 class="h-hero">Build the config, block by block</h1>
  <p class="lede">Tick what the switch needs, answer the questions, and the config on the right follows as you type: paste-ready, in the order the switch wants it, each block with why it is there and the show commands that prove it worked. Every build is checked against the command set of the release you pick and pasted into a sandbox switch before you see it. What you type stays in this page, same as the <a href="cx-check.html">checker</a>.</p>
</section>
{cx_tools("build")}
<p><a class="pill outline cxb-jump" href="#cxb-out">Jump to the config</a></p>
<div class="cxb">
  <form class="cxb-form" id="cxb-form" onsubmit="return false">{cxb_form}</form>
  <section class="cxb-out g-card" id="cxb-out" aria-live="polite">
    <p class="cxb-stat" id="cxb-stat">Building...</p>
    <div class="cxb-acts">
      <button class="btn cta" type="button" id="cxb-copy">Copy the config</button>
      <button class="pill outline" type="button" id="cxb-dl">Download .txt</button>
      <button class="pill outline" type="button" id="cxb-sb">Open in the sandbox</button>
      <button class="pill outline" type="button" id="cxb-ck">Run the checker on it</button>
    </div>
    <div id="cxb-blocks"></div>
    <p class="cxb-note">Open in the sandbox hands the config over in this browser's storage and swaps the shared secret for the bench ClearPass's own (192.0.2.10, cppm-lab-key), so the devices on the bench can authenticate. The checker deletes what it is handed as soon as it reads it.</p>
  </section>
</div>
{CX_ENGINE_BUNDLE}
<script>{_js("theme/cxsim/checker.js")}</script>
<script>{_js("theme/cxsim/builder.js")}</script>
<script>
(function(){{
  function $(id){{return document.getElementById(id);}}
  function v(id){{var e=$(id);return e?e.value.trim():'';}}
  function el(t,c,x){{var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}}
  var FEATS=['access','nac','phones','aps','uplink','ubt','mgmt','harden'],KEY='cxbuild:answers',last=null,timer=null;
  function answers(){{
    var f={{}};FEATS.forEach(function(k){{f[k]=$('f-'+k).checked;}});
    return {{model:v('b-model'),release:v('b-release'),hostname:v('b-hostname'),features:f,
      access:{{ports:v('b-acc-ports'),vlan:+v('b-acc-vlan'),vlanName:v('b-acc-name')}},
      nac:{{servers:v('b-nac-servers'),secret:v('b-nac-secret'),group:v('b-nac-group'),role:v('b-nac-role'),critRole:v('b-nac-crit'),critVlan:+v('b-nac-critvlan'),coa:$('b-nac-coa').checked,macauth:$('b-nac-mac').checked}},
      phones:{{vlan:+v('b-ph-vlan'),vlanName:v('b-ph-name')}},
      aps:{{ports:v('b-ap-ports'),mgmtVlan:+v('b-ap-vlan'),mgmtName:v('b-ap-name'),tagged:v('b-ap-tagged'),match:v('b-ap-match')}},
      uplink:{{lag:+v('b-up-lag'),ports:v('b-up-ports'),native:+v('b-up-native'),rateFast:$('b-up-fast').checked,desc:v('b-up-desc')}},
      ubt:{{zone:v('b-ubt-zone'),primary:v('b-ubt-primary'),backup:v('b-ubt-backup'),clientVlan:+v('b-ubt-vlan'),gwRole:v('b-ubt-role')}},
      mgmt:{{vlan:+v('b-mg-vlan'),ip:v('b-mg-ip'),gw:v('b-mg-gw')}},
      time:{{ntp:v('b-ntp'),syslog:v('b-syslog')}},
      harden:{{allow:v('b-h-allow'),banner:v('b-h-banner')}}}};
  }}
  function render(){{
    var a=answers();FEATS.forEach(function(k){{document.querySelector('[data-feat="'+k+'"]').classList.toggle('off',!a.features[k]);}});
    // remember the answers, not the secret
    try{{var keep=JSON.parse(JSON.stringify(a));keep.nac.secret='';localStorage.setItem(KEY,JSON.stringify(keep));}}catch(e){{}}
    var b=CXBuild.build(a),st=$('cxb-stat'),bl=$('cxb-blocks');last=b;bl.innerHTML='';st.innerHTML='';
    if(b.problems.length){{st.className='cxb-stat bad';st.appendChild(el('b','','Fix these first:'));var ul=el('ul');b.problems.forEach(function(p){{ul.appendChild(el('li','',p));}});st.appendChild(ul);return;}}
    var r=CXBuild.verify(b),ok=!r.syntaxBad.length&&!r.engineBad.length;
    st.className='cxb-stat'+(ok?'':' bad');
    st.appendChild(el('b','',b.lines.length+' lines for a '+b.model+' on '+b.release+'. '));
    st.appendChild(document.createTextNode(ok?('The '+b.release+' command set takes every line it covers ('+r.syntaxOk+'; '+r.notChecked+' sit in blocks the command lists do not cover), and a sandbox switch took the whole paste.'):'Something does not check out:'));
    if(!ok){{var u2=el('ul');r.syntaxBad.concat(r.engineBad).forEach(function(p){{u2.appendChild(el('li','',p));}});st.appendChild(u2);}}
    b.blocks.forEach(function(k){{var d=el('div','cxb-blk');d.appendChild(el('h3','',k.title));d.appendChild(el('p','',k.why));d.appendChild(el('pre','',k.lines.join('\\n')));
      if(k.proof.length)d.appendChild(el('div','proof','Proves it: '+k.proof.join(' · ')));bl.appendChild(d);}});
  }}
  function soon(){{clearTimeout(timer);timer=setTimeout(render,160);}}
  try{{var s=JSON.parse(localStorage.getItem(KEY)||'null');if(s){{
    var map={{'b-model':s.model,'b-release':s.release,'b-hostname':s.hostname,'b-ntp':s.time&&s.time.ntp,'b-syslog':s.time&&s.time.syslog,'b-acc-ports':s.access&&s.access.ports,'b-acc-vlan':s.access&&s.access.vlan,'b-acc-name':s.access&&s.access.vlanName,
      'b-nac-servers':s.nac&&s.nac.servers,'b-nac-group':s.nac&&s.nac.group,'b-nac-role':s.nac&&s.nac.role,'b-nac-crit':s.nac&&s.nac.critRole,'b-nac-critvlan':s.nac&&s.nac.critVlan,'b-ph-vlan':s.phones&&s.phones.vlan,'b-ph-name':s.phones&&s.phones.vlanName,
      'b-ap-ports':s.aps&&s.aps.ports,'b-ap-vlan':s.aps&&s.aps.mgmtVlan,'b-ap-name':s.aps&&s.aps.mgmtName,'b-ap-tagged':s.aps&&s.aps.tagged,'b-ap-match':s.aps&&s.aps.match,'b-up-lag':s.uplink&&s.uplink.lag,'b-up-ports':s.uplink&&s.uplink.ports,
      'b-up-native':s.uplink&&s.uplink.native,'b-up-desc':s.uplink&&s.uplink.desc,'b-ubt-zone':s.ubt&&s.ubt.zone,'b-ubt-primary':s.ubt&&s.ubt.primary,'b-ubt-backup':s.ubt&&s.ubt.backup,'b-ubt-vlan':s.ubt&&s.ubt.clientVlan,'b-ubt-role':s.ubt&&s.ubt.gwRole,
      'b-mg-vlan':s.mgmt&&s.mgmt.vlan,'b-mg-ip':s.mgmt&&s.mgmt.ip,'b-mg-gw':s.mgmt&&s.mgmt.gw,'b-h-allow':s.harden&&s.harden.allow,'b-h-banner':s.harden&&s.harden.banner}};
    Object.keys(map).forEach(function(id){{if(map[id]!=null&&$(id))$(id).value=map[id];}});
    FEATS.forEach(function(k){{if(s.features&&k in s.features)$('f-'+k).checked=!!s.features[k];}});
    [['b-nac-coa',s.nac&&s.nac.coa],['b-nac-mac',s.nac&&s.nac.macauth],['b-up-fast',s.uplink&&s.uplink.rateFast]].forEach(function(x){{if(x[1]!=null)$(x[0]).checked=!!x[1];}});
  }}}}catch(e){{}}
  $('cxb-form').addEventListener('input',soon);$('cxb-form').addEventListener('change',soon);
  $('cxb-copy').addEventListener('click',function(){{if(!last||last.problems.length)return;var b=$('cxb-copy');try{{navigator.clipboard.writeText(last.config).then(function(){{b.textContent='Copied';setTimeout(function(){{b.textContent='Copy the config';}},1400);}});}}catch(e){{}}}});
  $('cxb-dl').addEventListener('click',function(){{if(!last||last.problems.length)return;var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([last.config],{{type:'text/plain'}}));a.download=(last.answers.hostname||'switch')+'.txt';document.body.appendChild(a);a.click();setTimeout(function(){{URL.revokeObjectURL(a.href);a.remove();}},500);}});
  function sandboxCopy(){{var s=last.answers.nac.secret||'CHANGE-ME';return last.config.split(s).join('cppm-lab-key');}}
  $('cxb-sb').addEventListener('click',function(){{if(!last||last.problems.length)return;try{{localStorage.setItem('cxsim:import',JSON.stringify({{model:last.model,release:last.release,config:sandboxCopy(),at:Date.now()}}));}}catch(e){{}}location.href='sandbox.html#lab=sandbox&import=1';}});
  $('cxb-ck').addEventListener('click',function(){{if(!last||last.problems.length)return;try{{localStorage.setItem('cxcheck:import',JSON.stringify({{release:last.release,config:last.config,at:Date.now()}}));}}catch(e){{}}location.href='cx-check.html#import';}});
  render();window.__cxb={{render:render}};
}})();
</script>
''' + foot("nfn-bot-switchwork.svg")
open(os.path.join(ROOT, "cx-build.html"), "w", encoding="utf-8").write(cxb)

# ── CX releases and hardening: what changed, what good looks like, CIS by number ─
# Three sources, each named on the page: HPE's Feature Navigator (theme/cxsim/features.json, fetched 2026-09-28),
# the command lists harvested from the Switch Simulator for each release (the corpus, diffed here), and the
# sandbox's own notes. Practices and the CIS map are ours (theme/cxsim/practices.json, cis.json); cxsimtest.js
# checks every config line on this page against the command set.
def cx_corpus_forms():
    src = open(os.path.join(ROOT, "theme", "cxsim", "corpus", "aoscx.js"), encoding="utf-8").read()
    c = json.loads(re.search(r"var c = (\{.*\}); if \(typeof module", src, re.S).group(1))
    words, rels = c["t"].split(" "), [v[0] for v in c["v"]]
    allm = (1 << len(rels)) - 1
    PHN = {-1: "<n>", -2: "A.B.C.D", -3: "A.B.C.D/M", -4: "X:X::X:X", -5: "IFNAME", -6: "MAC", -7: "WORD", -8: "LINE"}
    nodes = []
    for s in c["n"].split("|"):
        parts = s.split(",")
        kids = []
        for p in parts[1:]:
            q = p.split(".")
            kids.append((int(q[0], 36), int(q[1], 36), int(q[2], 36) if len(q) > 2 else allm))
        nodes.append((int(parts[0], 36), kids))
    sets = c.get("s", [])
    def label(t):
        if t <= -100:
            heads = sorted({words[k] if k >= 0 else PHN.get(k, "?") for k, _, _ in nodes[sets[-t - 100]][1]})
            return "{" + "|".join(heads[:6]) + ("|..." if len(heads) > 6 else "") + "}"
        return words[t] if t >= 0 else PHN[t]
    forms = {}
    for ctx, r in c["r"].items():
        out, stack, steps = {}, [(r, [], allm)], 0
        while stack and steps < 400000:
            ni, toks, mask = stack.pop(); steps += 1
            e, kids = nodes[ni]
            if e & mask and toks:
                f = " ".join(toks); out[f] = out.get(f, 0) | (e & mask)
            if len(toks) > 14:
                continue
            for t, ch, m in kids:
                if m & mask:
                    stack.append((ch, toks + [label(t)], m & mask))
        forms[ctx] = out
    return rels, forms
CXG_RELS, CXG_FORMS = cx_corpus_forms()
CXG_CTX = [("config", "config"), ("if", "interface"), ("lag", "LAG"), ("vlan", "VLAN"), ("svi", "VLAN interface"), ("pa-role", "port-access role"), ("lldp-group", "LLDP group"),
           ("device-profile", "device profile"), ("ubt-zone", "UBT zone"), ("sg", "RADIUS group"), ("dot1x", "802.1X"), ("macauth", "MAC auth"), ("if-dot1x", "port 802.1X"),
           ("if-macauth", "port MAC auth"), ("ospf", "OSPF")]
def cxg_delta(rel):
    """New and gone command forms in rel against the release before it, per context, grouped by their first words."""
    i = CXG_RELS.index(rel)
    new, gone = {}, {}
    for ctx, label in CXG_CTX + [("exec", "exec")]:
        for f, m in CXG_FORMS.get(ctx, {}).items():
            if f.startswith("no ") or (ctx != "exec" and f.startswith("show ")):
                continue
            first = min(j for j in range(len(CXG_RELS)) if m >> j & 1)
            last = max(j for j in range(len(CXG_RELS)) if m >> j & 1)
            head = " ".join(f.split(" ")[:3 if f.startswith(("aaa ", "port-access ", "ip ", "ipv6 ", "show ", "debug ")) else 2])
            if first == i and i > 0:
                new.setdefault(label, {}).setdefault(head, []).append(f)
            if last == i - 1:
                gone.setdefault(label, {}).setdefault(head, []).append(f)
    return new, gone
def cxg_form(f):
    return " ".join('<i>%s</i>' % E(w) if (w.isupper() and len(w) > 1) or w.startswith(("<", "{")) or w in ("A.B.C.D", "A.B.C.D/M", "X:X::X:X") else E(w) for w in f.split(" "))
def cxg_groups(d, verb):
    out = []
    for label in [l for _, l in CXG_CTX] + ["exec"]:
        if label not in d:
            continue
        heads = d[label]; n = sum(len(v) for v in heads.values())
        items = "".join('<li><code>%s</code>%s</li>' % (cxg_form(sorted(v)[0]), ' <span class="more">and %d more like it</span>' % (len(v) - 1) if len(v) > 1 else "")
                        for h, v in sorted(heads.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:40])
        out.append('<details class="cxg-cli"><summary><b>%s</b> %d %s command form%s</summary><ul>%s</ul></details>' % (E(label), n, verb, "" if n == 1 else "s", items))
    return "".join(out)
CX_FEAT = json.load(open(os.path.join(ROOT, "theme", "cxsim", "features.json"), encoding="utf-8"))
CX_PRACT = json.load(open(os.path.join(ROOT, "theme", "cxsim", "practices.json"), encoding="utf-8"))["practices"]
CX_CIS = json.load(open(os.path.join(ROOT, "theme", "cxsim", "cis.json"), encoding="utf-8"))
def cxg_nav(rel):
    builds = [b for b in CX_FEAT["compared"] if b.startswith(rel + ".")]
    if not builds:
        return '<p class="cxg-none">Not in the Feature Navigator yet (checked %s). The command line below is the first place 10.18 shows.</p>' % E(CX_FEAT["fetched"])
    rows = [f for f in CX_FEAT["features"] if f["6200"] in builds or f["6300"] in builds]
    bytype = {}
    for f in rows:
        bytype.setdefault(f["type"], []).append(f)
    items = []
    for t in sorted(bytype):
        lis = "".join('<li>%s <span class="cxg-plat">%s</span></li>' % (E(f["name"]), " ".join(
            '<em>%s</em>' % p for p in ("6200", "6300") if f[p] in builds)) for f in sorted(bytype[t], key=lambda x: x["name"].lower()))
        items.append('<div class="cxg-type"><h4>%s</h4><ul>%s</ul></div>' % (E(t), lis))
    return '<p class="cxg-src">%d features first listed for the 6200 or 6300 in %s.</p><div class="cxg-types">%s</div>' % (len(rows), " and ".join(builds), "".join(items))
def cxg_notes(rel):
    hits = []
    for n in CX_NOTES["notes"]:
        for v in n.get("v", []):
            if re.search(r"(^New in %s\b|^Introduced in %s\b|\b%s (added|took|says|has|matched)\b)" % ((re.escape(rel),) * 3), v):
                hits.append('<li><a href="cx-notes.html#%s"><code>%s</code></a>: %s</li>' % (cx_slug(n["k"]), E(n["k"]), E(v)))
    return '<ul class="cxg-notes">%s</ul>' % "".join(hits) if hits else '<p class="cxg-none">No note calls this release out yet.</p>'
cxg_rel_html = ""
for rel in reversed(CXG_RELS):
    new, gone = cxg_delta(rel)
    nn, ng = sum(len(v) for g in new.values() for v in g.values()), sum(len(v) for g in gone.values() for v in g.values())
    cli = ('<p class="cxg-src">%d command forms appear in %s and %d that %s had are gone, across the contexts the lists cover. Forms, not features: one new option can add a few.</p>%s%s'
           % (nn, rel, ng, CXG_RELS[CXG_RELS.index(rel) - 1], cxg_groups(new, "new"), cxg_groups(gone, "gone"))) if CXG_RELS.index(rel) else (
           '<p class="cxg-src">The baseline: %d command forms across the contexts harvested. Every later release is compared with the one before it.</p>' % sum(len(v) for v in CXG_FORMS.values()))
    cxg_rel_html += ('<section class="cxg-rel g-card" id="r-%s"><h3>AOS-CX %s</h3><div class="cxg-cols"><div><h4 class="cxg-h">In HPE\'s Feature Navigator</h4>%s</div>'
                     '<div><h4 class="cxg-h">In the command line</h4>%s<h4 class="cxg-h">Called out in the command notes</h4>%s</div></div></section>'
                     % (rel.replace(".", "-"), rel, cxg_nav(rel), cli, cxg_notes(rel)))
cxg_pract = "".join('<article class="cxg-p g-card"><h3>%s</h3><p>%s</p>%s%s</article>' % (
    E(p["t"]), E(p["w"]), '<pre>%s</pre>' % E("\n".join(p["lines"])) if p["lines"] else "",
    '<a class="cxg-see" href="cx-notes.html#%s">The note on <code>%s</code></a>' % (cx_slug(p["see"]), E(p["see"])) if p.get("see") else "") for p in CX_PRACT)
cxg_cis = "".join('<article class="cxg-c g-card"><header><span class="cxg-id">CIS %s</span><span class="cxg-auto %s">%s</span></header><p>%s</p>%s%s</article>' % (
    E(c["id"]), "on" if c["auto"] == "config" else "", "The config checker looks for this" if c["auto"] == "config" else "Check this by hand",
    E(c["ask"]), '<p class="cxg-chk">Check: %s</p>' % " · ".join('<code>%s</code>' % E(x) for x in c["check"]) if c["check"] else "",
    '<pre>%s</pre>' % E("\n".join(c["fix"])) if c["fix"] else "") for c in CX_CIS["controls"])
CXG_DESC = "What changed in AOS-CX from 10.15 to 10.18 for the 6200 and 6300, from HPE's Feature Navigator and the command lists themselves; best practices for a campus access switch; and hardening mapped to the CIS benchmark by control number."
cxg = head("CX releases and hardening · " + SITE["name"], CXG_DESC, BASE_URL + "/cx-guide.html", BASE_URL + "/og/cx-guide.png", active="academy")
cxg += f'''
{CX_TOOLS_CSS}
<style>
.cxg-jump{{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 var(--s5)}}
.cxg-sec{{margin:0 0 var(--s7)}}
.cxg-sec>h2{{font-size:26px;letter-spacing:-0.02em;margin:0 0 8px}}
.cxg-sec>p{{color:var(--text-dim);font-size:16px;line-height:1.6;max-width:820px;margin:0 0 var(--s4)}}
.cxg-rel{{padding:var(--s4) var(--s5);margin:0 0 var(--s4)}}
.cxg-rel h3{{font-size:22px;margin:0 0 var(--s3)}}
.cxg-cols{{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--s5)}}
.cxg-h{{font:600 11px var(--mono);letter-spacing:0.14em;text-transform:uppercase;color:var(--blue-light);margin:0 0 8px}}
.cxg-cols>div>.cxg-h:not(:first-child){{margin-top:var(--s4)}}
.cxg-src,.cxg-none{{color:var(--text-muted);font-size:13.5px;line-height:1.55;margin:0 0 10px}}
.cxg-types{{display:grid;gap:10px}}
.cxg-type h4{{font-size:14px;margin:0 0 4px;color:var(--text)}}
.cxg-type ul,.cxg-notes,.cxg-cli ul{{margin:0;padding-left:1.1em;color:var(--text-dim);font-size:14px;line-height:1.55}}
.cxg-plat em{{font:normal 11px var(--mono);color:var(--teal);border:1px solid rgba(94,210,218,0.4);border-radius:var(--r-pill);padding:1px 6px;margin-left:4px;white-space:nowrap}}
.cxg-cli{{border-top:1px solid var(--line);padding:6px 0}}
.cxg-cli summary{{cursor:pointer;min-height:38px;display:flex;align-items:center;gap:8px;font-size:14px;color:var(--text-dim)}}
.cxg-cli summary b{{color:var(--text);font-weight:600}}
.cxg-cli code,.cxg-notes code,.cxg-p code,.cxg-c code{{font:12.5px var(--mono);color:var(--text);overflow-wrap:anywhere}}
.cxg-cli i{{font-style:normal;color:var(--text-muted)}}
.cxg-cli .more{{color:var(--text-muted);font-size:12.5px}}
.cxg-notes a{{color:var(--blue-light)}}
.cxg-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr));gap:var(--s4)}}
.cxg-p,.cxg-c{{padding:var(--s4) var(--s5);min-width:0}}
.cxg-p h3{{font-size:17px;margin:0 0 6px}}
.cxg-p p,.cxg-c p{{color:var(--text-dim);font-size:14.5px;line-height:1.6;margin:0 0 8px}}
.cxg-p pre,.cxg-c pre{{margin:8px 0 0;font:12.5px/1.55 var(--mono);color:var(--text);background:rgba(3,10,16,0.6);border:1px solid var(--line);border-radius:10px;padding:10px 12px;overflow-x:auto}}
.cxg-see{{display:inline-flex;align-items:center;min-height:38px;margin-top:6px;font-size:13.5px;color:var(--blue-light)}}
.cxg-c header{{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;margin:0 0 8px}}
.cxg-id{{font:700 13px var(--mono);color:var(--text)}}
.cxg-auto{{font:11px var(--mono);color:var(--text-muted);border:1px solid var(--line);border-radius:var(--r-pill);padding:2px 8px}}
.cxg-auto.on{{color:#bdf29c;border-color:rgba(140,224,94,0.5)}}
.cxg-chk{{font-size:13px!important}}
@media (max-width:860px){{.cxg-cols{{grid-template-columns:minmax(0,1fr)}}.cxg-rel,.cxg-p,.cxg-c{{padding:var(--s3) var(--s4)}}}}
</style>
<section class="sim-intro">
  <span class="tag c-blue"><span class="dot"></span>CX Sandbox</span>
  <h1 class="h-hero">Releases, habits and hardening</h1>
  <p class="lede">What changed from AOS-CX {CXG_RELS[0]} to {CXG_RELS[-1]} for the 6200 and 6300, seen three ways: HPE's Feature Navigator, the command lists I pulled off the Switch Simulator for each release, and the sandbox's own notes. Then the habits that keep a campus access switch out of trouble, and hardening mapped to the CIS benchmark for CX switches by control number. Every config line on this page is checked against the command set before it is published.</p>
</section>
{cx_tools("guide")}
<nav class="cxg-jump" aria-label="Sections"><a class="pill outline" href="#releases">By release</a><a class="pill outline" href="#practice">Best practices</a><a class="pill outline" href="#cis">Hardening, CIS by number</a></nav>
<section class="cxg-sec" id="releases">
  <h2>By release</h2>
  <p>Newest first. The Feature Navigator is HPE's list of what each platform supports in each release, compared here with licenses Native and Advanced and read on {E(CX_FEAT["fetched"])}; a feature sits under the first release it shows up in. The command line column is the difference between the command lists of one release and the one before it, which catches syntax the navigator never mentions. The Simulator hides hardware, so PoE, VSF and some speeds do not show there.</p>
  {cxg_rel_html}
</section>
<section class="cxg-sec" id="practice">
  <h2>Best practices for a campus access switch</h2>
  <p>The habits, each with the few lines that do it. The <a href="cx-build.html">script builder</a> writes most of them for you, and the <a href="cx-check.html">config checker</a> tells you which a config is missing.</p>
  <div class="cxg-grid">{cxg_pract}</div>
</section>
<section class="cxg-sec" id="cis">
  <h2>Hardening, CIS by control number</h2>
  <p>The {E(CX_CIS["benchmark"])} has {len(CX_CIS["controls"])} automated and manual items. They are mapped here by control number only: the numbers come from the public Tenable audit file for it, the wording is mine, and the benchmark's own text is not reproduced. Where a control can be read from a config, the config checker looks for it; the rest need eyes on the box.</p>
  <div class="cxg-grid">{cxg_cis}</div>
</section>
''' + foot("nfn-bot-switchwork.svg")
open(os.path.join(ROOT, "cx-guide.html"), "w", encoding="utf-8").write(cxg)

# ── simulator page: the banner on its own ───────────────────────────────────
sim = head("Simulator · " + SITE["name"], "A Wi-Fi link you can break: a real frame sent symbol by symbol through a link budget, a reflection, spatial streams and a Teams call, with interference you add yourself.", BASE_URL + "/simulator.html", BASE_URL + "/og/simulator.png", active="tools")
sim += f'''
<section class="sim-intro">
  <span class="tag green"><span class="dot"></span>Simulator</span>
  <h1 class="h-hero">A Wi-Fi link you can break</h1>
  <p class="lede">Every particle is one symbol from a real packet capture. Change the standard, the rate, the distance and the walls; add interference, a reflection or more streams; swap the ping for a Teams call and watch what the app sees. Tap the text under the canvas for the full explainer, or <a href="p/how-the-banner-works.html">watch the four-minute walkthrough</a>.</p>
</section>
''' + qam + '''
<section class="band g-card" data-rise>
  <div>
    <h3>How it was built</h3>
    <p>The walkthrough post covers what is real, what is modelled, and why the voice call breaks before the chat does.</p>
  </div>
  <a class="btn" href="p/how-the-banner-works.html">Read the field note</a>
</section>
''' + foot("nfn-bot-signal.svg")
open(os.path.join(ROOT, "simulator.html"), "w", encoding="utf-8").write(sim)

# ── tools page: the planners ────────────────────────────────────────────────
# the lab loads the model files as separate scripts for a fast reload; the site
# gets them concatenated into the page, in lab.py's order, so the page is one file
# and works from a saved copy. The widget itself is the promoted tools.html.
import lab as _lab
SIM_JS = "\n".join(open(os.path.join(ROOT, "theme", "sim", f + ".js"), encoding="utf-8").read()
                   for f in _lab.SIM if os.path.exists(os.path.join(ROOT, "theme", "sim", f + ".js")))
TOOLS_DESC = "Four planning tools that show their working: how many access points a crowd needs, where to aim an antenna at a block of seats, how a mesh forms on a field and what it will carry, and what happened on a site from what the controller recorded."
tools = head("Tools · " + SITE["name"], TOOLS_DESC, BASE_URL + "/tools.html", BASE_URL + "/og/tools.png", active="tools")
tools += f'''
<section class="sim-intro">
  <span class="tag green"><span class="dot"></span>Tools</span>
  <h1 class="h-hero">Planning tools that show their working</h1>
  <p class="lede">Every number on these pages is computed from the standards and the physics, not looked up, and every control lives in the address bar, so a link is the whole argument. The mesh planner was held against a real point on 2026-09-13: the budgets matched to a couple of dB, and the one thing it got wrong was fixed the same morning. Open a fold to see how a figure was reached; the story fold under the mesh map tells the tree in the order a mesh forms. The fifth tab is the simulator, one frame sent symbol by symbol through a link you can break; it also has <a href="simulator.html">a page of its own</a>.</p>
</section>
<script>{SIM_JS}</script>
''' + widget("tools").replace("<!-- qam:here (the build and the lab put the simulator widget here) -->", qam, 1) + '''
<section class="band g-card" data-rise>
  <div>
    <h3>Why a mesh has to be provisioned over the wire</h3>
    <p>The planner tells you where the points will attach. The field note tells you what happens when the roles never reach them.</p>
  </div>
  <a class="btn" href="p/mesh-conversion-strands-the-points.html">Read the field note</a>
</section>
''' + foot("nfn-bot-think.svg")
open(os.path.join(ROOT, "tools.html"), "w", encoding="utf-8").write(tools)
print("  + tools.html (%d KB of model in the page)" % (len(SIM_JS) // 1024))

# ── socials (genie target) ──────────────────────────────────────────────────
SOCIALS = [("LinkedIn", "Where I post when something is worth a wider audience.", SITE["linkedin"], "in"),
           ("HPE Airheads", "Where most of these posts start life, as somebody else's question.", SITE["airheads"], "AH")]
soc = head("Elsewhere · " + SITE["name"], "Where to find Dustin Burns online.", BASE_URL + "/socials.html", BASE_URL + "/og/home.png", active="")
soc += '''
<div class="narrow">
<section class="about g-hero" data-view="genie" style="position:relative">
  <div><span class="eyebrow">Elsewhere</span><h1 class="h-hero" style="margin-top:14px">Where to find me</h1>
  <p class="lede" style="margin-top:10px">Three places worth your time.</p></div>
  <div class="socials">''' + "".join(
    f'''<a class="social g-card" href="{u}"{"" if u.startswith("mailto:") else ' target="_blank" rel="noopener noreferrer"'} data-rise>
      <span class="social-ico eyebrow">{E(ic)}</span><span><b>{E(n)}</b><span>{E(d)}</span></span></a>''' for n, d, u, ic in SOCIALS) + '''
  </div>
</section>
</div>
''' + foot("nfn-bot-wave.svg")
open(os.path.join(ROOT, "socials.html"), "w", encoding="utf-8").write(soc)

# ── field kit: a standalone offline page, no blog chrome ────────────────────
# It has to open with no signal, so everything it needs ships inside it: the
# tokens off the design system, the QR decoder, and a service worker that keeps
# a copy. Nothing here is linked from the nav; you bookmark it or install it.
KIT_CSS = open(os.path.join(ROOT, "theme", "widgets", "kit.css"), encoding="utf-8").read()
KIT_JS = open(os.path.join(ROOT, "theme", "widgets", "kit.js"), encoding="utf-8").read()
KIT_HTML = open(os.path.join(ROOT, "theme", "widgets", "kit.html"), encoding="utf-8").read()
JSQR = open(os.path.join(ROOT, "theme", "vendor", "jsqr.min.js"), encoding="utf-8").read()
_root_vars = re.search(r"(:root\{.*?\n\})", CSS, re.S).group(1)

kit_page = f"""<!doctype html><html lang="en" data-theme="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#061019">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/kit.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>Field kit &middot; {E(SITE["name"])}</title>
<style>
{_root_vars}
*{{box-sizing:border-box}}
html{{-webkit-text-size-adjust:100%}}
html,body{{margin:0;overflow-x:hidden}}
body{{min-height:100svh;background:var(--ink);color:var(--text);font-family:var(--sans),system-ui,sans-serif;
  font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}}
.eyebrow{{font-family:var(--mono),ui-monospace,monospace;font-size:11px;text-transform:uppercase;
  letter-spacing:0.16em;color:var(--text-muted)}}
@media (prefers-reduced-motion:reduce){{*{{animation:none!important;transition:none!important}}}}
{KIT_CSS}
</style></head><body>
{KIT_HTML}
<script>{JSQR}</script>
<script>{KIT_JS}</script>
</body></html>"""
open(os.path.join(ROOT, "kit.html"), "w", encoding="utf-8").write(kit_page)

open(os.path.join(ROOT, "kit.webmanifest"), "w", encoding="utf-8").write(json.dumps({
    "name": "Field kit, Network Field Notes", "short_name": "Field kit",
    "description": "Stand up a pop-up wireless network start to finish, with no signal until you build one.",
    "start_url": "/kit.html", "scope": "/kit.html", "display": "standalone",
    "background_color": "#061019", "theme_color": "#061019", "orientation": "portrait",
    "icons": [{"src": "/apple-touch-icon.png", "sizes": "180x180", "type": "image/png", "purpose": "any"},
              {"src": "/favicon-32.png", "sizes": "32x32", "type": "image/png"}]
}, indent=1))

# Only the kit is cached, and only its own URLs are intercepted: a service
# worker that got its hands on the whole blog would be a support call.
open(os.path.join(ROOT, "sw.js"), "w", encoding="utf-8").write("""/* Field kit offline cache. Touches nothing but the kit. */
var CACHE = 'nfn-kit-v1';
var FILES = ['/kit.html', '/kit.webmanifest', '/apple-touch-icon.png', '/favicon-32.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (FILES.indexOf(url.pathname) < 0) return;          /* the rest of the site is none of our business */
  e.respondWith(
    fetch(e.request).then(function (r) {
      if (r && r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
      return r;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) { return hit || caches.match('/kit.html'); });
    })
  );
});
""")
print("  + kit.html, sw.js, kit.webmanifest")

# ── social preview cards ────────────────────────────────────────────────────
HAVE_RSVG = shutil.which("rsvg-convert") is not None
if not HAVE_RSVG:
    print("WARN: rsvg-convert not found; keeping the existing PNGs in og/ (install librsvg to regenerate them)")

def rasterize(svg, png, w, h):
    """SVG -> PNG. Skips quietly when no rasterizer is on this machine so the HTML build still completes."""
    if HAVE_RSVG:
        subprocess.run(["rsvg-convert", "-w", str(w), "-h", str(h), svg, "-o", png], check=True)

def og_card(title, eyebrow, path):
    lines = textwrap.wrap(title, 26)[:4]
    y0 = 300 - (len(lines) - 1) * 37
    tspans = "".join(
        '<text x="80" y="%d" fill="#EAF2F6" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" '
        'font-size="62" font-weight="700">%s</text>' % (y0 + i * 74, E(l))
        for i, l in enumerate(lines))
    doc = ('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">'
           '<defs><radialGradient id="a" cx="12%" cy="0%" r="70%">'
           '<stop offset="0" stop-color="#2FA8E0" stop-opacity="0.42"/><stop offset="1" stop-color="#061019" stop-opacity="0"/></radialGradient>'
           '<radialGradient id="b" cx="88%" cy="10%" r="60%">'
           '<stop offset="0" stop-color="#8CE05E" stop-opacity="0.26"/><stop offset="1" stop-color="#061019" stop-opacity="0"/></radialGradient>'
           '<radialGradient id="c" cx="60%" cy="105%" r="70%">'
           '<stop offset="0" stop-color="#178AA8" stop-opacity="0.34"/><stop offset="1" stop-color="#061019" stop-opacity="0"/></radialGradient></defs>'
           '<rect width="1200" height="630" fill="#061019"/>'
           '<rect width="1200" height="630" fill="url(#a)"/><rect width="1200" height="630" fill="url(#b)"/>'
           '<rect width="1200" height="630" fill="url(#c)"/>'
           '<rect x="0" y="0" width="1200" height="8" fill="#8CE05E"/>'
           '<text x="80" y="120" fill="#8CE05E" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" '
           'font-size="26" font-weight="700" letter-spacing="4">' + E(eyebrow.upper()) + '</text>'
           + tspans +
           '<text x="80" y="556" fill="#B0C4CF" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" '
           'font-size="27">' + E(SITE["author"]) + '  &#183;  ' + E(SITE["name"]) + '</text>'
           '<rect x="80" y="576" width="120" height="5" fill="#8CE05E"/></svg>')
    if not HAVE_RSVG:
        return
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".svg", encoding="utf-8", delete=False) as fh:
        fh.write(doc); tmp = fh.name
    try:
        rasterize(tmp, path, 1200, 630)
    finally:
        os.remove(tmp)

for p in posts:
    og_card(p["title"], p["tags"][0] if p["tags"] else "Field note",
            os.path.join(ROOT, "og", p["slug"] + ".png"))
og_card(SITE["tagline"][:110], "Field notes", os.path.join(ROOT, "og", "home.png"))
og_card("Wireless Academy: the theory, and the lab that proves it", "Wireless Academy", os.path.join(ROOT, "og", "academy.png"))
og_card("The simulator: a Wi-Fi link you can break, one symbol at a time", "Simulator", os.path.join(ROOT, "og", "simulator.png"))
og_card("The CX Sandbox: a modelled AOS-CX switch you can type on, with a fake ClearPass behind it", "CX Sandbox", os.path.join(ROOT, "og", "sandbox.png"))
og_card("AOS-CX command notes: what each command does, examples, release changes and where the sandbox pretends", "CX Sandbox", os.path.join(ROOT, "og", "cx-notes.png"))
og_card("Paste an AOS-CX config, get findings back. It never leaves your browser.", "CX Sandbox", os.path.join(ROOT, "og", "cx-check.png"))
og_card("Build an AOS-CX access switch config block by block, every block explained and checked", "CX Sandbox", os.path.join(ROOT, "og", "cx-build.png"))
og_card("AOS-CX 10.15 to 10.18: what changed, the habits that matter, and CIS hardening by control number", "CX Sandbox", os.path.join(ROOT, "og", "cx-guide.png"))
og_card("Planning tools that show their working: capacity, aiming, mesh, and what happened", "Tools", os.path.join(ROOT, "og", "tools.png"))
rasterize(os.path.join(ROOT, "logo", "nfn-favicon.svg"), os.path.join(ROOT, "apple-touch-icon.png"), 180, 180)

# ── sitemap, feed, housekeeping ─────────────────────────────────────────────
urls = ['<url><loc>%s/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>' % BASE_URL,
        '<url><loc>%s/about.html</loc><priority>0.5</priority></url>' % BASE_URL,
        '<url><loc>%s/academy.html</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>' % BASE_URL,
        '<url><loc>%s/simulator.html</loc><priority>0.8</priority></url>' % BASE_URL,
        '<url><loc>%s/sandbox.html</loc><priority>0.8</priority></url>' % BASE_URL,
        '<url><loc>%s/cx-notes.html</loc><priority>0.6</priority></url>' % BASE_URL,
        '<url><loc>%s/cx-check.html</loc><priority>0.6</priority></url>' % BASE_URL,
        '<url><loc>%s/cx-build.html</loc><priority>0.6</priority></url>' % BASE_URL,
        '<url><loc>%s/cx-guide.html</loc><priority>0.6</priority></url>' % BASE_URL,
        '<url><loc>%s/tools.html</loc><priority>0.8</priority></url>' % BASE_URL,
        '<url><loc>%s/socials.html</loc><priority>0.3</priority></url>' % BASE_URL]
urls += ['<url><loc>%s/p/%s.html</loc><lastmod>%s</lastmod><priority>0.8</priority></url>'
         % (BASE_URL, p["slug"], p["date"]) for p in posts]
open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8").write(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + "\n".join(urls) + '\n</urlset>\n')

def rfc822(d):
    return email.utils.format_datetime(datetime.datetime.combine(d, datetime.time(12, 0), tzinfo=datetime.timezone.utc))

items = "".join(
    '<item><title>%s</title><link>%s/p/%s.html</link><guid isPermaLink="true">%s/p/%s.html</guid>'
    '<pubDate>%s</pubDate><description>%s</description>%s</item>\n'
    % (E(p["title"]), BASE_URL, p["slug"], BASE_URL, p["slug"], rfc822(p["date_obj"]),
       E(p["summary"]), "".join('<category>%s</category>' % E(t) for t in p["tags"]))
    for p in posts)
feed = ('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>\n'
        '<title>%s</title>\n<link>%s/</link>\n<description>%s</description>\n<language>en-us</language>\n'
        '<lastBuildDate>%s</lastBuildDate>\n<atom:link href="%s/rss.xml" rel="self" type="application/rss+xml"/>\n%s</channel></rss>\n'
        % (E(SITE["name"]), BASE_URL, E(SITE["tagline"]), rfc822(posts[0]["date_obj"]), BASE_URL, items))
open(os.path.join(ROOT, "rss.xml"), "w", encoding="utf-8").write(feed)
open(os.path.join(ROOT, "feed.xml"), "w", encoding="utf-8").write(feed)   # kit refers to /feed.xml

open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8").write(
    "User-agent: *\nAllow: /\nSitemap: %s/sitemap.xml\n" % BASE_URL)
open(os.path.join(ROOT, ".nojekyll"), "w", encoding="utf-8").write("")
if CUSTOM_DOMAIN:
    open(os.path.join(ROOT, "CNAME"), "w", encoding="utf-8").write(CUSTOM_DOMAIN + "\n")

print("wrote index.html (%d KB), %d posts" % (len(index) // 1024, len(posts)))
for p in posts:
    print("  %s  %s  [%s | %s]" % (p["date"], p["title"], p["hero"], p["bot"]))
print("  + %d post pages, socials.html, %d og cards, sitemap, rss, feed" % (len(posts), len(posts) + 1))
