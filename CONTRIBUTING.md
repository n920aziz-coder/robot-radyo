# Contributing

Thanks for helping! Issues and pull requests are welcome in English or Turkish.

## Fixing or adding a translation

All panel texts are in [`robot/web/i18n.js`](robot/web/i18n.js), one block per language. English (`en`) is the reference: a missing key falls back to English.

- Keep every key that `en` has, and keep placeholders such as `{n}` exactly as they are.
- The panel is about 360 px wide on a phone, so short wording works best.
- Check the file with `node --check robot/web/i18n.js`. The CI check also verifies that every language has every key.
- To see your change, copy the file to the robot (`<install dir>/web/i18n.js`) and reload the page. The language can be switched at the bottom of the panel.

Only English and Turkish have been checked by native speakers so far, so corrections from native speakers of the other languages are especially welcome.

## Code

- The add-on has no build step and no npm dependencies. Keep it that way if you can; everything has to run on a small ARM robot.
- `robot/web/server.mjs` runs on the robot with a static Node.js 22 build. `robot/web/panel.js` runs in the browser inside the Valetudo page (in a Shadow DOM).
- Code comments are mostly in Turkish; English comments are fine too.
- Please test on a real robot if you can, and mention the robot model, firmware version and Valetudo version in your pull request.
- Run the checks from `.github/workflows/check.yml` locally: `node --check` on the JavaScript files and `bash -n` on the scripts.

## Porting to another robot

See "Porting to other robots" in the [README](README.md). Open an issue first if you want to discuss the approach.
