// favorites.js — Heart buttons on public binder pages (viewer mode)
// Call: window.initFavorites(netlifyIdentityUser|null, binderSlug, binderOwner)
// Passing null for user shows hearts to guests; clicking triggers the signup modal.

(function () {
  let currentUser  = null;
  let myFavorites  = [];
  let binderSlug   = null;
  let binderOwner  = "";
  let favoritedHere = new Set();
  let observerActive = false;
  let pendingFavCard = null; // card data to auto-favorite after signup/login

  // ── Public API ─────────────────────────────────────────────

  window.initFavorites = async function (user, slug, owner) {
    binderSlug  = slug;
    binderOwner = owner;
    currentUser = user;

    if (user) {
      try {
        const token = await user.jwt();
        const res = await fetch("/.netlify/functions/get-favorites", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          myFavorites = data.cards || [];
          myFavorites.forEach(c => {
            if (c.binderSlug === slug) favoritedHere.add(c.cardId || c.query);
          });
        }
      } catch {}
    }

    createCounterBadge();
    injectSignupModal();
    injectStyles();
    refreshCounter(); // must run after createCounterBadge so the element exists

    if (!observerActive) {
      observeCards();
      observerActive = true;
    } else {
      // Re-init already-rendered buttons to reflect logged-in state
      document.querySelectorAll(".card-fav-btn").forEach(btn => {
        const cardEl = btn.closest(".card-item");
        if (!cardEl) return;
        const key = cardEl.dataset.cardId || cardEl.dataset.query || "";
        const faved = favoritedHere.has(key);
        btn.classList.toggle("faved", faved);
        btn.innerHTML = heartSvg(faved);
        btn.title = faved ? "Remove from favorites" : "Add to favorites";
      });
    }

    // After login triggered from the favorites modal, auto-favorite the pending card
    if (user && pendingFavCard) {
      const { cardId, query } = pendingFavCard;
      pendingFavCard = null;
      const sel = cardId
        ? `.card-item[data-card-id="${CSS.escape(cardId)}"]`
        : `.card-item[data-query="${CSS.escape(query)}"]`;
      const cardEl = document.querySelector(sel);
      if (cardEl) {
        const btn = cardEl.querySelector(".card-fav-btn");
        if (btn && !btn.classList.contains("faved")) btn.click();
      }
    }
  };

  // ── Counter badge ──────────────────────────────────────────

  function createCounterBadge() {
    if (document.getElementById("fav-counter-wrap")) return;
    const nav = document.querySelector(".binder-nav");
    if (!nav) return;
    const wrap = document.createElement("div");
    wrap.id = "fav-counter-wrap";
    wrap.className = "fav-counter-wrap hidden";
    wrap.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
      <span id="fav-counter-num">0</span> Favorited
    `;
    nav.insertBefore(wrap, nav.firstChild);
  }

  function refreshCounter() {
    const total = currentUser ? myFavorites.length : 0;
    const wrap  = document.getElementById("fav-counter-wrap");
    const numEl = document.getElementById("fav-counter-num");
    if (!wrap || !numEl) return;
    numEl.textContent = total;
    wrap.classList.toggle("hidden", total === 0);
  }

  // ── MutationObserver: add buttons to cards as they render ──

  function observeCards() {
    const grid = document.getElementById("card-grid");
    if (!grid) return;
    grid.querySelectorAll(".card-item").forEach(addFavBtn);
    const obs = new MutationObserver(mutations => {
      mutations.forEach(m =>
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1 && node.classList?.contains("card-item")) addFavBtn(node);
        })
      );
    });
    obs.observe(grid, { childList: true });
  }

  // ── Per-card heart button ──────────────────────────────────

  function heartSvg(filled) {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  }

  function addFavBtn(cardEl) {
    if (cardEl.querySelector(".card-fav-btn")) return;
    const cardId = cardEl.dataset.cardId || "";
    const query  = cardEl.dataset.query  || "";
    if (!cardId && !query) return;

    const key    = cardId || query;
    const isFaved = favoritedHere.has(key);

    const btn = document.createElement("button");
    btn.className = `card-fav-btn${isFaved ? " faved" : ""}`;
    btn.title     = isFaved ? "Remove from favorites" : "Add to favorites";
    btn.innerHTML = heartSvg(isFaved);
    btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      if (!currentUser) {
        showSignupModal(cardEl, cardId, query);
        return;
      }
      toggleFavorite(btn, cardEl, cardId, query);
    });
    cardEl.appendChild(btn);
  }

  async function toggleFavorite(btn, cardEl, cardId, query) {
    const wasFaved = btn.classList.contains("faved");
    const action   = wasFaved ? "remove" : "add";
    const key      = cardId || query;

    btn.classList.toggle("faved", !wasFaved);
    btn.innerHTML = heartSvg(!wasFaved);
    btn.title     = !wasFaved ? "Remove from favorites" : "Add to favorites";

    if (!wasFaved) {
      favoritedHere.add(key);
      myFavorites.push({ cardId, query, binderSlug, binderOwner });
    } else {
      favoritedHere.delete(key);
      myFavorites = myFavorites.filter(
        c => !(c.binderSlug === binderSlug && (c.cardId === cardId || c.query === query))
      );
    }
    refreshCounter();

    btn.classList.add("fav-pulse");
    setTimeout(() => btn.classList.remove("fav-pulse"), 400);

    const imgEl  = cardEl.querySelector(".card-img");
    const nameEl = cardEl.querySelector(".card-name");

    try {
      const token = currentUser ? await currentUser.jwt() : null;
      const res = await fetch("/.netlify/functions/update-favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action,
          card: {
            cardId:      cardId || null,
            query,
            binderSlug,
            binderOwner,
            name:        nameEl?.textContent || query,
            imageUrl:    imgEl?.src || "",
          },
        }),
      });
      if (!res.ok) throw new Error("Failed");
    } catch {
      btn.classList.toggle("faved", wasFaved);
      btn.innerHTML = heartSvg(wasFaved);
      btn.title     = wasFaved ? "Remove from favorites" : "Add to favorites";
      if (wasFaved) {
        favoritedHere.add(key);
        myFavorites.push({ cardId, query, binderSlug, binderOwner });
      } else {
        favoritedHere.delete(key);
        myFavorites = myFavorites.filter(
          c => !(c.binderSlug === binderSlug && (c.cardId === cardId || c.query === query))
        );
      }
      refreshCounter();
    }
  }

  // ── Signup modal ───────────────────────────────────────────

  function injectSignupModal() {
    if (document.getElementById("fav-signup-modal")) return;
    const modal = document.createElement("div");
    modal.id = "fav-signup-modal";
    modal.innerHTML = `
      <div class="fsm-backdrop"></div>
      <div class="fsm-card" role="dialog" aria-modal="true" aria-label="Create your account">
        <button class="fsm-close" aria-label="Dismiss">✕</button>
        <div class="fsm-icon-wrap">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </div>
        <div id="fsm-card-preview" class="fsm-card-preview"></div>
        <h2 class="fsm-title">Save Your Favorites</h2>
        <p class="fsm-desc">Create a free account to save cards, propose trades, and make offers to other collectors.</p>
        <div class="fsm-actions">
          <button class="fsm-btn-primary" id="fsm-signup-btn">Create Account</button>
          <button class="fsm-btn-secondary" id="fsm-login-btn">Log In</button>
        </div>
        <button class="fsm-later" id="fsm-later-btn">Maybe Later</button>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector(".fsm-backdrop").addEventListener("click", closeSignupModal);
    modal.querySelector(".fsm-close").addEventListener("click", closeSignupModal);
    document.getElementById("fsm-later-btn").addEventListener("click", closeSignupModal);
    document.getElementById("fsm-signup-btn").addEventListener("click", () => {
      window.location.href = "/create";
    });
    document.getElementById("fsm-login-btn").addEventListener("click", () => {
      window._netlifyFavLogin = true;
      window.netlifyIdentity?.open("login");
    });

    // After login/signup from this modal, re-init favorites and auto-favorite pending card
    window.netlifyIdentity?.on("login", user => {
      if (!window._netlifyFavLogin) return;
      window._netlifyFavLogin = false;
      window.netlifyIdentity?.close();
      closeSignupModal();
      currentUser = user;
      window.initFavorites(user, binderSlug, binderOwner);
    });
  }

  function showSignupModal(cardEl, cardId, query) {
    pendingFavCard = { cardId, query };

    const preview = document.getElementById("fsm-card-preview");
    if (preview) {
      const imgEl  = cardEl.querySelector(".card-img");
      const nameEl = cardEl.querySelector(".card-name");
      const name   = nameEl?.textContent || query;
      const src    = imgEl?.src || "";
      preview.innerHTML = src
        ? `<img class="fsm-preview-img" src="${src}" alt="${name}" /><span class="fsm-preview-name">${name}</span>`
        : `<span class="fsm-preview-name">${name}</span>`;
    }

    const modal = document.getElementById("fav-signup-modal");
    modal?.classList.add("fsm-visible");
  }

  function closeSignupModal() {
    document.getElementById("fav-signup-modal")?.classList.remove("fsm-visible");
  }

  // ── Inline styles ──────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById("fav-signup-styles")) return;
    const style = document.createElement("style");
    style.id = "fav-signup-styles";
    style.textContent = `
      #fav-signup-modal { display: none; position: fixed; inset: 0; z-index: 999999; align-items: center; justify-content: center; }
      #fav-signup-modal.fsm-visible { display: flex; }
      .fsm-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.7); backdrop-filter: blur(4px); }
      .fsm-card {
        position: relative; z-index: 1;
        background: #0d1628;
        border: 1px solid rgba(0,217,255,.25);
        border-radius: 20px;
        box-shadow: 0 0 60px rgba(0,217,255,.12), 0 24px 64px rgba(0,0,0,.6);
        padding: 2rem 2rem 1.5rem;
        max-width: 360px; width: calc(100% - 2rem);
        display: flex; flex-direction: column; align-items: center;
        gap: .75rem; text-align: center;
        animation: fsm-in .22s ease;
      }
      @keyframes fsm-in { from { opacity:0; transform: scale(.93) translateY(12px); } to { opacity:1; transform: none; } }
      .fsm-close {
        position: absolute; top: .85rem; right: .85rem;
        background: none; border: none; color: rgba(255,255,255,.35);
        font-size: .9rem; cursor: pointer; padding: .25rem; line-height: 1;
        transition: color .15s;
      }
      .fsm-close:hover { color: rgba(255,255,255,.7); }
      .fsm-icon-wrap {
        width: 52px; height: 52px; border-radius: 50%;
        background: rgba(0,217,255,.1);
        border: 1px solid rgba(0,217,255,.25);
        display: flex; align-items: center; justify-content: center;
        color: #00d9ff;
        box-shadow: 0 0 24px rgba(0,217,255,.2);
      }
      .fsm-card-preview {
        display: flex; align-items: center; gap: .6rem;
        background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
        border-radius: 10px; padding: .5rem .85rem;
        max-width: 100%;
      }
      .fsm-card-preview:empty { display: none; }
      .fsm-preview-img { width: 32px; height: 44px; object-fit: contain; border-radius: 3px; flex-shrink: 0; }
      .fsm-preview-name { font-size: .82rem; font-weight: 600; color: #eef2ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
      .fsm-title { font-size: 1.2rem; font-weight: 800; letter-spacing: -.02em; color: #eef2ff; margin: 0; }
      .fsm-desc { font-size: .83rem; color: rgba(238,242,255,.6); line-height: 1.5; margin: 0; }
      .fsm-actions { display: flex; flex-direction: row; gap: .5rem; width: 100%; margin-top: .25rem; }
      .fsm-btn-primary {
        flex: 2; padding: .7rem 1rem;
        background: linear-gradient(135deg, #00d9ff, #9b6dff);
        border: none; border-radius: 10px;
        color: #fff; font-size: .9rem; font-weight: 700; font-family: inherit;
        cursor: pointer; transition: opacity .15s;
      }
      .fsm-btn-primary:hover { opacity: .88; }
      .fsm-btn-secondary {
        flex: 1; padding: .65rem .75rem;
        background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
        border-radius: 10px; color: #eef2ff;
        font-size: .9rem; font-weight: 600; font-family: inherit;
        cursor: pointer; transition: background .15s, border-color .15s;
      }
      .fsm-btn-secondary:hover { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.22); }
      .fsm-later {
        background: none; border: none; color: rgba(255,255,255,.3);
        font-size: .78rem; font-family: inherit; cursor: pointer; padding: .25rem;
        transition: color .15s;
      }
      .fsm-later:hover { color: rgba(255,255,255,.55); }
    `;
    document.head.appendChild(style);
  }
})();
