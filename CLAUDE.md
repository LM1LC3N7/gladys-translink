# CLAUDE.md

Guidance for Claude Code (and any other contributor) working in this repository.

## What this project is

An **external Gladys Assistant integration** for Metro Vancouver public
transit (TransLink). It runs as a Docker container next to a Gladys instance,
talks to Gladys through the official SDK (`@gladysassistant/integration-sdk`),
and publishes **read-only** devices: one per watched stop, one for the line
status (SkyTrain, SeaBus, West Coast Express), one per watched Mobi station.

Not affiliated with TransLink nor with Mobi. Data: the TransLink static GTFS
(shipped as a stop table in `gtfs/`), the TransLink GTFS-Realtime feeds
(personal key, `apikey` query parameter), the open Mobi GBFS feed, and
Transitous (keyless: departures and stop descriptions).

**Design goal: usable by somebody who is not technical.** Nothing to type to
start: the house location (`location: true`) gives the suggested stops and
stations, the key is optional, and the connection status line
(`src/status.js`) always says what to do next. Keep it that way: every new
setting needs a default that works, and every failure a message that says what
to do.

**Sister integrations.** `gladys-translink` (Vancouver), `gladys-octranspo`
(Ottawa) and `gladys-rtc-quebec` (Québec) share this code base, derived from
`gladys-stm` (Montréal). Everything that names the network lives in
`src/network.js`, its data in `gtfs/`, its texts in the manifest and the docs:
the rest of the code is identical in the three repositories, and a fix to it
belongs in the three (and in gladys-stm when it applies there).

## Commands

```bash
npm ci
npm test               # node --test, no framework, no network access
npm run lint           # eslint
npm run format         # prettier --write .
npm run format:check   # what CI checks
npm run update-stops   # regenerate gtfs/ from the TransLink static GTFS (network)
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `npm test`, `npm run lint` and `npm run format:check` before every commit:
CI (`.github/workflows/ci.yml`) runs the three. The CI minutes are counted:
batch the pushes (one push a day at most, unless asked otherwise).

## Layout

```
index.js                      SDK wiring only: handlers, connect, status
src/network.js                the network: operator, feeds, key, lines, bike share
src/config.js                 defaults, type coercion, watch-list mini-syntax, request estimate
src/api/http.js               fetch with timeout and User-Agent
src/api/stops.js              the stop table (gtfs/): code → stop_ids, search, nearby, route labels
src/api/gtfsRealtime.js       minimal GTFS-Realtime decoder (watched stops only; alerts)
src/api/realtime.js           operator feeds with the key: departures, shared feed cache, errors
src/api/lines.js              line status from the service alerts
src/api/bikes.js              bike share GBFS client, per-cycle cache, station search
src/api/transitous.js         Transitous: departures of a stop code, descriptions
src/status.js                 the connection status line: what the user must do next
src/devices/index.js          device registry (typed + suggested + created) + manifest actions
src/devices/suggestions.js    the stops and bike stations closest to the house
src/devices/stop.js           one device per watched stop
src/devices/lineStatus.js     the line status device
src/devices/bikeStation.js    one device per watched bike station
src/devices/pollSchedule.js   drops the poll ticks inside the configured interval
src/devices/stateCache.js     drops the states that did not move since the last read
src/devices/publish.js        publishes only to the features the created device has
src/devices/readings.js       last reading per device, shared with the widgets
src/devices/refreshLoop.js    the container's own ticker over the created devices
src/scenes/triggers.js        scene events, computed between two polls of a device
src/scenes/actions.js         scene actions: a fresh read handed to the scene
src/widgets/index.js          dashboard widgets
scripts/update-stops.mjs      generates gtfs/ from the static GTFS (ZIP + CSV, no dependency)
gtfs/                         the stop table, shipped with the image
test/                         node:test suites; helpers: fake SDK, fetch stub, GTFS-RT encoder, fixtures
docs/en.md, docs/fr.md        user documentation (re-hosted by Gladys)
gladys-assistant-integration.json   the store manifest
```

Keep the separation: `index.js` holds no transit logic, `src/api/` only reads
the sources, `src/devices/` only turns a reading into features, `src/scenes/`
and `src/widgets/` only turn a blueprint's `read` into events, outputs and
cards.

## Data sources: what is known and how

- **Stop codes**: riders know the 5-digit number on the sign ("Stop #50040"),
  the feeds speak GTFS `stop_id`, an unrelated internal number (checked on the
  static GTFS of 2026-10: 8,741 codes, none equal to its id). A SkyTrain
  station (`location_type` 1) has a code too: it stands for its platforms.
  `gtfs/stops.json` holds `[code, name, lat, lon, ids, query]`, where `ids`
  are the stop_ids of the real-time feed and `query` the ids to ask
  Transitous.
- **Routes**: `route_id` is internal (`6637` is the 50); short names carry
  leading zeros (`050`), the SkyTrain lines have none (long name "Canada
  Line"). `gtfs/routes.json` maps an id to the label riders use; filters
  compare `normalizeRoute` values (upper case, no leading zeros).
- **Real time**: `https://gtfsapi.translink.ca/v3/gtfsrealtime?apikey=` and
  `/v3/gtfsalerts?apikey=`; a bad key answers HTTP 403 with an empty body.
  The key is in the URL: never log a URL whole (`redact`). The TripUpdates
  shape was not checked with a real key yet: if a trip lacks `route_id`, the
  route is taken from the trips Transitous saw at the stop.
- **The decoder** (`src/api/gtfsRealtime.js`) was cross-checked against the
  official `gtfs-realtime-bindings` 2.2.0 in both directions, for the trip
  updates (gladys-stm) and for the alerts. Re-run such a check if you touch
  the wire-format code.
- **Line status**: no alert on a line is normal service. An alert counts for a
  line when an informed entity names its `route_id` without a `stop_id`;
  accessibility alerts are ignored. NO_SERVICE, REDUCED_SERVICE,
  SIGNIFICANT_DELAYS (or a SEVERE severity) disrupt; any other effect is a
  notice.
- **Mobi**: GBFS 2.2 (`gbfs.kappa.fifteen.eu`), station ids are strings with
  leading zeros (`0201`), true booleans, no `num_ebikes_available`: the e-bikes
  are the `vehicle_types_available` whose `propulsion_type` is electric.
- **Transitous**: ids are `ca-bc-TransLink_<stop_id>`. `/v5/stoptimes`
  answers for a whole station group (the bus bays around a SkyTrain
  station): the departures are filtered on the code's own stop_ids. It has
  TransLink real time for some trips (`realTime: true`). Usage policy:
  open-source non-commercial, User-Agent with a contact, stay light — keep the
  caches and the 120 s floor (`MIN_SCHEDULE_POLL_FREQUENCY`).

## Conventions

- ES modules, Node >= 22, no runtime dependency besides the SDK. Do not add
  one without a strong reason (the 256 MB sandbox is why the GTFS-RT decoder is
  hand-written).
- Prettier decides formatting; ESLint decides the rest.
- Comments explain **why**, in full sentences, in English.
- Every user-visible string in the manifest, actions and widgets is bilingual
  (`{ en, fr }`); text features follow the `language` setting.
- **External ids, feature keys, manifest keys are forever**: Gladys keys the
  devices, their history, the scenes and the dashboards on them. The line ids
  of `src/network.js` are feature keys.
- **Created devices** are rebuilt from their params (`stop_code`, `routes`,
  `station_id`): never rename those params.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json` / the manifest, nor the `docker_image` tag, by hand.
- **Changelog**: every user-visible change adds a line under
  `## [Unreleased]` in `CHANGELOG.md`.
- **Never commit an API key**, nor a personal stop: use network landmarks in
  examples and tests (Waterfront Station: 50040, 61925; UBC Exchange Bay 7:
  61935; Mobi 0201 Rogers Tower).
- Tests never touch the network: `test/helpers/stubFetch.js` routes `fetch`.
  They do read the real `gtfs/` table: a regeneration that drops a landmark
  shows there.

## Roadmap ideas

- Check the TripUpdates and alerts payloads with a real key, and keep a
  captured sample as a fixture.
- Ask the Transitous team for an explicit OK before the integration gets many
  users (their policy asks to be contacted for heavy use).
- Screenshots in the user documentation.
