/* global netlifyIdentity */

let history = [];      // conversation history sent to the agent
let pendingImage = null; // { data: base64, mediaType: "image/jpeg" }

// ── Auth ────────────────────────────────────────────────────

netlifyIdentity.on("init",   user => user ? showAdmin(user) : showLogin());
netlifyIdentity.on("login",  user => { netlifyIdentity.close(); showAdmin(user); });
netlifyIdentity.on("logout", ()   => showLogin());

document.getElementById("login-btn").addEventListener("click",
  () => netlifyIdentity.open("login"));

document.getElementById("logout-btn").addEventListener("click",
  () => netlifyIdentity.logout());

function showAdmin(user) {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("admin-ui").classList.remove("hidden");
  document.getElementById("user-email").textContent = user.email;
  document.getElementById("chat-input").focus();
}

function showLogin() {
  document.getElementById("admin-ui").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
}

// ── Image handling ──────────────────────────────────────────

const imageUpload    = document.getElementById("image-upload");
const previewRow     = document.getElementById("image-preview-row");
const previewImg     = document.getElementById("preview-img");
const removeImageBtn = document.getElementById("remove-image");

imageUpload.addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) readImage(file);
});

removeImageBtn.addEventListener("click", clearImage);

// Paste image from clipboard
document.addEventListener("paste", e => {
  const item = [...e.clipboardData.items].find(i => i.type.startsWith("image/"));
  if (item) readImage(item.getAsFile());
});

function readImage(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const [, data] = ev.target.result.split(",");
    pendingImage = { data, mediaType: file.type };
    previewImg.src = ev.target.result;
    previewRow.classList.remove("hidden");
    updateSendBtn();
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  pendingImage = null;
  previewRow.classList.add("hidden");
  previewImg.src = "";
  imageUpload.value = "";
  updateSendBtn();
}

// ── Input ───────────────────────────────────────────────────

const chatInput = document.getElementById("chat-input");
const sendBtn   = document.getElementById("send-btn");

chatInput.addEventListener("input", () => {
  updateSendBtn();
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + "px";
});

chatInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) send();
  }
});

sendBtn.addEventListener("click", send);

function updateSendBtn() {
  sendBtn.disabled = !chatInput.value.trim() && !pendingImage;
}

// ── Chat ────────────────────────────────────────────────────

async function send() {
  const text = chatInput.value.trim();
  if (!text && !pendingImage) return;

  // Build the message content for the API
  const content = [];
  if (pendingImage) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: pendingImage.mediaType, data: pendingImage.data },
    });
  }
  if (text) content.push({ type: "text", text });

  // Display in UI
  appendMessage("user", text || "📷 Card image");

  // Add to conversation history
  history.push({
    role: "user",
    content: content.length === 1 && content[0].type === "text" ? text : content,
  });

  // Clear input state
  chatInput.value = "";
  chatInput.style.height = "auto";
  sendBtn.disabled = true;
  clearImage();

  // Typing indicator
  const typing = appendTyping();

  try {
    const token = netlifyIdentity.currentUser()?.token?.access_token;
    const res = await fetch("/.netlify/functions/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages: history }),
    });

    const data = await res.json();
    typing.remove();

    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

    history.push({ role: "assistant", content: data.reply });
    appendMessage("assistant", data.reply);
  } catch (err) {
    typing.remove();
    appendMessage("error", `⚠️ ${err.message}`);
  }
}

// ── Render helpers ──────────────────────────────────────────

const messagesEl = document.getElementById("messages");

function appendMessage(role, text) {
  const wrap = document.createElement("div");
  wrap.className = `message ${role}`;

  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "🤖";
    wrap.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  // Basic markdown: bold, inline code, line breaks
  bubble.innerHTML = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");

  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return wrap;
}

function appendTyping() {
  const wrap = document.createElement("div");
  wrap.className = "message assistant";
  wrap.innerHTML = `
    <div class="avatar">🤖</div>
    <div class="message-bubble typing">
      <span></span><span></span><span></span>
    </div>`;
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return wrap;
}
