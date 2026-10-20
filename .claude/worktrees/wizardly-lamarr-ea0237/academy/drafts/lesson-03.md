---
title: The Link Budget
series: Wireless Academy
lesson: 3
status: draft
accent: academy
---

# The Link Budget

I put an access point on a shelf, walked 32 ft away, and did the math first. The link budget said my laptop should see −36.9 dBm. It saw −57.4 dBm.

Twenty and a half decibels, gone. No walls. Line of sight the whole way on channel 149. A 25 dBm radio and a laptop, in a room.

That gap is the whole lesson. The equation was not wrong. Every textbook link budget you will ever write has the same hole in it, and once you see where the twenty decibels went, you will never read a coverage prediction the same way again.

This is Wireless Academy, lesson three. Companion to the video. Same numbers, a few more tables.

![Predicted vs measured](../assets/diagrams/03-predicted-vs-measured.svg)

## Four terms on a napkin

A link budget is four numbers. You can write it on a napkin.

$$P_{tx} + G_{ap} + G_{client} - L_{path} = \mathrm{RSSI}$$

Transmit power, plus the AP's antenna gain, plus the client's antenna gain, minus path loss. What comes out is RSSI: how loud the signal is when it gets there.

![Four terms](../assets/diagrams/01-four-terms.svg)

Transmit power first. That is what the radio pushes into the antenna, before the antenna does anything to it. Aruba Central printed **POWER 25 dBm** for this radio (AP-735, firmware 10.8.1.0_95966, 5 GHz channel 149 at 80 MHz, 802.11be, 2x2:2). Hold that thought. Aruba and Juniper do not mean the same thing by that number, and I will come back to it. Mist per-chain detail is later; do not mix the two notations yet.

Antenna gain is where people get comfortable and should not. Gain is not amplification. Nothing in a passive antenna adds energy. Gain is shape. An antenna takes the same power and puts more of it one direction and less another, and the datasheet number is the peak. Peak means the best direction, on a test range, mounted the way the vendor meant you to mount it. For the AP-735 that peak is **5.5 dBi** at 5 GHz (5.2 dBi in dual-5 mode).

Then there is client antenna gain, and here is the part nobody says out loud. Nobody publishes it. There is no datasheet for the antenna in your laptop. It is a strip of metal in a hinge, next to a battery, behind a screen, held by a hand. We put **zero** in that slot because we have nothing else to put there, and then we forget that we guessed.

Path loss is the last term, and it is the only honest one in the equation.

## Free space path loss

Free space path loss:

$$\mathrm{FSPL} = 20\log_{10}(d) + 20\log_{10}(f) - 27.55$$

Distance in metres, frequency in megahertz. Nothing is absorbed. Nothing is blocked. This is just the wave spreading out over the surface of a bigger and bigger sphere, and the sphere does not care what your building is made of.

![FSPL curve](../assets/diagrams/02-fspl-curve.svg)

Two things fall out of that formula that actually matter on site.

First, it is logarithmic, so the early metres are the expensive ones. One metre to ten metres costs you 20 dB. Ten metres to a hundred costs another 20. Double the distance, lose 6 dB. Every time, forever.

Second, and I did this one to myself, the formula has a minimum valid distance. Put the client right on top of the AP and you are inside the near field, roughly **0.8 m** for a typical 15 cm aperture at 5 GHz ($2D^2/\lambda$), and the equation is not just inaccurate, it is meaningless. I took ten beautiful samples with a laptop sitting on an access point and had to throw all ten away. Near-field only. Not a free-space sample.

At 32 ft on channel 149, $d = 9.7536\,\mathrm{m}$, $f = 5745\,\mathrm{MHz}$:

$$\mathrm{FSPL} = 20\log_{10}(9.7536) + 20\log_{10}(5745) - 27.55 = 19.78 + 75.19 - 27.55 = 67.4\,\mathrm{dB}$$

That number is right. It was right the whole time.

## The prediction, and the Mist trap

So here is the prediction I wrote down before I measured anything.

Conducted 25 dBm, plus 5.5 dBi of published antenna gain, gives **30.5 dBm EIRP** off the antenna. Minus 67.4 dB of path loss. **Predicted RSSI: −36.9 dBm.**

Before we find out how wrong that was, one vendor gotcha, because this one will bite you on a real design.

Juniper documents transmit power in Mist as **per transmit chain**. Per chain. So 15 dBm on a 2x2 access point is 18 dBm of total conducted power, not 15, and then you add antenna gain on top of that. Miss it and you are three decibels light on every Juniper AP in the design. (See Juniper Transmit Power Notation.) I am not comparing Aruba and Juniper absolute EIRP here. Central's POWER notation versus Mist's per-chain field is still an open question on my side of the lab, so absolute AP-to-AP EIRP stays off the page.

And while I was in there: the Mist **Configuration** panel said 17 dBm. The **Statistics** panel said 15 dBm.

![Mist config vs stats](../assets/screens/mist-config-vs-stats.png)

That is not a bug. Configuration is what you asked for. Statistics is what the radio did. I proved it through the API by writing 10 and watching the radio follow to 10, then writing 15 and watching it follow to 15. **15 dBm is a hard per-chain ceiling** on channel 36 at 80 MHz in the US for that AP34. Fifteen per chain equals 18 total conducted, plus 6.0 dBi from the datasheet, equals 24 dBm EIRP.

Read the statistics panel. What you asked for is not what you got.

## Measure it, then solve backwards

Twenty-two samples with `wdutil` on the MacBook, associated to the AP-735 5 GHz radio on channel 149 at 80 MHz, streaming Peacock the whole time. Lid facing the AP: mean **−57.4 dBm**, median −58, range −53 to −60, standard deviation **2.0 dB**, noise floor **−95 dBm**, SNR 37.6.

Predicted −36.9. Measured −57.4. **Gap: 20.5 dB.** The standard deviation is 2, so that is not noise.

![Predicted vs measured with gap](../assets/diagrams/03-predicted-vs-measured.svg)

Now the useful move. Do not go hunting for what you forgot. Rearrange the equation and solve for the term you guessed.

$$G_{ap} + G_{client} = \mathrm{RSSI} - P_{tx} + L_{path} = -57.4 - 25 + 67.4 = -15.0\,\mathrm{dBi}$$

I had put +5.5 in that slot. The real combined antenna term was **−15.0 dBi** (lid facing). Screen facing: −13.6 dBi. Twenty and a half decibels of difference, all of it sitting in the one term I did not measure.

![Antenna term solved](../assets/diagrams/04-antenna-term.svg)

So I went looking for it, and my first guess was the laptop. Aluminium lid between the antenna and the AP. Has to be worth ten. I turned the laptop around and took another ten samples (screen facing: mean −56.0, sd 1.7, noise −94).

**Lid effect: 1.4 dB.** Standard error 0.69. Roughly 95% interval about 0 to 2.8 dB. About seven percent of the gap, and marginally significant at best. I was wrong, and I was wrong by an order of magnitude.

## Where it actually went

Here is where it went, and it is embarrassing in hindsight.

That AP-735 was lying flat on its back on a wooden shelf about 4 ft off the floor, **radome pointing at the ceiling**, inside a metal-framed bookcase, with another shelf about **18 in** above it and thin metal uprights down both sides. Client at 32 ft horizontal, 4 ft above the floor. Line of sight through a doorway.

![Room / shelf mount](../assets/photos/room-view-a.jpg)

The Aruba AP-735 datasheet says, in plain English, that the antennas are optimized for horizontal ceiling mount, and that the downtilt angle for maximum gain is roughly **30 to 40 degrees** below the AP. I had it aimed at a plank.

The 5.5 dBi was real. It was just pointing somewhere else.

And I can show that is the mechanism rather than a story I like, because at the same instant, three devices sitting in the same spot at 32 ft read at the AP client list:

| Device | Tx/Rx Mbps | SNR | RSSI |
|---|---|---|---|
| MacBook | 1134 / 1134 | 51 | −41 |
| iPhone 15 Pro Max | 453 / 216 | 36 | −56 |
| iPad Pro 13 M4 | 864 / 680 | 29 | −63 |

**22 dB** MacBook to iPad. 15 dB Mac to iPhone. 7 dB iPhone to iPad. The SNR deltas match the RSSI deltas exactly (51−36=15, 51−29=22), so these rows share a common noise floor and the deltas are trustworthy even though AP-reported absolutes are not. Same room, same second, same radio, same path loss for all three. The only thing that changes is the antenna at the far end, and which way it happens to be facing.

(Rule I keep for myself: across vendors compare SNR; within one radio compare same-instant deltas; never treat an AP-reported RSSI as a calibrated absolute.)

## The door that did almost nothing

One more, and this is the one that changed how I read a survey table.

I have a sliding barn door about **8 ft** from the access point (24 ft from the client). Wood and frosted glass. Glass is 80 to 85 percent of the door area: frosted single pane, about 3/8 in (9.5 mm), no Low-E. Gaps at the track and edges stay open in both states. I predicted **2 to 5 dB** of loss and slid it shut.

This run was on the Mist AP34 path: channel 36 at 80 MHz, radio power 15 dBm per chain.

![Barn door](../assets/photos/barn-door.jpg)

Closed: n=6, mean **−63.2 dBm**, median −63, range −60 to −66, sd 1.9. Open: n=5, mean **−64.2 dBm**, median −65, range −62 to −66, sd 1.6.

Door loss (open minus closed) = **−1.0 dB**. Closed was better. Standard error 1.08. 95% interval **−3.2 to +1.2 dB**. Stated as a result: this door costs **at most 1.2 dB** on this link, and may cost nothing. Minimum detectable effect at this sample size is about 2.2 dB, so a 4 dB door would have shown up plainly and did not.

Before you tell me the signal just went around it: at 8 ft into a 32 ft link on channel 36 ($f = 5180\,\mathrm{MHz}$, $\lambda = 0.0579\,\mathrm{m}$), the first Fresnel zone is about **25.6 in across** (radius 12.8 in). The door is **36 in** wide. It completely covered the first Fresnel zone. The direct path was fully obstructed by the material.

![Fresnel at the door](../assets/diagrams/05-fresnel-door.svg)

Run that glass through **ITU-R P.2040-3** and you get about **1.3 dB** for a 9.5 mm pane. Theory says 1.3. My link says at most 1.2. Those agree.

So the working number for frosted single pane at 5 GHz is about **1 dB**. The survey tables say 3 to 6. That is the number for the material on a bench, at a right angle, with nowhere else for the signal to go. Your building is not a bench.

## Bottom line

Path loss is the one term you can trust, and it is the one everybody spends their time on. The antenna terms are the ones that decide whether the link works, and one of them is a guess and the other one depends entirely on how somebody mounted the box.

Predict the number. Then go measure it. And when the measurement disagrees with you, solve for the term you guessed instead of defending the one you wrote down.

Twenty and a half decibels. Ask me how I know.

> **Four mistakes from this lab**
>
> 1. **Tape X.** I stood on a tape mark meant for the AP footprint and took nine samples at about 2 ft instead of 32 ft. Wrong distance, whole table thrown out.
> 2. **Lid.** I predicted the aluminium lid would eat a large share of the 20 dB. Measured: 1.4 dB, about 7% of the gap.
> 3. **Door.** I predicted 2 to 5 dB before looking hard at a door that is mostly glass. Measured: under 1.2 dB.
> 4. **Per-chain trap.** I started an EIRP comparison before reading how each vendor prints power. That comparison is withdrawn. Notation first, arithmetic second.

Next up is Lesson 4: MCS (modulation and coding), and why RSSI stops being the number that matters.

---

### Sources

- Juniper Transmit Power Notation
- Juniper Antenna Gains
- Juniper AP34 datasheet
- Aruba AP-735 datasheet
- ITU-R P.2040-3

### Audit appendix (page figures only)

| Claim | Value | Provenance | Status |
|---|---|---|---|
| Client distance | 32 ft (9.7536 m) | tape / geometry | measured |
| LOS path, channel 149 @ 80 MHz | AP-735 5 GHz | Central / wdutil | measured |
| AP-735 POWER | 25 dBm | Aruba Central | measured |
| AP-735 antenna peak gain | 5.5 dBi | Aruba AP-735 datasheet | datasheet |
| FSPL at 32 ft, 5745 MHz | 67.4 dB | $20\log d + 20\log f - 27.55$ | calculated |
| EIRP used in prediction | 30.5 dBm | 25 + 5.5 | calculated |
| Predicted RSSI | −36.9 dBm | 30.5 − 67.4 | calculated |
| Measured RSSI (lid, n=22) | −57.4 dBm mean, sd 2.0 | wdutil | measured |
| Noise floor (lid) | −95 dBm | wdutil | measured |
| Gap vs prediction | 20.5 dB | −57.4 − (−36.9) | calculated |
| Solved $G_{ap}+G_{client}$ (lid) | −15.0 dBi | −57.4 − 25 + 67.4 | calculated |
| Solved (screen) | −13.6 dBi | −56.0 − 25 + 67.4 | calculated |
| Lid orientation effect | 1.4 dB (SE 0.69) | lid vs screen means | measured |
| Near-field boundary (illustration) | ~0.8 m | $2D^2/\lambda$, 15 cm @ 5180 MHz | estimate |
| Discarded on-AP samples | 10 | near-field invalid | measured |
| Mist Config vs Stats | 17 dBm vs 15 dBm | Mist UI | measured |
| Mist hard ceiling (ch 36 80 MHz US) | 15 dBm per chain | API write 10→10, 15→15 | measured |
| AP34 antenna gain | 6.0 dBi | AP34 datasheet | datasheet |
| 15/chain → EIRP (Mist path) | 24 dBm | 18 conducted + 6.0 | calculated |
| Same-instant RSSI (Mac / iPhone / iPad) | −41 / −56 / −63 | Central client list | measured |
| Same-instant SNR | 51 / 36 / 29 | Central client list | measured |
| Mac-to-iPad spread | 22 dB | RSSI and SNR deltas | calculated |
| Mount: radome up, shelf ~18 in above | bookcase geometry | photo / tape | measured |
| Downtilt for max gain | ~30 to 40° | AP-735 datasheet | datasheet |
| Door closed mean (n=6) | −63.2 dBm | wdutil on AP34 path | measured |
| Door open mean (n=5) | −64.2 dBm | wdutil on AP34 path | measured |
| Door loss (open−closed) | −1.0 dB; ≤1.2 dB (95%) | difference of means | measured |
| First Fresnel diameter at door | 25.6 in | $\lambda$, d1=8 ft, d2=24 ft | calculated |
| Door width | 36 in | tape | measured |
| ITU glass loss (~9.5 mm) | ~1.3 dB | ITU-R P.2040-3 | calculated |
| Working frosted single-pane figure | ~1 dB | lab + ITU | estimate |
| Survey-table glass range (contrast) | 3 to 6 dB | common survey tables | estimate |

Kit note: diagram SVGs and stills live in the lesson-03 video pack (`01-four-terms`, `02-fspl-curve`, `03-predicted-vs-measured`, `04-antenna-term`, `05-fresnel-door`, `screens/mist-config-vs-stats.png`, room/shelf and barn-door photos). Paths above are relative for later wiring into the site asset tree.
