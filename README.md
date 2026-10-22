# netatmo-viewer

A wall display for a Netatmo weather station, built for an old iPad (iOS 12 / Safari 12)
that can no longer run the Netatmo app.

- **Deno** server: talks to the Netatmo API, caches the latest reading, serves the page
- **Vue 3 + TypeScript** frontend, built with Vite and compiled down to Safari 12

Netatmo weather stations have no local API: they only upload to Netatmo's cloud. So the
server polls `api.netatmo.com` (every 5 min by default; the station itself only uploads about every
10 min), and the iPad only ever talks to your server.

## 1. Get Netatmo credentials

1. Log in at <https://dev.netatmo.com/apps> with your normal Netatmo account and
   **Create** an app (name and description can be anything).
2. On the app page, copy the **client ID** and **client secret**.
3. Further down, under **Token generator**, pick the scope `read_station`, click
   **Generate Token**, and copy the **refresh token**.

```sh
cp .env.example .env   # and fill in the three values
```

The refresh token is only needed for the first start. After that the server keeps the
current token in `/data/tokens.json` (a Docker volume). If it ever stops working, generate a
new one, put it in `.env` and restart the container.

## 2. Run it on the server

Copy `docker-compose.yml` and your `.env` to the server, then:

```sh
docker compose pull && docker compose up -d
```

The image (`ghcr.io/lambdan/netatmo-viewer`, amd64 + arm64) is built by GitHub Actions on every
push to `main` (`:latest`) and on `v*` tags (`:1.2.3`, `:1.2`). To build from source instead, swap
`image:` for `build: .` in the compose file.

Then open `http://<server-ip>:8080` on the iPad.

Without credentials (or with `DEMO=1`) it serves fake data, so you can check the
setup before doing the Netatmo part.

| Env var                  | Default  | Notes                                  |
| ------------------------ | -------- | -------------------------------------- |
| `NETATMO_CLIENT_ID`      |          | Leaving it empty enables demo mode     |
| `NETATMO_CLIENT_SECRET`  |          |                                        |
| `NETATMO_REFRESH_TOKEN`  |          | Initial token / fallback               |
| `POLL_SECONDS`           | `300`    | How often to ask Netatmo (min 60)      |
| `PORT`                   | `8080`   |                                        |
| `DEMO`                   |          | `1` = fake data                        |

## Local archive

Every measurement is also stored in a SQLite database at `/data/netatmo.sqlite` (the same volume as
the token), so you keep your history even if Netatmo goes down or starts charging for it.

- New readings (about every 5 minutes) are synced on each poll. After downtime, the server catches
  up on what it missed when it starts again.
- On first start, a background job copies **all** history back to the day the station was set up.
  It's throttled to stay well under Netatmo's rate limit, so a station that's a few years old takes
  several hours. It continues where it left off after a restart.
- `http://<server-ip>:8080/api/archive` shows rows, oldest/newest timestamp and backfill status per module.
- The 24h charts are drawn from the archive, so they keep working when Netatmo is unreachable.

Tables: `measurements` (one row per module and timestamp; temperature, humidity, co2,
pressure, noise, plus rain/wind columns), `modules` (names), `sync_state` (sync progress).
To take a consistent copy while it's running:

```sh
docker exec -u deno netatmo-viewer deno eval "import { DatabaseSync } from 'node:sqlite'; new DatabaseSync('/data/netatmo.sqlite').exec(\"VACUUM INTO '/data/backup.sqlite'\")"
docker cp netatmo-viewer:/data/backup.sqlite .
```

## 3. iPad setup

- In Safari: open the page → Share → **Add to Home Screen**. Launched from there, it runs
  full screen without the Safari toolbar.
- Settings → Display & Brightness → **Auto-Lock: Never**, and keep it plugged in.
- Optional: Settings → Accessibility → **Guided Access** keeps it locked to the app.

- Tap the ⚙ next to the station name to pick the theme: light during the day and dark at night
  (07:00–21:00 by default), or always light/dark. It's saved on the iPad itself. A home screen
  web app has its own storage separate from Safari, so set it from the home screen icon.

The page fetches new data every minute and reloads itself every 6 hours to stay healthy on old
Safari.

## Development

```sh
deno install
DEMO=1 deno task dev:server   # API on :8080
deno task dev                 # Vite on :5173, proxies /api to :8080
```

`deno task build` builds the frontend into `dist/`, and `deno task start` serves it on its own.
