# drafts/

Posts the Airheads Radar's blog runner wrote from an outline Dustin approved. Same idea as `academy/drafts/`: nothing in here is built by `build-blog.py`, so a draft is not live until it is promoted.

Each draft is `<slug>.md` (front matter and body, ready for `posts/`) plus `hero-<slug>.svg` (ready for `graphics/`). Its claim audit is in `audit/<slug>.md`, which this repo ignores like every other audit.

To publish one, in Claude Code from this repo:

> publish the draft <slug>

which reads it, moves the markdown into `posts/` and the hero into `graphics/`, and runs the normal `blog-publish` gates. Delete the draft files once they are promoted.
