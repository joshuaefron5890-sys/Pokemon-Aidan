/* global netlifyIdentity */

// ── Shared chat state ───────────────────────────────────────
let history = [];
let pendingImage = null;

// ── Auth ────────────────────────────────────────────────────

netlifyIdentity.on("init",   user => user ? showAdmin(user) : showLogin());
netlifyIdentity.on("login",  user => { netlifyIdentity.close(); showAdmin(user); });
netlifyIdentity.on("logout", ()   => showLogin());

document.getElementById("login-btn").addEventListener("click",
  () => netlifyIdentity.open("login"));
document.getElementById("logout-btn").addEventListener("click",
  () => netlifyIdentity.logout());

// Map known admin emails to their binder URLs.
// Add entries here as new admins are created.
const ADMIN_BINDER_MAP = {
  "joshuaefron5890@gmail.com": "/AidanEfron",
};

function binderUrlForUser(user) {
  if (!user) return "/";
  // 1. Explicit binder_url in Netlify Identity user metadata
  if (user.user_metadata?.binder_url) return user.user_metadata.binder_url;
  // 2. Known email mapping
  if (ADMIN_BINDER_MAP[user.email]) return ADMIN_BINDER_MAP[user.email];
  // 3. Derive from full name: "Aidan Efron" → "/AidanEfron"
  const slug = (user.user_metadata?.full_name || "").replace(/\s+/g, "");
  return slug ? `/${slug}` : "/";
}

function showAdmin(user) {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("admin-app").classList.remove("hidden");
  document.getElementById("user-email").textContent = user.email;

  const binderUrl = binderUrlForUser(user);
  document.getElementById("binder-iframe").src = binderUrl;
  const pubLink = document.getElementById("view-public-link");
  if (pubLink) pubLink.href = binderUrl;

  showView("binder");
}

function showLogin() {
  document.getElementById("admin-app").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
}

// ── Navigation ──────────────────────────────────────────────

const VIEW_LABELS = {
  binder:    "My Binder",
  shared:    "Shared Binders",
  assistant: "Card Assistant",  // accessed via popup full-screen button
};

function showView(id) {
  // Hide all views
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  // Show target
  const target = document.getElementById(`view-${id}`);
  if (target) target.classList.remove("hidden");

  // Update nav active state
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === id);
  });

  // Update mobile title
  const mobileTitle = document.getElementById("mobile-title");
  if (mobileTitle) mobileTitle.textContent = VIEW_LABELS[id] || id;

  // Close sidebar on mobile
  document.getElementById("sidebar").classList.remove("open");
}

document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
  btn.addEventListener("click", () => {
    showView(btn.dataset.view);
    if (btn.dataset.view === "shared") loadSharedBinders();
  });
});

// ── Dynamic binder gallery ──────────────────────────────────

let sharedLoaded = false;

async function loadSharedBinders() {
  if (sharedLoaded) return;
  sharedLoaded = true;

  const grid = document.querySelector(".binders-grid");
  if (!grid) return;

  try {
    const res  = await fetch("/.netlify/functions/list-binders");
    const list = await res.json();
    if (!Array.isArray(list)) return;

    list.forEach(b => {
      // Skip slugs already shown as static cards
      if (grid.querySelector(`[href="/binder/${b.slug}"]`)) return;

      const initial = b.owner.charAt(0).toUpperCase();
      const colors  = ["#6366f1,#8b5cf6", "#f59e0b,#ef4444", "#10b981,#059669", "#3b82f6,#2563eb"];
      const grad    = colors[b.slug.charCodeAt(0) % colors.length];

      const avatarInner = b.photoUrl
        ? `<img src="${b.photoUrl}" alt="${initial}" onerror="this.remove()" />`
        : initial;

      const card = document.createElement("a");
      card.className = "binder-card";
      card.href = `/binder/${b.slug}`;
      card.target = "_blank";
      card.rel = "noopener";
      card.innerHTML = `
        <div class="binder-card-avatar ${b.photoUrl ? "binder-card-avatar--photo" : ""}" style="background:linear-gradient(135deg,${grad})">${avatarInner}</div>
        <div class="binder-card-info">
          <div class="binder-card-name">${b.owner}'s Binder</div>
          <div class="binder-card-meta">${b.cardCount || 0} card${b.cardCount !== 1 ? "s" : ""}</div>
        </div>
        <div class="binder-card-badge">View</div>`;
      grid.appendChild(card);
    });
  } catch {}
}

// Mobile sidebar toggle
document.getElementById("hamburger")?.addEventListener("click", () =>
  document.getElementById("sidebar").classList.toggle("open"));
document.getElementById("sidebar-close")?.addEventListener("click", () =>
  document.getElementById("sidebar").classList.remove("open"));

// ── Image handling (shared) ─────────────────────────────────

document.getElementById("image-upload").addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) readImage(file);
});
document.getElementById("remove-image").addEventListener("click", clearImage);

document.addEventListener("paste", e => {
  const item = [...e.clipboardData.items].find(i => i.type.startsWith("image/"));
  if (item) readImage(item.getAsFile());
});

function readImage(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const [, data] = ev.target.result.split(",");
    pendingImage = { data, mediaType: file.type };
    document.getElementById("preview-img").src = ev.target.result;
    document.getElementById("popup-preview-img").src = ev.target.result;
    document.getElementById("image-preview-row").classList.remove("hidden");
    document.getElementById("popup-image-preview-row").classList.remove("hidden");
    updateSendBtns();
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  pendingImage = null;
  document.getElementById("image-preview-row").classList.add("hidden");
  document.getElementById("popup-image-preview-row").classList.add("hidden");
  document.getElementById("image-upload").value = "";
  document.getElementById("popup-image-upload").value = "";
  updateSendBtns();
}

document.getElementById("popup-remove-image").addEventListener("click", clearImage);

// ── Chat inputs (sidebar assistant) ────────────────────────

const chatInput = document.getElementById("chat-input");
const sendBtn   = document.getElementById("send-btn");

chatInput.addEventListener("input", () => {
  updateSendBtns();
  autoResize(chatInput);
});
chatInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) sendMessage(false); }
});
sendBtn.addEventListener("click", () => sendMessage(false));

// ── Chat inputs (floating popup) ───────────────────────────

const popupInput   = document.getElementById("popup-chat-input");
const popupSendBtn = document.getElementById("popup-send-btn");

popupInput.addEventListener("input", () => {
  updateSendBtns();
  autoResize(popupInput);
});
popupInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!popupSendBtn.disabled) sendMessage(true); }
});
popupSendBtn.addEventListener("click", () => sendMessage(true));

document.getElementById("popup-image-upload").addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) readImage(file);
});

function updateSendBtns() {
  sendBtn.disabled      = !(chatInput.value.trim()   || pendingImage);
  popupSendBtn.disabled = !(popupInput.value.trim()  || pendingImage);
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

// ── Floating chat bubble ────────────────────────────────────

const bubble  = document.getElementById("chat-bubble");
const popup   = document.getElementById("chat-popup");
const popupClose = document.getElementById("popup-close");

bubble.addEventListener("click", () => {
  const isOpen = popup.classList.toggle("open");
  bubble.classList.toggle("active", isOpen);
  if (isOpen) popupInput.focus();
});

popupClose.addEventListener("click", () => {
  popup.classList.remove("open");
  bubble.classList.remove("active");
});

document.getElementById("popup-fullscreen").addEventListener("click", () => {
  popup.classList.remove("open");
  bubble.classList.remove("active");
  showView("assistant");
});

// ── Core send function ──────────────────────────────────────

async function sendMessage(isPopup) {
  const input = isPopup ? popupInput : chatInput;
  const text  = input.value.trim();
  if (!text && !pendingImage) return;

  const content = [];
  if (pendingImage) {
    content.push({ type: "image", source: { type: "base64", media_type: pendingImage.mediaType, data: pendingImage.data } });
  }
  if (text) content.push({ type: "text", text });

  // Append to BOTH message lists
  appendMessage("user", text || "📷 Card image", false);
  appendMessage("user", text || "📷 Card image", true);

  history.push({
    role: "user",
    content: content.length === 1 && content[0].type === "text" ? text : content,
  });

  input.value = "";
  input.style.height = "auto";
  clearImage();

  const typing1 = appendTyping(false);
  const typing2 = appendTyping(true);

  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const res = await fetch("/.netlify/functions/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: history }),
    });
    const data = await res.json();
    typing1.remove();
    typing2.remove();

    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

    history.push({ role: "assistant", content: data.reply });
    appendMessage("assistant", data.reply, false);
    appendMessage("assistant", data.reply, true);
  } catch (err) {
    typing1.remove();
    typing2.remove();
    appendMessage("error", `⚠️ ${err.message}`, false);
    appendMessage("error", `⚠️ ${err.message}`, true);
  }
}

// ── Render helpers ──────────────────────────────────────────

function appendMessage(role, text, isPopup) {
  const listEl = isPopup
    ? document.getElementById("popup-messages")
    : document.getElementById("messages");

  const cardsMatch = text.match ? text.match(/<cards>([\s\S]*?)<\/cards>/) : null;
  const displayText = text.replace ? text.replace(/<cards>[\s\S]*?<\/cards>/g, "").trim() : text;

  const wrap = document.createElement("div");
  wrap.className = `message ${role}`;

  if (role === "assistant") {
    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = "🤖";
    wrap.appendChild(av);
  }

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML = displayText
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
  wrap.appendChild(bubble);

  if (cardsMatch && !isPopup) {
    try {
      const cards = JSON.parse(cardsMatch[1]);
      if (cards.length) {
        const grid = document.createElement("div");
        grid.className = "cards-thumb-grid";
        cards.slice(0, 30).forEach(card => {
          const lastDash = card.cardId.lastIndexOf("-");
          const setId = card.cardId.slice(0, lastDash);
          const num   = card.cardId.slice(lastDash + 1);
          const img   = document.createElement("img");
          img.src     = `https://images.pokemontcg.io/${setId}/${num}.png`;
          img.alt     = card.query;
          img.title   = card.query;
          img.className = "card-thumb";
          img.onerror = () => img.remove();
          grid.appendChild(img);
        });
        wrap.appendChild(grid);
      }
    } catch (_) {}
  }

  listEl.appendChild(wrap);
  listEl.scrollTop = listEl.scrollHeight;
  return wrap;
}

function appendTyping(isPopup) {
  const listEl = isPopup
    ? document.getElementById("popup-messages")
    : document.getElementById("messages");

  const wrap = document.createElement("div");
  wrap.className = "message assistant";
  wrap.innerHTML = `<div class="avatar">🤖</div><div class="message-bubble typing"><span></span><span></span><span></span></div>`;
  listEl.appendChild(wrap);
  listEl.scrollTop = listEl.scrollHeight;
  return wrap;
}
