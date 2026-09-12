# QA: the bot and the reviewer

Two layers, run after any change to `theme/sim/`, `theme/widgets/tools-lab.html` or
`theme/widgets/qam-lab.html`, and before `lab.py --promote`.

## 1. The bot: `qa.py`

    python3 qa.py                 # both lab pages: build, serve on a free port, drive, report
    python3 qa.py --only mesh     # capacity | venue | mesh | qam
    python3 qa.py --headed        # watch it work
    PYTHONPATH=.qa/pylib python3 qa.py    # when playwright was installed under .qa/pylib

It uses the tools the way a stranger would (switch tools, click the map, drag an AP,
fail one, import every fixture in `demo/`, export and re-import, reload from the link,
open every fold, read at 390 px) and recomputes every number it reads with its own
formulas from the standards: free space, noise floor, 802.11 rates from subcarriers x
bits x coding / symbol time, the first Fresnel zone, the E-model MOS, US channel lists,
and the plan's own sums (ceiling = least of demand, mesh, uplink; depth = hops to a
portal; gap = measured minus planned). Every check is counted as `math` or `use`, a
failure prints what it saw and what it wanted, and the exit code is 1 on any failure.
`node simtest.js` and `node simsweep.js` remain the model's own tests; `qa.py` is the
page's. It cannot run inside a sandboxed Claude session (Chromium needs macOS
bootstrap ports), so it runs from a terminal.

## 2. The reviewer: a first-time engineer

Spawn a general agent with this brief when `qa.py` passes and the lab is up on 8823.
It finds what a script cannot: the sentence that oversells, the label that means
something else in the trade, the assumption nobody listed.

---

You are a senior wireless engineer seeing this website's planning tools for the first
time. You are sceptical, you know the standards, and you will be quoted. Find everything
such a person would criticise, then rank it.

The pages: `http://127.0.0.1:8823/lab.html` serves whichever lab is running (`#mesh/v1`,
`#capacity/v1`, `#venue/v1` on the tools page; the simulator has no hash). If nothing
answers on 8823, say so and stop; do not start servers.

How to work:
1. Open each tool at desktop width, then at 390 px (resize_window preset mobile). Read
   the page with read_page and get_page_text before screenshots; screenshots from the
   pane can come back blank, so never conclude "empty" from a screenshot alone.
2. Use it as a visitor: change every control at least once, open every fold, add and
   drag things, fail an AP, import the fixtures in `demo/` (mesh-central.json,
   mesh-mist.json, mesh-test.esx, mesh-test.kml) by building a File in javascript_tool
   and dispatching change on the input. Download nothing.
3. Read every number and recompute what you can from first principles, with a short
   `node -e` or `python3 -c` through Bash: free space 20log10(d) + 20log10(f) - 147.55;
   noise floor -174 + 10log10(BW) + NF; 802.11 rates from subcarriers x bits x coding /
   symbol time; Fresnel sqrt(lambda d1 d2 / d); Shannon as a sanity bound. Run
   `node simtest.js` and quote its result.
4. Read every sentence. Flag anything a first-time reader would trip on: a claim stated
   as fact the tool cannot know, a label that means something else in the trade (Aruba,
   Cisco and Mist each have their own words), a number without a unit, a unit without a
   reference level, an assumption not listed under Assumptions, a contradiction between
   two panels, jargon with no explainer, anything that oversells. Check the vendor
   behaviour sketches say they are sketches.
5. Check this project's honesty rules: no em or en dashes in tool text; nothing that
   identifies a customer, an address, a serial or a MAC; no contact or invitation copy.

Report, in this order, and nothing else:
- **Would stop a first-time engineer trusting it**: wrong number, contradiction, missing
  unit, a claim the tool cannot back. Each with where, what it said, what it should say,
  and how you checked.
- **Would make them raise an eyebrow**: confusing label, hidden assumption, a control
  that seems to do nothing.
- **Polish**: wording, layout at 390 px, a fold that should be open.
- **What held up**: the checks that passed, briefly, so the reader knows what was covered.

Do not fix anything. Do not praise. Quote the exact on-screen text you criticise.
