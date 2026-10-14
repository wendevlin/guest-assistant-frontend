# Guest Assistant frontend

The browser app served by [guest-assistant](../../guest-assistant), the
guest-facing proxy in front of Home Assistant. Guests sign in with the
proxy's own username/password login and get exactly one Lovelace dashboard.
The proxy decides which entities and commands are allowed; this app only
provides the UI and reuses the regular Home Assistant components
(`ha-panel-lovelace`, cards, more-info dialogs, themes, translations).

Like `landing-page/`, `cast/` and `demo/` it is a separate entrypoint with
its own build inside this repository.

## What it does

1. `GET /api/auth/get-session`: if a session exists, skip the login.
2. Login form → `POST /api/auth/sign-in/username`.
3. `GET /api/auth/hass-token` → short-lived token plus the dashboard's
   `url_path`. A `403` means the proxy rejected the dashboard (for example
   because it contains custom cards); the reasons are shown to the guest.
4. Opens the HA WebSocket (`/api/websocket` on the proxy) with that token via
   `home-assistant-js-websocket` and a custom `Auth` implementation that
   refreshes the token through the session.
5. Renders `ha-panel-lovelace` for the assigned dashboard in kiosk mode with a
   "Log out" toolbar action.

There is no dependency on a better-auth client library; the three auth calls
are plain `fetch` requests.

## Develop

```sh
guest-assistant/script/develop
```

This builds into `guest-assistant/dist` and rebuilds on changes. Start the
proxy with the environment variable `GUEST_ASSISTANT_FRONTEND_REPO` set to the
root of this repository (for example in the proxy's `.env`, see its
`.env.example`); the proxy then serves `guest-assistant/dist` from here. Open
the proxy URL, for example http://localhost:3123.

## Build

```sh
guest-assistant/script/build_guest_assistant
```

The production build lands in `guest-assistant/dist`. The proxy serves it via
`GUEST_ASSISTANT_FRONTEND_REPO` as above; without that variable it serves its
own `./public` directory instead, so copying the contents of
`guest-assistant/dist` there works too.

## Installable app and updates

The guest page is a progressive web app that guests can add to their home
screen. The proxy sets the name under the icon (admin page → App name) in
`/manifest.json` and the page title; everything else comes from this build:

- `public/manifest.json`: copied to the root of the build. The shared header
  already links `/manifest.json`.
- `public/static/icons/`: the Guest Assistant icon (`guest-icon.svg`, the
  admin page's `admin-ui/public/icon.svg` of the proxy) and PNGs rendered from
  it. `favicon.ico` replaces Home Assistant's in the build, because
  `public/static` is copied over the app's static files.
- `src/sw.js`: the service worker, copied to `/sw.js` as it is (plain ES2017,
  no build step). It only stores the page for when the proxy is out of reach
  and asks the network first otherwise; bundles are left to the HTTP cache.
- `src/data/guest-update.ts`: keeps the page on the build the proxy serves.
  Every production build gets an id (`GUEST_ASSISTANT_BUILD`, the release tag
  in CI, `local-<commit>-<time>` otherwise), compiled into the bundle and
  written to `build.json`. The app compares both when it starts, comes back to
  the foreground and after every reconnect, and reloads with `reloadFresh()`
  when they differ. The settings dialog shows the id.
- `src/html/index.html.template`: icons and iOS meta tags, plus the boot guard
  (`src/html/_bootstrap_recovery.html.template`) with a launch screen for it,
  which reloads once when the page's entry bundles are gone.

To switch the service worker off, stop registering it
(`registerGuestServiceWorker()`) and leave `sw.js` out of the build: browsers
keep an installed worker whose script is gone, so the proxy then serves one
that removes itself and its cache. The caching rules for the build's files
are in the proxy (`src/csp.ts` there).

To render the PNGs again after the icon changed, open the SVG in a browser
at the target size: `guest-icon-{192,512}.png` transparent and
`guest-maskable-{192,512}.png` on white with the house at 60 % of the size
(launchers cut the icon to a circle of 80 %), `guest-apple-touch-icon.png`
(180 px) on white at 78 %, and `favicon.ico` from 16, 32 and 48 px renders
(`convert favicon-16.png favicon-32.png favicon-48.png favicon.ico`).

## Translations

Strings live under the top-level `guest-assistant` key in
`src/translations/en.json`. The build produces one translation file per
locale containing the base strings, the `lovelace` panel strings and the
`guest-assistant` strings (fragment `guest-assistant` in
`build-scripts/gulp/translations.js`).
