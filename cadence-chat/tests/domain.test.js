import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMessages,
  validatePrompt,
  validateTone,
  makeConversation,
  publicConversation,
  toMarkdown,
} from "../server/domain.js";
import { loadConfig } from "../server/config.js";

test("server rejects invalid tones, blank prompts, and oversized input", () => {
  for (const tone of ["toString", "__proto__", "happy", undefined])
    assert.throws(() => validateTone(tone));
  for (const prompt of ["", "   ", {}, "a".repeat(8001)])
    assert.throws(() => validatePrompt(prompt));
  assert.equal(validatePrompt("  hello  "), "hello");
});
test("each tone becomes a server-owned system instruction", () => {
  for (const tone of ["professional", "casual", "concise"]) {
    const context = buildMessages([], tone);
    assert.equal(context[0].role, "system");
    assert.match(context[0].content, new RegExp(`${tone} tone`));
  }
});
test("context includes complete turns and excludes failed or interrupted replies", () => {
  const messages = [
    { role: "user", content: "one" },
    { role: "assistant", content: "answer", status: "complete" },
    { role: "user", content: "two" },
    { role: "assistant", content: "partial", status: "error" },
  ];
  assert.deepEqual(buildMessages(messages, "concise").slice(1), [
    { role: "user", content: "one" },
    { role: "assistant", content: "answer" },
  ]);
  const long = Array.from({ length: 30 }, (_, i) => [
    { role: "user", content: String(i) },
    { role: "assistant", content: "a", status: "complete" },
  ]).flat();
  assert.equal(buildMessages(long, "casual").length, 21);
});
test("public representation hides ownership/leases and marks abandoned streams", () => {
  const c = makeConversation("secret-owner", "professional");
  c.messages.push({
    role: "assistant",
    content: "partial",
    status: "streaming",
  });
  const safe = publicConversation(c);
  assert.equal(safe.ownerId, undefined);
  assert.equal(safe.lease, undefined);
  assert.equal(safe.messages[0].status, "interrupted");
});
test("export preserves roles, timestamps, tone, and interrupted text", () => {
  const c = makeConversation("owner", "casual");
  c.messages = [
    {
      role: "assistant",
      content: "Partial answer",
      status: "interrupted",
      tone: "casual",
      createdAt: new Date(),
    },
  ];
  const md = toMarkdown(c);
  assert.match(md, /Cadence · casual/);
  assert.match(md, /Partial answer/);
  assert.match(md, /interrupted/);
});
test("startup always requires an API key and MongoDB configuration", () => {
  assert.throws(() => loadConfig({}), /MONGODB_URI/);
  assert.throws(
    () => loadConfig({ MONGODB_URI: "mongodb://localhost" }),
    /OPENAI_API_KEY/,
  );
  assert.throws(() => loadConfig({ PORT: "abc" }), /PORT/);
  const config = loadConfig({
    MONGODB_URI: "mongodb://localhost",
    OPENAI_API_KEY: "test-key",
  });
  assert.equal(config.model, "gpt-4.1-mini");
});
