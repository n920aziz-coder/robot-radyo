# Security

Robot Radyo runs as root on the robot and serves a web page on your home network (port 8080), next to Valetudo. Please report anything that could let someone control the robot or read data they shouldn't.

## Reporting a problem

Please **don't open a public issue** for security problems. Use GitHub's private reporting instead: **Security → Report a vulnerability** in this repository. You should get an answer within a few days.

## What the add-on does to keep things safe

- **LAN only.** Port 8080 only answers addresses from the local network (Valetudo's "LAN only" rule).
- **Valetudo login.** When Valetudo's login is on, everything except the two panel scripts needs it. The login your browser sends is kept in memory only, and only sent to Valetudo on the robot itself. The add-on never reads the password from anywhere.
- **Protection against other websites.** Requests that change something are only accepted as JSON from the page itself, so other websites can't send them through your browser.
- **ffmpeg.** It may only open http/https streams, so playlists can't make it open local files or other protocols.
- **Downloads.** The installer checks every download against a pinned or published checksum.

## Known limitations

- The add-on and ffmpeg run as root, as Valetudo does. Running ffmpeg as an unprivileged user doesn't work on this firmware.
- When Valetudo's login is off, anyone on your local network can control the radio, just as they can control the robot through Valetudo.
