import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators";
import { fireEvent } from "../../../src/common/dom/fire_event";
import type { LocalizeFunc } from "../../../src/common/translations/localize";
import "../../../src/components/ha-alert";
import "../../../src/components/ha-button";
import "../../../src/components/ha-card";
import "../../../src/components/input/ha-input";
import type { HaInput } from "../../../src/components/input/ha-input";
import { haStyle } from "../../../src/resources/styles";
import { GuestApiError, signIn } from "../data/guest-api";

@customElement("guest-assistant-login")
export class GuestAssistantLogin extends LitElement {
  @property({ attribute: false }) public localize?: LocalizeFunc;

  @state() private _loading = false;

  @state() private _error?: string;

  @query("#username") private _username!: HaInput;

  @query("#password") private _password!: HaInput;

  protected render() {
    const t = (key: string, fallback: string) =>
      this.localize?.(key as any) || fallback;

    return html`
      <div class="login">
        <div class="header">
          <img
            src="/static/icons/favicon-192x192.png"
            alt="Home Assistant"
            class="logo"
          />
          <h1>${t("guest-assistant.login.title", "Welcome")}</h1>
          <p>${t("guest-assistant.login.subtitle", "Sign in")}</p>
        </div>
        <ha-card>
          <form class="card-content" @submit=${this._submit}>
            ${
              this._error
                ? html`<ha-alert alert-type="error">${this._error}</ha-alert>`
                : nothing
            }
            <ha-input
              id="username"
              name="username"
              autocomplete="username"
              autocapitalize="none"
              required
              autofocus
              .label=${t("guest-assistant.login.username", "Username")}
              .disabled=${this._loading}
            ></ha-input>
            <ha-input
              id="password"
              name="password"
              type="password"
              autocomplete="current-password"
              password-toggle
              required
              .label=${t("guest-assistant.login.password", "Password")}
              .disabled=${this._loading}
            ></ha-input>
            <ha-button
              type="submit"
              appearance="filled"
              .loading=${this._loading}
              .disabled=${this._loading}
            >
              ${
                this._loading
                  ? t("guest-assistant.login.signing_in", "Signing in…")
                  : t("guest-assistant.login.sign_in", "Sign in")
              }
            </ha-button>
          </form>
        </ha-card>
      </div>
    `;
  }

  private async _submit(ev: Event) {
    ev.preventDefault();
    const username = (this._username.value ?? "").trim();
    const password = this._password.value ?? "";
    if (!username || !password) {
      return;
    }

    this._loading = true;
    this._error = undefined;
    try {
      await signIn(username, password);
      fireEvent(this, "authenticated");
    } catch (err) {
      const invalid =
        err instanceof GuestApiError &&
        (err.status === 401 || err.status === 400);
      this._error = invalid
        ? this.localize?.("guest-assistant.login.error_invalid") ||
          "Invalid username or password"
        : this.localize?.("guest-assistant.login.error_generic") ||
          "Sign in failed, please try again";
      this._password.value = "";
    } finally {
      this._loading = false;
    }
  }

  static styles = [
    haStyle,
    css`
      :host {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        padding: 16px;
        box-sizing: border-box;
      }
      .login {
        width: 100%;
        max-width: 400px;
      }
      .header {
        text-align: center;
        margin-bottom: 24px;
      }
      .logo {
        width: 80px;
        height: 80px;
        margin-bottom: 16px;
      }
      h1 {
        font-size: var(--ha-font-size-3xl);
        font-weight: var(--ha-font-weight-normal);
        margin: 0 0 8px;
      }
      .header p {
        color: var(--secondary-text-color);
        margin: 0;
      }
      .card-content {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px;
      }
      ha-input,
      ha-button {
        width: 100%;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "guest-assistant-login": GuestAssistantLogin;
  }
  interface HASSDomEvents {
    authenticated: undefined;
  }
}
