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
the proxy URL, for example http://localhost:3001.

## Build

```sh
guest-assistant/script/build_guest_assistant
```

The production build lands in `guest-assistant/dist`. The proxy serves it via
`GUEST_ASSISTANT_FRONTEND_REPO` as above; without that variable it serves its
own `./public` directory instead, so copying the contents of
`guest-assistant/dist` there works too.

## Translations

Strings live under the top-level `guest-assistant` key in
`src/translations/en.json`. The build produces one translation file per
locale containing the base strings, the `lovelace` panel strings and the
`guest-assistant` strings (fragment `guest-assistant` in
`build-scripts/gulp/translations.js`).
