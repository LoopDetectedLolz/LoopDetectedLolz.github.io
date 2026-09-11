from playwright.sync_api import sync_playwright
import glob, os, sys
B="http://127.0.0.1:8822"
pages=["/","/about.html","/socials.html","/academy.html","/simulator.html"]+["/p/"+os.path.basename(f) for f in sorted(glob.glob("/tmp/site/p/*.html"))]
vis="[...document.querySelectorAll('.card[data-cat]')].filter(c=>!c.classList.contains('hidden')).map(c=>c.dataset.cat)"
fails=[]
def newpage(b,w,h=900):
    pg=b.new_page(viewport={"width":w,"height":h})
    pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    return pg
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for path in pages:
        for w in (360,768,1280):
            pg=newpage(b,w); errs=[]
            pg.on("console", lambda m: errs.append(m.text) if m.type=="error" and "fonts.g" not in m.text and "ERR_FAILED" not in m.text else None)
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(B+path, wait_until="domcontentloaded"); pg.wait_for_timeout(350)
            sw=pg.evaluate("document.documentElement.scrollWidth")
            broken=pg.evaluate("[...document.images].filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.getAttribute('src'))")
            rig=pg.evaluate("(()=>{const r=document.querySelector('.rig');if(!r)return 'MISSING';const cs=getComputedStyle(r);return cs.position+' z'+cs.zIndex})()")
            room=pg.evaluate("(function(){var p=document.querySelector('.page'),m=p&&p.querySelector(':scope>main');return parseFloat(getComputedStyle(p).paddingBottom)+(m?parseFloat(getComputedStyle(m).paddingBottom):0)})()")
            greens=pg.evaluate("[...document.querySelectorAll('.btn.cta,.pill.on')].filter(e=>getComputedStyle(e).backgroundImage.includes('140, 224, 94')||getComputedStyle(e).backgroundColor.includes('140, 224, 94')).length")
            contact=pg.evaluate("/get in touch|grab me|second set of eyes|send it my way|corrections welcome|reach out|i'd like to hear/i.test(document.body.innerText)")
            taps=pg.evaluate("[...document.querySelectorAll('a.pill,a.btn,.chip,.rig')].filter(e=>e.getBoundingClientRect().height>0&&e.getBoundingClientRect().height<38).length")
            ok = sw<=w and not errs and not broken and rig.startswith('fixed') and room>=140 and greens<=1 and not contact and taps==0
            if not ok: fails.append((path,w,dict(scrollWidth=sw,errs=errs[:2],broken=broken,rig=rig,room=room,greens=greens,contact=contact,smallTaps=taps)))
            pg.close()
    print("A. pages x widths:", len(pages)*3, "checked |", len(fails), "failed")
    for f in fails: print("   FAIL", f)
    pg=newpage(b,1280)
    pg.goto(B+"/#cat=Wireless", wait_until="domcontentloaded"); pg.wait_for_timeout(400); a=set(pg.evaluate(vis))
    pg.click(".chip[data-cat='NAC']"); pg.wait_for_timeout(400); c=set(pg.evaluate(vis))
    pg.click(".chip[data-cat='Wireless']"); pg.wait_for_timeout(400); d=set(pg.evaluate(vis))
    pg.click("a.pill:has-text('Posts')"); pg.wait_for_timeout(400); e=pg.evaluate(vis)
    print("B. nav: load Wireless", a, "| NAC", c, "| Wireless again", d, "| Posts shows", len(e))
    pg.click(".chip[data-cat='NAC']"); pg.wait_for_timeout(300)
    print("   nav pills:", pg.evaluate("[...document.querySelectorAll('.nav .pill')].map(x=>x.textContent.trim())"), "| on:", pg.evaluate("[...document.querySelectorAll('.pill.on')].map(x=>x.textContent.trim())"),
          "| chip:", pg.evaluate("[...document.querySelectorAll('.chip.on')].map(x=>x.textContent.trim())"),
          "| pill ring colour:", pg.evaluate("getComputedStyle(document.querySelector('.pill.on')).borderTopColor"))
    pg.goto(B+"/p/vsx-upgrade-hitless.html", wait_until="domcontentloaded"); pg.wait_for_timeout(300)
    pg.click("a.tag"); pg.wait_for_timeout(500)
    print("C. from a post, click its category tag ->", set(pg.evaluate(vis)), "| url:", pg.url.split('8822')[1])
    pg.go_back(); pg.wait_for_timeout(300); pg.go_forward(); pg.wait_for_timeout(300)
    print("   back/forward keeps filter:", set(pg.evaluate(vis)))
    pg.click(".chip[data-cat='all']"); pg.click("#search-toggle"); pg.fill("#q","zzzzqq"); pg.wait_for_timeout(200)
    print("D. empty state:", pg.evaluate("document.querySelector('.empty').classList.contains('show')"), end="")
    pg.fill("#q","vsx"); pg.wait_for_timeout(200); print(" | search 'vsx':", pg.evaluate(vis))
    pg.fill("#q",""); pg.click(".chip[data-cat='Lab']"); pg.wait_for_timeout(200)
    print("   Lab chip:", pg.evaluate(vis), "| tag colour:", pg.evaluate("getComputedStyle(document.querySelector('.card:not(.hidden) .tag')).color"))
    pg.click(".chip[data-cat='all']"); pg.wait_for_timeout(200)
    print("   All again: featured card hidden:", pg.evaluate("document.querySelector('.card[data-featured]').classList.contains('hidden')"), "| shown:", len(pg.evaluate(vis)))
    for cat in ("Wireless","NAC"):
        pg.click(".chip[data-cat='%s']"%cat); pg.wait_for_timeout(150)
        print("   %s tag colour:"%cat, pg.evaluate("getComputedStyle(document.querySelector('.card:not(.hidden) .tag')).color"))
    pg.goto(B+"/", wait_until="domcontentloaded"); pg.wait_for_timeout(400)
    pg.click(".card[data-cat]:not(.hidden)"); pg.wait_for_timeout(300)
    print("E. card -> post zoom:", pg.evaluate("document.querySelector('[data-view]').classList.contains('zoom')"),
          "| origin:", pg.evaluate("document.querySelector('[data-view]').style.transformOrigin"))
    pg.click(".rig"); pg.wait_for_timeout(300)
    print("   rig -> socials genie:", pg.url.endswith("socials.html"), pg.evaluate("document.querySelector('[data-view]').classList.contains('genie')"))
    pg.goto(B+"/p/aos8-to-aos10-is-a-rebuild.html", wait_until="domcontentloaded"); pg.wait_for_timeout(300)
    top0=pg.evaluate("document.querySelector('.rig').getBoundingClientRect().top")
    pg.evaluate("window.scrollTo(0, document.body.scrollHeight)"); pg.wait_for_timeout(300)
    r=pg.evaluate("(()=>{const r=document.querySelector('.rig').getBoundingClientRect();const w=document.querySelector('footer .wrap');const f=w.getBoundingClientRect();const pr=parseFloat(getComputedStyle(w).paddingRight);const last=document.querySelector('.postnav').getBoundingClientRect();return {rigTopUnscrolled:Math.round(top0),rigTopScrolled:Math.round(r.top),footerTextRight:Math.round(f.right-pr),rigLeft:Math.round(r.left),lastContentBottom:Math.round(last.bottom),rigTop:Math.round(r.top)}})()".replace("top0",str(top0)))
    print("F. rig fixed on scroll:", r["rigTopUnscrolled"]==r["rigTopScrolled"], "| footer text clears rig:", r["footerTextRight"]<=r["rigLeft"], "| last content above rig:", r["lastContentBottom"]<=r["rigTop"], r)
    for w in (360,1280):
        pg=newpage(b,w,1100); pg.goto(B+"/", wait_until="domcontentloaded"); pg.wait_for_timeout(500); pg.screenshot(path=f"/tmp/r-index-{w}.png"); pg.close()
    b.close()
