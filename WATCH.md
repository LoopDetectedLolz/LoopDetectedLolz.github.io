# The Watch as the probe and the button

A Watch cannot read Wi-Fi signal: watchOS and iOS give apps no RSSI, SNR or rate.
It does not need to. The AP hears the Watch, Central logs what it heard at every
roam, and `client-pull.py` brings that back. So the Watch is two things here: the
harshest client in the building, walking it all day, and a button on the wrist that
flags a moment so the trail can be read against where you were.

## 1. The relay on the laptop

    export CENTRAL_TOKEN_FILE=~/.config/nfn/central-token.json
    python3 client-pull.py --client Watch --trail 8 --serve 8830 --lan --marks-file ~/marks.json

It prints two addresses. The `127.0.0.1` one is for the simulator's Live chip. The
network one (`http://<this mac>:8830/...`) is for the Watch and the phone on the
same Wi-Fi. What the network can reach:

| Path | What it does |
|---|---|
| `GET /glance` | one line of text: who, on which AP, dBm, SNR, rate, plus anything worth a buzz (slow roam, rejoin, weak, off the air) |
| `GET /mark?note=kitchen` | flags this moment with a word; it shows as an orange flag on the journey strip |
| `POST /mark` with `{"note": "..."}` | the same, for anything that prefers a body |
| `GET /marks` | the marks so far |
| `GET /latest.json` | the reading, the trail, the marks and the alerts, for the page |
| `GET /alerts` | the current alerts as lines, or `quiet` |

The token never leaves the laptop. The network can read a reading and add a word
and a time; it cannot change anything in Central. Stop the relay when you leave the
site; it is a lab convenience, not a service.

## 2. Two Shortcuts on the Watch

Build them on the iPhone in the Shortcuts app and tick "Show on Apple Watch".
Replace `<mac>` with the address the relay printed.

**Mark here** (one tap, then a word)

1. Choose from Menu: `kitchen`, `stairs`, `garage`, `dead spot`, `call dropped`, `outside`
2. For each item: Get Contents of URL `http://<mac>:8830/mark?note=<item>` (method GET)
3. Show Result (the relay answers "marked kitchen at 14:02:15")

Add a complication for it so it is one tap from the watch face. Dictation works too:
replace the menu with Dictate Text and put the text in the URL with URL Encode.

**Glance** (what the tracked client is doing right now)

1. Get Contents of URL `http://<mac>:8830/glance`
2. Show Result, or Speak Text for a hands-free version

For a buzz when something happens: a Personal Automation every 5 minutes that gets
`/alerts`, and If the text is not `quiet`, Show Notification. Shortcuts automations
on the Watch run through the phone, so the phone has to be on the same Wi-Fi.

## 3. Reading it back

In the simulator, Live, Connect (or open a snapshot). The journey strip shows the
Watch's hops with the marks as orange flags; scrub to a hop and the caption names
the nearest mark and how far off it was. "Kitchen, 40 s before a 389 ms roam" is a
sentence a customer understands.

## What a Watch is good for, and not

Good: a worst-case client that walks the site for free; a wrist button; a glance.
Not: a meter. Any Wi-Fi number a Watch app claimed to measure would be one you could
not defend, so nothing here pretends to.
