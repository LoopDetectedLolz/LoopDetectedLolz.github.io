#!/usr/bin/env python3
"""Build the CX Sandbox's real-command corpus from `list` output captured on the AOS-CX Switch Simulator.

    python3 cxcorpus.py 10.15.1060=~/Lab/aos-cx/harvest/10.15 10.16.1060=~/Lab/aos-cx/harvest/10.16 \\
                        10.17.1030=~/Lab/aos-cx/harvest/10.17 10.18.1002=~/Lab/aos-cx/audit-2026-09-28/corpus

reads, per release, one file per CLI context (exec.txt, config.txt, if.txt, ...: the raw lines `list` printed in
that context) and writes theme/cxsim/corpus/aoscx.js: one token trie per context with every release merged in,
which the engine uses to tell a real command it does not model ("not used in this scenario") from one the box
would refuse ("Invalid input: <token>"), in whichever release the reader picked.

Only command syntax goes into the repo. The raw captures stay in the lab folder: they carry the simulator's
license banner and, in other logs, ciphertext secrets.

The simulator's ports are virtual, so its CLI hides what needs a PHY (since 10.09 the CLI hides speeds the
hardware lacks, and cable diagnostics need a copper port). theme/cxsim/corpus/hardware.txt adds those back,
by context, with the HPE guide each line came from; a section can carry since=10.xx.

The trie is built per context and release, the releases are merged, identical subtrees are shared (about 55k
paths per release collapse to a few thousand nodes), and it is written compactly: `v` lists [release, build]
oldest first, bit 0 being the first; `t` is the keyword table (space separated); `n` the nodes separated by "|",
each the bitmask of releases in which it ends a command, then ",<token>.<child>[.<releases>]" per edge in base 36,
the release mask left off when the edge exists in all of them. A negative token is a placeholder class: -1 number
or range list, -2 IPv4, -3 IPv4 prefix, -4 IPv6, -5 interface, -6 MAC, -7 any word, -8 rest of line. `r` maps each
context to its root node and `h` to the releases it was harvested in. Choice groups with more than 40
single-word alternatives (time zones and the like) become "any word".
"""
import json, os, re, sys

CTX_FILES = ["exec", "config", "if", "lag", "svi", "vlan", "pa-role", "lldp-group", "device-profile", "ubt-zone",
             "dot1x", "macauth", "if-dot1x", "if-macauth", "sg", "ospf"]
SKIP = {"list", "show context", "show running-config current-context"}
CAP = 256          # expansions per template; the empty choice of each optional group comes first, so minimal forms survive


def ph_class(t):
    if re.fullmatch(r"<[A-Za-z]?:?-?\d+-\d+>", t) or re.fullmatch(r"<\d+>", t):
        return "N"
    if t.startswith("<") and t.endswith(">"):
        return "W"
    if t == "A.B.C.D":
        return "IP4"
    if t == "A.B.C.D/M":
        return "IP4P"
    if t.startswith("X:X::X:X"):
        return "IP6"
    if t in ("IFNAME", "IFNAME_R", "IFRANGE", "IFNAME.ID", "LAGNUM.ID", "IFNAME_LIST", "PORT", "IFNAME_RANGE"):
        return "IF"
    if t in ("MAC", "XX:XX:XX:XX:XX:XX", "MAC-ADDRESS", "MAC_ADDRESS"):
        return "MAC"
    if t.startswith(".") and len(t) > 1:
        return "L"
    if re.fullmatch(r"[A-Z][A-Z0-9_.\-]+", t) or t in ("ASN:nn", "AA:NN"):
        return "W"
    return None


def tokenize(line):
    s = re.sub(r"([(){}\[\]|])", r" \1 ", line)
    return [t for t in s.split() if t]


def parse(tokens):
    """-> sequence: list of items; item = ("lit", t) | ("ph", cls) | ("grp", optional, [seq, ...])"""
    pos = 0

    def seq(stop):
        nonlocal pos
        items = []
        while pos < len(tokens):
            t = tokens[pos]
            if t in stop or t == "|":
                return items
            pos += 1
            if t in "({[":
                close = {"(": ")", "{": "}", "[": "]"}[t]
                alts = [seq({close})]
                while pos < len(tokens) and tokens[pos] == "|":
                    pos += 1
                    alts.append(seq({close}))
                if pos < len(tokens) and tokens[pos] == close:
                    pos += 1
                alts = [a for a in alts if a] or [[]]
                optional = t != "("
                if not optional and len(alts) > 40 and all(len(a) == 1 and a[0][0] == "lit" for a in alts):
                    items.append(("ph", "W"))
                    continue
                items.append(("grp", optional, alts))
            elif t in ")}]":
                continue            # stray closer from a malformed template
            else:
                c = ph_class(t)
                items.append(("ph", c) if c else ("lit", t.lower()))
        return items

    top = [seq(set())]
    while pos < len(tokens):        # top-level alternatives, rare
        if tokens[pos] == "|":
            pos += 1
            top.append(seq(set()))
        else:
            pos += 1
    return top


def expand(items):
    outs = [[]]
    for it in items:
        if it[0] in ("lit", "ph"):
            outs = [o + [it] for o in outs]
            continue
        _, optional, alts = it
        choices = ([[]] if optional else []) + [e for a in alts for e in expand(a)]
        nxt = []
        for o in outs:
            for c in choices:
                nxt.append(o + c)
                if len(nxt) >= CAP:
                    break
            if len(nxt) >= CAP:
                break
        outs = nxt
    return outs


def insert(root, path):
    node = root
    for kind, val in path:
        key = "k" if kind == "lit" else "w"
        node = node.setdefault(key, {}).setdefault(val, {})
    node["e"] = 1


def vkey(v):
    return tuple(int(x) for x in re.findall(r"\d+", v)[:2])


def hardware(version):
    """theme/cxsim/corpus/hardware.txt: commands real hardware has and the simulator hides, by context,
    each section optionally `since=10.xx`. Syntax comes from HPE's guides; the file says which."""
    f = os.path.join(os.path.dirname(os.path.abspath(__file__)), "theme", "cxsim", "corpus", "hardware.txt")
    out, ctx, ok = {}, None, True
    if not os.path.exists(f):
        return out
    for raw in open(f, encoding="utf-8"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.fullmatch(r"\[(\S+)(?:\s+since=(\S+))?\]", line)
        if m:
            ctx, ok = m.group(1), not m.group(2) or vkey(version) >= vkey(m.group(2))
            continue
        if ctx and ok:
            out.setdefault(ctx, []).append(line)
    return out


def build(corpus_dir, version="10.18"):
    out, stats, extra = {}, {}, hardware(version)
    for ctx in CTX_FILES:
        f = os.path.join(corpus_dir, ctx + ".txt")
        if not os.path.exists(f):
            continue
        lines = [raw.replace("\r", "").strip() for raw in open(f, encoding="utf-8", errors="replace")]
        root, n = {}, 0
        for line in lines + extra.get(ctx, []):
            if not line or line in SKIP or line.startswith("#"):
                continue
            for alt in parse(tokenize(line)):
                for path in expand(alt):
                    if path:
                        insert(root, path)
                        n += 1
        out[ctx] = root
        stats[ctx] = n
    return out, stats


PH_CODE = {"N": -1, "IP4": -2, "IP4P": -3, "IP6": -4, "IF": -5, "MAC": -6, "W": -7, "L": -8}


def b36(x):
    neg, x, s = x < 0, abs(int(x)), ""
    while True:
        s = "0123456789abcdefghijklmnopqrstuvwxyz"[x % 36] + s
        x //= 36
        if x == 0:
            break
    return ("-" if neg else "") + s


def pack(tries):
    """tries: [(bit, {ctx: trie})] -> one merged trie. Every edge carries the set of releases it exists in
    (a bitmask, left off when it is all of them) and every node the set it ends a command in."""
    toks, nodes, memo = {}, [], {}
    allmask = 0
    for bit, _ in tries:
        allmask |= bit

    def tid(t):
        if t not in toks:
            toks[t] = len(toks)
        return toks[t]

    def enc(group):                        # group: [(bit, node)] for the releases that reach this node
        emask = 0
        for bit, n in group:
            if n.get("e"):
                emask |= bit
        kids = []
        for kind, code in (("k", tid), ("w", lambda c: PH_CODE[c])):
            names = sorted({t for _, n in group for t in n.get(kind, {})})
            for t in names:
                sub = [(bit, n[kind][t]) for bit, n in group if t in n.get(kind, {})]
                mask = 0
                for bit, _ in sub:
                    mask |= bit
                kids.append((code(t), enc(sub), mask))
        key = (emask, tuple(kids))
        if key not in memo:
            memo[key] = len(nodes)
            nodes.append(key)
        return memo[key]

    ctxs = sorted({c for _, t in tries for c in t})
    roots, harvested = {}, {}
    for ctx in ctxs:
        group = [(bit, t[ctx]) for bit, t in tries if ctx in t]
        roots[ctx] = enc(group)
        harvested[ctx] = sum(bit for bit, _ in group)

    def one(e, kids):
        return b36(e) + "".join("," + b36(t) + "." + b36(c) + ("" if m == allmask else "." + b36(m)) for t, c, m in kids)
    flat = "|".join(one(e, kids) for e, kids in nodes)
    return {"t": " ".join(sorted(toks, key=toks.get)), "n": flat, "r": roots, "h": harvested}, len(nodes)


USAGE = """usage: cxcorpus.py <build>=<corpus-dir> [<build>=<corpus-dir> ...]
  e.g. cxcorpus.py 10.15.1060=~/Lab/aos-cx/harvest/10.15 ... 10.18.1002=~/Lab/aos-cx/audit-2026-09-28/corpus
writes theme/cxsim/corpus/aoscx.js with every release merged into one trie"""

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if "=" in a]
    if not args:
        sys.exit(USAGE)
    builds = sorted((a.split("=", 1) for a in args), key=lambda p: vkey(p[0]) + tuple(int(x) for x in re.findall(r"\d+", p[0])[2:3]))
    tries, stats, rel = [], {}, []
    for i, (build_no, d) in enumerate(builds):
        release = ".".join(build_no.split(".")[:2])
        trie, st = build(os.path.expanduser(d), release)
        tries.append((1 << i, trie))
        stats[release] = sum(st.values())
        rel.append([release, build_no])
    packed, nnodes = pack(tries)
    here = os.path.dirname(os.path.abspath(__file__))
    dest = os.path.join(here, "theme", "cxsim", "corpus")
    os.makedirs(dest, exist_ok=True)
    packed.update({"v": rel, "source": "AOS-CX Switch Simulator, `list` in each context, one run per release"})
    body = json.dumps(packed, separators=(",", ":"), sort_keys=True)
    path = os.path.join(dest, "aoscx.js")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("/* Real AOS-CX command syntax for %s, harvested with `list` on the Switch Simulator and merged by cxcorpus.py. Generated; do not edit. */\n" % ", ".join(r[1] for r in rel))
        fh.write("(function (r) { var c = %s; if (typeof module === \"object\" && module.exports) module.exports = c; else r.CXCorpus = c; })(typeof self !== \"undefined\" ? self : this);\n" % body)
    print("wrote %s (%d bytes, %d nodes); paths per release: %s" % (path, os.path.getsize(path), nnodes, json.dumps(stats)), file=sys.stderr)
