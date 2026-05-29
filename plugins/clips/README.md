# Clips

Clips is a mobile-first Stash UI plugin that adds a `Clips` tab with a random
scene-marker preview feed. Each entry plays the generated `SceneMarker.stream`
video directly, so it uses Stash's existing marker preview generation instead of
transcoding full scenes in the page.

## Features

- Adds a `Clips` tab to the Stash navigation bar.
- Opens a dedicated `/plugin/clips` route.
- Plays random generated marker streams from `markerWall`.
- Optional Hybrid Recommendations mode for choosing the next marker from a
  recommended scene.
- Keeps an in-memory play history.
- Swipe up or scroll up for the next random marker.
- Swipe down or scroll down to return to the previous marker.
- Tap the video to pause or resume playback.
- Tap the audio button to unmute after playback starts.
- Optimized for phones with `playsInline`, muted autoplay, and a full-height
  touch surface.

## Install

1. Copy this folder into your Stash plugins directory.
   - Windows: `%USERPROFILE%\.stash\plugins\clips`
   - Linux/macOS: `~/.stash/plugins/clips`
2. In Stash, open `Settings > Plugins`.
3. Click `Reload Plugins`.
4. Enable `Clips` if it is not already enabled.

Marker previews must already be generated in Stash. If the feed reports that no
generated marker previews were returned, run Stash's marker preview generation
task first.

## Hybrid Recommendations

When Stash Hybrid Recommendations is installed, enabled, and indexed, Clips asks
its engine for scenes related to the currently playing marker's scene. It then
plays a random marker from one of those recommended scenes. If the recommendation
engine is unavailable, returns no scenes, or the recommended scenes do not have
playable marker streams, Clips falls back to the normal random marker feed.

Hybrid Recommendations mode is off by default. To enable it, open
`Settings > Plugins > Clips` and set `Recommendation source` to
`Hybrid Recommendations`. The dropdown option is disabled when the Hybrid
Recommendations engine plugin is not detected.

`Unmute on entering the tab` is also off by default. Enable it in
`Settings > Plugins > Clips` if you want Clips to start unmuted when opened.

## Files

- `clips.yml` is the Stash plugin manifest.
- `clips.js` registers the route, nav tab, GraphQL query, and feed behavior.
- `clips.css` contains the mobile-first feed layout.
