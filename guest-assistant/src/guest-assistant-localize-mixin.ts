import type { LitElement, PropertyValues } from "lit";
import { property, state } from "lit/decorators";
import {
  computeLocalize,
  type LocalizeFunc,
} from "../../src/common/translations/localize";
import { computeDirectionStyles } from "../../src/common/util/compute_rtl";
import { translationMetadata } from "../../src/resources/translations-metadata";
import type { Constructor, Resources } from "../../src/types";
import {
  getLocalLanguage,
  getTranslation,
} from "../../src/util/common-translation";

/**
 * `localize` for the guest screens shown before a connection exists (login,
 * the companion app's authorize page). The guest-assistant translation
 * fragment ships the base strings, the lovelace panel strings and the
 * `guest-assistant.*` strings in one file, so a single
 * `getTranslation(null, language)` covers everything.
 */
export const GuestLocalizeMixin = <T extends Constructor<LitElement>>(
  superClass: T
) => {
  class GuestLocalizeClass extends superClass {
    @property({ attribute: false }) public localize?: LocalizeFunc;

    @property() public language: string = getLocalLanguage();

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
        (changedProperties.has("language") ||
          changedProperties.has("_resources"))
      ) {
        this._setLocalize();
      }
    }

    private async _initializeLocalize() {
      if (this._resources || !this.language) {
        return;
      }
      const language = this.language;
      const { data } = await getTranslation(null, language);
      if (language === this.language) {
        this._resources = { [language]: data };
      }
    }

    private async _setLocalize() {
      const language = this.language;
      const localize = await computeLocalize(
        this.constructor.prototype,
        language,
        this._resources!
      );
      if (language !== this.language) {
        return;
      }
      this.localize = localize;
      document.querySelector("html")!.setAttribute("lang", language);
      computeDirectionStyles(
        translationMetadata.translations[language]?.isRTL ?? false,
        this
      );
    }
  }
  return GuestLocalizeClass;
};
