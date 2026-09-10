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
    "email": "dustin.burns@networkfieldnotes.com",   # socials page only; keep out of feeds and metadata
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
    meta["html"] = terminalize(markdown.markdown(body, extensions=["fenced_code", "tables"]))
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

def head(title, desc, url, ogimg, up="", extra="", active="posts", search=False, theme=""):
    root = up or "/"
    nav = ('<a class="pill%s" href="%s">Posts</a>' % (" on" if active == "posts" else "", root))
    nav += '<a class="pill%s" href="%sacademy.html">Academy</a>' % (" on" if active == "academy" else "", up)
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
cards = card(featured, featured=True) + "".join(card(p) for p in posts if p is not featured)
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
    page = head(p["title"], p["summary"], url, ogimg, up="../", extra=extra, active=("academy" if p["academy"] else ""), theme=("acad" if p["academy"] else ""))
    page += f'''
<div class="narrow">
  <div class="backbar"><a class="btn" href="../{"academy.html" if p["academy"] else ""}">{ICO_BACK}&nbsp;{"Academy" if p["academy"] else "All posts"}</a></div>
  <article>
    <header class="post-head g-hero cat-{E(p["cat"].replace(" ","-"))}" data-view="zoom">
      <div class="row" style="margin:0"><a class="tag {p["ccls"]}" href="../index.html#cat={E(p["cat"])}" title="All {E(p["cat"])} posts">{E(p["cat"])}</a><span class="meta">{E(p["date_h"])} &#183; {p["readtime"]} min</span></div>
      <h1 class="h-hero">{E(p["title"])}</h1>
    </header>
    <div class="post-body g-card" data-rise>
      <div class="figure panel">{svg(p["hero"])}</div>
      {widget(p["interactive"]) if p["interactive"] else ""}
      <div class="callout origin"><span class="eyebrow">Where this came from</span>{E(p.get("origin",""))}</div>
      <div class="prose">{p["html"]}</div>
    </div>
    {series_nav(p)}
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
ACADEMY_START = datetime.date(2026, 9, 10)   # lesson 1; one a week after that
ACADEMY = [
    ("What a Radio Actually Sends", "Frequency, wavelength, amplitude. mW, dBm and dB, and the two rules that let you do the math in your head.", "Read RSSI on an Aruba AP and a Mist AP, double the distance, watch it fall about 6 dB. Confirm on the Sidekick."),
    ("Bands, Channels and Widths", "2.4, 5 and 6 GHz, the U-NII blocks, DFS, and what a wider channel actually costs.", "Change channel width on both platforms and watch client PHY rates and airtime move."),
    ("The Link Budget", "EIRP, antenna gain, receive sensitivity, free space path loss. Where the signal goes.", "Predict RSSI at 10 m, measure it, explain the gap."),
    ("Modulation and Data Rates", "MCS, coding rate, spatial streams. Why \"speed\" is a table, not a number.", "Read MCS in the Central and Mist client views, force a lower rate, measure throughput."),
    ("Airtime Is the Only Resource", "Half duplex, contention, PHY rate versus throughput, and the overhead nobody budgets for.", "Airtime utilisation per SSID, with the mDNS post as the case study."),
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
    q = academy_posts.get(i); due = ACADEMY_START + datetime.timedelta(weeks=i - 1)
    if q:
        acad_items.append('<a class="lesson g-card live" href="p/%s.html" data-origin="zoom" data-rise><span class="ser-n">Lesson %d</span><b>%s</b><p>%s</p><span class="lab"><span class="eyebrow">Lab</span>%s</span><span class="meta">%s &#183; %d min</span></a>'
                          % (E(q["slug"]), i, E(q["title"]), E(q["summary"]), E(lab), E(q["date_h"]), q["readtime"]))
    else:
        acad_items.append('<div class="lesson g-card soon" data-rise><span class="ser-n">Lesson %d</span><b>%s</b><p>%s</p><span class="lab"><span class="eyebrow">Lab</span>%s</span><span class="meta">Planned for the week of %s</span></div>'
                          % (i, E(t), E(blurb), E(lab), E(due.strftime("%b %d").replace(" 0", " "))))
live_n = len(academy_posts)
start_btn = ('<a class="btn cta" href="p/%s.html" data-origin="zoom">Start with lesson 1</a>' % E(academy_posts[1]["slug"])) if 1 in academy_posts else ""
acad = head("Wireless Academy · " + SITE["name"], "Wireless fundamentals, one lesson a week, each with a lab you can run on Aruba and Mist gear.", BASE_URL + "/academy.html", BASE_URL + "/og/academy.png", active="academy", theme="acad")
acad += f'''
<section class="hero g-hero rise acad-hero" data-view="pop">
  <div class="sheen"></div><div class="glow"></div>
  <span class="tag c-orange"><span class="dot"></span>Wireless Academy</span>
  <h1 class="h-hero">The theory, and the lab that proves it</h1>
  <p class="lede">Twelve lessons on how Wi-Fi actually works, pitched at the engineer who runs a network but never got taught why. Each one ends with something you can go and measure on an Aruba AP, a Mist AP, and a Sidekick, because a number you measured yourself is the only kind that sticks.</p>
  <div class="row">
    {start_btn}
    <span class="meta">{live_n} of {len(ACADEMY)} published &#183; new lesson weekly</span>
  </div>
</section>
<section class="acad-why g-card" data-rise>
  <span class="eyebrow">Why orange</span>
  <p>The colour is a nod to the Airheads community. My first expert-level certification came out of an AOS 6 lab and a stack of forum posts by people who answered questions they didn't have to. This section is me paying that forward, one lesson a week.</p>
</section>
<section>
  <div class="lessons">{"".join(acad_items)}</div>
</section>
''' + foot("nfn-bot-think.svg")
open(os.path.join(ROOT, "academy.html"), "w", encoding="utf-8").write(acad)

# ── socials (genie target) ──────────────────────────────────────────────────
SOCIALS = [("LinkedIn", "Where I post when something is worth a wider audience.", SITE["linkedin"], "in"),
           ("HPE Airheads", "Where most of these posts start life, as somebody else's question.", SITE["airheads"], "AH"),
           ("Email", SITE["email"], "mailto:" + SITE["email"], "@")]
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
rasterize(os.path.join(ROOT, "logo", "nfn-favicon.svg"), os.path.join(ROOT, "apple-touch-icon.png"), 180, 180)

# ── sitemap, feed, housekeeping ─────────────────────────────────────────────
urls = ['<url><loc>%s/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>' % BASE_URL,
        '<url><loc>%s/about.html</loc><priority>0.5</priority></url>' % BASE_URL,
        '<url><loc>%s/academy.html</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>' % BASE_URL,
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
