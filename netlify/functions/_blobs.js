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

const binderStore    = () => store("binders");
const photoStore     = () => store("photos");
const favoritesStore = () => store("favorites");
const tradesStore    = () => store("trades");

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

async function getFavorites(userId) {
  return (await favoritesStore().get(userId, { type: "json" })) ?? { cards: [] };
}

async function putFavorites(userId, data) {
  await favoritesStore().set(userId, JSON.stringify(data));
}

async function getSentTrades(userId) {
  return (await tradesStore().get(`sent-${userId}`, { type: "json" })) ?? [];
}
async function putSentTrades(userId, trades) {
  await tradesStore().set(`sent-${userId}`, JSON.stringify(trades));
}
async function getReceivedTrades(binderSlug) {
  return (await tradesStore().get(`received-${binderSlug}`, { type: "json" })) ?? [];
}
async function putReceivedTrades(binderSlug, trades) {
  await tradesStore().set(`received-${binderSlug}`, JSON.stringify(trades));
}

const profileStore   = () => store("profiles");

async function getProfileData(userId) {
  return (await profileStore().get(userId, { type: "json" })) ?? {};
}

async function putProfileData(userId, data) {
  await profileStore().set(userId, JSON.stringify(data));
}

const locationStore  = () => store("locations");

async function getLocation(slug) {
  return (await locationStore().get(slug, { type: "json" })) ?? null;
}

async function putLocation(slug, data) {
  await locationStore().set(slug, JSON.stringify(data));
}

const offersStore = () => store("offers");

async function getSentOffers(userId) {
  return (await offersStore().get(`sent-${userId}`, { type: "json" })) ?? [];
}
async function putSentOffers(userId, offers) {
  await offersStore().set(`sent-${userId}`, JSON.stringify(offers));
}
async function getReceivedOffers(binderSlug) {
  return (await offersStore().get(`received-${binderSlug}`, { type: "json" })) ?? [];
}
async function putReceivedOffers(binderSlug, offers) {
  await offersStore().set(`received-${binderSlug}`, JSON.stringify(offers));
}

async function deletePhoto(slug) {
  await photoStore().delete(slug);
}

async function getTradeMessages(tradeId) {
  return (await tradesStore().get(`messages-${tradeId}`, { type: "json" })) ?? [];
}
async function putTradeMessages(tradeId, messages) {
  await tradesStore().set(`messages-${tradeId}`, JSON.stringify(messages));
}

async function getOfferMessages(offerId) {
  return (await offersStore().get(`messages-${offerId}`, { type: "json" })) ?? [];
}
async function putOfferMessages(offerId, messages) {
  await offersStore().set(`messages-${offerId}`, JSON.stringify(messages));
}

module.exports = { getBinder, putBinder, deleteBinder, getManifest, putManifest, putPhoto, getPhoto, deletePhoto, getFavorites, putFavorites, getSentTrades, putSentTrades, getReceivedTrades, putReceivedTrades, getProfileData, putProfileData, getLocation, putLocation, getTradeMessages, putTradeMessages, getSentOffers, putSentOffers, getReceivedOffers, putReceivedOffers, getOfferMessages, putOfferMessages };
