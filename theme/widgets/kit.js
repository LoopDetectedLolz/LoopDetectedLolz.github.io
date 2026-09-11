(function () {
  var $ = function (id) { return document.getElementById(id); }, KEY = "nfn-kit-v1";

  var CHECKS = {
    p1: ["Every access point boots and shows up on a laptop",
         "The pre-staged group has the mesh cluster, the SSIDs and the firewall policy in it",
         "Subscriptions cover every device in the bin",
         "Labels are legible, or photographed while they still are",
         "Power sorted: injectors, a generator or a battery, and a way to run cable",
         "This page is saved for offline use"],
    p2: ["Terminal has sky and is locked on",
         "Portal is wired to the terminal and powered",
         "Every mesh point is placed, powered and recorded above",
         "Nothing is sitting on the ground: every node is as high as it can safely go",
         "Positions fixed, so the site lands in the right place on a map"],
    p4: ["Every access point is up in Central and in the right group",
         "Every mesh point shows a portal and a hop count you expected",
         "The guest SSID is broadcasting from every node, not just the portal",
         "A real client gets an address and reaches the internet",
         "Guest traffic leaves through the upstream firewall, not around it",
         "RF calibration has run since the last access point came up",
         "Throughput measured against the uplink, and the number written down",
         "The card is printed and handed to whoever stays"]
  };

  var S = {
    kit: { aps: 6, subs: 6, poe: 6, mounts: 6, cable: 6, term: 1 },
    group: "popup-mesh", site: "", contact: "", phone: "", notes: "",
    lat: null, lon: null, acc: null,
    aps: [], ssids: [{ name: "popup-corp", on: true }, { name: "popup-guest", on: true }],
    guest: { ssid: "popup-guest", psk: "", vlan: 100 },
    done: {}, skip: {}, page: 0
  };
  try { var raw = localStorage.getItem(KEY); if (raw) S = Object.assign(S, JSON.parse(raw)); } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  var esc = function (t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  /* ── the kit ───────────────────────────────────────────────────────────── */
  function kitWarn() {
    var w = [], k = S.kit;
    if (k.subs < k.aps) w.push("Only " + k.subs + " subscriptions for " + k.aps +
      " access points. In New Central a device with no subscription takes no configuration at all, so " +
      (k.aps - k.subs) + " of these will come up and do nothing.");
    if (k.poe < k.aps) w.push("Fewer ways to power an access point than access points.");
    if (k.mounts < k.aps) w.push("Fewer mounts than access points. Something ends up on the ground, and on the ground is where mesh links die.");
    if (!k.term) w.push("No satellite terminal in the count.");
    $("k-kitwarn").innerHTML = w.map(function (t) { return '<div class="k-warn">' + esc(t) + "</div>"; }).join("");
  }

  /* ── access points ─────────────────────────────────────────────────────── */
  var SERIAL = /\b([A-Z]{2,4}[A-Z0-9]{6,10})\b/gi,
      MAC = /\b([0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}|[0-9a-f]{12})\b/gi;

  function normMac(m) {
    var h = m.replace(/[^0-9a-f]/gi, "").toLowerCase();
    return h.length === 12 ? h.match(/.{2}/g).join(":") : m;
  }
  function looksLikeMac(s) { return /^[0-9a-f]{12}$/i.test(s.replace(/[^0-9a-f]/gi, "")) && s.replace(/[^0-9a-f]/gi, "").length === 12; }

  function addAp(serial, mac, quiet) {
    serial = (serial || "").trim().toUpperCase();
    mac = mac ? normMac(mac) : "";
    if (!serial && !mac) return false;
    var hit = S.aps.filter(function (a) { return (serial && a.serial === serial) || (mac && a.mac === mac); })[0];
    if (hit) { if (serial) hit.serial = serial; if (mac) hit.mac = mac; }
    else S.aps.push({ serial: serial, mac: mac, role: S.aps.length ? "point" : "portal", place: "", lat: null, lon: null });
    if (!quiet) { save(); render(); }
    return true;
  }

  function parseBlob(text) {
    var added = 0;
    text.split(/[\r\n]+/).forEach(function (line) {
      var macs = line.match(MAC) || [], serials = [];
      var rest = line.replace(MAC, " ");
      (rest.match(SERIAL) || []).forEach(function (s) { if (!looksLikeMac(s)) serials.push(s); });
      var n = Math.max(macs.length, serials.length), i;
      for (i = 0; i < n; i++) if (addAp(serials[i] || "", macs[i] || "", true)) added++;
    });
    save(); render();
    return added;
  }

  function apRows() {
    $("k-rows").innerHTML = S.aps.map(function (a, i) {
      return "<tr>" +
        '<td><input type="text" data-f="serial" data-i="' + i + '" value="' + esc(a.serial) + '" placeholder="serial"></td>' +
        '<td><input type="text" data-f="mac" data-i="' + i + '" value="' + esc(a.mac) + '" placeholder="mac"></td>' +
        '<td><select data-f="role" data-i="' + i + '">' +
          ['portal', 'point', 'wired'].map(function (r) {
            return '<option value="' + r + '"' + (a.role === r ? " selected" : "") + ">" +
              { portal: "Portal", point: "Mesh point", wired: "Wired" }[r] + "</option>"; }).join("") +
        "</select></td>" +
        '<td><input type="text" data-f="place" data-i="' + i + '" value="' + esc(a.place) + '" placeholder="north gate, 4 m pole"></td>' +
        '<td><button class="k-mini" data-gps="' + i + '" type="button">' +
          (a.lat == null ? "fix" : a.lat.toFixed(4) + ", " + a.lon.toFixed(4)) + "</button></td>" +
        '<td><button class="k-mini k-x" data-del="' + i + '" type="button" aria-label="remove">&times;</button></td></tr>';
    }).join("") || '<tr><td colspan="6" class="k-empty">Nothing recorded yet. Scan a label, paste a packing list, or add one by hand.</td></tr>';
    var portals = S.aps.filter(function (a) { return a.role === "portal"; }).length;
    $("k-apcount").textContent = S.aps.length + " recorded, " + portals + " portal" + (portals === 1 ? "" : "s");
  }

  /* ── the queue ─────────────────────────────────────────────────────────── */
  function queue() {
    var q = [], n = S.aps.length, on = S.ssids.filter(function (s) { return s.on; }),
        off = S.ssids.filter(function (s) { return !s.on; });
    q.push({ id: "site", t: "Create the site", d: "“" + (S.site || "unnamed") + "”" +
      (S.lat != null ? " at " + S.lat.toFixed(5) + ", " + S.lon.toFixed(5) : ", with no position fixed") +
      (S.contact ? ", contact " + S.contact : "") + (S.phone ? " on " + S.phone : "") });
    q.push({ id: "subs", t: "Assign subscriptions", d: n + " device" + (n === 1 ? "" : "s") +
      ". Nothing below this works until it has run: an unsubscribed access point takes no configuration." });
    q.push({ id: "group", t: "Move devices into the group", d: "“" + S.group + "”, all " + n });
    q.push({ id: "assign", t: "Assign devices to the site", d: "all " + n + ", so the map and the licences agree" });
    if (on.length || off.length) q.push({ id: "ssids", t: "Set the SSIDs", d:
      (on.length ? "on: " + on.map(function (s) { return s.name; }).join(", ") : "none on") +
      (off.length ? ". off: " + off.map(function (s) { return s.name; }).join(", ") : "") });
    q.push({ id: "guest", t: "Deploy the guest PSK SSID", d: "“" + S.guest.ssid + "” on VLAN " +
      S.guest.vlan + ", upstream firewall in the path" + (S.guest.psk ? "" : ". No passphrase set yet.") });
    q.push({ id: "rf", t: "Run RF calibration", d:
      "last, and only once every access point has checked in. On a pop-up they power up minutes apart, so the " +
      "channel plan computed at boot was made against half a network." });
    return q;
  }

  function queueRows() {
    var q = queue();
    $("k-queue").innerHTML = q.map(function (a) {
      var sk = S.skip[a.id];
      return '<li class="' + (sk ? "k-off" : "") + '"><label><input type="checkbox" data-q="' + a.id + '"' +
        (sk ? "" : " checked") + "><b>" + esc(a.t) + "</b></label><span>" + esc(a.d) + "</span></li>";
    }).join("");
    $("k-qn").textContent = q.filter(function (a) { return !S.skip[a.id]; }).length + " of " + q.length + " to run";
  }

  /* ── outputs ───────────────────────────────────────────────────────────── */
  function csv() {
    return "serial,mac,role,placement,latitude,longitude,site,group\n" + S.aps.map(function (a) {
      return [a.serial, a.mac, a.role, '"' + (a.place || "").replace(/"/g, '""') + '"',
              a.lat == null ? "" : a.lat.toFixed(6), a.lon == null ? "" : a.lon.toFixed(6),
              '"' + S.site.replace(/"/g, '""') + '"', S.group].join(",");
    }).join("\n");
  }

  function plan() {
    return JSON.stringify({
      site: { name: S.site, contact: S.contact, phone: S.phone, notes: S.notes,
              latitude: S.lat, longitude: S.lon, accuracy_m: S.acc },
      group: S.group,
      devices: S.aps.map(function (a) {
        return { serial: a.serial, mac: a.mac, role: a.role, placement: a.place, latitude: a.lat, longitude: a.lon };
      }),
      ssids: S.ssids, guest: { ssid: S.guest.ssid, vlan: S.guest.vlan },
      actions: queue().filter(function (a) { return !S.skip[a.id]; }).map(function (a) { return a.id; })
    }, null, 2);
  }

  function script() {
    var acts = queue().filter(function (a) { return !S.skip[a.id]; }).map(function (a) { return a.id; });
    return [
      "#!/usr/bin/env python3",
      '"""Run the pop-up queue against New Central. Dry run unless you pass --apply.',
      "",
      "Credentials come from the environment and are never written down by the page",
      "that generated this:",
      "    export GLP_CLIENT_ID=...",
      "    export GLP_CLIENT_SECRET=...",
      "    export GLP_BASE=https://global.api.greenlake.hpe.com",
      "",
      "The endpoint paths in ENDPOINTS below are the one thing to check against your",
      "own tenant's API reference before you trust this in front of a customer. The",
      "order of operations is the part that matters and that part is right:",
      "subscriptions before group, group before site assignment, RF calibration last.",
      '"""',
      "import os, sys, json, time, urllib.request, urllib.error",
      "",
      "APPLY = '--apply' in sys.argv",
      "BASE = os.environ.get('GLP_BASE', 'https://global.api.greenlake.hpe.com')",
      "",
      "# verify these against your tenant before applying",
      "ENDPOINTS = {",
      "    'token':    '/oauth2/v1/token',",
      "    'sites':    '/service-catalog/v1beta1/sites',",
      "    'subs':     '/subscriptions/v1beta1/assignments',",
      "    'group':    '/network-config/v1alpha1/groups/{group}/devices',",
      "    'assign':   '/service-catalog/v1beta1/sites/{site_id}/devices',",
      "    'ssids':    '/network-config/v1alpha1/groups/{group}/wlans',",
      "    'rf':       '/network-monitoring/v1alpha1/rf/optimize',",
      "}",
      "",
      "PLAN = " + plan().replace(/\n/g, "\n"),
      "",
      "ACTIONS = " + JSON.stringify(acts),
      "",
      "GUEST_PSK = os.environ.get('POPUP_GUEST_PSK', '')  # not carried in this file",
      "",
      "",
      "def token():",
      "    cid, sec = os.environ.get('GLP_CLIENT_ID'), os.environ.get('GLP_CLIENT_SECRET')",
      "    if not cid or not sec:",
      "        sys.exit('set GLP_CLIENT_ID and GLP_CLIENT_SECRET')",
      "    body = f'grant_type=client_credentials&client_id={cid}&client_secret={sec}'.encode()",
      "    req = urllib.request.Request(BASE + ENDPOINTS['token'], data=body,",
      "                                 headers={'Content-Type': 'application/x-www-form-urlencoded'})",
      "    with urllib.request.urlopen(req, timeout=30) as r:",
      "        return json.load(r)['access_token']",
      "",
      "",
      "def call(tok, method, path, body=None):",
      "    if not APPLY:",
      "        print(f'  would {method} {path}')",
      "        if body:",
      "            print('    ' + json.dumps(body)[:300])",
      "        return {'dry_run': True}",
      "    data = json.dumps(body).encode() if body is not None else None",
      "    req = urllib.request.Request(BASE + path, data=data, method=method,",
      "                                 headers={'Authorization': 'Bearer ' + tok,",
      "                                          'Content-Type': 'application/json'})",
      "    try:",
      "        with urllib.request.urlopen(req, timeout=60) as r:",
      "            raw = r.read()",
      "            return json.loads(raw) if raw else {}",
      "    except urllib.error.HTTPError as e:",
      "        print(f'    {e.code} {e.reason}: {e.read()[:400].decode(errors=\"replace\")}')",
      "        raise",
      "",
      "",
      "def main():",
      "    tok = token() if APPLY else ''",
      "    serials = [d['serial'] for d in PLAN['devices'] if d['serial']]",
      "    site_id = None",
      "    print(('APPLYING' if APPLY else 'DRY RUN') + f\": {len(serials)} devices, group {PLAN['group']}\")",
      "",
      "    if 'site' in ACTIONS:",
      "        print('1. create the site')",
      "        s = PLAN['site']",
      "        out = call(tok, 'POST', ENDPOINTS['sites'], {",
      "            'name': s['name'], 'description': s.get('notes', ''),",
      "            'address': {'latitude': s.get('latitude'), 'longitude': s.get('longitude')},",
      "            'contact': {'name': s.get('contact', ''), 'phone': s.get('phone', '')}})",
      "        site_id = out.get('id', 'DRY-RUN-SITE')",
      "",
      "    if 'subs' in ACTIONS:",
      "        print('2. assign subscriptions (nothing below works until this does)')",
      "        call(tok, 'POST', ENDPOINTS['subs'], {'devices': serials})",
      "",
      "    if 'group' in ACTIONS:",
      "        print('3. move devices into the group')",
      "        call(tok, 'POST', ENDPOINTS['group'].format(group=PLAN['group']), {'serials': serials})",
      "",
      "    if 'assign' in ACTIONS and site_id:",
      "        print('4. assign devices to the site')",
      "        call(tok, 'POST', ENDPOINTS['assign'].format(site_id=site_id), {'serials': serials})",
      "",
      "    if 'ssids' in ACTIONS:",
      "        print('5. set the SSIDs')",
      "        for s in PLAN['ssids']:",
      "            call(tok, 'PATCH', ENDPOINTS['ssids'].format(group=PLAN['group']),",
      "                 {'name': s['name'], 'enabled': bool(s['on'])})",
      "",
      "    if 'guest' in ACTIONS:",
      "        print('6. deploy the guest SSID')",
      "        if not GUEST_PSK:",
      "            print('    no POPUP_GUEST_PSK in the environment; set it or the SSID goes up open')",
      "        call(tok, 'POST', ENDPOINTS['ssids'].format(group=PLAN['group']), {",
      "            'name': PLAN['guest']['ssid'], 'opmode': 'wpa3-sae',",
      "            'passphrase': GUEST_PSK, 'vlan': PLAN['guest']['vlan'],",
      "            'forward_mode': 'bridge', 'enabled': True})",
      "",
      "    if 'rf' in ACTIONS:",
      "        print('7. RF calibration, last, once everything has checked in')",
      "        call(tok, 'POST', ENDPOINTS['rf'], {'group': PLAN['group'], 'mode': 'full'})",
      "",
      "    print('done' if APPLY else 'dry run only. Re-run with --apply when you mean it.')",
      "",
      "",
      "if __name__ == '__main__':",
      "    main()"
    ].join("\n");
  }

  /* ── the printed card ──────────────────────────────────────────────────── */
  function card() {
    var rows = S.aps.map(function (a) {
      return "<tr><td>" + esc(a.serial) + "</td><td>" + esc(a.mac) + "</td><td>" +
        { portal: "Portal", point: "Mesh point", wired: "Wired" }[a.role] + "</td><td>" + esc(a.place) +
        "</td><td>" + (a.lat == null ? "" : a.lat.toFixed(5) + ", " + a.lon.toFixed(5)) + "</td></tr>";
    }).join("");
    $("k-card").innerHTML =
      "<h1>" + esc(S.site || "Pop-up site") + "</h1>" +
      "<p>" + esc(S.contact) + (S.phone ? " &middot; " + esc(S.phone) : "") +
      (S.lat != null ? " &middot; " + S.lat.toFixed(5) + ", " + S.lon.toFixed(5) : "") + "</p>" +
      "<p><b>Group</b> " + esc(S.group) + " &middot; <b>Guest</b> " + esc(S.guest.ssid) +
      " on VLAN " + S.guest.vlan + (S.guest.psk ? " &middot; <b>Passphrase</b> " + esc(S.guest.psk) : "") + "</p>" +
      (S.notes ? "<p>" + esc(S.notes) + "</p>" : "") +
      "<table><thead><tr><th>Serial</th><th>MAC</th><th>Role</th><th>Where</th><th>Position</th></tr></thead><tbody>" +
      (rows || "<tr><td colspan='5'>No devices recorded</td></tr>") + "</tbody></table>" +
      "<p class='k-cardfoot'>Printed " + new Date().toLocaleString() + "</p>";
  }

  /* ── checklists and progress ───────────────────────────────────────────── */
  function checks() {
    ["p1", "p2", "p4"].forEach(function (p) {
      $(p + "-check").innerHTML = CHECKS[p].map(function (t, i) {
        var id = p + ":" + i;
        return '<li><label><input type="checkbox" data-c="' + id + '"' + (S.done[id] ? " checked" : "") +
          "><span>" + esc(t) + "</span></label></li>";
      }).join("");
      var done = CHECKS[p].filter(function (t, i) { return S.done[p + ":" + i]; }).length;
      $(p + "-n").textContent = done + " of " + CHECKS[p].length;
    });
    $("p3-n").textContent = queue().filter(function (a) { return !S.skip[a.id]; }).length + " to run";
    var all = CHECKS.p1.length + CHECKS.p2.length + CHECKS.p4.length,
        got = Object.keys(S.done).filter(function (k) { return S.done[k]; }).length,
        pct = Math.round(got / all * 100);
    $("k-bar-fill").style.width = pct + "%";
    $("k-prog").textContent = got === 0 ? "Nothing done yet." :
      got + " of " + all + " checks done, " + S.aps.length + " access points recorded.";
  }

  /* ── one phase on screen at a time ───────────────────────────────────────
     A kit is worked, not read. Each phase is a page, the page is in the hash so
     the back button and a bookmark both behave, and where you were is kept so
     reopening it in a car park puts you back where you stopped. */
  var PAGES = [
    { id: "p1", label: "Before you leave" },
    { id: "p2", label: "On site" },
    { id: "p3", label: "Uplink up" },
    { id: "p4", label: "Before you go" }
  ];

  function showPage(i, fromHash) {
    i = Math.max(0, Math.min(PAGES.length - 1, i | 0));
    S.page = i; save();
    PAGES.forEach(function (p, k) { $(p.id).classList.toggle("on", k === i); });
    $("k-steps").innerHTML = PAGES.map(function (p, k) {
      return "<b class='" + (k === i ? "k-at" : k < i ? "k-was" : "") + "'></b>";
    }).join("");
    $("k-back").disabled = i === 0;
    $("k-back").textContent = i === 0 ? "Back" : PAGES[i - 1].label;
    $("k-next").disabled = i === PAGES.length - 1;
    $("k-next").textContent = i === PAGES.length - 1 ? "That is the lot" : PAGES[i + 1].label;
    $("k-where").innerHTML = (i + 1) + " of " + PAGES.length + "<b>" + esc(PAGES[i].label) + "</b>";
    if (!fromHash) {
      try { history.replaceState(null, "", "#" + (i + 1)); } catch (e) { location.hash = "#" + (i + 1); }
    }
    window.scrollTo(0, 0);
  }

  function render() { kitWarn(); apRows(); queueRows(); checks(); card(); }

  /* ── wiring ────────────────────────────────────────────────────────────── */
  function bindNum(id, key) {
    $(id).value = S.kit[key];
    $(id).addEventListener("input", function () { S.kit[key] = Math.max(0, +this.value || 0); save(); render(); });
  }
  bindNum("k-aps", "aps"); bindNum("k-subs", "subs"); bindNum("k-poe", "poe");
  bindNum("k-mounts", "mounts"); bindNum("k-cable", "cable"); bindNum("k-term", "term");

  [["k-group", "group"], ["k-site", "site"], ["k-contact", "contact"], ["k-phone", "phone"], ["k-notes", "notes"]]
    .forEach(function (p) {
      $(p[0]).value = S[p[1]] || "";
      $(p[0]).addEventListener("input", function () { S[p[1]] = this.value; save(); render(); });
    });
  [["k-gssid", "ssid"], ["k-gpsk", "psk"], ["k-gvlan", "vlan"]].forEach(function (p) {
    $(p[0]).value = S.guest[p[1]];
    $(p[0]).addEventListener("input", function () {
      S.guest[p[1]] = p[1] === "vlan" ? (+this.value || 1) : this.value; save(); render(); });
  });

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.dataset.c) { S.done[t.dataset.c] = t.checked; save(); checks(); }
    else if (t.dataset.q) { S.skip[t.dataset.q] = !t.checked; save(); queueRows(); checks(); }
    else if (t.dataset.f) { S.aps[+t.dataset.i][t.dataset.f] = t.dataset.f === "mac" ? normMac(t.value) : t.value; save(); }
    else if (t.dataset.s !== undefined) { S.ssids[+t.dataset.s].on = t.checked; save(); render(); }
  });
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t.dataset.f) { S.aps[+t.dataset.i][t.dataset.f] = t.value; save(); queueRows(); card(); }
    else if (t.dataset.sn !== undefined) { S.ssids[+t.dataset.sn].name = t.value; save(); queueRows(); }
  });
  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-del],[data-gps]") : null;
    if (!t) return;
    if (t.dataset.del !== undefined) { S.aps.splice(+t.dataset.del, 1); save(); render(); }
    if (t.dataset.gps !== undefined) fix(+t.dataset.gps, t);
  });

  function ssidRows() {
    $("k-ssids").innerHTML = S.ssids.map(function (s, i) {
      return '<label class="k-ssid"><input type="checkbox" data-s="' + i + '"' + (s.on ? " checked" : "") +
        '><input type="text" data-sn="' + i + '" value="' + esc(s.name) + '"></label>';
    }).join("");
  }
  $("k-ssid-add").addEventListener("click", function () {
    S.ssids.push({ name: "ssid-" + (S.ssids.length + 1), on: false }); save(); ssidRows(); render();
  });

  $("k-add").addEventListener("click", function () {
    S.aps.push({ serial: "", mac: "", role: S.aps.length ? "point" : "portal", place: "", lat: null, lon: null });
    save(); render();
  });
  $("k-parse").addEventListener("click", function () {
    var n = parseBlob($("k-paste").value);
    $("k-paste").value = "";
    this.textContent = n ? "Took " + n + " of them" : "Nothing that looked like a serial";
    var b = this; setTimeout(function () { b.textContent = "Pull the serials out of that"; }, 1800);
  });

  /* position. GPS needs sky, not signal, which is the whole point out here. */
  function fix(i, btn) {
    if (!navigator.geolocation) { btn.textContent = "no gps"; return; }
    btn.textContent = "fixing";
    navigator.geolocation.getCurrentPosition(function (p) {
      if (i === null) { S.lat = p.coords.latitude; S.lon = p.coords.longitude; S.acc = p.coords.accuracy; }
      else { S.aps[i].lat = p.coords.latitude; S.aps[i].lon = p.coords.longitude; }
      save(); render(); gpsMsg();
    }, function () { btn.textContent = "refused"; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }
  function gpsMsg() {
    $("k-gps-v").textContent = S.lat == null
      ? "No position yet. GPS works with no signal; it is the map that needs one."
      : S.lat.toFixed(5) + ", " + S.lon.toFixed(5) + (S.acc ? " to about " + Math.round(S.acc) + " m" : "");
  }
  $("k-gps").addEventListener("click", function () { fix(null, this); });

  /* ── scanning. BarcodeDetector reads the 1D codes where a browser has it;
     jsQR reads the QR everywhere else, including iOS, and both work offline. ── */
  var stream = null, scanning = false, det = null;
  function stopScan() {
    scanning = false;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null; $("k-cam").hidden = true; $("k-scan").textContent = "Scan a label";
  }
  $("k-stop").addEventListener("click", stopScan);
  $("k-scan").addEventListener("click", function () {
    if (scanning) return stopScan();
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(function (s) {
      stream = s; scanning = true;
      $("k-cam").hidden = false; $("k-scan").textContent = "Stop scanning";
      var vid = $("k-video"); vid.srcObject = s; vid.play();
      if (window.BarcodeDetector) {
        try { det = new BarcodeDetector({ formats: ["code_128", "code_39", "qr_code", "data_matrix"] }); } catch (e) { det = null; }
      }
      $("k-cam-msg").textContent = det ? "Point at the barcode on the box"
        : (window.jsQR ? "Point at the QR code on the box" : "No decoder available, type it instead");
      tick();
    }).catch(function () {
      $("k-cam-msg").textContent = "No camera here. Paste or type instead.";
      $("k-cam").hidden = false;
    });
  });

  var cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true }), last = 0;
  function got(text) {
    if (!text) return;
    var now = Date.now(); if (now - last < 1200) return; last = now;
    var macs = text.match(MAC) || [], ser = null;
    (text.replace(MAC, " ").match(SERIAL) || []).forEach(function (s) { if (!looksLikeMac(s) && !ser) ser = s; });
    if (addAp(ser || "", macs[0] || "")) {
      $("k-cam-msg").textContent = "Got " + (ser || normMac(macs[0])) + ". Next one.";
      if (navigator.vibrate) navigator.vibrate(40);
    }
  }
  function tick() {
    if (!scanning) return;
    var vid = $("k-video");
    if (vid.readyState === vid.HAVE_ENOUGH_DATA) {
      if (det) {
        det.detect(vid).then(function (codes) { if (codes && codes[0]) got(codes[0].rawValue); }).catch(function () {});
      } else if (window.jsQR) {
        cv.width = vid.videoWidth; cv.height = vid.videoHeight;
        if (cv.width) {
          cx.drawImage(vid, 0, 0);
          var d = cx.getImageData(0, 0, cv.width, cv.height);
          var r = window.jsQR(d.data, d.width, d.height, { inversionAttempts: "dontInvert" });
          if (r) got(r.data);
        }
      }
    }
    setTimeout(function () { requestAnimationFrame(tick); }, det ? 250 : 120);
  }

  /* ── outputs and housekeeping ──────────────────────────────────────────── */
  function out(text, btn) {
    $("k-outbox").value = text;
    var done = function () { var o = btn.textContent; btn.textContent = "Copied"; setTimeout(function () { btn.textContent = o; }, 1300); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
    else { $("k-outbox").select(); try { document.execCommand("copy"); } catch (e) {} done(); }
  }
  $("k-script").addEventListener("click", function () { out(script(), this); });
  $("k-csv").addEventListener("click", function () { out(csv(), this); });
  $("k-json").addEventListener("click", function () { out(plan(), this); });
  $("k-print").addEventListener("click", function () { card(); window.print(); });
  $("k-reset").addEventListener("click", function () {
    if (!confirm("Clear everything recorded for this deployment?")) return;
    try { localStorage.removeItem(KEY); } catch (e) {}
    location.reload();
  });

  /* offline. A kit that needs a signal to open is not a kit. */
  function offline(msg, ok) {
    var el = $("k-offline"); el.textContent = msg; el.className = "k-pill" + (ok ? " k-ok" : "");
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then(function () {
      offline(navigator.serviceWorker.controller ? "Saved for offline use" : "Saving for offline use",
              !!navigator.serviceWorker.controller);
      navigator.serviceWorker.ready.then(function () { offline("Saved for offline use", true); });
    }).catch(function () { offline("Offline copy unavailable", false); });
  } else offline("This browser will not keep an offline copy", false);

  $("k-back").addEventListener("click", function () { showPage(S.page - 1); });
  $("k-next").addEventListener("click", function () { showPage(S.page + 1); });
  window.addEventListener("hashchange", function () {
    var m = /^#([1-4])$/.exec(location.hash || "");
    if (m) showPage(+m[1] - 1, true);
  });
  document.addEventListener("keydown", function (e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === "ArrowRight") showPage(S.page + 1);
    if (e.key === "ArrowLeft") showPage(S.page - 1);
  });

  ssidRows(); gpsMsg(); render();
  var m0 = /^#([1-4])$/.exec(location.hash || "");
  showPage(m0 ? +m0[1] - 1 : (S.page || 0), !!m0);

  window._kit = { state: function () { return S; }, add: addAp, parse: parseBlob, queue: queue,
                  script: script, csv: csv, page: showPage };
})();
