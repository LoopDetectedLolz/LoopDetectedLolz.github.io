# Self-check answers, lessons 1 to 12

Draft for Dustin's review, 2026-09-28. Nothing here is on the site yet.

Every lesson already ends with a one-line "Answers:" paragraph under its Three questions. These replace it with a
`## Answers` list, which the build turns into the self-check: each answer behind a Show answer reveal, with Got it and
Not yet under it, and the reader's progress card counting the ones they got. Lesson 1's questions are a paragraph today,
so they become a numbered list at the same time. Each answer was written from its own lesson only, and the table under
each lesson says where every claim comes from.

To apply once you're happy (edit the answers here first if you like):

    python3 academy/apply-answers.py --dry-run          # see the change to each post
    python3 academy/apply-answers.py                    # all twelve, or --lessons 1,2,3
    python3 build-blog.py


Review notes on the lessons themselves (a few slips the drafting turned up) are in `audit/academy-answers-review.md`, which stays local.

### Lesson 1: What a Radio Actually Sends
Slug: `academy-01-what-a-radio-actually-sends`

Questions, verbatim from the lesson:
1. Is 100 mW more or less than 23 dBm, and by how much?
2. A client's signal went from -60 to -66 dBm; what happened to the received power?
3. You've moved to four times your original distance from the AP; roughly how much signal did you give up?

Paste into the post, straight after the Three questions list:

## Answers

1. Less, by 3 dB. 100 mW is 20 dBm, one of the anchors, and 23 dBm is 20 plus 3, so it's 200 mW. Rule one says 3 dB is a doubling, so 100 mW is half of it.
2. It dropped to a quarter. Going from -60 to -66 dBm is a plain 6 dB drop, and 6 dB is two 3 dB halvings back to back. Half of a half is a quarter.
3. About 12 dB. Every doubling of distance costs about 6 dB in free space, and four times the distance is two doublings. The free space figure in The lab section shows it: -27 dBm at 2 m and -39 dBm at 8 m. A real room will read lower with bigger steps, and that's not a bad measurement.

Where each answer comes from:

| # | What the answer claims | Lesson section it comes from | Status |
|---|---|---|---|
| 1 | 100 mW is 20 dBm and 23 dBm is 200 mW; 3 dB is a doubling, so 100 mW is 3 dB less, half the power | "The number that matters: dBm" | from the lesson |
| 2 | Two dBm readings compare as a plain dB difference; 6 dB is two 3 dB halvings, so a quarter of the power | "The number that matters: dBm" | from the lesson |
| 3 | About 6 dB per doubling of distance, so about 12 dB for four times; the free space figure reads -27 dBm at 2 m and -39 dBm at 8 m; a real room reads lower with bigger steps | "The number that matters: dBm", "The lab" | from the lesson |

### Lesson 2: Bands, Channels and Widths
Slug: `academy-02-bands-channels-widths`

Questions, verbatim from the lesson:
1. Your site has fourteen APs in one open floor and the customer wants 80 MHz everywhere in 5 GHz. How many non-overlapping channels do you have without DFS, and what is the actual reuse distance you are asking for?
2. An AP on channel 100 stops serving clients for half an hour and then comes back on its own. What happened, and which band would have avoided it?
3. Two APs are on 40 MHz channels that share one 20 MHz half. Is that better or worse than putting them both on the same 40 MHz channel, and why?

Paste into the post, straight after the Three questions list:

## Answers

1. Two: one in U-NII-1 and one in U-NII-3. At 80 MHz the twenty five channels of 5 GHz come down to six, and the other four sit in the 52 to 144 DFS range. Fourteen APs on two channels is seven per channel, so at best you alternate them and the same channel comes back at the next AP but one. That's the reuse distance you're asking for, and it's the lecture hall problem from The number that matters section: one slow network out of a lot of expensive hardware.
2. It heard a radar pattern. Channel 100 is in U-NII-2C, and everything from 52 to 144 is shared with radar, so once the AP hears one there it has to leave the channel and stay off it for thirty minutes. 6 GHz would have avoided it, since there's no DFS anywhere in it, as long as your clients are Wi-Fi 6E or Wi-Fi 7. Inside 5 GHz, U-NII-1 or U-NII-3 would have kept you clear too.
3. Worse. It's the channel 3 mistake from the What you actually have section, just wider: a partial overlap isn't a clever compromise, it's two problems at once, and sharing one channel outright is the lesser evil. In 5 GHz you can't even set it up, because 40 MHz has to sit on a proper pair, so two 40s either line up exactly or don't overlap at all.

Where each answer comes from:

| # | What the answer claims | Lesson section it comes from | Status |
|---|---|---|---|
| 1 | Six 80 MHz channels in 5 GHz, four of them in the 52 to 144 DFS range, so two without DFS, one in U-NII-1 and one in U-NII-3 (worked from the block ranges); fourteen APs on two channels is seven per channel, at best the same channel every second AP; the lecture hall outcome | "What you actually have", "The number that matters" | partly outside the lesson: it never defines reuse distance, so the answer counts it in APs from the channel count rather than giving a distance |
| 2 | Channel 100 is U-NII-2C, inside the DFS range; hearing a radar pattern forces the AP off the channel for thirty minutes; 6 GHz has no DFS but needs Wi-Fi 6E or Wi-Fi 7 clients; U-NII-1 and U-NII-3 avoid DFS too | "What you actually have" | from the lesson |
| 3 | Worse, by the channel 3 reasoning ("two problems at once"); sharing one channel outright is the lesser evil; 40 MHz must sit on a proper pair, so in 5 GHz the setup can't be built | "What you actually have", "Play it, it is faster than reading it" | partly outside the lesson: it never explains why a fully shared channel beats a half-shared one, so the why rests on the channel 3 line by analogy and on the proper pair rule |

### Lesson 3: The Link Budget
Slug: `academy-03-the-link-budget`

Questions, verbatim from the lesson:
1. Central shows a radio at 25 dBm and Mist shows one at 15 dBm. Which is radiating harder, and what do you need to know about each platform, and about your own measurement, before you can answer?
2. Your predicted RSSI is -45 and you measure -65 with a 2 dB standard deviation. Which term do you solve for, and why not path loss?
3. You compare two APs against a calibrated receiver and they come back 5 dB apart. Name two explanations that have nothing to do with transmit power. Then say which of the two you could rule out without moving either AP, and which one you could not, because that second answer is the whole of this lesson.

Paste into the post, straight after the Three questions list:

## Answers

1. If they're the two APs from my bench, it's the Central one: 25.0 dBm in the air for the AP-735 against 21.0 to 24.0 for the AP34, so one to four dB rather than the ten on the screens. Central's 25 is EIRP with the antenna already in it, while Mist's 15 is one bare transmit chain, so you add 10log of the chain count and then the antenna gain. For your own measurement, a survey tool reads beacons and neither vendor says how many chains carry one, which is why the AP34 gets a range, not a number. And a reading only gives you EIRP if the receiver saw the antenna's peak, which is where The bench that couldn't answer went wrong.
2. Solve for the term you guessed, client antenna plus off-lobe loss, which comes out at -20 dB here: measured minus predicted. Path loss is the one term in the budget you can't argue with, because it's only the distance you measured and the frequency you're on. The 2 dB standard deviation says the 20 dB gap isn't noise, so don't go hunting for something you forgot. The lab section does the same sum for my 15.0 dB gap.
3. Two that fit: a distance error, where the receiver isn't where you think it is, and off-lobe loss, where it's sitting further off one antenna's peak than the other's. Distance you can rule out without touching either AP: measure it, tape the client spot and keep the receiver on it, as in step 2 of The lab. Off-lobe loss you can't, because the datasheet's peak only holds with the AP mounted the way the vendor meant, and one lying on its back aims that peak at the ceiling. That's the term that sank both my bench and my lab, and it never shows up as an error, only as a number.

Where each answer comes from:

| # | What the answer claims | Lesson section it comes from | Status |
|---|---|---|---|
| 1 | For the lesson's AP-735 and AP34, Central's radio leads by one to four dB (25.0 against 21.0 to 24.0 dBm in the air), not ten; Central's figure is EIRP, Mist's is one bare chain plus 10log of the chain count plus antenna gain; nobody documents how many chains carry a beacon; a reading only gives EIRP if the receiver saw the antenna's peak | "What the gear shows you", "The bench that couldn't answer" | from the lesson |
| 2 | Solve for client antenna plus off-lobe loss, -20 dB here; path loss depends only on measured distance and frequency and is the term you can't argue with; a 2 dB standard deviation rules out noise; same sum as the lesson's 15.0 dB | "The number that matters", "The lab" | from the lesson |
| 3 | Distance error and off-lobe loss; distance is checked with a tape and a marked client spot without moving an AP; off-lobe loss can't be ruled out without moving the APs, because the datasheet peak assumes the intended mount and an AP on its back aims it at the ceiling | "Four numbers on a napkin", "The bench that couldn't answer", "The lab" | from the lesson |

### Lesson 4: Modulation and Data Rates
Slug: `academy-04-modulation-and-data-rates`

Questions, verbatim from the lesson:
1. Central shows a client at 960.8 Mbps on an 80 MHz channel with two streams. Which MCS, and which modulation?
2. You turn Wi-Fi 6 off on an SSID. On 80 MHz with two streams, what does the top rate drop from and to?
3. A client's SNR is 22 dB. Where on the table is it living, and what would it take to reach 256-QAM?

Paste into the post, straight after the Three questions list:

## Answers

1. MCS 9, which is 256-QAM at 5/6. The What the gear shows you section places it: on 80 MHz with two streams, 1201 is MCS 11, 960.8 is MCS 9 and 720.6 is MCS 7. You can check it with the rate formula: `980 x 8 x 5/6 x 2 / 13.6 us` comes to 960.8 Mbps, and eight bits per subcarrier is 256-QAM.
2. From 1201 Mbps to 866.7 Mbps. With Wi-Fi 6 off, a 5 GHz client has nothing above 802.11ac to associate as, so it should top out at VHT MCS 9, the Wi-Fi 5 ceiling. That's 802.11ac's MCS 9, not the Wi-Fi 6 one at 960.8 from the first question, and step 5 of The lab puts it at 866.7.
3. It's living in 64-QAM, MCS 5 or 6 territory. The number that matters section puts 64-QAM from the high teens to the high twenties depending on coding rate, and 256-QAM from the mid twenties to the mid thirties depending on the chart and the chipset. So you need at least a few more dB and possibly ten, which means more signal or less noise: get closer, possibly to less than half the distance, or find a cleaner channel.

Where each answer comes from:

| # | What the answer claims | Lesson section it comes from | Status |
|---|---|---|---|
| 1 | 960.8 Mbps on 80 MHz with two streams is MCS 9; the rate formula with eight bits per subcarrier at 5/6 gives 960.8, and eight bits is 256-QAM | "What the gear shows you", "The number that matters", "Speed is a table, not a number" | from the lesson |
| 2 | Top rate drops from 1201 to 866.7 Mbps because the client can only associate as 802.11ac and tops out at VHT MCS 9, a different figure from the Wi-Fi 6 MCS 9 of 960.8 (866.7 is stated in the lab, but the lesson's formula only covers Wi-Fi 6, so a reader can't work it out) | "What the gear shows you", "The lab" | from the lesson |
| 3 | 22 dB is 64-QAM, MCS 5 or 6 territory; 256-QAM wants the mid twenties to mid thirties, so a few more dB and possibly ten; get closer, possibly to less than half the distance, or find a cleaner channel | "The number that matters", "The lab", "Three questions" | partly outside the lesson: "MCS 5 or 6" appears only in the lesson's existing inline answer line, and the body never says which rows are 64-QAM apart from MCS 7; "less than half the distance" leans on the 6 dB per doubling rule from lessons 1 and 3, which this lesson doesn't restate |

### Lesson 5: Airtime Is the Only Resource
Slug: `academy-05-airtime-is-the-only-resource`

Questions, verbatim from the lesson:
1. A client linked at 1201 Mb/s sends one 1500-byte packet per turn on an empty channel. Roughly what does it get, and where did the rest go?
2. Eight SSIDs, six APs sharing one 5 GHz channel, 6 Mb/s minimum. How much of that channel goes on beacons, and what does a 12 Mb/s minimum do to it?
3. Why can't you just mark everything as voice?

Paste into the post, straight after the Three questions list:

## Answers

1. About 55 Mb/s. The packet's bits take 10 microseconds of a 218.5 microsecond turn. The rest is the gap (43), the average count (67.5), the preamble (50) plus the rounding up to a whole symbol, the SIFS (16) and the ACK (28), all in microseconds, and most of it costs the same whatever your rate is. The number that matters section has the whole sum.
2. About 18.6 percent, and a 12 Mb/s minimum roughly halves it, to 9.8. Every SSID beacons about ten times a second from every AP at the lowest basic rate, whether anyone's connected or not, and at 6 Mb/s a 250-byte beacon takes 396 microseconds. Cut to three SSIDs at 12 and it's 3.7.
3. Because voice priority only works while voice is rare. The voice queue draws its backoff from 0 to 3, so with eight busy radios in it roughly seven turns in ten start with a collision, against about two in ten if they drew from 0 to 15. Mark everything as voice and the collisions pile up, and the calls get worse, not better. Level 4 of the game has that switch if you want to watch it happen.

Where each answer comes from:

| # | What the answer claims | Lesson section it comes from | Status |
|---|---|---|---|
| 1 | About 55 Mb/s; the bits take 10 us of a 218.5 us turn; the rest is the 43 us gap, the 67.5 us average count, the 50 us preamble plus rounding to a whole symbol (a 64 us frame), the 16 us SIFS and the 28 us ACK; most of a turn costs the same at any rate | "The number that matters" | from the lesson |
| 2 | About 18.6 percent at 6 Mb/s; 12 Mb/s roughly halves it, to 9.8; three SSIDs at 12 is 3.7; every SSID beacons about ten times a second from every AP at the lowest basic rate; a 250-byte beacon takes 396 us at 6 Mb/s | "Overhead before anyone says anything" | from the lesson |
| 3 | Priority only works while voice is rare; voice draws 0 to 3; eight busy radios in voice start roughly seven turns in ten with a collision, about two in ten at 0 to 15; marking everything as voice makes calls worse; Level 4 has the switch | "WMM: voice cuts the line" | from the lesson |

### Lesson 6: Interference From Yourself
Slug: `academy-06-interference-from-yourself`

Questions, verbatim from the lesson:
1. Twelve APs on one floor at 40 MHz, DFS allowed. You add a thirteenth. What's the reuse factor before and after, and what's the cheapest fix?
2. A client sits at -55 dBm on AP A. AP B, same channel, is heard at AP A at -70 dBm and starts a big download. What happens to the client's RSSI, and what happens to its throughput?
3. Two 80 MHz APs, one on primary 36, one on primary 44. Co-channel or adjacent? And if the second moves to 52?

Paste into the post, straight after the Three questions list:

## Answers

1. Reuse goes from 1.0 to 0.92: 12 channels at 40 MHz over 12 APs, then over 13. Reuse under one means somebody shares, and here one channel now carries two APs. The cheapest fix is the width, not the count. I'd drop that floor to 20 MHz: 25 channels for 13 APs, every AP on its own with twelve to spare.
2. The RSSI stays at -55 dBm, with the same SNR and the same MCS row, but the throughput roughly halves. AP A hears AP B at -70 dBm, well inside the -82 dBm preamble rule, so AP A and its client defer every time AP B transmits, and a big download keeps it transmitting. Nobody's frame gets damaged; everybody's gets delayed.
3. Co-channel. Channels 36, 40, 44 and 48 are the same 80 MHz block with a different primary, so those two APs defer to each other like any pair sharing a channel. On 52 the second AP is in the block next door, which makes it adjacent: nothing defers to its skirt, but that energy is noise in your block, so it raises the floor, eats SNR and pushes the far clients down a row. Same channel costs you time; next-door channel costs you signal.

Where each answer comes from:

| # | What the answer claims | Lesson section it comes from | Status |
|---|---|---|---|
| 1 | Reuse is 1.0 before and 0.92 after (12 channels at 40 MHz over 12 APs, then 13); under one means somebody shares; the fix is width, and 20 MHz gives 25 channels for 13 APs with twelve spare | "The number that matters", "The count isn't the variable" | from the lesson (the body gives the formula and the 20 MHz count; the 0.92 itself only appears in the lesson's existing answer line) |
| 2 | RSSI stays at -55 dBm with the same SNR and MCS row; throughput roughly halves; -70 dBm is well inside the -82 dBm preamble rule, so AP A and its client defer; a big download keeps AP B transmitting; nobody's frame is damaged, everybody's is delayed | "What actually degrades", "The number that matters", "The lab" | from the lesson |
| 3 | Co-channel, since 36 to 48 is one 80 MHz block; 52 is the adjacent block; nothing defers to the skirt, which is noise that raises the floor, eats SNR and pushes far clients down a row; same channel costs time, next door costs signal | "What actually degrades" | from the lesson |

### Lesson 7: Noise, SNR, and Why RSSI Lies
Slug: `academy-07-noise-snr-and-why-rssi-lies`

Questions, verbatim from the lesson:
1. A client shows -62 dBm RSSI on a radio reporting a -78 dBm noise floor. What's the SNR, and roughly which rung does it land on?
2. The AP's noise floor reads -92 dBm on 80 MHz and you change the radio to 20 MHz. Where should the floor go, and why?
3. A user complains of slow Wi-Fi in the kitchen at lunchtime, 2.4 GHz only. Which two numbers on the client page do you look at first, and which tool tells you the cause?

Paste into the post, straight after the Three questions list:

## Answers

1. 16 dB, since SNR is just RSSI minus the floor: -62 minus -78. On the site's SNR floors, MCS 4 wants 16 dB, so that's where it lands, 16-QAM 3/4, nowhere near the top of lesson 4's table despite a strong-looking RSSI. The floor is the problem here: -78 is already above the -80 dBm mark Aruba's doc calls a sign of trouble.
2. About 6 dB lower, near -98 dBm. Thermal noise grows 3 dB for every doubling of width, so going from 80 down to 20 MHz is two halvings, which takes two lots of 3 dB off. Your -92 on 80 MHz is thermal's -95 plus the radio's 3 dB, and on 20 MHz the same sum is -101 plus 3. The section on where the floor comes from walks through it.
3. I'd look at SNR and Retry Frames, not RSSI. On Central's client page SNR is the Signal Quality number, with Retry Frames right next to it. Kitchen, lunchtime and 2.4 GHz only all point at a microwave, which raises the floor without touching RSSI, so SNR drops and retries climb while the signal bar still looks healthy. Those are the symptoms, and a spectrum analyser like the Sidekick shows the cause: a wide hill centred around 2.45 GHz that switches on and off rather than sitting solid.

Where each answer comes from:

| # | What the answer claims | Lesson section it comes from | Status |
|---|---|---|---|
| 1 | SNR is RSSI minus the floor, so 16 dB; MCS 4 wants 16 dB, so it lands on MCS 4, 16-QAM 3/4; -78 is above the -80 dBm mark Aruba's doc calls trouble | "The number that matters", "Where the floor comes from" | from the lesson (the body gives MCS 4's 16 dB floor; its modulation, 16-QAM 3/4, and "nowhere near the top of the table" only appear in the lesson's existing answer line) |
| 2 | About 6 dB lower, near -98 dBm; thermal noise moves 3 dB per doubling of width; -92 on 80 MHz is -95 thermal plus 3 dB, so 20 MHz is -101 plus 3 | "Where the floor comes from" | from the lesson |
| 3 | SNR (Central's Signal Quality) and Retry Frames, not RSSI; a microwave raises the floor without touching RSSI, so SNR drops and retries climb; a spectrum analyser like the Sidekick shows the cause, a wide hill around 2.45 GHz switching on and off | "Why RSSI lies", "What the gear shows you" | from the lesson |

### Lesson 8: Joining a Network
Slug: `academy-08-joining-a-network`

Questions, verbatim from the lesson:
1. A client is associated, the AP shows it, and Access Tracker shows Accept, but the user has no IP. Which rung, and which screen proves it?
2. You change the shared secret on the AP and get the password wrong on the laptop in the same afternoon. Which one leaves a row in Access Tracker?
3. On PSK, the client keeps associating and getting deauthed a second later. Where in the ladder is it failing and why can't the AP tell you sooner?

Paste into the post, straight after the Three questions list:

## Answers

1. DHCP, and Access Tracker can't show it because ClearPass was done two rungs earlier. On Mist, Client Events proves it: Authorization & Association in green, then DHCP Timed Out in red, with Discover Unresponsive under the Successful Connects SLE. On Aruba it's the DHCP stage of Central's Wi-Fi Connectivity, and break three in the lab is this exact case.
2. The wrong password. It gets in the door and comes back as a Reject, with the reason on the Alerts tab. The wrong shared secret looks the same from the laptop but leaves no row at all, because ClearPass never accepted the packet, so you find it in Event Viewer under Authentication as a shared secret complaint. If you mistyped the password while that AP's secret was still broken, even that attempt leaves nothing, because nothing from that AP gets in the door.
3. The 4-way handshake, at message 2. Open system authentication and association prove nothing about the passphrase, so they succeed every time, and each end works out the PMK from the passphrase on its own. The first thing the AP can check is the MIC in message 2, and with a wrong passphrase the MIC doesn't check, so the AP sends a deauth and the client tries again, because computers are very patient. On an AOS 8 controller it shows up as `mic failure` against `wpa2-key2` in `show auth-tracebuf mac <mac>`.

Where each answer comes from:

| # | What the answer claims | Lesson section it comes from | Status |
|---|---|---|---|
| 1 | DHCP; ClearPass finished two rungs earlier, so Access Tracker can't show it; Mist Client Events shows Authorization & Association in green, then DHCP Timed Out in red, with Discover Unresponsive under the Successful Connects SLE; on Aruba, the DHCP stage of Central's Wi-Fi Connectivity; it's the lab's break three | "The ladder", "What the gear shows you", "The lab" | from the lesson (the Aruba screen the lesson names is the site-wide Wi-Fi Connectivity view; it doesn't name a per-client Aruba screen for a DHCP failure) |
| 2 | Wrong password leaves a Reject row with the reason on Alerts; wrong shared secret looks the same to the client, leaves no row and turns up in Event Viewer under Authentication; a password mistyped while that AP's secret is still wrong leaves no row either | "What the gear shows you", "The lab" | from the lesson (the last point follows from the lesson's rule that Access Tracker only shows what got in the door; the lesson doesn't state that case outright) |
| 3 | 4-way handshake, message 2; open system auth and association prove nothing about the passphrase; each end derives the PMK itself; the MIC in message 2 is the first check, and a mismatch gets a deauth and a retry; AOS 8 shows mic failure against wpa2-key2 in show auth-tracebuf | "The ladder", "What the gear shows you", "The lab" | from the lesson |

### Lesson 9: Roaming: the Client Decides
Slug: `academy-09-roaming-the-client-decides`

Questions, verbatim from the lesson:
1. An iPhone sits at -68 dBm on AP 1 with AP 2 offering -58. Does it roam?
2. An 11r roam on an EAP-TLS SSID: how many frames, and does RADIUS see it?
3. ClientMatch wants a non-11v client off an AP. What does it actually do?

Paste into the post, straight after the Three questions list:

## Answers

1. No, not yet. At -68 dBm it hasn't crossed the iPhone's -70 dBm trigger, so it hasn't scanned and hasn't seen AP 2 at all. If AP 2 is still 10 dB better when it does cross, that clears the 8 dB an iPhone wants while it's passing traffic, but not the 12 dB it wants when idle. "The client decides" has all of Apple's numbers.
2. Four frames, two FT authentication and two FT reassociation, and RADIUS doesn't see it. There's nothing to ask: PMK-R0 was set up at the first join, the new AP's PMK-R1 is derived from that, and the nonces that would've been the 4-way handshake ride inside those four frames. A standard roam on the same SSID is 20 or more, EAP-TLS and all, and "The number that matters" puts the counts side by side.
3. It shoves. Every neighbouring radio except the target refuses the client for 5 seconds, and 2 seconds later the current AP deauthenticates it, so the target is the only neighbour that will take it. The client then does what it was going to do anyway, just with no connection while it thinks, and one that beats three of those deauth moves goes on the unsteerable list for 48 hours.

Where each answer comes from:

| # | What the answer claims | Lesson section it comes from | Status |
|---|---|---|---|
| 1 | Doesn't roam yet: -68 dBm hasn't crossed the iPhone's -70 dBm trigger, so it hasn't scanned. Once past it, 10 dB better clears the 8 dB bar when passing traffic but not the 12 dB idle bar | "The client decides" | from the lesson |
| 2 | Four frames (2 FT authentication, 2 FT reassociation) and no RADIUS: PMK-R0 comes from the first join, PMK-R1 is derived from it, and the handshake nonces ride in the four frames. A standard EAP roam is 20 or more | "The client decides", "The number that matters" | from the lesson |
| 3 | Every neighbouring radio except the target refuses the client for 5 seconds and the current AP deauthenticates it 2 seconds later; the client still decides, with no connection meanwhile; beating three deauth moves means 48 hours on the unsteerable list | "What the gear shows you" (Aruba Central), "The client decides" | from the lesson |

### Lesson 10: Capacity, Not Coverage
Slug: `academy-10-capacity-not-coverage`

Questions, verbatim from the lesson:
1. You double the transmit power on an AP. What happens to the rate its beacons go out at, and to the edge where a client can associate?
2. A 2.4 GHz radio carries six SSIDs at a 1 Mb/s MBR. About what share of the channel is beacons, and what does it drop to at 12?
3. Forty laptops on Teams video on one 5 GHz radio at the recommended bitrate. With this lesson's model cell, how many radios?

Paste into the post, straight after the Three questions list:

## Answers

1. The beacon rate doesn't change, and the edge moves out. Beacons go out at the minimum basic rate, and power moves where the signal reaches, not that rate. So the same slow beacon decodes further away, and the edge client taking ten or twenty times everyone else's airtime for the same frame can now join from further out instead of finding a closer AP.
2. About a sixth, 15.6 percent, and that's before a single probe response. At 12 Mb/s the same 300 byte beacon, 2400 bits, takes 200 microseconds plus the 20 microsecond OFDM preamble, 220 in all. Ten a second is 2.2 ms/s per SSID, so about 1.3 percent for six. It's the same approximation as the block in "The number that matters", symbol padding ignored.
3. Two. Forty laptops at the recommended 1,500 kb/s each way is 120 Mb/s once you count both directions, against the model cell's 100 Mb/s, so one radio would be 120 percent busy. Split across two, each is 60 percent busy before anybody opens a browser, with 20 laptops a radio, under the 25 to 30 I plan on. Each extra cell is another AP on another channel, and channels are finite.

Where each answer comes from:

| # | What the answer claims | Lesson section it comes from | Status |
|---|---|---|---|
| 1 | Beacon rate unchanged, because beacons ride the minimum basic rate and power only moves where the signal reaches; the join edge moves out; the slow edge client using ten or twenty times the airtime can join from further away instead of moving to a closer AP | "Two designs that look the same on a floor plan" (Cell size) | from the lesson |
| 2 | Six SSIDs at 1 Mb/s is 15.6 percent, about a sixth, before probe responses. At 12 Mb/s, 200 plus 20 microseconds is 220, 2.2 ms/s per SSID, about 1.3 percent for six | "The number that matters" | from the lesson (the block has no 12 Mb/s line, so that figure is worked with the block's own method and its 20 microsecond OFDM preamble) |
| 3 | 40 x 1,500 kb/s x 2 directions is 120 Mb/s against the 100 Mb/s model cell, 120 percent busy; two radios at 60 percent each, 20 laptops a radio, under the 25 to 30 planning figure; each extra cell is another AP and another channel | "The number that matters", "Two designs that look the same on a floor plan" | from the lesson |

### Lesson 11: Surveys and What a Heatmap Can't See
Slug: `academy-11-surveys-and-what-a-heatmap-cant-see`

Questions, verbatim from the lesson:
1. A validation survey shows -70 dBm in a corridor from one sample and the requirement is -67. Pass or fail, and what do you do first?
2. The heatmap is green across a floor where users say the Wi-Fi is slow at 10 am. Name two things the passive survey didn't measure, and the screen that shows each.
3. Your Sidekick's channel list stops at 165 and the controller shows a radio on 177. What does the heatmap show at that AP, and what do you change first?

Paste into the post, straight after the Three questions list:

## Answers

1. It reads as a fail, but one sample doesn't get to decide. With the 2 dB spread I measured in lesson 3, one sample is a 2 dB guess, so that -70 could be -68 or -72, and even -68 misses -67. First I'd stand on the spot with Stop-and-Go and judge the mean, not the one reading: four samples get its uncertainty to 1.0 dB, sixteen to 0.5 dB. "The number that matters" has the arithmetic.
2. Airtime and retries, and noise that isn't Wi-Fi. Central's RF tab on the AP shows the first as Channel Utilization and Frames with Retries, and Mist shows utilisation in the Channels section of the AP's Insights page. Noise is the same RF tab's Noise Floor graph and the Non-Wifi Interference part of Channel Utilization, or the spectrum view in Ekahau Analyzer; the survey only has spectrum maps if the analyser was running during the walk. A beacon says the AP exists and how loud it is, not how busy the channel was between beacons.
3. Nothing from that AP. It isn't weak, it's absent, and the space fills with the neighbours' colour or grey while the controller shows the radio up on 177. The hole is in the scan list, not the building, so change the list first: turn Scan default channels off in AI Pro's Devices dialog and add 177 with the cog beside the band, or set scan channels from the Sidekick status icon in the Survey app, then walk it again. If your build won't offer 177, the controller's channel and power are the only truth you've got for that radio.

Where each answer comes from:

| # | What the answer claims | Lesson section it comes from | Status |
|---|---|---|---|
| 1 | Reads as a fail, but one sample can't decide it; with the 2 dB spread, -70 could be -68 or -72, and -68 still misses -67; take more samples on the spot (4 gives 1.0 dB, 16 gives 0.5 dB) and judge the mean | "The number that matters", "The lab" | from the lesson |
| 2 | The two things are airtime and retries, and non-Wi-Fi noise. Central's RF tab: Channel Utilization, Frames with Retries, Noise Floor, Non-Wifi Interference. Mist: Channels section on the AP's Insights page for utilisation. Ekahau Analyzer's spectrum view for noise; the survey has spectrum maps only if the analyser ran | "What a heatmap can't see", "What the gear shows you" | from the lesson (it names no Mist screen for noise, only noise_floor in the API, so the answer doesn't give one) |
| 3 | The AP is absent, not weak, the space filled with the neighbours' colour or grey while the controller still shows it; change the scan list first (AI Pro's Scan default channels toggle and cog, or the Sidekick status icon in the Survey app) and re-walk; if 177 isn't offered, the controller's channel and power are the truth | "What a heatmap can't see", "What the gear shows you", "The lab" | from the lesson |

### Lesson 12: A Troubleshooting Method
Slug: `academy-12-a-troubleshooting-method`

Questions, verbatim from the lesson:
1. A client shows 35 dB SNR, 2 percent retries, an Accept in Access Tracker, and DHCP Timed Out. Which layer, and which counters cleared the others?
2. You change the channel and the RADIUS timeout together. The user says it's better. What did you learn?
3. Central shows Retry Frames at 40 percent and Signal Quality at 12 dB while the laptop reports a strong signal. Which lesson, which tool, and which layer?

Paste into the post, straight after the Three questions list:

## Answers

1. It's DHCP, which makes it infrastructure or upstream. The 35 dB SNR and 2 percent retries cleared RF, and the Accept in Access Tracker cleared auth, so the address is the only thing missing. "Four layers" puts DHCP in infrastructure, but the lab's upstream break gets exactly this signature by pulling the client VLAN off the AP's switch trunk.
2. Only that something in those two changes helped, and not which. The channel is RF and the RADIUS timeout is infrastructure, so you haven't even located the layer. Two knobs changed together leave four combinations and no idea which one mattered, so you're back to trying them separately to learn what one change would've told you. "The number that matters" has the arithmetic.
3. Lesson 7, the Sidekick's spectrum view, and RF. Signal Quality is Central's SNR, and a strong signal with SNR at 12 dB and retries at 40 percent is the lab's RF break exactly: RSSI holds, SNR collapses, retries climb. That's noise, and the spectrum view is the tool for noise that isn't Wi-Fi.

Where each answer comes from:

| # | What the answer claims | Lesson section it comes from | Status |
|---|---|---|---|
| 1 | DHCP, so infrastructure or upstream; 35 dB SNR and 2 percent retries cleared RF, the Accept cleared auth; "Four layers" puts DHCP in infrastructure while the lab's upstream break produces this exact signature | "Four layers", "The lab" | from the lesson (the lesson itself places this signature in both layers) |
| 2 | Learned only that something helped, not which; the channel is RF and the RADIUS timeout is infrastructure, so the layer was never located; two knobs at once leaves four combinations and separate trials to run | "Four layers", "What the gear shows you", "The number that matters" | from the lesson |
| 3 | Lesson 7, the Sidekick's spectrum view, RF; Signal Quality is SNR, and a strong signal with 12 dB SNR and 40 percent retries matches the lab's RF break prediction, so it's noise | "Four layers", "What the gear shows you", "The lab" | from the lesson |
