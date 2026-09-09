---
title: Your Survey Tool Can't See Channel 173
slug: channel-173-survey-blind-spot
date: 2026-09-09
tags: Wireless, Survey, Ekahau, RF Design
hero: hero-unii4.svg
summary: A client sat on one AP for 49 minutes while the signal fell to -69 dBm, and every heatmap said coverage was fine. The radio it was stuck to was on a channel the survey never scanned.
origin: A wireless troubleshooting engagement where the survey and the complaint disagreed, and the survey was wrong
---

## Why I'm writing this

I spent a day on a floor where the users said roaming was bad and the heatmaps said coverage was fine. Twelve APs, one floor, everything green. That gap between what the customer feels and what the report shows is usually the interesting part of the job, so I went looking for it.

The one that got me was a laptop that held a single AP for 49 minutes while its signal decayed from -53 dBm down to -69. Classic sticky client. Except when I went to look at that AP's coverage on the heatmap to see what the client should have roamed to instead, the radio wasn't there. Not weak. Not marginal. Absent.

The AP had two 5 GHz radios. The second one was on channel 173, and my survey had never scanned it.

## What U-NII-4 actually is

The FCC opened 5.850 to 5.895 GHz for unlicensed use in 2020, which added channels 169, 173 and 177 at the top of the 5 GHz band. It's a small slice, three channels, and it's real spectrum that modern APs will use if you let them.

The important part for us: it's on by default in some auto-channel pools. Nobody sat down and decided to put a radio on 173. The AP picked it, because it was allowed to, and because up there it's quiet.

## The blind spot

Here's the thing that bugs me. My survey platform's channel list ends at U-NII-3, channel 165. There is no entry for 169, 173 or 177, which means "Select All" doesn't include them, which means you cannot scan them even if you know to try.

I didn't want to believe that, so I checked it against the files rather than the docs. Two different projects, two different Sidekick generations, one from January 2024 and one from this August. The highest 5 GHz center frequency recorded in either file is 5825 MHz. Channel 165. Meanwhile the APs were beaconing on 173 during the walk, and I have them captured on their other radios, so I know the hardware was up and I know I walked past it.

Both surveys were clean. Both surveys were also missing two radios' worth of coverage, and neither one told me so.

That's what makes this different from a normal measurement gap. The tool doesn't warn you. There's no "channels not scanned" note on the report. You get a heatmap that looks complete, and it is complete for the channels it knows about.

## Why it's worse than one stuck client

Three things fall out of this, and the stuck laptop is the least of them.

**Coverage that exists but isn't on any map.** Two of twelve radios were serving clients from spectrum that appears nowhere in the deliverable. Every conclusion in that report about cell edges and overlap was drawn from an incomplete picture, and I didn't know it while I was drawing them.

**Roam candidates that only some clients can see.** Support for 169 to 177 is not uniform across a client fleet. A Wi-Fi 6E laptop from the last couple of years is fine. Plenty of what's actually on your floor is not. So one device sees a strong neighbour and roams, and the device next to it sees nothing there and holds on, and you get two clients in the same chair behaving completely differently. That's a miserable thing to troubleshoot if you don't know the channel is in play.

**Sticky clients with a real cause.** The 49-minute case wasn't a client driver being lazy. That laptop could hear the AP fine, it just couldn't see anything better, because the alternatives it was allowed to look at were quieter than the one it was already on. The behaviour looked like a client problem. It was a channel plan problem.

## What I'd do about it

Keep U-NII-4 out of the auto-channel pool until both your survey tool and your client fleet can handle it. On Meraki that's the 5 GHz channel selector in the RF profile: deselect 169, 173 and 177, save, and the affected radios re-channel on the next evaluation. Any vendor with an auto-channel pool has the same knob somewhere.

That's not a permanent position. It's spectrum we want eventually, and the answer changes the day the tools catch up. It's the right call now because you can't validate what you can't measure, and shipping a survey that silently omits two radios is worse than not having those radios at all.

Before you take my word for it, go look. This takes about a minute:

Pull your AP list and check what your radios are actually on right now. On Meraki, `GET /devices/{serial}/wireless/status` gives you a `basicServiceSets` array with the channel per BSS. On Aruba Central or a controller, `show ap bss-table` and read the channel column. Anything in 169 to 177 means you have radios your last survey didn't see.

Then open your most recent project file and check the highest 5 GHz frequency it recorded. If it stops at 5825 MHz and you found radios above it, your survey has a hole in it, and now you know exactly how big.

## The part that generalises

I've been doing this long enough to treat the survey as the source of truth, and this is a decent reminder that it isn't. A survey is a record of what the tool could measure on the day. Where those two things differ, nothing in the output flags the difference for you.

Same shape as a packet capture on the wrong VLAN, or a monitoring system that's been quietly failing to poll a device for six months. The dashboard is green because nothing is reporting, and nothing reporting looks exactly like nothing wrong.

When the measurements and the complaints disagree, it's worth one round of asking what the measurement isn't covering before deciding the users are imagining it. On this floor the users were right and my heatmap was wrong, and it took a stuck laptop and a 49-minute association to talk me into checking.

If you hit one of these and want a second set of eyes, grab me and we'll figure it out.
