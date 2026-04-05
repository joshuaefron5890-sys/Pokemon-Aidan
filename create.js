/* global netlifyIdentity */

// ── State ──────────────────────────────────────────────────
const STATE_KEY = "wizard_state_v1";

let wizardData = {
  owner:     "",
  slug:      "",
  isPublic:  true,
  token:     null,   // JWT after signup/login
  cards:     [],     // confirmed cards from step 3
};
let wizardHistory = [];  // AI chat history

// Restore partial state from localStorage (survives email confirmation redirect)
try {
  const saved = localStorage.getItem(STATE_KEY);
  if (saved) Object.assign(wizardData, JSON.parse(saved));
} catch {}

function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(wizardData)); } catch {}
}

// ── Step management ────────────────────────────────────────

let currentStep = 1;

function goTo(n) {
  document.querySelectorAll(".wizard-step").forEach((el, i) => {
    el.classList.toggle("active", i + 1 === n);
  });
  for (let i = 1; i <= 4; i++) {
    const pill = document.getElementById(`pill-${i}`);
    if (!pill) continue;
    pill.classList.remove("active", "done");
    if (i < n)      pill.classList.add("done");
    else if (i === n) pill.classList.add("active");
  }
  currentStep = n;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Step 1: Binder info ────────────────────────────────────

const ownerInput = document.getElementById("owner-name");
const slugInput  = document.getElementById("binder-slug");
const slugStatus = document.getElementById("slug-status");

function toSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function slugValid(s) {
  return /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(s);
}

ownerInput.addEventListener("input", () => {
  const auto = toSlug(ownerInput.value);
  if (!slugInput.dataset.manualEdit) slugInput.value = auto;
  validateSlug();
});

slugInput.addEventListener("input", () => {
  slugInput.dataset.manualEdit = "1";
  validateSlug();
});

function validateSlug() {
  const s = slugInput.value;
  if (!s) { slugStatus.textContent = ""; return false; }
  if (slugValid(s)) {
    slugStatus.innerHTML = `<span class="slug-ok">✓ /binder/${s}</span>`;
    return true;
  }
  slugStatus.innerHTML = `<span class="slug-err">Use lowercase letters, numbers, and hyphens (min 3 chars).</span>`;
  return false;
}

// Visibility radio
document.querySelectorAll(".vis-option").forEach(opt => {
  opt.addEventListener("click", () => {
    document.querySelectorAll(".vis-option").forEach(o => o.classList.remove("checked"));
    opt.classList.add("checked");
    opt.querySelector("input").checked = true;
  });
});

document.getElementById("step1-next").addEventListener("click", () => {
  const owner = ownerInput.value.trim();
  const slug  = slugInput.value.trim();
  const errEl = document.getElementById("step1-error");
  errEl.textContent = "";

  if (!owner) { errEl.textContent = "Please enter your name."; return; }
  if (!slugValid(slug)) { errEl.textContent = "Please enter a valid binder URL."; return; }

  wizardData.owner    = owner;
  wizardData.slug     = slug;
  wizardData.isPublic = document.querySelector("[name=visibility]:checked")?.value !== "private";
  saveState();
  goTo(2);
});

// Restore step 1 fields if returning
if (wizardData.owner) ownerInput.value = wizardData.owner;
if (wizardData.slug)  { slugInput.value = wizardData.slug; slugInput.dataset.manualEdit = "1"; validateSlug(); }

// ── Step 2: Account creation ───────────────────────────────

const emailInput    = document.getElementById("signup-email");
const passwordInput = document.getElementById("signup-password");
const step2Btn      = document.getElementById("step2-next");
const step2Spinner  = document.getElementById("step2-spinner");
const step2Label    = document.getElementById("step2-label");
const step2Error    = document.getElementById("step2-error");

// If user returns after email confirmation, token will be in netlifyIdentity
netlifyIdentity.on("init", user => {
  if (user && wizardData.owner && !wizardData.token) {
    wizardData.token = user.token?.access_token;
    saveState();
    goTo(3);
  }
});

netlifyIdentity.on("login", user => {
  netlifyIdentity.close();
  wizardData.token = user.token?.access_token;
  saveState();
  goTo(3);
});

step2Btn.addEventListener("click", async () => {
  const email    = emailInput.value.trim();
  const password = passwordInput.value;
  step2Error.textContent = "";

  if (!email || !email.includes("@")) { step2Error.textContent = "Please enter a valid email."; return; }
  if (password.length < 8) { step2Error.textContent = "Password must be at least 8 characters."; return; }

  step2Btn.disabled = true;
  step2Spinner.classList.remove("hidden");
  step2Label.textContent = "Creating account…";

  try {
    // Attempt signup via GoTrue API
    const res = await fetch("/.netlify/identity/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.msg || data.error_description || "Signup failed. Try a different email.");
    }

    if (data.access_token) {
      // Immediate login (email confirmation disabled)
      wizardData.token = data.access_token;
      saveState();
      goTo(3);
    } else {
      // Email confirmation required
      step2Spinner.classList.add("hidden");
      step2Label.textContent = "Create Account";
      step2Btn.disabled = false;
      step2Error.textContent = "";
      step2Error.style.color = "#4ade80";
      step2Error.textContent = "Check your email to confirm your account, then come back here.";
      saveState();
    }
  } catch (err) {
    step2Btn.disabled = false;
    step2Spinner.classList.add("hidden");
    step2Label.textContent = "Create Account";
    step2Error.textContent = err.message;
  }
});

document.getElementById("login-instead").addEventListener("click", () => {
  netlifyIdentity.open("login");
});

// ── Step 3: AI card wizard ─────────────────────────────────

const wizardInput  = document.getElementById("wizard-input");
const wizardSend   = document.getElementById("wizard-send");
const wizardMsgs   = document.getElementById("wizard-msgs");
const trayList     = document.getElementById("tray-list");
const trayCount    = document.getElementById("tray-count");
const trayEmpty    = document.getElementById("tray-empty");
const step3NextBtn = document.getElementById("step3-next");
const step3Spinner = document.getElementById("step3-spinner");
const step3Label   = document.getElementById("step3-label");

function updateTray() {
  const cards = wizardData.cards;
  trayCount.textContent = `(${cards.length})`;
  step3NextBtn.disabled = false; // can proceed with 0 cards too

  // Remove old chips (keep tray-empty)
  trayList.querySelectorAll(".tray-chip").forEach(c => c.remove());

  if (cards.length === 0) {
    trayEmpty.classList.remove("hidden");
  } else {
    trayEmpty.classList.add("hidden");
    cards.forEach((card, i) => {
      const chip = document.createElement("div");
      chip.className = "tray-chip";
      chip.innerHTML = `<span>${card.query}</span><button class="tray-chip-remove" data-i="${i}">✕</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        wizardData.cards.splice(i, 1);
        saveState();
        updateTray();
      });
      trayList.appendChild(chip);
    });
  }
}

// Restore confirmed cards if any
if (wizardData.cards.length) updateTray();

wizardInput.addEventListener("input", () => {
  wizardSend.disabled = !wizardInput.value.trim();
  wizardInput.style.height = "auto";
  wizardInput.style.height = Math.min(wizardInput.scrollHeight, 100) + "px";
});

wizardInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!wizardSend.disabled) sendWizardMsg(); }
});

wizardSend.addEventListener("click", sendWizardMsg);

function appendCC(role, text) {
  const wrap = document.createElement("div");
  wrap.className = `cc-msg ${role}`;
  if (role === "assistant") wrap.innerHTML = `<div class="cc-av">🤖</div>`;
  const bbl = document.createElement("div");
  bbl.className = "cc-bubble";
  const clean = text.replace(/<card-confirmed>[\s\S]*?<\/card-confirmed>/g, "").trim();
  bbl.innerHTML = clean
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
  wrap.appendChild(bbl);
  wizardMsgs.appendChild(wrap);
  wizardMsgs.scrollTop = wizardMsgs.scrollHeight;
  return wrap;
}

function appendTypingCC() {
  const wrap = document.createElement("div");
  wrap.className = "cc-msg assistant";
  wrap.innerHTML = `<div class="cc-av">🤖</div><div class="cc-bubble"><div class="cc-typing"><span></span><span></span><span></span></div></div>`;
  wizardMsgs.appendChild(wrap);
  wizardMsgs.scrollTop = wizardMsgs.scrollHeight;
  return wrap;
}

async function sendWizardMsg() {
  const text = wizardInput.value.trim();
  if (!text) return;

  appendCC("user", text);
  wizardHistory.push({ role: "user", content: text });
  wizardInput.value = "";
  wizardInput.style.height = "auto";
  wizardSend.disabled = true;

  const typing = appendTypingCC();

  try {
    const res = await fetch("/.netlify/functions/create-wizard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: wizardHistory }),
    });
    const data = await res.json();
    typing.remove();

    if (!res.ok) throw new Error(data.error || "Something went wrong");

    wizardHistory.push({ role: "assistant", content: data.reply });
    appendCC("assistant", data.reply);

    // Parse any confirmed cards out of the response
    const matches = [...data.reply.matchAll(/<card-confirmed>([\s\S]*?)<\/card-confirmed>/g)];
    matches.forEach(m => {
      try {
        const card = JSON.parse(m[1]);
        if (card.cardId && !wizardData.cards.some(c => c.cardId === card.cardId)) {
          wizardData.cards.push(card);
          saveState();
          updateTray();
        }
      } catch {}
    });
  } catch (err) {
    typing.remove();
    appendCC("assistant", `⚠️ ${err.message}`);
  }
}

// "Create My Binder" — calls create-binder function
step3NextBtn.addEventListener("click", createBinder);
document.getElementById("skip-cards").addEventListener("click", createBinder);

async function createBinder() {
  const errEl = document.getElementById("step3-error");
  errEl.textContent = "";
  step3NextBtn.disabled = true;
  step3Spinner.classList.remove("hidden");
  step3Label.textContent = "Creating…";

  try {
    const token = wizardData.token || netlifyIdentity.currentUser()?.token?.access_token;
    if (!token) throw new Error("Not signed in. Please go back to step 2.");

    const res = await fetch("/.netlify/functions/create-binder", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        slug:     wizardData.slug,
        owner:    wizardData.owner,
        isPublic: wizardData.isPublic,
        cards:    wizardData.cards,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

    // Clear saved state
    localStorage.removeItem(STATE_KEY);

    // Show success
    const fullUrl = `${location.origin}/binder/${data.slug}`;
    document.getElementById("success-url").textContent = fullUrl;
    document.getElementById("go-to-binder").addEventListener("click", () => {
      window.location.href = fullUrl;
    });
    document.getElementById("success-url").addEventListener("click", () => {
      navigator.clipboard?.writeText(fullUrl);
      document.getElementById("success-url").textContent = "✓ Copied!";
      setTimeout(() => { document.getElementById("success-url").textContent = fullUrl; }, 2000);
    });

    goTo(4);
  } catch (err) {
    errEl.textContent = err.message;
    step3NextBtn.disabled = false;
    step3Spinner.classList.add("hidden");
    step3Label.textContent = "Create My Binder";
  }
}

// Initial step — if we already have a token, skip to step 3
if (wizardData.token || netlifyIdentity.currentUser()) {
  if (wizardData.owner && wizardData.slug) goTo(3);
}
