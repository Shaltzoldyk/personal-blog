#!/usr/bin/env python3
"""
build.py — drop a new .html file in /posts/, run this, done.
Regenerates: index.html post list, Feed.xml, sitemap.xml

Usage:  python3 build.py
"""

import os, re
from datetime import datetime, timezone

# ── config ────────────────────────────────────────────────────────────────────
BASE_URL  = "https://www.shaltzsmoldik.xyz"
POSTS_DIR = "posts"
SKIP      = {"template.html", "doom-part1.html"}   # ← add filenames to hide from listing
# ──────────────────────────────────────────────────────────────────────────────

def read_meta(filepath):
    """Pull <title> and <meta name="description"> out of a post file."""
    html = open(filepath, encoding="utf-8").read()

    title = re.search(r"<title>(.+?)\s*\|\s*Shaltz</title>", html)
    title = title.group(1).strip() if title else os.path.basename(filepath)

    desc = re.search(r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']', html)
    desc = desc.group(1).strip() if desc else ""

    # Optional: pull date from <time datetime="YYYY-MM-DD"> if you add one later
    date = re.search(r'<time[^>]+datetime=["\']([\d-]+)["\']', html)
    date = date.group(1) if date else None

    return {"title": title, "desc": desc, "date": date}

def collect_posts():
    posts = []
    for fname in sorted(os.listdir(POSTS_DIR), reverse=True):
        if not fname.endswith(".html") or fname in SKIP:
            continue
        meta = read_meta(os.path.join(POSTS_DIR, fname))
        posts.append({"file": fname, "url": f"{BASE_URL}/posts/{fname}", **meta})
    return posts

# ── index.html ────────────────────────────────────────────────────────────────
def update_index(posts):
    src = open("index.html", encoding="utf-8").read()

    items = "\n".join(
        f'<li>\n<a href="posts/{p["file"]}">\n{p["title"]}\n</a>\n</li>'
        for p in posts
    )
    block = f'\n\n<ul>\n\n{items}\n\n</ul>\n\n'

    updated = re.sub(
        r'(<h2>Start here:</h2>).*?(</div>\s*\n\s*<div class="side-cards">)',
        lambda m: m.group(1) + block + m.group(2),
        src, flags=re.DOTALL
    )
    open("index.html", "w", encoding="utf-8").write(updated)
    print(f"  index.html   — {len(posts)} posts")

# ── Feed.xml ──────────────────────────────────────────────────────────────────
def write_feed(posts):
    now = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    items = ""
    for p in posts:
        pub = f"<pubDate>{p['date']}</pubDate>\n      " if p["date"] else ""
        items += f"""
    <item>
      <title>{p['title']}</title>
      <link>{p['url']}</link>
      <guid>{p['url']}</guid>
      {pub}<description>{p['desc']}</description>
    </item>
"""
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Shaltz</title>
    <link>{BASE_URL}/</link>
    <description>Thoughts on systems, markets, people, and how things actually work.</description>
    <language>en-us</language>
    <lastBuildDate>{now}</lastBuildDate>
    <atom:link href="{BASE_URL}/feed.xml" rel="self" type="application/rss+xml" />
{items}
  </channel>
</rss>"""
    open("Feed.xml", "w", encoding="utf-8").write(xml)
    print(f"  Feed.xml     — {len(posts)} items")

# ── sitemap.xml ───────────────────────────────────────────────────────────────
def write_sitemap(posts):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    urls  = f'  <url>\n    <loc>{BASE_URL}/</loc>\n    <lastmod>{today}</lastmod>\n    <priority>1.0</priority>\n  </url>\n'
    for p in posts:
        lastmod = p["date"] if p["date"] else today
        urls += f'  <url>\n    <loc>{p["url"]}</loc>\n    <lastmod>{lastmod}</lastmod>\n    <priority>0.8</priority>\n  </url>\n'
    xml = f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n{urls}\n</urlset>'
    open("sitemap.xml", "w", encoding="utf-8").write(xml)
    print(f"  sitemap.xml  — {len(posts) + 1} URLs")

# ── run ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Building...")
    posts = collect_posts()
    update_index(posts)
    write_feed(posts)
    write_sitemap(posts)
    print("Done.")
