// GET /.netlify/functions/instagram
// Latest Instagram posts for the homepage grid: [{ link, image, caption }].
// Reads the public SnapWidget feed (widget 1129205) server-side, so visitors
// don't load SnapWidget's iframe, scripts and trackers. Netlify's CDN caches
// the result for an hour; Instagram's image links expire after a few days, so
// a fresh copy is fetched regularly.
const WIDGET_URL = "https://snapwidget.com/embed/1129205";

function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

exports.handler = async () => {
  try {
    const res = await fetch(WIDGET_URL, { headers: { "User-Agent": "Mozilla/5.0 (resetcleaninggroup.com)" } });
    if (!res.ok) throw new Error(`SnapWidget returned ${res.status}`);
    const html = await res.text();

    // Each post appears in a block starting at its data-link (sometimes twice);
    // collect the image and caption from whichever block has them.
    const byLink = new Map();
    for (const part of html.split('data-link="').slice(1)) {
      const link = decode(part.slice(0, part.indexOf('"')));
      if (!/^https:\/\/www\.instagram\.com\//.test(link)) continue;
      const post = byLink.get(link) || { link, image: "", caption: "" };
      const img = /data-src-large="([^"]+)"/.exec(part) || /data-src-medium="([^"]+)"/.exec(part);
      if (img && !post.image) post.image = decode(img[1]);
      const alt = /alt="([^"]+)"/.exec(part);
      if (alt && !post.caption) post.caption = decode(alt[1]).replace(/#\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
      byLink.set(link, post);
    }
    const posts = [...byLink.values()].filter((p) => p.image).slice(0, 9);
    if (!posts.length) throw new Error("No posts found in the SnapWidget feed");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
        "Netlify-CDN-Cache-Control": "public, durable, s-maxage=3600, stale-while-revalidate=86400",
      },
      body: JSON.stringify({ posts }),
    };
  } catch (err) {
    console.error("Instagram feed failed:", err.message);
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ posts: [] }),
    };
  }
};
