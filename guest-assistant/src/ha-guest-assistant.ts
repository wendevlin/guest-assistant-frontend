import type { Connection } from "home-assistant-js-websocket";
import {
  createConnection,
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
import "./components/guest-assistant-dashboard";
import "./components/guest-assistant-login";
import { getHassToken, getSession, GuestApiError } from "./data/guest-api";
import { GuestAuth } from "./data/guest-auth";
import { GuestAssistantBaseElement } from "./guest-assistant-base-element";

/** Dialogs a guest must never be able to open, even via shortcuts. */
const BLOCKED_DIALOGS = new Set([
  "ha-quick-bar",
  "ha-voice-command-dialog",
  "dialog-shortcuts",
]);

type GuestView = "loading" | "login" | "connecting" | "dashboard" | "error";

@customElement("ha-guest-assistant")
export class HaGuestAssistant extends GuestAssistantBaseElement {
  @state() private _view: GuestView = "loading";

  @state() private _errorMessage?: string;

  @state() private _errorReasons: string[] = [];

  @state() private _route: Route = { prefix: "/lovelace", path: "" };

  @state() private _narrow = false;

  /** url_path of the assigned dashboard, null for the default dashboard */
  @state() private _dashboardUrlPath: string | null = null;

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
  }

  protected render() {
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
    const session = await getSession().catch(() => null);
    if (!session) {
      this._view = "login";
      return;
    }
    this._userName = session.user.name || "Guest";
    await this._connect();
  }

  private async _connect() {
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

      this._view = "dashboard";
    } catch (err: any) {
      this._teardownConnection();
      if (err instanceof GuestApiError && err.status === 401) {
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

  private _teardownConnection() {
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
