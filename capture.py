#!/usr/bin/env python3
"""Generate the figures the posts use from the live simulator, so they can be
remade instead of re-screenshotted every time the tool changes.

    python3 capture.py              every shot
    python3 capture.py academy-01   one shot

Each shot drives simulator.html in a headless browser and writes into media/.
Needs playwright (python3 -m pip install --user playwright && playwright install chromium)
and ffmpeg for the clips. Run build-blog.py first so simulator.html is current.
"""
import os, sys, glob, math, shutil, socket, asyncio, threading, subprocess
import http.server, socketserver

ROOT = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.path.join(ROOT, "media")
CAP = "Free space. Every doubling of distance costs about 6 dB."


def serve():
    """simulator.html needs an origin: WebCrypto and the canvas want a real one."""
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
        def log_message(self, *a): pass

    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d/" % port


async def setup(pg, base, hide=""):
    """Everything by script, never by pg.click: a click scrolls the control into
    view and the recording then starts somewhere down the page."""
    await pg.goto(base + "simulator.html", wait_until="load")
    await pg.wait_for_timeout(1200)
    if hide:
        await pg.add_style_tag(content=hide + "{display:none!important}.page>main{padding:6px 0 0!important}")
    await pg.evaluate("""()=>{
      const sel=document.getElementById('qam-ant');
      sel.value='omni'; sel.dispatchEvent(new Event('change'));   // a ceiling AP: what the reader is standing under
      document.getElementById('qam-lb').click();                   // link budget strip
      const m=document.getElementById('qam-model');
      if(!/free/i.test(m.textContent)) m.click();                  // free space, n = 2, the rule the lesson just taught
      document.getElementById("qam-dist").value=2;
      document.getElementById("qam-dist").dispatchEvent(new Event("input"));
      window.scrollTo(0,0);
    }""")
    await pg.wait_for_timeout(600)
    await pg.evaluate("window.scrollTo(0,0)")


async def set_d(pg, d):
    await pg.evaluate("(d)=>{const s=document.getElementById('qam-dist');s.value=d;s.dispatchEvent(new Event('input'))}", d)
    await pg.wait_for_timeout(450)


async def strip_box(pg):
    """The widget reports the panel rectangle itself, in canvas units, which are CSS px."""
    return await pg.evaluate("""()=>{const c=document.getElementById('qam-c'),b=c.getBoundingClientRect(),
      s=document.getElementById('qam')._dbg().strip;
      return{x:b.x+s.x,y:b.y+s.y,w:s.w,h:s.h}}""")


async def budget(pg):
    return await pg.evaluate("document.getElementById('qam')._dbg().lb")


async def academy_01(pg, base):
    """Four link budget strips at the lesson's own lab distances, with the step
    between them read back from the widget rather than worked out here."""
    from PIL import Image, ImageDraw, ImageFont
    await setup(pg, base)
    await pg.evaluate("document.getElementById('qam-pause').click()")   # a still should be still
    await pg.wait_for_timeout(300)
    rows = []
    for d in (2, 4, 8, 16):
        await set_d(pg, d)
        r = await strip_box(pg)
        p = "/tmp/_cap_%d.png" % d
        await pg.screenshot(path=p, clip={"x": r["x"] - 2, "y": r["y"] - 2, "width": r["w"] + 4, "height": r["h"] + 4})
        rows.append((d, Image.open(p).convert("RGB"), (await budget(pg))["prx"]))

    def font(sz, bold=False):
        pats = ["/usr/share/fonts/**/DejaVuSansMono%s.ttf" % ("-Bold" if bold else ""),
                "/System/Library/Fonts/**/Menlo*", "/System/Library/Fonts/*.ttc"]
        for pat in pats:
            for c in glob.glob(pat, recursive=True):
                try: return ImageFont.truetype(c, sz)
                except Exception: pass
        return ImageFont.load_default()

    w, h = rows[0][1].size
    S = 2                                   # captured at devicePixelRatio 2; the post shows it at half size
    gap, pad, top = 34 * S, 18 * S, 44 * S
    out = Image.new("RGB", (w + 2 * pad, top + len(rows) * h + (len(rows) - 1) * gap + 34 * S), (8, 17, 25))
    dr = ImageDraw.Draw(out)
    dr.text((pad, 15 * S), "WHAT FREE SPACE SAYS YOUR FOUR NUMBERS SHOULD DO", font=font(14 * S, True), fill=(234, 242, 246))
    for i, (d, im, prx) in enumerate(rows):
        y = top + i * (h + gap)
        out.paste(im, (pad, y))
        dr.rectangle([pad, y, pad + w - 1, y + h - 1], outline=(38, 58, 72), width=S)
        if i:
            step = prx - rows[i - 1][2]
            cy = y - gap // 2
            dr.line([(pad + w // 2, cy - 9 * S), (pad + w // 2, cy + 9 * S)], fill=(140, 224, 94), width=2 * S)
            dr.polygon([(pad + w // 2 - 4 * S, cy + 5 * S), (pad + w // 2 + 4 * S, cy + 5 * S), (pad + w // 2, cy + 11 * S)], fill=(140, 224, 94))
            dr.text((pad + w // 2 + 12 * S, cy - 6 * S), "%s m  %+.1f dB" % (d, step), font=font(13 * S, True), fill=(140, 224, 94))
            dr.text((pad + w // 2 - 12 * S - dr.textlength("twice the distance", font=font(13 * S)), cy - 6 * S),
                    "twice the distance", font=font(13 * S), fill=(139, 162, 174))
    dr.text((pad, out.size[1] - 24 * S), CAP, font=font(13 * S), fill=(139, 162, 174))
    out.save(os.path.join(MEDIA, "academy-01-six-db.png"))
    print("  media/academy-01-six-db.png", out.size, " ".join("%d m %.1f" % (d, p) for d, _, p in rows))


async def academy_01_clip(pg, base):
    """The client walked from 2 m to 16 m with the strip tracking. Controls and
    canvas only: the app panel and the hex pane are another lesson's business."""
    await setup(pg, base, hide="#qam-stat,#qam-hint,#qam-x,#qam-table,.qam-app,.qam-rx,.hdr,.sim-intro,.band,footer,.rig")
    await pg.wait_for_timeout(300)
    await set_d(pg, 2)
    await pg.wait_for_timeout(2000)
    steps = 140
    for i in range(steps + 1):        # log sweep, so each doubling takes the same time
        await pg.evaluate("(d)=>{const s=document.getElementById('qam-dist');s.value=Math.round(d);s.dispatchEvent(new Event('input'))}",
                          2 * math.pow(8, i / steps))
        await pg.wait_for_timeout(60)
    await pg.wait_for_timeout(2400)


SHOTS = {"academy-01": academy_01}


async def run(names):
    from playwright.async_api import async_playwright
    srv, base = serve()
    vid = "/tmp/_capvid"
    shutil.rmtree(vid, ignore_errors=True)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for n in names:
                print(n)
                sctx = await b.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=2)
                pg = await sctx.new_page()
                await SHOTS[n](pg, base)
                await pg.close(); await sctx.close()
                if n == "academy-01":
                    ctx = await b.new_context(viewport={"width": 1280, "height": 600},
                                              record_video_dir=vid, record_video_size={"width": 1280, "height": 600})
                    pg = await ctx.new_page()
                    await academy_01_clip(pg, base)
                    await pg.close(); await ctx.close()
            await b.close()
    finally:
        srv.shutdown()
    webm = sorted(glob.glob(vid + "/*.webm"))
    if webm and shutil.which("ffmpeg"):
        mp4 = os.path.join(MEDIA, "academy-01-six-db.mp4")
        drawtext = ("drawtext=text='%s':fontcolor=0xEAF2F6:fontsize=20:x=(w-text_w)/2:y=h-34:"
                    "box=1:boxcolor=0x0A1722@0.9:boxborderw=10" % CAP.replace(":", "\\:").replace("'", ""))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "3.0", "-i", webm[-1],
                        "-vf", "scale=1280:-2," + drawtext, "-c:v", "libx264", "-crf", "26",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], check=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp4, "-frames:v", "1", "-q:v", "3",
                        os.path.join(MEDIA, "academy-01-six-db.jpg")], check=True)
        print("  media/academy-01-six-db.mp4", os.path.getsize(mp4) // 1024, "KB")
    elif webm:
        print("  ffmpeg not found; the raw recording is at", webm[-1])


if __name__ == "__main__":
    want = sys.argv[1:] or list(SHOTS)
    bad = [n for n in want if n not in SHOTS]
    if bad:
        sys.exit("unknown shot: %s (have: %s)" % (", ".join(bad), ", ".join(SHOTS)))
    asyncio.run(run(want))
