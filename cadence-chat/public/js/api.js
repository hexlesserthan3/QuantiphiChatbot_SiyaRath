import { readSse } from "./sse.js";
export async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}
export async function streamReply(id, payload, signal, onEvent) {
  const response = await fetch(`/api/conversations/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Unable to send your message.");
  }
  let complete = false;
  for await (const { event, data } of readSse(response.body)) {
    const parsed = JSON.parse(data);
    if (event === "error") throw new Error(parsed.message);
    if (event === "done") complete = true;
    onEvent(event, parsed);
  }
  if (!complete)
    throw new Error(
      "The connection ended early. Your saved conversation will be reloaded.",
    );
}
