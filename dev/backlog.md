# Backlog (was "Next, in the order agreed" in NEXT.md)

Moved out of NEXT.md on 2026-10-05 to keep the always-read status file short.

## Next, in the order agreed

1. **Put the mesh planner on the site.** Done 2026-09-14: `tools.html` holds all four tools
   under a "Tools" nav pill, built from the promoted `theme/widgets/tools.html` with the model
   concatenated into the page (496 KB, one file). Still to do from this item: a post that
   walks one design through it with figures from `capture.py`; the home lab mesh test is the
   obvious one (predicted against measured, the story fold explaining the tree, roles and
   models only, never the serials).
2. **Fold the RF planning into the kit.** Done 2026-09-14: phase two carries "Open these N
   positions in the mesh planner" once two APs have a fix; the kit builds the `#mesh/v1` hash
   itself (roles, heights from the placement text, placement as the AP name), the planner's
   table and story use the names, and the QA bot holds the round trip. The reverse landed the same
   day: "Send to the field kit" in the planner's share fold writes `kit.html#plan=...`, the kit
   merges it by name (role follows the plan; a plan line rides beside the placement into the
   table, CSV, JSON and card; unscanned planned APs get a row). The QA bot walks both directions.
3. **GPS and FTM.** The lab answered on 2026-09-14 (below): the AP has a GNSS fix with an
   error ellipse and reports it to the cloud, and the FTM ranging table exists with the
   responder off. The planner now reads both from pasted console text (`gpsParse`,
   `ftmParse`, "From the APs themselves"): fixes place the masts with their ellipses drawn,
   ranges sit beside planned distances. Still to do: the FTM responder switched on so the
   table fills (a WLAN setting on each AP); whether the Classic API exposes the fix
   (`central-pull.py --keys`); and a `--gps` pull if it does, so Verify places the masts
   without a paste.

Everything on the list of twenty from 2026-09-11 is in the lab, the interface was folded
into progressive disclosure on 2026-09-12, `simsweep.js` baselines the model (80,761 checks
over 400 sites, clean after one real fix), and an Ekahau .esx opens straight into the field. Not yet verified by anyone
on a phone in a field: the GPS placement, the compass aim and the image scale, which need a
real device and daylight. Asked for on 2026-09-12 and not yet built, in the order they were asked:

1. **Terrain from the APs' GPS.** Given a geo anchor (the first fix, or Ekahau's
   `gpsReferencePoints`, or a KML centroid) and a radius, fetch elevation tiles and lay real
   ground under the field. Candidate source: the AWS Open Data Terrarium tiles
   (`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, height = R*256 + G +
   B/256 - 32768, public, CORS open as far as known; verify), decoded through a canvas into a
   raster. `M.ground` then needs a raster mode (bilinear on a grid) beside the hills, the hash
   carries only the anchor and radius (`geo=lat,lon,r`) and the raster is fetched again on load.
2. **Central assisted verification**: built 2026-09-12. `central-pull.py --group <name>` (GET
   only, refuses any other method; token file from Classic Central's API Gateway, path in
   `CENTRAL_TOKEN_FILE`, refresh with `CENTRAL_CLIENT_ID`/`SECRET`) writes a `site.json` with
   the group's APs, their radios, and the loss AirMatch measured between them
   (`/airmatch/telemetry/v1/nbr_pathloss_radio`), which is a better number than RSSI because it
   does not care what power the AP was running. The planner's "Verify against Central" fold
   opens it: models, power, channel and width from the radios, portal unless `mesh_role` is
   point, positions from VisualRF floor placement when there is one and a row to drag when
   not, and each measured pair becomes `{pl}` in `ms` (hash form `0-1:L85`), which
   `M.measuredPrx` turns into received power. "Planned against measured" lists every pair with
   the gap and says whether the offset is steady (something the model does not see) or spread
   (APs not where the map says). Endpoints were read from the CA cluster's own Swagger that
   day and then run against the live tenant, which corrected the Swagger in five places, all
   handled in the script: monitoring gives the radio band as a code (0 or blank 2.4, 1 5, 3 6),
   the channel Aruba style (`149E` is 149 at 80 MHz, `+`/`-` 40, `S` 160), streams as `2x2:2`,
   the noise floor as a positive number and the model without its `AP-` prefix; AirMatch calls
   the radio MAC `mac` not `radio_mac`, says `5GHz` and `CBW80`, and the path loss URL wants
   `5ghz` lower case (a 400 tells you the enum). Six radios, twelve measured paths, both
   directions within 4 dB of each other on 5 GHz. TLS is verified against the Mac's keychains
   because the python.org build trusts only its own bundle and this laptop's outbound TLS is
   inspected. `demo/mesh-central.json` is a synthetic fixture shaped like the output.
3. **A config planner for Central and Mist**: built 2026-09-12. The mesh plan implies an RF
   intent (`NFN.emit.intent`: band, width, DFS, channel list, power window, mesh profile and
   hop ceiling, each AP's role, channel, power, antenna, compass aim and expected parent), and
   `emit.central` and `emit.mist` write that intent as the bodies each controller wants: ARM,
   a dot11a radio profile and per-AP `ap_settings` (from the CA tenant's Configuration
   Swagger, read 2026-09-12; mesh cluster is group CLI so it comes out as lines to paste), and
   a Mist RF template, the site, the mesh setting and each device with base or relay. The
   "What to configure" fold shows the intent as text and downloads either JSON. Neither JSON
   is pushed by anything here; the kit's dry-run script pattern is how one would be. Every
   Mist field is from memory and marked to verify; the Central bodies were read from the
   Swagger but not pushed. `mist-pull.py` mirrors `central-pull.py` (sites, devices, stats,
   maps, RRM neighbours) and writes the same site.json with `rssi` where Central had `db`;
   the importer takes either and the verify table shows dBm for RSSI pairs. Not run against a
   live Mist org: the RRM neighbours shape is the least certain thing in it, and the parser
   says what it found. `demo/mesh-mist.json` is a synthetic fixture. Left out on purpose:
   security, VLANs, RADIUS, tunnelling; nothing in them has a picture to draw.
4. **The simulator on live monitoring**: built 2026-09-12 and run against the home tenant.
   `client-pull.py --client <name or MAC>` reads one wireless client (signal, SNR, current and
   top rate, band, channel and width, health) plus its AP radio's utilisation and noise floor
   from Classic Central, writes a snapshot with `--out`, or with `--serve 8830` polls every
   30 s and answers `GET /latest.json` on 127.0.0.1 with CORS open. The simulator's Live chip
   opens a snapshot or polls the relay: the client's top rate picks the standard, streams and
   width (`inferPhy`, 1200 Mb/s reads as 802.11ax 2x2 80 MHz), the current rate picks the MCS,
   the SNR drives the scatter (eased, so a moving client drifts rather than jumps), and a retry
   share, where the feed has one, fails clean frames at that rate on top of the noise. Sliders
   park while the feed drives. Honest limit, said on screen: monitoring is a minute's average,
   so this is what the stream looks like statistically, not a replay. Classic Central has no
   per-client retries and no call quality through the API (UCC is configuration only), so
   `retry_pct` and `mos` are null from Central; a Mist reading (not yet written) would fill
   them. The client API writes the channel as `116 (80 MHz)` where the AP API wrote `116E`.
5. **The client journey**: built 2026-09-12 on the home tenant. `client-pull.py --trail 48`
   adds the client's roams from `/monitoring/v1/clients/wireless/{mac}/mobility_trail`
   (oldest first: AP landed on, AP left, roam type, latency in ms, band, channel and width
   from the Aruba channel string, RSSI at the landing; a fresh association has no previous
   AP and no RSSI) plus every visited AP's radios so each hop has its own noise floor. The
   simulator's Live row grows a strip: the signal line through the landings coloured by AP,
   hollow dots for joins, the AP that held the client as a band, roam latency as ticks
   (orange past 100 ms), an orange wash where the client sat under -75 dBm, a scrub slider,
   click to jump, Play at one hop every 1.4 s. Each hop is a reading: band and width from
   the channel, SNR from that AP's floor, MCS from the SNR since a hop carries no rate, the
   sliders parked. The stats line counts joins, same-AP band flips, ping-pongs (back within a
   minute), median and slow roams, and the share of weak landings. Seen on the iPhone: 195
   hops in 48 h, median roam 25 ms, one of 5.5 s, 67 band flips; the Watch roams 2,321 times
   a week at about -83 dBm. Also seen: dozens of clients with a hop at the same second, a
   mass event (AP reboot or config push), which is the "what changed before it broke" tool
   waiting to be drawn. `lab-kick.py --client X --group G --yes` is the one write in the set:
   it disconnects a client so a roam can be made to happen; refuses without --yes, one
   client, only APs in the named group. Not yet on the planner's map: placing hops on the
   field needs AP positions, which this site has none of.
6. **The Watch as probe and button**: built 2026-09-12, `WATCH.md`. The relay
   (`client-pull.py --serve --lan`) gains `/glance` (one line for a wrist), `/mark?note=`
   (a flag with a word, kept with `--marks-file`), `/marks`, `/alerts` (slow roam, rejoin,
   weak, off the air, worked out between polls); marks ride in `latest.json` and the journey
   strip draws them as orange flags, the hop caption names the nearest one. Two Shortcuts
   are written up; none of it needs an app. The Watch cannot read Wi-Fi signal and nothing
   here pretends it can: the AP is the meter, the Watch is the client. Not yet tried on the
   real Watch; the relay's LAN mode and the Shortcuts are the parts to try first.
7. **What happened**: built 2026-09-12, a fourth tool in the switcher (`#story/v1`), fed by
   `central-pull.py --group G --story 48`, which adds a `story` block to the same site.json:
   every client's trail, every live radio's five minute noise floor and utilisation
   (`rf_summary`, walked in three hour steps), events (reboots from AP uptime with the last
   reboot reason, AirMatch channel moves from `rf_events` with old and new channel, people from
   `/auditlogs/v1/events`), the group's client count and each AP's bytes per five minutes.
   `theme/sim/story.js` reads it four ways with no drawing: `bins`/`spikes`/`explain` (clients
   that moved per bin, a spike is three or more and two deviations above the busy mean, the
   sentence names what changed in the ten minutes before and says whether it was the network
   or the people), `graph`/`whatIf`/`overlap` (radios joined by AirMatch's measured loss, a pair
   shares air when it hears the other under 105 dB and the channels overlap, 2.4 GHz closer
   than five apart, 5 and 6 GHz by the width's span; a what-if is a copy), `weather` (hour by
   day, the loud hours 6 dB over the radio's median), `actual` (bytes to Mb/s, site client
   count), `clients` (who roams most, lands weakest). The page draws the timeline with events
   as marks and a tap per bar, the graph per band with a move-this-radio what-if, a heat strip
   per radio, plan against actual (planned columns fill from the mesh planner by AP name), and
   the client list. On the home tenant it found the story straight away: the two biggest roam
   spikes in 48 hours, 12 and 11 clients, sit within a minute of AirMatch's nightly 01:00
   channel moves on two 2.4 GHz radios. Evening 2.4 GHz utilisation 21 to 35 percent, 5 GHz at
   3, floors steady. `demo/mesh-story.json` is the synthetic fixture the tests and the demo
   button use. The mesh planner draws the story's roams on the map when asked (`rm` in the
   hash, the checkbox in Verify): an arrow per AP pair with the count and median landing,
   orange under -75 dBm, matched by AP name, so Verify has to have opened the same site.
   "Follow the cable" goes as far as Classic sees: each AP's radios, clients now, uplink port,
   speed and duplex (a 100 Mb/s port is called slow); the switch, its port and PoE live in
   whichever Central manages the switch and on this tenant that is New Central, so the row
   says "switch not in Classic's view" rather than drawing one. The Classic monitoring API
   returned zero switches for the account; New Central's UI shows the port through its
   internal GraphQL, which is not a public contract.
8. **Academy games**: built 2026-09-12, `theme/widgets/games-lab.html` (`python3 lab.py games`)
   on `theme/sim/games.js`. Every level comes from a seed (mixed and warmed, because
   mulberry32's first draws from a small seed cluster), every score from the models, and the
   page wears the Academy orange. Guess the signal: lesson 1's 2, 4, 8, 16 m first, then random
   distances, then a wall; within a dB scores 3, streaks multiply to three. Fix the link: a
   level is a link failing at its rate; five moves (drop MCS, halve width, walk the client in,
   open a wall, better antenna), three of them; score is the model's best airtime over yours,
   with the best path revealed. Channel puzzle: radios joined by log distance plus walls, hear
   under 95 dB, US list for the width with DFS optional; solved with the greedy fewest is 100,
   each extra channel costs 20. Scores stay in localStorage; the hash carries the game and
   seeds so a link is a challenge. Not on the site yet: the Academy page needs a card row and
   each lesson a link to its game; the widget mounts anywhere `theme/sim/` is loaded.
9. **Stream Deck**: done, `streamdeck/`. The profile schema is the one the desktop app writes;
   if a newer app refuses the import, the icons and the key table are there to build by hand.

Ideas parked, none of them decided:

- Real vendor path cost numbers. The shapes are right by the documents; the curves inside
  (dB per doubling, node cost per child, Cisco's ease multipliers) are guesses that
  reproduce the vendors' worked examples, and would need a lab measurement to pin down.
  Field experience on 2026-09-12: a far point with a dish aimed past a nearer point at the
  portal tends to bond with the nearer point on Aruba. Under the sketch that happens with
  best-link-rssi and not always with distributed-tree-rssi (the near AP's own weak uplink
  costs more than the direct dish link). If that observation holds on a site with the tree
  metric, the RSSI term is steeper than 2^((50-snr)/4). The tool now flags a pinned aim
  that disagrees with the parent the metric chose (`aimedElsewhere`).
- A painted height map instead of gaussian hills, once the hash can carry it or the plan
  lives somewhere other than a URL.
- The antenna picker choosing the client antenna and the backhaul width as well as the
  backhaul antenna. Today it picks one thing per AP and the note says what 20 MHz would buy.
- Co-channel between client radios of neighbouring APs. Today only backhaul links share air.
- Google Earth import reads drawn placemarks, extruded polygons, paths and ground overlays;
  the photogrammetry mesh and terrain cannot come across. A KML with a `Model` (a COLLADA
  building) is not read; if that ever matters, its bounding box is the obstacle.
- The liquid glass prototype (`lab.py glass`) is a look to raid, not a redesign. Decide which
  pieces the site takes: the pointer specular and the glowing meters with motes are the
  candidates; the refraction is Chrome only.
- Export back to Ekahau. Reading .esx is done; writing one means matching their schema
  exactly, and a half-right project file is worse than the CSV. Needs a real .esx from
  the current release to copy the shape from, and the antenna catalogue to map back.
- The Ekahau reader was tested on a synthetic project shaped like the exports seen; open a
  real .esx and check the direction convention (0 taken as up the plan) and the image entry.

