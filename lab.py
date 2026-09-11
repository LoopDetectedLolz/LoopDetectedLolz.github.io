#!/usr/bin/env python3
"""Local workbench for the simulator widget. Nothing here reaches the live site.

    python3 lab.py              build lab.html, serve it, reload the browser on every save
    python3 lab.py --build      build lab.html once and stop
    python3 lab.py --diff       what the lab widget has that the live one does not
    python3 lab.py --promote    copy the lab widget over the live one, rebuild the site
    python3 lab.py --reset      throw the lab widget away and start again from the live one

Edit theme/widgets/qam-lab.html. The live widget, theme/widgets/qam.html, is only
touched by --promote, so the site keeps serving whatever was last pushed while the
lab moves. lab.html is generated and git-ignored; qam-lab.html is committed so the
work in progress has a history.
"""
import os, sys, re, html, json, time, difflib, shutil, threading, subprocess
import http.server, socketserver

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8823
SIM = ["core", "rf", "phy", "mac", "channels", "capacity"]          # model files, loaded separately in the lab
WIDGET = "qam"                                           # set from argv in main()


def paths():
    return (os.path.join(ROOT, "theme", "widgets", WIDGET + ".html"),
            os.path.join(ROOT, "theme", "widgets", WIDGET + "-lab.html"),
            os.path.join(ROOT, "lab.html"))


def watched():
    w = [paths()[1], os.path.join(ROOT, "theme", "style.css"), os.path.join(ROOT, "theme", "app.js")]
    return w + [os.path.join(ROOT, "theme", "sim", f + ".js") for f in SIM]


def seed():
    LIVE, LABW, _ = paths()
    if not os.path.exists(LABW):
        if not os.path.exists(LIVE):
            sys.exit("no theme/widgets/%s.html and no %s-lab.html: nothing to work on" % (WIDGET, WIDGET))
        shutil.copyfile(LIVE, LABW)
        print("seeded theme/widgets/%s-lab.html from the live widget" % WIDGET)


def drift():
    LIVE, LABW, _ = paths()
    if not os.path.exists(LIVE):
        return -1, -1                                    # new widget, nothing live to drift from
    a = open(LIVE, encoding="utf-8").read().splitlines()
    b = open(LABW, encoding="utf-8").read().splitlines()
    if a == b:
        return 0, 0
    d = list(difflib.unified_diff(a, b, "live", "lab", lineterm="", n=0))
    return sum(1 for x in d if x.startswith("+") and not x.startswith("+++")), \
           sum(1 for x in d if x.startswith("-") and not x.startswith("---"))


def build():
    seed()
    LIVE, LABW, OUT = paths()
    css = open(os.path.join(ROOT, "theme", "style.css"), encoding="utf-8").read()
    js = open(os.path.join(ROOT, "theme", "app.js"), encoding="utf-8").read()
    w = open(LABW, encoding="utf-8").read()
    E = lambda t: html.escape(str(t), quote=True)
    if WIDGET == "qam":
        tj = open(os.path.join(ROOT, "demo", "traffic.json"), encoding="utf-8").read().strip()
        w = w.replace('<section class="qam g-card" id="qam"',
                      '<section class="qam g-card" id="qam" data-title="%s" data-traffic="%s"' % (E("Lab"), E(tj)), 1)
    add, rem = drift()
    state = ("not on the site yet" if add < 0 else
             "same as live" if not (add or rem) else "%d lines added, %d removed vs live" % (add, rem))
    # the model files load separately here so a save reloads in a second; the real
    # build concatenates them into the page
    sim = "".join('<script src="theme/sim/%s.js"></script>' % f for f in SIM
                  if os.path.exists(os.path.join(ROOT, "theme", "sim", f + ".js")))
    page = f"""<!doctype html><html lang="en" data-theme="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Lab · simulator</title>
<style>{css}</style>
<style>
.lab-bar{{position:sticky;top:0;z-index:80;display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  padding:8px 14px;margin:0 0 14px;font:600 12px var(--mono);color:#ffd28a;
  background:rgba(245,165,36,0.10);border:1px solid rgba(245,165,36,0.55);border-radius:12px}}
.lab-bar b{{color:#fff}} .lab-bar span{{color:var(--text-muted);font-weight:400}}
.lab-w{{width:100%;max-width:1180px;margin:0 auto;padding:14px 16px 80px}}  /* width:100% or the auto margins stop the flex stretch and the page sizes to its widest child */
.lab-frames{{display:flex;gap:18px;flex-wrap:wrap;margin-top:26px;align-items:flex-start}}
.lab-frames[hidden]{{display:none}}  /* display:flex beats the hidden attribute otherwise */
.lab-frames figure{{margin:0}} .lab-frames figcaption{{font:11px var(--mono);color:var(--text-muted);margin:0 0 6px}}
.lab-frames iframe{{border:1px solid var(--line);border-radius:14px;background:var(--navy)}}
</style></head><body><div class="page"><div class="lab-w">
<div class="lab-bar"><b>LAB</b><span>theme/widgets/{WIDGET}-lab.html &mdash; {state}</span>
  <span>saves reload this page; nothing here is on the site until <b>python3 lab.py --promote</b></span></div>
{sim}
{w}
<p style="margin-top:26px"><button class="chip" id="lab-frames-btn" type="button">Show phone and tablet frames</button></p>
<div class="lab-frames" id="lab-frames" hidden>
  <figure><figcaption>390 x 844 (phone)</figcaption><iframe data-src="lab.html?frame=1" width="390" height="844" title="phone"></iframe></figure>
  <figure><figcaption>820 x 700 (tablet)</figcaption><iframe data-src="lab.html?frame=1" width="820" height="700" title="tablet"></iframe></figure>
</div>
</div></div>
<script>{js}</script>
<script>
/* inside a size frame: show only the widget */
if (/[?&]frame=1/.test(location.search)) {{
  var b = document.querySelector('.lab-bar'), f = document.querySelector('.lab-frames'),
      fb = document.getElementById('lab-frames-btn');
  if (b) b.remove(); if (f) f.remove(); if (fb) fb.parentNode.remove();
  document.querySelector('.lab-w').style.padding = '10px';
}} else {{
  /* the size frames each run their own copy of the widget, so load them on demand */
  document.getElementById('lab-frames-btn').addEventListener('click', function () {{
    var box = document.getElementById('lab-frames'), on = box.hidden;
    box.hidden = !on;
    this.textContent = on ? 'Hide phone and tablet frames' : 'Show phone and tablet frames';
    if (on) Array.prototype.forEach.call(box.querySelectorAll('iframe'), function (f) {{
      if (!f.src) f.src = f.getAttribute('data-src');
    }});
  }});
}}
/* reload when a watched file is saved */
(function () {{
  var last = null;
  setInterval(function () {{
    fetch('/__lab_mtime', {{cache: 'no-store'}}).then(function (r) {{ return r.text(); }}).then(function (t) {{
      if (last !== null && t !== last) location.reload();
      last = t;
    }}).catch(function () {{}});
  }}, 700);
}})();
</script>
</body></html>"""
    open(OUT, "w", encoding="utf-8").write(page)
    return state


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_GET(self):
        if self.path.startswith("/__lab_mtime"):
            v = str(max(os.path.getmtime(p) for p in watched() if os.path.exists(p)))
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(v.encode())
            return
        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


def watch_loop():
    seen = {p: os.path.getmtime(p) for p in watched() if os.path.exists(p)}
    while True:
        time.sleep(0.5)
        for p in watched():
            if not os.path.exists(p):
                continue
            m = os.path.getmtime(p)
            if seen.get(p) != m:
                seen[p] = m
                try:
                    print("  rebuilt:", build())
                except Exception as e:
                    print("  build failed:", e)


def main():
    global WIDGET
    args = sys.argv[1:]
    names = [a for a in args if not a.startswith("-")]
    if names:
        WIDGET = names[0]
    LIVE, LABW, _ = paths()
    if not os.path.exists(LIVE) and not os.path.exists(LABW):
        sys.exit("no widget called %s in theme/widgets" % WIDGET)
    arg = ([a for a in args if a.startswith("-")] or [""])[0]
    if arg == "--reset":
        if not os.path.exists(LIVE):
            sys.exit("%s is not on the site yet, so there is nothing to reset to" % WIDGET)
        shutil.copyfile(LIVE, LABW)
        print("lab widget reset to the live one")
        return
    if arg == "--diff":
        seed()
        if not os.path.exists(LIVE):
            print("%s is not on the site yet; the whole lab file is the difference" % WIDGET); return
        a = open(LIVE, encoding="utf-8").read().splitlines(keepends=True)
        b = open(LABW, encoding="utf-8").read().splitlines(keepends=True)
        d = "".join(difflib.unified_diff(a, b, "theme/widgets/%s.html" % WIDGET, "theme/widgets/%s-lab.html" % WIDGET))
        print(d or "no difference")
        return
    if arg == "--promote":
        seed()
        add, rem = drift()
        if add < 0:
            shutil.copyfile(LABW, LIVE)
            print("%s is now a real widget; wire it into build-blog.py to put it on a page" % WIDGET)
            return
        if not (add or rem):
            print("nothing to promote, the lab widget matches the live one")
            return
        shutil.copyfile(LABW, LIVE)
        print("promoted: %d lines added, %d removed" % (add, rem))
        subprocess.run([sys.executable, os.path.join(ROOT, "build-blog.py")], cwd=ROOT)
        print("site rebuilt. review, then commit and push when you are happy.")
        return
    print(" ", build())
    if arg == "--build":
        return
    threading.Thread(target=watch_loop, daemon=True).start()
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), H) as srv:
        print("  http://127.0.0.1:%d/lab.html   (ctrl-c to stop)" % PORT)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\n  stopped")


if __name__ == "__main__":
    main()
