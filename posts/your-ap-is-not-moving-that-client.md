---
title: Your AP Is Not Moving That Client
slug: your-ap-is-not-moving-that-client
date: 2026-09-17
tags: Wireless, Clients, Roaming
hero: hero-client-behaviour.svg
summary: Roaming is a client decision, band steering is a suggestion, and the phone that sits disconnected after an elevator is running a documented backoff timer. Opening the Wi-Fi settings screen does not wake it up, and the popular explanation of why it seems to is mechanically wrong.
origin: A Reddit thread about a phone that would not reconnect after an elevator ride, answered confidently and incorrectly by most of it
---

Somebody rides an elevator, comes out, and their phone sits there on no network for a minute or two while every laptop in the building is already back. The thread that follows always blames the wireless. Sticky clients, bad roaming, the AP will not let go, band steering is broken.

The AP is not the one making these decisions. Almost none of them.

This is the post I keep wanting to link to instead of rewriting, so here it is: what the infrastructure actually controls, what the client controls, and what one very common client is documented to be doing while it looks like it has given up.

## What you actually control

An access point cannot move a client. There is no frame that says "go to that AP now, this is not a request."

What you have is a set of ways to make the decision easier or more attractive:

**802.11k** hands the client a neighbour report, so instead of scanning the whole band to find out what is nearby it gets a list. Faster decision, same decider.

**802.11v** BSS Transition Management sends the client a suggestion that it should move, optionally with a candidate list. The client is free to ignore it, and plenty do.

**802.11r** makes the reassociation itself cheap once the client has decided, by pre-establishing key material. It shortens the gap, it does not cause the roam.

**Band steering** is the bluntest of the set. It generally works by not answering probe requests on 2.4 GHz for a client the AP has heard on 5, so the client's own scan comes back without the option you did not want it to take. That is influence by omission. If the client is stubborn, or if it already has the 2.4 BSSID cached, it goes there anyway.

Every one of those is the infrastructure improving the quality of a decision that the client makes. Which is why "the AP would not move my client" is almost always a sentence about the client.

{{figure: fig-who-decides.svg | The roam decision, split by who owns each part. The infrastructure side is all input. The decision and its timing sit on the other side of the air.}}

## The elevator case, and what Android is documented to do

Here is the sequence people describe. Phone is on Wi-Fi, gets in a lift, the signal dies. It may briefly hold an association that is going nowhere, so Android marks the network as having no internet. Doors open, good coverage everywhere, and the phone does nothing for a minute or more.

Two separate mechanisms are running, and both are documented.

**Scanning backs off.** Google's own Wi-Fi network selection documentation gives the disconnected-state scan schedule as exponential backoff at 20, 40, 80 and 160 seconds. It is `DEFAULT_SCANNING_SCHEDULE_SEC` in `WifiConnectivityManager.java`. Once the phone has been disconnected for a while it is only looking around every 160 seconds, and the schedule resets when the screen state changes, which is a detail that matters in a second.

**The network gets temporarily disabled.** When Android decides a network has no internet, it sets `DISABLED_NO_INTERNET_TEMPORARY` on that network's selection status, with a ten minute timeout. That is in `WifiConfiguration.NetworkSelectionStatus`. For that window the phone is not avoiding your SSID because the RF is bad. It is avoiding it because of something that happened in a lift.

{{figure: fig-android-backoff.svg | Two independent timers, both started by the lift. Neither of them is measuring signal strength, which is why the phone can sit on nothing while standing under an AP.}}

## The part everyone gets wrong

The folk fix is real: open the Wi-Fi screen and the phone reconnects almost immediately. The explanation attached to it is not.

The usual claim is that opening the picker forces a scan, wakes the radio, or clears the backoff. It does not clear anything. What happens is simpler and more specific.

The Settings app runs its own scan loop every ten seconds while that screen is open. That is `WIFI_RESCAN_INTERVAL_MS`. Settings is also exempt from the throttle that limits ordinary apps to four scans every two minutes, which lives in `ScanRequestProxy`. And the connectivity manager consumes results from every scan on the device, not just the ones it asked for.

So the phone reconnects at the next Settings scan, within ten seconds, using a scan it did not schedule. The backoff index is untouched. The ten minute disable is untouched. You did not fix anything, you just gave the selection logic fresh scan results sooner than it was going to ask for them.

Worth knowing because the wrong explanation leads to wrong advice. Telling a user to toggle Wi-Fi off and on gets blamed on the network when it works. Telling an engineer that opening Settings resets the backoff sends them looking for a setting that will do the same thing from the infrastructure side, and there is not one.

The screen state reset in the scan schedule is the closest thing, and it is a side effect rather than a lever.

## While we are correcting things: MLO

The same class of complaint has arrived with Wi-Fi 7. "MLO is not working, I am not getting both bands."

Most phones shipping today do enhanced multi-link single radio. The client maintains multiple links and listens across them, but it transmits and receives on one at a time, because there is one radio behind it. What you get is faster link selection and better latency when one band is busy. What you do not get is the throughput of two bands added together, because that needs simultaneous transmit and receive and the hardware in the phone cannot do it.

That is the client behaving exactly as designed. There is no AP setting that fixes a radio count.

## What to do with all this

**Stop tuning the infrastructure for a client problem.** Before you touch minimum basic rates or start trimming cell edges, find out what the client is. A phone sitting on nothing for ninety seconds after a lift is running a timer, and no amount of RF design shortens it.

**Do turn on 11k, 11v and 11r.** They are the levers you have, they genuinely help the clients that honour them, and their cost is near zero. Just size your expectations: they improve a decision rather than making it.

**Get the client's own logs when it matters.** For Android that is a bug report; for iOS a sysdiagnose. One capture from the device tells you more about a roaming complaint than a week of controller logs, because the decision you are arguing about was never made on your side of the air.

**When someone tells you a fix works, ask them why they think it works.** The elevator thread had the right fix and the wrong mechanism, confidently, in several comments at once. The fix survives being explained properly. The explanation is what you would have built your next troubleshooting step on.
