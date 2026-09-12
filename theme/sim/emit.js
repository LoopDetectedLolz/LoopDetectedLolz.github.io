/* NFN.emit: the RF intent a mesh plan implies, and that intent written the way
   two controllers want to read it. The intent is vendor neutral and small:
   band, width, channel list, power window, mesh roles, per AP radio settings.
   The emitters are data, not calls; a script or a person carries the JSON.

   Body shapes: Aruba Central from the CA cluster's Configuration Swagger read
   2026-09-12 (ArmData, RadioProfile, ApSettingsDataV2); Juniper Mist from the
   public API reference (api.mist.com/api/v1/docs), from memory, so every Mist
   field is marked to verify against the org before it is pushed. Neither is a
   complete profile: only what the plan decided is written, so the controller's
   defaults stand for everything else. */
(function () {
  "use strict";
  var E = NFN.emit = {};

  function name(a, i) { return a && a.name ? a.name : "AP-" + (i + 1); }
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }

  /* what the plan decided, vendor neutral. p is M.plan(st); st the site. */
  E.intent = function (p, st) {
    var M = NFN.mesh, C = p.cfg, aps = st.aps || [], band = M.bandOf(C.fGHz), rows = p.aps,
        txs = aps.map(function (a) { return num(a.tx, C.tx); }),
        used = [], portals = [], points = [];
    rows.forEach(function (r) {
      if (r.channel !== null && r.channel !== undefined && used.indexOf(r.channel) < 0) used.push(r.channel);
      var a = aps[r.i] || {}, entry = {
        i: r.i, name: name(a, r.i), model: a.model || null, role: r.gw ? "portal" : r.serves ? "point" : "bridge",
        down: r.status === "down", band: r.band, bw: r.bw, channel: r.depth >= 0 ? r.channel : null,
        tx: txs[r.i], h: num(a.h, 3), antenna: r.antenna ? r.antenna.label : null,
        aim: r.antenna && r.antenna.h < 360 && r.aim !== null && r.aim !== undefined ? Math.round(M.compass(r.aim, num(st.north, 0))) : null,
        parent: r.parent >= 0 ? name(aps[r.parent], r.parent) : null, hops: r.depth
      };
      (r.gw ? portals : points).push(entry);
    });
    used.sort(function (u, v) { return u - v; });
    var live = txs.filter(function (t, k) { return !(aps[k] && aps[k].down); });
    return {
      generated: "network-field-notes mesh planner",
      domain: C.domain, band: band, bw: C.bw, dfs: !!p.dfs,
      channels: { used: used, allowed: (p.channels && p.channels.list) || [] },
      power: { min: live.length ? Math.min.apply(null, live) : C.tx, max: live.length ? Math.max.apply(null, live) : C.tx, eirpCap: M.domain(C.domain).eirp[band] },
      mesh: { profile: C.profile, profileLabel: p.tree.profile.label, maxHops: p.tree.maxHops, portals: portals.length, points: points.length, backhaulBand: band, backhaulBw: C.bw },
      aps: portals.concat(points),
      site: { w: st.w, d: st.d, north: num(st.north, 0), clients: p.clients, uplinkMbps: p.uplink }
    };
  };

  /* Aruba channel notation: 149E is 149 at 80 MHz, 36+ is 40 MHz above, 5S 160 */
  E.arubaChannel = function (ch, bw) {
    if (ch === null || ch === undefined) return "";
    if (bw >= 160) return ch + "S";
    if (bw >= 80) return ch + "E";
    if (bw >= 40) return ch + "+";
    return String(ch);
  };

  E.central = function (it) {
    var g = "<group>", isA = it.band !== "2.4",
        chans = it.channels.allowed.join(","), aps = {};
    it.aps.forEach(function (a) {
      var body = { hostname: a.name };
      if (isA) { body.achannel = E.arubaChannel(a.channel, a.bw); body.atxpower = String(a.tx); }
      else { body.gchannel = E.arubaChannel(a.channel, a.bw); body.gtxpower = String(a.tx); }
      aps[a.name] = { serial: "<serial of " + a.name + ">", body: body };
    });
    var mesh = [];
    it.aps.forEach(function (a) {
      if (a.role === "portal") mesh.push("! " + a.name + ": portal (wired uplink); mesh role follows the uplink, nothing to set");
      else mesh.push("! " + a.name + ": " + a.role + ", expect parent " + a.parent + " at " + a.hops + " hop" + (a.hops === 1 ? "" : "s") + "; the point chooses, this is what the plan expects" + (a.aim !== null ? "; aim " + a.antenna + " at " + a.aim + " deg true" : ""));
    });
    return {
      vendor: "aruba-central-classic",
      note: "Bodies from the Configuration Swagger (ArmData, RadioProfile, ApSettingsDataV2) read 2026-09-12. Only what the plan decided is set. Mesh cluster and hop settings are group CLI, not REST, so they are lines to paste. Verify the group name and serials, then push with dry run first.",
      calls: [
        { method: "POST", path: "/configuration/v1/arm/" + g,
          body: (function () {
            var b = { min_tx_power: String(it.power.min), max_tx_power: String(it.power.max), "80mhz_support": it.bw >= 80, wide_bands: it.bw >= 80 ? "5ghz" : it.bw >= 40 ? "5ghz" : "none", client_match: true, band_steering_mode: "prefer-5ghz" };
            b[isA ? "a_channels" : "g_channels"] = chans;
            return b;
          })() },
        { method: "POST", path: "/configuration/v1/" + (isA ? "dot11a" : "dot11g") + "_radio_profile/" + g + "/<profile-name>",
          body: { name: "<profile-name>", allowed_channels: chans, min_tx_power: it.power.min, max_tx_power: it.power.max, ch_bw_range: it.bw >= 160 ? ["20MHz", "40MHz", "80MHz", "160MHz"] : it.bw >= 80 ? ["20MHz", "40MHz", "80MHz"] : it.bw >= 40 ? ["20MHz", "40MHz"] : ["20MHz"], dot11h: it.dfs } }
      ].concat(Object.keys(aps).map(function (k) { return { method: "POST", path: "/configuration/v2/ap_settings/" + aps[k].serial, body: aps[k].body }; })),
      mesh_cli: [
        "! group " + g + ", AOS 10 mesh: one cluster, backhaul on " + it.mesh.backhaulBand + " GHz at " + it.mesh.backhaulBw + " MHz, ceiling " + it.mesh.maxHops + " hops",
        "! mesh-cluster-profile <name>: cluster-name <name>, wpa-passphrase <set on the laptop, never in this file>",
        "! ap mesh-radio-profile: metric-algorithm " + (it.mesh.profile === "arubabest" ? "best-link-rssi" : "distributed-tree-rssi") + ", max-hop-count " + it.mesh.maxHops
      ].concat(mesh)
    };
  };

  E.mist = function (it) {
    var band = it.band === "2.4" ? "band_24" : it.band === "6" ? "band_6" : "band_5", rf = { name: "<template-name>", country_code: it.domain === "eu" ? "<EU country>" : "US" };
    rf[band] = { disabled: false, bandwidth: it.bw, channels: it.channels.allowed.slice(), power_min: it.power.min, power_max: it.power.max, allow_rrm_disable: true };
    if (band !== "band_24") rf.band_24 = { disabled: false, bandwidth: 20, channels: [1, 6, 11] };
    var devices = it.aps.map(function (a) {
      var rc = {}; rc[band] = { channel: a.channel, bandwidth: a.bw, power: a.tx, disabled: false };
      return { method: "PUT", path: "/api/v1/sites/<site_id>/devices/<device_id of " + a.name + ">",
               body: { name: a.name, radio_config: rc, mesh: a.role === "portal" ? { enabled: true, role: "base" } : { enabled: true, role: "relay" }, notes: a.role === "portal" ? "base (wired)" : "relay, expect base " + a.parent + (a.aim !== null ? ", aim " + a.antenna + " at " + a.aim + " deg true" : "") } };
    });
    return {
      vendor: "juniper-mist",
      note: "Field names from the Mist API reference as remembered, 2026-09; verify every one against api.mist.com/api/v1/docs for your org before pushing. Mist mesh is single hop: relays bond to a base, so a plan with more than one hop will not form the same way. Token in the environment, never in this file.",
      calls: [
        { method: "POST", path: "/api/v1/orgs/<org_id>/rftemplates", body: rf },
        { method: "PUT", path: "/api/v1/sites/<site_id>", body: { rftemplate_id: "<id from the call above>" } },
        { method: "PUT", path: "/api/v1/sites/<site_id>/setting", body: { mesh: { enabled: true } } }
      ].concat(devices),
      warnings: it.mesh.maxHops > 1 && it.aps.some(function (a) { return a.hops > 1; }) ? ["The plan has points more than one hop from a portal; Mist relays reach a base in one hop, so those points will not form as drawn."] : []
    };
  };

  /* the intent as a page of text somebody can read to an installer */
  E.text = function (it) {
    var L = [];
    L.push("RF intent, " + it.mesh.portals + " portal" + (it.mesh.portals === 1 ? "" : "s") + ", " + it.mesh.points + " point" + (it.mesh.points === 1 ? "" : "s"));
    L.push("backhaul " + it.band + " GHz at " + it.bw + " MHz, DFS " + (it.dfs ? "on" : "off") + ", " + (it.domain || "us").toUpperCase() + " rules, EIRP cap " + it.power.eirpCap + " dBm");
    L.push("channels in use " + (it.channels.used.join(", ") || "none") + " of allowed " + (it.channels.allowed.join(", ") || "none"));
    L.push("power " + it.power.min + (it.power.max !== it.power.min ? " to " + it.power.max : "") + " dBm");
    L.push("mesh " + it.mesh.profileLabel + ", ceiling " + it.mesh.maxHops + " hop" + (it.mesh.maxHops === 1 ? "" : "s"));
    it.aps.forEach(function (a) {
      L.push("  " + a.name + (a.model ? " (" + a.model + ")" : "") + ": " + a.role + (a.down ? ", down" : "") + ", ch " + (a.channel === null ? "none" : E.arubaChannel(a.channel, a.bw)) + ", " + a.tx + " dBm, mast " + a.h + " m" +
             (a.antenna ? ", " + a.antenna : "") + (a.aim !== null ? " aimed " + a.aim + " deg" : "") + (a.parent ? ", expect parent " + a.parent + " at " + a.hops + " hop" + (a.hops === 1 ? "" : "s") : ""));
    });
    return L.join("\n");
  };
})();
