#!/usr/bin/env python3
"""Build the demo captures the index banner transmits, bit for bit.

Three flows, each written as a radiotap pcap (link type 127) and mirrored into traffic.json,
which build-blog.py injects into the banner:

  nfn-ping.pcap         one ICMP echo request in cleartext, plus its ACK
  nfn-teams-voice.pcap  15,000 SRTP voice packets (20 ms each, five minutes of a call), plus ACKs
  nfn-teams-chat.pcap   36 TLS 1.2 application-data records, five minutes of chat, plus ACKs

The banner regenerates the two Teams flows in the browser with WebCrypto from the same keys
and the same recipe (frame n is a pure function of n), so traffic.json carries only the recipe
and a few sample frames; make-pcap.py is the reference the browser output is checked against.

The 802.11 link itself is left open (no CCMP) so the headers stay readable; the Teams flows
are encrypted the way the app encrypts them: SRTP (AES-128-CTR + HMAC-SHA1-80) for voice and
TLS_AES_128_GCM for chat, with demo keys that are printed in traffic.json so the decrypted
view in the banner is honest. Addresses are locally administered MACs and RFC 5737 IPs.

Needs the 'cryptography' package for AES. Run from anywhere; writes next to itself."""
import struct, zlib, json, os, hashlib, hmac
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

here = os.path.dirname(os.path.abspath(__file__))

def csum(b):
    if len(b) % 2: b += b"\0"
    s = sum(struct.unpack("!%dH" % (len(b)//2), b))
    while s >> 16: s = (s & 0xFFFF) + (s >> 16)
    return (~s) & 0xFFFF

AP  = bytes.fromhex("020000000001")   # BSSID
STA = bytes.fromhex("020000000002")   # the client (you)
GW  = bytes.fromhex("020000000003")   # the wired side
IP_STA = bytes([192, 0, 2, 10]); IP_GW = bytes([192, 0, 2, 1]); IP_TEAMS = bytes([203, 0, 113, 40])
LLC = bytes.fromhex("aaaa030000000800")
RADIOTAP = struct.pack("<BBHI", 0, 0, 12, 0x2 | 0x4) + bytes([0x10, 0x6c, 0, 0])   # FCS present, 54 Mb/s

def mac(b): return ":".join("%02x" % x for x in b)
def ipv4(src, dst, proto, payload, ident, ttl=64):
    h = struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20 + len(payload), ident, 0x4000, ttl, proto, 0, src, dst)
    return h[:10] + struct.pack("!H", csum(h)) + h[12:] + payload
def dot11(to_ds, seqno, body):
    """Data frame. to_ds: client to AP (addr1 BSSID, addr2 client, addr3 destination);
    else AP to client (addr1 client, addr2 BSSID, addr3 source)."""
    fc = bytes([0x08, 0x01 if to_ds else 0x02]); dur = struct.pack("<H", 44); sc = struct.pack("<H", (seqno & 0xfff) << 4)
    a1, a2, a3 = (AP, STA, GW) if to_ds else (STA, AP, GW)
    f = fc + dur + a1 + a2 + a3 + sc + LLC + body
    return f + struct.pack("<I", zlib.crc32(f) & 0xFFFFFFFF)
def ack_for(frame):
    a = bytes([0xd4, 0x00]) + struct.pack("<H", 0) + frame[10:16]
    return a + struct.pack("<I", zlib.crc32(a) & 0xFFFFFFFF)
def write_pcap(name, frames):
    with open(os.path.join(here, name), "wb") as f:
        f.write(struct.pack("<IHHiIII", 0xa1b2c3d4, 2, 4, 0, 0, 65535, 127))
        t = 1789000000.0
        for fr in frames:
            for data, dt in ((fr, 0), (ack_for(fr), 60e-6)):
                ts = t + dt
                f.write(struct.pack("<IIII", int(ts), int((ts % 1) * 1e6), 12 + len(data), 12 + len(data)) + RADIOTAP + data)
            t += 0.020
def hdr_fields(to_ds, seqno, proto_name, proto_num, src, dst):
    a1, a2, a3 = (AP, STA, GW) if to_ds else (STA, AP, GW)
    return [
        [0, 2, "Frame Control", "0x08%02x: type Data, %s" % (1 if to_ds else 2, "To DS = 1 (client to AP)" if to_ds else "From DS = 1 (AP to client)")],
        [2, 2, "Duration", "44 microseconds reserved for the ACK"],
        [4, 6, "Address 1", "receiver, %s %s" % ("the AP's BSSID" if to_ds else "the client", mac(a1))],
        [10, 6, "Address 2", "transmitter, %s %s" % ("the client" if to_ds else "the AP's BSSID", mac(a2))],
        [16, 6, "Address 3", "%s %s, the wired side" % ("final destination" if to_ds else "original source", mac(a3))],
        [22, 2, "Sequence Control", "sequence number %d, fragment 0" % (seqno & 0xfff)],
        [24, 8, "LLC / SNAP", "AA AA 03, OUI 00 00 00, EtherType 0x0800 = IPv4"],
        [32, 20, "IPv4 header", "%s to %s, TTL 64, protocol %d = %s" % (".".join(map(str, src)), ".".join(map(str, dst)), proto_num, proto_name)],
    ]

traffic = {}

# ── 1. the ping, cleartext ─────────────────────────────────────────────────────
payload = b"Network Field Notes: this is what cleartext looks like"
icmp = struct.pack("!BBHHH", 8, 0, 0, 0x4e46, 1) + payload
icmp = icmp[:2] + struct.pack("!H", csum(icmp)) + icmp[4:]
frame = dot11(True, 16, ipv4(IP_STA, IP_GW, 1, icmp, 0x1d4b))
write_pcap("nfn-ping.pcap", [frame])
open(os.path.join(here, "nfn-ping.frame.hex"), "w").write(frame.hex())
fields = hdr_fields(True, 16, "ICMP", 1, IP_STA, IP_GW) + [
    [52, 8, "ICMP header", "type 8 echo request, id 0x4e46, sequence 1"],
    [60, len(payload), "ICMP payload", "the text, as bytes, in cleartext"],
    [60 + len(payload), 4, "FCS", "CRC-32 over everything before it; one flipped bit anywhere and this no longer matches"],
]
open(os.path.join(here, "nfn-ping.fields.json"), "w").write(json.dumps(fields))
traffic["ping"] = {"name": "Ping (ICMP, cleartext)", "pcap": "demo/nfn-ping.pcap", "kind": "ping",
                   "frames": [frame.hex()], "fields": [fields], "app": [{"seq": 1, "to": "192.0.2.1"}],
                   "note": "one echo request; the reply would come back the same way"}

# ── 2. Teams voice: RTP over UDP, SRTP-encrypted payload ─────────────────────
# keys are demo keys, printed here so the decrypted view in the banner is honest
SRTP_KEY = hashlib.sha256(b"network field notes demo srtp key").digest()[:16]
SRTP_SALT = hashlib.sha256(b"network field notes demo srtp salt").digest()[:14]
SRTP_AUTH = hashlib.sha256(b"network field notes demo srtp auth").digest()[:20]
SSRC = 0x4e464e31
def audio20ms(n):
    """20 ms of 'speech': a deterministic waveform so the decrypted view has something to draw.
    Returns 60 encoded bytes (SILK wideband at 24 kb/s) and 32 samples for the picture."""
    import math
    samples = []
    for i in range(32):
        t = n * 0.020 + i * 0.020 / 32
        env = 0.35 + 0.65 * abs(math.sin(t * 2.1)) * (0.6 + 0.4 * math.sin(t * 13.0))
        v = env * (0.7 * math.sin(2 * math.pi * 180 * t) + 0.3 * math.sin(2 * math.pi * 1210 * t + 0.4))
        samples.append(round(v, 3))
    enc = hashlib.sha256(b"silk-frame-%d" % n).digest() + hashlib.sha256(b"silk-frame-%d-b" % n).digest()
    return enc[:60], samples
VOICE_N = 15000
voice_frames, voice_app = [], []
for n in range(VOICE_N):
    seq, ts = 3100 + n, 0x0a2f7c40 + n * 960            # Opus/SILK clock is 48 kHz: 960 per 20 ms
    rtp_hdr = struct.pack("!BBHII", 0x80, 111, seq, ts, SSRC)   # V=2, PT 111 (dynamic, SILK/Opus)
    enc, samples = audio20ms(n)
    # SRTP: AES-128-CTR keystream from the packet index, then HMAC-SHA1 over header + ciphertext, 80-bit tag
    iv = bytes(a ^ b for a, b in zip(SRTP_SALT + b"\0\0", struct.pack("!QQ", SSRC, (0 << 16) | seq)[0:16]))
    ct = Cipher(algorithms.AES(SRTP_KEY), modes.CTR(iv)).encryptor().update(enc)
    tag = hmac.new(SRTP_AUTH, rtp_hdr + ct + b"\0\0\0\0", hashlib.sha1).digest()[:10]
    udp_len = 8 + len(rtp_hdr) + len(ct) + len(tag)
    udp = struct.pack("!HHHH", 50024, 3478, udp_len, 0) + rtp_hdr + ct + tag
    fr = dot11(True, 200 + n, ipv4(IP_STA, IP_TEAMS, 17, udp, 0x3000 + n))
    voice_frames.append(fr.hex())
    if n < 8: voice_app.append({"seq": seq, "ts": ts, "wave": samples})
vf = hdr_fields(True, 200, "UDP", 17, IP_STA, IP_TEAMS) + [
    [52, 8, "UDP header", "port 50024 to 3478, the media relay"],
    [60, 12, "RTP header", "version 2, payload type 111 (SILK/Opus), sequence, timestamp (48 kHz clock, +960 per 20 ms), SSRC 0x4e464e31"],
    [72, 60, "SRTP payload", "20 ms of encoded speech under AES-128-CTR; without the key it is noise"],
    [132, 10, "SRTP auth tag", "HMAC-SHA1-80 over the RTP header and ciphertext; a flipped bit fails this too"],
    [142, 4, "FCS", "CRC-32 over everything before it"],
]
vf[5][3] = "sequence number 200 and up, one per packet"
write_pcap("nfn-teams-voice.pcap", [bytes.fromhex(h) for h in voice_frames])
traffic["voice"] = {"name": "Teams voice (SRTP over UDP)", "pcap": "demo/nfn-teams-voice.pcap", "kind": "voice",
                    "count": VOICE_N, "sample": voice_frames[:8], "fields": [vf], "app": voice_app,
                    "seq0": 3100, "ts0": 0x0a2f7c40, "ssrc": SSRC,
                    "keys": {"srtp_key": SRTP_KEY.hex(), "srtp_salt": SRTP_SALT.hex(), "srtp_auth": SRTP_AUTH.hex()},
                    "check": {str(n): hashlib.sha256(bytes.fromhex(voice_frames[n])).hexdigest()[:16] for n in (0, 1, 7, 100, 1000, 14999)},
                    "note": "15,000 packets, 20 ms apart, five minutes of a call; UDP, so a lost packet is a gap"}

# ── 3. Teams chat: TLS 1.2 application data over TCP ─────────────────────────
TLS_KEY = hashlib.sha256(b"network field notes demo tls key").digest()[:16]
TLS_IV = hashlib.sha256(b"network field notes demo tls iv").digest()[:4]
CHAT = [   # (who, time, text): five minutes on a warehouse floor
    ("you",  "10:21:04", "Can you hear me? You keep cutting out."),
    ("tech", "10:21:11", "Barely. Is that the warehouse AP again?"),
    ("you",  "10:21:19", "Microwave in the break room. Watch the retries."),
    ("tech", "10:21:27", "Moving to the next channel now."),
    ("you",  "10:21:38", "Better. Crystal clear."),
    ("tech", "10:21:49", "Radio is on 149 now, 80 wide. Old channel had utilisation pegged for an hour."),
    ("you",  "10:21:58", "Retry rate?"),
    ("tech", "10:22:06", "38 percent on 2.4. The 5 GHz radio was clean the whole time."),
    ("you",  "10:22:15", "Then why were the scanners on 2.4?"),
    ("tech", "10:22:26", "Band steering is off on that SSID. Somebody turned it off for the label printers."),
    ("you",  "10:22:36", "Printers are 2.4 only, fine. Scanners do 5. Turn steering back on and exclude the printer OUI."),
    ("tech", "10:22:49", "Done. Steering on, printer OUI in the 2.4 only list."),
    ("you",  "10:22:57", "Note it in the change log so nobody flips it again."),
    ("tech", "10:23:05", "Logged."),
    ("you",  "10:23:12", "Roam a scanner across the dock doors and watch the client page."),
    ("tech", "10:23:22", "Walking it now. Hold on."),
    ("tech", "10:23:48", "Roamed at -67, landed on 5 GHz, MCS 7 at the far door."),
    ("you",  "10:23:56", "Good. Still no drops on our call?"),
    ("tech", "10:24:03", "None since the channel change."),
    ("you",  "10:24:12", "Pull the RF health graph for the ticket before it rolls off."),
    ("tech", "10:24:25", "Exported. Also the break room is not on the map, it is behind the racks."),
    ("you",  "10:24:34", "Add it to the survey notes. That microwave is a permanent interferer."),
    ("tech", "10:24:44", "Want a channel exclusion on 2.4 for that AP?"),
    ("you",  "10:24:53", "No. Let the RF management handle it now that steering is on. Watch it tomorrow."),
    ("tech", "10:25:02", "Will do. Anything else while I am on the floor?"),
    ("you",  "10:25:11", "The mezzanine AP showed 3 dB lower Tx power in the audit. Check its port."),
    ("tech", "10:25:31", "It is on a 15 W port. PoE budget again."),
    ("you",  "10:25:39", "Of course it is. Log it, we move it to a 30 W port on the refresh."),
    ("tech", "10:25:48", "Logged. Heading back to the closet."),
    ("you",  "10:25:55", "Send me the screenshots and I will write it up."),
    ("tech", "10:26:02", "On the way."),
    ("you",  "10:26:09", "Great call quality now, by the way."),
    ("tech", "10:26:16", "Told you it was the microwave."),
    ("you",  "10:26:22", "You said warehouse AP."),
    ("tech", "10:26:28", "I said it was the warehouse AP's problem."),
    ("you",  "10:26:35", "Sure you did."),
]
chat_frames, chat_fields, chat_app = [], [], []
seq_c, seq_s = 0x1a2b3c00, 0x5e6f7a00
for n, (who, when, text) in enumerate(CHAT):
    to_ds = who == "you"
    plain = json.dumps({"t": "msg", "from": who, "text": text}, separators=(",", ":")).encode()
    # TLS 1.2 AES-GCM record: 8-byte explicit nonce, ciphertext, 16-byte tag; the record header is the AAD's tail
    explicit = struct.pack("!Q", n + 1)
    aad = struct.pack("!Q", n + 1) + bytes([0x17, 0x03, 0x03]) + struct.pack("!H", len(plain))
    ct_tag = AESGCM(TLS_KEY).encrypt(TLS_IV + explicit, plain, aad)
    body = explicit + ct_tag
    rec = bytes([0x17, 0x03, 0x03]) + struct.pack("!H", len(body)) + body
    if to_ds:
        tcp = struct.pack("!HHIIBBHHH", 51234, 443, seq_c, seq_s, 0x50, 0x18, 65535, 0, 0) + rec; seq_c += len(rec)
        src, dst = IP_STA, IP_TEAMS
    else:
        tcp = struct.pack("!HHIIBBHHH", 443, 51234, seq_s, seq_c, 0x50, 0x18, 65535, 0, 0) + rec; seq_s += len(rec)
        src, dst = IP_TEAMS, IP_STA
    pseudo = src + dst + struct.pack("!BBH", 0, 6, len(tcp))
    tcp = tcp[:16] + struct.pack("!H", csum(pseudo + tcp)) + tcp[18:]
    fr = dot11(to_ds, 400 + n, ipv4(src, dst, 6, tcp, 0x4000 + n))
    chat_frames.append(fr.hex())
    f = hdr_fields(to_ds, 400 + n, "TCP", 6, src, dst) + [
        [52, 20, "TCP header", "port %s, PSH+ACK, the chat session to the Teams service" % ("51234 to 443" if to_ds else "443 to 51234")],
        [72, 5, "TLS record header", "0x17 application data, version 3.3, %d bytes" % len(body)],
        [77, 8, "TLS nonce", "explicit nonce for AES-GCM, counts up per record"],
        [85, len(plain), "TLS ciphertext", "the JSON message under AES-128-GCM; %d bytes of noise without the key" % len(plain)],
        [85 + len(plain), 16, "TLS auth tag", "GCM tag; a flipped bit fails this before the app ever sees the message"],
        [101 + len(plain), 4, "FCS", "CRC-32 over everything before it"],
    ]
    chat_fields.append(f)
    chat_app.append({"who": who, "t": when, "text": text})
write_pcap("nfn-teams-chat.pcap", [bytes.fromhex(h) for h in chat_frames])
traffic["chat"] = {"name": "Teams chat (TLS over TCP)", "pcap": "demo/nfn-teams-chat.pcap", "kind": "chat",
                   "script": chat_app, "sample": chat_frames[:4], "fields": chat_fields[:4],
                   "keys": {"tls_key": TLS_KEY.hex(), "tls_iv": TLS_IV.hex()},
                   "check": {str(n): hashlib.sha256(bytes.fromhex(chat_frames[n])).hexdigest()[:16] for n in range(len(chat_frames))},
                   "note": "%d messages over five minutes, one TLS record each; TCP, so a lost frame is retransmitted and the message arrives late" % len(CHAT)}

open(os.path.join(here, "traffic.json"), "w").write(json.dumps(traffic, separators=(",", ":")))
print("ping   1 frame, %d bytes" % (len(traffic["ping"]["frames"][0]) // 2))
print("voice  %d frames, %d bytes each, pcap %d bytes" % (VOICE_N, len(voice_frames[0]) // 2, os.path.getsize(os.path.join(here, "nfn-teams-voice.pcap"))))
print("chat   %d frames, %d to %d bytes" % (len(chat_frames), min(len(h) for h in chat_frames) // 2, max(len(h) for h in chat_frames) // 2))
print("traffic.json", os.path.getsize(os.path.join(here, "traffic.json")), "bytes")
