# Changelog

## 1.0.1 (2026-11-26)

Fixes for four findings from an external review.

- **Installer.** If the sound test or the start check fails during an update, the previous version, its sound settings and its service are now restored. Before, the radio could stay disabled.
- **Ready-made list.**
  - While the internet or the station directory can't be reached, stations are no longer replaced or removed; the check is retried later.
  - A broken station without a replacement now stays in the list, marked ⚠, instead of being deleted.
- **Previews.** If a preview's stream address can't be found, the station that is playing keeps playing and an error is shown. Before, the old stream kept playing while the panel showed the radio as off.
- **Selected station.** If the selected station was replaced or removed, the automatic start (and Play) now uses the first working station instead of silently doing nothing.

## 1.0.0 (2026-11-26)

First public release.

- **Radio panel.** A panel inside the Valetudo page (port 8080) that slides out of the right edge. Volume up, volume down and mute sit on the handle.
- **Stations.** Search, preview, favourites and custom stream URLs, using the radio-browser.info directory. Favourites repair themselves when a stream address changes.
- **First-run list.** A ready-made station list for your country, with a "Popular" group and genre groups. It is topped up with same-language stations for small countries. Stations are tested silently in the background, and broken ones are replaced.
- **Robot voice.** The radio and the robot's voice share the sound card. The radio is turned down while the robot speaks.
- **Cleaning automations.** The radio can start with a cleaning, and stops at the dock or when the robot reports an error. Cleanings started by a Valetudo timer only start the radio if you allow it.
- **Languages.** 15 interface languages.
- **Resource safeguards.**
  - The radio runs at low priority, and the kernel stops it first if memory runs out.
  - The radio stops itself when the robot is low on memory.
  - Orphaned audio processes are cleaned up.
  - The log is size-limited.
- **Installer.** Pinned downloads, staged install with checks before anything is replaced, sound-path self-test, and an uninstaller.
