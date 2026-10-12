# Cadence · AI Chat Assistant

A calm, responsive chat workspace with streamed AI replies, persistent MongoDB conversations, and a response tone you control.

Built for the **AI Chat Assistant** problem statement. The interface uses HTML, CSS, and browser JavaScript modules; a Node.js + Express server owns validation, conversation state, OpenAI requests, search, and export. There is no frontend build step.

## Features

| Requirement | Implementation |
| --- | --- |
| Scrollable chat with distinct user/AI bubbles | Responsive conversation view, timestamps, auto-scroll that respects manual scrolling |
| Character-by-character streaming | OpenAI server-sent events relayed through the backend; animated text in the browser |
| Conversation history sidebar | Create, reopen, and delete threads; history survives server restarts in live mode |
| OpenAI API integration | Server-only API key, streamed Chat Completions, recent conversation context |
| MongoDB persistence | Conversation records with prompts, responses, timestamps, tone, and completion status |
| Professional / Casual / Concise toggle | Validated backend tone mapping becomes a `system` instruction on every AI request |
| **Extra 1: Conversation search** | Server-side search over titles, user prompts, and AI responses |
| **Extra 2: Markdown export** | Download a complete transcript with roles, timestamps, tone, and interrupted-response markers |

Also includes Stop generation, partial-response preservation, copy response, starter prompts, keyboard shortcuts, browser-session isolation.

## Run the project

1. Install Node.js 22.9+.
2. Run `npm ci` in this folder.
3. Copy `.env.example` to `.env` (show hidden files if necessary).
4. Edit `.env`:

```dotenv
OPENAI_API_KEY=replace_with_your_actual_key
OPENAI_MODEL=gpt-4.1-mini
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=cadence_chat
PORT=3000
NODE_ENV=development
```

5. Start your local MongoDB service, or replace `MONGODB_URI` with an Atlas connection string. For Atlas, create a database user, allow your machine's IP address, and replace the password placeholder in the URI. URL-encode special characters in the password.
6. Run:

```bash
npm start
```

7. Open **http://localhost:3000**. The header should say **Live AI**. Send a message, then restart the server and reopen the thread to demonstrate persistence.

An OpenAI API key with access to the configured model and available API quota is required. Never paste your key into the UI or commit `.env`. The app always requires OpenAI and MongoDB. Missing configuration stops startup with a clear error.

### Windows PowerShell

```powershell
npm ci
Copy-Item .env.example .env
notepad .env
npm start
```

### Docker alternative

With Docker and Compose installed, create `.env` from `.env.example`, add your OpenAI key, then run:

```bash
docker compose up --build
```

Compose starts the app and MongoDB together. MongoDB uses a persistent named volume and is not exposed to the host network. The app binds to localhost. This Compose configuration is intended for local use, using HTTP and development-mode cookies.

## Get your credentials

1. Create a secret API key at [OpenAI API keys](https://platform.openai.com/api-keys). Check API billing/credits in your OpenAI Platform account and ensure access to the configured model.
2. For a cloud database, sign in at [MongoDB Atlas](https://www.mongodb.com/atlas), create a cluster, create a database user, and allow your current IP address in the project's network access list.
3. Open the cluster's Connect flow and choose the application/driver connection option. Copy its MongoDB connection string and substitute your database username/password. Use that full string as `MONGODB_URI` in `.env`.
4. Keep credentials on your computer in `.env`; do not paste them into chat, screenshots, or GitHub.

References: [OpenAI quickstart](https://developers.openai.com/api/docs/quickstart) · [Atlas connection guide](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/).

## GitHub upload

The outer download includes `START_HERE.txt` and `cadence-history.bundle`. Prefer the bundle instructions to preserve the actual incremental commits created while this project was built. Do not upload the bundle as your source code.

If using GitHub's browser uploader, upload **the contents of this project folder** to the repository root, including `.github`, `.gitignore`, `.dockerignore`, and `.env.example`. Do not upload the ZIP, `node_modules`, `.env`, or real credentials. A browser upload creates a single new commit and does not preserve the bundled development history.

Make the repository **public**, confirm `README.md`, `package.json`, `server/`, and `public/` are visible, and submit the repository URL through the assessment platform. Follow the deadline and commit restrictions in your supplied problem statement. This project has not been uploaded or submitted for you.

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Live server using `.env` |
| `npm run dev` | Server with automatic restart during development |
| `npm run check` | Check all JavaScript syntax |
| `npm test` | Unit and HTTP integration tests; no external services |
| `npm run test:mongo` | Real database integration test when `MONGODB_TEST_URI` is set |

For the MongoDB test, add `MONGODB_TEST_URI=mongodb://127.0.0.1:27017` to your local `.env` or environment. The test creates and removes its own randomly named database. It skips clearly if the test URI is missing. The included GitHub Actions workflow provisions MongoDB and runs it automatically.

## Project map

- `public/` — page, styling, safe text/Markdown rendering, UI state, and browser stream client.
- `server/app.js` — HTTP routes, session isolation, rate limits, and streaming transport.
- `server/domain.js` — validation, system instructions, context limits, public data shapes, and Markdown export.
- `server/services/chat.js` — chat orchestration and partial-response persistence.
- `server/services/provider.js` — OpenAI streaming adapter.
- `server/repositories/mongo.js` — persistent database adapter and atomic generation lease.
- `tests/helpers/memory.js` — test-only storage double; never used by the running application.
- `tests/` — domain, provider, protocol, HTTP, and database tests.
- `docs/ARCHITECTURE.md` — data model, endpoints, and design choices.
- `docs/VIVA_GUIDE.md` — implementation walkthrough and suggested demonstration.
- `docs/TESTING.md` — validation results and limits.

## Deployment notes

This is a full-stack application. **GitHub Pages alone cannot run its Node.js backend or MongoDB integration.** A public GitHub repository is sufficient for code submission; a hosted application needs a Node-capable host and MongoDB.

For an HTTPS deployment, set `NODE_ENV=production`, the real credentials, and `APP_ORIGIN` to your public origin (no trailing slash). Set `TRUST_PROXY=true` only behind a trusted single-hop proxy. Keep streaming responses unbuffered; the server sets `X-Accel-Buffering: no` and emits heartbeats. Production cookies require HTTPS.

This assessment project isolates conversations by an unguessable HttpOnly browser cookie, not by user accounts. Clearing cookies or changing browser profiles loses access to that history. For a public production product, add authentication, account quotas, a shared rate limiter, data retention controls, and stronger abuse protection. The current rate limiter is per process, and search returns the newest 100 matching threads. Context is limited to the latest 10 complete turns and 24,000 characters, plus the new prompt. There is no web browsing, file upload, or tool execution.

## Troubleshooting

- **MongoDB connection failed:** start MongoDB or check your Atlas URI, database credentials, and network allowlist.
- **Provider rejected the key:** check the server's `OPENAI_API_KEY` and restart it.
- **Provider rate/quota limit:** check your API billing/quota or wait before retrying.
- **Offline in the header:** run the Node server and open its URL. Do not double-click `index.html`.
- **Session does not persist locally:** use `NODE_ENV=development` for HTTP localhost. Secure production cookies require HTTPS.
- **A stopped reply is marked interrupted:** expected; partial text is retained, and incomplete answers are excluded from future AI context.

## API references used

- [OpenAI streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses)
- [Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)

Review the code and the viva guide before submitting so that you can explain the design and its limits.
