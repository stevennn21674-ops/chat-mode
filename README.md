# Chat Mode

Chat Mode is a Windows desktop overlay that looks like a livestream chat. It sits above your other windows, on the right side of the main display, and viewers react to what is on screen and to what you say while holding V.

The chat is synthetic. It is not connected to a real stream.

## Controls

| Action | Result |
| --- | --- |
| Left click the chat | Slower, one step at a time |
| Right click the chat | Faster, one step at a time |
| Hold the right button and drag | Move the chat |
| Drag the corner | Resize |
| Hold V | Talk. Works while another app is focused |
| Ctrl+Shift+F8 | Pause or resume screen capture immediately |

Ctrl, Alt, and the Windows key together with V do not open the mic, so paste shortcuts stay quiet. A plain V does, including while you are typing.

Clicks outside the chat panel go to whatever is underneath. The panel itself captures the mouse only while the pointer is over it.

A small speed meter appears when you change speed. **Screen is being analyzed** shows while a capture is in flight. **Mic live** shows while V is held.

Position, size, speed, opacity, font size, device choice, and the other toggles are saved and restored the next time the app starts.

## Tray and settings

The tray icon can show or hide the chat, turn screen reactions and voice on or off, pause capture, reset the chat to the right side of the screen, and open settings.

Settings also covers the comment service, eco mode, the microphone, launch at startup, opacity, font size, and an optional relay. See [docs/SECURITY.md](docs/SECURITY.md).

## Comment service and eco mode

Open Settings and enter:

- **Base URL**, default `https://apihub.agnes-ai.com/v1`
- **Model**, default `agnes-3.0-flash` (you can change it)
- **API key**, stored encrypted on this PC with Electron `safeStorage` (Windows DPAPI). It is shown as a password, with Show/Hide, and it is never written to the settings file in plain text or printed in logs.

**Test connection** sends a tiny request and reports success or a generic failure. It does not show the key.

Eco mode is on by default:

- Screen reads default to every 25 seconds. The slider runs from 15 to 120 seconds. Eco mode will not go faster than 20 seconds.
- A cheap comparison of the downscaled frame skips the request when the screen barely changed. Local chat keeps idling.
- Screenshots are about 512 pixels on the long side, JPEG quality 60.
- Each call asks for a short batch and a low token limit. In eco mode that batch is spread out until the next read.
- A calls-per-hour cap defaults to 20 and is shown as **Calls this hour**.
- Eco mode waits longer when you have not used the computer for about 90 seconds, and longer again on battery.
- Holding V only asks the service after you release the key and the transcript is not empty.

If you leave the key blank, the app uses a key sealed at build time when one was provided. A build with no key still runs and stays on local chat until you enter one.

## Local development

Node.js 22 or newer.

```bash
npm install
npm run dev
```

You can type the key in Settings. Optionally copy `.env.example` to `.env` and set `AGNES_API_KEY` before `npm run dev` or `npm run build` if you want that key sealed into the app as a fallback. `.env` is gitignored and is not required.

`npm test` covers the message parser, the slang prompt, the safety filter, speed steps, settings files, and a mocked comment service. `npm run typecheck` checks the TypeScript.

Voice transcription needs the local speech binary and the tiny English model:

```bash
npm run fetch-whisper
```

On Windows that downloads the speech executable and model into `resources/whisper`. Until those files exist, holding V still shows the mic indicator, but nothing is transcribed.

`CHATMODE_DEMO=1 npm run dev` feeds canned viewer lines through the same parser and scheduler so you can preview the overlay without a key. It does not upload the screen. Add `CHATMODE_SETTINGS=1` to open the settings window on launch.

## Windows build

The GitHub Actions workflow [Build Windows](.github/workflows/build-windows.yml) runs on `windows-latest` with Node 22.23.4. It caches npm and the speech-model download, runs the tests, and builds without a repository secret. It uploads:

- an NSIS installer (`.exe`)
- a portable `.exe`, also zipped

Pushing a `v*` tag also attaches those files to a GitHub Release. The workflow does not sign the executables.

What you need to do:

1. Create a GitHub repository for this project and push the code.
2. Run **Build Windows** from the Actions tab, or push a tag such as `v1.0.0`.
3. Download the installer and the portable zip from the workflow artifacts, or from the Release when you used a tag.
4. Install or run the portable exe, then enter the key and model in Settings.

`AGNES_API_KEY` is an optional Actions secret. If you set it, that key is sealed into the build as a fallback for people who have not entered their own. The build succeeds when the secret is missing. Read [docs/SECURITY.md](docs/SECURITY.md) before you ship any fallback key.

## Known limitations

These were not verified on a real Windows desktop in this environment. The code is in place, and the logic around it is unit-tested, but you should confirm them on Windows:

- Always-on-top behavior over fullscreen games and exclusive-fullscreen modes. Borderless windowed mode is the realistic case. Exclusive fullscreen often covers every overlay.
- The global V hook (`uiohook-napi`) and the pause hotkey while a game is focused.
- Microphone capture, device selection, and on-device transcription.
- Whether Windows screen capture omits the overlay. The window is marked to be excluded. On the Linux desktop used during development, capture itself worked, and the overlay was still visible in the image.
- Click-through, right-drag moving, and the installer or portable exe themselves.
- Launch at startup. The setting is stored, and it is applied only in a packaged build.

Other limits:

- The speech model is tiny English. Short, noisy, or accented clips can come back empty or wrong. A few known silence hallucinations are discarded.
- Some anti-cheat tools block global keyboard hooks and screen capture.
- Viewer lines can misread the screen. The prompt tells the model not to invent details, and a local filter drops slurs, sexual content, self-harm, and a few doxx-like patterns. That filter is a net, not a guarantee.
- If the comment service is rate-limited or down, the chat switches to a local pool of generic lines and backs off. It should not go silent.
- Holding V while you type the letter V in another program will open the mic for that keypress.
