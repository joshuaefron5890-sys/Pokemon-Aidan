// One-time migration: copies repo photos into Netlify Blobs
// POST /.netlify/functions/seed-photos  (requires SEED_SECRET env var → X-Seed-Key header)

const { getManifest, getBinder, getPhoto, putPhoto } = require("./_blobs");

const GITHUB_REPO  = "joshuaefron5890-sys/Pokemon-Aidan";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

async function fetchBase64(repoPath) {
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${repoPath}?ref=main`,
    { headers }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.content.replace(/\n/g, ""); // GitHub returns base64 with newlines
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const secret = process.env.SEED_SECRET;
  if (!secret || event.headers["x-seed-key"] !== secret) {
    return { statusCode: 403, body: "Forbidden" };
  }

  const results = [];

  // Aidan's photo lives at repo root as Aidan.jpg (not in binders/photos/)
  const aidanAlready = await getPhoto("aidan");
  if (aidanAlready) {
    results.push({ slug: "aidan", status: "skipped — already in Blobs" });
  } else {
    const b64 = await fetchBase64("Aidan.jpg");
    if (b64) {
      await putPhoto("aidan", b64);
      results.push({ slug: "aidan", status: "migrated" });
    } else {
      results.push({ slug: "aidan", status: "not found on GitHub" });
    }
  }

  // Binder photos live at binders/photos/{slug}.jpg
  try {
    const manifest = await getManifest();
    for (const entry of manifest) {
      const binder = await getBinder(entry.slug);
      if (!binder?.hasPhoto) continue;

      const already = await getPhoto(entry.slug);
      if (already) {
        results.push({ slug: entry.slug, status: "skipped — already in Blobs" });
        continue;
      }

      const b64 = await fetchBase64(`binders/photos/${entry.slug}.jpg`);
      if (b64) {
        await putPhoto(entry.slug, b64);
        results.push({ slug: entry.slug, status: "migrated" });
      } else {
        results.push({ slug: entry.slug, status: "not found on GitHub" });
      }
    }
  } catch (err) {
    results.push({ error: err.message });
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total: results.length, results }),
  };
};
