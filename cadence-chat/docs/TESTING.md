# Validation record

Validated on 12 October 2026 using Node.js 24.19.0.

Version 1.1 was rechecked after making OpenAI and MongoDB mandatory: all 17 automated tests passed, the updated UI sent and rendered a streamed test response, and startup correctly rejected missing credentials. No live OpenAI credentials were supplied.

| Check | Result |
| --- | --- |
| `npm run check` | All application and test JavaScript passed syntax checks |
| `npm test` | 17 tests passed, 0 failures |
| Real MongoDB integration | 1 test passed against MongoDB 8.0.15 |
| Desktop browser | Passed in Chromium at 1440 × 960 |
| Mobile browser | Passed in Chromium at 390 × 844; no horizontal overflow |

The automated tests cover server validation, all three system tone instructions, bounded context, safe public data shapes, Markdown export, credential configuration, fragmented/Unicode SSE, the OpenAI request contract with a mocked upstream, redacted provider errors, partial-response persistence, cancellation, concurrency, the HTTP chat lifecycle, session isolation, payload limits, and rate limiting.

The real MongoDB test covers persisted messages after closing/reopening the database client, owner isolation, escaped literal search, atomic generation leases, tone updates, and deletion. It uses a unique disposable test database; the same test runs in the included GitHub Actions workflow.

Browser checks exercised the real application with isolated test fixtures: incremental text, tone switching, creating and reopening history, search, transcript download, Stop, page reload, deletion confirmation, safe display of HTML-like input, mobile sidebar navigation, and starter prompts. No page JavaScript errors were observed. Desktop and mobile layouts were visually inspected.

## Not verified with live credentials

No real OpenAI API key was supplied, so a paid end-to-end OpenAI request was not made. The real adapter was tested against representative streamed API responses, including failures and truncated streams. You must add your own key and confirm model access and quota for a live run.

Docker deployment and the hosted GitHub Actions workflow were provided but were not run on an external hosting account. This validation is evidence of the listed checks, not a claim of exhaustive production security testing.

## Quick local acceptance check

1. Run `npm ci`, `npm run check`, and `npm test`.
2. Copy `.env.example` to `.env`, set your OpenAI key and MongoDB URI, and start MongoDB if using a local database.
3. Run `npm start` and open `http://localhost:3000`.
4. Send a prompt in each tone; try Stop, search, export, history, and mobile width.
5. Restart the server and confirm the saved conversation still opens.

The runtime is OpenAI + MongoDB only. Test doubles live exclusively in the test suite and cannot be selected through an environment variable or npm start command.
