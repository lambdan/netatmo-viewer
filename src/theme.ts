import { reactive, ref, watch } from "vue";

export type ThemeMode = "auto" | "light" | "dark";

export interface ThemeSettings {
  mode: ThemeMode;
  /** "HH:MM" when the light theme starts in auto mode. */
  dayStart: string;
  /** "HH:MM" when the dark theme starts in auto mode. */
  nightStart: string;
}

const STORAGE_KEY = "netatmo-viewer.theme";
const DEFAULTS: ThemeSettings = { mode: "auto", dayStart: "07:00", nightStart: "21:00" };

function load(): ThemeSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Stored per device, so each screen can have its own hours. */
export const themeSettings = reactive<ThemeSettings>(load());

watch(themeSettings, (s) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Private browsing etc.; settings just won't persist.
  }
});

/** True while the light theme is active. */
export const isLight = ref(false);

function minutes(hhmm: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

export function lightAt(now: Date, s: ThemeSettings): boolean {
  if (s.mode !== "auto") return s.mode === "light";
  const day = minutes(s.dayStart) ?? minutes(DEFAULTS.dayStart)!;
  const night = minutes(s.nightStart) ?? minutes(DEFAULTS.nightStart)!;
  const mins = now.getHours() * 60 + now.getMinutes();
  return day <= night
    ? mins >= day && mins < night
    // e.g. a day that runs past midnight
    : mins >= day || mins < night;
}
