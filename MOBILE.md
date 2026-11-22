# Mobile layout

At 900px and below, the map uses a touch-oriented shell:

- Maps, calendar, list and More remain in a compact header. Select, location and ping modes stay directly accessible.
- More contains the original undo/redo, labels, capture, import/export, theme, live and help controls. These are moved rather than cloned; returning to desktop restores their original positions and event handlers.
- The scene/cast list starts closed and opens as a bottom sheet (a side sheet in short, wide layouts). Character search moves into that sheet.
- Opening an editor clears competing mobile panels. Tapping the map outside an open panel dismisses the panel without placing a ping.
- Scene editors are bottom-aligned, scrollable and sized to the usable viewport. Opening a scene does not automatically focus its name field on touch devices.
- Buttons and row actions have larger, always-visible touch targets. Inputs use 16px text to avoid automatic input zoom on iOS.
- Map background supports one-finger panning and two-finger anchored zoom. Completed or cancelled gestures cannot become placement taps. Marker drags use a larger movement threshold on touch.
- Dynamic viewport height and safe-area padding account for browser chrome, keyboards and display cutouts. Rotating/resizing the map width refits the view.

Above 900px, the desktop layout is unchanged. Mobile-specific styles are isolated in media queries, and `mobile.js` restores the original toolbar DOM order when crossing back to desktop.

## Tests

Existing offline state/sync regression suite:

```sh
node tests/timeline-sync.test.js
```

The optional real-browser suite requires Playwright and Chromium. Start a static server in one terminal and run the test in another:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
# With Playwright and its Chromium browser installed:
node tests/mobile-browser.test.js
```

The browser test blocks external HTTPS traffic, so its test characters and scenes never reach the production board. It checks phone/tablet widths, landscape, short portrait viewports, drawers, live dialogs, roster creation, scene editing, actual multi-touch pinch/cancel events, and mobile/desktop transitions. Desktop element geometry is compared with the pre-mobile implementation at commit `5127d3e`.

Environment overrides: `MOBILE_TEST_URL`, `CHROMIUM_PATH`, and `CHROMIUM_ARGS` (a JSON array). Playwright may also be provided through `NODE_PATH` without adding production dependencies to this static site.

Chromium mobile emulation was tested; physical iPhone/Safari and Android device testing is still recommended, especially for soft-keyboard and safe-area behavior.
