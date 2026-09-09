---
title: When the Docs Disagree With Themselves, Somebody Has to Decide
slug: when-the-docs-disagree
date: 2026-09-04
tags: Process, Documentation, AOS-CX
hero: hero-docs.svg
summary: Three official minimum versions, a withdrawn release note, and a command renamed without a memo. How to get to a decision you can put in a change record.
origin: Chasing a CX 8100 minimum version and finding three answers
---
Most of the time I lose to documentation, I don't lose because the answer is hard. I lose because there are three answers, they're all official, and none of them is dated.

This post isn't about a product. It's about what to do when the vendor's own material contradicts itself, which happens more than anybody admits, and how to get to a decision you can actually put in a change record.

## Three sources, three minimum versions

Chasing the minimum software version for a CX 8100 taught me this one properly. Depending on where you looked, you got a different floor. Product documentation, a datasheet and the release notes did not agree, and every one of them was published by the same vendor.

The answer that held up was 10.12.0001, and the reason it held up is where it came from: the Products Supported table inside the release notes, listing the actual SKUs. R9W94A, R9W95A, R9W96A, R9W97A. Not a datasheet, not a "what's new" page. The table that exists specifically to say which hardware this build runs on.

**That's the general rule, and it's the whole method: trust the artifact whose job is to answer your exact question.** A release note's Products Supported table exists to tell you what's supported. A datasheet exists to sell you a switch. When they disagree, it isn't a coin flip.

Same trip taught me a second thing, and I'll own that I had it backwards the first time I wrote it up. The 10.13 release notes for the 8100 and 8360 do set a floor on where you can come from: to upgrade to 10.13 your switch has to be on 10.10.0002 or later, and there's a separate line saying don't do it through the REST API or the web UI unless you're on 10.09.1060 or 10.10.1020 or later. 10.12.0006 clears both, so going straight to 10.13 is inside the documented envelope. That's the actual point: read the real constraint instead of inventing a four-step ladder out of superstition. And note where it lives. It's under Important information, not under the section titled Upgrade information.

## Sometimes the source just leaves

While I was working that same question I went looking for the 10.12.0006 release notes and hit a wall, and the shape of that wall is worth describing precisely because I got it slightly wrong the first time I wrote it up. The support portal's own software entry for 10.12.0006 on the 8100 and 8360 links to a release notes PDF on the public doc site. That link is a real 404 in a real browser. The notes for that specific build are gone. But the 10.12 train isn't: the later 10.12.1000 through 10.12.1050 notes for the same platforms are sitting on the support portal as downloads, behind a login, and they never were on the public site as far as I can tell.

This is worth knowing because the natural reaction is to assume you're searching wrong and spend another twenty minutes proving you're not. You're not. Individual release notes get withdrawn, the download page keeps pointing at where they used to be, and the newer ones live somewhere that a search engine can't see. There's no notice for any of that.

When your source has been withdrawn, you don't get to cite it. Say so plainly in the change record: the release notes for this version are no longer published, here's the adjacent version's guidance and here's why I think it applies. That's a defensible position. Pretending you read a document that isn't there is not. And check the support portal before you conclude a document doesn't exist at all; the login-gated copy is often the only copy.

## A command got renamed and nobody sent a memo

Here's my favorite one, because it's small and it's perfect.

`allow-unsafe-updates` became `allow-non-failsafe-updates` at 10.15.1010. You find that out from the Command History table on the command page, which is the only place it's recorded. There's no deprecation note, no warning, nothing in the upgrade guidance telling you a command in your scripts changed spelling.

It gets better. The doc page for the new name still lives at a URL ending in the old name. And two releases later, the 10.16 and 10.17 pages for `show front-panel-security status` on the 6300 and 6400 are still written using the old command name. That's a confirmed documentation bug, and if you'd only read that page you'd have walked away with the wrong command and no idea.

So: **when a command doesn't behave the way a doc page says, check the Command History table before you check your own sanity.** That table is the closest thing AOS-CX has to a changelog for CLI syntax, and it's the first place I go now.

Whether the old spelling still parses on a current build is undocumented in both directions, which means the only honest answer is the one you get from the box. Tab completion and `?` on the actual switch beat every page on the internet including this one. (The 120 minute ceiling on that timer, on the other hand, is documented right on the command page. That one you can just cite.)

## When the doc site itself is the obstacle

A practical one that costs real time. Deep links into the AOS-8 consolidated release notes now redirect to the support.hpe.com WebHelp shell and quietly drop the anchor, so you land on the index instead of the page you wanted. Automated fetching doesn't work either: the techdocs host 403s anything that isn't a browser, and the support.hpe.com WebHelp answers a scripted request with a 200 and an empty JavaScript shell.

There's no clever way around it. You walk the table of contents by hand: version, then maintenance release, then Resolved Issues. It's slow and it works, and knowing it's slow ahead of time is better than concluding the page is gone.

The payoff for walking it manually is real, though. That's how the actual cause of the AOS-8 to AOS-10 pre-validate failure turned up: AOS-253282, AOS-253299 and AOS-252424, resolved in 8.10.0.11, an image conversion failure that hits when Central is using an IPv6 address. Everyone chasing that symptom blames DNS. It isn't DNS. It was sitting in a Resolved Issues list that a search engine can't reach.

## How I decide now

Nothing fancy. Rough order of trust, top to bottom:

| Source | Weight | Why |
|---|---|---|
| The box itself | Highest | It's the only thing that can't be out of date |
| Release note Products Supported / Upgrade sections | High | Purpose-built to answer version questions |
| Command History table on a CLI page | High | The only CLI changelog there is |
| Command page prose | Medium | Demonstrably lags renames |
| Feature and config guides | Medium | Good on concepts, slow on specifics |
| Datasheets, quick specs, marketing | Low | Not written to answer your question |
| A forum post, mine included | Low | Useful lead, not a citation |

And two habits that have saved me more than the table has. Write down which source you used and when, because "the docs said so" is not a defense when the docs have since changed. And when the sources genuinely conflict and you can't test it, say that out loud in the change record instead of picking the convenient one quietly.

## Bottom line

The docs aren't going to stop contradicting themselves, so the skill isn't finding the right page. It's knowing which page was built to answer the question you're actually asking, and being willing to write "unverified, here's why" when nothing was.
