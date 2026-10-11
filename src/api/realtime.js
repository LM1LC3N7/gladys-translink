// -----------------------------------------------------------------------------
// The operator's real-time feeds (GTFS-Realtime), read with the user's key.
//
// Two consequences of how they are served shape this module:
//
//   - the predictions come as ONE TripUpdates feed covering the whole network:
//     it is read once per refresh interval, decoded for every watched stop at
//     once, and each stop takes its share from that cache. Watching ten stops
//     costs exactly what watching one does;
//   - a bad key, a quota and a rate limit come back as HTTP errors: they are
//     turned into a bilingual message the user can act on
//     (`RealtimeApiError`), rather than a bare "HTTP 403".
//
// The key may travel in the URL (TransLink): no URL is ever logged whole.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { request } from './http.js';
import {
  decodeTripUpdates,
  STOP_SCHEDULE_RELATIONSHIP,
  TRIP_SCHEDULE_RELATIONSHIP,
} from './gtfsRealtime.js';
import { stopPlatformId } from '../config.js';
import { NETWORK } from '../network.js';
import { normalizeRoute, routeLabel, stopByCode } from './stops.js';
import { knownStop } from './transitous.js';

const logger = createLogger({ name: 'realtime' });

// A prediction this far in the past is a vehicle that has left: the feed keeps
// a stop time update for a short while after the vehicle served the stop.
const DEPARTED_GRACE_SECONDS = 30;

// A feed whose header is older than this is not real-time any more: the
// operator's side has stalled. It is still served (it is the best information
// there is), but the logs say so once.
const STALE_FEED_SECONDS = 10 * 60;

// A network without a real-time feed (RTC Québec) never reads one: the label
// only has to exist.
const KEY = NETWORK.realtime?.keyLabel ?? { en: 'API key', fr: 'clé d’API' };

/** Error of the operator's API, with the explanation the user can act on. */
export class RealtimeApiError extends Error {
  /**
   * @param {string} message technical message, for the logs
   * @param {{ status?: number, userMessage?: { en: string, fr: string } }} [details]
   */
  constructor(message, { status, userMessage } = {}) {
    super(message);
    this.name = 'RealtimeApiError';
    this.status = status;
    this.userMessage = userMessage;
  }
}

export const MISSING_KEY_MESSAGE = {
  en: `No ${KEY.en}: create one on the ${NETWORK.operator} developer portal and paste it in the configuration.`,
  fr: `Aucune ${KEY.fr} : créez-en une sur le portail développeurs de ${NETWORK.operator} et collez-la dans la configuration.`,
};

/**
 * Turn a refused request into a RealtimeApiError carrying what to do about it.
 * The body is matched loosely and never echoed whole: it is the operator's,
 * not ours.
 *
 * @param {number} status
 * @param {string} body
 * @param {string} feed the feed name, for the logs
 * @returns {RealtimeApiError}
 */
export function realtimeErrorFor(status, body, feed) {
  const text = String(body ?? '').toLowerCase();
  const message = `${NETWORK.operator} ${feed} feed answered HTTP ${status}`;
  if (text.includes('quota')) {
    return new RealtimeApiError(`${message} (quota)`, {
      status,
      userMessage: {
        en: `The quota of your ${KEY.en} is used up. Raise the refresh intervals.`,
        fr: `Le quota de votre ${KEY.fr} est épuisé. Augmentez les intervalles de rafraîchissement.`,
      },
    });
  }
  if (status === 429) {
    return new RealtimeApiError(`${message} (rate limited)`, {
      status,
      userMessage: {
        en: `${NETWORK.operator} is rate limiting requests right now: the next refresh will try again.`,
        fr: `${NETWORK.operator} limite les requêtes en ce moment : le prochain rafraîchissement réessaiera.`,
      },
    });
  }
  if (status === 401 || status === 403 || text.includes('key')) {
    return new RealtimeApiError(`${message} (key refused)`, {
      status,
      userMessage: {
        en: `${NETWORK.operator} refused the API key: check it on the developer portal (${NETWORK.realtime?.portal}).`,
        fr: `${NETWORK.operator} a refusé la clé d’API : vérifiez-la sur le portail développeurs (${NETWORK.realtime?.portal}).`,
      },
    });
  }
  return new RealtimeApiError(message, { status });
}

/**
 * GET one feed with the user's key, as bytes.
 *
 * @param {{ api_key: string }} config
 * @param {string} url
 * @param {string} feed the feed name, for the logs and the errors
 * @returns {Promise<Uint8Array>}
 */
export async function readFeed(config, url, feed) {
  if (!config.api_key) {
    throw new RealtimeApiError('No API key configured', { userMessage: MISSING_KEY_MESSAGE });
  }
  const authorized = NETWORK.realtime.authorize(url, config.api_key);
  let response;
  try {
    response = await request(authorized.url, {
      headers: { ...authorized.headers, Accept: 'application/x-protobuf' },
    });
  } catch (err) {
    // A network error message may quote the URL, and the URL may hold the key.
    throw new RealtimeApiError(
      `${NETWORK.operator} ${feed} feed unreachable: ${redact(err.message, config.api_key)}`,
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw realtimeErrorFor(response.status, body, feed);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * A text with the key masked: what may reach the logs.
 * @param {string} text
 * @param {string} key
 */
export function redact(text, key) {
  const value = String(text ?? '');
  return key ? value.split(key).join('***') : value;
}

// --- Departures --------------------------------------------------------------

/**
 * The decoded feed, shared by every stop for one refresh interval.
 * @type {{ at: number, key: string, stopTimes: object[], timestamp?: number } | null}
 */
let feedCache = null;
/** @type {{ key: string, promise: Promise<object> } | null} */
let feedInFlight = null;
let staleFeedReported = false;
let missingRouteReported = false;

/**
 * Every stop the integration polls: the typed ones, but also the suggested
 * ones and the devices created from a suggestion, which the configuration
 * does not list. The decoder keeps the stop time updates of these stops only,
 * so the device registry hands them over (src/devices/index.js).
 * @type {{ id: string }[]}
 */
let polledStops = [];

/** @param {{ id: string }[]} stops every stop the devices poll */
export function setPolledStops(stops) {
  polledStops = stops;
}

/** Forget the cached feed (configuration change, tests). */
export function clearRealtimeCache() {
  feedCache = null;
  feedInFlight = null;
  staleFeedReported = false;
  missingRouteReported = false;
  polledStops = [];
}

/** The GTFS stop_ids of the watched stop codes: what the decoder keeps. */
function watchedStopIds(stops) {
  const ids = new Set();
  for (const stop of stops) {
    for (const id of stopByCode(stop.id)?.ids ?? []) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * Read and decode the network feed for every watched stop.
 * @param {ReturnType<import('../config.js').normalizeConfig>} config
 * @param {{ id: string }[]} stops
 */
async function readTripUpdates(config, stops) {
  const buffer = await readFeed(config, NETWORK.realtime.tripUpdatesUrl, 'TripUpdates');
  const stopIds = watchedStopIds(stops);
  const decoded = decodeTripUpdates(buffer, stopIds);
  logger.debug(
    `TripUpdates: ${buffer.length} bytes, ${decoded.stopTimes.length} stop time(s) ` +
      `for ${stopIds.length} watched stop id(s)`,
  );
  return decoded;
}

/**
 * The decoded feed, read at most once per refresh interval whatever the
 * number of stops asking, and once for concurrent askers.
 *
 * @param {ReturnType<import('../config.js').normalizeConfig>} config
 * @param {{ now?: number, fresh?: boolean, stops?: { id: string }[] }} [options]
 *   `fresh` skips the cache (the connection test must reach the API, not the
 *   last poll); `stops` the stops to decode (every polled one)
 */
export async function getTripUpdates(
  config,
  { now = Date.now(), fresh = false, stops = [...config.watched.stops, ...polledStops] } = {},
) {
  const key = `${config.api_key}\u0000${watchedStopIds(stops).join(',')}`;
  // A tenth of the interval of tolerance, like the poll schedule: the poll of
  // the last stop of a cycle must not trigger a second read of the feed.
  const maxAgeMs = config.departures_poll_frequency * 1000 * 0.9;
  if (!fresh && feedCache && feedCache.key === key && now - feedCache.at < maxAgeMs) {
    return feedCache;
  }
  if (!fresh && feedInFlight && feedInFlight.key === key) {
    return feedInFlight.promise;
  }
  const promise = readTripUpdates(config, stops)
    .then((decoded) => {
      feedCache = { at: now, key, ...decoded };
      return feedCache;
    })
    .finally(() => {
      if (feedInFlight?.promise === promise) {
        feedInFlight = null;
      }
    });
  feedInFlight = { key, promise };
  return promise;
}

/**
 * The upcoming departures of one watched stop, soonest first, route filter
 * applied.
 *
 * A departure is a stop time update of the feed for one of the stop's
 * stop_ids, from a trip that is not cancelled, which the vehicle does not
 * skip, and which carries a time. The route comes from the trip's route_id
 * (the stop table names it); a feed that omits it is completed from the trips
 * Transitous saw at the stop, which also give the direction.
 *
 * @param {{ stopTimes: object[] }} feed
 * @param {{ id: string, routes: string[] }} stop
 * @param {number} nowSeconds POSIX time
 * @returns {{ route: string, headsign: string, tripId: string | undefined,
 *   directionId: number | undefined, time: number, minutes: number,
 *   delaySeconds: number | undefined, realtime: boolean }[]}
 */
export function departuresFromFeed(feed, stop, nowSeconds) {
  const ids = new Set(stopByCode(stop.id)?.ids ?? []);
  const trips = knownStop(stop.id)?.trips;
  const departures = [];
  for (const stopTime of feed.stopTimes) {
    if (!ids.has(stopTime.stopId)) continue;
    if (stopTime.tripScheduleRelationship === TRIP_SCHEDULE_RELATIONSHIP.CANCELED) continue;
    if (stopTime.scheduleRelationship === STOP_SCHEDULE_RELATIONSHIP.SKIPPED) continue;
    const event = stopTime.departure?.time ? stopTime.departure : stopTime.arrival;
    if (!event?.time) continue;
    if (event.time < nowSeconds - DEPARTED_GRACE_SECONDS) continue;
    const seen = trips?.get(stopTime.tripId);
    const route = routeLabel(stopTime.routeId) ?? seen?.route ?? '';
    if (!route && !missingRouteReported) {
      missingRouteReported = true;
      logger.warn('The real-time feed names no route for some trips: they show without a route.');
    }
    if (stop.routes.length > 0 && !stop.routes.includes(normalizeRoute(route))) continue;
    departures.push({
      route,
      headsign: seen?.headsign ?? '',
      tripId: stopTime.tripId,
      directionId: stopTime.directionId,
      time: event.time,
      minutes: Math.max(0, Math.floor((event.time - nowSeconds) / 60)),
      delaySeconds: event.delay,
      realtime: true,
    });
  }
  return departures.sort((a, b) => a.time - b.time);
}

/**
 * The upcoming departures of one watched stop (see `departuresFromFeed`).
 *
 * @param {ReturnType<import('../config.js').normalizeConfig>} config
 * @param {{ id: string, routes: string[] }} stop
 * @param {{ now?: number, stops?: { id: string }[] }} [options]
 */
export async function fetchDepartures(config, stop, { now = Date.now(), stops } = {}) {
  const watched = stops ?? [...config.watched.stops, ...polledStops, stop];
  const feed = await getTripUpdates(config, { now, stops: watched });
  const nowSeconds = Math.floor(now / 1000);
  if (feed.timestamp && nowSeconds - feed.timestamp > STALE_FEED_SECONDS && !staleFeedReported) {
    staleFeedReported = true;
    logger.warn(
      `The ${NETWORK.operator} feed is ${Math.round((nowSeconds - feed.timestamp) / 60)} minutes ` +
        'old: the predictions may be out of date.',
    );
  }
  const departures = departuresFromFeed(feed, stop, nowSeconds);
  logger.debug(`Stop ${stopPlatformId(stop)}: ${departures.length} departure(s)`);
  return departures;
}
