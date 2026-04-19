// Add Card Modal — lives in admin.html, shown in the My Binder view
// Routes to /.netlify/functions/chat (Aidan) or binder-chat (all other owners)

/* global netlifyIdentity */

(function () {
  const modal  = document.getElementById("add-card-modal");
  const openBtn = document.getElementById("add-card-btn");
  const closeBtn = document.getElementById("acm-close");

  if (!modal || !openBtn) return;

  // ── Chat routing ──────────────────────────────────────────
  // Aidan → /chat; everyone else → /binder-chat with their slug

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
    const slug = window.BINDER_SLUG;
    if (!slug) throw new Error("Binder not found. Please refresh and try again.");
    return safeJson(await fetch("/.netlify/functions/binder-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ slug, messages }),
    }));
  }

  // ── Safe JSON fetch ───────────────────────────────────────
  // Handles HTML error pages (timeouts, 502s) gracefully

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
    resetToStep("input");
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

  let pendingPhoto = null; // { data: base64, mediaType }

  const dropzone   = document.getElementById("acm-dropzone");
  const photoInput = document.getElementById("acm-photo-input");
  const preview    = document.getElementById("acm-photo-preview");
  const previewWrap = document.getElementById("acm-photo-preview-wrap");
  const photoClear = document.getElementById("acm-photo-clear");

  photoInput.addEventListener("change", e => {
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
    const reader = new FileReader();
    reader.onload = ev => {
      const [, data] = ev.target.result.split(",");
      pendingPhoto = { data, mediaType: file.type };
      preview.src = ev.target.result;
      previewWrap.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  }

  // ── Step management ───────────────────────────────────────

  function resetToStep(step) {
    document.getElementById("acm-step-input").classList.toggle("hidden", step !== "input");
    document.getElementById("acm-step-confirm").classList.toggle("hidden", step !== "confirm");
    document.getElementById("acm-step-done").classList.toggle("hidden", step !== "done");
    document.getElementById("acm-input-error").textContent = "";
    document.getElementById("acm-confirm-error").textContent = "";
  }

  // ── Step A: Look up card ──────────────────────────────────

  let foundCard = null; // { cardId, query, setName, marketPrice, tcgUrl, imageUrl }

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

    if (activeTab === "name") {
      const name = document.getElementById("acm-card-name").value.trim();
      if (!name) { errEl.textContent = "Please enter a card name."; return; }
      userMessage = { role: "user", content: `Look up this card and tell me the cardId, setName, and market price: ${name}` };
    } else if (activeTab === "link") {
      const link = document.getElementById("acm-tcg-link").value.trim();
      if (!link || !link.includes("tcgplayer.com")) { errEl.textContent = "Please paste a valid TCGPlayer URL."; return; }
      // Extract card name from URL slug: /product/12345/pokemon-sv-black-bolt-serperior-ex
      // → remove "pokemon-" brand prefix, convert hyphens to spaces → "sv black bolt serperior ex"
      let cardQuery = link;
      try {
        const slug = new URL(link).pathname.split("/").filter(Boolean).pop();
        cardQuery = slug.replace(/^pokemon-/, "").replace(/-/g, " ").trim();
      } catch {}
      userMessage = { role: "user", content: `Look up this Pokémon card and tell me the cardId, setName, and market price: ${cardQuery}` };
    } else {
      // Photo tab
      if (!pendingPhoto) { errEl.textContent = "Please select or drop a card photo first."; return; }
      userMessage = {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: pendingPhoto.mediaType, data: pendingPhoto.data } },
          { type: "text",  text: "Identify this Pokémon card. Tell me the cardId, setName, card name, number, and market price." },
        ],
      };
    }

    lookupBtn.disabled = true;
    lookupSpinner.classList.remove("hidden");
    lookupLabel.textContent = "Searching…";

    try {
      // Step 1: look up the card
      const data = await callChat([userMessage]);

      // Step 2: re-ask for structured JSON
      const extracted = await callChat([
        userMessage,
        { role: "assistant", content: data.reply },
        { role: "user", content: 'Now give me just this JSON (no other text): {"cardId":"...","query":"...","setName":"...","marketPrice":0.00,"tcgUrl":"...","imageUrl":""}' },
      ]);

      // Find JSON in the response
      const jsonMatch = extracted.reply.match(/\{[\s\S]*"cardId"[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse card information. Please try again.");

      foundCard = JSON.parse(jsonMatch[0]);
      if (!foundCard.cardId) throw new Error("Card not found. Please check the name or number.");

      showConfirmStep(foundCard);
    } catch (err) {
      errEl.textContent = err.message;
      lookupBtn.disabled = false;
      lookupSpinner.classList.add("hidden");
      lookupLabel.textContent = "Find Card";
    }
  }

  // ── Step B: Confirm ───────────────────────────────────────

  function showConfirmStep(card) {
    lookupBtn.disabled = false;
    lookupSpinner.classList.add("hidden");
    lookupLabel.textContent = "Find Card";

    // Build image URL from cardId
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

  document.getElementById("acm-back-btn").addEventListener("click", () => resetToStep("input"));

  const confirmBtn     = document.getElementById("acm-confirm-btn");
  const confirmLabel   = document.getElementById("acm-confirm-label");
  const confirmSpinner = document.getElementById("acm-confirm-spinner");

  confirmBtn.addEventListener("click", async () => {
    const errEl = document.getElementById("acm-confirm-error");
    errEl.textContent = "";
    confirmBtn.disabled = true;
    confirmSpinner.classList.remove("hidden");
    confirmLabel.textContent = "Adding…";

    try {
      const addMsg = `Add this card to the collection: cardId="${foundCard.cardId}", query="${foundCard.query}", setName="${foundCard.setName}"${foundCard.marketPrice ? `, fallbackPrice=${foundCard.marketPrice}` : ""}${foundCard.tcgUrl ? `, tcgUrl="${foundCard.tcgUrl}"` : ""}`;
      const data = await callChat([{ role: "user", content: addMsg }]);

      document.getElementById("acm-success-msg").textContent =
        `"${foundCard.query}" added! The page will update in ~1 minute.`;

      resetToStep("done");
    } catch (err) {
      errEl.textContent = err.message;
      confirmBtn.disabled = false;
      confirmSpinner.classList.add("hidden");
      confirmLabel.textContent = "Add to Collection";
    }
  });

  document.getElementById("acm-done-btn").addEventListener("click", closeModal);

})();
