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

The wheel over the chat scrolls the lines. Auto-scroll follows the newest message until you scroll up; scrolling back to the bottom, or **Jump to latest**, turns it back on. **Auto-scroll chat** in Settings turns that behavior off. Clicks outside the chat panel go to whatever is underneath. The panel itself captures the mouse only while the pointer is over it. Left and right clicks still change speed, and a right-drag still moves the window. Game mode re-asserts the topmost window, and the app writes the click-through flag again after each re-assert so the chat still receives clicks.

The speed meter stays in the header. Settings has the same speed slider, **Lock position**, and the tray has **Slower** and **Faster**. A locked chat still changes speed on click, and it does not move. Pressing the backtick key blinks the tray icon. The tray tooltip does not say that the screen or the audio is being read. **Mic live** shows while the mic is recording, with a level meter. After you let go, the overlay shows **heard:** and the words for a few seconds when **Show what I said** is on (the default). If the mic or the speech model fails, the overlay says **Audio error** and nothing more. The reason, including Windows microphone privacy steps, is in Settings next to **Test mic** and in `voice-debug.log`. Settings has **Test mic** and **Mic diagnostics**. A short tail is kept after you release the talk key so the last word is not cut off. The speech model stays the tiny English one.

Position, size, speed, opacity, font size, device choice, and the other toggles are saved and restored the next time the app starts.

The header shows an eye icon and a viewer count. It starts at a plausible number and drifts up and down. The count rises while you talk, while you are active, and when a backtick capture shows a big change. It falls when the screen stays still, you are quiet for a while, or the chat gets repetitive.

Simulated viewers each have an engagement level. A static screen, a long silence, or repetitive lines make them bored: chat slows down, some of them say things like `lol bored`, `gn`, or `brb`, and the count drops as they go. Talking, a backtick read, or a big screen change brings viewers back under new random usernames.

Some viewers are moderators and show a green sword. Hold V and say `ban <name>`, `timeout <name>`, `mods ban him`, `ban the last guy`, `ban the spammer`, or `ban everyone` / `ban all the bots`. A mod answers in chat, that person's messages are removed, a `<name> has been banned` line appears, the viewer count drops, and that viewer does not speak again. Names can be partial (`pixel` for `xX_PixelFox99`), missing a letter, or a whisper misspelling. This works with AI mode on or off and does not call the comment service. **Show what I said** is on by default and prints `heard:` plus the line. The parsed ban command is also appended to `voice-debug.log`.

## Screen vision

**Look at screen when I talk** is on by default.

With AI mode on, releasing V captures one downscaled JPEG (about 512 pixels on the long side, quality 60) and sends it with the transcript in that single call. Backtick still sends its own capture. Offline mode and Local brain cannot truly read what is drawn on the screen. There is no vision-language model in this release: a small GGUF captioner needs a separate vision projector and a vision build of llama.cpp, and the weights are hundreds of megabytes, so it was not shipped.

What offline chat does use:

- The local activity sampler: motion, a still menu, darkness, a flash or cut, and the window title when Windows provides one.
- Dominant colors, brightness, a rough menu-versus-gameplay guess, and a warm-color hint. That hint is not face recognition.
- **Read on-screen text (OCR)**, on by default. The English LSTM data is about 1.9 MB and is downloaded into the app data folder the first time it is needed. It is not in the installer. OCR runs on a cropped, downscaled frame only when you release the talk key or press backtick, and never two reads at once. Recognized words (menus, subtitles, HUD labels, names, and numbers such as health or score) are given to the viewers, who can quote them. OCR misses a lot of game text. It is not a description of the scene. A failure is written to `voice-debug.log` and does not open an error dialog.

## Screen activity

The app samples a tiny thumbnail (32 by 18 in Low and Balanced, 48 by 27 in High). It does not upload that picture. It estimates motion, a hard cut or flash, darkness, a still menu, a loading-looking frame, a sudden red or fade that can be a game over, and a victory only when the window title says so. The window title is also checked for Roblox, Minecraft, Escape the Backrooms, Fortnite, and FNF. Chat lines follow that state (`WAIT WHAT WAS THAT`, `dark again lol`, `he's running!!`, `bro stopped moving`, `NOOO he died`) in AI-off templates, local brain context, and the next AI-mode request. They do not add a call by themselves, and they do not name objects that were not in the title, the audio, or a real vision request.

Sampling pauses while the computer is idle, while a known game is focused and the picture is unchanged, and while the CPU is high. It waits longer when the picture is not changing, and skips itself on battery when that box is on. Low mode waits 8 seconds or more between samples. **Auto vision** is off. Turn it on only if you want a real screenshot after a big change while AI mode is on. It stays under the hourly cap in Settings.

## Alerts

Fake donations, subs, bits, gifted subs, and raids can show a banner for a few seconds, play a short original tone (coin, chime, arcade, or horn), bump the viewer count, and draw a thank-you in chat. Messages are kid-friendly. Volume, how often, currency, and the amount range are in Settings. **Test donation** plays one immediately. **Read alerts with Windows speech** uses the system speech synthesizer. None of the sounds are taken from a game or a stream.

## Real chat

Twitch joins `wss://irc-ws.chat.twitch.tv` as `justinfan` plus digits. No login. Usernames, colors, and badges come from IRC tags. Cheers, subs, gifts, and raids use the same alert sounds. YouTube first tries the public live chat page and innertube `get_live_chat` polling from a video URL, id, or `@handle`. That unofficial endpoint can break. A YouTube Data API v3 key in Settings is optional, encrypted on this PC, and is the stable path for `liveChat/messages`. **Connect** and **Disconnect** show a status line. **Real only** stops the idle fake crowd and fake alerts while a chat is connected. **Real + fake** keeps both. Offline mode does not connect, and a drop retries with backoff. Real lines are filtered when **Hide bad words** is on (the default), and they are added to the local keyword memory and the AI context. There are no moderation hooks for real chat.

## Tray and settings

The tray icon can show or hide the chat, turn screen reactions, voice, AI mode, and offline mode on or off, switch game mode, pause capture, reset the chat to the right side of the screen, and open settings. The tooltip adds **offline** when offline mode is on or the PC has no internet. It does not describe screen or audio analysis.

Settings also covers the comment service, eco mode, **Local brain**, **Hear computer audio**, the microphone, launch at startup, opacity, font size, and an optional relay. See [docs/SECURITY.md](docs/SECURITY.md).

**Hear computer audio** is on by default, but **Performance mode** decides whether it is transcribed. Low (the default) leaves loopback transcription off. Balanced transcribes about every 45 seconds, High about every 30. Silence is skipped. A pass can also run when you press backtick or finish talking, in Balanced or High. Whisper cannot tell speakers apart; the text is just what the PC played. The app keeps about 20 minutes of that, plus mic lines and window titles, and notes repeated names, places, and whether the moment sounds scared, like a fight, a win, or exploring. Turn the checkbox off in Settings if you do not want that sound included.

**Offline mode** is off by default. When it is on, the app does not call the comment service or look anything up on the web. If the computer is simply offline, chat behaves the same way until a connection check succeeds, and the saved checkbox is left alone. The tray tooltip is the only offline indicator.

With AI mode off and a connection available, a few names or game titles can be looked up on the public Wikipedia summary API. Results are cached on disk, limited to a few lookups a minute, and dropped if they are not kid-friendly. Failures are ignored. Slang stays the built-in list.

## Comment service and eco mode

**AI mode** is a checkbox in Settings and a tray item. On uses the comment service below, with the key and model you set and the same eco limits as before. The request also includes a short note of recent sounds, names, and what seems to be happening. That does not add another call. Off does not send any chat request: messages are built on this PC. The local chat tracks words from the mic, computer audio, and window titles, and it answers questions, greetings, scares, wins, and losses in different voices (hype, lurker, light troll, mod, backseat, questioner). Lines can quote you, misspell, stretch letters, or stack letters. Echoed words go through the kid-friendly filter. A backtick capture is not sent to a vision model while AI mode is off. Local chat only sees cheap signals: how much the picture changed, the main colors, and the window title when the system provides one.

**Local brain** is a separate checkbox, on by default. With AI mode off and a downloaded model file present, viewer lines are written by a small on-device model instead of the built-in templates. It sees the mic transcript, on-screen text, colors and motion, the window title, custom viewer personalities, and whether the room is bored. It does not see the picture itself. Several viewers are written in one pass. It runs below normal priority, uses at most two CPU threads, and waits between ordinary passes. It is not left generating in a loop. **Brain speed** is light, normal, or heavy. If the CPU is already busy, the overlay is slow, or the model is missing or errors, chat falls back to the built-in lines. Ban commands still use the built-in parser. The kid-friendly filter still applies. The model is smaller and less accurate than the cloud model.

No language model is inside the installer. The first time Local brain is turned on, Settings asks before downloading. **Q4** is Qwen2.5-0.5B-Instruct Q4_K_M, about 469 MB (about 490 MB if you count decimal megabytes). **Q8** is the same model at Q8_0, about 644 MB. **Smarter brain** is an optional download of Qwen2.5-1.5B-Instruct Q4_K_M, about 1.04 GB. The download can resume, and **Delete model** removes the copies from this PC. **Disk used by Chat Mode** counts those files plus the on-screen text data. **Delete all downloaded data** removes the models, the text file, and the lookup cache. Your settings and API key stay. After a file is on disk, local brain does not use the network, including in offline mode. The Windows build ships a CPU build of llama.cpp beside the app, not inside the asar archive, and not a model file.

With AI mode off, local brain is the default when a model file is present. The prompt includes the mic, computer audio, window title, local screen activity, real chat if it is connected, viewer notes, recent lines, and a short example of stream chat. Lines that repeat recent chat, run too long, or fail the kid-friendly filter are dropped. If the model is missing, busy, or slow, the built-in lines answer from the same cues: questions, names, a running joke, and the screen activity. That rule layer is more on-topic than the old random templates, and it is still not as accurate as the cloud model.

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
- Holding V asks the service once, after you release the key, when the transcript is not empty and the hourly cap still has room. **Look at screen when I talk** (on by default) attaches one 512px JPEG from that moment to the same call. It does not make a second call. That call is counted, and auto vision leaves the last hourly slot free while the toggle is on. If the cap is already full, viewers still answer on this PC and the picture is not uploaded.
- Computer audio is included in those same requests. It never starts one by itself.

If you leave the key blank, the app uses a key sealed at build time when one was provided. A build with no key still runs and stays on local chat until you enter one.

## Local development

Node.js 22 or newer.

```bash
npm install
npm run dev
```

You can type the key in Settings. Optionally copy `.env.example` to `.env` and set `AGNES_API_KEY` before `npm run dev` or `npm run build` if you want that key sealed into the app as a fallback. `.env` is gitignored and is not required.

`npm test` covers the message parser, the slang prompt, the safety filter, speed steps, the click-to-speed and drag decisions, settings files, computer-audio silence, viewer count and boredom, mod commands, the offline generator, local understanding, an offline reply check, screen-activity classification, alert text and tones, Twitch and YouTube parsing, custom viewers, and a mocked comment service. `npm run typecheck` checks the TypeScript.

Voice transcription needs the local speech binary and the tiny English model:

```bash
npm run fetch-whisper
```

On Windows that downloads the speech executable and model into `resources/whisper`. Until those files exist, holding V still shows the mic indicator, but nothing is transcribed.

`CHATMODE_DEMO=1 npm run dev` feeds canned viewer lines through the same parser and scheduler so you can preview the overlay without a key. It does not upload the screen. Add `CHATMODE_SETTINGS=1` to open the settings window on launch.

## Windows build

The GitHub Actions workflow [Build Windows](.github/workflows/build-windows.yml) runs on `windows-latest` with Node 22.23.4. It caches npm, the speech-model download, and the llama.cpp runtime, runs the tests, and builds without a repository secret. The Qwen model is not downloaded and is not packed into the app. The speech model is tiny English, about 75 MB, plus the whisper binary. The llama.cpp runtime is about 25 MB. The OCR engine kept in the app is the LSTM SIMD build and the non-SIMD LSTM fallback. The worker's Node dependencies, including `node-fetch`, are unpacked next to `tesseract.js` so the worker thread can load them. The English OCR data stays out of the installer. The NSIS file is `ChatMode-0.7.1-x64.exe`. It uploads:

- an NSIS installer (`.exe`)
- a portable `.exe`, also zipped

Pushing a `v*` tag also attaches those files to a GitHub Release. The workflow does not sign the executables.

What you need to do:

1. Create a GitHub repository for this project and push the code.
2. Run **Build Windows** from the Actions tab, or push a tag such as `v1.0.0`.
3. Download the installer and the portable zip from the workflow artifacts, or from the Release when you used a tag.
4. Install or run the portable exe, then enter the key and model in Settings.

`AGNES_API_KEY` is an optional Actions secret. If you set it, that key is sealed into the build as a fallback for people who have not entered their own. The build succeeds when the secret is missing. Read [docs/SECURITY.md](docs/SECURITY.md) before you ship any fallback key.

## Performance

**Performance mode** is in Settings. **Low** is the default. It turns off computer-audio transcription and samples the screen on a slow timer. **Balanced** transcribes PC audio about every 45 seconds. **High** does that about every 30 seconds and samples a slightly larger thumbnail. Silence is skipped. OCR and whisper do not run on a timer: OCR runs when you release the talk key or press backtick, and only one OCR read runs at a time. Whisper and the local brain run below normal priority with at most two threads.

If CPU use over the last 10 seconds is above about 70%, or a short overlay frame-rate sample falls below 24 fps, background work drops back automatically. The chat keeps at most 150 lines, scrolls on a short timer, and the overlay is capped around 30 fps. **Hardware acceleration** stays on unless you turn it off. That switch applies the next launch.

## Microphone

The talk key defaults to **V**. **Hold to talk**, **Toggle to talk**, and **Always listening** are in Settings. The global hook ignores key repeat and still sees the key while a game is focused. If the hook cannot start, **Fallback hotkey** registers Alt plus your talk key. The hidden voice window keeps audio running (`backgroundThrottling` off, autoplay allowed). Capture uses auto gain and leaves echo cancellation and noise suppression off, because those Windows processing modes often mute a quiet mic. A level that stays near zero is reported as a silent mic. **Mic diagnostics** checks permission, device, level, the hook, and transcription. A denied microphone tells you to open Windows Settings, Privacy, Microphone, and allow desktop apps.

## Known limitations

These were not verified on a real Windows desktop in this environment. The code is in place, and the logic around it is unit-tested, but you should confirm them on Windows:

- Always-on-top behavior over fullscreen games. Game mode re-asserts the topmost window every second, which is aimed at borderless fullscreen. Exclusive fullscreen can still cover any overlay.
- Hold-V bans, the debug transcript line, custom viewers, Wikipedia lookups, and the offline tray tooltip on a real Windows desktop.
- Screen capture while a game is exclusive fullscreen. A black screen image falls back to a window thumbnail. That fallback was not exercised on Windows here.
- The global V hook (`uiohook-napi`), the backtick capture key, and the pause hotkey while a game is focused.
- Microphone capture, the level meter, device selection, the test-mic button, and on-device transcription. The hidden voice window resumes its audio context, and clips are sent as raw sample bytes because a typed array can arrive empty in the main process.
- On-screen text OCR, including the 1.9 MB language download and whether Windows screen capture includes the overlay.
- Whether a voice line plus one screenshot stays inside the hourly cap on a real desktop. Auto vision is supposed to leave the last slot for that call.
- System-audio loopback (`getDisplayMedia` with `audio: 'loopback'`). It is a Windows feature. Silent audio is ignored before transcription.
- Whether Windows screen capture omits the overlay. The window is marked to be excluded. On the Linux desktop used during development, capture itself worked, and the overlay was still visible in the image.
- Click-through, right-drag moving, and lock position over a real Windows desktop, including Game mode. The gesture decisions are unit-tested. The Windows topmost flag and `uiohook` mouse hook were not exercised here.
- Donation banners, synthesized tones, and Windows `speechSynthesis` read-aloud.
- Twitch anonymous IRC, YouTube innertube live chat, and the YouTube Data API path. The innertube endpoint is unofficial and can break.
- The local 64 by 36 screen watch, foreground window title, and auto vision cap on a real desktop.
- The optional 1.5B smarter-brain download, its CPU use, and how close its chat is to the cloud model. The included model is still Qwen2.5-0.5B. Offline lines are more on-topic than before and still miss jokes, names, and scene detail the cloud model gets from a real picture.
- The installer or portable exe themselves.
- Launch at startup. The setting is stored, and it is applied only in a packaged build.
- The viewer-count header, green sword badge, AI mode checkbox, and local brain settings on a real Windows desktop.
- The llama.cpp runtime after you download a model: loading Qwen2.5-0.5B-Instruct, low-priority CPU use, brain speed, the busy-CPU fallback, delete, and a resumed download. Those paths were not run on Windows here. No vision model is included.
- The foreground window title used by offline chat. It depends on the Windows window list and can be missing.

Other limits:

- The speech model is tiny English. Short, noisy, or accented clips can come back empty or wrong. A few known silence hallucinations are discarded.
- Some anti-cheat tools block global keyboard hooks and screen capture.
- Viewer lines can misread the screen. The prompt tells the model not to invent details, and a local filter drops slurs, sexual content, self-harm, and a few doxx-like patterns. That filter is a net, not a guarantee.
- If the comment service is rate-limited or down, the chat switches to a local pool of generic lines and backs off. It should not go silent.
- Holding V while you type the letter V in another program will open the mic for that keypress.
