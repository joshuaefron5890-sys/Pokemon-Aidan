// Add Cards Modal — lives in admin.html, shown in the My Binder view
// Routes to /.netlify/functions/chat (Aidan) or binder-chat (all other owners)

/* global netlifyIdentity */

(function () {
  const modal   = document.getElementById("add-card-modal");
  const openBtn = document.getElementById("add-card-btn");
  const closeBtn = document.getElementById("acm-close");

  if (!modal || !openBtn) return;

  // ── Chat routing ──────────────────────────────────────────

  async function resolveBinderSlug(user, token) {
    if (window.BINDER_SLUG) return window.BINDER_SLUG;

    // Try to find an existing binder by email
    const lookup = await fetch("/.netlify/functions/get-my-binder", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (lookup.ok) {
      const { slug, binderUrl } = await lookup.json();
      window.BINDER_SLUG = slug;
      try { await user.update({ data: { binder_url: binderUrl } }); } catch {}
      return slug;
    }

    // No binder found — auto-create one from the user's name / email
    const owner = (user.user_metadata?.full_name || user.email.split("@")[0]).trim();
    let slug = owner.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 26);
    if (slug.length < 3) slug = "binder-" + slug;

    const create = await fetch("/.netlify/functions/create-binder", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ slug, owner, isPublic: false, cards: [] }),
    });

    if (!create.ok) {
      // Slug taken — append a short suffix and retry
      slug = slug.slice(0, 22) + "-" + Date.now().toString(36).slice(-4);
      const retry = await fetch("/.netlify/functions/create-binder", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ slug, owner, isPublic: false, cards: [] }),
      });
      if (!retry.ok) throw new Error("Could not create your binder. Please try again.");
    }

    window.BINDER_SLUG = slug;
    try { await user.update({ data: { binder_url: `/binder/${slug}` } }); } catch {}
    return slug;
  }

  async function callChat(messages) {
    const user = window.netlifyIdentity?.currentUser();
    if (!user) throw new Error("Please log in first.");
    const token = await user.jwt();
    if (window.IS_AIDAN_ADMIN) {
      return safeJson(await fetch("/.netlify/functions/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages }),
      }));
    }
    const slug = await resolveBinderSlug(user, token);
    return safeJson(await fetch("/.netlify/functions/binder-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ slug, messages }),
    }));
  }

  async function safeJson(res) {
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const text = await res.text();
      const snippet = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
      throw new Error(`Server error (${res.status})${snippet ? ": " + snippet : " — please try again."}`);
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  // ── Open / close ─────────────────────────────────────────

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

  function openModal() {
    cardQueue = [];
    renderQueue();
    resetToStep("input");
    // Reset submit button in case it was left in loading state from a previous session
    addAllBtn.disabled = false;
    document.getElementById("acm-add-all-spinner").classList.add("hidden");
    document.getElementById("acm-add-all-label").textContent = "Add to Collection";
    // Default to photo tab on mobile
    const defaultTab = window.matchMedia("(max-width: 600px)").matches ? "photo" : "name";
    activeTab = defaultTab;
    document.querySelectorAll(".acm-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === defaultTab));
    document.querySelectorAll(".acm-tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${defaultTab}`));
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }

  // ── Tabs ─────────────────────────────────────────────────

  let activeTab = "name";

  document.querySelectorAll(".acm-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      activeTab = tab.dataset.tab;
      document.querySelectorAll(".acm-tab").forEach(t => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".acm-tab-panel").forEach(p => {
        p.classList.toggle("active", p.id === `tab-${activeTab}`);
      });
      document.getElementById("acm-input-error").textContent = "";
    });
  });

  // ── Photo upload & drag-drop ──────────────────────────────

  let pendingPhoto = null;

  const dropzone         = document.getElementById("acm-dropzone");
  const photoInput       = document.getElementById("acm-photo-input");         // mobile camera
  const photoInputDesk   = document.getElementById("acm-photo-input-desktop"); // desktop file
  const preview          = document.getElementById("acm-photo-preview");
  const previewWrap      = document.getElementById("acm-photo-preview-wrap");
  const photoClear       = document.getElementById("acm-photo-clear");

  photoInput.addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) readPhotoFile(file);
  });

  photoInputDesk.addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) readPhotoFile(file);
  });

  dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("drag-over"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
  dropzone.addEventListener("drop", e => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) readPhotoFile(file);
  });

  photoClear.addEventListener("click", () => {
    pendingPhoto = null;
    previewWrap.classList.add("hidden");
    photoInput.value = "";
  });

  function readPhotoFile(file) {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      // Resize to max 1024px on longest side before encoding — camera photos can be 5–8 MB
      const MAX = 1024;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else                { width  = Math.round(width  * MAX / height); height = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const [, data] = dataUrl.split(",");
      pendingPhoto = { data, mediaType: "image/jpeg" };
      preview.src = dataUrl;
      previewWrap.classList.remove("hidden");
    };
    img.src = objectUrl;
  }

  // ── Step management ───────────────────────────────────────

  function resetToStep(step) {
    document.getElementById("acm-step-input").classList.toggle("hidden", step !== "input");
    document.getElementById("acm-step-pick").classList.toggle("hidden", step !== "pick");
    document.getElementById("acm-step-confirm").classList.toggle("hidden", step !== "confirm");
    document.getElementById("acm-step-done").classList.toggle("hidden", step !== "done");
    document.getElementById("acm-input-error").textContent = "";
    document.getElementById("acm-confirm-error").textContent = "";
    if (step === "input") {
      document.getElementById("acm-card-name").value = "";
      document.getElementById("acm-tcg-link").value = "";
      pendingPhoto = null;
      previewWrap.classList.add("hidden");
      photoInput.value = "";
    }
  }

  // ── Card queue ────────────────────────────────────────────

  let cardQueue = []; // [{ cardId, query, setName, marketPrice, tcgUrl, imageUrl }]

  function renderQueue() {
    const panel     = document.getElementById("acm-queue-panel");
    const list      = document.getElementById("acm-queue-list");
    const countEl   = document.getElementById("acm-queue-count");
    const labelEl   = document.getElementById("acm-add-all-label");

    if (!cardQueue.length) {
      panel.classList.add("hidden");
      return;
    }

    panel.classList.remove("hidden");
    countEl.textContent = cardQueue.length;
    labelEl.textContent = `Add ${cardQueue.length} Card${cardQueue.length !== 1 ? "s" : ""} to Collection`;

    list.innerHTML = "";
    cardQueue.forEach((card, i) => {
      const lastDash = card.cardId.lastIndexOf("-");
      const setId    = card.cardId.slice(0, lastDash);
      const num      = card.cardId.slice(lastDash + 1);
      const imgUrl   = `https://images.pokemontcg.io/${setId}/${num}.png`;

      const row = document.createElement("div");
      row.className = "acm-queue-row";
      row.innerHTML = `
        <img class="acm-queue-img" src="${imgUrl}" alt="${card.query}"
             onerror="this.style.display='none'" />
        <div class="acm-queue-info">
          <div class="acm-queue-name">${card.query}</div>
          <div class="acm-queue-set">${card.setName || ""}</div>
        </div>
        <button class="acm-queue-remove" title="Remove" data-index="${i}">✕</button>`;
      row.querySelector(".acm-queue-remove").addEventListener("click", () => {
        cardQueue.splice(i, 1);
        renderQueue();
      });
      list.appendChild(row);
    });

    document.getElementById("acm-add-all-error").textContent = "";
  }

  document.getElementById("acm-queue-clear-btn").addEventListener("click", () => {
    cardQueue = [];
    renderQueue();
  });

  // ── Step A: Look up card ──────────────────────────────────

  let foundCard = null;

  const lookupBtn     = document.getElementById("acm-lookup-btn");
  const lookupLabel   = document.getElementById("acm-lookup-label");
  const lookupSpinner = document.getElementById("acm-spinner");

  lookupBtn.addEventListener("click", doLookup);
  document.getElementById("acm-card-name").addEventListener("keydown", e => {
    if (e.key === "Enter") doLookup();
  });

  async function doLookup() {
    const errEl = document.getElementById("acm-input-error");
    errEl.textContent = "";

    let userMessage;
    const jsonArrayInstruction = 'Return up to 5 best fuzzy matches as a JSON array only — no markdown, no extra text. Format: [{"cardId":"sv3pt5-006","query":"Charizard ex","setName":"151","marketPrice":45.00,"tcgUrl":""}]. Return [] if nothing found.';

    if (activeTab === "name") {
      const name = document.getElementById("acm-card-name").value.trim();
      if (!name) { errEl.textContent = "Please enter a card name."; return; }
      userMessage = { role: "user", content: `Search for Pokémon cards matching "${name}". ${jsonArrayInstruction}` };
    } else if (activeTab === "link") {
      const link = document.getElementById("acm-tcg-link").value.trim();
      if (!link || !link.includes("tcgplayer.com")) { errEl.textContent = "Please paste a valid TCGPlayer URL."; return; }
      let cardQuery = link;
      try {
        const parts = new URL(link).pathname.split("/").filter(Boolean);
        // URL format: /product/{id}/pokemon-{set-slug}-{card-name}-{number}
        const slug = parts[parts.length - 1] || "";
        let cleaned = slug.replace(/^pokemon-/, "");
        // Extract trailing number and strip leading zeros: "070" → "70"
        const numMatch = cleaned.match(/-(\d+)$/);
        const numStr = numMatch ? parseInt(numMatch[1], 10).toString() : null;
        if (numMatch) cleaned = cleaned.slice(0, numMatch.index);
        // Card name = last word(s); handle multi-word names like "charizard-ex", "pikachu-vmax"
        const nameSuffixes = new Set(["ex", "gx", "v", "vmax", "vstar", "mega", "break", "prime"]);
        const slugParts = cleaned.split("-");
        let nameWords = [slugParts[slugParts.length - 1]];
        if (slugParts.length >= 2 && nameSuffixes.has(slugParts[slugParts.length - 1])) {
          nameWords = [slugParts[slugParts.length - 2], slugParts[slugParts.length - 1]];
        }
        const cardName = nameWords.join(" ");
        cardQuery = numStr ? `${cardName} ${numStr}` : cardName;
      } catch {}
      userMessage = { role: "user", content: `Look up this Pokémon card: "${cardQuery}". ${jsonArrayInstruction}` };
    } else {
      if (!pendingPhoto) { errEl.textContent = "Please select or drop a card photo first."; return; }

      lookupBtn.disabled = true;
      lookupSpinner.classList.remove("hidden");
      lookupLabel.textContent = "Identifying…";

      try {
        const user  = window.netlifyIdentity?.currentUser();
        const token = user ? await user.jwt().catch(() => null) : null;
        const res = await fetch("/.netlify/functions/identify-card", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ imageData: pendingPhoto.data, mediaType: pendingPhoto.mediaType }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

        const cards = (data.cards || []).filter(c => c && (c.cardId || c.imageUrl || c.query));
        if (!cards.length) throw new Error("Could not identify card. Try a clearer photo or use Card Name instead.");

        if (cards.length === 1) {
          foundCard = cards[0];
          showConfirmStep(foundCard);
        } else {
          showPickStep(cards);
        }
      } catch (err) {
        console.error("identify-card error:", err);
        errEl.textContent = err.message;
        lookupBtn.disabled = false;
        lookupSpinner.classList.add("hidden");
        lookupLabel.textContent = "Find Card";
      }
      return;
    }

    lookupBtn.disabled = true;
    lookupSpinner.classList.remove("hidden");
    lookupLabel.textContent = "Searching…";

    try {
      const data = await callChat([userMessage]);

      const arrayMatch = data.reply.match(/\[[\s\S]*\]/);
      if (!arrayMatch) throw new Error("Could not parse results. Please try again.");

      const cards = JSON.parse(arrayMatch[0]).filter(c => c && c.cardId);
      if (!cards.length) {
        if (activeTab === "link") throw new Error("Card not found in the Pokémon TCG database — it may be a Japanese-only or regional promo. Try the Card Name tab and search for the Pokémon's name instead.");
        throw new Error("No cards found. Try a different name or include the card number.");
      }

      if (cards.length === 1) {
        foundCard = cards[0];
        showConfirmStep(foundCard);
      } else {
        showPickStep(cards);
      }
    } catch (err) {
      errEl.textContent = err.message;
      lookupBtn.disabled = false;
      lookupSpinner.classList.add("hidden");
      lookupLabel.textContent = "Find Card";
    }
  }

  // ── Step B: Confirm → queue ───────────────────────────────

  function showConfirmStep(card) {
    lookupBtn.disabled = false;
    lookupSpinner.classList.add("hidden");
    lookupLabel.textContent = "Find Card";

    const lastDash = card.cardId.lastIndexOf("-");
    const setId    = card.cardId.slice(0, lastDash);
    const num      = card.cardId.slice(lastDash + 1);
    const imgUrl   = `https://images.pokemontcg.io/${setId}/${num}.png`;

    const previewImg = document.getElementById("acm-preview-img");
    previewImg.src   = imgUrl;
    previewImg.onerror = () => { previewImg.src = ""; previewImg.style.display = "none"; };

    document.getElementById("acm-preview-name").textContent  = card.query || card.cardId;
    document.getElementById("acm-preview-set").textContent   = card.setName || "";
    document.getElementById("acm-preview-num").textContent   = `#${num}`;
    document.getElementById("acm-preview-price").textContent =
      card.marketPrice ? `$${Number(card.marketPrice).toFixed(2)}` : "Price unavailable";

    resetToStep("confirm");
  }

  function showPickStep(cards) {
    lookupBtn.disabled = false;
    lookupSpinner.classList.add("hidden");
    lookupLabel.textContent = "Find Card";

    const grid = document.getElementById("acm-pick-grid");
    grid.innerHTML = "";
    cards.forEach(card => {
      const lastDash = card.cardId.lastIndexOf("-");
      const setId    = card.cardId.slice(0, lastDash);
      const num      = card.cardId.slice(lastDash + 1);
      const imgUrl   = `https://images.pokemontcg.io/${setId}/${num}.png`;

      const item = document.createElement("button");
      item.className = "acm-pick-item";
      item.innerHTML = `
        <img src="${imgUrl}" alt="${card.query}" onerror="this.style.opacity='.25'" />
        <div class="acm-pick-name">${card.query}</div>
        <div class="acm-pick-set">${card.setName || ""}</div>
        <div class="acm-pick-price">${card.marketPrice ? `$${Number(card.marketPrice).toFixed(2)}` : ""}</div>`;
      item.addEventListener("click", () => {
        foundCard = card;
        showConfirmStep(card);
      });
      grid.appendChild(item);
    });

    resetToStep("pick");
  }

  document.getElementById("acm-pick-back-btn").addEventListener("click", () => resetToStep("input"));

  document.getElementById("acm-back-btn").addEventListener("click", () => resetToStep("input"));

  // "Add to Queue" — store card and go back to input
  document.getElementById("acm-confirm-btn").addEventListener("click", () => {
    if (!foundCard) return;
    cardQueue.push(foundCard);
    foundCard = null;
    renderQueue();
    resetToStep("input");
  });

  // ── Submit all queued cards ───────────────────────────────

  const addAllBtn     = document.getElementById("acm-add-all-btn");
  const addAllLabel   = document.getElementById("acm-add-all-label");
  const addAllSpinner = document.getElementById("acm-add-all-spinner");

  addAllBtn.addEventListener("click", async () => {
    const errEl = document.getElementById("acm-add-all-error");
    errEl.textContent = "";
    if (!cardQueue.length) return;

    addAllBtn.disabled = true;
    addAllSpinner.classList.remove("hidden");
    addAllLabel.textContent = "Adding…";

    try {
      const user  = window.netlifyIdentity?.currentUser();
      if (!user) throw new Error("Please log in first.");
      const token = await user.jwt();
      const slug  = await resolveBinderSlug(user, token);

      const res = await fetch("/.netlify/functions/add-cards-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ slug, cards: cardQueue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

      const names = cardQueue.map(c => c.query).join(", ");
      document.getElementById("acm-success-msg").textContent =
        cardQueue.length === 1
          ? `"${cardQueue[0].query}" added!`
          : `${data.added} card${data.added !== 1 ? "s" : ""} added (${names}).`;

      cardQueue = [];
      resetToStep("done");
    } catch (err) {
      errEl.textContent = err.message;
      addAllBtn.disabled = false;
      addAllSpinner.classList.add("hidden");
      addAllLabel.textContent = `Add ${cardQueue.length} Card${cardQueue.length !== 1 ? "s" : ""} to Collection`;
    }
  });

  document.getElementById("acm-done-btn").addEventListener("click", () => {
    closeModal();
    // Refresh the binder iframe so newly added cards are visible
    const iframe = document.getElementById("binder-iframe");
    if (iframe && window.BINDER_SLUG) {
      const newSrc = `/binder/${window.BINDER_SLUG}`;
      if (iframe.src !== newSrc && !iframe.src.endsWith(newSrc)) {
        iframe.src = newSrc;
      } else {
        iframe.contentWindow?.location.reload();
      }
      const pubLink = document.getElementById("view-public-link");
      if (pubLink) pubLink.href = newSrc;
    }
  });

})();
