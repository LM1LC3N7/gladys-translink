// -----------------------------------------------------------------------------
// The transit network this integration serves: TransLink, Metro Vancouver.
//
// Everything that names the operator, its feeds or its lines lives here, so
// the rest of the code reads "the network", "the bike share", "the lines" —
// and the sister integrations (OC Transpo, RTC Québec) differ from this one
// by this file, their gtfs/ folder and their texts, not by their logic.
// -----------------------------------------------------------------------------

export const NETWORK = {
  /** The operator, as riders call it. */
  operator: 'TransLink',
  /** The device names start with it: "TransLink – Granville Station @ Platform 1". */
  stopPrefix: 'TransLink – ',
  /** The language of the texts when the user did not choose one. */
  defaultLanguage: 'en',

  /**
   * The static GTFS the stop table (gtfs/stops.json, gtfs/routes.json) is
   * generated from, by `npm run update-stops`.
   */
  gtfs: {
    url: 'https://gtfs-static.translink.ca/gtfs/google_transit.zip',
    // The stop name riders see on the sign: "Westbound Davie St @ Bidwell St".
    stopName: (row) => row.stop_name,
  },

  /** Transitous ids are the GTFS ids behind this prefix: `ca-bc-TransLink_40`. */
  transitousPrefix: 'ca-bc-TransLink_',

  /**
   * The operator's real-time feeds (GTFS-Realtime v3), with the user's key.
   * TransLink takes the key in the query string, not in a header: the URL is
   * therefore never logged whole (see `redact` in src/api/realtime.js).
   */
  realtime: {
    keyLabel: { en: 'TransLink API key', fr: 'clé d’API TransLink' },
    portal: 'https://developer.translink.ca',
    tripUpdatesUrl: 'https://gtfsapi.translink.ca/v3/gtfsrealtime',
    alertsUrl: 'https://gtfsapi.translink.ca/v3/gtfsalerts',
    /**
     * The request of one feed with the key.
     * @param {string} url
     * @param {string} key
     */
    authorize: (url, key) => ({ url: `${url}?apikey=${encodeURIComponent(key)}`, headers: {} }),
  },

  /**
   * The rapid transit lines whose service alerts make the "lines" device: one
   * status per line, from the GTFS-Realtime alerts. `routeIds` are the GTFS
   * route_id values of gtfs/routes.json. The `id` keys are forever: Gladys
   * keys the features, the history and the scenes on them.
   */
  lines: [
    { id: 'expo', routeIds: ['30053'], name: { en: 'Expo Line', fr: 'Ligne Expo' } },
    {
      id: 'millennium',
      routeIds: ['30052'],
      name: { en: 'Millennium Line', fr: 'Ligne Millennium' },
    },
    { id: 'canada', routeIds: ['13686'], name: { en: 'Canada Line', fr: 'Ligne Canada' } },
    { id: 'seabus', routeIds: ['6771'], name: { en: 'SeaBus', fr: 'SeaBus' } },
    {
      id: 'wce',
      routeIds: ['6770'],
      name: { en: 'West Coast Express', fr: 'West Coast Express' },
    },
  ],
  /** "SkyTrain" in the device and widget names. */
  linesName: { en: 'SkyTrain and SeaBus', fr: 'SkyTrain et SeaBus' },

  /** The bike share, read from its open GBFS feed. */
  bike: {
    name: 'Mobi',
    prefix: 'Mobi – ',
    gbfsUrl: 'https://gbfs.kappa.fifteen.eu/gbfs/2.2/mobi/en/gbfs.json',
  },

  /** The search example of the "Find a stop" answers: a network landmark. */
  examples: { search: 'Granville Station' },
};
