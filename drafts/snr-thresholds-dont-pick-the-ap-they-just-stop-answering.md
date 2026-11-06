---
title: SNR Thresholds Don't Pick the AP, They Just Stop Answering
slug: snr-thresholds-dont-pick-the-ap-they-just-stop-answering
date: 2026-10-22
tags: Wireless, Aruba Central, AOS 10, ClientMatch
hero: hero-snr-thresholds-dont-pick-the-ap-they-just-stop-answering.svg
summary: Probe and auth SNR thresholds are floors, not steering. With APs 12 to 17 m apart, the next AP still hears a Mac well above 25 dB, so setting 25 to 30 only strands the corner offices.
origin: One Airheads question with three confident answers, all assuming a threshold picks the AP
---

## Why I'm writing this

Somebody on Airheads has 10 to 15 APs in an open plan office, roughly 12 to 17 m apart. It's 5 GHz only, EIRP 12 to 15 dBm, mostly Macs. Some laptops won't join the nearest AP.

They'd collected three answers. Leave both thresholds at 0 and let ClientMatch sort it out. Never go above 15. And the forum's own AI said 25 to 30.

Each one sounds sure of itself. Each one also assumes a threshold picks the AP. It doesn't, and that's the whole post.

Anything with "threshold" in the name sounds like it should be in charge of something. This one's in charge of ignoring people.

## What a threshold actually does

The AP looks at the SNR of the frame it just got from the client. The AOS 8 CLI reference spells it out. With `local-probe-req-thresh`, APs won't respond to a probe request whose SNR is under the value. With `auth-req-thresh`, incoming authentication requests below the value are ignored. Both run 0 to 100 dB, and the default is 0, which means off.

That's it. It's a floor. It decides who gets ignored, never who gets picked. The Mac still makes the choice from its own view of the RF.

The probe floor on its own leaks. A Mac doesn't need a probe response to know an AP is there. It hears beacons, and once it knows a BSSID it can go straight to auth. That's what the auth threshold is for.

The intended job is cutting off clients you never wanted: the car park, the pavement, the floor above. Central's own Outdoor Clients insight uses this setting for exactly that, and it keeps the value between 8 and 16.

Here's a quick conversion so the numbers mean something. These are against a -95 dBm noise floor, about what a 20 MHz channel gives you:

| SNR | Roughly RSSI |
|---|---|
| 15 dB | -80 dBm |
| 20 dB | -75 dBm |
| 25 dB | -70 dBm |
| 30 dB | -65 dBm |

Each time you double the channel width, the noise floor goes up about 3 dB. On 80 MHz, every row needs about 6 dB more signal.

## What goes wrong when you crank it

At 12 to 17 m in open plan, the AP next door still hears a Mac well above 25 dB. My own rough path loss sums put it nearer 35, and I'll flag that number as mine rather than HPE's. Setting 25 or 30 doesn't hide that AP. The Mac still sees two good options and picks whichever it likes.

The people who do fall under the floor are in the corner office, behind the closed meeting room door, or on the far side of the lift core. They could only hear one AP to start with. Now that AP ignores them. Congratulations, you've built a dead zone on purpose.

Auth set above probe is the worst version. The AP answers the probe, so the Mac thinks it's welcome, and then the AP ignores the auth. The Mac retries, eventually tries something else, and the ticket says "Wi-Fi is slow to connect". That retry pattern is how I've seen clients behave. HPE doesn't document it.

Then there's direction. At 12 to 15 dBm EIRP, a laptop can transmit as hard as the AP or harder, so the AP hears the Mac better than the Mac hears the AP. The threshold measures the uplink. The complaint lives on the downlink. You're measuring the wrong side of the conversation.

## What good looks like

- Use the threshold to cut off clients you never want, not to shape cells inside the space you're serving.
- My starting point is probe around 15, with auth equal or a few dB lower and never higher than probe. HPE's outdoor insight sits at 8 to 16, so 25 to 30 is well outside anything HPE suggests. Check it against the survey, not against the number.
- If the cells are too big, shrink them with transmit power and minimum basic rates. Mist doesn't use an SNR floor at all: its High Density data rates template sets the minimum basic rate to 24 Mbps and disables everything below it.
- ClientMatch moves clients after they've joined. It sends an 802.11v BSS transition request, and falls back to a deauth when that keeps failing. It doesn't decide the first join. The AOS 10 ClientMatch page says a client that ignores more than five consecutive 802.11v moves goes on the un-steerable list for 24 hours. Three failed deauth steers put it there for 48.

Then ask the real question first. Is the first join wrong, or is it a Mac that stays put after it's moved? Different problems, different fixes.

## Central on AOS 10, then AOS 8

On AOS 10, Classic Central puts both in the WLAN's General, Advanced Settings, as Local Probe Request Threshold and Min RSSI for auth request. The second one says RSSI and takes dB of SNR. Just roll with it. The poster's screen labelled them Probe Request SNR Threshold and Authentication Request SNR Threshold (dB). Both are per SSID, so a guest SSID with the same values strands the same corner people.

The gotcha is Automatic. Both fields can be set to Automatic, which applies the AI insight's recommended value and re-checks it weekly. If you're chasing a number somebody typed in by hand, check that first.

AOS 8 follows the same rule under different names, in the `wlan ssid-profile`:

```term
wlan ssid-profile <SSID-PROFILE>
  local-probe-req-thresh 15
  auth-req-thresh 15
```

The CLI reference tells you to use `auth-req-thresh` with caution and to ask support first. Fair.

Now the Mac side. Apple's roaming article says a Mac keeps its current BSSID until RSSI crosses -75 dBm, and only moves to a candidate that's 12 dB stronger. Apple silicon Macs support 802.11k, 11r and 11v. Intel Macs don't. So a Mac that joined a farther AP sits there until -75 and then wants 12 dB better. That isn't a threshold problem. That's the Mac working as designed.

## Test it or it doesn't count

- Walk the floor with a Mac. Option-click the Wi-Fi menu or run `sudo wdutil info`, and log BSSID, RSSI and noise at the desk, the corner office and the closed meeting room. Recent macOS can redact the BSSID in `wdutil` output, so keep the Option-click menu as the backup.
- On the AP, `show ap debug mgmt-frames mac <CLIENT-MAC>` on AOS 10 shows that client's management frames. Healthy: the corner client sits comfortably above the floor on at least one AP.
- Broken: probes or auths from a client with nowhere else to go get no answer, or a corner room has no association at all after the change.
- Broken differently: probe responses go out and the auths still don't get an answer. That's your auth set above probe.
- For "not the nearest AP", check ClientMatch steer events and the un-steerable list before you touch thresholds again. Central's event log filters on Client Match Steer, and the un-steerable list comes out of the REST API.

## Checklist

| Check | Good | Broken |
|---|---|---|
| Threshold purpose | Cutting off outside or distant clients | Trying to steer inside the space |
| Probe vs auth | Auth equal or lower | Auth above probe |
| Corner and closed room walk | Above the floor on one AP or more | No association, or retries |
| Cell size control | Power and basic rates | Raised SNR floor |
| Mac behaviour | 11v honoured, steer history clean | On the un-steerable list |
| First join vs sticky | You know which one | Still guessing |

## Bottom line

A threshold decides who the AP ignores. It never decides which AP a Mac picks. Keep it low enough that every seat clears it on at least one AP, keep auth at or below probe, and shrink cells with power and rates.
