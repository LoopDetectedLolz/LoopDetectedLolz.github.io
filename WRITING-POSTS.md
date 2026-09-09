# How to run the blog

Two surfaces, two jobs. Claude Code for anything that touches files. Cowork for anything away from the desk.

| What you're doing | Where | How you start |
|---|---|---|
| Write, edit, publish, fix the site | Claude Code | Dock icon, or `cd ~/Projects/network-field-notes && claude` |
| Capture an idea, draft from a conversation | Cowork | Open the Personal Tech Blog project |
| Scheduled Airheads runs, monitoring | Cowork | Runs on its own |

## Writing a new post

Open Claude Code from the Dock icon. It starts in the repo and reads `CLAUDE.md` automatically, so it already knows the build commands and the rules.

Then just say what the post is about:

> write a post about the U-NII-4 survey blind spot, the one from the wireless troubleshooting job

It'll pull in the `blog-post-generator` skill and work through: draft in your voice, hero graphic, then the claim audit against vendor docs. The audit is the slow part and it's the point. It reports bucket counts (verified, partial, unverifiable, wrong) with the draft.

You get a draft back. Read it. Tell it what to change. Then:

> publish it

That runs `blog-publish`: build, dash check, scrub check, graphics render, commit, push, verify the live URLs.

## Editing a post that's already live

Posts are markdown in `posts/`. Say what you want changed:

> in the channel 173 post, cut the last section and tighten the intro

> the PoE post says 802.3bt delivers 90W, check that and fix it if it's wrong

Then `publish it` again. Same pipeline. The build regenerates everything, so a wording change also refreshes that post's preview card, the sitemap date and the RSS entry.

## Changing the site itself

Nav, the hero, the stat chips, On deck cards, Community, About, the tagline: all of it lives in `build-blog.py`. Never edit `index.html`, `p/`, `og/`, `sitemap.xml` or `rss.xml` by hand, they're regenerated on every build and your edit disappears.

> add an On deck card for the EAP-TLS post

> update the Airheads stats, I'm at 74 replies and 7 best answers

## Capturing an idea when you're not at the Mac

In Cowork, in the Personal Tech Blog project:

> add a blog idea: Meraki client balancing disassociates stationary clients and it reads as bad roaming

It goes into the project docs. Next time you're in Claude Code, ask it to write the post from that idea.

You can draft a whole post in Cowork too. It just can't publish, because the repo is on the Mac.

## Before you share a new post

1. Run the URL through `linkedin.com/post-inspector`. LinkedIn caches the first scrape for weeks, so warm it before you post the link anywhere.
2. Optionally request indexing in Google Search Console. The sitemap is already registered; this just jumps the queue.
3. Link the specific post when you answer a forum thread, not the homepage.

## The two rules that matter most

**The repo is public and git history is permanent.** Customers are never identifiable. Not the name, the site, the city, the address, AP serials, BSSIDs, client MACs, or internal SSID and profile names. The publish skill greps for these, but you're the last check.

**Claims get verified before they go out.** An audit of the first seven posts found 15 claims flatly wrong and 50 overstated. Vendor docs are the standard of truth. Forum posts, including your own, are leads.

## Where things live

| Thing | Where | Backed up? |
|---|---|---|
| Posts, graphics, build script, site | This repo | Yes, GitHub on every push |
| `audit/`, `evidence/`, `verification-register.md` | This repo, gitignored | No. Local only. |
| Skills (`blog-post-generator`, `blog-publish`) | Your Claude account | Yes, synced by Anthropic |
| Project docs and blog ideas | Cowork project | Yes, in your Claude account |
| The Dock launcher app | `~/Applications` | No. Local only, rebuildable. |

`~/Projects` is not in iCloud. iCloud Desktop and Documents sync only covers `~/Desktop` and `~/Documents`.

## If something breaks

The site is eight static files' worth of generated output from `posts/` and `graphics/`. Nothing else is precious. Worst case:

```bash
git clone https://github.com/LoopDetectedLolz/LoopDetectedLolz.github.io.git
cd LoopDetectedLolz.github.io && python3 build-blog.py
```

Deploy quirks, DNS, certificate behaviour and the local preview command are in `CLAUDE.md`.
