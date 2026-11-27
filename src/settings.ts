// The settings panel's choices, saved on the device itself (each screen can have its own hours).

import { reactive, watch } from "vue";

export type ThemeMode = "auto" | "light" | "dark";

export interface Settings {
  mode: ThemeMode;
  /** "HH:MM" when the light theme starts in auto mode. */
  dayStart: string;
  /** "HH:MM" when the dark theme starts in auto mode. */
  nightStart: string;
  /** Mark 0° on the temperature charts. */
  freezingLine: boolean;
  /** Celsius or Fahrenheit. */
  tempUnit: "C" | "F";
  /** "auto" follows the device. */
  language: "auto" | "en" | "sv";
}

// Named from when this only held the theme; kept so saved settings survive.
const STORAGE_KEY = "netatmo-viewer.theme";
export const DEFAULTS: Settings = {
  mode: "auto",
  dayStart: "07:00",
  nightStart: "21:00",
  freezingLine: true,
  tempUnit: "C",
  language: "auto",
};

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = reactive<Settings>(load());

watch(settings, (s) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Private browsing etc.; settings just won't persist.
  }
});
