# Structured itinerary contract v1.0

This document is the human-readable reference for the structured-itinerary map contract. The canonical definitions are:

- [`itinerary.schema.json`](../.github/extensions/structured-itinerary-map/itinerary.schema.json) for itinerary documents
- [`open-input.schema.json`](../.github/extensions/structured-itinerary-map/open-input.schema.json) for the canvas open envelope
- [`validation.mjs`](../.github/extensions/structured-itinerary-map/validation.mjs) for semantic rules that JSON Schema cannot express

Version `1.0` is strict. Every schema-defined object rejects unknown properties. Place and activity `url` values accept absolute HTTP or HTTPS URLs; executable and local-file schemes are invalid.

## Canvas open input

Open canvas type `structured-itinerary-map` with a caller-chosen `instanceId` and an input object:

| Field | Required | Contract |
|---|---:|---|
| `documentId` | Yes | Stable document identity. Uses the [identifier](#shared-primitives) format. It identifies the itinerary independently of the panel that displays it and is returned by actions and loopback state endpoints. |
| `itinerary` | Exactly one source | A complete inline [itinerary document](#itinerary-document). |
| `itineraryPath` | Exactly one source | Project-relative JSON file path, at most 500 characters. It must end in lowercase `.json`, must not be absolute or drive-qualified, and must not contain a `..` path segment or resolve outside the project root. The resolved target must be a regular file no larger than 1 MiB; symlinks may not escape the real project root. |
| `initialFocus` | No | Object containing `locationId`, `dayId`, or both. `{}` explicitly requests the trip overview. IDs must exist; when both are supplied, the day must include the location in `locationIds`. No unknown fields. |

`instanceId` is not part of this JSON envelope. It is a transient runtime handle for one visible canvas panel. Multiple panels may show the same `documentId`, and reopening or replacing a panel must not change the itinerary's domain identity. The extension keeps only live panel state in memory; `documentId` does not by itself persist an inline document.

The extension also checks the exactly-one source rule itself rather than relying only on host JSON Schema support. Reopening an existing provider instance increments a state revision and uses a cache-busting URL; already connected clients are instructed to reload, so the rendered document, actions, and loopback state converge on the same revision.

The on-disk `open-input.schema.json` uses a relative `$ref` to `itinerary.schema.json`. External validators must load it with the schema file's directory as the base URI and make the sibling itinerary schema available. The extension's runtime registration instead bundles the itinerary schema into `$defs`, so host validation is self-contained.

The itinerary schema identifies version 1.0 with the intentionally non-resolvable URI `urn:trip-planner:itinerary:1.0`; no public repository URL is implied.

Validate a project-contained itinerary against both canonical layers:

```powershell
npm run validate:itinerary -- itineraries\<trip-id>.json
```

The command exits nonzero for path, access, size, JSON, schema, or semantic failures. Add `--json` for structured output.

### Open by project path

```json
{
  "documentId": "asia-sampler",
  "itineraryPath": "examples/sample-itinerary.json",
  "initialFocus": {
    "locationId": "hanoi"
  }
}
```

### Open inline

```json
{
  "documentId": "quiet-day",
  "itinerary": {
    "schemaVersion": "1.0",
    "trip": {
      "id": "quiet-day",
      "title": "Quiet day",
      "startDate": "2026-09-14",
      "endDate": "2026-09-14"
    },
    "locations": [
      {
        "id": "seattle",
        "name": "Seattle",
        "timezone": "America/Los_Angeles",
        "coordinates": {
          "latitude": 47.6062,
          "longitude": -122.3321
        }
      }
    ],
    "places": [],
    "days": [
      {
        "id": "arrival-day",
        "date": "2026-09-14",
        "title": "Arrival and rest",
        "locationIds": ["seattle"],
        "activities": [
          {
            "id": "unpack",
            "name": "Unpack and rest",
            "kind": "rest",
            "category": "rest",
            "startTime": "16:00"
          }
        ]
      }
    ]
  },
  "initialFocus": {
    "dayId": "arrival-day"
  }
}
```

## Shared primitives

| Primitive | Contract |
|---|---|
| Identifier | String matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`: 1–128 characters, starting alphanumeric, then alphanumerics, `.`, `_`, or `-`. |
| Category key | String matching `^[a-z][a-z0-9-]{0,31}$`: 1–32 lowercase characters, starting with a letter. |
| Date | String formatted `YYYY-MM-DD`. Semantic validation also requires a real Gregorian calendar date. |
| Local datetime | String formatted `YYYY-MM-DDTHH:mm`, with a 24-hour time and no offset or zone suffix. Its timezone comes from the relevant endpoint location. |
| Activity time | String formatted `HH:mm`, 00:00 through 23:59. It is combined with the containing day's date and the activity's effective location timezone. |
| IANA timezone | String matching `^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$`, at most 80 characters, and recognized by the runtime's `Intl` implementation. |
| Coordinate | Object with required finite numeric `latitude` from -90 through 90 and `longitude` from -180 through 180. No unknown fields. |
| Status | One of `tentative`, `planned`, `booked`, `optional`, or `cancelled`. Omission means `planned`. |
| URL | An absolute `http://` or `https://` URL, at most the field's documented length. Other schemes and relative URLs are invalid. |

Arrays have no maximum length unless an application imposes one outside this contract.

## Itinerary document

| Field | Required | Type and meaning |
|---|---:|---|
| `schemaVersion` | Yes | Exact string `"1.0"`. |
| `trip` | Yes | One [trip](#trip). |
| `locations` | Yes | Non-empty array of [locations](#locations). |
| `places` | Yes | Array of reusable [places](#places); may be empty. |
| `days` | Yes | Non-empty array of [days](#days). |
| `transportLegs` | No | Array of [transport legs](#transport-legs); omission means no legs. |
| `recommendedStayAreas` | No | Array of [recommended stay areas](#recommended-stay-areas); omission means none. |
| `categoryStyles` | No | Object mapping category keys to [category styles](#category-styles). |

### Trip

| Field | Required | Type and limits |
|---|---:|---|
| `id` | Yes | Identifier. |
| `title` | Yes | Non-empty string, at most 160 characters. |
| `startDate` | Yes | Date; inclusive trip start. |
| `endDate` | Yes | Date; inclusive trip end, not before `startDate`. |
| `summary` | No | String, at most 2,000 characters. |

### Locations

A location is a destination or timezone-bearing geographic context. Its coordinates are the destination center used for overview and destination focus; mapped itinerary items use place coordinates.

| Field | Required | Type and limits |
|---|---:|---|
| `id` | Yes | Identifier, unique among locations. |
| `name` | Yes | Non-empty string, at most 120 characters. |
| `country` | No | Non-empty string, at most 120 characters. |
| `timezone` | Yes | IANA region-style identifier, at most 80 characters. See [Time and timezone semantics](#time-and-timezone-semantics). |
| `coordinates` | Yes | Coordinate object. |
| `zoom` | No | Number from 0 through 22 used for destination focus. The renderer uses its own default when omitted. |

### Places

A place is a reusable map entity. Activities refer to it instead of embedding coordinates, and transport endpoints must be places.

| Field | Required | Type and limits |
|---|---:|---|
| `id` | Yes | Identifier, unique among places. |
| `name` | Yes | Non-empty string, at most 160 characters. |
| `locationId` | Yes | Existing location identifier. |
| `coordinates` | Yes | Coordinate object. |
| `category` | No | Category key used for marker styling when present. |
| `address` | No | String, at most 500 characters. |
| `notes` | No | String, at most 2,000 characters. |
| `url` | No | Absolute HTTP(S) URL, at most 2,048 characters. |

Only referenced places are rendered. Repeated activities and transport endpoints that refer to the same place share one marker; the marker exposes their combined schedule context rather than producing duplicates.

### Days

| Field | Required | Type and limits |
|---|---:|---|
| `id` | Yes | Identifier, unique among days. |
| `date` | Yes | Real date within the inclusive trip date range. |
| `title` | Yes | Non-empty string, at most 160 characters. |
| `locationIds` | Yes | Non-empty array of existing location IDs. Values must be unique within the day. A transfer day can list multiple locations. |
| `activities` | Yes | Array of [activities](#activities); may be empty. |
| `status` | No | Status; omission means `planned`. |
| `summary` | No | String, at most 2,000 characters. |
| `notes` | No | String, at most 4,000 characters. |
| `tip` | No | String, at most 1,000 characters. |

Days need not be supplied in date order and multiple days may use the same date. The renderer orders them chronologically.

### Activities

Activities are schedule entries. They never contain coordinates directly and are mapped only when `placeId` is present.

| Field | Required | Type and limits |
|---|---:|---|
| `id` | Yes | Identifier, unique across activities in all days. |
| `name` | Yes | Non-empty string, at most 160 characters. |
| `kind` | Yes | `visit`, `activity`, `meal`, `lodging`, `rest`, `free-time`, `reminder`, `check-in`, or `other`. |
| `category` | Yes | Category key used for filtering and accents. |
| `placeId` | No | Existing place identifier. Its place supplies the activity's marker and primary location. |
| `locationId` | No | Existing location identifier for schedule/time context. It does not map the activity by itself. |
| `energy` | No | `low`, `moderate`, `high`, `recovery`, or `transit`. |
| `status` | No | Status; omission means `planned`. |
| `startTime` | No | Activity time interpreted on the day date in the effective location timezone. |
| `endTime` | No | Activity time on the same local day; cannot be lexically before `startTime` when both are present. |
| `notes` | No | String, at most 4,000 characters. |
| `url` | No | Absolute HTTP(S) URL, at most 2,048 characters. |

#### Effective activity location

The validator resolves an activity's effective location in this order:

1. The referenced place's `locationId`.
2. The activity's explicit `locationId`.
3. The day's only `locationIds` entry, but only when that array has exactly one item.

If `placeId` and `locationId` are both present, they must identify the same location. Any resolved effective location must be listed in the containing day's `locationIds`. A timed activity must resolve an effective location so its timezone is known.

An activity without `placeId` is schedule-only. Rest, free time, reminders, check-ins, and any other activity kind may be schedule-only. Such activities appear in the timeline but have no marker. On a multi-location day, an untimed schedule-only activity may be destination-neutral by omitting both location references; a timed one must set `locationId` unless it references a place.

#### Minimal single-location schedule

This is a complete valid itinerary. The activity inherits `osaka` as its effective location and is schedule-only because it has no `placeId`.

```json
{
  "schemaVersion": "1.0",
  "trip": {
    "id": "osaka-rest",
    "title": "Osaka rest day",
    "startDate": "2026-10-03",
    "endDate": "2026-10-03"
  },
  "locations": [
    {
      "id": "osaka",
      "name": "Osaka",
      "timezone": "Asia/Tokyo",
      "coordinates": {
        "latitude": 34.6937,
        "longitude": 135.5023
      }
    }
  ],
  "places": [],
  "days": [
    {
      "id": "rest-day",
      "date": "2026-10-03",
      "title": "Recovery",
      "locationIds": ["osaka"],
      "activities": [
        {
          "id": "afternoon-rest",
          "name": "Afternoon rest",
          "kind": "rest",
          "category": "rest",
          "startTime": "14:00",
          "endTime": "16:00",
          "energy": "recovery"
        }
      ]
    }
  ]
}
```

#### Reusable place and mapped activity

This is a complete valid itinerary. Additional activities can reuse `museum` and will share its marker.

```json
{
  "schemaVersion": "1.0",
  "trip": {
    "id": "museum-day",
    "title": "Museum day",
    "startDate": "2026-11-08",
    "endDate": "2026-11-08"
  },
  "locations": [
    {
      "id": "london",
      "name": "London",
      "timezone": "Europe/London",
      "coordinates": {
        "latitude": 51.5072,
        "longitude": -0.1276
      }
    }
  ],
  "places": [
    {
      "id": "museum",
      "name": "British Museum",
      "locationId": "london",
      "coordinates": {
        "latitude": 51.5194,
        "longitude": -0.127
      },
      "category": "culture",
      "url": "https://www.britishmuseum.org/"
    }
  ],
  "days": [
    {
      "id": "culture-day",
      "date": "2026-11-08",
      "title": "Collections",
      "locationIds": ["london"],
      "activities": [
        {
          "id": "museum-visit",
          "name": "Museum visit",
          "kind": "visit",
          "category": "culture",
          "placeId": "museum",
          "startTime": "10:00",
          "status": "booked"
        }
      ]
    }
  ]
}
```

### Transport legs

A transport leg is a schedule-bearing journey between two places.

| Field | Required | Type and limits |
|---|---:|---|
| `id` | Yes | Identifier, unique among transport legs. |
| `mode` | Yes | `walk`, `bike`, `drive`, `bus`, `rail`, `ferry`, `flight`, or `other`. |
| `originPlaceId` | Yes | Existing place identifier. |
| `destinationPlaceId` | Yes | Existing place identifier. |
| `dayId` | No | Existing day identifier. If present, both endpoint locations must be listed in that day's `locationIds`. |
| `name` | No | Non-empty string, at most 160 characters. The renderer derives an endpoint label when omitted. |
| `departureLocalDateTime` | No | Local datetime interpreted in the origin place's location timezone. |
| `arrivalLocalDateTime` | No | Local datetime interpreted in the destination place's location timezone. |
| `status` | No | Status; omission means `planned`. |
| `carrier` | No | String, at most 120 characters. |
| `serviceNumber` | No | String, at most 80 characters. |
| `bookingNotes` | No | String, at most 2,000 characters. Store descriptive guidance only, not secrets or confirmation codes. |
| `notes` | No | String, at most 2,000 characters. |
| `lines` | No | Non-empty array of line arrays. Each line has at least two coordinate objects. |

If `lines` is omitted, the renderer draws a direct overview line between endpoint coordinates and splits a dateline crossing for display. Explicit geometry must already be antimeridian-safe: split it into separate lines at `180/-180` so adjacent points within one line never differ by more than 180 degrees.

Normal browsing filters routes by selected day/destination. Explicitly selecting a transport leg overrides those browsing filters for that leg, renders a high-contrast path above ordinary route and stay-area layers, keeps both endpoint markers visible and selected, and fits the complete multi-line geometry. Camera fitting unwraps longitudes across line segments so a dateline route frames the short crossing rather than nearly the whole world.

#### Multi-location transfer day

This is a complete valid itinerary. The endpoint places supply the two location/timezone contexts.

```json
{
  "schemaVersion": "1.0",
  "trip": {
    "id": "transfer",
    "title": "Paris to London",
    "startDate": "2026-10-20",
    "endDate": "2026-10-20"
  },
  "locations": [
    {
      "id": "paris",
      "name": "Paris",
      "timezone": "Europe/Paris",
      "coordinates": {
        "latitude": 48.8566,
        "longitude": 2.3522
      }
    },
    {
      "id": "london",
      "name": "London",
      "timezone": "Europe/London",
      "coordinates": {
        "latitude": 51.5072,
        "longitude": -0.1276
      }
    }
  ],
  "places": [
    {
      "id": "gare-du-nord",
      "name": "Gare du Nord",
      "locationId": "paris",
      "coordinates": {
        "latitude": 48.8809,
        "longitude": 2.3553
      },
      "category": "transport"
    },
    {
      "id": "st-pancras",
      "name": "St Pancras International",
      "locationId": "london",
      "coordinates": {
        "latitude": 51.532,
        "longitude": -0.126
      },
      "category": "transport"
    }
  ],
  "days": [
    {
      "id": "transfer-day",
      "date": "2026-10-20",
      "title": "Cross-channel transfer",
      "locationIds": ["paris", "london"],
      "activities": [
        {
          "id": "hotel-check-in",
          "name": "Hotel check-in",
          "kind": "check-in",
          "category": "lodging",
          "locationId": "london",
          "startTime": "15:30"
        }
      ]
    }
  ],
  "transportLegs": [
    {
      "id": "eurostar",
      "dayId": "transfer-day",
      "name": "Eurostar to London",
      "mode": "rail",
      "originPlaceId": "gare-du-nord",
      "destinationPlaceId": "st-pancras",
      "departureLocalDateTime": "2026-10-20T10:10",
      "arrivalLocalDateTime": "2026-10-20T11:30",
      "status": "booked",
      "carrier": "Eurostar"
    }
  ]
}
```

#### Antimeridian geometry

This valid `lines` value has two lines and no adjacent longitude jump greater than 180 degrees:

```json
{
  "lines": [
    [
      { "latitude": 35.0, "longitude": 150.0 },
      { "latitude": 37.0, "longitude": 180.0 }
    ],
    [
      { "latitude": 37.0, "longitude": -180.0 },
      { "latitude": 38.0, "longitude": -122.0 }
    ]
  ]
}
```

### Recommended stay areas

| Field | Required | Type and limits |
|---|---:|---|
| `id` | Yes | Identifier, unique among stay areas. |
| `locationId` | Yes | Existing location identifier. |
| `name` | Yes | Non-empty string, at most 160 characters. |
| `boundaries` | Yes | Non-empty array of polygon rings. Each ring has at least four coordinates and repeats its first coordinate as its last. |
| `notes` | No | String, at most 2,000 characters. |

The validator checks reference validity and exact ring closure. It does not infer or enforce winding order, holes, non-self-intersection, containment near the named location, or antimeridian topology.

### Category styles

Each `categoryStyles` property name must be a category key. Its value accepts:

| Field | Required | Type and limits |
|---|---:|---|
| `label` | No | Non-empty string, at most 60 characters. |
| `color` | No | Six-digit hexadecimal color such as `"#0969da"`. |

An empty style object is valid. Categories can appear in activities or places without a matching style; the renderer supplies a fallback label/color. Category styles do not create itinerary items.

## Time and timezone semantics

Every location requires a region-style IANA timezone string such as `Asia/Singapore`, `Europe/Paris`, or `Etc/UTC`. The schema enforces the broad shape; semantic validation asks JavaScript `Intl.DateTimeFormat` to resolve the identifier using the runtime's ICU timezone database. A correctly shaped but unavailable or unknown zone is rejected.

Activity times are wall-clock values on the containing day:

- The effective activity location determines the timezone.
- A timed activity without an effective location is invalid.
- When both times are present, `endTime` must not be earlier than `startTime`; overnight activities should be represented differently because activity times are defined on one day.

Transport datetimes are also wall-clock values:

- Departure uses the origin place's location timezone.
- Arrival uses the destination place's location timezone.
- When both are present and resolve successfully, the validator converts them to instants and rejects arrival before departure across timezone changes.

Nonexistent local times in a daylight-saving spring-forward gap are rejected. An ambiguous fall-back time is accepted if the runtime can map it, but the contract has no offset or disambiguation field and therefore cannot express which occurrence was intended. For critical ambiguous travel times, choose an unambiguous local time or retain authoritative offset-aware details outside this v1.0 document.

The validator does not infer timezones from coordinates, geocode names, infer dates from a leg's `dayId`, compare an activity's clock time to a transport leg, or prove that carrier schedules are correct.

## Focus and live state

Programmatic `set_focus` and in-canvas navigation share one coherent focus model:

- A location-only focus clears any prior day.
- A day-only focus inherits its location only when the day has exactly one location; multi-location days keep the destination selector at all destinations.
- A day/location pair is accepted only when the day includes that location.
- Empty focus (`{}`), including through `set_focus`, means trip overview.

The server is authoritative for programmatic focus. Every SSE connection immediately receives the current focus, so a command sent before the browser connects is not lost. User navigation is posted back to the loopback server through a same-origin, per-instance-token endpoint, keeping reconnect state consistent. The `/state` endpoint and `get_summary` action report this latest synchronized focus; selection of an activity or transport leg also synchronizes the day/destination controls it changes.

The timeline and controls do not depend on MapLibre initialization. They are usable when the integrity-pinned library, style, or tiles are offline; the map area reports that persistent degraded state without repeatedly announcing it. Overview and selection framing use referenced visible places when available. With no such geometry, the renderer safely retains its last/default camera rather than constructing invalid bounds.

## Status semantics and rendering

Days, activities, and transport legs share the same status enum. A missing status is semantically `planned`, including in summary counts and visual treatment.

- Statuses appear as text badges, so meaning is not color-only.
- A cancelled day appears in the timeline; its activities and associated legs are treated as cancelled for visual/map behavior even when their own status says otherwise.
- Cancelled activities appear subdued in the timeline with a cancellation badge; they do not contribute markers.
- Cancelled transport legs appear in the timeline and as a subdued dashed route. Selecting one reveals its route and both endpoints.
- Schedule-only activities appear with an explicit label, regardless of status.
- Selecting a day keeps non-cancelled, category-enabled mapped places from other days visible as subdued context markers within the active destination. Context markers are labelled as not being on the selected day and are clickable to navigate to their schedule; they do not widen the selected day's camera bounds.

The [browser library guide](browser-library.md#rendering-and-interaction) describes active, selected, and context marker interaction across component widths.

## Semantic validation beyond JSON Schema

Structural schema validation is followed by path-specific semantic checks for:

- real trip dates and `startDate <= endDate`;
- each day having a real date within the inclusive trip range;
- unique location IDs, place IDs, day IDs, activity IDs across all days, transport-leg IDs, and stay-area IDs;
- duplicate location IDs within one day's `locationIds`;
- location references from places, days, activities, and stay areas;
- activity place references, place/activity location agreement, effective locations being included in the day, and timezone availability for timed activities;
- valid IANA timezones according to the runtime;
- real and existent local times, same-day activity end ordering, and cross-timezone transport chronology;
- transport day and endpoint references, plus both endpoint locations being included in a referenced day;
- antimeridian-safe explicit transport lines;
- closed recommended-stay-area polygon rings; and
- valid `initialFocus`/`set_focus` IDs and location/day consistency.

Uniqueness is scoped by entity collection except that activity IDs are unique across all days; IDs of different entity kinds may be equal. The validator does not enforce day ordering, unique dates, coordinate proximity, route continuity between separate lines, route endpoints matching the first/last geometry coordinates, polygon winding/self-intersection, or business-specific scheduling constraints.

The standalone validator resolves local JSON Pointer references (`#/...`). The runtime composes the open-input schema with the itinerary definitions before validation, so the authored external `itinerary.schema.json` reference does not require network or filesystem resolution. Semantic checks run only when their structural prerequisites pass, avoiding misleading follow-on errors from malformed collections.

## Invalid examples and troubleshooting

Errors are actionable and include JSON-style paths. File loading and open-envelope errors use dedicated canvas error codes.

| Symptom | Typical failure |
|---|---|
| `canvas_input_invalid` before opening | Host JSON Schema rejected the open or action envelope before extension code ran. |
| `itinerary_input_invalid` | Runtime envelope validation rejected a non-object input, invalid `documentId`, or unknown field. |
| `itinerary_source_invalid` | Runtime validation found both or neither of `itinerary` and `itineraryPath`. |
| `itinerary_path_invalid` | Absolute path or a resolved path outside the project. |
| `itinerary_file_unreadable` | Missing, inaccessible, or non-file path. |
| `itinerary_file_too_large` | A resolved file or serialized inline itinerary exceeds 1 MiB. |
| `itinerary_json_invalid` | File contents are not valid JSON, or inline input cannot be serialized as JSON. |
| `itinerary_schema_invalid` | Structural or semantic itinerary errors; up to 20 path-specific causes are shown. |
| `itinerary_focus_invalid` | Unknown focus ID or a focused location not included in the focused day. |
| `canvas_instance_missing` | An action targeted an instance that is not currently open. |

Examples of invalid fragments:

```json
{
  "placeId": "missing-place",
  "startTime": "09:00"
}
```

This fails when `missing-place` is not in `places`; on a multi-location day it also cannot obtain a timezone from the missing place.

```json
{
  "timezone": "Mars/Olympus_Mons"
}
```

This matches the schema's shape but fails semantic IANA timezone validation.

```json
{
  "lines": [
    [
      { "latitude": 37.0, "longitude": 170.0 },
      { "latitude": 37.0, "longitude": -170.0 }
    ]
  ]
}
```

This fails because the adjacent longitudes differ by 340 degrees. Split the crossing at `180/-180` as shown above.

```json
{
  "startTime": "02:30"
}
```

This can fail when combined with a day date and timezone where 02:30 lies in a daylight-saving gap. The error names the field and timezone.

For a full exercised document, see [`examples/sample-itinerary.json`](../examples/sample-itinerary.json).
