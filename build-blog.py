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
    "role": "Lead Mobility Engineer · HPE Aruba Networking and HPE Juniper",
    "airheads": "https://airheads.hpe.com/profile?UserKey=94e7a1d9-a7e0-4e9f-abbc-faa06c06b759",
    "linkedin": "https://www.linkedin.com/in/dustinburns3020/",
}
BASE_URL = "https://networkfieldnotes.com"
CUSTOM_DOMAIN = "networkfieldnotes.com"

E = lambda t: html.escape(str(t), quote=True)
CSS = open(os.path.join(ROOT, "theme", "style.css"), encoding="utf-8").read()
JS = open(os.path.join(ROOT, "theme", "app.js"), encoding="utf-8").read()

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
    meta["html"] = markdown.markdown(body, extensions=["fenced_code", "tables"])
    meta["date_obj"] = datetime.date.fromisoformat(meta["date"])
    meta["date_h"] = meta["date_obj"].strftime("%b %d, %Y").replace(" 0", " ")
    meta["bot"] = bot_for(meta)
    return meta

posts = sorted((parse_post(p) for p in glob.glob(os.path.join(ROOT, "posts", "*.md"))),
               key=lambda m: m["date_obj"], reverse=True)
if not posts:
    sys.exit("no posts")
year = datetime.date.today().year
featured = posts[0]

# ── categories, sources ─────────────────────────────────────────────────────
CAT_MAP = {"clearpass": "NAC", "process": "Docs", "documentation": "Docs", "switching": "Switching", "wireless": "Wireless"}
CAT_CLASS = {"Wireless": "c-green", "NAC": "c-blue", "Lab": "c-red"}
def category(p):
    if any(t.lower() in ("survey", "ekahau") for t in p["tags"]):
        return "RF survey"
    first = (p["tags"][0] if p["tags"] else "Field note")
    return CAT_MAP.get(first.lower(), first)
def source(p):
    o = p.get("origin", "").lower()
    if "airheads" in o or "thread" in o: return "Airheads thread"
    if "lab" in o: return "Lab build"
    if "engagement" in o or "customer" in o or "site" in o: return "Field engagement"
    return "Field note"
for p in posts:
    p["cat"] = category(p); p["src"] = source(p)
    if p["src"] == "Lab build": p["cat"] = "Lab"
    p["ccls"] = CAT_CLASS.get(p["cat"], "")
from collections import Counter
_cnt = Counter(p["cat"] for p in posts)
CATS = [c for c, _ in _cnt.most_common()]

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

def head(title, desc, url, ogimg, up="", extra="", active="posts", search=False):
    root = up or "/"
    nav = ('<a class="pill%s" href="%s">Posts</a>' % (" on" if active == "posts" else "", root))
    nav += '<a class="pill%s" href="%sabout.html">About</a>' % (" on" if active == "about" else "", up)
    if search:
        nav += '<a class="pill outline" id="search-toggle" href="#search" aria-label="Search">%s<span>Search</span></a>' % ICO_SEARCH
    else:
        nav += '<a class="pill outline" href="%sindex.html#search">%s<span>Search</span></a>' % (up, ICO_SEARCH)
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
<body>
<div class="ground"></div>
<div class="page">
<header class="hdr"><div class="wrap"><div class="hdr-in g-chrome">
  <a class="brand" href="{root}"><span class="mk"><img src="{up}logo/nfn-mark-dark.svg" alt="" width="26" height="26"></span><span class="wm">{E(SITE["name"])}</span></a>
  <nav class="nav">{nav}</nav>
  {searchbox}
</div></div></header>
<main class="wrap">'''

def foot(bot, up=""):
    return f'''</main>
<a class="rig" href="{up}socials.html" data-origin="genie" aria-label="Where else to find me"><img src="{up}character/{bot}" alt="" width="104" height="104"></a>
<footer><div class="wrap">
  <span>&copy; {year} {E(SITE["author"])}. Personal site. Configs are placeholders; customers are never named.</span>
  <span><a href="/rss.xml">RSS</a></span>
</div></footer>
</div>
<script>{JS}</script>
</body></html>'''

def card(p, featured=False):
    text = (p["title"] + " " + p["summary"] + " " + " ".join(p["tags"])).lower()
    # the featured post already sits in the hero; its card only appears once a filter or search is active
    return f'''<a class="card g-card{" hidden" if featured else ""}" href="p/{p["slug"]}.html" data-origin="zoom" data-rise data-cat="{E(p["cat"])}" data-text="{E(text)}"{" data-featured" if featured else ""}>
  <div class="card-top"><span class="tag {p["ccls"]}">{E(p["cat"])}</span><span class="meta">{E(p["date_obj"].strftime("%b %d").replace(" 0"," "))}</span></div>
  <h3 class="h-card">{E(p["title"])}</h3>
  <p>{E(p["summary"])}</p>
  <div class="card-foot"><span class="src">{ICO_CHAT}{E(p["src"])}</span><b>{p["readtime"]} min</b></div>
</a>'''

# ── index ───────────────────────────────────────────────────────────────────
index = head(SITE["name"], SITE["tagline"], BASE_URL + "/", BASE_URL + "/og/home.png", search=True)
chips = '<span class="chip on" data-cat="all">All</span>' + "".join(
    '<span class="chip %s" data-cat="%s">%s</span>' % (CAT_CLASS.get(c, ""), E(c), E(c)) for c in CATS)
cards = card(posts[0], featured=True) + "".join(card(p) for p in posts[1:])
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

<div class="filter"><span class="eyebrow">Filter</span>{chips}</div>

<section>
  <div class="grid" id="posts">
    {cards}
  </div>
  <div class="empty">Nothing matches that. Try a broader word, or clear the filter.</div>
</section>

<section class="band g-card" data-rise>
  <div>
    <h3>Field notes, not a newsletter</h3>
    <p>{E(SITE["tagline"])}</p>
  </div>
</section>
''' + foot("nfn-bot-wave.svg")
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
    page = head(p["title"], p["summary"], url, ogimg, up="../", extra=extra, active="")
    page += f'''
<div class="narrow">
  <div class="backbar"><a class="btn" href="../">{ICO_BACK}&nbsp;All posts</a></div>
  <article>
    <header class="post-head g-hero" data-view="zoom">
      <div class="row" style="margin:0"><a class="tag {p["ccls"]}" href="../index.html#cat={E(p["cat"])}" title="All {E(p["cat"])} posts">{E(p["cat"])}</a><span class="meta">{E(p["date_h"])} &#183; {p["readtime"]} min</span></div>
      <h1 class="h-hero">{E(p["title"])}</h1>
    </header>
    <div class="post-body g-card" data-rise>
      <div class="figure panel">{svg(p["hero"])}</div>
      <div class="callout origin"><span class="eyebrow">Where this came from</span>{E(p.get("origin",""))}</div>
      <div class="prose">{p["html"]}</div>
    </div>
    <section class="end g-card" data-rise>
      <h3>More field notes</h3>
      <div class="postnav">{nav}</div>
    </section>
  </article>
</div>
''' + foot(p["bot"], "../")
    open(os.path.join(ROOT, "p", p["slug"] + ".html"), "w", encoding="utf-8").write(page)

# ── about ───────────────────────────────────────────────────────────────────
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
</div>
''' + foot("nfn-bot-wave.svg")
open(os.path.join(ROOT, "about.html"), "w", encoding="utf-8").write(about)

# ── socials (genie target) ──────────────────────────────────────────────────
SOCIALS = [("LinkedIn", "Where I post when something is worth a wider audience.", SITE["linkedin"], "in"),
           ("HPE Airheads", "Where most of these posts start life, as somebody else's question.", SITE["airheads"], "AH")]
soc = head("Elsewhere · " + SITE["name"], "Where to find Dustin Burns online.", BASE_URL + "/socials.html", BASE_URL + "/og/home.png", active="")
soc += '''
<div class="narrow">
<section class="about g-hero" data-view="genie" style="position:relative">
  <div><span class="eyebrow">Elsewhere</span><h1 class="h-hero" style="margin-top:14px">Where to find me</h1>
  <p class="lede" style="margin-top:10px">Two places worth your time.</p></div>
  <div class="socials">''' + "".join(
    f'''<a class="social g-card" href="{u}" target="_blank" rel="noopener noreferrer" data-rise>
      <span class="social-ico eyebrow">{E(ic)}</span><span><b>{E(n)}</b><span>{E(d)}</span></span></a>''' for n, d, u, ic in SOCIALS) + '''
  </div>
</section>
</div>
''' + foot("nfn-bot-wave.svg")
open(os.path.join(ROOT, "socials.html"), "w", encoding="utf-8").write(soc)

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
rasterize(os.path.join(ROOT, "logo", "nfn-favicon.svg"), os.path.join(ROOT, "apple-touch-icon.png"), 180, 180)

# ── sitemap, feed, housekeeping ─────────────────────────────────────────────
urls = ['<url><loc>%s/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>' % BASE_URL,
        '<url><loc>%s/about.html</loc><priority>0.5</priority></url>' % BASE_URL,
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
