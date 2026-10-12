# Viva guide

Use these notes to understand the code, then explain it in your own words.

## Two-minute walkthrough

1. Run live mode with a working OpenAI key and MongoDB. Point out the Live AI badge.
2. Ask: “Explain an API using a simple analogy.” Show character-by-character output and separate chat bubbles.
3. Select Concise and ask: “Now explain the same thing in two short sentences.” Explain that the backend changes a system instruction; it does not merely relabel the interface.
4. Start another conversation, then reopen the first from the sidebar.
5. Search for a word from a response. This is extra feature one.
6. Export the conversation to Markdown. This is extra feature two.
7. Restart the server and reopen history to demonstrate MongoDB persistence.
8. If time permits, stop a longer response and show the saved interrupted reply.

## Questions you should be ready to answer

**Where is the API key?**

In the server's environment. `server/services/provider.js` sends it to OpenAI in an Authorization header. The browser sees only safe configuration and chat events.

**How does tone affect the answer?**

`server/domain.js` defines a fixed map of three tone instructions. `buildMessages()` places the selected instruction in a system message. `ChatService` calls it for every reply, so changing the toggle affects the next request immediately.

**Is streaming real or simulated?**

The backend receives real incremental OpenAI responses and relays them as SSE. The frontend additionally animates incoming text character by character. The application has no alternate response provider.

**Why use fetch instead of EventSource?**

The message endpoint is POST and needs a JSON body. Fetch supports both the POST and reading a streaming response. The shared parser converts the byte stream into SSE events.

**How is history stored?**

MongoDB stores one document per conversation with its title, tone, timestamps, owner hash, and an array of user/assistant messages. The repository uses an owner filter on every read, update, export, and deletion.

**What are the two extra features, and why?**

Search helps users retrieve useful information across longer histories. Markdown export lets them reuse or archive a conversation outside the app. Both operations are implemented on the server.

**What happens when the user clicks Stop?**

The browser aborts its fetch. The server detects the closed connection, aborts OpenAI, and saves accumulated text in a `finally` block. It marks the response interrupted and unlocks the conversation.

**What prevents two simultaneous replies from corrupting a thread?**

MongoDB atomically acquires a conversation lease. A second request receives HTTP 409. The lease is released when the first request finishes and has an expiry for crash recovery.

**Does the AI remember every message forever?**

History is stored, but the provider receives only a bounded recent context: up to 10 complete turns and 24,000 characters of previous content, plus the current prompt. Failed and interrupted turns are excluded. Older details may need to be restated.

**How are malicious HTML or scripts handled?**

The frontend builds text nodes and supports a small Markdown subset. It never inserts user/model HTML into the page. CSP provides another layer of protection.

**How does one user's history stay separate?**

The server creates an unguessable HttpOnly cookie and hashes its value into an owner ID. Every database operation filters by that owner. This is browser-session isolation, not an account/login system; different devices do not share history.

**What would you add for production?**

Authenticated accounts, durable shared rate limits and quotas, retention/deletion policies, structured observability, pagination and indexed search, and autoscaling/streaming infrastructure. Do not claim those are already implemented.

## Key files to read before submission

1. `server/domain.js` — tone mapping and context.
2. `server/services/chat.js` — complete request lifecycle.
3. `server/services/provider.js` — OpenAI streaming protocol.
4. `server/repositories/mongo.js` — MongoDB queries and lease.
5. `public/js/app.js` — frontend state, typewriter animation, Stop, and history.
6. `tests/` — what is checked, and what requires live services.

The supplied assessment permits AI tools and evaluates implementation understanding. Be candid about using AI assistance, and verify the project with your own configuration before presenting it.
