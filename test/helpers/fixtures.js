// -----------------------------------------------------------------------------
// Payloads shared by the suites. The GBFS ones follow the live Mobi feed
// (GBFS 2.2, true booleans, e-bikes counted by vehicle type); the Transitous
// ones follow api.transitous.org (trimmed to the fields the integration
// reads); the alerts are GTFS-Realtime, encoded by the test encoder.
//
// Stops are network landmarks of the stop table (gtfs/stops.json):
//   50040  Waterfront Station @ Bay 2        (stop_id 40)
//   61925  Waterfront Station                 (station 12034 and its platforms)
// -----------------------------------------------------------------------------

import { GBFS_URL } from '../../src/api/bikes.js';
import { NETWORK } from '../../src/network.js';
import { encodeFeed } from './gtfsRealtimeEncoder.js';

const feeds = (lang) => [
  { name: 'station_information', url: `https://gbfs.example/${lang}/station_information.json` },
  { name: 'station_status', url: `https://gbfs.example/${lang}/station_status.json` },
  { name: 'vehicle_types', url: `https://gbfs.example/${lang}/vehicle_types.json` },
];

export const DISCOVERY = {
  ttl: 60,
  version: '2.2',
  data: { en: { feeds: feeds('en') }, fr: { feeds: feeds('fr') } },
};

export const INFORMATION = {
  data: {
    stations: [
      // Around the corner from Waterfront Station, the house of the fake Gladys.
      {
        station_id: '0021',
        name: 'Cordova & Granville',
        capacity: 20,
        lat: 49.2855,
        lon: -123.1125,
      },
      // 600 m away: within the 1 km radius.
      { station_id: '0201', name: 'Rogers Tower', capacity: 18, lat: 49.288682, lon: -123.11818 },
      // Commercial Drive, 4 km away: beyond the radius.
      {
        station_id: '0300',
        name: 'Commercial & Venables',
        capacity: 25,
        lat: 49.2763,
        lon: -123.0695,
      },
    ],
  },
};

export const STATUS = {
  data: {
    stations: [
      {
        station_id: '0021',
        num_bikes_available: 8,
        num_docks_available: 12,
        is_installed: true,
        is_renting: true,
        is_returning: false,
        last_reported: 1791644363,
        vehicle_types_available: [
          { vehicle_type_id: '1', count: 6 },
          { vehicle_type_id: '2', count: 2 },
        ],
      },
      { station_id: '0201', num_bikes_available: 0, num_docks_available: 18, is_installed: false },
      { station_id: '0300', num_bikes_available: 4, num_docks_available: 21, is_installed: true },
    ],
  },
};

export const VEHICLE_TYPES = {
  data: {
    vehicle_types: [
      { vehicle_type_id: '1', form_factor: 'bicycle', propulsion_type: 'human' },
      { vehicle_type_id: '2', form_factor: 'bicycle', propulsion_type: 'electric_assist' },
    ],
  },
};

export function bikeRoutes() {
  return {
    [GBFS_URL]: DISCOVERY,
    '/station_information.json': INFORMATION,
    '/station_status.json': STATUS,
    '/vehicle_types.json': VEHICLE_TYPES,
  };
}

// --- Service alerts ------------------------------------------------------------

/** The route_id of a line of NETWORK.lines. */
export const routeOf = (lineId) => NETWORK.lines.find((line) => line.id === lineId).routeIds[0];

/** An alert about a whole line. */
export function lineAlert(
  lineId,
  text = 'Expo Line: no service between two stations.',
  extra = {},
) {
  return {
    effect: 1, // NO_SERVICE
    informedEntities: [{ agencyId: 'TL', routeId: routeOf(lineId) }],
    headerText: [{ text, language: 'en' }],
    ...extra,
  };
}

/** An alerts feed, encoded. */
export function alertsFeed(alerts = [], timestamp = 1_760_100_000) {
  return encodeFeed({
    timestamp,
    entities: alerts.map((alert, index) => ({ id: `alert-${index}`, alert })),
  });
}

// --- Transitous ---------------------------------------------------------------

/**
 * /v5/stoptimes for one stop: departures `minutes` from `now` (ms). The
 * default route is the 50 (route_id 6637), leaving from bay 2 (stop_id 40).
 */
export function stopTimesPayload(now, entries) {
  const iso = (ms) => new Date(ms).toISOString();
  const prefix = NETWORK.transitousPrefix;
  return {
    stopTimes: entries.map(
      (
        {
          minutes,
          routeId = '6637',
          shortName = '050',
          headsign = '50 False Creek South',
          stopId = '40',
          delayMinutes = 0,
          cancelled = false,
          realTime = false,
          pickupType = 'NORMAL',
        },
        index,
      ) => ({
        place: {
          name: 'Waterfront Station @ Bay 2',
          stopId: `${prefix}${stopId}`,
          departure: iso(now + (minutes + delayMinutes) * 60_000),
          scheduledDeparture: iso(now + minutes * 60_000),
          pickupType,
        },
        realTime,
        headsign,
        tripId: `20261011_04:31_${prefix}T${index}`,
        routeId: `${prefix}${routeId}`,
        routeShortName: shortName,
        cancelled,
        tripCancelled: false,
      }),
    ),
  };
}
