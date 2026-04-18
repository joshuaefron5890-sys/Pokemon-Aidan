// Netlify Blobs helper — replaces _gh.js for binder data storage
// No SHA-based concurrency needed; Blobs handles consistency natively

const { getStore } = require("@netlify/blobs");

const binderStore = () => getStore("binders");
const photoStore  = () => getStore("photos");

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
