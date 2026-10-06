# The topographic ground

Moved out of CLAUDE.md on 2026-10-05 so it only loads when someone works on this part. The rules in CLAUDE.md still apply.

## The topographic ground

Every page carries a four layer background stack, emitted by `head()` in `build-blog.py` and
sitting at `z-index:0` under `.page`:

1. `.ground` keeps the three radial gradients. It is the floor and the no-WebGL fallback.
2. `#nfn-fx` is a WebGL canvas running `theme/ground.js`, inlined at the bottom of every page.
3. `.gx-pane` is the glass: a diagonal sheen and the same lit top edge the `.g-*` classes use.
4. `.gx-grain` is the frost, deliberately not blurred, because scatter belongs on the pane.

The canvas draws a hypsometric elevation map. The terrain is a two stage domain warped fbm,
remapped to 0..1 (raw fbm lands near 0.48 and never spans the range, which will silently flatten
the whole effect if anyone removes that line), quantised with `floor()` into flat elevation
classes, and contoured on the class boundaries with every fifth line drawn as an index contour.
Contour widths are in screen pixels via `fwidth`, not as a fraction of contour spacing, so raising
the interval does not thin the lines away.

It is deliberately not wet. No specular term, no refraction, no height lift. If a change starts
reintroducing a moving highlight, that is the thing that made earlier versions look like water.

Drift phase comes from the wall clock, `((Date.now()/1000)*SPEED % CYCLE)/CYCLE`, and every term in
the terrain is a whole multiple of `CYCLE`, so the wrap is invisible and a page load resumes mid
drift rather than restarting. That is the whole reason it is a shader and not a video.

Settings are constants at the top of `theme/ground.js`, plus `--gb` and `--veil` in
`theme/style.css`. Current values: blur 6px, veil 0.80, tint 0.44, scale 1.20, interval 13,
brightness 0.75, weight 0.70, drift 3.00. Blur and crisp contours fight each other, so raising
`--gb` much past 8px turns the survey back into a wash.

Cost control: 30 fps cap, render scale 0.84 of device pixels and 0.65 on phones, 1600px hard cap,
paused on a hidden tab, and a single still frame under `prefers-reduced-motion`. If WebGL is
missing the canvas hides itself and `.ground` shows through, so nobody gets a blank page.

Tuning happens in the preview artifact, never by editing the live constants blind. DESIGN-KIT.md
needs this entry too; it is the one animation on the site that is not in `theme/app.js`.
