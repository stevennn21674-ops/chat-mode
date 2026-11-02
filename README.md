# Chat Mode

Chat Mode is a Windows desktop overlay that looks like a livestream chat. It sits above your other windows, on the right side of the main display. Viewers react to the screen when you press the backtick key, and to what you say while holding V.

The chat is synthetic. It is not connected to a real stream.

## Controls

| Action | Result |
| --- | --- |
| Left click the chat | Slower, one step at a time |
| Right click the chat | Faster, one step at a time |
| Hold the right button and drag | Move the chat |
| Drag the corner | Resize |
| Backtick key | Capture the screen and send it. Works while another app is focused. Shift, Ctrl, Alt, and the Windows key are ignored |
| Hold V | Talk. Works while another app is focused |
| Ctrl+Shift+F8 | Pause or resume screen capture immediately |

Ctrl, Alt, and the Windows key together with V do not open the mic, so paste shortcuts stay quiet. A plain V does, including while you are typing.

Clicks outside the chat panel go to whatever is underneath. The panel itself captures the mouse only while the pointer is over it.

A small speed meter appears when you change speed. Pressing the backtick key blinks the tray icon and sets the tray tooltip to **reading the screen**. That indicator stays on the tray, not in the chat. **Mic live** shows while V is held.

Position, size, speed, opacity, font size, device choice, and the other toggles are saved and restored the next time the app starts.

The header shows an eye icon and a viewer count. It starts at a plausible number and drifts up and down. The count rises while you talk, while you are active, and when a backtick capture shows a big change. It falls when the screen stays still, you are quiet for a while, or the chat gets repetitive.

Simulated viewers each have an engagement level. A static screen, a long silence, or repetitive lines make them bored: chat slows down, some of them say things like `lol bored`, `gn`, or `brb`, and the count drops as they go. Talking, a backtick read, or a big screen change brings viewers back under new random usernames.

Some viewers are moderators and show a green sword. Hold V and say `ban <name>`, `timeout <name>`, `mods ban him`, `ban the last guy`, `ban the spammer`, or `ban everyone` / `ban all the bots`. A mod answers in chat, that person's messages are removed, a `<name> has been banned` line appears, the viewer count drops, and that viewer does not speak again. Names can be partial (`pixel` for `xX_PixelFox99`), missing a letter, or a whisper misspelling. This works with AI mode on or off and does not call the comment service. Settings has **Show debug transcript**, which prints the last heard line on the overlay. The same line and the parsed command are appended to `voice-debug.log` in the app data folder.

## Tray and settings

The tray icon can show or hide the chat, turn screen reactions, voice, AI mode, and offline mode on or off, switch game mode, pause capture, reset the chat to the right side of the screen, and open settings. Hover the icon to see whether a capture is in flight. The tooltip adds **offline** when offline mode is on or the PC has no internet.

Settings also covers the comment service, eco mode, **Hear computer audio**, the microphone, launch at startup, opacity, font size, and an optional relay. See [docs/SECURITY.md](docs/SECURITY.md).

**Hear computer audio** is on by default. On Windows the app captures system audio with a desktop loopback, keeps about the last 18 seconds, and transcribes it on this PC with the same whisper.cpp pipeline as the microphone. Silence is skipped. A pass runs about every 20 seconds, and again when you press backtick or finish talking, so chat can follow a game or a video. Whisper cannot tell speakers apart; the text is just what the PC played. The app keeps about 20 minutes of that, plus mic lines and window titles, and notes repeated names, places, and whether the moment sounds scared, like a fight, a win, or exploring. Turn it off in Settings if you do not want that sound included.

**Offline mode** is off by default. When it is on, the app does not call the comment service or look anything up on the web. If the computer is simply offline, chat behaves the same way until a connection check succeeds, and the saved checkbox is left alone. The tray tooltip is the only offline indicator.

With AI mode off and a connection available, a few names or game titles can be looked up on the public Wikipedia summary API. Results are cached on disk, limited to a few lookups a minute, and dropped if they are not kid-friendly. Failures are ignored. Slang stays the built-in list.

## Comment service and eco mode

**AI mode** is a checkbox in Settings and a tray item. On uses the comment service below, with the key and model you set and the same eco limits as before. The request also includes a short note of recent sounds, names, and what seems to be happening. That does not add another call. Off does not send any chat request: messages are built on this PC. The local chat tracks words from the mic, computer audio, and window titles, and it answers questions, greetings, scares, wins, and losses in different voices (hype, lurker, light troll, mod, backseat, questioner). Lines can quote you, misspell, stretch letters, or stack letters. Echoed words go through the kid-friendly filter. A backtick capture is not sent to a vision model while AI mode is off. Local chat only sees cheap signals: how much the picture changed, the main colors, and the window title when the system provides one.

**Custom viewers** are edited in Settings, saved in the app data folder, and can be imported or exported as JSON. Each one has a role, color, a short personality, sliders, catchphrases, and topics. There is a hater preset and a list of extra random usernames. AI mode puts the active personalities in the prompt. With AI mode off, those sliders and phrases shape the lines. A custom moderator can be the one who answers a voice ban. Haters only tease lightly.

**Game mode** is in Settings and the tray. Normal mode re-asserts the overlay every couple of seconds. Game mode does it every second at the topmost level so borderless fullscreen games, including Roblox and Escape the Backrooms, are more likely to stay underneath. A real exclusive-fullscreen DirectX game can still hide every overlay. Set the game to fullscreen windowed or borderless. In Roblox that is Shift+F11, or Esc then Settings, fullscreen. Roblox on Windows is usually borderless already. Backtick capture uses the primary display and, if that image is black, falls back to a window image.

AI mode defaults to off when no API key is set, and on when a key is available. A choice you save is kept.

Open Settings and enter:

- **Base URL**, default `https://apihub.agnes-ai.com/v1`
- **Model**, default `agnes-3.0-flash` (you can change it)
- **API key**, stored encrypted on this PC with Electron `safeStorage` (Windows DPAPI). It is shown as a password, with Show/Hide, and it is never written to the settings file in plain text or printed in logs.

**Test connection** sends a tiny request and reports success or a generic failure. It does not show the key.

Eco mode is on by default:

- The screen is not polled on a timer. It is captured and sent only when you press the backtick key.
- A cheap comparison of the downscaled frame skips the request when the screen barely changed. Local chat keeps idling.
- The frame is about 512 pixels on the long side, JPEG quality 60.
- Each call asks for a short batch and a low token limit. In eco mode that batch is spaced out, and spaced further when you have not used the computer for about 90 seconds or you are on battery.
- A calls-per-hour cap defaults to 20 and is shown as **Calls this hour**.
- Holding V only asks the service after you release the key and the transcript is not empty. Letting go of V does not capture the screen.
- Computer audio is included in those same requests. It never starts one by itself.

If you leave the key blank, the app uses a key sealed at build time when one was provided. A build with no key still runs and stays on local chat until you enter one.

## Local development

Node.js 22 or newer.

```bash
npm install
npm run dev
```

You can type the key in Settings. Optionally copy `.env.example` to `.env` and set `AGNES_API_KEY` before `npm run dev` or `npm run build` if you want that key sealed into the app as a fallback. `.env` is gitignored and is not required.

`npm test` covers the message parser, the slang prompt, the safety filter, speed steps, settings files, computer-audio silence, viewer count and boredom, mod commands, the offline generator, local understanding, custom viewers, and a mocked comment service. `npm run typecheck` checks the TypeScript.

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

- Always-on-top behavior over fullscreen games. Game mode re-asserts the topmost window every second, which is aimed at borderless fullscreen. Exclusive fullscreen can still cover any overlay.
- Hold-V bans, the debug transcript line, custom viewers, Wikipedia lookups, and the offline tray tooltip on a real Windows desktop.
- Screen capture while a game is exclusive fullscreen. A black screen image falls back to a window thumbnail. That fallback was not exercised on Windows here.
- The global V hook (`uiohook-napi`), the backtick capture key, and the pause hotkey while a game is focused.
- Microphone capture, device selection, and on-device transcription.
- System-audio loopback (`getDisplayMedia` with `audio: 'loopback'`). It is a Windows feature. Silent audio is ignored before transcription.
- Whether Windows screen capture omits the overlay. The window is marked to be excluded. On the Linux desktop used during development, capture itself worked, and the overlay was still visible in the image.
- Click-through, right-drag moving, and the installer or portable exe themselves.
- Launch at startup. The setting is stored, and it is applied only in a packaged build.
- The viewer-count header, green sword badge, and AI mode checkbox layout on a real Windows desktop.
- The foreground window title used by offline chat. It depends on the Windows window list and can be missing.

Other limits:

- The speech model is tiny English. Short, noisy, or accented clips can come back empty or wrong. A few known silence hallucinations are discarded.
- Some anti-cheat tools block global keyboard hooks and screen capture.
- Viewer lines can misread the screen. The prompt tells the model not to invent details, and a local filter drops slurs, sexual content, self-harm, and a few doxx-like patterns. That filter is a net, not a guarantee.
- If the comment service is rate-limited or down, the chat switches to a local pool of generic lines and backs off. It should not go silent.
- Holding V while you type the letter V in another program will open the mic for that keypress.
