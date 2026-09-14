---
title: I Held the Mesh Planner Against a Real Point and It Was Wrong About One Thing
slug: mesh-planner-held-against-a-real-point
date: 2026-09-14
tags: Wireless, Mesh, AOS-10, Planning
hero: hero-mesh-measured.svg
bot: nfn-bot-signal.svg
summary: Three APs, two floors, one point booted with its cable pulled. The planner called both link budgets within two dB of what the AP measured, then missed the rate by three MCS steps for a reason that took an hour to find. Plus the mesh table column you should not trust and the command you should.
origin: A morning at home with a switch console, Central's Commands tool and a point that would not become a point
---

I built a mesh planner. It sits on the [Tools page](../tools.html#mesh/v1) now, it draws the tree a mesh should form, it says what each hop will carry, and until this weekend nobody had checked it against a radio. A planner that has never been wrong in public is a planner nobody has tested. So I put the three APs in my house into a mesh cluster and made one of them earn its keep over the air.

The short version: the link budgets held, the rate did not, and the reasons for both are worth writing down.

## The setup

Two floors, three access points. An AP-505H and an AP-735 stayed on the wire as portals. An AP-635 was told it was a point, then had its switch port shut with the PoE left on, so it booted with power and no link, the way a point on a pole boots.

Before any of that, the planner had a prediction. It reads the neighbour path loss AirMatch measures between radios, which is a better number than a client RSSI because it does not care what power anyone was running, and it turned those losses into a budget for each candidate link. The 635 to the 505H: about 90 to 92 dB of loss, so around -64 dBm at the point. The 635 to the 735: 100 dB, which is a marginal link at 80 MHz. Prediction: the 635 attaches to the 505H at MCS 4.

## Getting the point to be a point took most of the morning

None of this is about RF. All of it cost time.

**A role saved while the AP is offline is never delivered.** I set the 635's mesh role to point in Central while it was already unreachable, and then spent an hour wondering why it kept coming up as a plain AP. The AP has to be online on the wire to receive the role. The tell in Central is the "last config changed" stamp on the device page: if it predates the save, the AP does not have it. Bring it back on the wire, watch the stamp update and the status read Synchronized, and only then pull the link.

**Pulling the link is not pulling the power.** On my AOS-CX switch, `shutdown` on the port dropped the link and kept delivering PoE; `show power-over-ethernet` on the port still read delivering at nine watts. That is exactly what a mesh test wants, an AP with power and no Ethernet, but only if the AP reboots into that state. `no power-over-ethernet` then `power-over-ethernet` on the port is the remote power button. Central's MultiEdit editor would not save the PoE line for me; the console did.

**The device page in Central lies until you hard reload it.** After the point came up over the air, the summary page kept showing the wired uplink, the old uptime, ETH0 up. Navigating around the app did not clear it. A browser reload did: WiFi Mesh, ETH0 Down, uptime four minutes. Learned that one the slow way.

## Then it attached to the wrong portal, for a reason that was not signal

The 635 came up and joined the 735, the marginal link, at a rate of 72 Mb/s down and single digits up. The 505H, the link the planner wanted, was nowhere in its neighbour list.

The reason was channels. Overnight, AirMatch had put the 735 on channel 120 and the 505H on 149. The 635's own monitor table, which lists every BSSID its radio has heard, had no entry at all for the 505H's 5 GHz radios in the twenty minutes it sat on the marginal link. The docs say a point does scan: every channel while it has no uplink, and topology scans in its first nine minutes and again whenever the link drops under threshold. Whatever the schedule, it had not found the 505H on 149. The 505H was not losing the selection. It was not in the race.

So I pinned the 735 to 149E, the same 80 MHz channel as the 505H. Three and a half minutes later the 635 had reselected: parent 505H, 720 Mb/s down, 400 to 650 up, the 735 demoted to neighbour. If you want two portals to be each other's fallback, put them on one channel: the second portal is then a candidate at every reselection rather than waiting on a rescan, and I would not leave that to the channel planner.

{{figure: fig-mesh-reselect.svg | While it sat on the marginal link, the point's monitor table listed only the portal on its own channel. Putting both portals on one channel is what made the second one a candidate.}}

## What measured, against what was predicted

Now the part I was actually there for.

| Link | Planner said | AP measured |
|---|---|---|
| 635 to 505H, received power | about -64 dBm | -65 and -70 dBm on the radio's two BSSIDs |
| 635 to 735, path loss | 100 dB budgeted | 98 dB by the AP's own pathloss column |
| 635 to 505H, rate | MCS 4, 432 Mb/s | MCS 7 down (720 Mb/s), MCS 4 to 6 up (400 to 650), at SNR 25 to 30 |

Two budgets right to within the spread of the measurement. One rate wrong by three MCS steps, which on 80 MHz with two streams is 432 Mb/s against 720. For a tool whose whole output is a capacity ceiling, reading two thirds of the truth is a real miss, and it came from two conservative choices stacked on top of each other.

The first was a margin doing two jobs. The planner has a 6 dB gate: a link counts once its SNR clears the lowest rate by that much, so a link that would barely hold MCS 0 is not drawn as a link. Sensible. But the same 6 dB was also being subtracted before the rate lookup, so every link was rated as if its SNR were 6 dB lower than it was. A gate and a handicap are different things. The AP's rate adaptation works on the SNR it has, not the SNR minus a safety factor, so the planner should too.

The second was the noise floor. The planner assumed a 7 dB receiver noise figure, which puts the 80 MHz floor at -88 dBm. All three radios report -92. Thermal noise in 80 MHz is -95, so these receivers are running about 3 dB above it, and the planner was throwing away four dB of SNR that the hardware actually has. Central reports the floor per radio, so the fix was to read it instead of guessing: the Verify fold now takes the noise figure from the radios along with everything else.

With both fixed, the planner says MCS 7 for that link. Which is what was running.

## The column you should not trust, and the one you should

While the 635 was on the marginal link, `show ap mesh link` reported the parent at RSSI 46. After it moved to the good link, it reported the new parent at RSSI 46. The 735 at a real SNR of 9 and the 505H at a real SNR of 30 got the same number. The CLI reference defines that column as the signal to noise ratio. On the build I was running, 10.8.1.0, it is not that, or not one that moves. What I do know is that the rates in the same row told the truth both times, and that nobody should put that RSSI into a link budget.

The honest read is `show ap monitor ap-list`. It lists every BSSID the radio hears with a current and average RSSI (printed as a positive number; the dBm figure is the negative of it), a current and average SNR, and a `pathloss` column. That pathloss is the number the planner budgets, reported by the device on the far end of the link, and it agreed with AirMatch's figure to within 2 dB.

Two smaller ones from the same hour. AOS 10 spells the command `show ap mesh neighbours`; `neighbors` is a parse error. And Central's Tools page has a Commands tab that runs a few hundred canned show commands on an AP and returns the output in the browser, with no device login and no console session. Both mesh commands and the monitor table are in the list. It is the fastest way I know to read a mesh point that is only reachable over the mesh.

## What to do with this

If you are planning a mesh, on my tool or on the back of an envelope:

| Do this | Because |
|---|---|
| Budget from the controller's measured path loss, not from a client RSSI | It is independent of the power anybody was running |
| Read the noise floor from the radios | A 7 dB assumption cost this link 4 dB of SNR that it actually had |
| Use your margin as a gate, not as a rate handicap | The AP rates the link on the SNR it has; so should the plan |
| Put portals that are meant to back each other up on one channel | The second portal is a candidate at every reselection instead of waiting on a rescan; mine went unheard for twenty minutes on the other channel |
| Deliver the point role while the AP is on the wire, and check the config stamp | A role saved to an offline AP is never received |
| Read `show ap monitor ap-list`, not the mesh table's RSSI | On 10.8.1.0 the mesh table's RSSI did not change between a 9 dB link and a 30 dB link |
| Hard reload Central's device page before believing it | The summary cached the wired state for minutes after the AP was on the mesh |

## Bottom line

The physics in the planner was right and the policy on top of it was too careful, twice. That is the kind of wrong that a test against one real radio finds in an hour and no amount of staring at the code would have. The planner now reads what the radios report, rates a link on the SNR it has, and tells the tree as a story in the fold under the map, including the channel lesson. Next test is the same point moved to the other end of the house, with the prediction written down first.

If you have not read it, the [conversion post](mesh-conversion-strands-the-points.html) is the other half of this: why a mesh gets provisioned over the wire, and what happens when the roles never reach the points. This weekend I got to watch that one happen on purpose.
