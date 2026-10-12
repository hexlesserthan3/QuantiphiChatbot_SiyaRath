import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { MemoryRepository } from "./helpers/memory.js";
import { readSse } from "../public/js/sse.js";

async function fixture(t) {
  const repository = new MemoryRepository();
  const calls = [];
  const provider = {
    async *stream(messages) {
      calls.push(messages);
      yield "A helpful ";
      yield "answer 🌸";
    },
  };
  const server = createApp({
    repository,
    provider,
    config: { model: "gpt-4.1-mini", requestTimeoutMs: 3000 },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie;
    return async (path, options = {}) => {
      const response = await fetch(base + path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...options.headers,
        },
      });
      cookie = response.headers.get("set-cookie")?.split(";")[0] || cookie;
      return response;
    };
  }
  return { request: client(), client, calls, repository };
}
test("full lifecycle: create, stream, retrieve, search, tone, export, delete", async (t) => {
  const f = await fixture(t);
  let res = await f.request("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ tone: "casual" }),
  });
  assert.equal(res.status, 201);
  const { conversation } = await res.json();
  const id = conversation.id;
  res = await f.request(`/api/conversations/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ prompt: "Explain closures", tone: "concise" }),
  });
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  const events = [];
  for await (const event of readSse(res.body))
    events.push({ event: event.event, data: JSON.parse(event.data) });
  assert.deepEqual(
    events.map((e) => e.event),
    ["meta", "delta", "delta", "done"],
  );
  assert.equal(
    events.at(-1).data.conversation.messages[1].content,
    "A helpful answer 🌸",
  );
  assert.match(f.calls[0][0].content, /concise tone/);
  const saved = await (await f.request(`/api/conversations/${id}`)).json();
  assert.equal(saved.conversation.messages.length, 2);
  assert.equal(saved.conversation.ownerId, undefined);
  const results = await (
    await f.request("/api/conversations?q=helpful")
  ).json();
  assert.equal(results.conversations.length, 1);
  assert.equal(
    (await (await f.request("/api/conversations?q=unmatched")).json())
      .conversations.length,
    0,
  );
  res = await f.request(`/api/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ tone: "professional" }),
  });
  assert.equal((await res.json()).conversation.tone, "professional");
  res = await f.request(`/api/conversations/${id}/export`);
  assert.match(res.headers.get("content-disposition"), /attachment/);
  assert.match(await res.text(), /Explain closures/);
  assert.equal(
    (await f.request(`/api/conversations/${id}`, { method: "DELETE" })).status,
    204,
  );
  assert.equal((await f.request(`/api/conversations/${id}`)).status, 404);
});
test("browser sessions cannot read, search, change, export, delete, or message each other’s chats", async (t) => {
  const f = await fixture(t);
  const stranger = f.client();
  const { conversation } = await (
    await f.request("/api/conversations", {
      method: "POST",
      body: '{"tone":"casual"}',
    })
  ).json();
  const base = `/api/conversations/${conversation.id}`;
  for (const [path, method, body] of [
    [base, "GET"],
    [base + "/export", "GET"],
    [base, "DELETE"],
    [base, "PATCH", '{"tone":"concise"}'],
    [base + "/messages", "POST", '{"tone":"concise","prompt":"Hello"}'],
  ]) {
    assert.equal(
      (await stranger(path, { method, ...(body ? { body } : {}) })).status,
      404,
    );
  }
  assert.equal(
    (await (await stranger("/api/conversations")).json()).conversations.length,
    0,
  );
});
test("API rejects malicious or invalid requests and never exposes secrets", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.request("/api/conversations", {
        method: "POST",
        body: '{"tone":"__proto__"}',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/conversations", {
        method: "POST",
        body: '{"tone":"casual"}',
        headers: { Origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.request("/api/conversations", { method: "POST", body: "{" }))
      .status,
    400,
  );
  assert.equal((await f.request("/api/conversations?q[x]=y")).status, 400);
  assert.equal((await f.request("/api/conversations/not-an-id")).status, 400);
  const res = await f.request("/api/config");
  assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
  const config = await res.json();
  assert.equal(config.apiKey, undefined);
  assert.equal(config.mongoUri, undefined);
  const { conversation } = await (
    await f.request("/api/conversations", { method: "POST", body: "{}" })
  ).json();
  assert.equal(
    (
      await f.request(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        body: '{"prompt":" ","tone":"casual"}',
      })
    ).status,
    400,
  );
});
test("server refuses oversized payloads and rate-limits mutation requests", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.request("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ x: "x".repeat(20000) }),
      })
    ).status,
    413,
  );
  let response;
  for (let i = 0; i < 31; i++)
    response = await f.request("/api/conversations", {
      method: "POST",
      body: "{}",
    });
  assert.equal(response.status, 429);
});
