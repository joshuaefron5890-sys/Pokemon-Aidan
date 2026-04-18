// favorites.js — Heart buttons on public binder pages (viewer mode)
// Call: window.initFavorites(netlifyIdentityUser, binderSlug, binderOwner)

(function () {
  let myFavorites = [];
  let binderSlug = null;
  let binderOwner = "";
  let favoritedHere = new Set(); // cardId or query keys for current binder

  // ── Public API ─────────────────────────────────────────────

  window.initFavorites = async function (user, slug, owner) {
    binderSlug = slug;
    binderOwner = owner;
    createCounterBadge();

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
        refreshCounter();
      }
    } catch {}

    observeCards();
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
    const total = myFavorites.length;
    const wrap = document.getElementById("fav-counter-wrap");
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
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
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
      toggleFavorite(btn, cardEl, cardId, query);
    });
    cardEl.appendChild(btn);
  }

  async function toggleFavorite(btn, cardEl, cardId, query) {
    const wasFaved = btn.classList.contains("faved");
    const action   = wasFaved ? "remove" : "add";
    const key      = cardId || query;

    // Optimistic UI
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
      const user  = window.netlifyIdentity?.currentUser();
      const token = user ? await user.jwt() : null;
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
      // Revert on error
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
})();
