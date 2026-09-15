# Structured Itinerary Map

Structured Itinerary Map turns validated travel data into an interactive, accessible itinerary with destinations, days, contextual points of interest, transport routes, stay areas, notes, filters, and responsive map/timeline navigation.

The project provides one rendering system in three delivery modes:

| Mode | Best for | Entry point |
|---|---|---|
| Browser library | Portable itinerary pages and multi-map applications | `dist/itinerary-map.v1.js` and `<itinerary-map>` |
| Copilot canvas | Agent-driven exploration inside a project session | `.github/extensions/structured-itinerary-map/` |
| Static exporter | Validated deployment folders or generated one-HTML consumers | `scripts/export-map.mjs` |

All modes share the versioned itinerary contract, semantic validator, renderer, view-model helpers, MapLibre 6.9.0 integration, and OpenFreeMap basemap styles.

## Trip-planning skill

The project-scoped `plan-trip` Agent Skill turns requests such as “plan my trip,” “turn this trip into an itinerary,” and “update my itinerary” into the canonical map-ready document. It distinguishes booked anchors from preferences, selectively verifies current facts that affect feasibility, and presents a concise day-by-day proposal before changing files.

The approval gate is strict: the skill does not write JSON or open a map until the user explicitly approves the draft. After approval it writes `itineraries/<trip-id>.json`, preserves stable IDs and booked decisions during updates, validates the file, and opens the `structured-itinerary-map` canvas with a stable `documentId`.

Validate any itinerary directly:

```powershell
npm run validate:itinerary -- itineraries\<trip-id>.json
```

The command uses the exact canonical JSON Schema and semantic validator, enforces the 1 MiB limit and project-contained path rules, prints actionable errors, and exits nonzero on failure. Add `--json` for machine-readable output. See [the skill instructions](.github/skills/plan-trip/SKILL.md) and [workflow examples](.github/skills/plan-trip/references/scenarios.md).

## Features

- Destination, day, category, and stay-area controls
- Active, selected, and contextual markers with schedule navigation
- Transport routes, including antimeridian-safe multi-line geometry
- Recommended stay-area polygons
- Desktop, embedded, and mobile layouts driven by component width
- System light/dark themes, keyboard navigation, reduced-motion support, and accessible diagnostics
- Hash-based focus synchronization as an explicit per-component option
- Strict JSON Schema and semantic validation with actionable errors
- Map-independent timeline and controls when WebGL or map resources are unavailable

## Recommended usage

Create one static HTML document containing a validated itinerary, reference the versioned browser library, and connect the data with `data-source`.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Weekend in Singapore</title>
  <style>
    html, body { height: 100%; margin: 0; }
    itinerary-map { display: block; height: 100%; min-height: 420px; }
  </style>
  <script
    defer
    src="./dist/itinerary-map.v1.js"
    integrity="sha384-g/YuSKrmWHwCNMiVBMHgCUHtCbvbqpk6+9kuPpjZR+Ea/alZYDeNbm43q8noftnI"
    crossorigin="anonymous"></script>
</head>
<body>
  <itinerary-map data-source="trip-data"></itinerary-map>
  <script id="trip-data" type="application/json">
  {
    "schemaVersion": "1.0",
    "trip": {
      "id": "singapore-weekend",
      "title": "Weekend in Singapore",
      "startDate": "2026-12-11",
      "endDate": "2026-12-11"
    },
    "locations": [
      {
        "id": "singapore",
        "name": "Singapore",
        "country": "Singapore",
        "timezone": "Asia/Singapore",
        "coordinates": { "latitude": 1.3, "longitude": 103.86 }
      }
    ],
    "places": [
      {
        "id": "marina-bay",
        "name": "Marina Bay",
        "locationId": "singapore",
        "coordinates": { "latitude": 1.2868, "longitude": 103.8545 },
        "category": "architecture"
      }
    ],
    "days": [
      {
        "id": "singapore-waterfront",
        "date": "2026-12-11",
        "title": "Waterfront evening",
        "locationIds": ["singapore"],
        "activities": [
          {
            "id": "marina-bay-walk",
            "name": "Marina Bay walk",
            "kind": "activity",
            "placeId": "marina-bay",
            "category": "architecture",
            "energy": "low",
            "startTime": "18:00"
          }
        ]
      }
    ]
  }
  </script>
</body>
</html>
```

Serve the page over static HTTP. The library is distributed by this repository; no production CDN URL is published. For another host, replace `src` with a version-pinned HTTPS URL and replace the SRI value with the hash for that exact file.

JSON inside an HTML script element must be produced with a safe serializer: replace `<` with `\u003c`, U+2028 with `\u2028`, and U+2029 with `\u2029`. Do not interpolate untrusted strings into HTML. The exporter applies these rules automatically.

## Browser component API

### Attributes

| Attribute | Meaning |
|---|---|
| `data-source="id"` | Reads JSON from a document-level `<script type="application/json" id="id">`. |
| `style-nonce="value"` | Applies a CSP nonce to styles created inside the shadow root. |
| `sync-hash="namespace"` | Synchronizes focus through `namespace.location` and `namespace.day` hash parameters. |

Omitting `sync-hash` disables hash parsing, listeners, and history writes. An empty attribute derives its namespace from the component `id`, with `itinerary` as the fallback. Distinct namespaces isolate multiple maps. Components sharing a namespace intentionally share focus and use the latest valid update.

### Properties and methods

```js
const map = document.querySelector("itinerary-map");
map.itinerary = itineraryObject; // overrides data-source
map.reload();                    // reparses, revalidates, and rerenders

const version = customElements.get("itinerary-map").version; // "1.0.0"
```

An `itinerary` property assigned before the library defines the element is recovered at definition time. Attribute and property updates are coalesced into one effective render. Disconnected components defer work until reconnection.

### Events

| Event | `detail` |
|---|---|
| `itinerary-map-ready` | `{ schemaVersion, tripId }` |
| `itinerary-map-error` | `{ code, message, errors }` |

Events bubble and cross the shadow boundary. Multiple components keep DOM, map, focus, listeners, and lifecycle state isolated.

See [Browser library guide](docs/browser-library.md) for loading order, CSP, sizing, lifecycle, hosting, accessibility, and failure behavior.

## Copilot canvas

The project extension declares the `structured-itinerary-map` canvas. Its open input uses a stable `documentId` plus exactly one itinerary source:

```json
{
  "documentId": "asia-sample",
  "itineraryPath": "examples/sample-itinerary.json",
  "initialFocus": {
    "locationId": "singapore",
    "dayId": "singapore-waterfront"
  }
}
```

`documentId` identifies the itinerary document; the host-provided `instanceId` identifies a panel. The canvas also accepts an inline `itinerary` object. Agent-facing actions are `get_summary` and `set_focus`.

Each canvas instance uses a tokenized HTTP server bound to `127.0.0.1`. It validates Host and Origin headers and synchronizes focus through HTTP and Server-Sent Events.

## Static export

Generate a self-contained deployment folder:

```powershell
node scripts\export-map.mjs examples\sample-itinerary.json .test-work\sample-map
```

Generate one HTML itinerary that references the repository library:

```powershell
node scripts\export-map.mjs examples\sample-itinerary.json .test-work\sample.html `
  --library-url ../dist/itinerary-map.v1.js
```

Generate one HTML itinerary that references an HTTPS-hosted library:

```powershell
node scripts\export-map.mjs examples\sample-itinerary.json .test-work\sample.html `
  --library-url https://your-host.example/assets/itinerary-map.v1.js `
  --integrity (Get-Content dist\itinerary-map.v1.sri)
```

`your-host.example` is a placeholder. The integrity value must match the bytes served at the chosen URL. See [Standalone export guide](docs/standalone-export.md) for overwrite safety, nested hosting, output files, validation errors, and deployment.

## Development

Node.js 24 is required.

```powershell
npm ci
npm run build
npm test
npm run validate:itinerary -- examples\sample-itinerary.json
npm run build:check
npm run check
```

- `npm run build` generates the browser bundle, local MapLibre assets, SRI file, licenses, example page, and generated documentation fragments.
- `npm test` runs the Node test suite.
- `npm run build:check` proves generated artifacts match source and exact-byte SRI output.
- `npm run check` checks JavaScript syntax, parses project JSON and documentation JSON fences, and checks generated artifacts.

Preview an export with a static HTTP server:

```powershell
npx --yes serve@14.2.5 .test-work\sample-map --listen 8000
```

Open `http://127.0.0.1:8000`. Stop the server with `Ctrl+C`.

## Architecture

| Layer | Responsibility |
|---|---|
| `itinerary.schema.json` | Canonical structural contract with `urn:trip-planner:itinerary:1.0` identity |
| `validation.mjs` | Cross-reference, date, timezone, geometry, and transport semantics |
| `renderer.mjs` and shared helpers | Full-page and component markup, styles, marker state, routes, and map lifecycle |
| `runtime-adapters.mjs` | Canvas focus synchronization and optional browser hash synchronization |
| `browser-component.mjs` | Shadow-DOM custom element API and component lifecycle |
| `extension.mjs` | Copilot canvas registration and loopback runtime wiring |
| `export-map.mjs` | Validated folder and one-HTML generation |

MapLibre 6.9.0 and its worker are bundled locally. OpenFreeMap supplies styles, vector tiles, glyphs, and sprites over the network. Itinerary JSON is processed locally and is not sent to OpenFreeMap. OpenFreeMap and OpenStreetMap attribution stays visible in map mode.

## Contract and reference

- [Itinerary contract](docs/itinerary-contract.md)
- [Canonical JSON Schema](.github/extensions/structured-itinerary-map/itinerary.schema.json)
- [Browser library guide](docs/browser-library.md)
- [Standalone export guide](docs/standalone-export.md)
- [Representative itinerary](examples/sample-itinerary.json)
- [Generated HTML example](examples/standalone.html)
- [MIT project license](LICENSE)
- [Third-party licenses](THIRD_PARTY_LICENSES.md)

## License

Structured Itinerary Map source and the distributable browser library are available under the [MIT License](LICENSE). The generated `dist/itinerary-map.v1.LICENSES.txt` includes the project license and bundled MapLibre GL JS license. Static-folder exports include both that combined notice and a root `LICENSE` file. OpenFreeMap/OpenStreetMap attribution stays visible in the map.

## Operational limits

- Every mappable location and place requires coordinates; the project performs no geocoding.
- OpenFreeMap basemaps require network access. The timeline and controls continue to operate when map resources fail.
- `file://` behavior varies by browser; static HTTP is the supported preview and deployment path.
- The planning skill requires explicit approval before it writes or updates an itinerary.
- The repository does not publish a hosted browser-library CDN.
