#!/usr/bin/env python3
"""Build the demo capture the index banner transmits: one 802.11 data frame carrying an
ICMP echo request, plus the ACK that answers it. Writes nfn-ping.pcap (radiotap link type)
and nfn-ping.frame.hex (the 802.11 frame bytes incl. FCS, which is the bitstream the banner sends).
Addresses are locally administered MACs and RFC 5737 IPs, so nothing here is anyone's."""
import struct, zlib, json, os

def csum(b):
    if len(b) % 2: b += b"\0"
    s = sum(struct.unpack("!%dH" % (len(b)//2), b))
    while s >> 16: s = (s & 0xFFFF) + (s >> 16)
    return (~s) & 0xFFFF

AP  = bytes.fromhex("020000000001")   # BSSID / receiver
STA = bytes.fromhex("020000000002")   # the client sending the ping
GW  = bytes.fromhex("020000000003")   # where the ping is going (the wired side)
payload = b"Network Field Notes: this is what cleartext looks like"   # 54 bytes

icmp = struct.pack("!BBHHH", 8, 0, 0, 0x4e46, 1) + payload            # id 'NF', seq 1
icmp = icmp[:2] + struct.pack("!H", csum(icmp)) + icmp[4:]
ip = struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20 + len(icmp), 0x1d4b, 0x4000, 64, 1, 0,
                 bytes([192, 0, 2, 10]), bytes([192, 0, 2, 1]))
ip = ip[:10] + struct.pack("!H", csum(ip)) + ip[12:]
llc = bytes.fromhex("aaaa030000000800")
# 802.11 Data frame, To DS = 1: addr1 = BSSID, addr2 = source STA, addr3 = destination
fc = bytes([0x08, 0x01]); dur = struct.pack("<H", 44); seq = struct.pack("<H", 0x10 << 4)
dot11 = fc + dur + AP + STA + GW + seq + llc + ip + icmp
fcs = struct.pack("<I", zlib.crc32(dot11) & 0xFFFFFFFF)
frame = dot11 + fcs
# the ACK: addr1 = the STA that sent the data
ack = bytes([0xd4, 0x00]) + struct.pack("<H", 0) + STA
ack += struct.pack("<I", zlib.crc32(ack) & 0xFFFFFFFF)

radiotap = struct.pack("<BBHI", 0, 0, 12, 0x00000002 | 0x00000004) + bytes([0x10, 0x6c, 0, 0])  # flags: FCS present; rate 54 Mb/s; pad to 12
def rec(ts_s, ts_us, data):
    return struct.pack("<IIII", ts_s, ts_us, len(data), len(data)) + data
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "nfn-ping.pcap"), "wb") as f:
    f.write(struct.pack("<IHHiIII", 0xa1b2c3d4, 2, 4, 0, 0, 65535, 127))
    f.write(rec(1789000000, 0, radiotap + frame))
    f.write(rec(1789000000, 60, radiotap + ack))
open(os.path.join(here, "nfn-ping.frame.hex"), "w").write(frame.hex())
fields = [
    (0, 2, "Frame Control", "0x0801: type Data, To DS = 1 (client to AP)"),
    (2, 2, "Duration", "44 microseconds reserved for the ACK"),
    (4, 6, "Address 1", "receiver, the AP's BSSID 02:00:00:00:00:01"),
    (10, 6, "Address 2", "transmitter, the client 02:00:00:00:00:02"),
    (16, 6, "Address 3", "final destination 02:00:00:00:00:03, the wired gateway"),
    (22, 2, "Sequence Control", "sequence number 16, fragment 0"),
    (24, 8, "LLC / SNAP", "AA AA 03, OUI 00 00 00, EtherType 0x0800 = IPv4"),
    (32, 20, "IPv4 header", "192.0.2.10 to 192.0.2.1, TTL 64, protocol 1 = ICMP"),
    (52, 8, "ICMP header", "type 8 echo request, id 0x4e46, sequence 1"),
    (60, len(payload), "ICMP payload", "the text, as bytes, in cleartext"),
    (60 + len(payload), 4, "FCS", "CRC-32 over everything before it; one flipped bit anywhere and this no longer matches"),
]
open(os.path.join(here, "nfn-ping.fields.json"), "w").write(json.dumps(fields))
print(len(frame), "byte frame,", len(frame)*8, "bits; ack", len(ack), "bytes; fcs", fcs.hex())
