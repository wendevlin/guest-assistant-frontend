/**
 * Keeps the guest app on the frontend the proxy serves.
 *
 * Each build writes its id into the bundle (`__GUEST_ASSISTANT_BUILD__`) and
 * into `/build.json`. When they differ, this page is an old build: an updated
 * app was installed while it was open, or the service worker showed the
 * stored page because the proxy was out of reach. The page then reloads onto
 * the new build with `reloadFresh()`, which also drops the service worker and
 * its cache and allows one reload a minute.
 *
 * The check runs when the page starts, after every (re)connect (an update
 * restarts the proxy, so every open app reconnects) and when the app comes
 * back to the foreground. A guest is never interrupted in the middle of
 * something by a timer.
 */

import { reloadFresh } from "../../../src/util/recover-stale-build";
import { supportsServiceWorker } from "../../../src/util/register-service-worker";

declare global {
  /* eslint-disable @typescript-eslint/naming-convention */
  /** Build id, set from GUEST_ASSISTANT_BUILD (build-scripts/bundle.cjs). */
  var __GUEST_ASSISTANT_BUILD__: string;
  /* eslint-enable @typescript-eslint/naming-convention */
}

const BUILD_URL = "/build.json";

/** Checks closer together than this are skipped, unless they are forced. */
export const CHECK_INTERVAL = 30_000;

/** reloadFresh() refuses a second reload within a minute; ask again after. */
export const RETRY_DELAY = 61_000;

/**
 * A reload onto a build that did not bring this page to it (e.g. a cache in
 * between still serves the old page) is not tried again for this long, so
 * the app does not reload every time it comes to the foreground.
 */
export const TRIED_TIMEOUT = 60 * 60_000;

const TRIED_STORAGE_KEY = "guestAssistantUpdateTried";

/** The build the proxy serves, or undefined when it cannot tell. */
export const fetchServerBuild = async (): Promise<string | undefined> => {
  try {
    const res = await fetch(BUILD_URL, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!res.ok) {
      return undefined;
    }
    const data: unknown = await res.json();
    const build =
      data && typeof data === "object" && "build" in data
        ? data.build
        : undefined;
    return typeof build === "string" && build ? build : undefined;
  } catch (_err) {
    return undefined;
  }
};

interface TriedReload {
  build: string;
  at: number;
}

export interface UpdateCheckerOptions {
  /** Build of this page. */
  currentBuild: string;
  fetchBuild?: () => Promise<string | undefined>;
  /** Starts a reload; false when it refused to. */
  reload?: () => boolean;
  now?: () => number;
  storage?: Pick<Storage, "getItem" | "setItem">;
  setTimer?: (callback: () => void, ms: number) => unknown;
}

export class GuestUpdateChecker {
  private readonly _currentBuild: string;

  private readonly _fetchBuild: () => Promise<string | undefined>;

  private readonly _reload: () => boolean;

  private readonly _now: () => number;

  private readonly _storage?: Pick<Storage, "getItem" | "setItem">;

  private readonly _setTimer: (callback: () => void, ms: number) => unknown;

  private _lastAnswer = 0;

  private _retryFor?: string;

  private _reloading = false;

  constructor(options: UpdateCheckerOptions) {
    this._currentBuild = options.currentBuild;
    this._fetchBuild = options.fetchBuild ?? fetchServerBuild;
    this._reload = options.reload ?? reloadFresh;
    this._now = options.now ?? Date.now;
    this._storage = options.storage;
    this._setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  }

  /**
   * Asks the proxy for its build and reloads when it is another one.
   * `force` skips the interval; it is for (re)connects, which is when an
   * update arrives. Only checks that got an answer count for the interval, so
   * one made while the proxy was still restarting does not hold back the
   * next.
   */
  public async check(force = false): Promise<void> {
    if (this._reloading) {
      return;
    }
    if (!force && this._now() - this._lastAnswer < CHECK_INTERVAL) {
      return;
    }
    const build = await this._fetchBuild();
    if (build === undefined || this._reloading) {
      return;
    }
    this._lastAnswer = this._now();
    if (build === this._currentBuild || this._recentlyTried(build)) {
      return;
    }
    if (this._reload()) {
      this._reloading = true;
      this._remember(build);
      return;
    }
    // Refused, most likely because another reload happened within the last
    // minute: ask once more after that, then leave it to the next trigger.
    if (this._retryFor !== build) {
      this._retryFor = build;
      this._setTimer(() => this.check(true), RETRY_DELAY);
    }
  }

  private _recentlyTried(build: string): boolean {
    try {
      const tried = JSON.parse(
        this._storage?.getItem(TRIED_STORAGE_KEY) ?? "null"
      ) as TriedReload | null;
      return tried?.build === build && this._now() - tried.at < TRIED_TIMEOUT;
    } catch (_err) {
      return false;
    }
  }

  private _remember(build: string) {
    try {
      this._storage?.setItem(
        TRIED_STORAGE_KEY,
        JSON.stringify({ build, at: this._now() } satisfies TriedReload)
      );
    } catch (_err) {
      // Without storage reloadFresh() refuses anyway.
    }
  }
}

/**
 * Registers the service worker (guest-assistant/src/sw.js). Browsers only
 * allow one on https and localhost; elsewhere the app works without it. In
 * development a worker left from a production build is removed, so it never
 * serves a page from before the last rebuild.
 */
export const registerGuestServiceWorker = async (): Promise<void> => {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  try {
    if (__DEV__) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
      return;
    }
    if (supportsServiceWorker()) {
      await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
    }
  } catch (_err) {
    // The app works without a service worker, just not offline.
  }
};

/** Asks the browser to look for a new service worker now. */
export const updateGuestServiceWorker = async (): Promise<void> => {
  if (__DEV__ || !("serviceWorker" in navigator)) {
    return;
  }
  try {
    await (await navigator.serviceWorker.getRegistration())?.update();
  } catch (_err) {
    // Offline; the browser checks again on the next navigation.
  }
};
