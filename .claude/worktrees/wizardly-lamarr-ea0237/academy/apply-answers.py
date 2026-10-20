#!/usr/bin/env python3
"""Put approved self-check answers into the Academy lessons.

Reads academy/drafts/answers-01-12.md (one "### Lesson N" block per lesson, each with a "## Answers" list) and,
for each lesson asked for, rewrites posts/academy-NN-*.md so its Three questions section reads:

    ## Three questions

    1. ...
    2. ...
    3. ...

    ## Answers

    1. ...
    2. ...
    3. ...

The old one-line "Answers: ..." paragraph goes, a question paragraph (lesson 1) becomes a numbered list, and
build-blog.py turns the pair into the reveal-and-grade self-check. A lesson that already has "## Answers" is
left alone. Run from the repo root.

    python3 academy/apply-answers.py --dry-run          # show what would change
    python3 academy/apply-answers.py --lessons 1,2,3    # just these
    python3 academy/apply-answers.py                    # every lesson in the drafts file
"""
import argparse, difflib, glob, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAFTS = os.path.join(ROOT, "academy", "drafts", "answers-01-12.md")
NUM = re.compile(r"^(\d+)\.\s+(.*)$")


def numbered(block):
    """The '1. ... 2. ... 3. ...' lines of a block, as a list of strings."""
    out = []
    for line in block.splitlines():
        m = NUM.match(line.strip())
        if m:
            out.append(m.group(2).strip())
    return out


def drafts():
    text = open(DRAFTS, encoding="utf-8").read()
    lessons = {}
    for m in re.finditer(r"^### Lesson (\d+):.*?(?=^### Lesson |\Z)", text, re.S | re.M):
        n, block = int(m.group(1)), m.group(0)
        q = re.search(r"Questions, verbatim from the lesson:\n(.*?)\n\n", block, re.S)
        a = re.search(r"^## Answers\n\n(.*?)\n\n", block, re.S | re.M)
        if not a:
            sys.exit("lesson %d: no '## Answers' list in the drafts file" % n)
        lessons[n] = {"questions": numbered(q.group(1)) if q else [], "answers": numbered(a.group(1))}
        if len(lessons[n]["answers"]) != 3:
            sys.exit("lesson %d: %d answers, expected 3" % (n, len(lessons[n]["answers"])))
    return lessons


def rewrite(md, d, n):
    head = md.find("## Three questions\n")
    if head < 0:
        sys.exit("lesson %d: no '## Three questions' heading" % n)
    nxt = md.find("\n## ", head + 5)
    nxt = len(md) if nxt < 0 else nxt + 1
    section = md[head:nxt]
    if re.search(r"^## Answers\s*$", md, re.M):
        return None                                   # already done
    paras = [p for p in re.split(r"\n\s*\n", section.split("\n", 1)[1].strip()) if p.strip()]
    paras = [p for p in paras if not p.lstrip().startswith("Answers:")]
    if not paras:
        sys.exit("lesson %d: no questions under the heading" % n)
    qs = numbered(paras[0])
    if len(qs) != 3:
        qs = d["questions"]                           # a paragraph of questions (lesson 1): use the verbatim list
    if len(qs) != 3:
        sys.exit("lesson %d: could not find three questions" % n)
    extra = paras[1:]                                 # anything else the section held stays, after the answers
    body = "## Three questions\n\n" + "\n".join("%d. %s" % (i + 1, q) for i, q in enumerate(qs))
    body += "\n\n## Answers\n\n" + "\n".join("%d. %s" % (i + 1, a) for i, a in enumerate(d["answers"]))
    if extra:
        body += "\n\n" + "\n\n".join(extra)
    return md[:head] + body + "\n\n" + md[nxt:]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lessons", help="comma-separated lesson numbers (default: every lesson in the drafts file)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    d = drafts()
    want = sorted(d) if not a.lessons else [int(x) for x in a.lessons.split(",")]
    for n in want:
        if n not in d:
            sys.exit("lesson %d is not in the drafts file" % n)
        paths = glob.glob(os.path.join(ROOT, "posts", "academy-%02d-*.md" % n))
        if len(paths) != 1:
            sys.exit("lesson %d: expected one post, found %d" % (n, len(paths)))
        md = open(paths[0], encoding="utf-8").read()
        new = rewrite(md, d[n], n)
        if new is None:
            print("lesson %2d: already has an Answers section, left alone" % n)
            continue
        if a.dry_run:
            sys.stdout.writelines(difflib.unified_diff(md.splitlines(True), new.splitlines(True), paths[0], paths[0] + " (new)", n=1))
        else:
            open(paths[0], "w", encoding="utf-8").write(new)
            print("lesson %2d: answers in, %s" % (n, os.path.basename(paths[0])))


if __name__ == "__main__":
    main()
