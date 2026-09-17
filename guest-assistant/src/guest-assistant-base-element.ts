import type { PropertyValues } from "lit";
import { property, state } from "lit/decorators";
import {
  computeLocalize,
  type LocalizeFunc,
} from "../../src/common/translations/localize";
import { computeDirectionStyles } from "../../src/common/util/compute_rtl";
import { translationMetadata } from "../../src/resources/translations-metadata";
import { connectionMixin } from "../../src/state/connection-mixin";
import { contextMixin } from "../../src/state/context-mixin";
import { dialogManagerMixin } from "../../src/state/dialog-manager-mixin";
import { HassBaseEl } from "../../src/state/hass-base-mixin";
import MoreInfoMixin from "../../src/state/more-info-mixin";
import themesMixin from "../../src/state/themes-mixin";
import type { Resources } from "../../src/types";
import {
  getLocalLanguage,
  getTranslation,
} from "../../src/util/common-translation";

/**
 * Base element for the guest app: the subset of the HA app mixins a guest
 * dashboard needs (connection, themes, more-info dialogs, dialog manager,
 * lit context) plus translation loading before a connection exists.
 *
 * The guest-assistant translation fragment ships the base strings, the
 * lovelace panel strings and the `guest-assistant.*` strings in one file, so a
 * single `getTranslation(null, language)` covers everything.
 */
export class GuestAssistantBaseElement extends dialogManagerMixin(
  MoreInfoMixin(contextMixin(themesMixin(connectionMixin(HassBaseEl))))
) {
  @property({ attribute: false }) public localize?: LocalizeFunc;

  @property() public language?: string = getLocalLanguage();

  @state() private _resources?: Resources;

  public connectedCallback(): void {
    super.connectedCallback();
    this._initializeLocalize();
  }

  protected willUpdate(changedProperties: PropertyValues) {
    super.willUpdate(changedProperties);

    if (changedProperties.get("language")) {
      this._resources = undefined;
      this._initializeLocalize();
    }

    if (
      this.language &&
      this._resources &&
      (changedProperties.has("language") || changedProperties.has("_resources"))
    ) {
      this._setLocalize();
    }

    // Once hass exists, all HA components localize through hass.localize.
    if (
      changedProperties.has("hass") &&
      this.hass &&
      this.localize &&
      this.hass.localize !== this.localize
    ) {
      this._updateHass({ localize: this.localize });
    }
  }

  private async _initializeLocalize() {
    if (this._resources || !this.language) {
      return;
    }
    const { data } = await getTranslation(null, this.language);
    this._resources = { [this.language]: data };
  }

  private async _setLocalize() {
    const localize = await computeLocalize(
      this.constructor.prototype,
      this.language!,
      this._resources!
    );
    this.localize = localize;
    if (this.hass) {
      this._updateHass({ localize });
    }
    computeDirectionStyles(
      translationMetadata.translations[this.language!]?.isRTL ?? false,
      this
    );
  }
}
