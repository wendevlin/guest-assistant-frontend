import type { Connection } from "home-assistant-js-websocket";
import {
  createConnection,
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
} from "home-assistant-js-websocket";
import { css, html, nothing, type PropertyValues } from "lit";
import { customElement, state } from "lit/decorators";
import { mainWindow } from "../../src/common/dom/get_main_window";
import { navigate, replaceCurrentUrl } from "../../src/common/navigate";
import "../../src/components/ha-alert";
import "../../src/components/ha-button";
import "../../src/components/ha-spinner";
import { haStyle } from "../../src/resources/styles";
import type { Route } from "../../src/types";
import type { ExternalAuth } from "../../src/external_app/external_auth";
import { removeLaunchScreen } from "../../src/util/launch-screen";
import { recoverFromStaleBuild } from "../../src/util/recover-stale-build";
import "./components/guest-assistant-connection-banner";
import type { ConnectionProblem } from "./components/guest-assistant-connection-banner";
import "./components/guest-assistant-dashboard";
import "./components/guest-assistant-login";
import {
  getGuestInfo,
  getHassToken,
  getProxyStatus,
  getSession,
  GuestApiError,
} from "./data/guest-api";
import { GuestAuth } from "./data/guest-auth";
import {
  handleExternalCommand,
  hasExternalBridge,
  loadExternalAuth,
} from "./data/guest-external";
import {
  GuestUpdateChecker,
  registerGuestServiceWorker,
  updateGuestServiceWorker,
} from "./data/guest-update";
import { GuestAssistantBaseElement } from "./guest-assistant-base-element";

/** Dialogs a guest must never be able to open, even via shortcuts. */
const BLOCKED_DIALOGS = new Set([
  "ha-quick-bar",
  "ha-voice-command-dialog",
  "dialog-shortcuts",
]);

type GuestView =
  "loading" | "login" | "connecting" | "dashboard" | "error" | "signed-out";

/** Delay before the banner appears, so short reconnects stay invisible. */
const PROBLEM_DELAY_MS = 1500;
const RETRY_INTERVAL_MS = 5000;
/**
 * How long the dashboard may wait for the core config and themes after
 * connecting. They come from subscriptions without error handling, so a
 * command the proxy denies would otherwise leave the spinner up forever.
 */
const LOAD_TIMEOUT_MS = 25000;

const sessionStore = (): Storage | undefined => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

/** Errors that mean "try again later" rather than "this will never work". */
const isConnectivityError = (err: unknown) =>
  err === ERR_CANNOT_CONNECT ||
  // fetch() rejects with a TypeError when the server is unreachable
  err instanceof TypeError ||
  (err instanceof GuestApiError && err.status >= 500);

@customElement("ha-guest-assistant")
export class HaGuestAssistant extends GuestAssistantBaseElement {
  @state() private _view: GuestView = "loading";

  @state() private _errorMessage?: string;

  @state() private _errorReasons: string[] = [];

  @state() private _route: Route = { prefix: "/lovelace", path: "" };

  @state() private _narrow = false;

  /** url_path of the assigned dashboard, null for the default dashboard */
  @state() private _dashboardUrlPath: string | null = null;

  @state() private _problem?: ConnectionProblem;

  private _problemTimer?: number;

  private _retryTimer?: number;

  private _loadTimer?: number;

  private _connection?: Connection;

  private _auth?: GuestAuth | ExternalAuth;

  /**
   * Running in the Home Assistant companion app: the app signs the guest in
   * and hands over its tokens (see data/guest-external.ts), there is no
   * cookie session and no login form.
   */
  private _external = hasExternalBridge();

  /** The app's auth and message bus; created once, kept across reconnects. */
  private _externalAuth?: ExternalAuth;

  /** `frontend/loaded` was sent: the app may take down its splash screen. */
  private _loadedSent = false;

  private _userName = "Guest";

  private _updates = new GuestUpdateChecker({
    currentBuild: __GUEST_ASSISTANT_BUILD__,
    storage: sessionStore(),
  });

  protected firstUpdated(changedProps: PropertyValues): void {
    super.firstUpdated(changedProps);

    // The app runs: from here on it handles failures itself, the boot guard
    // in index.html only covers the entry bundles. In the companion app the
    // launch screen goes once the app's config says whether it covers the
    // page with its own splash screen.
    if (!this._external) {
      removeLaunchScreen();
    }
    this._removeCacheBust();
    this._watchForUpdates();

    this.addEventListener(
      "show-dialog",
      ((ev: CustomEvent) => {
        if (BLOCKED_DIALOGS.has(ev.detail?.dialogTag)) {
          ev.stopImmediatePropagation();
          ev.preventDefault();
        }
      }) as EventListener,
      { capture: true }
    );

    this.addEventListener("guest-logout", () => this._logout());
    this.addEventListener("guest-language-changed", (ev) =>
      this._setLoginLanguage((ev as CustomEvent<string>).detail)
    );
    // Language picked in the settings dialog: TranslationsMixin switches
    // hass; keep the login screen in the same language after a logout.
    this.addEventListener("hass-language-select", (ev) => {
      this.language = (ev as CustomEvent<string>).detail;
    });

    this._updateNarrow();
    window.addEventListener("resize", () => this._updateNarrow());
    mainWindow.addEventListener("location-changed", () => this._updateRoute());
    mainWindow.addEventListener("popstate", () => this._updateRoute());
    this._updateRoute();

    this._restoreSession();
  }

  protected willUpdate(changedProps: PropertyValues): void {
    super.willUpdate(changedProps);
    if (changedProps.has("_dashboardUrlPath")) {
      this._updateRoute();
    }
    if (this._loadTimer && this.hass?.config && this.hass.themes) {
      this._clearLoadWatchdog();
    }
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    this._maybeSendLoaded();
  }

  protected render() {
    return html`${this._renderView()}
      <guest-assistant-connection-banner
        .localize=${this.hass?.localize ?? this.localize}
        .problem=${this._problem}
      ></guest-assistant-connection-banner>`;
  }

  private _renderView() {
    switch (this._view) {
      case "loading":
      case "connecting":
        return html`
          <div class="centered">
            <ha-spinner size="large"></ha-spinner>
            <p>${this.localize?.("guest-assistant.connecting") ?? nothing}</p>
          </div>
        `;
      case "error":
        return html`
          <div class="centered">
            <ha-alert alert-type="error" .title=${this._errorMessage ?? ""}>
              ${
                this._errorReasons.length
                  ? html`<ul>
                      ${this._errorReasons.map((r) => html`<li>${r}</li>`)}
                    </ul>`
                  : nothing
              }
            </ha-alert>
            <ha-button
              appearance="filled"
              @click=${this._external ? this._connect : this._logout}
            >
              ${this.localize?.("guest-assistant.retry") ?? "Try again"}
            </ha-button>
          </div>
        `;
      case "signed-out":
        return html`
          <div class="centered">
            <p>${this.localize?.("guest-assistant.signed_out") ?? nothing}</p>
          </div>
        `;
      case "login":
        return html`
          <guest-assistant-login
            .localize=${this.localize}
            .language=${this.language}
            @authenticated=${this._connect}
          ></guest-assistant-login>
        `;
      case "dashboard":
        return html`
          <guest-assistant-dashboard
            .hass=${this.hass}
            .narrow=${this._narrow}
            .route=${this._route}
            .dashboardUrlPath=${this._dashboardUrlPath}
          ></guest-assistant-dashboard>
        `;
    }
    return nothing;
  }

  private _updateNarrow() {
    this._narrow = window.innerWidth < 870;
  }

  private _updateRoute() {
    const path = mainWindow.location.pathname;
    const prefix = `/${this._dashboardUrlPath ?? "lovelace"}`;
    const subPath = path.startsWith(prefix)
      ? path.slice(prefix.length)
      : path.replace(/^\/[^/]*/, "");
    this._route = { prefix, path: subPath };
  }

  private async _restoreSession() {
    if (this._external) {
      await this._connect();
      return;
    }
    let session: Awaited<ReturnType<typeof getSession>>;
    try {
      session = await getSession();
    } catch (err) {
      if (isConnectivityError(err)) {
        this._startProblemCheck();
        clearTimeout(this._retryTimer);
        this._retryTimer = window.setTimeout(
          () => this._restoreSession(),
          RETRY_INTERVAL_MS
        );
        return;
      }
      session = null;
    }
    if (!session) {
      this._clearProblem();
      this._view = "login";
      return;
    }
    this._userName = session.user.name || "Guest";
    await this._connect();
  }

  /** Language picked on the login screen, before `hass` exists. */
  private _setLoginLanguage(language: string) {
    this.language = language;
    try {
      window.localStorage.setItem("selectedLanguage", JSON.stringify(language));
    } catch {
      // storage unavailable (private mode); the choice lasts for this page
    }
  }

  protected hassDisconnected() {
    super.hassDisconnected();
    // Closing the connection on logout also ends up here.
    if (this._connection) {
      this._startProblemCheck();
    }
  }

  protected hassConnected() {
    super.hassConnected();
    this._checkForUpdate(true);
  }

  protected hassReconnected() {
    super.hassReconnected();
    this._clearProblem();
    // An update restarts the proxy, so this is when a new build arrives.
    this._checkForUpdate(true);
  }

  /**
   * Keeps this page on the build the proxy serves (see data/guest-update.ts):
   * checks when the app starts, comes back to the foreground or online, and
   * after every (re)connect; reloads when a bundle of an old build is gone.
   * Registered once, so it also covers the login screen.
   */
  private _watchForUpdates() {
    // The companion app has its own offline handling and splash screen.
    if (!this._external) {
      registerGuestServiceWorker();
    }
    this._checkForUpdate();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this._checkForUpdate();
      }
    });
    // Back from the back/forward cache, the page did not load again.
    window.addEventListener("pageshow", (ev) => {
      if (ev.persisted) {
        this._checkForUpdate();
      }
    });
    window.addEventListener("online", () => this._checkForUpdate());

    // Like logging-mixin.ts, without sending errors to Home Assistant's log
    // (the proxy does not let guests write there). Resource errors do not
    // bubble, so they are caught in the capture phase.
    window.addEventListener(
      "error",
      (ev) => {
        const target = ev.target as
          (HTMLScriptElement & HTMLLinkElement) | null;
        if (
          target &&
          (target.tagName === "SCRIPT" || target.tagName === "LINK")
        ) {
          recoverFromStaleBuild(target.src || target.href, this);
        }
      },
      true
    );
    window.addEventListener("error", (ev) => {
      if (recoverFromStaleBuild(ev.error?.message || ev.message, this)) {
        ev.preventDefault();
      }
    });
    window.addEventListener("unhandledrejection", (ev) => {
      const reason: unknown = ev.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "";
      if (recoverFromStaleBuild(message, this)) {
        ev.preventDefault();
      }
    });
  }

  private _checkForUpdate(force = false) {
    this._updates.check(force);
    updateGuestServiceWorker();
  }

  /**
   * reloadFresh() and the boot guard reload with ha_cache_bust; once the app
   * runs it has done its job (like core.ts).
   */
  private _removeCacheBust() {
    const url = new URL(mainWindow.location.href);
    if (!url.searchParams.has("ha_cache_bust")) {
      return;
    }
    url.searchParams.delete("ha_cache_bust");
    replaceCurrentUrl(`${url.pathname}${url.search}${url.hash}`);
  }

  /**
   * Shows the banner after a short delay and keeps it up to date while the
   * connection is down: asks the proxy whether it is reachable and whether it
   * is connected to Home Assistant.
   */
  private _startProblemCheck() {
    if (this._problemTimer) {
      return;
    }
    const check = async () => {
      const status = await getProxyStatus();
      if (!this._problemTimer) {
        return; // reconnected meanwhile
      }
      this._problem = !status
        ? "server"
        : status.home_assistant === "disconnected"
          ? "home-assistant"
          : "connection";
      this._problemTimer = window.setTimeout(check, RETRY_INTERVAL_MS);
    };
    this._problemTimer = window.setTimeout(check, PROBLEM_DELAY_MS);
  }

  private _clearProblem() {
    clearTimeout(this._problemTimer);
    this._problemTimer = undefined;
    this._problem = undefined;
  }

  private _scheduleRetry() {
    clearTimeout(this._retryTimer);
    this._retryTimer = window.setTimeout(() => {
      this._retryTimer = undefined;
      this._connect();
    }, RETRY_INTERVAL_MS);
  }

  private async _connect() {
    clearTimeout(this._retryTimer);
    this._retryTimer = undefined;
    this._view = "connecting";
    this._errorMessage = undefined;
    this._errorReasons = [];

    try {
      if (this._external) {
        await this._connectExternal();
      } else {
        await this._connectWithSession();
      }

      this.initializeHass(this._auth!, this._connection!);
      // Guests are never admins; kiosk mode hides search, edit and the
      // sidebar toggle. Shortcuts stay off so nothing opens by keyboard.
      this._updateHass({
        user: {
          id: "guest",
          name: this._userName,
          is_owner: false,
          is_admin: false,
          credentials: [],
          mfa_modules: [],
        },
        kioskMode: true,
        enableShortcuts: false,
      });

      this._clearProblem();
      this._view = "dashboard";
      this._startLoadWatchdog();
    } catch (err: any) {
      this._teardownConnection();
      if (isConnectivityError(err)) {
        // Server or Home Assistant down: keep the spinner, explain why in the
        // banner and try again.
        this._startProblemCheck();
        this._scheduleRetry();
        return;
      }
      this._clearProblem();
      if (this._external) {
        // There is no login form in the app: it signs the guest in itself.
        this._errorMessage = this.localize?.(
          "guest-assistant.external.auth_failed"
        );
        this._errorReasons = [];
        this._view = "error";
        return;
      }
      if (
        err === ERR_INVALID_AUTH ||
        (err instanceof GuestApiError && err.status === 401)
      ) {
        this._view = "login";
        return;
      }
      if (err instanceof GuestApiError && err.status === 403) {
        this._errorMessage = this.localize?.(
          "guest-assistant.login.error_unavailable"
        );
        this._errorReasons = err.reasons;
      } else {
        this._errorMessage =
          err?.message ??
          this.localize?.("guest-assistant.login.error_generic");
      }
      this._view = "error";
    }
  }

  /** Browser: the token comes from the proxy for the session cookie. */
  private async _connectWithSession() {
    const [session, tokens] = await Promise.all([
      getSession().catch(() => null),
      getHassToken(),
    ]);
    if (session) {
      this._userName = session.user.name || "Guest";
    }
    this._dashboardUrlPath = tokens.dashboard_url_path;

    const auth = new GuestAuth(window.location.origin, tokens);
    this._auth = auth;
    try {
      this._connection = await createConnection({ auth });
    } catch (err) {
      if (err !== ERR_INVALID_AUTH) {
        throw err;
      }
      await auth.refreshAccessToken();
      this._connection = await createConnection({ auth });
    }
  }

  /** Companion app: the token comes from the app, the dashboard from the proxy. */
  private async _connectExternal() {
    if (!this._externalAuth) {
      try {
        this._externalAuth = await loadExternalAuth(window.location.origin);
      } finally {
        removeLaunchScreen(
          !!this._externalAuth?.external?.config.hasSplashscreen
        );
      }
      this._attachExternalBus(this._externalAuth);
    }
    const auth = this._externalAuth;
    this._auth = auth;
    try {
      this._connection = await createConnection({ auth });
    } catch (err) {
      if (err !== ERR_INVALID_AUTH) {
        throw err;
      }
      // Like the regular frontend: the app refreshes a token it still
      // considers valid only when asked with force (e.g. after the proxy
      // stopped accepting it).
      await auth.refreshAccessToken(true);
      this._connection = await createConnection({ auth });
    }
    const info = await getGuestInfo(auth.accessToken).catch(() => null);
    if (info) {
      this._userName = info.name || "Guest";
      this._dashboardUrlPath = info.dashboard_url_path;
    }
  }

  /** Answers the app's commands and forwards haptic feedback to it. */
  private _attachExternalBus(auth: ExternalAuth) {
    const bus = auth.external;
    if (!bus) {
      return;
    }
    bus.addCommandHandler((msg) => {
      const result = handleExternalCommand(msg, {
        dashboardUrlPath: this._dashboardUrlPath,
        reconnect: () => this._connection?.reconnect(true),
        navigate: (path, options) => navigate(path, options),
      });
      bus.fireMessage(
        result.success
          ? { id: msg.id, type: "result", success: true, result: null }
          : { id: msg.id, type: "result", success: false, error: result.error }
      );
      return true;
    });
    window.addEventListener("haptic", (ev) =>
      bus.fireMessage({ type: "haptic", payload: { hapticType: ev.detail } })
    );
  }

  /**
   * Tells the app the page is ready, so it takes down its splash screen:
   * once the dashboard has what it needs to render, or an error or the
   * signed-out view is shown.
   */
  private _maybeSendLoaded() {
    const bus = this._externalAuth?.external;
    if (!bus || this._loadedSent) {
      return;
    }
    const ready =
      this._view === "error" ||
      this._view === "signed-out" ||
      (this._view === "dashboard" && !!this.hass?.config && !!this.hass.themes);
    if (ready) {
      this._loadedSent = true;
      bus.fireMessage({ type: "frontend/loaded" });
    }
  }

  /**
   * Shows the error view if the dashboard still has no config or themes after
   * LOAD_TIMEOUT_MS. While the connection is down the banner already explains
   * the wait and reconnecting resumes loading, so the check starts over.
   */
  private _startLoadWatchdog() {
    this._clearLoadWatchdog();
    this._loadTimer = window.setTimeout(() => {
      this._loadTimer = undefined;
      if (this.hass?.config && this.hass.themes) {
        return;
      }
      if (this.hass && !this.hass.connected) {
        this._startLoadWatchdog();
        return;
      }
      this._teardownConnection();
      this._clearProblem();
      this._errorMessage = this.localize?.("guest-assistant.load_failed");
      this._errorReasons = [];
      this._view = "error";
    }, LOAD_TIMEOUT_MS);
  }

  private _clearLoadWatchdog() {
    clearTimeout(this._loadTimer);
    this._loadTimer = undefined;
  }

  private _teardownConnection() {
    clearTimeout(this._retryTimer);
    this._retryTimer = undefined;
    this._clearLoadWatchdog();
    this._connection?.close();
    this._connection = undefined;
    this._auth = undefined;
    this.hass = undefined as any;
  }

  private async _logout() {
    if (this._external) {
      // The app revokes its login and shows its own signed-out state.
      try {
        await this._externalAuth?.revoke();
      } catch {
        // ignore, the login may already be gone
      }
      this._teardownConnection();
      this._clearProblem();
      this._view = "signed-out";
      return;
    }
    try {
      await this._auth?.revoke();
    } catch {
      // ignore, the session may already be gone
    }
    this._teardownConnection();
    this._clearProblem();
    this._errorMessage = undefined;
    this._errorReasons = [];
    this._view = "login";
  }

  static styles = [
    haStyle,
    css`
      :host {
        display: block;
        height: 100%;
      }
      .centered {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        padding: 16px;
        box-sizing: border-box;
        text-align: center;
        gap: 16px;
      }
      .centered p {
        color: var(--secondary-text-color);
        margin: 0;
      }
      ha-alert {
        max-width: 480px;
        text-align: start;
      }
      ha-alert ul {
        margin: 8px 0 0;
        padding-inline-start: 20px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-guest-assistant": HaGuestAssistant;
  }
  interface HASSDomEvents {
    "guest-logout": undefined;
  }
}
