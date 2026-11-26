# Robot Radyo 📻🤖

**Internet radio for Valetudo robot vacuums — played through the robot's own speaker, controlled from a slide-out panel inside the Valetudo web interface.**

[Türkçe](README.tr.md)

> ⚠️ **Unofficial.** This project is not affiliated with or supported by [Valetudo](https://valetudo.cloud). Please don't ask the Valetudo maintainers for help with it. It changes your robot's audio configuration; use at your own risk.

## What it does

- **Radio panel inside Valetudo.** Open your Valetudo page on port `8080` and pull the handle on the right edge (like a Samsung Edge panel). Volume up / down / mute buttons sit right on the handle.
- **Any station in the world.** Stations come from the open [radio-browser.info](https://www.radio-browser.info) directory (50,000+ stations, 220+ countries). Search by country, genre or name, preview, and star your favourites. You can also add your own stream URL.
- **Ready-made list on first run.** Pick your country and the panel builds a starter list from the directory's most-listened stations: a "Popular" group, genre groups (Pop, Rock, Oldies, Chill, Folk & Local, Jazz & Classical, News & Sports, Religious) and a few well-known international jazz, classical and chill stations. Countries with only a handful of stations are topped up with stations in the same language. Every station is test-played in the background (silently, at the lowest priority) and broken ones are replaced from the same group. You can change the list any time.
- **15 languages.** English, Türkçe, Deutsch, Français, Español, Italiano, Português, Nederlands, Polski, Русский, Українська, العربية, 中文, 日本語, 한국어. The panel follows the browser language and can be switched in the panel. Turkish and English are the project's original languages; the other 13 translations were written specifically for this interface (not with an automatic translation service), but no native speaker has reviewed them yet. Corrections are very welcome: all texts are in `robot/web/i18n.js`.
- **Works with the robot's own voice.** The robot and the radio share the sound card. When the robot speaks, the radio ducks (about −30 dB) and fades back afterwards.
- **Follows cleaning.** Optionally starts the radio when a cleaning job starts. Stops it when the robot is back on its dock, and when the robot reports an error (e.g. a stuck brush) after the robot has said its warning.
- **Self-healing station list.** Favourites are stored by their radio-browser ID. If a station changes its stream address, the new one is looked up automatically.
- **No cloud, no phone app, no PC needed** after installation. Everything runs on the robot.

## Compatibility

| Robot | Status |
|---|---|
| Roborock S5 (gen2) with Valetudo 2026.x | ✅ tested |
| Xiaomi Mi Robot Vacuum (gen1) with Valetudo | 🟡 same platform, untested |
| Other robots | ❌ not yet; see "Porting" |

The installer checks the robot first and refuses to install on anything else. It needs root SSH access, which you already have if you installed Valetudo.

## Install

On a computer that can SSH into the robot (Linux, macOS, WSL, or Git Bash on Windows):

```bash
git clone https://github.com/n920aziz-coder/robot-radyo.git
cd robot-radyo
bash install.sh --dry-run -i ~/.ssh/your_robot_key 192.168.1.50   # optional: check only, changes nothing
bash install.sh --reboot  -i ~/.ssh/your_robot_key 192.168.1.50
```

Then open `http://<robot-ip>:8080` and log in with your **Valetudo** user name and password. Pull the handle on the right edge, pick your country and press **Prepare my list**.

The installer:

1. Downloads static builds of [Node.js](https://github.com/yao-pkg/pkg-fetch) and [ffmpeg](https://johnvansickle.com/ffmpeg/), `aplay`/`amixer` from the Ubuntu 14.04 archive, and a current CA bundle from [curl.se](https://curl.se/docs/caextract.html). Each download is checked against a pinned or published checksum.
2. Copies them and the app to `/mnt/data/robot-radyo`, which survives firmware updates.
3. Installs `/etc/asound.conf` (sound-card sharing) and `/etc/init/S12robotradyo` (start at boot).

**Reboot the robot once** (`--reboot`) so its own sound program picks up the shared sound card. Until then, the robot's voice is silent while the radio plays.

Options: `--dir`, `--port` (default 8080), `-i KEY`, `--dry-run`, `--reboot`. Download sources can be overridden with environment variables (`NODE_URL`, `FFMPEG_URL`, `ALSA_DEB_URL`, …), see the top of `install.sh`.

Uninstall: `bash uninstall.sh -i KEY <robot-ip>`

## How it works

```
browser ──► :8080 Robot Radyo (Node.js) ──► :80 Valetudo        (Valetudo is proxied unchanged; the panel script is added to the page)
                 │
                 ├─ ffmpeg (stream → PCM) ─► aplay ─► "Radyo Ses" ─► "Radyo" ─► dmix ─► speaker
                 │                                     volume        ducking     ▲
                 │                                                               │
                 └─ watches the robot's voice process ──────────────── robot voice ┘
```

- **Sound card sharing:** the robot's sound library opens the ALSA device `default`; `/etc/asound.conf` turns `default` into a `dmix` mixer, so the robot's voice and the radio can play at the same time.
- **Volume and ducking** are two `softvol` controls right in front of the mixer, so changes are heard within ~0.2 s. The controls are created by a short warm-up playback at start-up, because a softvol control cannot be changed by others while its creator is running.
- **Robot speaking** is detected when the robot's voice process (`RoboController`) opens the sound card.
- **Cleaning started / docked / error** comes from Valetudo's own API, using the session of whoever opened the page on port 8080. The session is kept in memory only, never written to disk. After a robot reboot, the automations start working once the page has been opened on port 8080. Starting the cleaning from that page is enough.
- **Valetudo's "LAN only" rule** is enforced on port 8080 as well.

## Resource usage

Measured on a Roborock S5 (4-core ARM Cortex-A7, 512 MB RAM) while docked:

| | Radio off | Radio playing |
|---|---|---|
| CPU, share of the whole processor | about 0.3 % | about 2.4 % (about 10 % of one core) |
| RAM | 26–42 MB | 7 MB more (ffmpeg ≈ 5.5 MB, aplay ≈ 1 MB) |
| Storage in `/mnt/data` | 84 MB (Node.js 53 MB, ffmpeg 31 MB, the app itself < 0.2 MB) | same |

The robot always comes first:

- The robot's own programs run at the highest priority (nice −20). The radio runs at nice 10, so when the processor is busy, practically all of its time goes to the robot.
- If memory ever runs out, the kernel stops the radio first (`oom_score_adj` 1000), not the robot's programs or Valetudo.
- The radio stops itself if the robot's available memory drops below 40 MB, and the server restarts itself if its own memory grows unusually (above 100 MB).
- The audio goes straight from ffmpeg to aplay without passing through Node.js. The background station tests run at the lowest priority (nice 19).
- The log is kept in RAM (`/tmp`) and trimmed to 256 KB. Settings are written to flash only when you change them.
- The server keeps its own measurements, including the highest load seen during cleaning: open `http://<robot-ip>:8080/robot-radyo/api/durum` (logged in) and look at `kaynak`.

## Privacy and legal

- Searching, and starting a station, contacts radio-browser.info. When you start a station, it is reported as a "click", as the directory asks apps to do. No personal data is sent; the robot's public IP is visible to the directory and to the radio station, as with any radio app.
- The project only plays streams that stations publish openly for listening. It does not record, rebroadcast or bypass any protection. The repository contains no station list: the ready-made list is built on the robot from the directory's current listening figures, and users can change it freely.
- Respect each station's terms of use. Playing radio in a shop, café or other commercial venue usually needs a separate licence.

## Porting to other robots

The parts that are robot-specific are small:

- CPU builds (`NODE_URL`, `FFMPEG_URL`, alsa-utils for armv7)
- the boot mechanism (`/etc/init/rcS` → `S12robotradyo`)
- the sound card and process names in `robot/web/server.mjs` (`/dev/snd/pcmC0D0p`, `RoboController`)

Pull requests for other models are welcome.

## Credits

[radio-browser.info](https://www.radio-browser.info) · [Valetudo](https://valetudo.cloud) · [ffmpeg](https://ffmpeg.org) static builds by John Van Sickle · [yao-pkg/pkg-fetch](https://github.com/yao-pkg/pkg-fetch) static Node.js builds · ALSA / alsa-utils

## License

MIT, see [LICENSE](LICENSE). The downloaded third-party programs keep their own licences (ffmpeg and alsa-utils: GPL; Node.js: MIT). They are downloaded from their original sources and not redistributed by this repository.
