#!/usr/bin/env python3
"""Build the demo captures the index banner transmits, bit for bit.

Three flows, each written as a radiotap pcap (link type 127) and mirrored into traffic.json,
which build-blog.py injects into the banner:

  nfn-ping.pcap         one ICMP echo request in cleartext, plus its ACK
  nfn-teams-voice.pcap  15,000 SRTP voice packets (20 ms of G.711 each, five minutes of a call), plus ACKs
  nfn-teams-chat.pcap   36 TLS 1.2 application-data records, five minutes of chat, plus ACKs

The banner regenerates the two Teams flows in the browser with WebCrypto from the same keys
and the same recipe (frame n is a pure function of n), so traffic.json carries only the recipe
and a few sample frames; make-pcap.py is the reference the browser output is checked against.
The banner also decrypts every frame that lands, with the keys printed in traffic.json, and
draws what comes out: the audio samples and the chat text are the decrypted bytes.

The 802.11 link itself is left open (no CCMP) so the headers stay readable. The voice flow is
a Teams call to a phone number through a session border controller with media bypass, so the
media runs straight from the client to the SBC (Microsoft Learn, "Plan for media bypass with
Direct Routing"): client source port in Teams' audio range 50000 to 50019, G.711 mu-law
(payload type 0, which the SBC offers), and SRTP AES_CM_128_HMAC_SHA1_80 keyed by an SDES
master key and salt ("Direct Routing - media protocols"). Session keys come from the RFC 3711
key derivation, the counter block is RFC 3711 4.1.1, the tag is HMAC-SHA1 over the header,
the ciphertext and the rollover counter. The audio is a synthetic, speech-shaped tone, but the
G.711 encoding is real: decrypt a packet and you get 160 samples you can play. The chat flow is
TLS 1.2 with TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384 record protection: separate client and
server write keys and salts, and a sequence number per direction (RFC 5246 6.1 and 6.3,
RFC 5288). Addresses are locally administered MACs and RFC 5737 IPs.

Needs the 'cryptography' package for AES. Run from anywhere; writes next to itself."""
import struct, zlib, json, os, hashlib, hmac, base64
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
IP_STA = bytes([192, 0, 2, 10]); IP_GW = bytes([192, 0, 2, 1]); IP_TEAMS = bytes([203, 0, 113, 40]); IP_SBC = bytes([198, 51, 100, 20])
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
        [2, 2, "Duration", "44 microseconds: one SIFS (16) plus the ACK at 24 Mb/s (28), held on every listener's NAV"],
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

# ── 2. Teams voice: a call to a phone number, SRTP straight from the client to the SBC ──
# Demo keys, printed in traffic.json: anyone can decrypt the capture with them, and the banner does.
SRTP_MASTER_KEY = hashlib.sha256(b"network field notes demo srtp master key").digest()[:16]
SRTP_MASTER_SALT = hashlib.sha256(b"network field notes demo srtp master salt").digest()[:14]
SDES = "inline:" + base64.b64encode(SRTP_MASTER_KEY + SRTP_MASTER_SALT).decode() + "|2^31"
def srtp_kdf(label, n):
    """RFC 3711 4.3.1 and 4.3.3, key derivation rate 0: x = (label || r) XOR master salt,
    right-aligned, with r = 0; the key is the AES-CM keystream under the master key from IV x * 2^16."""
    x = int.from_bytes(SRTP_MASTER_SALT, "big") ^ (label << 48)
    return Cipher(algorithms.AES(SRTP_MASTER_KEY), modes.CTR((x << 16).to_bytes(16, "big"))).encryptor().update(b"\0" * n)
SRTP_KE, SRTP_KA, SRTP_KS = srtp_kdf(0x00, 16), srtp_kdf(0x01, 20), srtp_kdf(0x02, 14)   # encryption, auth, salt
def srtp_iv(ssrc, index):
    """RFC 3711 4.1.1: IV = (k_s * 2^16) XOR (SSRC * 2^64) XOR (i * 2^16), i = ROC || SEQ"""
    return ((int.from_bytes(SRTP_KS, "big") << 16) ^ (ssrc << 64) ^ (index << 16)).to_bytes(16, "big")
def ulaw(sample):
    """ITU-T G.711 mu-law, the Sun reference encoder that audioop and sox use: the 16-bit
    sample drops to 14 bits, then segment, 4 quantisation bits, sign, all bits inverted"""
    pcm = sample >> 2
    if pcm < 0: pcm, mask = -pcm, 0x7F
    else: mask = 0xFF
    pcm = min(pcm, 8159) + 33
    seg = next((i for i, top in enumerate((0x3F, 0x7F, 0xFF, 0x1FF, 0x3FF, 0x7FF, 0xFFF, 0x1FFF)) if pcm <= top), 8)
    return (0x7F ^ mask) if seg >= 8 else (((seg << 4) | ((pcm >> (seg + 1)) & 0xF)) ^ mask)
def speech(n):
    """20 ms at 8 kHz of a synthetic, speech-shaped tone: a 180 Hz voice with a 1210 Hz formant
    under a syllable-like envelope. 160 linear samples."""
    import math
    out = []
    for i in range(160):
        t = n * 0.020 + i / 8000
        env = 0.35 + 0.65 * abs(math.sin(t * 2.1)) * (0.6 + 0.4 * math.sin(t * 13.0))
        out.append(math.floor(12000 * env * (0.7 * math.sin(2 * math.pi * 180 * t) + 0.3 * math.sin(2 * math.pi * 1210 * t + 0.4)) + 0.5))
    return out
# One second of audio (50 packets) encoded once and played on a loop, so the page can rebuild any
# packet from traffic.json alone and get the same bytes in every browser.
AUDIO_LOOP = 50
AUDIO = b"".join(bytes(ulaw(s) for s in speech(k)) for k in range(AUDIO_LOOP))
SSRC = 0x4e464e31
VOICE_SPORT, VOICE_DPORT = 50010, 54056     # Teams audio source range; the SBC's media port (Microsoft's SDP example)
VOICE_N = 15000
voice_frames = []
for n in range(VOICE_N):
    seq, ts = 3100 + n, 0x0a2f7c40 + n * 160            # PCMU: 8 kHz clock, 160 samples per 20 ms
    rtp_hdr = struct.pack("!BBHII", 0x80, 0, seq, ts, SSRC)   # V=2, PT 0 = PCMU (RFC 3551)
    payload = AUDIO[(n % AUDIO_LOOP) * 160:(n % AUDIO_LOOP) * 160 + 160]
    ct = Cipher(algorithms.AES(SRTP_KE), modes.CTR(srtp_iv(SSRC, seq))).encryptor().update(payload)   # ROC 0: seq never wraps
    tag = hmac.new(SRTP_KA, rtp_hdr + ct + b"\0\0\0\0", hashlib.sha1).digest()[:10]              # RFC 3711 4.2: header, ciphertext, ROC
    body = rtp_hdr + ct + tag
    udp = struct.pack("!HHHH", VOICE_SPORT, VOICE_DPORT, 8 + len(body), 0) + body
    ck = csum(IP_STA + IP_SBC + struct.pack("!BBH", 0, 17, len(udp)) + udp) or 0xFFFF
    udp = udp[:6] + struct.pack("!H", ck) + udp[8:]
    fr = dot11(True, 200 + n, ipv4(IP_STA, IP_SBC, 17, udp, 0x3000 + n))
    voice_frames.append(fr.hex())
vf = hdr_fields(True, 200, "UDP", 17, IP_STA, IP_SBC) + [
    [52, 8, "UDP header", "port 50010 (Teams' audio source range) to 54056, the SBC's media port"],
    [60, 12, "RTP header", "version 2, payload type 0 (PCMU, G.711 mu-law), sequence, timestamp (8 kHz clock, +160 per 20 ms), SSRC 0x4e464e31"],
    [72, 160, "SRTP payload", "20 ms of G.711 audio, 160 samples, under AES-128-CTR; without the key it is noise"],
    [232, 10, "SRTP auth tag", "HMAC-SHA1-80 over the RTP header, the ciphertext and the rollover counter; a flipped bit fails it"],
    [242, 4, "FCS", "CRC-32 over everything before it"],
]
vf[4][3] = vf[4][3].replace("the wired side", "the router toward the SBC")
vf[5][3] = "sequence number 200 and up, one per packet"
write_pcap("nfn-teams-voice.pcap", [bytes.fromhex(h) for h in voice_frames])
traffic["voice"] = {"name": "Teams call to a phone (SRTP, G.711)", "pcap": "demo/nfn-teams-voice.pcap", "kind": "voice",
                    "count": VOICE_N, "sample": voice_frames[:8], "fields": [vf],
                    "seq0": 3100, "ts0": 0x0a2f7c40, "ssrc": SSRC, "pt": 0, "clock": 8000, "step": 160,
                    "sport": VOICE_SPORT, "dport": VOICE_DPORT, "dst": ".".join(map(str, IP_SBC)),
                    "audio": base64.b64encode(AUDIO).decode(), "loop": AUDIO_LOOP,
                    "keys": {"sdes": SDES, "master_key": SRTP_MASTER_KEY.hex(), "master_salt": SRTP_MASTER_SALT.hex()},
                    "check": {str(n): hashlib.sha256(bytes.fromhex(voice_frames[n])).hexdigest()[:16] for n in (0, 1, 7, 49, 50, 100, 1000, 14999)},
                    "pcap_bytes": os.path.getsize(os.path.join(here, "nfn-teams-voice.pcap")),
                    "note": "15,000 packets, 20 ms apart, five minutes of a call; UDP, so a lost packet is a gap"}

# ── 3. Teams chat: TLS 1.2 application data over TCP ─────────────────────────
# TLS 1.2 keeps a write key and a 4-byte salt per direction and a sequence number per direction
# (RFC 5246 6.1 and 6.3, RFC 5288); record 0 each way was that side's Finished, so data starts at 1.
TLS_CLIENT_KEY = hashlib.sha256(b"network field notes demo tls client write key").digest()      # AES-256
TLS_SERVER_KEY = hashlib.sha256(b"network field notes demo tls server write key").digest()
TLS_CLIENT_IV = hashlib.sha256(b"network field notes demo tls client write iv").digest()[:4]
TLS_SERVER_IV = hashlib.sha256(b"network field notes demo tls server write iv").digest()[:4]
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
rec_seq = {"you": 1, "tech": 1}
for n, (who, when, text) in enumerate(CHAT):
    to_ds = who == "you"
    plain = json.dumps({"t": "msg", "from": who, "text": text}, separators=(",", ":")).encode()
    # TLS 1.2 AES-GCM record: 8-byte explicit nonce, ciphertext, 16-byte tag. The AAD is this
    # direction's sequence number and the record header; the explicit nonce carries the same number.
    key, salt = (TLS_CLIENT_KEY, TLS_CLIENT_IV) if to_ds else (TLS_SERVER_KEY, TLS_SERVER_IV)
    rs = rec_seq[who]; rec_seq[who] += 1
    explicit = struct.pack("!Q", rs)
    aad = struct.pack("!Q", rs) + bytes([0x17, 0x03, 0x03]) + struct.pack("!H", len(plain))
    ct_tag = AESGCM(key).encrypt(salt + explicit, plain, aad)
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
        [77, 8, "TLS nonce", "explicit nonce for AES-GCM: record %d in this direction" % rs],
        [85, len(plain), "TLS ciphertext", "the JSON message under AES-256-GCM with the %s write key; %d bytes of noise without it" % ("client" if to_ds else "server", len(plain))],
        [85 + len(plain), 16, "TLS auth tag", "GCM tag; a flipped bit fails this before the app ever sees the message"],
        [101 + len(plain), 4, "FCS", "CRC-32 over everything before it"],
    ]
    chat_fields.append(f)
    chat_app.append({"who": who, "t": when, "text": text})
write_pcap("nfn-teams-chat.pcap", [bytes.fromhex(h) for h in chat_frames])
traffic["chat"] = {"name": "Teams chat (TLS over TCP)", "pcap": "demo/nfn-teams-chat.pcap", "kind": "chat",
                   "script": chat_app, "sample": chat_frames[:4], "fields": chat_fields[:4],
                   "suite": "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
                   "keys": {"client_write_key": TLS_CLIENT_KEY.hex(), "client_write_iv": TLS_CLIENT_IV.hex(),
                            "server_write_key": TLS_SERVER_KEY.hex(), "server_write_iv": TLS_SERVER_IV.hex()},
                   "check": {str(n): hashlib.sha256(bytes.fromhex(chat_frames[n])).hexdigest()[:16] for n in range(len(chat_frames))},
                   "note": "%d messages over five minutes, one TLS record each; TCP, so a lost frame is retransmitted and the message arrives late" % len(CHAT)}

open(os.path.join(here, "traffic.json"), "w").write(json.dumps(traffic, separators=(",", ":")))
print("ping   1 frame, %d bytes" % (len(traffic["ping"]["frames"][0]) // 2))
print("voice  %d frames, %d bytes each, pcap %d bytes" % (VOICE_N, len(voice_frames[0]) // 2, os.path.getsize(os.path.join(here, "nfn-teams-voice.pcap"))))
print("chat   %d frames, %d to %d bytes" % (len(chat_frames), min(len(h) for h in chat_frames) // 2, max(len(h) for h in chat_frames) // 2))
print("traffic.json", os.path.getsize(os.path.join(here, "traffic.json")), "bytes")
