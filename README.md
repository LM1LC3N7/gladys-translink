# Gladys TransLink Vancouver

External integration for [Gladys Assistant](https://gladysassistant.com) that
brings Metro Vancouver public transit into your smart home:

- **next TransLink departures** (bus, SkyTrain, SeaBus, West Coast Express):
  out of the box from the free Transitous service, official real time with a
  free TransLink key;
- **status of the SkyTrain lines** (Expo, Millennium, Canada), the SeaBus and
  the West Coast Express, from the TransLink service alerts;
- **Mobi stations**: bikes, e-bikes and free docks (open GBFS feed, no key).

**Zero configuration to start:** the integration reads the location of the
house from Gladys and offers the closest stops and Mobi stations in the
Discover tab, named the way people know them ("TransLink – Waterfront Station
@ Bay 2 (50 → False Creek South)"). No account, no number to look up.

Unofficial: not affiliated with TransLink nor with Mobi by Rogers.

User documentation: [français](docs/fr.md) · [English](docs/en.md).

## What you get in Gladys

| Kind                  | Content                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| Devices               | one per stop (minutes to wait, route, summary), one for the lines (status + message per line), one per station |
| Dashboard widgets     | departures board, line status, Mobi station                                                                    |
| Scene triggers        | departure approaching (1–15 min), line disrupted / restored / notice, Mobi station empty / full                |
| Scene actions         | read the next departures of a stop, read the status of a line                                                  |
| Configuration buttons | test the TransLink API key, find a stop or a Mobi station by name                                              |

Requires Gladys **5.1.0** or later.

| Without any account                                                                  | With a free TransLink key                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------- |
| departures from Transitous (timetable, real time where it has it), Mobi, stop search | official real-time predictions, line status |

The key comes from the [TransLink developer portal](https://developer.translink.ca).
One read of the real-time feed serves every stop: about 2,200 requests a day
with the default settings, whatever the number of stops. The user
documentation has a step-by-step guide.

## How it works

- **The stop table** (`gtfs/stops.json`, `gtfs/routes.json`) is generated from
  the TransLink static GTFS by `npm run update-stops` and ships with the
  image. It turns the number on the sign into the GTFS stop ids the feeds use,
  and answers the stop search and the "near my home" suggestions without any
  request. Regenerate it before a release when TransLink adds stops.
- **Departures**: the TransLink GTFS-Realtime TripUpdates with a key (one read
  per interval, decoded for the watched stops only by a hand-written decoder),
  Transitous without one.
- **Line status**: the TransLink GTFS-Realtime service alerts.

## Development

```bash
npm install
npm test               # node --test, no network access
npm run lint           # ESLint
npm run format:check   # Prettier, as the CI runs it
npm run update-stops   # regenerate gtfs/ from the TransLink static GTFS
npx github:GladysAssistant/integration-store .   # store admission checks
```

The project follows the official
[integration template](https://github.com/GladysAssistant/integration-template-js):
Node 22+, ES modules, the Gladys SDK as the only runtime dependency, a Docker
image published to GHCR by the Release workflow. It shares its code with
[gladys-stm](https://github.com/LM1LC3N7/gladys-stm),
[gladys-octranspo](https://github.com/LM1LC3N7/gladys-octranspo) and
[gladys-rtc-quebec](https://github.com/LM1LC3N7/gladys-rtc-quebec): the
network lives in `src/network.js`. See [CLAUDE.md](CLAUDE.md) for the
architecture and the conventions.

### Publishing a version

1. In GitHub: **Actions → Release → Run workflow**. Choose **minor** for the
   first release (0.0.0 → 0.1.0), then patch / minor / major. It bumps the
   version everywhere, rolls the changelog, tags, builds the multi-arch image
   (`linux/amd64`, `linux/arm64`) and creates the GitHub Release.
2. The first time only: make the GHCR package **public**
   (`github.com/LM1LC3N7/gladys-translink/pkgs/container/gladys-translink` →
   Package settings → Change visibility). The store refuses an image it cannot
   pull.
3. Add the topic `gladys-assistant-integration` to the repository: the store
   indexer picks the integration up within the hour.

## Data and licences

- Stop list and real-time data: TransLink open data, under the TransLink
  [terms of use](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources).
- Departures without a key: [Transitous](https://transitous.org/sources/)
  (free community service; the integration sends a User-Agent naming it,
  caches every description and never reads departures more than every two
  minutes).
- Mobi data: public GBFS feed of Mobi by Rogers.
- Code: Apache License 2.0. Parts of `src/devices/` are adapted from
  [prohand/gladys-transport-commun-lyonnais](https://github.com/prohand/gladys-transport-commun-lyonnais)
  (Apache-2.0), see [NOTICE](NOTICE).
