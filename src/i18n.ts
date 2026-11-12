// English and Swedish texts. The language is picked in the settings panel ("auto" follows the
// device). Dates and numbers follow the device's locale, or Swedish when Swedish is picked.

import { themeSettings } from "./theme.ts";

export type Lang = "en" | "sv";

const deviceLang = navigator.language || "en";

export function lang(): Lang {
  const l = themeSettings.language;
  if (l === "en" || l === "sv") return l;
  return /^(sv|se)\b/i.test(deviceLang) ? "sv" : "en";
}

/** Locale for number and date formatting. */
export function locale(): string {
  return lang() === "sv" ? "sv-SE" : deviceLang;
}

const en = {
  // Home view
  history: "History ›",
  loading: "Loading…",
  updated: "Updated {ago}",
  justNow: "just now",
  minAgo: "{n} min ago",
  hAgo: "{n} h ago",
  cantReach: "Can't reach server ({error})",
  showingFrom: ", showing data from {ago}",
  demoData: "demo data",
  settings: "Settings",

  // Module cards
  max: "max",
  min: "min",
  humidity: "humidity",
  co2: "CO₂",
  pressure: "pressure",
  noise: "noise",
  gust: "gust",
  battery: "battery {n}%",
  noData: "no data",
  noDataSince: "no data since {when}",

  // Settings
  display: "Display",
  theme: "Theme",
  auto: "Auto",
  light: "Light",
  dark: "Dark",
  lightFrom: "Light from",
  darkFrom: "Dark from",
  temperature: "Temperature",
  freezingLine: "Freezing line",
  on: "On",
  off: "Off",
  language: "Language",
  app: "App",
  reload: "Reload",
  savedNote: "Saved on this device. New versions load by themselves within a few minutes.",
  done: "Done",

  // History
  now: "‹ Now",
  events: "Events",
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
  years: "Years",
  monthlyAverages: "Monthly averages, year by year",
  low: "Low",
  avg: "Avg",
  high: "High",
  yearlyAverage: "Yearly average",
  yearlyNote:
    "The change is against the same months of the previous year, so partial years compare fairly.",
  records: "Records",
  last24h: "Last 24 h",
  thisMonth: "This month",
  thisYear: "This year",
  allTime: "All time",
  importing: "Still importing older history, currently back to {date}.",
  since: "Since {date}.",
  noDataPeriod: "No data for this period",
  noDataYet: "No data yet",
  loadHistoryFailed: "Couldn't load history ({error})",
  loadEventsFailed: "Couldn't load events ({error})",

  // Metrics
  mTemperature: "Temp",
  mHumidity: "Humidity",
  mCo2: "CO₂",
  mPressure: "Pressure",
  mNoise: "Noise",
  coldest: "Coldest",
  warmest: "Warmest",
  lowest: "Lowest",
  highest: "Highest",
  quietest: "Quietest",
  loudest: "Loudest",

  // Events
  eventsNote:
    "Marked on the history charts of the modules they affected, e.g. moving a module to another room, or moving house.",
  noEvents: "No events yet.",
  tapToEdit: "Tap an event to edit it.",
  editEvent: "Edit event",
  newEvent: "New event",
  whatHappened: "What happened",
  defaultEventLabel: "Moved",
  save: "Save",
  add: "Add",
  cancelEditing: "Cancel editing",
  pickDate: "Pick a date first",
  tickModule: "Tick at least one module",
  unknownModule: "Unknown module",
  confirmDelete: "Delete \"{label}\"?",
  delete: "Delete",

  // Setup
  rejected: "Netatmo rejected the login",
  envRejected:
    "The credentials in the server's environment variables no longer work. Update <code>NETATMO_CLIENT_ID</code>, <code>NETATMO_CLIENT_SECRET</code> and <code>NETATMO_REFRESH_TOKEN</code> and restart the container.",
  connect: "Connect your weather station",
  savedRejected:
    "The saved login no longer works (the token may have been revoked). Enter it again below.",
  step1:
    "Log in at <a href=\"https://dev.netatmo.com/apps\" target=\"_blank\">dev.netatmo.com/apps</a> with your Netatmo account and <b>create an app</b> (any name and description).",
  step2: "Copy the app's <b>client ID</b> and <b>client secret</b>.",
  step3:
    "Under <b>Token generator</b>, choose the scope <code>read_station</code>, click <b>Generate Token</b> and copy the <b>refresh token</b>.",
  computerTip: "Tip: this is easier from a computer. Open this same address there.",
  clientId: "Client ID",
  clientSecret: "Client secret",
  refreshToken: "Refresh token",
  checking: "Checking with Netatmo…",
  connectButton: "Connect",
  storedNote:
    "The credentials are stored in the server's database and are only used to read your station's data. Once connected, this form closes.",
};

export type MessageKey = keyof typeof en;

const sv: Record<MessageKey, string> = {
  history: "Historik ›",
  loading: "Laddar…",
  updated: "Uppdaterad {ago}",
  justNow: "nyss",
  minAgo: "för {n} min sedan",
  hAgo: "för {n} h sedan",
  cantReach: "Når inte servern ({error})",
  showingFrom: ", visar data från {ago}",
  demoData: "demodata",
  settings: "Inställningar",

  max: "max",
  min: "min",
  humidity: "luftfuktighet",
  co2: "CO₂",
  pressure: "lufttryck",
  noise: "ljud",
  gust: "byar",
  battery: "batteri {n} %",
  noData: "ingen data",
  noDataSince: "ingen data sedan {when}",

  display: "Visning",
  theme: "Tema",
  auto: "Auto",
  light: "Ljust",
  dark: "Mörkt",
  lightFrom: "Ljust från",
  darkFrom: "Mörkt från",
  temperature: "Temperatur",
  freezingLine: "Nollstrecket",
  on: "På",
  off: "Av",
  language: "Språk",
  app: "Appen",
  reload: "Ladda om",
  savedNote: "Sparas på den här enheten. Nya versioner laddas in av sig själva inom några minuter.",
  done: "Klar",

  now: "‹ Nu",
  events: "Händelser",
  day: "Dag",
  week: "Vecka",
  month: "Månad",
  year: "År",
  years: "Alla år",
  monthlyAverages: "Månadsmedel, år för år",
  low: "Lägst",
  avg: "Medel",
  high: "Högst",
  yearlyAverage: "Årsmedel",
  yearlyNote:
    "Förändringen jämförs med samma månader föregående år, så att ofullständiga år blir rättvist jämförda.",
  records: "Rekord",
  last24h: "Senaste dygnet",
  thisMonth: "Den här månaden",
  thisYear: "I år",
  allTime: "Någonsin",
  importing: "Hämtar fortfarande äldre historik, just nu tillbaka till {date}.",
  since: "Sedan {date}.",
  noDataPeriod: "Ingen data för den här perioden",
  noDataYet: "Ingen data än",
  loadHistoryFailed: "Kunde inte hämta historiken ({error})",
  loadEventsFailed: "Kunde inte hämta händelserna ({error})",

  mTemperature: "Temp",
  mHumidity: "Fukt",
  mCo2: "CO₂",
  mPressure: "Tryck",
  mNoise: "Ljud",
  coldest: "Kallast",
  warmest: "Varmast",
  lowest: "Lägst",
  highest: "Högst",
  quietest: "Tystast",
  loudest: "Högljuddast",

  eventsNote:
    "Visas i historikgraferna för de moduler som berördes, t.ex. när en modul flyttas till ett annat rum eller när du flyttar.",
  noEvents: "Inga händelser än.",
  tapToEdit: "Tryck på en händelse för att ändra den.",
  editEvent: "Ändra händelse",
  newEvent: "Ny händelse",
  whatHappened: "Vad hände",
  defaultEventLabel: "Flyttad",
  save: "Spara",
  add: "Lägg till",
  cancelEditing: "Avbryt ändringen",
  pickDate: "Välj ett datum först",
  tickModule: "Välj minst en modul",
  unknownModule: "Okänd modul",
  confirmDelete: "Ta bort \"{label}\"?",
  delete: "Ta bort",

  rejected: "Netatmo godkände inte inloggningen",
  envRejected:
    "Inloggningsuppgifterna i serverns miljövariabler fungerar inte längre. Uppdatera <code>NETATMO_CLIENT_ID</code>, <code>NETATMO_CLIENT_SECRET</code> och <code>NETATMO_REFRESH_TOKEN</code> och starta om containern.",
  connect: "Anslut din väderstation",
  savedRejected:
    "Den sparade inloggningen fungerar inte längre (token kan ha återkallats). Fyll i den igen nedan.",
  step1:
    "Logga in på <a href=\"https://dev.netatmo.com/apps\" target=\"_blank\">dev.netatmo.com/apps</a> med ditt Netatmo-konto och <b>skapa en app</b> (valfritt namn och beskrivning).",
  step2: "Kopiera appens <b>client ID</b> och <b>client secret</b>.",
  step3:
    "Under <b>Token generator</b>, välj scope <code>read_station</code>, klicka på <b>Generate Token</b> och kopiera <b>refresh token</b>.",
  computerTip: "Tips: det här är enklare från en dator. Öppna samma adress där.",
  clientId: "Client ID",
  clientSecret: "Client secret",
  refreshToken: "Refresh token",
  checking: "Kontrollerar med Netatmo…",
  connectButton: "Anslut",
  storedNote:
    "Uppgifterna sparas i serverns databas och används bara för att läsa din stations data. När den är ansluten stängs formuläret.",
};

const messages: Record<Lang, Record<MessageKey, string>> = { en, sv };

/** A text in the current language, with {name} placeholders filled in. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s = messages[lang()][key];
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

/** Fact texts. `v` holds the values already formatted for display. */
type FactVars = Record<string, string>;
type FactTexts = Record<string, (v: FactVars) => string>;

const factsEn: FactTexts = {
  lowSince: (v) => `Today's low of ${v.t} is the coldest ${v.since}`,
  highSince: (v) => `Today's high of ${v.t} is the warmest ${v.since}`,
  coldestDaySince: (v) => `Yesterday was the coldest day ${v.since}`,
  warmestDaySince: (v) => `Yesterday was the warmest day ${v.since}`,
  sameAsYesterday: () => "Just about the same temperature as this time yesterday",
  warmerThanYesterday: (v) => `${v.dt} warmer than this time yesterday`,
  colderThanYesterday: (v) => `${v.dt} colder than this time yesterday`,
  coldestDate: (v) => `The coldest ${v.md} in ${v.n} years of records`,
  warmestDate: (v) => `The warmest ${v.md} in ${v.n} years of records`,
  yearAgo: (v) => `A year ago today it was between ${v.t} and ${v.t2}`,
  dateColdestWas: (v) => `The coldest ${v.md} on record was in ${v.y}: ${v.t}`,
  dateWarmestWas: (v) => `The warmest ${v.md} on record was in ${v.y}: ${v.t}`,
  coldestStart: (v) => `The coldest start to ${v.m} in ${v.n} years`,
  warmestStart: (v) => `The warmest start to ${v.m} in ${v.n} years`,
  monthWarmer: (v) => `${v.m} so far is ${v.dt} warmer than usual`,
  monthColder: (v) => `${v.m} so far is ${v.dt} colder than usual`,
  monthNormal: (v) => `${v.m} so far is a pretty normal one`,
  frostNights: (v) => `The ${v.o} night in a row below freezing`,
  firstFrostSince: (v) => `First frost ${v.since}`,
  iceDays: (v) => `${v.n} days in a row that never got above freezing`,
  iceYesterday: () => "Yesterday never got above freezing",
  firstWarmSince: (v) => `First day above ${v.t} ${v.since}`,
  summerStreak: (v) => `The ${v.o} summer day (${v.t}+) in a row`,
  frostWinter: (v) =>
    `${v.n} frost night${v.n === "1" ? "" : "s"} so far this winter` +
    (v.n2 !== undefined ? ` (last winter by now: ${v.n2})` : ""),
  insideWarmer: (v) => `It's ${v.dt} warmer inside than outside`,
  pressureLowSince: (v) => `Air pressure dropped to ${v.n} mbar, the lowest ${v.since}`,
  pressureHighSince: (v) => `Air pressure reached ${v.n} mbar, the highest ${v.since}`,
  driestSince: (v) => `The air in ${v.name} is the driest ${v.since} (${v.n}%)`,
};

const factsSv: FactTexts = {
  lowSince: (v) => `Dagens lägsta temperatur, ${v.t}, är den kallaste ${v.since}`,
  highSince: (v) => `Dagens högsta temperatur, ${v.t}, är den varmaste ${v.since}`,
  coldestDaySince: (v) => `Igår var den kallaste dagen ${v.since}`,
  warmestDaySince: (v) => `Igår var den varmaste dagen ${v.since}`,
  sameAsYesterday: () => "Nästan exakt samma temperatur som den här tiden igår",
  warmerThanYesterday: (v) => `${v.dt} varmare än den här tiden igår`,
  colderThanYesterday: (v) => `${v.dt} kallare än den här tiden igår`,
  coldestDate: (v) => `Den kallaste ${v.md} på ${v.n} år`,
  warmestDate: (v) => `Den varmaste ${v.md} på ${v.n} år`,
  yearAgo: (v) => `För ett år sedan i dag var det mellan ${v.t} och ${v.t2}`,
  dateColdestWas: (v) => `Den kallaste ${v.md} hittills var ${v.y}: ${v.t}`,
  dateWarmestWas: (v) => `Den varmaste ${v.md} hittills var ${v.y}: ${v.t}`,
  coldestStart: (v) => `Den kallaste starten på ${v.m} på ${v.n} år`,
  warmestStart: (v) => `Den varmaste starten på ${v.m} på ${v.n} år`,
  monthWarmer: (v) => `${v.m} hittills är ${v.dt} varmare än vanligt`,
  monthColder: (v) => `${v.m} hittills är ${v.dt} kallare än vanligt`,
  monthNormal: (v) => `${v.m} har varit ganska normal hittills`,
  frostNights: (v) => `Den ${v.o} natten i rad med minusgrader`,
  firstFrostSince: (v) => `Första frosten ${v.since}`,
  iceDays: (v) => `${v.n} dagar i rad utan plusgrader`,
  iceYesterday: () => "Igår kom det aldrig över noll",
  firstWarmSince: (v) => `Första dagen över ${v.t} ${v.since}`,
  summerStreak: (v) => `Den ${v.o} sommardagen (${v.t}+) i rad`,
  frostWinter: (v) =>
    `${v.n} ${v.n === "1" ? "frostnatt" : "frostnätter"} hittills i vinter` +
    (v.n2 !== undefined ? ` (förra vintern vid den här tiden: ${v.n2})` : ""),
  insideWarmer: (v) => `Det är ${v.dt} varmare inne än ute`,
  pressureLowSince: (v) => `Lufttrycket föll till ${v.n} mbar, det lägsta ${v.since}`,
  pressureHighSince: (v) => `Lufttrycket steg till ${v.n} mbar, det högsta ${v.since}`,
  driestSince: (v) => `Luften i ${v.name} är den torraste ${v.since} (${v.n} %)`,
};

export function factText(id: string, v: FactVars): string | undefined {
  return (lang() === "sv" ? factsSv : factsEn)[id]?.(v);
}

/** "since 2 March", or "on record (since …)" when it has never happened before. */
export function sincePhrase(date: string, record: boolean): string {
  if (lang() === "sv") return record ? `någonsin (sedan ${date})` : `sedan ${date}`;
  return record ? `on record (since ${date})` : `since ${date}`;
}

export function ordinal(n: number): string {
  if (lang() === "sv") {
    // 1:a, 2:a, 3:e … 11:e, 12:e, 21:a, 22:a
    const last = n % 10;
    const lastTwo = n % 100;
    return `${n}:${(last === 1 || last === 2) && lastTwo !== 11 && lastTwo !== 12 ? "a" : "e"}`;
  }
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}
