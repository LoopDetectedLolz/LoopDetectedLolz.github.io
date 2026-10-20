# Network Field Notes: first-read review and technical edit

Site: https://networkfieldnotes.com (www redirects to the apex)
Reviewed: Monday Sep 28, 2026, about 3:15 to 4:30 PM ET
Reviewer stance: first-time reader and technical editor. Nothing on the site was changed, posted, or submitted.

## Scope and method

- Crawled every URL in `/sitemap.xml`: 42 HTML pages (11 top-level pages plus 31 posts and lessons). Also fetched `/robots.txt`, `/sitemap.xml`, `/feed.xml`, `/rss.xml` (identical to feed.xml, 31 items) and `/atom.xml` (404, but nothing links to it, so no problem).
- The site is static HTML (GitHub Pages behind Cloudflare and Fastly). No JavaScript is needed for the text, so I parsed the raw HTML with BeautifulSoup and read the full text of all 12 lessons and 19 field notes.
- Link check covered every `<a>`, `<img>`, `<link>`, `<script>`, `<video>` and `og:image` URL: 105 unique URLs plus 23 media and asset files. Everything returns 200 except the items listed under (c). LinkedIn's 999 is its normal anti-bot reply.
- Scans for em and en dashes (U+2014, U+2013, `&mdash;`, `&ndash;`, and escaped forms in HTML, attributes, scripts and the RSS feed), placeholder and TODO text, stock phrases, customer names, and contact or CTA copy.
- Rendered pages in headless Chrome (Playwright) at 1280x800 and 390x844 (mobile, DPR 2). Screenshots are in `/workspace/nfn-review/screenshots/`: home, lesson 3, PMF post, academy and socials, each as a viewport shot and a `-full` full-page shot for both desktop and mobile. `render-report.json` holds console errors and failed requests.
- Checked the suspicious claims against vendor docs and standards (sources inline).
- What I could not fully cover: the large interactive tools (`tools.html` 720 KB, `sandbox.html`, `cx-check`, `cx-build`, and the long reference pages `cx-notes`/`cx-guide`, about 5,700 to 5,900 words each) were only skimmed for prose, not audited command by command. The headless browser reported "No available adapters" (no WebGPU), so any GPU-dependent animation may render differently than on a real device. The comment and Q&A backends were offline, so I could not test them.

Severity key: **S1** = wrong or contradictory fact a reader would act on, or an owner rule broken site-wide. **S2** = visible inconsistency or broken feature. **S3** = polish.

---

## (a) First impression as a new reader

- **What it is.** Within a few seconds it's clear this is a hands-on Wi-Fi, NAC and campus-switching notebook by a working engineer. The homepage shows the latest post, a category filter and a card grid. The About page is short and credible. The writing is concrete, with real numbers, CLI and API, and it's strongly opinionated in a good way. The Academy is the standout: the arithmetic is right almost everywhere I checked.
- **Who it's for.** Working network engineers. There's no explanation for true beginners (EIRP, PMF, OKC and DFS appear unexplained on the homepage cards). That fits the audience, but the homepage never says who the site is for; the only framing is the footer line "Field notes, not a newsletter".
- **What feels off on first visit:**
  1. The owner's notes describe the homepage banner as an interactive Wi-Fi visualizer. It isn't on the homepage any more; it lives at `/simulator.html`, which has **no nav tab** (the nav is Posts, Academy, Tools, About). Only Tools, lesson 1 and the banner post link to it.
  2. The Rig mascot floats over content. On desktop it covers the NAC card title ("…Won't Tell You Why…"). On mobile it covers the "Wireless 11" filter pill and later sits on top of body text in lesson 3 ("people walk through the p…"). See `home-desktop.png`, `home-mobile.png`, `lesson03-mobile.png`.
  3. Every post ends with a comment form asking for name and email and saying "Comments are offline at the moment." Every lesson ends with an "Ask about this lesson" form that says "Questions are offline at the moment." That's a visible broken feature on 31 pages, and it also conflicts with the no-reader-contact rule (see (d)).
  4. Categories are fragmented: 4 of the 8 filters (RADIUS, RF survey, Switching, Docs) hold one post each and are uncolored grey.
  5. Two homepage cards say almost the same thing. "Your Wi-Fi Takes Turns…" (hero plus card) and Lesson 5's blurb share the same sentence about 1201 Mb/s and 55 Mb/s.

---

## (b) Factual and technical issues (highest priority)

### b1. Confirmed errors and contradictions

**B1-1 (S1). Lesson 3 as published contradicts the owner's locked facts.**
URL: https://networkfieldnotes.com/p/academy-03-the-link-budget.html (published, dated Sep 22 in the sitemap, and "12 of 12 published").

| Locked fact | Published lesson says |
|---|---|
| EIRP 30.5 dBm (25 dBm + 5.5 dBi) | "My first instinct was to add the 5.5 dBi … and call it 30.5 dBm of EIRP. That's counting the antenna twice. Aruba's number already has it in." It uses **EIRP 25 dBm**. |
| Predicted -36.9 dBm | "25 dBm of EIRP minus 67.4 dB of path loss predicts **-42.4 dBm**" |
| Gap 20.5 dB | "That's **15.0 dB**" and "I was off by fifteen decibels". The homepage and Academy blurbs also say "came up fifteen decibels short". |
| Solved antenna term -15.0 dBi | "client antenna + off-lobe loss = -57.4 - 25 + 67.4 = **-15.0 dB**". Same number, but it now means something different: a loss on top of an EIRP that already includes +5.5 dBi. |
| Door at most 1.2 dB, first Fresnel zone 25.6 in, door 36 in, ITU glass ~1.3 dB | **Absent.** The page has no door, Fresnel or glass section. The homepage blurb now says "with nothing in the way". |
| Measured -57.4, FSPL 67.4 at 9.7536 m / 5745 MHz, lid 1.4 dB | Match. FSPL arithmetic checks out: 19.78 + 75.19 - 27.55 = 67.4. |

Editor's note: the published reasoning is the one the vendor datasheet supports. The HPE 730 Series QuickSpecs give "+21 dBm (18 dBm per chain)" conducted max per band, which excludes antenna gain, and 5.5 dBi peak at 5 GHz with 30 to 40° downtilt (https://www.hpe.com/us/en/collaterals/collateral.a50009206enw.html). So an AP-735 cannot put out 25 dBm conducted, and Central's 25 must be EIRP. **The locked-facts sheet looks out of date, not the page.** The owner should decide which is canonical and update the other. One optional precision point for the page: the same datasheet gives a *combined average-pattern* peak of 4.1 dBi at 5 GHz, below the 5.5 dBi single-element peak.

**B1-2 (S1). Lesson 11 refers to a lesson 3 experiment that no longer exists.**
URL: https://networkfieldnotes.com/p/academy-11-surveys-and-what-a-heatmap-cant-see.html
Quote: "lesson 3 was an hour of me finding that a glass door I'd have put down at a few dB measured nothing."
Problem: lesson 3 has no glass door (see B1-1). Also: "lesson 3 found 15 dB between the model and a laptop on a shelf". In lesson 3 the *AP* was on the shelf and the laptop was 32 ft away.
Fix: restore the door section to lesson 3, or rewrite both sentences, for example "lesson 3 found 15 dB between the model and a laptop 32 feet from an AP lying on a shelf."

**B1-3 (S1). Beacon airtime numbers disagree between lesson 5 and lesson 10, though both say they use the same 250-byte model.**
- Lesson 5 (https://networkfieldnotes.com/p/academy-05-airtime-is-the-only-resource.html): "The model costs a beacon at 250 bytes… At 6 Mb/s that's 396 microseconds" and "On 2.4 GHz at the 1 Mb/s default a beacon takes 2,416 microseconds, and eight SSIDs cost 19 percent".
- Lesson 10 (https://networkfieldnotes.com/p/academy-10-capacity-not-coverage.html): "call it 250, the figure the site's own airtime code and lesson 5 use", then "at 1 Mb/s: 2000 us + 192 us = 2192 us … 2.2 percent" and "at 6 Mb/s: 333 us + 20 us = 353 us". At 12 Mb/s it gives 187 µs; lesson 5's model implies about 208 µs.
- Why: lesson 5 counts a 250-byte body plus 24-byte header plus 4-byte FCS (278 bytes, which reproduces 396 and 2,416 exactly). Lesson 10 counts 250 bytes flat and drops OFDM service/tail bits. Lesson 10 says it ignores "OFDM symbol padding", but the 224 µs difference at 1 Mb/s is the header and FCS, not padding.
- Fix: in lesson 10 use 278 bytes on air (2,416 / 396 / 208 / 116 µs) so the per-SSID shares match lesson 5, or say plainly that lesson 10 uses a rougher approximation. The six-SSID 13.2 percent figure would become about 14.2 percent.

**B1-4 (S1). The Academy index says the lesson 4 lab reads MCS; lesson 4 says MCS isn't shown anywhere.**
- https://networkfieldnotes.com/academy.html, lesson 4 lab card: "Read MCS in the Central and Mist client views, force a lower rate, measure throughput."
- Lesson 4 text: "Neither platform shows the MCS index. As of September 2026, Central's client page has no MCS field and the Mist client stats API has no MCS field."
- Fix: change the card to "Read the PHY rate in Central and Mist, work out the MCS from the table, then cap the rate and measure throughput."

**B1-5 (S2). Lesson 9's frame-count ratio doesn't match its own table.**
URL: https://networkfieldnotes.com/p/academy-09-roaming-the-client-decides.html
Quote: "half the frames of a PSK roam, a seventh of an EAP-TLS one" next to the table row "standard roam, EAP: … EAP-TLS (a dozen and up) + 4-way 4 = 20 or more".
Problem: 4 out of 20 is a fifth. "A seventh" only works with lesson 8's N = 8 count (20 EAP frames, so 28 in total).
Fix: say "a fifth or less of an EAP-TLS one", or put lesson 8's figure in the table ("= 28 with lesson 8's N = 8").

**B1-6 (S2). Lesson 12 gives the wrong RF prediction for the cabinet option.**
URL: https://networkfieldnotes.com/p/academy-12-a-troubleshooting-method.html
Quote: "Break RF. Put the laptop behind the cabinet or run the microwave on the 2.4 GHz radio… Prediction first: RSSI holds within a few dB, SNR collapses, retries climb".
Problem: a metal cabinet attenuates the signal. RSSI drops and SNR drops by the same amount while the noise floor stays put. "RSSI holds, SNR collapses" is only true for the microwave, as lesson 7 teaches.
Fix: split the prediction. Cabinet: RSSI and SNR both fall, floor unchanged. Microwave: RSSI holds, floor rises, SNR falls.

**B1-7 (S2). The "84 percent" headline says airtime; the post measures frames on a wired uplink.**
URL: https://networkfieldnotes.com/p/mdns-bridge-mode-airtime.html
Title: "84 Percent of Your Airtime Is Printers Saying Hello". Body: "by his count 84 percent of the frames crossing the link". The post's own airtime maths then gives "Forty percent of the channel gone". Lesson 5 and the Wi-Fi Takes Turns post also say "about 40 percent of a channel". The body also blames laptops at boot, not only printers.
Fix: retitle, for example "84 Percent of the Frames on Your AP's Uplink Are Devices Saying Hello" or "40 Percent of Your Airtime Is mDNS". The homepage card ("84 percent of an uplink") is already accurate.

**B1-8 (S2). The PoE widget mixes switch-side and AP-side watts.**
URL: https://networkfieldnotes.com/p/poe-budgets-wifi7-aps.html
Widget caption: "Numbers are per-port PSE allocation from the post". The options are `802.3af, 15.4 W` (PSE), `802.3at, 30 W` (PSE), `802.3bt Class 6, 51 W` (this is the **PD** figure).
Problem: Class 6 PSE allocation is 60 W, as the post itself says ("Class 6 is 60W at the port and 51W to the device"), so the widget under-counts bt APs by 9 W each.
Fix: change the Class 6 option to 60 W, or relabel all three options as PD power (13 / 25.5 / 51).

**B1-9 (S2). Homepage card source labels contradict the posts.**
- "Your AP Is Not Moving That Client" is labeled "Airheads thread" on the homepage. The post says: "A Reddit thread about a phone that would not reconnect after an elevator ride".
- "Converting a Mesh Over the Air Strands Every Point" is labeled "Airheads thread". The post says: "Somebody on Reddit was moving a mesh network to Central".
- Fix: add a "Reddit thread" source label, or use a neutral "Forum thread".

**B1-10 (S2). Wrong series label.**
"One Pilot AP Converts All Hundred of Them" is part 2 of the series "Moving to AOS 10", but the post is about converting Instant APs to AOS 8 Campus APs under a Mobility Conductor. Nothing in it touches AOS 10.
Fix: rename the series (for example "Migrations, carefully") or move this post out of it.

**B1-11 (S2). The banner post is stale about where the banner is.**
URL: https://networkfieldnotes.com/p/how-the-banner-works.html
- Title: "The Banner Is a Wi-Fi Link You Can Break". Homepage and meta description: "The animation at the top of this site sends a real frame…". The post body: "The simulator, which used to live at the top of the front page and now has its own tab".
- Problems: it isn't at the top of the site any more, and there is no Simulator tab in the nav. The page also embeds a video "Recorded 10 September 2026" with a corrections paragraph ("the 121 on screen"), so the video contradicts the text.
- Fix: add Simulator to the nav or say "now lives on the Tools page". Update the title, blurb and meta description ("The Simulator Is a Wi-Fi Link You Can Break"). Re-record or caption the video.

**B1-12 (S3). Lesson 1 forward references don't match lesson 2.**
Lesson 1: "walls will make the numbers lie and that's next lesson's problem" and "Your room will read lower than these and the steps will be bigger, which is next week's lesson". Lesson 2 covers bands, channels and widths, not walls or multipath.
Fix: point these at lesson 3 (link budget) or lesson 11 (surveys).

**B1-13 (S3). Dangling reference in the docs post.**
URL: https://networkfieldnotes.com/p/when-the-docs-disagree.html
Quote: "(The 120 minute ceiling on that timer, on the other hand, is documented right on the command page. That one you can just cite.)"
Problem: "that timer" is never introduced. The value is correct: `allow-non-failsafe-updates` takes minutes, with a maximum of 120 (https://arubanetworking.hpe.com/techdocs/AOS-CX/10.17/HTML/fundamentals_8400/Content/SysHW_cmds/allow-unsafe-updates.htm).
Fix: "The command takes a timeout in minutes, and its 120-minute ceiling is documented…"

**B1-14 (S3). Reader-question references don't match the Q&A widgets.**
Lesson 5: "Somebody asked under lesson 2 whether adding APs…". Lesson 6: "A reader asked under lesson 2, on LinkedIn." Lesson 2's Q&A block says "No questions on this lesson yet." A reader will be confused about where the question was asked.
Fix: say "asked on LinkedIn" in lesson 5 too, or drop the "under lesson 2".

### b2. Checked and correct (so the owner knows what was verified)

- Lesson 1: wavelengths; the 6 dB FSPL frequency term; the 6 GHz LPI 5 dBm/MHz PSD giving 18 dBm at 20 MHz and 30 dBm at 320 MHz; the dBm anchors.
- Lesson 2: 25 classic 5 GHz channels; U-NII-4 adding a 7th 80 MHz channel and a 3rd 160 MHz channel (149 to 177, the only non-DFS 160); 30-minute DFS non-occupancy; 59 and 7 channels at 6 GHz; every HE PHY rate in the table (286.8, 516.2, 960.8, 137.6, 206.5, 288.2).
- Lesson 4: 234/980/3920 data subcarriers; 1201 / 720.6 / 72 / 5764.7 Mb/s; 802.11ax minimum sensitivity of -82 to -52 dBm.
- Lesson 5: EDCA AIFS values (34, 43, 79, 25 µs), CWmin/CWmax including AP BE CWmax 63, retry limit 7, 55 and 877 Mb/s, all the beacon percentages, and the default mapping of DSCP 46 to UP 5 (video) plus RFC 8325.
- Lesson 6: CCA thresholds of -82 and -62 dBm; the VHT80 spectral mask (-20/-28/-40 dBr at 41/80/120 MHz); 12 pairs at 40 MHz and 6 channels at 80 MHz; 458.8 Mb/s.
- Lesson 7: -174 dBm/Hz and the -101/-98/-95/-92 floors; MCS 7 at 86 Mb/s; MCS 3 at 34.4 Mb/s.
- Lesson 8: SAE's 4 frames, status code 43, PBKDF2 with 4,096 iterations, and the 18 + 2N frame count.
- Lesson 9: Apple roam thresholds; Mist Roaming SLE limits of 400 ms for 11r and 2 s for standard/OKC (https://www.juniper.net/documentation/us/en/software/mist/mist-wireless/shared-content/topics/topic-map/wireless-sle.html).
- Lesson 10: Teams and Zoom bitrates; 8 dB between 6 and 24 Mb/s; the 40 percent and 55 to 60 percent edge figures.
- Lesson 11: Ekahau's 105 ms fixed dwell (https://support.ekahau.com/hc/en-us/articles/41571673109521-Default-Channel-Scan-Time); Sidekick 2 has 4 tri-band radios, 9 antennas, 50 sweeps/s, 19 kHz resolution and a -92 dBm floor (https://www.ekahau.com/wp-content/uploads/2022/07/EKH_Sidekick-2_Datasheet.pdf).
- Lesson 3: Mist power is per chain, TPO = per-chain power + 10log(chains) (https://www.juniper.net/documentation/us/en/software/mist/mist-wireless/topics/ref/mist-power-notation.html).
- PMF post: status codes 30 and 31; SA Query 1000 TU; BIGTK in 802.11-2020; WPA3 v3.4 Compatibility Mode and RSN Override (https://www.wi-fi.org/system/files/WPA3%20Specification%20v3.4.pdf).
- RADIUS post: RFC 2865 silent discard; RFC 3579 Message-Authenticator; CX, AOS-Switch and Junos syntax look right.
- mDNS post: every group, MAC and port number, and the 525/325/225 µs and 40/25/17 percent maths.
- ClearPass SNMP post: CX control-plane ACL and SNMPv3 syntax.
- AOS 8 to 10 post: `ap convert` options, max-downloads default 10, and the common.cloud.hpe.com path (https://arubanetworking.hpe.com/techdocs/CLI-Bank/Content/aos8/ap-convt.htm).
- PoE post: 802.3af/at/bt class figures.
- No em or en dashes anywhere, including feeds, attributes and scripts.

### b3. Worth checking (not confident enough to call wrong)

1. **Lesson 2**: "Standard power, which is also the only way to go outdoors". Since the FCC's Dec 2024 order (FCC 24-125), VLP devices may operate outdoors across the whole 6 GHz band, but not as fixed outdoor infrastructure (https://docs.fcc.gov/public/attachments/FCC-24-125A1.pdf). Suggest: "the only way to run a fixed outdoor AP".
2. **Lesson 1**: "30 dBm is 1 W. In the US that's the FCC ceiling for an AP at 2.4 GHz and in U-NII-1 and U-NII-3, while U-NII-2A and 2C cap you at 24 dBm." Those are *conducted* limits; EIRP can be higher with antenna gain (for example 36 dBm with a 6 dBi omni). The next sentence switches to EIRP for 6 GHz. Suggest saying "conducted" to avoid the conducted/EIRP confusion that lesson 3 is all about.
3. **Channel 173 post and lesson 2 band graphic**: "Channels 169, 173 and 177 live in that last sliver, 5850 to 5895 MHz." At 20 MHz, channel 169 (centre 5845) spans 5835 to 5855, so it straddles the U-NII-3/U-NII-4 edge.
4. **Channel 173 post**: "A Wi-Fi 6E laptop from the last couple of years is fine" for U-NII-4. Support depends on the chipset, driver and regulatory settings, not on 6E itself.
5. **PoE post**: "the 755 needs Class 6 (51W) to run unrestricted, and at Class 5 it's still in restricted mode" next to "(the 750 Series datasheet says 40W or 51W)". Check the exact AP-755 power table. Also "Class 8 is only on specific 6300M SKUs such as the R8S90A": confirm the SKU.
6. **Lesson 4**: "A Tx rate of 6, 12 or 24 Mbps at 3 m can only be a legacy 802.11a rate… check the client is … on 5 GHz, not the 2.4 GHz radio". On 2.4 GHz those same numbers are 802.11g OFDM rates, so the band hint is muddled. Suggest "a legacy OFDM rate (11a on 5 GHz, 11g on 2.4 GHz)". Also, 866.7 Mb/s for VHT MCS 9 80 MHz 2SS assumes the 400 ns short GI; with 800 ns it's 780.
7. **Lesson 11**: "A doorway that shows -67 on one sample could be -65 or -69, and that's two MCS rungs." With the site's own SNR floors (about 4 dB per rung), ±2 dB is roughly one rung.
8. **One Pilot post**: "A 9012 tops out at 64 campus or remote APs on AOS 8.12 and later, and 32 below that". Confirm against the 9000-series datasheet.
9. **Lesson 6, lab step 6**: "a shoulder of energy on the Sidekick above 5250 MHz leaking into your block". The leakage into 5170 to 5250 shows up *below* 5250.
10. **Lesson 9**: "Central flags a roam as high latency past 50 ms", and **lesson 7**: "Signal Quality … Poor at 0 to 20, Fair at 21 to 35 and Good above 35". Both are plausible but I couldn't find them in public docs.

---

## (c) Broken things

| # | Sev | Where | What | Fix |
|---|---|---|---|---|
| C1 | S2 | All 19 field notes | Comment form (Name, "Email, kept private", Comment, Post comment) with "Comments are offline at the moment." | Remove it (see D2), or hide it while the backend is down. |
| C2 | S2 | All 12 lessons | "Ask about this lesson" form with "Questions are offline at the moment." | Same. |
| C3 | S2 | `/socials.html` and `/cx-guide.html` | Cloudflare **Email Obfuscation** rewrites anything shaped like an email into `<a href="/cdn-cgi/l/email-protection…">[email protected]</a>`. On Socials that's `dustin.burns@networkfieldnotes.com`. On cx-guide it's the SSH algorithm names inside a `<pre>` config block (`aes256-gcm@openssh.com`, `aes128-gcm@openssh.com`, `hmac-sha2-512-etm@openssh.com`, `hmac-sha2-256-etm@openssh.com`). Readers with JS off, RSS or reader mode, some copy-paste paths and crawlers see `[email protected]` in the middle of an `ssh ciphers` line. The fallback href `/cdn-cgi/l/email-protection` returns **404**. | Turn off Scrape Shield > Email Address Obfuscation in Cloudflare, or wrap the block in `<!--email_off-->…<!--/email_off-->`. |
| C4 | S2 | Nav | The simulator page, which the banner post says "now has its own tab", isn't in the nav. | Add a Simulator pill or fix the copy (B1-11). |
| C5 | S3 | `/p/academy-04-modulation-and-data-rates.html` | "That's what `mist-rates.py` in the repo does" links to no repo. The reader can't find it. | Link the script or inline it. |
| C6 | S3 | Post pages | Cloudflare Turnstile loads on every post for the dead comment form. The console shows 401s from challenges.cloudflare.com and a failed DNS lookup of `brunhild.challenges.cloudflare.com`, plus a few `%c%d` console errors from the Turnstile script. Readers don't see it, but it's extra weight and noise. | Drop Turnstile along with the forms. |
| C7 | OK | Site-wide | No 404s among internal links, images, OG images, favicons, video or poster files. No lorem, TODO, TBD or FIXME. The one "lorem ipsum" hit is deliberate copy in the banner post. | None needed. |

---

## (d) Owner-rule violations

**D1 (S1). Email on the Socials page.** https://networkfieldnotes.com/socials.html says "Three places worth your time." and lists LinkedIn, HPE Airheads **and "Email [email protected]"** (it decodes to `dustin.burns@networkfieldnotes.com`). The rule is LinkedIn and Airheads only.
Fix: remove the Email card and change "Three places" to "Two places".

**D2 (S1). Reader-contact copy on every post and lesson.**
- Posts: "Nothing here yet. If you have run into this, or I have it wrong, say so." / "Email, kept private" / "Your email, if you leave one, is stored so I can reply to you…"
- Lessons: "Questions show up here once I've answered them. Add a name if you want it shown."
- Academy index: "Continue on another device… A code copies it to my server".
The first two are reader-contact copy, and the post form collects email. The progress-sync one is borderline, since it's a feature and not contact.
Fix: remove the comment and Q&A blocks site-wide, or get an explicit owner exception.

**D3 (S3). Reader contact mentioned in lesson text.** Lesson 6 says "A reader asked under lesson 2, on LinkedIn." This names a channel but isn't a link or an invitation. Probably fine; flagged so the owner can decide.

**Checked and clean:**
- **Em and en dashes**: none found anywhere (HTML, attributes, inline scripts, feed.xml, rss.xml). The only double hyphens are `-- Revoked` and `-- Unspecified` inside openssl output on the Intune post, which is correct as shown.
- **Named customers**: none. The About page names the owner's employer ("at WEI"), which is presumably intended. Engagement posts (Channel 173, PMF "printers in receiving") are anonymous.
- **Email or LinkedIn links on posts**: none. The only LinkedIn link is on Socials.
- **CTAs and subscribe plates**: none. "Read the writeup" and "Start with lesson 1" are navigation buttons. The footer says "Field notes, not a newsletter". The RSS `<link rel=alternate>` is fine.

---

## (e) Weirdness, UX and copy

**Layout and design**
- E1 (S2): The Rig mascot overlaps content on desktop and mobile (see (a)). Give it a safe inset, hide it under about 600 px, or let it dock into the footer.
- E2 (S2): On mobile, the lesson 3 hero figure (the "What the screen says / What it means / What the air sees" table) is an image whose text is unreadable at 390 px (`lesson03-mobile.png`). Use an HTML table or a taller mobile version.
- E3 (S3): Homepage Academy ordering is by date, so same-day lessons appear out of order: 12, 10, 11, 8, 9, 7, 6… Sort by lesson number within a date.
- E4 (S3): Category taxonomy. RADIUS (1 post, really NAC), RF survey (1, really Wireless), Docs (1, really Switching) and Switching (1) are grey one-post buckets beside the colored four. Fold them into NAC, Wireless and Switching, or give them colors.
- E5 (S3): Colors are consistent with the kit. Wireless is #8CE05E (green), NAC #2FA8E0 (blue), Lab #F0705F (red), Academy #F5A524 (orange), and the active nav pill is orange. No mismatch found.
- E6 (S3): The **Zero to NAC** track only appears as a lab picker inside `/sandbox.html` ("Zero to NAC 1: the bench … 6: precedence, fallback and CoA"). The Academy page doesn't present it as a second track, and there's no NAC-blue section. If it's meant to be a visible track, it's missing from the Academy index.
- E7 (S3): Page weight. Every page inlines about 44 to 47 KB of CSS and 14 to 21 KB of JS, so the About page is 64 KB of HTML for 215 words. The tool pages are 440 to 720 KB of HTML. Extracting a shared cached `site.css` would help repeat visits. Load times were fine (under 0.8 s here).
- E8 (S3): Mobile has no horizontal overflow on any rendered page (scrollWidth = 390). The nav wraps cleanly.

**Metadata**
- E9 (S3): Post `<title>`s lack the site name ("The Link Budget"), while top-level pages have it ("Academy · Network Field Notes"). Add " · Network Field Notes" to posts.
- E10 (S3): Meta descriptions run 174 to 355 characters on 40 pages (Google truncates at about 155 to 160). About (39) and Socials (34) are too short. OG tags, OG images, favicon SVG and PNG, apple-touch-icon and `lang="en"` are present everywhere.
- E11 (S3): Decorative images (logo, Rig SVGs) correctly use `alt=""`. Content images on lessons 1 and 3 have good descriptive alt text.

**Copy and grammar**
- E12 (S2): **Hyphens have been stripped from compound modifiers**, probably overcorrecting the no-dash rule. Hyphens aren't dashes. Examples: "pre auth role", "post back", "sign in screen", "self signed", "Central managed Instant cluster", "AP side cert", "sub resource", "as built" (captive portal post); "thirty two feet" (lesson 3, homepage, Academy); "Twenty five channels", "fifty nine 20 MHz channels", "20 MHz only device", "per AP override" (lesson 2); "1500 byte frames" (lesson 2); "two node cluster", "control plane ACL", "cluster wide behaviour" (ClearPass SNMP post); "72 character portal page name" (portal post); "ten minute timeout" (AP post). The site still uses hyphens elsewhere ("co-channel", "dual-band", "least-significant", "AP-on-a-stick"), so it reads as inconsistent rather than a style. Fix: restore hyphens in compound modifiers.
- E13 (S3): Mixed British and American spelling within and across pages: neighbours, metres, centre, optimised, utilisation, colour, practise, aluminium, analyser, car park, behaviour versus utilization, authorizing, optimization, color. For example, lesson 5 has "utilization" in prose and "utilisation" in lesson 11 prose. Pick one (probably US, given a New England author and US vendor UI labels) and normalize everything outside UI labels.
- E14 (S3): Tone shifts. The Sep 13 to 17 posts (AP Not Moving, Portal Page Name, ClearPass SNMP, Mesh) avoid contractions ("It was not the publisher", "The AP is not the one…") and read stiffer than the rest of the site.
- E15 (S3): Odd phrasing in the PoE post: "The switch IS bt-capable" (shouting caps) and "If the closet is at-era" (meaning 802.3at-era).
- E16 (S3): "Ask me how I know" appears on 3 pages (lesson 3, the Intune lab, the banner post). It's a nice nod to the old name, but it's the kind of repeated signature line readers start to notice.

**AI-sounding patterns (the owner wants to avoid these)**
- The biggest tell is **repetition of the same quips and structures across posts**, not individual word choice. None of the classic LLM words ("delve", "tapestry", "In today's…") appear.
  - "computers are very patient" appears 4 times (lessons 6, 7, 8, 12).
  - "It's always a laptop / printer / the appliance somebody installed in a hurry" appears 4 or more times (lessons 6, 9, 10, 12, VSX).
  - "X isn't broken" / "Nothing's broken" / "Not broken. Literal." / "Not broken, full." appears 12 times (homepage, lessons 4, 5, 10, RADIUS, captive portal, PoE twice, AOS 8 to 10, Channel 173).
  - "That's the whole [lesson/thing/post/design/pitch/answer]" appears about 15 times; "which is the whole lesson" 3 times.
  - "Here's the part [nobody says out loud / that surprises people / I think people skip / that bugs me]" appears 4 times.
  - "since you'll be asked" appears twice.
  - "…, and I'll flag it as mine rather than [HPE's/Apple's/the vendor's]" appears 3 times; "The honest …" / "One honest caveat" / "the honest table" / "the honest line" 9 times.
  - Staccato fragment endings: "Not the signal. The gap." / "Not weaker. Gone." / "Not a risk. An outage."
  - "as of September 2026" appears 13 times across the lessons; "I haven't checked on a box yet" 4 times. These are honest, but the repetition reads machine-regular. Consolidate into one "What I haven't verified" note per lesson.
- Every forum-derived post uses the same template: "Where this came from" / "Why I'm writing this" / "What good looks like" / "Test it or it doesn't count" / "Checklist" / "Bottom line" (Bottom line appears 15 times). It's fine as house style, but with the repeated quips it reads formulaic. Vary a few headings.
- Suggested pass: keep each signature line once, in the post where it lands hardest, and rewrite the rest.

**Unverified numbers in the lab sections**
- Lessons 2, 4, 5, 7, 8, 9 and 12 all say their "What you should see" numbers are model output: "When I have run this lab on my own AP I will replace them with measured figures", "Model expectations, labelled that way until I've run this on my own bench". That's honest, but it's effectively a standing to-do across 7 lessons that are marked "12 of 12 published". Consider a visible "model, not measured yet" badge, or run the labs.

---

## (f) Nice-to-haves

1. Add a one-line "who this is for" under the homepage hero, for example "Wi-Fi, NAC and campus switching notes for engineers who run the network."
2. Make the Simulator a nav pill, and give the Academy page a Zero to NAC section in NAC blue if that track is meant to be discoverable.
3. Give lessons a small "Measured" or "Model" pill for the lab-expectation state.
4. Add a series index page (the "Moving to AOS 10", "ClearPass, properly", "Wi-Fi 7 rollout" and "Switching, carefully" series only exist as homepage cards).
5. In lesson 3, add a one-line note that the AP-735's combined average-pattern peak is 4.1 dBi versus the 5.5 dBi element peak. It strengthens the "you don't get the peak by owning the datasheet" point.
6. Add a `<meta name="theme-color">` to match the dark kit (none present). `prefers-reduced-motion` rules already exist in the CSS; worth confirming they also cover Rig and the background canvas.
7. Extract the inline CSS and JS into cached files.
8. Put "Last reviewed: date" on lessons that cite vendor UI ("as of September 2026") so the date appears once, not 13 times.

---

## Screenshots
`/workspace/nfn-review/screenshots/`
- home-desktop.png, home-desktop-full.png, home-mobile.png, home-mobile-full.png
- lesson03-desktop(.png / -full.png), lesson03-mobile(.png / -full.png)
- pmf-post-desktop(-full), pmf-post-mobile(-full)
- academy-desktop(-full), academy-mobile(-full)
- socials-desktop(-full), socials-mobile(-full)
- render-report.json (console errors, failed requests, scroll widths)

Raw HTML is in `/workspace/nfn-review/raw/pages/`, extracted text in `/workspace/nfn-review/text/`, the link-check output in `linkcheck.json`, and per-page metadata in `meta.json`.
