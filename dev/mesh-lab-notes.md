# Mesh lab notes (home lab test and AP-735 checks)

Moved out of NEXT.md on 2026-10-05 to keep the always-read status file short.

## The mesh test on the home lab, 2026-09-12 into 13

What was learned, in the order it cost time:

- `lab-mesh.py cluster` adds `mesh-cluster <name> wpa2-psk <key> priority 1` to the group and
  Central accepts it, the APs show it under `show ap mesh cluster status` (Enabled), but the
  per AP **Mesh Role stays None** and None means mesh off. Role AUTO is not the default; the
  role is set per AP under Device > Config > System > Mesh (None, auto, portal, point). Set the
  portals to portal and the point to point, then reboot each; the form's footer *button* did
  not save, the footer *link* did, and the proof is the "Please reboot the access point"
  prompt. Once the portals rebooted with the role, `show ap mesh neighbours` on the 505H listed
  the 735 as a portal at RSSI 10 over the 97 dB pair, which is the planner's budget for it.
- An AP decides its role at boot. Dropping its switch port at runtime leaves it stranded
  (Central freezes its last state, the queued reboot never reaches it). The remote power button
  is the switch: AOS-CX keeps PoE on a `shutdown` port, so `no power-over-ethernet` then
  `power-over-ethernet` on the port (console, `hpe-central support-mode enable` first on a
  Central managed switch) reboots the AP with no link.
- Classic Central's MultiEdit editor is Monaco; edits made through the model API are dropped,
  only typed edits count, and `no power-over-ethernet` typed there did not survive the save
  either. The console is the tool for PoE; the form page (Interfaces > Ports) is fine for
  Admin Up.
- The switch had to be brought into Classic Central (group Burns-Home-CX-Lab) to be reachable
  at all; it imported its running config as the baseline (status went "initial group config
  pending" then Sync) and needed a device password set before any config page opened.
- Ports on the 6200: 505H on 1/1/10 (7 W), 735 on 1/1/7 (11.7 W), 635 on 1/1/12 (9.4 W,
  labelled Upstairs_AP-735).
- The GreenLake session in Chrome expires every twenty minutes or so and the Classic API token
  every two hours; both cost a round trip to Dustin each time.
- A factory reset of an AP wipes the cluster; it re-onboards into the group in about seven
  minutes including an image step, and takes the cluster back with the group config.

The morning of the 13th, what happened and what it taught:

- A role saved while the AP is offline is never delivered. The 635 had to come back on the
  wire once (port up, PoE cycled), show Synchronized with a fresh "last config changed" stamp,
  and only then did shut, PoE off, PoE on boot it as a point: uptime reset, ETH0 Down, CURRENT
  UPLINK "WiFi Mesh", back in Central over the air inside four minutes. The device page in
  Chrome kept showing the old snapshot until a hard reload; navigating the SPA is not enough.
- **`show ap mesh link` RSSI is not a measurement on 10.8.1.0.** It read 46 for the 735 at a
  real SNR of 9 and 46 for the 505H at a real SNR of 30. The rates told the truth (72/8 to 17
  Mb/s on the weak link, 720/408 to 612 on the good one). `show ap monitor ap-list` is the
  honest read: curr-rssi, curr-snr and a `pathloss` column the AP computes itself. The
  planner's Verify fold and any post must use that, never the mesh table's number.
- The point first picked the 735 at 100 dB of loss (SNR 9) because the 505H was on 149E and
  a point's backhaul radio parks on its parent's channel and does not scan: the 505H was not
  losing, it was not in the race. Portals in a cluster want one channel. Pinning the 735 to
  149E (Central's per AP channel list only offers the 80 MHz blocks by their lowest channel,
  116E not 120E, so the move went the other way) put both portals on one primary; three and a
  half minutes later the 635 had reselected the 505H.
- A per AP power change (Transmit Power: Manual) takes effect live, no reboot, and Central's
  radio list confirms it within a minute. Cutting the 735 from 21 to 15 moved the monitor
  table's read of it by the same 6 dB; the mesh table's 46 did not move.
- Measured against the planner: 635 to 505H predicted about -64 dBm from AirMatch's 90 to 92
  dB, measured -65 to -70 (two BSSIDs on one radio); 635 to 735 budgeted at 100 dB, the AP's
  own pathloss column says 98. Both budgets right. The rate was wrong: MCS 4 predicted, MCS 7
  running, because `mesh.js` took the 6 dB margin off the SNR before picking the rate as well
  as using it as the gate, and the 7 dB noise figure put the 80 MHz floor at -88 when all
  three radios report -92. Fixed the same morning: the margin only gates, Verify reads the
  noise figure from the radios (`nf` in the mesh hash), a test pins the measured point.
- Aruba's `show ap mesh neighbours` is spelled that way; `neighbors` is a parse error.
- Central's Tools > Commands runs 486 canned show commands on an AP with no device login
  (`show ap mesh link`, `show ap mesh neighbours`, `show ap mesh cluster topology`, `show ap
  monitor ap-list` all there). It is the way to read a mesh point without a console session.

Undone on the evening of the 14th by Dustin: all three APs back to ordinary wired APs, the
mesh settings deleted from the group. The cluster would have to be recreated (`lab-mesh.py
cluster`) for the move test. The state that stood before that, for the record: cluster
Burns-Mesh; 505H a portal, automatic, on 149; 735 a portal, 5 GHz pinned to 149E, power back
to Automatic; 635 a point on the 505H, wire down (1/1/12 shutdown, PoE on). The undo order
that applied: `no shutdown` on 1/1/12 (the 635 comes back wired
and stays a point in name; set its Mesh Role to None and reboot it to make it an ordinary AP);
735 channel back to Automatic; portals' roles to None and reboot if the cluster should go;
`lab-mesh.py restore` for the group config. Not done: a throughput test through the point
(the client sat on the same 5 GHz radio as the backhaul, so it is the `relays` halving case;
MCS 7 on 80 MHz says 200 to 250 Mb/s down if the ISP is not the ceiling), and the move test
(predict with the planner first, then place the 635 halfway and measure).

## To verify in the lab, with the AP-735

Both are plumbing questions, not physics ones, and both gate the GPS work.

- Does the AP know where it is? **Yes.** Read 2026-09-14 on an AP-635 by a window, over
  Central's remote console on 10.8.1.0: `show ap gps summary` gives a fix (latitude,
  longitude, altitude from `$GNGGA`, `$GNGNS`, `$GNRMC`), the chip state and the
  constellations in use (GPS, SBAS, Galileo, QZSS, NavIC on; Beidou and Glonass off);
  `show ap gps ellipse` gives the error ellipse (6.5 by 4.3 m here) with `hop` and `distance`
  fields for a position inherited over a ranged neighbour; `show ap gps report-history` lists
  the "AFC location" reports sent to the cloud, one every five minutes with the sample count
  and the GPS height. The 630 series carries the receiver, not only the 700s. The fix sat a
  few metres from the site's geocoded pin. The AP also has `show ap accelerometer-info`,
  `barometer` and `magnetometer-info`. None of the GPS commands are in Tools > Commands'
  canned list; the remote console runs them. Still open: whether the Classic API exposes the
  position back out (`central-pull.py --keys` prints every AP field the tenant returns, run
  it with the token), and New Central's AP location page against the same AP.
- Does anything expose AP-to-AP FTM ranging? **The machinery, not yet the numbers.**
  `show ap range status`: FTM initiator yes, enabled on 5 and 6 GHz; FTM responder capable on
  every SSID and disabled on every SSID by default. `show ap range scanning-results` has the
  table (peer BSSID, average RTT in picoseconds, RSSI, standard deviation, valid RTTs, 11mc or
  11az, aged out after 20 minutes) and zero rows, and `show log stats-to-cloud ftmscan` is
  empty, both because nobody answers. Next: turn the FTM responder on for one SSID on all
  three APs (a WLAN setting), wait, read the results table on each, and compare the ranges
  with the planner's distances. If it fills, GPS anchors the map and FTM tightens it.
- With the explicit `point` role and the cable plugged back in (2026-09-14), the 635 came up
  with `Current Uplink: Ethernet` and an empty `show ap mesh cluster topology`: neither point
  nor portal, a wired AP. It power-cycled when the link returned ("Cold HW reset (Power
  loss)" at 21:38); whether the switch or the AP did that is not settled.
- The mesh profiles are shaped from the vendor documents (AOS 8 `ap mesh-radio-profile` and
  "Understanding Mesh Links"; Cisco mesh design guide 8.8 "Ease Calculation"; Mist "Wireless
  Mesh Network Configuration"), read 2026-09-11 and cited in `mesh.js`. Still unverified:
  the numbers inside them, Instant and Central's hop ceiling against AOS 8's default of 8,
  and whether Mist is still single hop in the current release.
- The `ENDPOINTS` block in the script the kit generates is marked to verify and has **not**
  been checked against a live tenant. The order of operations in that script is the part
  that is right: subscriptions before group, group before site assignment, RF calibration
  last.
