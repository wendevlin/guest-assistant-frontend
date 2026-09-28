import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators";
import { applyThemesOnElement } from "../../../src/common/dom/apply_themes_on_element";
import { fireEvent } from "../../../src/common/dom/fire_event";
import type { LocalizeFunc } from "../../../src/common/translations/localize";
import "../../../src/components/ha-alert";
import "../../../src/components/ha-button";
import "../../../src/components/ha-language-picker";
import "../../../src/components/input/ha-input";
import type { HaInput } from "../../../src/components/input/ha-input";
import { haStyle } from "../../../src/resources/styles";
import { GuestApiError, signIn } from "../data/guest-api";

/**
 * Username/password login against the proxy. Layout and styling follow HA's
 * own login page (src/auth/ha-authorize.ts, ha-auth-flow.ts): logo above a
 * bordered card, "Welcome" heading, full-width submit button and a language
 * picker below the card.
 */
@customElement("guest-assistant-login")
export class GuestAssistantLogin extends LitElement {
  @property({ attribute: false }) public localize?: LocalizeFunc;

  @property() public language?: string;

  @state() private _loading = false;

  @state() private _error?: string;

  @query("#username") private _username!: HaInput;

  @query("#password") private _password!: HaInput;

  protected firstUpdated(changedProps: PropertyValues<this>) {
    super.firstUpdated(changedProps);
    // Themes are only applied once connected; until then follow the OS like
    // HA's login page does.
    if (matchMedia("(prefers-color-scheme: dark)").matches) {
      applyThemesOnElement(
        document.documentElement,
        {
          default_theme: "default",
          default_dark_theme: null,
          themes: {},
          darkMode: true,
          theme: "default",
        },
        undefined,
        undefined,
        true
      );
    }
  }

  protected render() {
    const t = (key: string, fallback: string) =>
      this.localize?.(key as any) || fallback;

    return html`
      <div class="content">
        <div class="header">
          <img src="/static/icons/favicon-192x192.png" alt="Home Assistant" />
        </div>
        <div class="card-content">
          <form @submit=${this._submit} @keydown=${this._handleKeyDown}>
            <h1>${t("guest-assistant.login.title", "Welcome")}</h1>
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
              .label=${t(
                "ui.panel.page-authorize.form.providers.homeassistant.step.init.data.username",
                "Username"
              )}
              .disabled=${this._loading}
            ></ha-input>
            <ha-input
              id="password"
              name="password"
              type="password"
              autocomplete="current-password"
              password-toggle
              required
              .label=${t("ui.login-form.password", "Password")}
              .disabled=${this._loading}
            ></ha-input>
            <div class="action">
              <ha-button type="submit" .loading=${this._loading}>
                ${t("ui.login-form.log_in", "Log in")}
              </ha-button>
            </div>
          </form>
        </div>
        <div class="footer">
          <ha-language-picker
            .value=${this.language}
            .label=${""}
            button-style
            native-name
            @value-changed=${this._languageChanged}
          ></ha-language-picker>
        </div>
      </div>
    `;
  }

  private _languageChanged(ev: CustomEvent) {
    const language = ev.detail.value;
    if (language && language !== this.language) {
      fireEvent(this, "guest-language-changed", language);
    }
  }

  private _handleKeyDown(ev: KeyboardEvent) {
    // The native input lives in ha-input's shadow root, so Enter does not
    // trigger an implicit form submission.
    if (ev.key === "Enter" && !ev.isComposing) {
      this._submit(ev);
    }
  }

  private async _submit(ev: Event) {
    ev.preventDefault();
    if (this._loading) {
      return;
    }
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
        ? this.localize?.(
            "ui.panel.page-authorize.form.providers.homeassistant.error.invalid_auth"
          ) || "Invalid username or password"
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
        align-items: center;
        min-height: 100vh;
        padding: 32px 0;
        box-sizing: border-box;
      }
      .content {
        width: 100%;
        max-width: 400px;
        margin: 0 auto;
        padding: 0 16px;
        box-sizing: content-box;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 32px;
        padding-top: var(--safe-area-inset-top);
      }
      .header img {
        height: 56px;
        width: 56px;
      }
      .card-content {
        display: flex;
        justify-content: center;
        background: var(
          --ha-card-background,
          var(--card-background-color, white)
        );
        box-shadow: var(--ha-card-box-shadow, none);
        box-sizing: border-box;
        border-radius: var(--ha-card-border-radius, var(--ha-border-radius-lg));
        border-width: var(--ha-card-border-width, 1px);
        border-style: solid;
        border-color: var(
          --ha-card-border-color,
          var(--divider-color, #e0e0e0)
        );
        color: var(--primary-text-color);
        padding: 16px;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 16px;
        width: 100%;
        max-width: 336px;
      }
      h1 {
        text-align: center;
        font-size: var(--ha-font-size-3xl);
        font-weight: var(--ha-font-weight-normal);
        margin: 16px 0 0;
      }
      .action {
        margin: 4px 0 8px;
      }
      .action ha-button {
        width: 100%;
      }
      .footer {
        padding-top: 8px;
        display: flex;
        justify-content: space-between;
        align-items: center;
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
    "guest-language-changed": string;
  }
}
