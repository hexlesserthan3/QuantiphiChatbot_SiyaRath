import { request, streamReply } from "./api.js";
import { renderMarkdown } from "./markdown.js";

const $ = (id) => document.getElementById(id);
const state = {
  current: null,
  tone: "professional",
  busy: false,
  ready: false,
  controller: null,
  chats: [],
  searchVersion: 0,
  animation: null,
  toastTimer: null,
};
const toneText = {
  professional: "Polished & thoughtful",
  casual: "Friendly & easygoing",
  concise: "Short & to the point",
};
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const time = (date) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}
function error(message) {
  $("error-text").textContent = message;
  $("error-banner").hidden = false;
}
function clearError() {
  $("error-banner").hidden = true;
}
function toast(message) {
  clearTimeout(state.toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  state.toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 3000);
}
function showSidebar(open) {
  $("sidebar").classList.toggle("open", open);
  $("backdrop").hidden = !open;
  $("open-sidebar").setAttribute("aria-expanded", String(open));
  if (open) $("search").focus();
}
function nearBottom() {
  const s = $("scroll-area");
  return s.scrollHeight - s.scrollTop - s.clientHeight < 130;
}
function scrollBottom() {
  $("scroll-area").scrollTop = $("scroll-area").scrollHeight;
}
function updateControls() {
  $("send-button").disabled =
    !state.ready || state.busy || !$("prompt").value.trim();
  $("send-button").hidden = state.busy;
  $("stop-button").hidden = !state.busy;
  $("new-chat").disabled = state.busy || !state.ready;
  $("export-chat").disabled = state.busy || !state.current?.messages.length;
  $("delete-chat").disabled = state.busy || !state.current;
  $("prompt").disabled = state.busy || !state.ready;
  document.querySelectorAll("[data-tone]").forEach((b) => {
    b.disabled = state.busy || !state.ready;
    b.classList.toggle("active", b.dataset.tone === state.tone);
    b.setAttribute("aria-pressed", String(b.dataset.tone === state.tone));
  });
  document.querySelectorAll(".suggestion").forEach((b) => {
    b.disabled = state.busy || !state.ready;
  });
  document.querySelectorAll(".history-item").forEach((b) => {
    b.disabled = state.busy;
  });
  $("tone-description").textContent = toneText[state.tone];
  $("composer-tone").textContent =
    `${state.tone[0].toUpperCase()}${state.tone.slice(1)} tone`;
  $("conversation-title").textContent =
    state.current?.title || "A fresh conversation";
}
function updateInput() {
  $("character-count").textContent =
    `${$("prompt").value.length.toLocaleString()} / 8,000`;
  $("prompt").style.height = "auto";
  $("prompt").style.height = `${Math.min($("prompt").scrollHeight, 140)}px`;
  updateControls();
}
async function loadHistory() {
  const version = ++state.searchVersion;
  const data = await request(
    `/conversations?q=${encodeURIComponent($("search").value)}`,
  );
  if (version !== state.searchVersion) return;
  state.chats = data.conversations;
  renderHistory();
}
function renderHistory() {
  const container = $("conversation-list");
  container.replaceChildren();
  $("chat-count").textContent = state.chats.length;
  if (!state.chats.length) {
    const empty = el("div", "history-empty");
    empty.append(
      icon("chat"),
      el(
        "strong",
        "",
        $("search").value ? "No conversations found" : "A clean slate",
      ),
    );
    empty.append(
      el(
        "span",
        "",
        $("search").value
          ? "Try a different word or phrase."
          : "Your conversations will find a home here.",
      ),
    );
    container.append(empty);
    return;
  }
  for (const c of state.chats) {
    const button = el(
      "button",
      `history-item${state.current?.id === c.id ? " selected" : ""}`,
    );
    button.disabled = state.busy;
    button.setAttribute(
      "aria-current",
      state.current?.id === c.id ? "true" : "false",
    );
    button.title = c.title;
    const info = el("div");
    info.append(el("strong", "", c.title), el("p", "", c.preview));
    const date = new Date(c.updatedAt);
    const today = date.toDateString() === new Date().toDateString();
    button.append(
      icon("chat"),
      info,
      el(
        "span",
        "history-time",
        today
          ? "Today"
          : date.toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
            }),
      ),
    );
    button.addEventListener("click", () => openConversation(c.id));
    container.append(button);
  }
}
function renderMessages() {
  const hasMessages = Boolean(state.current?.messages.length);
  $("welcome").hidden = hasMessages;
  $("messages").hidden = !hasMessages;
  $("messages").replaceChildren();
  for (const m of state.current?.messages || [])
    $("messages").append(messageNode(m));
  updateControls();
}
function messageNode(m) {
  const article = el("article", `message ${m.role}`);
  article.dataset.id = m.id;
  const avatar = el("div", "message-avatar", m.role === "user" ? "Y" : "✳");
  avatar.setAttribute("aria-hidden", "true");
  const body = el("div", "message-body");
  const meta = el("div", "message-meta");
  meta.append(
    el("strong", "", m.role === "user" ? "You" : "Cadence"),
    el("span", "", time(m.createdAt)),
  );
  if (m.role === "assistant") meta.append(el("span", "", m.tone));
  const bubble = el("div", "message-bubble");
  const content = el("div", "message-content");
  if (m.role === "user") content.textContent = m.content;
  else if (m.status === "streaming") {
    content.classList.add("streaming");
    content.textContent = m.content;
  } else
    renderMarkdown(
      content,
      m.content ||
        (m.status === "error"
          ? "No response received. Please try sending your message again."
          : "Response stopped before any text arrived."),
    );
  bubble.append(content);
  body.append(meta, bubble);
  if (m.role === "assistant" && m.status !== "streaming") {
    const actions = el("div", "message-actions");
    if (m.content) {
      const copy = el("button");
      copy.append(icon("copy"), document.createTextNode("Copy"));
      copy.setAttribute("aria-label", "Copy assistant response");
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(m.content);
          toast("Response copied");
        } catch {
          error(
            "Clipboard access is unavailable. Select the response text to copy it.",
          );
        }
      });
      actions.append(copy);
    }
    if (m.status !== "complete")
      actions.append(
        el(
          "span",
          "message-state",
          m.status === "error"
            ? "Reply failed · partial text saved"
            : "Reply interrupted · partial text saved",
        ),
      );
    body.append(actions);
  }
  article.append(avatar, body);
  return article;
}
async function openConversation(id) {
  if (state.busy) return;
  clearError();
  // Prevent slow navigation responses from overwriting a newer selection.
  const version = Symbol();
  state.navigation = version;
  try {
    const { conversation } = await request(`/conversations/${id}`);
    if (state.navigation !== version) return;
    state.current = conversation;
    state.tone = conversation.tone;
    renderMessages();
    renderHistory();
    scrollBottom();
    showSidebar(false);
    $("prompt").focus();
  } catch (err) {
    error(err.message);
  }
}
function newConversation() {
  if (state.busy) return;
  state.navigation = Symbol();
  state.current = null;
  $("prompt").value = "";
  clearError();
  $("stream-status").textContent = "";
  renderMessages();
  renderHistory();
  updateInput();
  showSidebar(false);
  $("prompt").focus();
}
async function setTone(tone) {
  if (state.busy || tone === state.tone) return;
  const previous = state.tone;
  state.tone = tone;
  updateControls();
  const selectedId = state.current?.id;
  if (!selectedId) return;
  // Hold controls until the server accepts the preference; message submission also validates tone.
  state.busy = true;
  updateControls();
  $("stop-button").hidden = true;
  try {
    const { conversation } = await request(`/conversations/${selectedId}`, {
      method: "PATCH",
      body: JSON.stringify({ tone }),
    });
    state.current = conversation;
  } catch (err) {
    state.tone = previous;
    error(err.message);
  } finally {
    state.busy = false;
    updateControls();
  }
}
function startAnimation(node) {
  const animation = { node, all: "", shown: 0, frame: null, last: 0 };
  function tick(timestamp) {
    if (timestamp - animation.last >= 16) {
      const stick = nearBottom();
      animation.shown = reducedMotion
        ? animation.all.length
        : Math.min(
            animation.all.length,
            animation.shown +
              Math.max(
                2,
                Math.ceil((animation.all.length - animation.shown) / 18),
              ),
          );
      node.textContent = animation.all.slice(0, animation.shown);
      if (stick) scrollBottom();
      animation.last = timestamp;
    }
    animation.frame = requestAnimationFrame(tick);
  }
  animation.frame = requestAnimationFrame(tick);
  state.animation = animation;
  return animation;
}
function stopAnimation() {
  if (state.animation) cancelAnimationFrame(state.animation.frame);
  state.animation = null;
}
async function reloadAfterStream(id) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { conversation } = await request(`/conversations/${id}`);
    if (!conversation.messages.some((m) => m.status === "streaming"))
      return conversation;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    "The server is still finishing this reply. Reopen the conversation in a moment.",
  );
}
async function sendMessage(event) {
  event?.preventDefault();
  if (state.busy || !state.ready || !$("prompt").value.trim()) return;
  const prompt = $("prompt").value;
  clearError();
  state.navigation = Symbol();
  state.busy = true;
  state.controller = new AbortController();
  $("stop-button").disabled = false;
  updateControls();
  $("stream-status").textContent = "Connecting a few dots…";
  let accepted = false,
    completed = false,
    id;
  try {
    if (!state.current) {
      const data = await request("/conversations", {
        method: "POST",
        body: JSON.stringify({ tone: state.tone }),
        signal: state.controller.signal,
      });
      state.current = data.conversation;
    }
    id = state.current.id;
    await streamReply(
      id,
      { prompt, tone: state.tone },
      state.controller.signal,
      (name, data) => {
        if (name === "meta") {
          accepted = true;
          state.current.title = data.title;
          state.current.messages.push(data.user, data.assistant);
          $("prompt").value = "";
          updateInput();
          renderMessages();
          scrollBottom();
          const node = [...$("messages").children]
            .at(-1)
            .querySelector(".message-content");
          startAnimation(node);
          $("stream-status").textContent =
            `Cadence is replying in a ${state.tone} tone…`;
        } else if (name === "delta") {
          state.animation.all += data.text;
        } else if (name === "done") {
          completed = true;
          state.current = data.conversation;
        }
      },
    );
    // Drain the remaining typewriter characters quickly without delaying longer responses.
    const until = performance.now() + 1200;
    while (
      state.animation &&
      state.animation.shown < state.animation.all.length &&
      performance.now() < until &&
      !state.controller.signal.aborted
    )
      await new Promise((r) => setTimeout(r, 30));
    $("stream-status").textContent = "Reply complete";
  } catch (err) {
    const cancelled = state.controller.signal.aborted;
    if (!cancelled) error(err.message);
    $("stream-status").textContent = cancelled
      ? "Reply stopped. Partial text is saved."
      : "The reply could not be completed.";
    if (!accepted) $("prompt").value = prompt;
  } finally {
    stopAnimation();
    if (id && !completed) {
      try {
        state.current = await reloadAfterStream(id);
      } catch (err) {
        error(err.message);
      }
    }
    state.busy = false;
    state.controller = null;
    const stick = nearBottom();
    renderMessages();
    updateInput();
    if (stick) scrollBottom();
    try {
      await loadHistory();
    } catch (err) {
      error(err.message);
    }
    $("prompt").focus();
  }
}
async function deleteConversation() {
  if (state.busy || !state.current) return;
  $("delete-dialog").showModal();
}
$("delete-dialog").addEventListener("close", async () => {
  if ($("delete-dialog").returnValue !== "delete" || !state.current) return;
  try {
    await request(`/conversations/${state.current.id}`, { method: "DELETE" });
    newConversation();
    await loadHistory();
    toast("Conversation deleted");
  } catch (err) {
    error(err.message);
  }
});
$("export-chat").addEventListener("click", async () => {
  if (!state.current || state.busy) return;
  try {
    const response = await fetch(
      `/api/conversations/${state.current.id}/export`,
    );
    if (!response.ok)
      throw new Error("Could not export this conversation. Please try again.");
    const url = URL.createObjectURL(await response.blob());
    const link = el("a");
    link.href = url;
    link.download = `cadence-${state.current.id.slice(0, 8)}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Conversation exported");
  } catch (err) {
    error(err.message);
  }
});
$("new-chat").addEventListener("click", newConversation);
$("delete-chat").addEventListener("click", deleteConversation);
$("composer").addEventListener("submit", sendMessage);
$("stop-button").addEventListener("click", () => {
  state.controller?.abort();
  $("stop-button").disabled = true;
  $("stream-status").textContent = "Stopping and saving…";
});
$("prompt").addEventListener("input", updateInput);
$("prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendMessage();
  }
});
$("dismiss-error").addEventListener("click", clearError);
$("open-sidebar").addEventListener("click", () => showSidebar(true));
$("close-sidebar").addEventListener("click", () => showSidebar(false));
$("backdrop").addEventListener("click", () => showSidebar(false));
document
  .querySelectorAll("[data-tone]")
  .forEach((button) =>
    button.addEventListener("click", () => setTone(button.dataset.tone)),
  );
document.querySelectorAll(".suggestion").forEach((button) =>
  button.addEventListener("click", () => {
    $("prompt").value = button.dataset.prompt;
    updateInput();
    $("prompt").focus();
  }),
);
let searchTimer;
$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  ++state.searchVersion;
  searchTimer = setTimeout(
    () => loadHistory().catch((err) => error(err.message)),
    220,
  );
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") showSidebar(false);
  if (
    event.key.toLowerCase() === "n" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) &&
    !$("delete-dialog").open
  )
    newConversation();
});
async function init() {
  updateControls();
  renderHistory();
  try {
    const config = await request("/config");
    $("mode-badge").replaceChildren(
      el("span"),
      document.createTextNode("Live AI"),
    );
    $("mode-badge").classList.add("live");
    $("mode-badge").title = config.model;
    await loadHistory();
    state.ready = true;
    updateControls();
    $("prompt").focus();
  } catch {
    $("mode-badge").replaceChildren(
      el("span"),
      document.createTextNode("Offline"),
    );
    error(
      "Cannot connect to the server. Check that it is running, then reload this page.",
    );
  }
}
init();
