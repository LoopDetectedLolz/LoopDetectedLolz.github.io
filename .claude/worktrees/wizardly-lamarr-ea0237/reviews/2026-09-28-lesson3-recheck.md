# Lesson 3 "The Link Budget": recheck of LIVE page vs locked FACTS

Prepared 2026-09-28 (ET). Read-only: nothing on the website, the Mac, or any pack file was changed.
Sources compared:
- LIVE: https://www.networkfieldnotes.com/p/academy-03-the-link-budget.html (re-fetched 2026-09-28 15:31 ET; byte-identical to `raw/pages/p_academy-03-the-link-budget.html`, published_time 2026-09-22)
- FACTS pack: `/workspace/lesson03-video-pack/context/FACTS.md`, `SCRIPT.md`, `META.md`, diagrams in `context/assets/diagrams/`
- Draft: `/workspace/academy-drafts/lesson-03.md`
- Video: `outputs/STAGE1-SUMMARY.md`, `timeline-stage1.json`, `STAGE2-SUMMARY.md`, clip list in `outputs/stage2/`, and a speech-to-text pass (faster-whisper small.en) over `vo/lesson03-vo-full.mp3` for line-level timestamps. The master MP4 audio is that VO file from t=0, so VO timestamps = master timestamps.

---

## 1. Verdict

**The LIVE page is right on the numbers in dispute. FACTS (and the script, draft and video built from it) is wrong about the link budget.**
Aruba Central's `POWER 25 dBm` is **EIRP**. The antenna gain is already in it. Adding 5.5 dBi to reach 30.5 dBm counts the antenna twice. The correct prediction is **-42.4 dBm** and the gap is **15.0 dB**, not -36.9 and 20.5.

FACTS' other figures (FSPL, the measurements, the lid, the door, Fresnel, glass) are arithmetically sound, with some small caveats (section 5). The live page has a few minor issues of its own (section 6), but none of them touch the verdict.

**Confidence: high (about 95%).** The deciding argument is physical and does not depend on how anyone reads Central's UI:
1. HPE's own datasheet says the AP-735 cannot produce more than **+21 dBm conducted** per radio (18 dBm per chain). So "25 dBm conducted" is impossible, and "25 dBm per chain" is even more impossible.
2. The FCC grant for the AP-735 (FCC ID Q9DAPIN0735) lists **0.1406 W = 21.5 dBm** for 5745-5825 MHz, conducted, with no "EP" (EIRP) note.
3. HPE docs define the power in Central's AOS 10 radio profile, in AirMatch and in the AOS CLI as **EIRP**. An HPE employee on Airheads says the configured power is "radio + antenna".

The one gap left: no HPE page says in so many words that the *monitoring* field on Central's AP details page ("Power") is EIRP. The doc just says "The transmit power of the radios", and the API says "power level in dBm at which the radio is operating". That is why confidence is 95% and not 100%. Point 1 still closes it: 25 dBm is only reachable as EIRP.

What I could not resolve from docs: HPE does not say which gain figure the AP subtracts internally when it turns EIRP into conducted power for internal antennas. It could be the 5.5 dBi peak or the 4.1 dBi combined average. If it is 5.5, conducted is 19.5 dBm total (16.5 per chain). If it is 4.1, conducted is 20.9 dBm. Both are legal and under 21. At worst this moves the live gap by about 1.4 dB. It does not change the verdict.

---

## 2. Task 1: AP-735 datasheet and regulatory power

### 2a. HPE Aruba Networking 730 Series data sheet (doc code `DS_HPEANW730SeriesAP_RVK_052924 a00138541ENW`, © 2024 HPE)
Official PDF, as mirrored by reseller BlueAlly/SecureWirelessWorks: https://cdn.blueally.com/securewirelessworks/datasheets/access-points/ds-ap730series.pdf (hpe.com and arubanetworks.com block automated fetches from the box. The PDF metadata says Author "HPE Aruba Networking" and the doc code matches.)

> "Transmit power: Configurable in increments of 0.5 dBm"
> "Maximum (aggregate, conducted total) transmit power (limited by local regulatory requirements
>  – Per radio/band (2.4 GHz/5 GHz/6 GHz): +21 dBm (18 dBm per chain)
>  – Note: conducted transmit power levels exclude antenna gain. For total (EIRP) transmit power, add antenna gain."

> "AP‑735: Integrated downtilt omni‑directional antennas for 2x2 MIMO with peak antenna gain of 5.1dBi in 2.4 GHz, 5.5dBi in 5 GHz (5.2dBi in dual‑5 GHz mode) and 5.3dBi in 6 GHz (5.2dBi in dual‑6 GHz mode). Built‑in antennas are optimized for horizontal ceiling mounted orientation of the AP. The downtilt angle for maximum gain is roughly 30 to 40 degrees.
>  – Combining the patterns of each of the antennas of the MIMO radios, the peak gain of the combined, average pattern is 3.9dBi in 2.4 GHz, 4.1dBi in 5 GHz (2.5dBi in dual‑5 GHz mode) and 3.9dBi in 6 GHz (3.7dBi in dual‑6 GHz mode)."

RF performance table, "Maximum transmit power (dBm) per transmit chain", 5 GHz:
> 802.11a 6 Mbps 18.0 / 54 Mbps 16.0; 802.11ax HE20/40/80/160 MCS0 18.0/18.0/18.0/18.0, MCS11 14.0 ×4; 802.11be EHT20–160 MCS0 18.0 ×4, MCS13 12.0 ×4.

The data sheet gives **no aggregate or maximum EIRP figure**. It only says "add antenna gain". (By contrast, the 570 Series data sheet does list "Maximum EIRP ... Antenna Gain + TxBF Gain".)

### 2b. HPE 730 Series QuickSpecs (a50009206enw)
https://www.hpe.com/us/en/collaterals/collateral.a50009206enw.html. Direct fetch timed out from the box. The text below is quoted from the search index of that hpe.com URL and matches the data sheet word for word:
> "Maximum (aggregate, conducted total) transmit power (limited by local regulatory requirements): Per radio/band (2.4 GHz/5 GHz/6 GHz): +21 dBm (18 dBm per chain). Notes: conducted transmit power levels exclude antenna gain. For total (EIRP) transmit power, add antenna gain."
> "AP‑735: ... peak antenna gain of 5.1dBi in 2.4 GHz, 5.5dBi in 5 GHz and 5.3dBi in 6 GHz ... The downtilt angle for maximum gain is roughly 30 to 40 degrees."

HPE PSNow per-SKU data sheet (S0H13A, PSN1014839288UAEN, PDF mirror https://www.jjnet.com.tw/hubfs/File%20Download/Products/HPE%20Aruba/%E5%AD%90%E7%94%A2%E5%93%81/ARUBA_730_735_(%E5%AD%90)_DS.pdf) repeats the same 5.5 dBi antenna line. It has no power line.

### 2c. Regulatory (FCC) power table: FCC ID Q9DAPIN0735 (RMN APIN0735 per the HPE install guide)
https://fcc.report/FCC-ID/Q9DAPIN0735/ and https://fccid.io/Q9DAPIN0735. Both block the box, so the figures are quoted from the search-indexed grant table:
| Frequency | Output W | dBm | Notes |
|---|---|---|---|
| 5180-5240 MHz | 0.1361 / 0.1393 | 21.3 / 21.4 | CC, MO |
| 5260-5320 MHz | 0.1409 | 21.5 | CC, MO, ND |
| 5500-5720 MHz | 0.1393 | 21.4 | CC, MO, ND |
| **5745-5825 MHz (ch149 here)** | **0.1406** | **21.5** | CC, MO |
| 5845-5885 MHz | 0.3589 | 25.5 | CC, **EP**, MO |
"EP" marks EIRP rows. The ch149 row is conducted: about **21.5 dBm total**, which matches the 21 dBm data sheet figure. 25 dBm conducted (316 mW) would be 2.2 times the certified output.

Install guide: https://arubanetworking.hpe.com/techdocs/hardware/aps/ap730/ig/AP-730_Install_Guide_EN.pdf (returns 403 from the box. The indexed text confirms "AP-735 RMN: APIN0735" and has no power table in the indexed extract).

**What follows from this:** the maximum 5 GHz EIRP at the antenna peak is 21 + 5.5 = **26.5 dBm** (before any TxBF array gain on beamformed data frames). Central's 25 dBm fits under that as EIRP. As conducted power it cannot happen.

---

## 3. Task 2: what Central's power number means

| Source (HPE) | Quote | URL |
|---|---|---|
| Central 2.5.8 (AOS 10) "Configuring Radio Parameters" | "Allowed Transmit Power: Specify the minimum and maximum transmission power. The value specified indicates the minimum and maximum EIRP ... If the minimum and maximum transmission EIRP setting configured on an AP is not supported by the AP model, this value is reduced to the highest supported power setting." | https://arubanetworking.hpe.com/techdocs/central/2.5.8/content/aos10x/cfg/aps/conf_radio_settings.htm |
| AOS 10 AirMatch | "developing an optimized RF network plan, which specifies channel, bandwidth, and EIRP settings for each radio" | https://arubanetworking.hpe.com/techdocs/aos/aos10/services/airmatch/ |
| AOS 8 `rf arm-profile` | "max-tx-power: Maximum effective isotropic radiated power (EIRP) ... This value takes into account both radio transmit power and antenna gain." | https://arubanetworking.hpe.com/techdocs/CLI-Bank/Content/aos8/rf-arm-pro.htm |
| AOS 10 `show ap bss-table` | "ch/EIRP/max-EIRP: Radio channel used by the AP/current effective Isotropic Radiated Power (EIRP) /maximum EIRP." | https://arubanetworking.hpe.com/techdocs/CLI-Bank/Content/aos10/sh-ap-bss-table.htm |
| AOS 10 `show ap active` (gateway) | "Radio 0 Band Ch/EIRP/MaxEIRP/Clients: Radio ID, channel, EIRP, Maximum EIRP ..." Example line `AP:5GHz-HE:153/15.0/26.8/0` | https://arubanetworking.hpe.com/techdocs/CLI-Bank/Content/aos10/sh-ap-active.htm |
| Central AP dashboard (monitoring) | "Power—The transmit power of the radios." (does not name the quantity) | https://arubanetworking.hpe.com/techdocs/central/2.5.7/content/nms/access-points/mrt/ap-overview.htm |
| New Central API radio list | "power: Specifies the power level in dBm at which the radio is operating." | https://developer.arubanetworks.com/new-central/reference/getaccesspointradiolistv1 |
| Airheads, **jhoward (HPE Employee)**, 2017-09-11 | Asked whether the ARM power setting is aggregate or per chain: "It's the total / aggregate (if you want to call it that). So if you set 20dB as the EIRP, that will be the radio + antenna = 20" | https://airheads.hpe.com/discussion/maximum-transmit-power-and-transmit-power-per-chain |
| Airheads, onno (HPE Employee), same thread | "18dBm is 63mW ... 4x 63 = 252mW ... 24dBm" (the data sheet aggregate = per chain + 10log N) | same |
| Airheads, arjan_k (community, not flagged HPE), 2017 | "The values you see in ArubaOS are EIRP; this means antenna gain is accounted for ... For AP's with internal antennas ArubaOS already knows the antenna gain" | https://airheads.hpe.com/discussion/aruba-82-controller-transmit-eirp-dbm-relation-to-mw-out-put-power-on-radio-on-ap-305 |
| Airheads, MK-bb8a89 (MVP, "Not an HPE Employee"), 2021 | "In the Aruba controller all tx-power settings are in EIRP." | https://airheads.hpe.com/discussion/txeirp-reporting-on-ap-515 |

**Conclusion:** the number is EIRP. It is total across chains and includes antenna gain. It is not per-chain conducted and not aggregate conducted. Confidence is high: several HPE docs say it outright for config, AirMatch and CLI, one HPE employee confirms it, and the hardware limit rules out every other reading. The only soft spot is the unlabelled monitoring field (see section 1).

This also closes the item META.md lists as "still open" (lines 47-48). The answer is neither "total conducted" nor "per chain". It is EIRP.

---

## 4. Task 3: both budgets recomputed

FSPL at d = 9.7536 m, f = 5745 MHz:
- 20·log10(9.7536) = 19.783; 20·log10(5745) = 75.186; minus 27.55, giving **67.419 dB**. (The exact 4πdf/c form gives 67.417.) **67.4 dB is correct in both versions.**

| | FACTS / script / draft / video | LIVE |
|---|---|---|
| Tx term | 25 dBm treated as **conducted** | 25 dBm treated as **EIRP** |
| AP antenna | +5.5 dBi added | 0 (already inside the 25) |
| EIRP | 30.5 dBm | 25.0 dBm |
| Client antenna assumed | 0 dBi (explicit in script beat 2) | 0 dBi (explicit) |
| Predicted | 30.5 − 67.4 = **−36.9 dBm** (−36.92) | 25 − 67.4 = **−42.4 dBm** (−42.42) |
| Measured (lid, n=22) | −57.4 | −57.4 |
| Gap | **20.5 dB** (20.48) | **15.0 dB** (14.98) |
| Solved term | G_ap+G_client = −57.4 − 25 + 67.4 = −15.0 dBi, against +5.5 assumed | G_client + off-lobe loss = −57.4 − 25 + 67.4 = −15.0 dB, against 0 assumed |
| Screen facing | −56.0 − 25 + 67.4 = −13.6 dBi | (not stated) |
| Lid share | 1.4/20.5 = 6.8% ("about seven percent") | (not stated) → 1.4/15.0 = **9.3%** |

**Internal consistency:** both versions check out arithmetically. FACTS' solve line uses P_tx = 25 conducted consistently with its own EIRP. LIVE's solve reuses the same arithmetic but reads it as EIRP, so −15.0 is measured against a 0 assumption and gives 15.0. The difference between them is the premise, not the arithmetic, and FACTS' premise (25 dBm conducted) is ruled out by the hardware (section 2).

Same thing written in FACTS' own terms, if you want to keep "conducted + gain": if Central's EIRP is based on the 5.5 dBi peak, conducted = 19.5 dBm total (16.5 per chain). Then G_ap,eff + G_client = −57.4 − 19.5 + 67.4 = **−9.5 dBi** against +5.5 assumed, which is again a **15.0 dB** gap.

Other checks:
- Measurement A SNRs: −57.4 − (−95) = 37.6 ✓, −56.0 − (−94) = 38.0 ✓. Lid SE = √(2.0²/22 + 1.7²/10) = 0.686 ✓. 95% CI 0.06 to 2.74 ✓ ("roughly 0 to 2.8").
- Measurement B deltas 15/22/7 ✓. Implied common noise floor −92 on all three rows ✓.
- Near-field 2D²/λ (0.15 m, 5180 MHz) = 0.78 m ✓.
- Mist: 15 + 3.01 + 6.0 = 24.0 ✓.
- FACTS Measurement D (505H): the arithmetic is right (47.8 ft = 14.57 m, FSPL 70.9, 27.9 − 70.9 − 13 = −56.0). **It has the same flaw**: it uses 25 dBm as conducted and adds 2.9 dBi. The 505H data sheet (a00096366enw) also caps conducted power at "+21 dBm (18 dBm per chain)" on 5 GHz. With EIRP = 25 the prediction becomes **−58.9 dBm** (the 13 dB floor is still an estimate).
- Caveat that neither version covers: 2x2 TxBF can add up to about 3 dB of array gain toward a client on beamformed data frames. That would make the measured RSSI higher, so the true gap would be larger, not smaller. The verdict holds either way.
- The withdrawn "9.5 dB EIRP gap" in FACTS (line 189) is 30.5 − 21.0 (AP-735 under FACTS vs AP34 single chain). Correct figure: 25 vs 21–24 = **1 to 4 dB**, which matches LIVE ("One to four in the air").

---

## 5. Task 4: door, Fresnel and glass

These all come from the **Juniper AP34 on channel 36 (5180 MHz)**, not the AP-735 on ch149 (FACTS lines 39, 148. Draft line 129 says so. SCRIPT beat 7 does not).

| Item | FACTS | Recheck | Status |
|---|---|---|---|
| Door loss | −1.0 dB (open − closed) | −64.2 − (−63.2) = −1.0 ✓ | correct |
| SE of difference | 1.08 | Welch 1.06, pooled 1.07 | fine |
| 95% interval | −3.2 to +1.2 | z: −3.1 to +1.1; t (df≈9, n=6/5): **−3.4 to +1.4** | **slightly optimistic**. "At most 1.2 dB" should be "at most about 1.4 dB" with small-sample t |
| MDE "about 2.2 dB" | 2.2 | ≈ 2·SE, which is 50% power only. 80% power ≈ 3.0 (z) to 3.3 (t) dB | "a 4 dB door would have shown up" still holds |
| First Fresnel diameter at door, 5180 MHz | 25.6 in (r = 0.325 m) | λ = 0.05788 m, d1 = 2.4384, d2 = 7.3152, D = 9.7536 gives r = 0.3253 m = 12.81 in, **25.6 in** ✓ | correct |
| Same at 5745 MHz (as asked) | n/a | λ = 0.05218 m gives r = 0.3089 m = 12.16 in, **24.3 in** | also < 36 in |
| "Door 36 in completely covers" | yes | True only if the line of sight crosses within ±5.2 in (5180) or ±5.8 in (5745) of the door's centre line. That lateral position isn't recorded. The wood stiles also sit inside the zone. "No peeking around the edge" overstates it, since indoor multipath (open slot above the door, reflections) still arrives | plausible, overstated |
| Glass, ITU-R P.2040 | cites **P.2040-3**; ε' = 6.27, σ = 0.0043·f^**1.1905** | Those are the **P.2040-1 (2015)** Table 3 glass values, and the exponent there is **1.1925** (FACTS has a typo). P.2040-3 (2023) Table 3 glass is **6.31, 0, 0.0036, 1.3394**. Full slab calculation, 9.5 mm, normal incidence, 5180 MHz: **1.36 dB** with either set (P.2040-1: 0.19 dissipative + 1.17 mismatch; P.2040-3: 1.36). tan δ 0.017 ✓, n 2.50 ✓, βd 148° ✓ | number right (≈1.3–1.4), **citation/version wrong** |
| Glass at 5745 MHz | n/a | **0.6 dB** (the slab is near half-wave resonance, βd ≈ 164°) | the "1 dB at 5 GHz" working figure depends heavily on frequency and thickness |
| Survey tables "3 to 6 dB" | unsourced | not verified | needs a source |

**Does cutting them from LIVE leave anything dangling?** No, not on the site:
- The live body, meta/og/twitter descriptions, figures (two photos: `lesson-03-two-aps.jpg`, `lesson-03-ap-on-shelf.jpg`) and the lab steps never mention the door, Fresnel or glass. The only "door" is the phrase "The datasheet closes that door." (source line 1576).
- No other page points to Lesson 3's door or glass. Cross-references elsewhere are consistent with LIVE: Lesson 11 says "Lesson 3 settled that the Aruba figure is EIRP". Lesson 6 calls the Mist per-chain field "the lesson 3 catch". Lesson 11 cites "Mine was 2 dB" SD. Lesson 2 says "predicting the RSSI at 10 m" (≈ 9.75 m, fine).
- It dangles **off-site**: the video (beat 7), the planned 9:16 teaser (built from beats 1, 5, 7), the draft ("The door that did almost nothing") and FACTS' mistake #3 all keep the door. If the video is embedded on the page later, the page won't have the companion material.

---

## 6. Task 5: other LIVE vs FACTS/draft differences

1. **Core budget**: 25 EIRP / −42.4 / 15.0 on LIVE vs 30.5 / −36.9 / 20.5 in FACTS (sections 1–4). Also in LIVE's intro ("off by fifteen decibels", source line 1521), meta description, and the academy and home cards ("fifteen decibels short").
2. LIVE's four napkin terms add **Receive sensitivity** (line 1527). FACTS and the script use P_tx, G_ap, G_client, FSPL.
3. LIVE adds "What the gear shows you" with the AOS 10 and AOS 8 doc claims, which check out, and a CLI block (lines 1543-1545). **That CLI output is copied from HPE's CLI Bank example** (`AP:5GHz-HE:153/15.0/26.8/0`), not from Dustin's gear, and `show ap active` is a gateway command. A Central-only AOS 10 AP would use `show ap bss-table` (also `ch/EIRP/max-EIRP`). Suggest labelling it "HPE's documented example".
4. LIVE adds a Juniper beacon caveat (single chain: 21 dBm; both chains: 24 dBm). FACTS states 24 dBm flat.
5. LIVE adds **"The bench that couldn't answer"** (lines 1566-1576): Sidekick at 10 ft, 12 readings, derived AP-735 EIRP **24.8 dBm**, and an unsourced "sixty degrees off the peak ... five or six decibels". **None of this is in FACTS.** META says the power-term test "never completed cleanly". It needs a source-of-record entry. The logic ("unmeasured terms under two decibels") is consistent: 26.5 − 24.8 = 1.7.
6. LIVE's air-side comparison (Aruba 25 vs Juniper 21–24) is an absolute AP-to-AP EIRP comparison. FACTS retracts that category (line 186). Under the verdict it is now well founded, with the beacon caveat.
7. LIVE line 1601: "my client was off to one side and slightly below". FACTS geometry has the AP shelf at about 4 ft and the client at 4 ft, so they are **level**, not below. Minor.
8. LIVE line 1576: "the most this radio can radiate on 5 GHz is about 26.5 dBm EIRP". Correct per the data sheet, but it leaves out TxBF array gain (up to +3 dB on beamformed frames). "cannot produce 30 dBm of anything" is marginal (26.5 + 3 = 29.5).
9. LIVE leaves out: the Mist Config 17 vs Statistics 15 story, the same-instant client table (Measurement B), Measurements C and D, the door, Fresnel and glass, the lid "percent of gap" line, and the four-mistakes box (tape X and lid are woven in, and the door mistake is gone).
10. LIVE has a "Close the Link" game widget (9 + 3 − 1 = 11 dBm; 11 − 75.6 = −64.6; margin −7.6 ✓).
11. Next-lesson wording differs: LIVE "Modulation and data rates" vs script "modulation and coding".
12. Video beat 6 (6:12.4–6:36.1) shows **`ap34-on-shelf.jpg` (the Juniper AP34)** while the narration describes the AP-735's posture. The visual doesn't match the narration.

---

## 7. What changes under the verdict (LIVE right, FACTS wrong on the budget)

Replacement values: EIRP **25 dBm** (Central, antenna included). Predicted **−42.4 dBm**. Gap **15.0 dB**. Solved "client antenna + off-lobe loss" **−15.0 dB** against **0** assumed (screen facing −13.6). Lid **≈9%** of the gap. Diagram 04 breakdown **13.6 + 1.4 = 15.0**. Measurement D prediction **−58.9 dBm**.

### 7a. LIVE page (source line numbers in the raw HTML)
No changes forced by the verdict. Optional accuracy fixes:
- 1543-1545: label the CLI block as HPE's documented example (or replace it with real `show ap bss-table` output from the AP-735).
- 1576: "about 26.5 dBm EIRP" → add "before beamforming gain". Soften "cannot produce 30 dBm of anything".
- 1601: "off to one side and slightly below" → "off to one side, at the same height" (per FACTS geometry).
- 1566-1576: add the bench dataset (24.8 dBm, 12 readings, 10 ft) to the source of record, or mark it as not in the locked facts.
- Optional: add "about nine percent of the gap" after "1.4 dB." (line 1595).

### 7b. FACTS.md (line numbers)
- 32: `POWER 25 dBm` → mark "(EIRP, antenna gain included, per HPE docs)".
- 46-52: add the AP-735 row: max conducted +21 dBm per radio (18 per chain), no max EIRP listed, combined average gain 4.1 dBi.
- 61-62: `EIRP = 25 + 5.5 = 30.5` → `EIRP = 25 (Central, already EIRP)`; predicted **−42.4**.
- 77: gap 20.5 → **15.0**.
- 78-80: relabel the solve as "G_client + off-lobe loss = −57.4 − 25 + 67.4 = −15.0 dB (lid), −13.6 (screen), against **0** assumed" (or: conducted 19.5, so G_ap,eff + G_client = −9.5 dBi against +5.5).
- 114, 116: 505H EIRP = 25 (not 25 + 2.9 = 27.9); predicted **−58.9** (note the 505H is also capped at 21 dBm conducted).
- 140-141: interval −3.2 to +1.2 → about −3.4 to +1.4 (t, df≈9); "at most 1.2 dB" → "at most about 1.4 dB" (optional but more defensible).
- 142: MDE 2.2 dB is a 50%-power figure; about 3 dB at 80% power (optional).
- 156-159: cite **P.2040-1** for 6.27 / 0.0043 / f^**1.1925** (fix the 1.1905 typo), or switch to P.2040-3 values 6.31 / 0.0036 / 1.3394. The result stays ≈1.36 dB at 5180 MHz. Note it drops to ≈0.6 dB at 5745 MHz.
- 186-189: resolve "unresolved": Central = EIRP. The 9.5 dB gap stays withdrawn; the correct figure is 1–4 dB.
- 196-197: mistake #2 "missing 20 dB ... 7 percent" → "15 dB ... about 9 percent".
- 200-201: mistake #4: the real error on the Aruba side was **adding antenna gain to a number that was already EIRP** (double count). Per-chain is the Juniper half.
- META.md 47-48 (and 45 heading): remove from "still open".

### 7c. SCRIPT.md (line numbers)
- 26: "minus thirty seven" → "minus forty two".
- 28: "Twenty and a half decibels" → "Fifteen decibels". 28-29: "A twenty five dBm radio" → optionally "twenty five dBm of EIRP".
- 33: "the twenty decibels" → "the fifteen decibels".
- 49-51: Transmit power paragraph: say Central's 25 dBm is EIRP, not transmit power.
- 104-106: rewrite the prediction: "Twenty five dBm of EIRP, antenna already in it ... minus sixty seven point four ... minus forty two point four." The 30.5 double count can stay as the named mistake.
- 111-114: add the Aruba half of the promised payoff (Aruba prints EIRP, Juniper prints per chain). Beat 2 promises "I will come back to it" and currently only Juniper is explained.
- 135-136: "minus thirty six point nine ... Twenty and a half" → "minus forty two point four ... Fifteen".
- 141-143: "Antenna gain equals RSSI, minus transmit power" → "Client antenna plus off-lobe loss equals RSSI, minus EIRP, plus path loss"; "minus fifteen dBi" → "minus fifteen dB".
- 145-146: "I had put plus five point five" → "I had put zero"; "Twenty and a half decibels of difference" → "Fifteen".
- 151: "About seven percent" → "About nine percent".
- 173: OK. Optionally add "and it was already inside Central's twenty five".
- 196, 203-204: optional "at most about one point four". 202: optional "P dot two zero four zero" citation fix doesn't change the VO.
- 226: "Twenty and a half decibels." → "Fifteen decibels."

### 7d. Draft `/workspace/academy-drafts/lesson-03.md` (line numbers)
11 (−36.9 → −42.4); 13 (Twenty and a half → Fifteen); 15 (twenty → fifteen); 31 (POWER 25 dBm is EIRP); 33 (add "already inside Central's 25"); 65 (30.5 EIRP / −36.9 → 25 / −42.4); 69 (drop "still an open question"; Central = EIRP); 83 (−36.9 / 20.5 → −42.4 / 15.0); 89 (relabel equation: G_client + off-lobe = RSSI − EIRP + L = −15.0 dB); 91 (+5.5 → 0; dBi → dB; twenty and a half → fifteen); 97 (seven → nine percent); 151 (Twenty and a half → Fifteen); 156 (20 dB / 7% → 15 dB / 9%); 158 (mistake #4 → antenna double count); 135/137/141 optional door-CI and ITU-version fixes; audit appendix 178 (25 dBm EIRP), 181 (EIRP 25), 182 (−42.4), 185 (15.0), 186-187 (relabel −15.0 / −13.6), 202 (≤1.4), 205 (P.2040 version). Diagrams at 19, 29, 85, 93 change with the assets below.

### 7e. Video (master = VO timeline; beat windows from actual VO durations)
Beat windows: B1 0:00.0–0:40.3 · B2 0:40.3–2:08.6 · B3 2:08.6–3:26.0 · B4 3:26.0–4:48.0 · B5 4:48.0–6:12.4 · B6 6:12.4–7:11.8 · B7 7:11.8–8:30.0 · B8 8:30.0–9:06.3

**Voiceover lines that must change** (timestamps from speech-to-text of `lesson03-vo-full.mp3`):
| Beat | Time | Current VO | Change |
|---|---|---|---|
| 1 | 0:05.6–0:09.6 | "The link budget said my laptop should see minus thirty seven." | "minus forty two" |
| 1 | 0:11.3–0:14.3 | "Twenty and a half decibels, gone." | "Fifteen decibels" |
| 1 | 0:17.4–0:21.3 | "A twenty five dBm radio and a laptop" | optional: "twenty five dBm of EIRP" |
| 1 | 0:30.0–0:35.7 | "see where the twenty decibels went" | "fifteen" |
| 2 | 0:58.9–1:17.0 | "Transmit power first ... Aruba Central printed twenty five dBm for this radio. Hold that thought..." | state it's EIRP, not transmit power |
| 4 | 3:30.3–3:47.4 | "Twenty five dBm conducted, plus five point five dBi ... thirty point five dBm of EIRP ... minus thirty six point nine dBm at the laptop." | "25 dBm of EIRP ... minus forty two point four" (30.5 as the named double count) |
| 4 | 3:53.5–4:13.1 | Juniper per-chain passage | OK. Add the Aruba EIRP half of the promised payoff here |
| 5 | 4:59.8–5:10.5 | "predicted minus thirty six point nine, measured minus fifty seven point four, twenty and a half decibels" | "minus forty two point four ... fifteen decibels" |
| 5 | 5:18.9–5:34.8 | "Antenna gain equals RSSI, minus transmit power, plus path loss ... minus fifteen dBi." | relabel: "client antenna plus off-lobe loss equals RSSI minus EIRP plus path loss ... minus fifteen dB" (arithmetic unchanged) |
| 5 | 5:34.8–5:37.9 | "I had put plus five point five in that slot." | "I had put zero in that slot." |
| 5 | 5:37.9–5:46.3 | "The real answer was minus fifteen. Twenty and a half decibels of difference" | "Fifteen decibels of difference" |
| 5 | 6:04.2–6:08.8 | "About seven percent of the gap" | "About nine percent" |
| 8 | 8:55.9–8:58.4 | "Twenty and a half decibels." | "Fifteen decibels." |
Optional, not verdict-driven: B6 6:42.6–6:47.5 "The five point five dBi was real" (fine, could add "already inside Central's 25"); B7 7:39.7–7:44.2 "at most one point two dB" (t-based ≈1.4); B7 7:59.9–8:12.5 ITU glass 1.3 (OK; version fix is on screen only); B7 7:12.1–7:26.6 should mention this run was the Juniper on channel 36.

**On-screen assets that carry the wrong numbers** (clip start times in the master):
| Time | Asset / id | Current text | Change |
|---|---|---|---|
| 0:00.0–0:40.3 (B1 hold) | 03-predicted-vs-measured, finished | "25 dBm conducted", "+5.5 dBi", "EIRP 30.5 dBm", "−36.9", "20.5 dB unaccounted for" | 25 dBm EIRP, no +5.5 step, −42.4, 15.0 |
| 0:45.6–2:08.6 (B2) | 01-four-terms `#term-1` | "P tx 25 dBm Conducted power" | "25 dBm EIRP (P tx + G ap)" |
| 1:52.0–2:08.6 (B2) | `#term-result` | "= 25 + 5.5 + G cl − 67.4" | "= 25 + G cl − 67.4" |
| 3:28.2–4:11.0 (B4) | 03 `#level-1`…`#level-3` | 25 conducted / +5.5 / 30.5 / −36.9 | 25 EIRP / −67.4 / −42.4 |
| 4:47.9–5:17.5 (B5) | 03 `#level-4`, `#delta-gap` | "20.5 dB unaccounted for" | 15.0 dB |
| 5:17.5–6:12.3 (B5) | 04-antenna-term | `#gain-assumed` +5.5 dBi (5:20.2), `#gain-delta` 20.5 (5:33.2), `#gain-solved` −15.0 dBi (5:46.3), `#breakdown` "WHERE THE 20.5 dB WENT, 19.1 + 1.4" (5:59.3) | assumed 0, delta 15.0, solved −15.0 dB (relabelled), breakdown 13.6 + 1.4 = 15.0 |
| 8:29.9–8:46.2 (B8) | 03 finished | same as B1 | same as B1 |
| 6:12.3–6:36.1 (B6) | `ap34-on-shelf.jpg` | shows the Juniper AP34 while the VO describes the AP-735 | use `room-view-a.jpg` or an AP-735 shot |
| 8:16.9–8:29.9 (B7 `#verdict`; Fresnel diagram from 7:35.2) | 05-fresnel-door | "ITU-R P.2040 says 1.3 dB", "under 1.2 dB 95% upper bound" | optional: version label; ≤1.4 with t |

Planned 9:16 teaser (beats 1, 5, 7) inherits every B1 and B5 change.

---

## 8. Computation log
Script: `/workspace/nfn-review/lesson3-recheck-calc.py` (FSPL, Fresnel, ITU slab loss with both P.2040 parameter sets, budget table, door/lid statistics). VO transcript with timestamps: `/workspace/nfn-review/lesson3-vo-transcript.txt`. ITU PDFs checked: R-REC-P.2040-1-201507 (glass 6.27 / 0 / 0.0043 / 1.1925) and R-REC-P.2040-3-202308 (glass 6.31 / 0 / 0.0036 / 1.3394), both from itu.int.
