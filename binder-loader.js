// Prevents app.js from auto-initializing (must be set before app.js runs)
window.BINDER_LOADER = true;

// ── Binder initialization ──────────────────────────────────

async function initBinder() {
  // Extract slug from path: /binder/slug or /binder/slug/
  const slug = location.pathname.replace(/^\/binder\//, "").replace(/\/$/, "").split("/")[0];
  if (!slug) { showError("No binder specified."); return; }

  const token = window.netlifyIdentity?.currentUser()?.token?.access_token;

  // Retry up to 3× for 404 — GitHub's API can take a few seconds to propagate
  // a newly-created binder file after the create-binder function writes it.
  let res, data;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      showError(`Setting up your binder… (attempt ${attempt + 1}/3)`);
      await new Promise(r => setTimeout(r, attempt * 3000));
    }
    try {
      res  = await fetch(`/.netlify/functions/get-binder?slug=${encodeURIComponent(slug)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      data = await res.json();
    } catch (err) {
      console.error("initBinder fetch error:", err);
      showError("Failed to load binder. Please try again.");
      return;
    }
    if (res.status !== 404) break; // 404 = may not be propagated yet; retry
  }

  try {
    if (res.status === 403 && data.error === "private") {
      showPrivateLock(data.owner); return;
    }
    if (!res.ok) { showError(data.error || "Binder not found."); return; }

    // Populate page header
    document.title = `${data.owner}'s Pokémon Collection`;
    const titleEl = document.getElementById("page-title");
    if (titleEl) titleEl.textContent = `${data.owner}'s Pokémon Collection`;

    // Show profile photo if available
    if (data.photoUrl) {
      const wrap = document.getElementById("header-photo-wrap");
      const img  = document.getElementById("header-photo");
      if (wrap && img) {
        img.src = data.photoUrl;
        img.alt = data.owner;
        wrap.classList.remove("hidden");
      }
    }

    // Set CARD_LIST for app.js
    window.CARD_LIST = (data.cards || []).map(c => ({
      query:         c.query,
      cardId:        c.cardId,
      setName:       c.setName,
      tcgUrl:        c.tcgUrl,
      imageUrl:      c.imageUrl,
      fallbackPrice: c.fallbackPrice,
      grade:         c.grade,
    }));

    // Show owner tools if this is their binder
    if (data.isOwner) initOwnerBubble(slug, data.owner);

    // Kick off the card grid
    loadCollection();
  } catch (err) {
    console.error("initBinder error:", err);
    showError("Failed to load binder. Please try again.");
  }
}

function showError(msg) {
  const el = document.getElementById("loading-status");
  if (el) el.textContent = msg;
}

function showPrivateLock(owner) {
  showError("");
  const lock = document.getElementById("private-lock");
  if (!lock) return;
  const nameEl = lock.querySelector(".lock-owner");
  if (nameEl) nameEl.textContent = `${owner}'s Binder`;
  lock.classList.remove("hidden");

  lock.querySelector(".lock-login-btn")?.addEventListener("click", () => {
    window.netlifyIdentity?.open("login");
  });

  window.netlifyIdentity?.on("login", () => {
    window.netlifyIdentity.close();
    lock.classList.add("hidden");
    initBinder();
  });
}

// ── Owner chat bubble ──────────────────────────────────────

let binderChatHistory = [];

function initOwnerBubble(slug, owner) {
  const bubble   = document.getElementById("owner-bubble");
  const popup    = document.getElementById("owner-popup");
  const closeBtn = document.getElementById("owner-popup-close");
  if (!bubble) return;

  bubble.classList.remove("hidden");

  bubble.addEventListener("click", () => {
    const isOpen = popup.classList.toggle("open");
    bubble.classList.toggle("active", isOpen);
    if (isOpen) document.getElementById("binder-chat-input")?.focus();
  });

  closeBtn?.addEventListener("click", () => {
    popup.classList.remove("open");
    bubble.classList.remove("active");
  });

  wireBinderChat(slug, owner);
}

function wireBinderChat(slug) {
  const input   = document.getElementById("binder-chat-input");
  const sendBtn = document.getElementById("binder-send-btn");

  if (!input || !sendBtn) return;

  input.addEventListener("input", () => {
    sendBtn.disabled = !input.value.trim();
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendBinderMsg(slug);
    }
  });

  sendBtn.addEventListener("click", () => sendBinderMsg(slug));
}

async function sendBinderMsg(slug) {
  const input   = document.getElementById("binder-chat-input");
  const sendBtn = document.getElementById("binder-send-btn");
  const msgs    = document.getElementById("binder-popup-messages");
  const text = input.value.trim();
  if (!text) return;

  appendBinderBubble("user", text, msgs);
  binderChatHistory.push({ role: "user", content: text });
  input.value = "";
  input.style.height = "auto";
  sendBtn.disabled = true;

  const typing = appendBinderTyping(msgs);

  try {
    const token = window.netlifyIdentity?.currentUser()?.token?.access_token;
    const res = await fetch("/.netlify/functions/binder-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ slug, messages: binderChatHistory }),
    });
    const data = await res.json();
    typing.remove();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

    binderChatHistory.push({ role: "assistant", content: data.reply });
    appendBinderBubble("assistant", data.reply, msgs);
  } catch (err) {
    typing.remove();
    appendBinderBubble("error", `⚠️ ${err.message}`, msgs);
  }
}

function appendBinderBubble(role, text, msgs) {
  const displayText = (text || "").replace(/<cards>[\s\S]*?<\/cards>/g, "").trim();
  const wrap = document.createElement("div");
  wrap.className = `message ${role}`;
  if (role === "assistant") wrap.innerHTML = `<div class="avatar small">🤖</div>`;

  const bbl = document.createElement("div");
  bbl.className = "message-bubble";
  bbl.innerHTML = displayText
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
  wrap.appendChild(bbl);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

function appendBinderTyping(msgs) {
  const wrap = document.createElement("div");
  wrap.className = "message assistant";
  wrap.innerHTML = `<div class="avatar small">🤖</div><div class="message-bubble typing"><span></span><span></span><span></span></div>`;
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

// ── Boot ───────────────────────────────────────────────────

function boot() {
  if (window.netlifyIdentity) {
    let started = false;
    netlifyIdentity.on("init", () => {
      if (started) return;
      started = true;
      initBinder();
    });
    // Public binders don't need auth — don't let a slow identity widget block the page
    setTimeout(() => { if (!started) { started = true; initBinder(); } }, 2000);
  } else {
    initBinder();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
