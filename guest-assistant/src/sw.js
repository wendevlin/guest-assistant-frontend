/*
 * Service worker of the guest app, served as /sw.js.
 *
 * It makes the app installable and lets it open when the proxy is out of
 * reach (a guest outside the home's network, the app being updated): the
 * page stored from the last visit is shown, and the app reconnects on its own.
 *
 * It never decides which version of the app runs. Pages always come from the
 * network first, so a new build reaches guests on their next load; the stored
 * page only stands in when the network fails, is too slow or answers with a
 * server error. Bundles are left to the HTTP cache, where the proxy marks the
 * content-hashed ones immutable. Nothing else is stored: no API answers, no
 * images, no camera streams. There is nothing to precache, so a new version of
 * this file takes over right away.
 *
 * Copied to the build as it is, without transpiling, for every browser that
 * has service workers: ES2017, no optional chaining.
 */

const SHELL_CACHE = "guest-assistant-shell-v1";
const SHELL_KEY = "/";

// After this long without an answer the stored page is shown. The network
// answer still replaces it for the next start.
const NETWORK_TIMEOUT = 5000;

// Added by reloadFresh() (src/util/recover-stale-build.ts) for a reload that
// has to reach the server, so such a navigation never gets the stored page.
const BUST_PARAM = "ha_cache_bust";

// Served by the proxy itself (see RESERVED_PREFIXES in its server.ts), never
// the guest app.
const OTHER_PREFIXES = ["/api/", "/auth/", "/static/", "/local/", "/admin/"];

const isAppPage = (url) =>
  url.origin === self.location.origin &&
  url.pathname !== "/admin" &&
  !OTHER_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) &&
  !url.searchParams.has(BUST_PARAM);

/**
 * Keeps a page for when the proxy cannot be reached, but only the guest app
 * itself: not an error page, a redirect, or the maintenance page of a reverse
 * proxy in front of it.
 */
const storeShell = async (response) => {
  const type = response.headers.get("content-type") || "";
  if (
    response.status !== 200 ||
    response.redirected ||
    !type.startsWith("text/html")
  ) {
    return;
  }
  const html = await response.clone().text();
  if (!html.includes("<ha-guest-assistant")) {
    return;
  }
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(SHELL_KEY, response);
};

self.addEventListener("install", () => {
  self.skipWaiting();
});

// Sent by a page that did not pass through this worker (the first visit, or
// one after reloadFresh() dropped the worker and its cache), so the app also
// opens offline right away. The proxy only answers with the app's page when
// the request asks for HTML.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "store-shell") {
    event.waitUntil(
      fetch(
        new Request("/", {
          headers: { accept: "text/html" },
          cache: "no-store",
        })
      )
        .then(storeShell)
        .catch(() => undefined)
    );
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

const storedShell = () =>
  caches
    .open(SHELL_CACHE)
    .then((cache) => cache.match(SHELL_KEY))
    .catch(() => undefined);

const respond = async (network) => {
  const timeout = new Promise((resolve) => {
    setTimeout(resolve, NETWORK_TIMEOUT, undefined);
  });
  let response;
  try {
    response = await Promise.race([network, timeout]);
  } catch (_err) {
    // Offline or the proxy is down.
  }
  if (response && response.status < 500) {
    return response;
  }
  const shell = await storedShell();
  // Nothing stored yet: whatever the network brings, error page included.
  return shell || network;
};

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate" || !isAppPage(new URL(request.url))) {
    return;
  }
  // The request itself, not its URL: the proxy only falls back to the app's
  // page for deep links when the Accept header asks for HTML.
  const network = fetch(request);
  // Copied before the page reads the body; keeps the worker alive until the
  // page is stored, also when the stored one was shown meanwhile.
  event.waitUntil(
    network
      .then((response) => storeShell(response.clone()))
      .catch(() => undefined)
  );
  event.respondWith(respond(network));
});
