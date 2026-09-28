import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators";
import { fireEvent } from "../../../src/common/dom/fire_event";
import "../../../src/components/ha-button";
import "../../../src/components/ha-dialog";
import "../../../src/components/ha-dialog-footer";
import "../../../src/components/ha-language-picker";
import "../../../src/components/radio/ha-radio-group";
import type { HaRadioGroup } from "../../../src/components/radio/ha-radio-group";
import "../../../src/components/radio/ha-radio-option";
import type { HomeAssistant } from "../../../src/types";
import {
  guestThemeModeToDark,
  setGuestThemeMode,
  type GuestThemeMode,
} from "../data/guest-theme";
import type { GuestSettingsDialogParams } from "./show-dialog-guest-settings";

/**
 * Settings a guest may change on their own device: the language and, when
 * the host allows it, light/dark mode. Both are stored in the browser only.
 */
@customElement("dialog-guest-settings")
export class DialogGuestSettings extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _params?: GuestSettingsDialogParams;

  @state() private _open = false;

  public async showDialog(params: GuestSettingsDialogParams): Promise<void> {
    this._params = params;
    this._open = true;
  }

  public closeDialog(): void {
    this._open = false;
  }

  protected render() {
    if (!this._params) {
      return nothing;
    }
    const dark = this.hass.selectedTheme?.dark;
    const mode: GuestThemeMode =
      dark === undefined ? "auto" : dark ? "dark" : "light";

    return html`
      <ha-dialog
        .open=${this._open}
        header-title=${this.hass.localize("ui.dialogs.more_info_control.settings")}
        width="small"
        @closed=${this._dialogClosed}
      >
        <div class="row">
          <span>${this.hass.localize("ui.panel.profile.language.header")}</span>
          <ha-language-picker
            .value=${this.hass.language}
            .label=${""}
            button-style
            native-name
            @value-changed=${this._languageChanged}
          ></ha-language-picker>
        </div>
        ${
          this._params.themeModeSelectable && this._themeHasModes()
            ? html`
                <div class="row">
                  <span>
                    ${this.hass.localize("ui.panel.profile.themes.theme_mode")}
                  </span>
                  <ha-radio-group
                    name="dark_mode"
                    orientation="horizontal"
                    .value=${mode}
                    @change=${this._modeChanged}
                  >
                    <ha-radio-option value="auto">
                      ${this.hass.localize("ui.panel.profile.themes.dark_mode.auto")}
                    </ha-radio-option>
                    <ha-radio-option value="light">
                      ${this.hass.localize(
                        "ui.panel.profile.themes.dark_mode.light"
                      )}
                    </ha-radio-option>
                    <ha-radio-option value="dark">
                      ${this.hass.localize("ui.panel.profile.themes.dark_mode.dark")}
                    </ha-radio-option>
                  </ha-radio-group>
                </div>
              `
            : nothing
        }
        <ha-dialog-footer slot="footer">
          <ha-button slot="primaryAction" @click=${this.closeDialog}>
            ${this.hass.localize("ui.common.close")}
          </ha-button>
        </ha-dialog-footer>
      </ha-dialog>
    `;
  }

  /** Like ha-theme-settings: themes with only one mode offer no choice. */
  private _themeHasModes(): boolean {
    const name = this.hass.themes.theme;
    if (!name || name === "default") {
      return true;
    }
    const modes = this.hass.themes.themes[name]?.modes;
    return !!(modes && "light" in modes && "dark" in modes);
  }

  private _languageChanged(ev: CustomEvent) {
    const language = ev.detail.value;
    if (language && language !== this.hass.language) {
      fireEvent(this, "hass-language-select", language);
    }
  }

  private _modeChanged(ev: Event) {
    const mode = (ev.currentTarget as HaRadioGroup).value as GuestThemeMode;
    setGuestThemeMode(mode);
    fireEvent(this, "settheme", { dark: guestThemeModeToDark(mode) });
  }

  private _dialogClosed(): void {
    this._params = undefined;
    this._open = false;
    fireEvent(this, "dialog-closed", { dialog: this.localName });
  }

  static styles = css`
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px 16px;
      min-height: 48px;
      color: var(--primary-text-color);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "dialog-guest-settings": DialogGuestSettings;
  }
}
