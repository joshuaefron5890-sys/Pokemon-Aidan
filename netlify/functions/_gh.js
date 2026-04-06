// Shared GitHub file helpers — used by binder functions

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = "joshuaefron5890-sys/Pokemon-Aidan";
const GH_API       = `https://api.github.com/repos/${GITHUB_REPO}/contents`;

async function getFile(path) {
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const res = await fetch(`${GH_API}/${path}?ref=main`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub read "${path}" failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data    = await res.json();
  const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
  return { content, sha: data.sha };
}

async function putFile(path, content, sha, message) {
  const body = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch:  "main",
  };
  if (sha) body.sha = sha;

  const res = await fetch(`${GH_API}/${path}`, {
    method:  "PUT",
    headers: {
      Authorization:  `Bearer ${GITHUB_TOKEN}`,
      Accept:         "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub write "${path}" failed: ${JSON.stringify(err)}`);
  }
  return res.json();
}

// Store a binary file (e.g. an image) — base64Data is already base64 encoded
async function putBinaryFile(path, base64Data, sha, message) {
  const body = { message, content: base64Data, branch: "main" };
  if (sha) body.sha = sha;

  const res = await fetch(`${GH_API}/${path}`, {
    method:  "PUT",
    headers: {
      Authorization:  `Bearer ${GITHUB_TOKEN}`,
      Accept:         "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub write "${path}" failed: ${JSON.stringify(err)}`);
  }
  return res.json();
}

module.exports = { getFile, putFile, putBinaryFile };
