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

## Following Home Assistant releases

The guest page has to stay close to the Home Assistant version it talks to,
so there are two channels, each on its own branch, like Home Assistant's own
stable and beta channels:

| Channel | Branch                 | Built on the frontend of                                                                                 | App                  |
| ------- | ---------------------- | -------------------------------------------------------------------------------------------------------- | -------------------- |
| stable  | `guest-assistant`      | the newest stable core release (`2026.10.1`)                                                             | Guest Assistant      |
| beta    | `guest-assistant-beta` | the newest core release of any kind (`2026.11.0b0`, then `2026.11.0`, `2026.11.1`, …, until the next b0) | Guest Assistant Beta |

Work on the guest page happens on `guest-assistant`. `guest-assistant-beta`
is kept by the sync below and only ever merges `guest-assistant` and
upstream releases; between a stable release and the next beta both channels
are built on the same frontend.

**Every morning** `.github/workflows/upstream-sync.yaml` runs
`script/upstream-targets`, which reads the newest core tags and the frontend
version each one pins (`homeassistant/components/frontend/manifest.json`), and
`script/merge-upstream <channel> <core> <frontend>`, which merges that
frontend tag from home-assistant/frontend into the channel's branch (the beta
branch merges `guest-assistant` first). The merged branch is checked (eslint,
tsc, tests, guest build) and pushed. Betas and stable releases come out in
the evening, patch releases mostly on Fridays, so a release is picked up the
next morning.

**Every push** to either branch that changes the build runs
`.github/workflows/guest-assistant.yaml` (pushes of only workflows, docs,
tests or the sync scripts do not): it builds the page and publishes it as a
release tagged `<frontend version>-<commit>` (`20260930.3-1a2b3c4d5`), the
latest release for stable, a prerelease tagged `…-beta` for beta. The tag is
the build id. The release notes end with lines the app repository reads:

```
Channel: stable
Frontend: 20260930.3
Core: 2026.10.1
Branch: guest-assistant
```

The release is then announced to wendevlin/guest-assistant, which opens a pull
request that pins it for the app (see "Releases" in its README).

**When the sync stops**, because the merge conflicts or a check fails, nothing
is pushed and an issue "Frontend sync: …" opens in wendevlin/guest-assistant
with the files and the commands to run by hand:

```sh
guest-assistant/script/merge-upstream beta 2026.11.0b0 20261028.0
# resolve, check (pnpm lint:types, pnpm test), commit
git push origin HEAD:guest-assistant-beta
```

The next run continues from there. Both workflows push and dispatch with the
secret `GUEST_ASSISTANT_BOT_TOKEN`, a fine-grained token of the repository
owner with read and write access to contents, issues, pull requests and
workflows of both repositories; pushes with the default token would not start
the release workflow.

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

## Companion app

The Home Assistant companion apps can show the guest page instead of Home
Assistant's frontend, once the admin switched that on in the proxy (its
`src/companion/`). The app loads `/?external_auth=1` in its web view and
adds a JavaScript bridge (`window.externalApp`, `window.externalAppV2` or
`window.webkit.messageHandlers`).

- `ha-guest-assistant.ts` checks for the bridge (`hasExternalBridge()` in
  `data/guest-external.ts`; the URL parameter alone does not count). With
  it, there is no login form and no cookie: the upstream `ExternalAuth`
  (`src/external_app/external_auth.ts`) asks the app for tokens, and
  `GET /api/guest-assistant/session` tells name and dashboard.
- The page answers the app's commands itself: `restart` reconnects,
  `navigate` only works inside the guest's dashboard, everything else is
  refused. It sends `frontend/loaded` once the dashboard can render (or an
  error is shown), removes the launch screen without animation when the app
  has its own splash screen, and leaves the service worker out.
- Log out asks the app to revoke its login and shows a signed-out page.
- `authorize.html` (`ha-guest-assistant-authorize.ts`, served by the proxy
  at `/auth/authorize`) is the page the app opens to sign a guest in. It
  shows the regular guest login, accepts only the official apps' client ids
  and `homeassistant://auth-callback` (`data/guest-authorize.ts`), signs in
  through the proxy's `/auth/login_flow` and sends the app to its callback
  with the code.

## Translations

Strings live under the top-level `guest-assistant` key in
`src/translations/en.json`. The build produces one translation file per
locale containing the base strings, the `lovelace` panel strings and the
`guest-assistant` strings (fragment `guest-assistant` in
`build-scripts/gulp/translations.js`).
