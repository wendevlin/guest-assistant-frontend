import type { Connection } from "home-assistant-js-websocket";
import {
  createConnection,
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
} from "home-assistant-js-websocket";
import { css, html, nothing, type PropertyValues } from "lit";
import { customElement, state } from "lit/decorators";
import { mainWindow } from "../../src/common/dom/get_main_window";
import "../../src/components/ha-alert";
import "../../src/components/ha-button";
import "../../src/components/ha-spinner";
import { haStyle } from "../../src/resources/styles";
import type { Route } from "../../src/types";
import "./components/guest-assistant-connection-banner";
import type { ConnectionProblem } from "./components/guest-assistant-connection-banner";
import "./components/guest-assistant-dashboard";
import "./components/guest-assistant-login";
import {
  getHassToken,
  getProxyStatus,
  getSession,
  GuestApiError,
} from "./data/guest-api";
import { GuestAuth } from "./data/guest-auth";
import { GuestAssistantBaseElement } from "./guest-assistant-base-element";

/** Dialogs a guest must never be able to open, even via shortcuts. */
const BLOCKED_DIALOGS = new Set([
  "ha-quick-bar",
  "ha-voice-command-dialog",
  "dialog-shortcuts",
]);

type GuestView = "loading" | "login" | "connecting" | "dashboard" | "error";

/** Delay before the banner appears, so short reconnects stay invisible. */
const PROBLEM_DELAY_MS = 1500;
const RETRY_INTERVAL_MS = 5000;
/**
 * How long the dashboard may wait for the core config and themes after
 * connecting. They come from subscriptions without error handling, so a
 * command the proxy denies would otherwise leave the spinner up forever.
 */
const LOAD_TIMEOUT_MS = 25000;

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

  private _auth?: GuestAuth;

  private _userName = "Guest";

  protected firstUpdated(changedProps: PropertyValues): void {
    super.firstUpdated(changedProps);

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
            <ha-button appearance="filled" @click=${this._logout}>
              ${this.localize?.("guest-assistant.retry") ?? "Try again"}
            </ha-button>
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

  protected hassReconnected() {
    super.hassReconnected();
    this._clearProblem();
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
      const [session, tokens] = await Promise.all([
        getSession().catch(() => null),
        getHassToken(),
      ]);
      if (session) {
        this._userName = session.user.name || "Guest";
      }
      this._dashboardUrlPath = tokens.dashboard_url_path;

      this._auth = new GuestAuth(window.location.origin, tokens);
      try {
        this._connection = await createConnection({ auth: this._auth });
      } catch (err) {
        if (err !== ERR_INVALID_AUTH) {
          throw err;
        }
        await this._auth.refreshAccessToken();
        this._connection = await createConnection({ auth: this._auth });
      }

      this.initializeHass(this._auth, this._connection);
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
