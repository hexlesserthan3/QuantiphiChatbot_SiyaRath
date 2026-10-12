import test from "node:test";
import assert from "node:assert/strict";
import { readSse } from "../public/js/sse.js";
import { OpenAIProvider } from "../server/services/provider.js";
import { ChatService } from "../server/services/chat.js";
import { MemoryRepository } from "./helpers/memory.js";

function bytesStream(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
}
async function collect(source) {
  const result = [];
  for await (const item of source) result.push(item);
  return result;
}
test("SSE parsing handles byte boundaries, Unicode, CRLF, comments, and multiline data", async () => {
  const events = await collect(
    readSse(
      bytesStream(
        ": heartbeat\r\n\r\nevent: delta\r\ndata: Hello 🌸\r\n\r\ndata: one\ndata: two\n\n",
      ),
    ),
  );
  assert.deepEqual(events, [
    { event: "delta", data: "Hello 🌸" },
    { event: "message", data: "one\ntwo" },
  ]);
});
test("incomplete SSE frames are errors", async () => {
  await assert.rejects(
    collect(readSse(bytesStream("data: broken"))),
    /unexpectedly/,
  );
});
test("OpenAI adapter sends streaming system messages and extracts deltas", async () => {
  let sent;
  const provider = new OpenAIProvider(
    { apiKey: "test-key", model: "gpt-4.1-mini" },
    async (url, init) => {
      sent = { url, ...init };
      return new Response(
        bytesStream(
          'data: {"choices":[{"delta":{"content":"Hello 🌸"}}]}\n\ndata: [DONE]\n\n',
        ),
      );
    },
  );
  const messages = [
    { role: "system", content: "Be concise" },
    { role: "user", content: "Hi" },
  ];
  assert.deepEqual(
    await collect(
      provider.stream(messages, { signal: new AbortController().signal }),
    ),
    ["Hello 🌸"],
  );
  assert.equal(sent.url, "https://api.openai.com/v1/chat/completions");
  const body = JSON.parse(sent.body);
  assert.equal(body.stream, true);
  assert.equal(body.store, false);
  assert.deepEqual(body.messages, messages);
  assert.equal(sent.headers.Authorization, "Bearer test-key");
});
test("provider failures redact upstream details and incomplete streams fail", async () => {
  const denied = new OpenAIProvider(
    {},
    async () => new Response("secret-upstream-info", { status: 401 }),
  );
  await assert.rejects(
    collect(denied.stream([], {})),
    (error) => error.status === 502 && !error.message.includes("secret"),
  );
  const broken = new OpenAIProvider(
    {},
    async () =>
      new Response('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'),
  );
  await assert.rejects(collect(broken.stream([], {})), /ended early/);
});
test("failed replies keep partial text and release the lease for retry", async () => {
  const repo = new MemoryRepository();
  const c = await repo.create("a", "casual");
  const service = new ChatService(repo, {
    async *stream() {
      yield "partial";
      throw new Error("upstream failed");
    },
  });
  await assert.rejects(
    collect(
      service.reply(
        "a",
        c.id,
        { prompt: "Hi", tone: "casual" },
        new AbortController().signal,
      ),
    ),
  );
  const saved = await repo.get("a", c.id);
  assert.equal(saved.messages[1].content, "partial");
  assert.equal(saved.messages[1].status, "error");
  assert.equal(saved.lease, null);
  await repo.acquire("a", c.id, "next-request");
});
test("stopping generation stores partial text as interrupted", async () => {
  const controller = new AbortController();
  const repo = new MemoryRepository();
  const c = await repo.create("a", "concise");
  const service = new ChatService(repo, {
    async *stream() {
      yield "saved text";
      controller.abort();
      controller.signal.throwIfAborted();
    },
  });
  await assert.rejects(
    collect(
      service.reply(
        "a",
        c.id,
        { prompt: "Hi", tone: "concise" },
        controller.signal,
      ),
    ),
  );
  const saved = await repo.get("a", c.id);
  assert.equal(saved.messages[1].status, "interrupted");
  assert.equal(saved.messages[1].content, "saved text");
  assert.equal(saved.lease, null);
});
test("concurrent generation is rejected, but other conversations are independent", async () => {
  const repo = new MemoryRepository();
  const first = await repo.create("a", "casual"),
    second = await repo.create("a", "casual");
  await repo.acquire("a", first.id, "one");
  await assert.rejects(
    repo.acquire("a", first.id, "two"),
    (error) => error.status === 409,
  );
  await assert.rejects(
    repo.delete("a", first.id),
    (error) => error.status === 409,
  );
  assert.equal((await repo.acquire("a", second.id, "two")).lease, "two");
});
