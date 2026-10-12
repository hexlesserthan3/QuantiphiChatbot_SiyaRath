import { randomUUID } from "node:crypto";

export const TONES = Object.freeze({
  professional:
    "Use a professional tone: polished, respectful, precise, and clearly structured. Avoid slang.",
  casual:
    "Use a casual tone: friendly, natural, and conversational. Explain ideas in approachable everyday language.",
  concise:
    "Use a concise tone: give the direct answer first, omit filler, and use short sentences or a few bullets.",
});
export const MAX_PROMPT = 8000;
export const MAX_MESSAGES = 200;
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function validateTone(tone) {
  if (!Object.hasOwn(TONES, tone))
    throw new AppError(400, "Choose Professional, Casual, or Concise.");
  return tone;
}
export function validatePrompt(prompt) {
  if (typeof prompt !== "string" || !prompt.trim())
    throw new AppError(400, "Enter a message first.");
  if (prompt.length > MAX_PROMPT)
    throw new AppError(
      400,
      `Messages can contain at most ${MAX_PROMPT} characters.`,
    );
  return prompt.trim();
}
export function validateId(id) {
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw new AppError(400, "Invalid conversation ID.");
  return id;
}
export function makeConversation(ownerId, tone) {
  return {
    id: randomUUID(),
    ownerId,
    title: "New conversation",
    tone: validateTone(tone),
    createdAt: new Date(),
    updatedAt: new Date(),
    messages: [],
    lockedUntil: null,
    lease: null,
  };
}
export function publicConversation(c) {
  const { ownerId, lease, lockedUntil, _id, ...safe } = c;
  return {
    ...safe,
    messages: safe.messages.map((m) => ({
      ...m,
      status:
        m.status === "streaming" &&
        (!lockedUntil || new Date(lockedUntil) < new Date())
          ? "interrupted"
          : m.status,
    })),
  };
}
export function summary(c) {
  return {
    id: c.id,
    title: c.title,
    tone: c.tone,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: c.messages.length,
    preview: (
      c.messages.findLast((m) => m.role === "user")?.content ||
      "Start a conversation"
    ).slice(0, 100),
  };
}
export function buildMessages(messages, tone) {
  // Keep complete user/assistant pairs only; never send failed partial responses as context.
  const pairs = [];
  for (let i = 0; i < messages.length - 1; i++) {
    if (
      messages[i].role === "user" &&
      messages[i + 1].role === "assistant" &&
      messages[i + 1].status === "complete"
    ) {
      pairs.push(messages.slice(i, i + 2));
      i++;
    }
  }
  const recent = [];
  let chars = 0;
  for (const pair of pairs.reverse().slice(0, 10)) {
    const size = pair.reduce((n, m) => n + m.content.length, 0);
    if (chars + size > 24000) break;
    recent.unshift(...pair);
    chars += size;
  }
  return [
    {
      role: "system",
      content: `You are Cadence, a helpful and honest AI assistant. Use Markdown when it improves clarity. Do not claim to browse the web or execute code. ${TONES[validateTone(tone)]}`,
    },
    ...recent.map(({ role, content }) => ({ role, content })),
  ];
}
export function toMarkdown(c) {
  const cleanTitle = c.title.replace(/[\r\n#]/g, " ");
  const sections = [
    `# ${cleanTitle}`,
    `Exported from Cadence. Created: ${new Date(c.createdAt).toISOString()}`,
  ];
  for (const m of c.messages) {
    sections.push(
      `## ${m.role === "user" ? "You" : "Cadence"} · ${m.tone || c.tone}\n\n${m.content || "(No response text)"}\n\n_${new Date(m.createdAt).toISOString()}${m.status !== "complete" ? ` · ${m.status}` : ""}_`,
    );
  }
  return sections.join("\n\n---\n\n") + "\n";
}
