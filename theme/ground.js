/* Network Field Notes: the topographic ground.
   A hypsometric elevation map on a canvas behind every page, drifting on a clock-derived
   phase so it resumes mid-motion on a reload instead of restarting. Settings are fixed
   here; the tuning surface lives in the preview, not on the live site.
   Falls back to the .ground gradients when WebGL is missing, and renders one still frame
   under prefers-reduced-motion. */
(function () {
  var cv = document.getElementById("nfn-fx");
  if (!cv) return;

  var TINT = 0.44,    // how far the flat elevation classes pull away from the site gradients
      SCALE = 1.20,   // terrain scale: low means big sweeping landforms
      BANDS = 13,     // contour interval, and every fifth boundary is an index contour
      AMT = 0.75,     // contour brightness
      WT = 0.70,      // line weight, in screen pixels
      SPEED = 3.00,   // drift multiplier
      CYCLE = 600;    // seconds; every term in the terrain is a whole multiple of this

  function off() { cv.style.display = "none"; }

  var gl = null;
  try {
    gl = cv.getContext("webgl", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "low-power" });
  } catch (e) { gl = null; }
  if (!gl) { off(); return; }

  var deriv = gl.getExtension("OES_standard_derivatives");

  var VERT = "attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}";

  var FRAG = [
    deriv ? "#extension GL_OES_standard_derivatives : enable\n#define HAS_FW 1" : "",
    "precision highp float;",
    "uniform vec2 uRes;uniform float uPh;",
    "const float TINT=" + TINT.toFixed(3) + ",SCALE=" + SCALE.toFixed(3) + ",BANDS=" + BANDS.toFixed(1) +
      ",AMT=" + AMT.toFixed(3) + ",WT=" + WT.toFixed(3) + ";",

    "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}",
    "float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);",
    " return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);}",
    "float fbm(vec2 p){float s=0.0,a=0.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);",
    " for(int i=0;i<5;i++){s+=a*vn(p);p=m*p;a*=0.5;}return s;}",

    /* terrain: two-stage domain warp, so contours curl like a survey rather than lying in stripes */
    "float H(vec2 p,vec2 dr){vec2 q=vec2(fbm(p+dr),fbm(p+dr+vec2(5.2,1.3)));",
    " return fbm(p+(1.35+0.22*sin(uPh*2.0))*q+dr*0.55);}",

    /* the site's own three radial gradients, so the map sits on the ground the site already has */
    "float rg(vec2 px,vec2 c,vec2 r,float stop){return clamp(1.0-length((px-c)/r)/stop,0.0,1.0);}",
    "vec3 ground(vec2 px,vec2 res){vec3 col=vec3(0.0235,0.0627,0.0980);",
    " col=mix(col,vec3(0.1843,0.6588,0.8784),0.42*rg(px,vec2(res.x*0.12,res.y*-0.06),res.y*vec2(1.10,0.76),0.62));",
    " col=mix(col,vec3(0.5490,0.8784,0.3686),0.26*rg(px,vec2(res.x*0.88,res.y*0.08),res.y*vec2(0.93,0.68),0.60));",
    " col=mix(col,vec3(0.0902,0.5412,0.6588),0.34*rg(px,vec2(res.x*0.60,res.y*1.08),res.y*vec2(1.22,0.86),0.62));",
    " return col;}",

    /* hypsometric ramp, sampled at the CLASS so every band is one flat tone */
    "vec3 hyps(float t){",
    " vec3 c0=vec3(0.014,0.038,0.062);",
    " vec3 c1=vec3(0.028,0.112,0.176);",
    " vec3 c2=vec3(0.050,0.212,0.262);",
    " vec3 c3=vec3(0.112,0.300,0.232);",
    " vec3 c=mix(c0,c1,smoothstep(0.00,0.36,t));",
    " c=mix(c,c2,smoothstep(0.32,0.70,t));",
    " return mix(c,c3,smoothstep(0.66,1.00,t));}",

    "void main(){",
    " vec2 px=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);",
    " vec2 uv=px/uRes.y;",
    /* both harmonics are whole multiples of the cycle, so the wrap is invisible */
    " vec2 dr=vec2(cos(uPh),sin(uPh))*0.30+vec2(cos(3.0*uPh+1.7),sin(2.0*uPh+0.6))*0.11;",
    " float h=H(uv*SCALE,dr);",
    /* fbm lands around 0.48 give or take 0.12, never 0 to 1, so remap before classing it */
    " h=clamp((h-0.26)*2.05,0.0,1.0);",
    " float e=h*BANDS;",
    "#ifdef HAS_FW",
    " float w=max(fwidth(e),1e-4);",
    "#else",
    " float ep=1.6/uRes.y;",
    " float w=max(abs(H((uv+vec2(ep,0.0))*SCALE,dr)-h)+abs(H((uv+vec2(0.0,ep))*SCALE,dr)-h),1e-4)*BANDS;",
    "#endif",

    /* flat elevation classes: floor() before the ramp is what makes the step hard */
    " float lvl=clamp(floor(e)/BANDS,0.0,1.0);",
    " vec3 col=mix(ground(px,uRes),hyps(lvl),TINT);",

    /* contours on the integer crossings, widths in screen pixels, every fifth one an index line */
    " float fr=fract(e);float d=min(fr,1.0-fr);",
    " float idx=step(mod(floor(e+0.5),5.0),0.5);",
    " float wdt=w*WT*mix(1.0,2.6,idx);",
    " float line=1.0-smoothstep(wdt,wdt+w*1.15,d);",
    " vec3 lcol=mix(vec3(0.252,0.560,0.652),vec3(0.560,0.830,0.878),idx);",
    " col+=lcol*line*(0.07+0.36*AMT)*mix(0.70,1.0,idx);",

    " col+=(hash(gl_FragCoord.xy+uPh)-0.5)/255.0;",
    " gl_FragColor=vec4(col,1.0);}"
  ].join("\n") + "\n";

  function sh(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }
  var vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { off(); return; }
  var pr = gl.createProgram();
  gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { off(); return; }
  gl.useProgram(pr);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(pr, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(pr, "uRes"), uPh = gl.getUniformLocation(pr, "uPh");
  var W = 0, H = 0;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var s = (window.innerWidth < 760 ? 0.66 : 0.92) - 6 * 0.013;
    var w = Math.max(2, Math.round(window.innerWidth * dpr * s));
    var h = Math.max(2, Math.round(window.innerHeight * dpr * s));
    var cap = 1600, m = Math.max(w, h);
    if (m > cap) { w = Math.round(w * cap / m); h = Math.round(h * cap / m); }
    if (w === W && h === H) return;
    W = w; H = h; cv.width = w; cv.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
  }

  function draw() {
    gl.uniform1f(uPh, (((Date.now() / 1000) * SPEED % CYCLE) / CYCLE) * Math.PI * 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var last = 0, running = false;

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (now - last < 33) return;      /* 30 fps is plenty for something this slow */
    last = now;
    resize(); draw();
  }
  function still() { resize(); draw(); }
  function start() {
    if (reduced.matches) { running = false; still(); return; }
    if (running) return;
    running = true; last = 0; requestAnimationFrame(frame);
  }
  function stop() { running = false; }

  window.addEventListener("resize", function () { if (!running) still(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();   /* resumes at the clock's phase, not where it paused */
  });
  if (reduced.addEventListener) reduced.addEventListener("change", function () { stop(); start(); });

  start();
})();
