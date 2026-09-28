import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators";
import { fireEvent } from "../../../src/common/dom/fire_event";
import "../../../src/components/ha-adaptive-dialog";
import "../../../src/components/ha-language-picker";
import "../../../src/components/ha-settings-row";
import type { HomeAssistant } from "../../../src/types";

/**
 * Settings a guest may change on their own device. The look always follows
 * Home Assistant (default theme, dashboard and view themes), so only the
 * language is offered; it is stored in the browser.
 *
 * Uses the adaptive dialog: a dialog on large screens, a bottom sheet on
 * phones.
 */
@customElement("dialog-guest-settings")
export class DialogGuestSettings extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _open = false;

  public async showDialog(): Promise<void> {
    this._open = true;
  }

  public closeDialog(): void {
    this._open = false;
  }

  protected render() {
    if (!this._open) {
      return nothing;
    }
    return html`
      <ha-adaptive-dialog
        .open=${this._open}
        header-title=${this.hass.localize("ui.dialogs.more_info_control.settings")}
        width="medium"
        @closed=${this._dialogClosed}
      >
        <ha-settings-row>
          <span slot="heading">
            ${this.hass.localize("ui.panel.profile.language.header")}
          </span>
          <ha-language-picker
            .value=${this.hass.language}
            .label=${this.hass.localize("ui.panel.profile.language.dropdown_label")}
            native-name
            @value-changed=${this._languageChanged}
          ></ha-language-picker>
        </ha-settings-row>
      </ha-adaptive-dialog>
    `;
  }

  private _languageChanged(ev: CustomEvent) {
    const language = ev.detail.value;
    if (language && language !== this.hass.language) {
      fireEvent(this, "hass-language-select", language);
    }
  }

  private _dialogClosed(): void {
    this._open = false;
    fireEvent(this, "dialog-closed", { dialog: this.localName });
  }

  static styles = css`
    ha-settings-row {
      padding: 0;
      min-height: 64px;
    }
    ha-language-picker {
      min-width: 240px;
    }
    @media (max-width: 600px) {
      ha-settings-row {
        flex-wrap: wrap;
      }
      ha-language-picker {
        width: 100%;
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "dialog-guest-settings": DialogGuestSettings;
  }
}
