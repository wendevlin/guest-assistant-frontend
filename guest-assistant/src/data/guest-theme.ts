/**
 * The guest's own light/dark choice. Only used when the host allows it
 * (`guest_can_change_mode` in config.yaml); stored in the browser because a
 * guest account is often shared by several devices.
 */
export type GuestThemeMode = "auto" | "light" | "dark";

const STORAGE_KEY = "guestThemeMode";

export const getGuestThemeMode = (): GuestThemeMode | undefined => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "auto" || value === "light" || value === "dark"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
};

export const setGuestThemeMode = (mode: GuestThemeMode) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // storage unavailable (private mode); the choice lasts for this page
  }
};

/** Maps a mode to HA's ThemeSettings.dark (undefined = follow the device). */
export const guestThemeModeToDark = (mode: GuestThemeMode) =>
  mode === "auto" ? undefined : mode === "dark";
