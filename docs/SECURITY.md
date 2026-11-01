# Security notes

Chat Mode can call a remote comment service. The normal way to give it a credential is to type the key in Settings on your own PC. This document explains how that key is stored, what an optional build-time fallback means, and how to keep the real credential on a server you control.

## The key you type is encrypted on your PC

Settings stores the API key with Electron `safeStorage`. On Windows that uses DPAPI, so the blob in `%APPDATA%\Chat Mode\credentials.bin` is encrypted for your Windows user. It is not written into `settings.json`, the app logs, or the chat window. The field is masked, with Show/Hide only in that settings window. **Test connection** does not print the key.

DPAPI protects the file from other Windows users and from casual copying to another PC. It does not protect against malware that is already running as you, or against someone who can debug this app while you are logged in. Clear the field to delete the encrypted blob.

If Windows encryption is unavailable, the app refuses to save the key rather than writing it in plain text.

The model name and base URL are not secrets. They default to `agnes-3.0-flash` and `https://apihub.agnes-ai.com/v1` and stay in the settings file so you can change them.

## A key sealed into the build is only a fallback

The Windows build may read an optional `AGNES_API_KEY` environment variable and store it **sealed** (AES-256-GCM, with the wrapping key split and masked). That happens only when the variable is set. The workflow succeeds with no secret, and the app then waits for a key in Settings.

If a sealed key is present and you have not entered your own, the app uses the sealed one. A determined person can still extract a key that ships inside the app: debug the main process, dump memory, or reverse the bundle. Do not ship a credential you cannot rotate. Prefer leaving the secret unset and letting each person enter their own key, or use a relay.

Local `npm run build` reads the same optional variable from a gitignored `.env`. That file is not packaged.

## Prefer a relay

Settings has an optional **Relay URL** and **Relay token**. When a valid `http` or `https` relay URL is set, the app sends comment requests there and does **not** send your saved key or the sealed fallback. The relay adds the real credential and forwards the request.

The relay token is stored in the local settings file so the app can authenticate to *your* relay. It is not the upstream credential. Leave the relay fields blank to use the built-in connection.

### Small Node relay

From the `proxy` directory, with Node 22:

```bash
AGNES_API_KEY=your-real-key PORT=8787 PROXY_TOKEN=choose-a-long-token RATE_LIMIT=30 node server.mjs
```

Optional environment:

| Variable | Purpose |
| --- | --- |
| `AGNES_API_KEY` | Upstream credential. Required. Never commit it. |
| `UPSTREAM_URL` | Defaults to `https://apihub.agnes-ai.com/v1/chat/completions`. |
| `PROXY_TOKEN` | If set, clients must send `Authorization: Bearer <token>`. |
| `RATE_LIMIT` | Requests per IP per minute. Default 30. |
| `MODEL` | If set, replaces the model on each request. |
| `PORT` | Default 8787. |

Point Chat Mode's relay URL at `http://127.0.0.1:8787` (or your public origin) and set the relay token to the same `PROXY_TOKEN`. The server accepts `POST /v1/chat/completions` and `GET /health`.

Put this behind HTTPS in production. The in-memory limiter resets when the process restarts and is not shared across machines.

### Cloudflare Worker

`proxy/worker.js` is a single-file worker. `proxy/wrangler.toml.example` shows the config.

```bash
cp proxy/wrangler.toml.example proxy/wrangler.toml
npx wrangler secret put AGNES_API_KEY
npx wrangler deploy
```

Set `UPSTREAM_URL` to `https://apihub.agnes-ai.com/v1/chat/completions`. The worker's rate limit is per isolate, so treat it as a best-effort cap. Use Cloudflare's own rate-limiting rules if you need a hard limit. The same optional `PROXY_TOKEN` and `MODEL` variables apply.

## What the app sends

Screen reactions upload a downscaled JPEG of the primary display when you press the backtick key, plus the last few local transcripts and recent chat lines. The screen is not uploaded on a timer. Audio is transcribed on the PC and is not uploaded as audio. Text of what you said is included when voice reactions are on. If **Hear computer audio** is on, a local transcript of recent system audio can be included in that same request as text. Pause capture with Ctrl+Shift+F8 before anything you do not want in that request. The overlay window is marked so normal Windows screen capture should omit it. That exclusion is not reliable on every system; a capture taken during development on Linux still included the overlay. Pause capture before anything you do not want sent.
