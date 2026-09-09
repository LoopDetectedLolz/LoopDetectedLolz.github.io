# Ask Me How I Know

Field notes from campus networks, wireless, NAC, and the forum threads that keep asking the same question.

Written by Dustin Burns. Personal site, personal opinions. Configs are scrubbed placeholders, customers are never named.

## Building

The site is generated from markdown and hand-drawn SVG by a single script. No framework, no dependencies beyond one markdown parser.

```
python3 -m pip install --user markdown   # once
python3 build-blog.py
```

That writes:

- `index.html` — home, community and about, with post cards
- `p/<slug>.html` — one standalone page per post, each with its own canonical URL and preview card
- `og/<slug>.png` — 1200x630 social preview images, rendered from SVG with `rsvg-convert`
- `sitemap.xml`, `rss.xml`, `robots.txt`

## Writing a post

Drop a markdown file in `posts/` with front matter:

```
---
title: Your ClearPass SAML Login Validates and Still Fails
slug: saml-login-validates-and-still-fails
date: 2026-09-05
tags: ClearPass, Security, Entra ID, SAML
hero: hero-saml.svg
summary: One or two sentences. Used for the card, the meta description, and RSS.
origin: Where the question came from
---
```

Add the matching hero graphic to `graphics/`, rebuild, done. Read time is calculated from word count.

## Configuration

`SITE` and `BASE_URL` at the top of `build-blog.py`. Set `CUSTOM_DOMAIN` to write a `CNAME` file for GitHub Pages.
