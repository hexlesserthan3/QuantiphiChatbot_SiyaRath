# Architecture

## Request flow

1. The browser sends `{ prompt, tone }` to the conversation's message endpoint. It does not send an API key, a custom system instruction, or fabricated conversation history.
2. The server resolves the browser's opaque session cookie to an owner hash, validates input, and acquires a short database lease for that conversation.
3. It saves the user message and an empty assistant message with `status: streaming` before contacting the AI.
4. The server reads complete recent turns from MongoDB and prepends a system instruction from a fixed tone map.
5. OpenAI returns SSE chunks. The backend extracts text and relays `delta` events to the browser.
6. The browser progressively displays characters. When finished, it renders a safe subset of Markdown using DOM text nodes.
7. The backend saves the final or partial response, records its status, releases the lease, and emits `done` only after persistence succeeds.

The server owns prompt validation, tone selection rules, history selection, title generation, ownership checks, search, export formatting, and persistence. The browser owns presentation, input events, character animation, and navigation.

## Conversation document

```js
{
  id: "UUID",
  ownerId: "SHA-256 hash of a 256-bit browser token",
  title: "First prompt, normalized and limited to 60 characters",
  tone: "professional", // or casual / concise
  createdAt: Date,
  updatedAt: Date,
  lease: null,          // UUID while generating; never exposed to client
  lockedUntil: null,    // Date while generating
  messages: [{
    id: "UUID",
    role: "user",      // or assistant
    content: "Message text",
    tone: "professional",
    createdAt: Date,
    status: "complete" // streaming / complete / interrupted / error
  }]
}
```

`id` has a unique index. `{ ownerId: 1, updatedAt: -1 }` supports history lookups. Every conversation access includes the owner ID. Text search escapes regular-expression metacharacters before using MongoDB's regex query; it searches only that owner's conversations. A larger application should add pagination and a dedicated search index.

Each conversation is limited to 200 messages, preventing unbounded document growth. Responses are limited to 1,600 output tokens and 40,000 characters. Prompt length is limited to 8,000 characters. Model context includes at most 10 complete previous turns and 24,000 prior characters; this is a conservative character budget rather than exact token counting.

## Tone behavior

The client sends a tone enum. The server rejects unknown values and uses its own fixed instruction:

- Professional: polished, respectful, precise, clearly structured.
- Casual: friendly, conversational, approachable.
- Concise: direct answer first, short sentences, no filler.

The instruction is sent as the first `system` message on every new AI request. Changing tone affects the next answer, including in an existing thread. Existing replies are not rewritten, and the tone control is disabled during an active response.

## HTTP API

All JSON responses use the same-origin session cookie. Errors are `{ "error": "human-readable message" }` before streaming begins.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Database ping and server mode |
| GET | `/api/config` | Public model/mode/limits, never credentials |
| GET | `/api/conversations?q=term` | Owner-scoped title and message search |
| POST | `/api/conversations` | Create with `{ tone }` |
| GET | `/api/conversations/:id` | Retrieve full thread |
| PATCH | `/api/conversations/:id` | Save `{ tone }` |
| DELETE | `/api/conversations/:id` | Delete an idle thread |
| POST | `/api/conversations/:id/messages` | Stream a reply to `{ prompt, tone }` |
| GET | `/api/conversations/:id/export` | Download Markdown transcript |

Stream event order:

- `meta`: persisted user and pending assistant messages; conversation title.
- `delta`: `{ text }` increment.
- `done`: full saved conversation.
- `error`: `{ message }` if an error occurs after headers are sent.

Heartbeats are SSE comments. Fetch-based streaming supports POST request bodies; native `EventSource` only supports GET. The parser handles UTF-8 and event frames split across arbitrary network chunks.

## Cancellation and concurrency

A client disconnection aborts the provider request. The chat service's `finally` block saves accumulated text and marks it interrupted, then releases the lease. A 90-second response timeout also aborts generation. The MongoDB lease expires after 120 seconds, protecting against simultaneous requests across app processes while allowing recovery after a crash.

Partial text is saved on normal cancellation or failure, not after every token. A hard process crash can therefore lose the in-progress text; the pending message is displayed as interrupted after the lease expires. Completed messages remain persisted. Failed/interrupted exchanges are omitted from future context so the model does not treat them as successful answers.

## Security and boundaries

- API key and MongoDB connection string stay on the server.
- Opaque 32-byte random cookie, HttpOnly, SameSite=Lax; Secure under HTTPS production mode.
- Owner hash is never returned by the API.
- Same-origin write checks, JSON body size limits, enum validation, and per-IP/session rate limits.
- No raw model HTML enters the DOM. A restrictive Content Security Policy blocks inline scripts and external resources.
- No user accounts, external tools, file attachments, or internet search.
- The runtime always uses OpenAI and MongoDB. Missing configuration stops startup with a clear error.
- Multi-process production deployments need a shared rate limiter and an authentication/authorization layer appropriate for real accounts.

## Why this structure?

Repository and provider interfaces allow test doubles in the test suite, while application startup always selects MongoDB and OpenAI. The chat service can therefore be tested for cancellation, persistence, and error handling without making paid network requests. Serving the frontend and backend from one origin keeps setup simple and avoids exposing API credentials or introducing unnecessary CORS complexity.
