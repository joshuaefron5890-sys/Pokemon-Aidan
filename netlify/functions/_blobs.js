// Netlify Blobs helper
// Requires NETLIFY_SITE_ID and NETLIFY_TOKEN set in the Netlify dashboard
// under Site configuration → Environment variables

const { getStore } = require("@netlify/blobs");

function store(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_TOKEN;
  if (siteID && token) {
    return getStore({ name, siteID, token });
  }
  // Fall back to automatic context detection (works when NETLIFY_BLOBS_CONTEXT is injected)
  return getStore(name);
}

const binderStore = () => store("binders");
const photoStore  = () => store("photos");

async function getBinder(slug) {
  return binderStore().get(slug, { type: "json" });
}

async function putBinder(slug, data) {
  await binderStore().set(slug, JSON.stringify(data));
}

async function deleteBinder(slug) {
  await binderStore().delete(slug);
}

async function getManifest() {
  return (await binderStore().get("__manifest", { type: "json" })) ?? [];
}

async function putManifest(manifest) {
  await binderStore().set("__manifest", JSON.stringify(manifest));
}

async function putPhoto(slug, base64Data) {
  const buf = Buffer.from(base64Data, "base64");
  await photoStore().set(slug, buf);
}

async function getPhoto(slug) {
  return photoStore().get(slug, { type: "arrayBuffer" });
}

module.exports = { getBinder, putBinder, deleteBinder, getManifest, putManifest, putPhoto, getPhoto };
