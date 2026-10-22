# netatmo-viewer

A wall display for a Netatmo weather station, built for an old iPad (iOS 12 / Safari 12)
that can no longer run the Netatmo app.

- **Deno** server: talks to the Netatmo API, archives every measurement in **Postgres**, serves
  the page
- **Vue 3 + TypeScript** frontend, built with Vite and compiled down to Safari 12

Netatmo weather stations have no local API: they only upload to Netatmo's cloud. So the
server polls `api.netatmo.com` (every 5 min by default; the station itself only uploads about every
10 min), and the iPad only ever talks to your server.

## 1. Start it on the server

Copy `docker-compose.yml` to the server, then:

```sh
docker compose pull && docker compose up -d
```

This starts the viewer and a Postgres 17 container for the archive (data in the `netatmo-pg`
volume). If you set `POSTGRES_PASSWORD` in `.env`, do it before the first start; Postgres only
reads it when it creates the database. To use a Postgres you already run, set `DATABASE_URL` in `.env`
and remove the `db` service (and `depends_on`) from the compose file.

The image (`ghcr.io/lambdan/netatmo-viewer`, amd64 + arm64) is built by GitHub Actions on every
push to `main` (`:latest`) and on `v*` tags (`:1.2.3`, `:1.2`). To build from source instead, swap
`image:` for `build: .` in the compose file.

## 2. Connect your Netatmo account

Open `http://<server-ip>:8080` (from a computer is easiest, there's some copy and paste) and follow
the steps on the page:

1. Log in at <https://dev.netatmo.com/apps> with your normal Netatmo account and **create an
   app** (name and description can be anything).
2. Copy the app's **client ID** and **client secret**.
3. Under **Token generator**, pick the scope `read_station`, click **Generate Token**, and copy
   the **refresh token**.

The server checks them with Netatmo and stores them in the database. After that the form is closed,
so nobody else on your network can change the account. It only comes back if Netatmo stops accepting the
login (e.g. the token was revoked).

Prefer config files? Set `NETATMO_CLIENT_ID`, `NETATMO_CLIENT_SECRET` and
`NETATMO_REFRESH_TOKEN` in `.env` instead, and the setup page is skipped.

With `DEMO=1` it serves made-up data from an in-memory Postgres (PGlite), no account or database
needed.

| Env var                  | Default  | Notes                                  |
| ------------------------ | -------- | -------------------------------------- |
| `NETATMO_CLIENT_ID`      |          | Optional, instead of the setup page    |
| `NETATMO_CLIENT_SECRET`  |          | Optional, instead of the setup page    |
| `NETATMO_REFRESH_TOKEN`  |          | Optional, instead of the setup page    |
| `DATABASE_URL`           |          | `postgres://user:pass@host:5432/db`; the compose file sets it |
| `POSTGRES_PASSWORD`      | `netatmo`| For the bundled `db` service           |
| `POLL_SECONDS`           | `300`    | How often to ask Netatmo (min 60)      |
| `PORT`                   | `8080`   |                                        |
| `DEMO`                   |          | `1` = fake data                        |

## Archive

Every measurement is also stored in Postgres, so you keep your history even if Netatmo goes down
or starts charging for it.

- New readings (about every 5 minutes) are synced on each poll. After downtime, the server catches
  up on what it missed when it starts again.
- On first start, a background job copies **all** history back to the day the station was set up.
  It's throttled to stay well under Netatmo's rate limit, so a station that's a few years old takes
  several hours. It continues where it left off after a restart.
- `http://<server-ip>:8080/api/archive` shows rows, oldest/newest timestamp and backfill status per module.
- The 24h charts are drawn from the archive, so they keep working when Netatmo is unreachable.
- Tap a card (or **History ›**) to browse the archive: day/week/month/year charts with
  min–max bands, records (coldest/warmest today, this month, this year, ever), and a **Years**
  view comparing monthly averages year over year. It goes back to the live view after 3
  minutes without a touch.

Tables (created automatically):

- `measurements`: one row per module and `ts` (`timestamptz`) with `temperature`, `humidity`,
  `co2`, `pressure`, `noise`, plus rain/wind columns. Ready for Grafana or plain SQL.
- `modules`: names and kinds. `sync_state`: sync/backfill progress. `settings`: the Netatmo tokens.

Backup:

```sh
docker exec netatmo-db pg_dump -U netatmo -Fc netatmo > netatmo.dump
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
DEMO=1 deno task dev:server   # API on :8080, in-memory demo database
deno task dev                 # Vite on :5173, proxies /api to :8080
```

For live data locally, start a Postgres and point `DATABASE_URL` at it:

```sh
docker run -d --name netatmo-pg -e POSTGRES_PASSWORD=netatmo -p 5432:5432 postgres:17
DATABASE_URL=postgres://postgres:netatmo@localhost:5432/postgres deno run --env-file=.env -A --watch server/main.ts
```

`deno task typecheck` type-checks the Vue app, `deno task check` the server.
`deno task build` builds the frontend into `dist/`, and `deno task start` serves it on its own.
