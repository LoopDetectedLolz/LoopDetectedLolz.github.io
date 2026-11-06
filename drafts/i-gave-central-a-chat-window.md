---
title: I Gave Central a Chat Window
slug: i-gave-central-a-chat-window
date: 2026-11-06
tags: Central, API, Tools, Lab
hero: hero-central-chat-window.svg
summary: I built a small read-only MCP server on the New Central API so I can ask my home lab questions in plain English, and a 15-minute poller so it can answer "what changed since yesterday." Here's the build, what the API made easy and hard, and six predictions about what a week of data will show. Part two scores them.
origin: A cutover week where "is anything weird?" was the only question anyone asked, and the dashboard never quite answered it
series: Central MCP monitor
series_order: 1
---
Every cutover ends the same way. The gear is up, the clients are on, and for the next three days the only question anyone asks is "is anything weird?" Central can answer that. It just makes you click through five screens to get there, and by the third day nobody does.

So I built something smaller. A read-only MCP server that sits between an AI assistant and the New Central API, with five tools that each answer one question an engineer actually asks. Then I pointed it at my home lab and started asking.

This is part one: the build, the surprises, and a list of predictions. Part two comes after a week of data and scores every one of them.

## Why a chat window and not another dashboard

I have enough dashboards. What I wanted was to type "anything wrong since the cutover?" and get back three sentences and a list, with the assistant choosing which API calls to make. MCP (Model Context Protocol) is the plumbing for that. You write a small server that exposes functions as "tools," the assistant sees the tool descriptions, and when you ask a question it picks the tool, runs it, and reads the result.

The part I care about is the word read-only. The server can only make GET calls, and only to a short list of paths I typed in. If the assistant decides the answer to "why is the AP slow" is "bounce the port," the server refuses. There's no tool for it. That matters more than any feature, because the next step after a home lab is a customer, and nobody should be pointing an assistant with write access at a customer's Central.

{{figure: fig-central-tool-map.svg | Six questions, six tools, and the New Central endpoints behind each one. Everything is GET.}}

## The build, in an afternoon

**Sign-in.** A New Central API client is a GreenLake thing. You create it as a user, it gets that user's permissions, and you trade the client ID and secret for a token at HPE's sign-in host. The token lasts two hours. There's no refresh, you just ask for another one. The secret lives in a file on my Mac that only my user can read, and the server is the only thing that opens it.

**The allowlist.** Twelve paths, all under the monitoring, notifications, troubleshooting and services APIs, all GET. A regex check runs before every request. I tested it by asking for a config path and watched it refuse.

**Five tools.** `device_status` (online, offline, firmware, config sync), `client_health` (connected and failed clients, wired and wireless), `rf_snapshot` (channel, power, utilization, noise floor, interference, per radio), `alerts_and_audit` (open alerts and who changed what, in one feed), and `day_one_report`, which runs the other four and hands back one summary for the first 72 hours after a cutover.

**The poller.** A live API can tell you how things are. It can't tell you how they were at 2 a.m. So a small job runs every 15 minutes, saves devices, radios, clients and alerts into a local SQLite file, and a sixth tool, `changes_since`, compares the newest snapshot with one from however many hours back you ask. That's the tool I expect to use most.

**Hooking it up.** One command registers it with Claude Code, one line in a config file does it for Claude Desktop. Then you ask.

The first real question I asked was "how many devices are in New Central, is anything offline or out of sync, how many clients, and what changed in the last 24 hours." The answer came back in three sentences: two devices (a CX 6200F and an AP-635), both online and in sync, fifteen wireless clients, none failed, and a tidy summary of the switch being onboarded that afternoon, down to the Critical reboot alert it threw on the way in.

## What the API made easy

More than I expected. The device list has a `configStatus` field with four plain values (Synchronized, Out of Sync, Update in Progress, Synchronized with Limitations), which is exactly the field a Day One report wants and exactly the one I'd have had to infer on older platforms. The radio list carries channel, bandwidth, power, utilization, noise floor and a non-Wi-Fi interference number per radio. The monitoring endpoints all page the same way and send rate-limit headers back, so one client class handles nearly all of it (the audit log pages by offset, because of course one does). Every field name I'd written down from the docs came back spelled the same way, which is rarer than it should be.

## What I ran into

**Ten calls a second, for the whole account.** Not per client, not per token. Every script anyone in the workspace runs shares the same bucket. My poller paces itself to six a second and makes about five calls a run, so it's a rounding error, but a busy customer automation could starve a monitor like this and the monitor would never know why.

**There's no read-only API client.** The token inherits the permissions of the user who made it. If you want a read-only monitor you create the client while signed in as a read-only user. Mine runs under my own account, which means the allowlist in the code is the only thing keeping it honest. For a lab that's fine. For a customer, make the user first.

**"Failed clients" isn't where you'd look.** The client list filters to Connected by default and carries no failure reason. Reasons live in the events API (per client) and an onboarding export that buckets failures by stage (association, authentication, DHCP, DNS). So `client_health` makes three calls where I'd planned one.

**No SNR per radio.** SNR is a client attribute in this API. The radio gives you noise floor, utilization, interference and a channel quality score instead. Fine for flagging a radio worth a look, not the same as the number you'd pull from the AP.

**The SDK moved under me.** The Python MCP SDK went to version 2 and renamed `FastMCP` to `MCPServer`. Most tutorials still show the old import. If yours fails on the first line, that's why.

**The sign-in host dropped a third of my connections.** The API host answered every time. The token host didn't, from my laptop, during work hours. The real fix was a design fix: the poller was fetching a fresh two-hour token every fifteen minutes, which is about ninety sign-ins a day for a job that needs eight. Now it caches the token in a file next to the secret, with the same permissions, and retries the sign-in a few times when it does need one. Four runs in a row, no errors, VPN still on.

{{figure: fig-central-poller-day.svg | One day of 15-minute snapshots. Gaps are the laptop asleep. The marked runs are the ones that needed a second try at the sign-in host, before the token was cached.}}

## What I think a week will show

This is the part I'll be held to. Six predictions, written before the data is in.

1. **The audit feed will see things before the device list does.** It already happened once: the 6200 showed up in the change log minutes before `device_status` counted it.
2. **Most RF changes will have nobody behind them.** Channel moves and power changes with no audit entry, which means AirMatch. The first 24 hours already had one of each.
3. **The 2.4 GHz radio will be the busy one.** On the first day it carried ten of fifteen clients at 32 percent utilization while 5 GHz sat at one percent. I don't think a week changes that, and the 6 GHz radio is disabled, so it won't help.
4. **Failed polls will cluster in work hours.** A monitor on a laptop inherits the laptop's network. I'd bet the gaps and retries line up with the VPN being up.
5. **The first finding that actually matters will be something I built no tool for.** It always is.
6. **At least one of these is wrong.**

Part two scores them, quotes the best "what changed since yesterday" answers as the assistant gave them, and shows the Day One report as it actually came out. Part three points the same tools at Mist.

## Bottom line

The hard part wasn't the MCP server. That was an afternoon. The hard part was the same as it always is with an API: finding out which field actually holds the thing you want, and what the platform does when you ask for it too often. Build the allowlist first, cache the token, and write your predictions down before the data comes in, because afterwards you'll remember having known all along.
