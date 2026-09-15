# Browser library guide

`dist/itinerary-map.v1.js` is a classic IIFE that registers the `<itinerary-map>` custom element and bundles the shared itinerary validator, renderer, MapLibre 6.9.0 runtime, and self-contained map worker. It supports static HTML documents, applications with multiple maps, and dynamically loaded itinerary data.

## Build artifacts

Run Node.js 24 commands from the repository root:

```powershell
npm ci
npm run build
npm run build:check
```

The build writes:

- `dist/itinerary-map.v1.js`
- `dist/itinerary-map.v1.sri`
- `dist/itinerary-map.v1.LICENSES.txt`
- `dist/maplibre-gl.v6.9.0.js`
- `dist/maplibre-gl.v6.9.0.css`
- `examples/standalone.html`
- the generated SRI block in `docs/browser-library.md`
- every browser-library SRI literal in `README.md`
- the generated static-file manifest block in `docs/standalone-export.md`

The build generates artifacts in memory. `npm run build:check` compares that expected content with committed files, using exact bytes for the browser bundle, SRI, and MapLibre assets and newline-normalized text for generated HTML/documentation.

<!-- build-sri:start -->
```html
<script defer
  src="https://example.com/assets/itinerary-map.v1.js"
  integrity="sha384-uhV5t66GGSey7H9HevHWKjPiI6sRsQmS2Q7H8G4iHvGqEvYfOYE7sNAboUMdoqLd"
  crossorigin="anonymous"></script>
<itinerary-map data-source="trip-data" style-nonce="CONTENT_SPECIFIC_NONCE"></itinerary-map>
<script id="trip-data" type="application/json" nonce="CONTENT_SPECIFIC_NONCE">
{"schemaVersion":"1.0","trip":{"id":"sample","title":"Sample","startDate":"2026-01-01","endDate":"2026-01-01"},"locations":[{"id":"city","name":"City","timezone":"Etc/UTC","coordinates":{"latitude":0,"longitude":0}}],"places":[],"days":[{"id":"day-1","date":"2026-01-01","title":"Arrival","locationIds":["city"],"activities":[]}]}
</script>
```
<!-- build-sri:end -->

## Basic document

Load the library with `defer`, size the custom element explicitly, and place itinerary JSON in a document-level script element:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    html, body { height: 100%; margin: 0; }
    itinerary-map { display: block; height: 100%; min-height: 420px; }
  </style>
  <script
    defer
    src="./dist/itinerary-map.v1.js"
    integrity="sha384-uhV5t66GGSey7H9HevHWKjPiI6sRsQmS2Q7H8G4iHvGqEvYfOYE7sNAboUMdoqLd"
    crossorigin="anonymous"></script>
</head>
<body>
  <itinerary-map data-source="trip-data"></itinerary-map>
  <script id="trip-data" type="application/json">
    { "schemaVersion": "1.0", "...": "See the complete README or sample itinerary" }
  </script>
</body>
</html>
```

The JSON fragment above illustrates placement only. Copy a complete valid document from [`examples/sample-itinerary.json`](../examples/sample-itinerary.json) or the [contract guide](itinerary-contract.md).

The deferred script executes when parsing completes, so the element and its data source are available together. Async or dynamic insertion also works:

```js
const map = document.createElement("itinerary-map");
map.itinerary = itineraryObject;
map.addEventListener("itinerary-map-ready", ({ detail }) => {
    console.info(`Rendered ${detail.tripId}`);
});
document.querySelector("main").append(map);

const script = document.createElement("script");
script.src = "./dist/itinerary-map.v1.js";
document.head.append(script);
```

The component recovers an own `itinerary` value assigned before custom-element definition. Parser-created elements coalesce connection and observed-attribute callbacks into one effective render. Loading the bundle more than once is safe: an existing `itinerary-map` registration is reused without redefinition.

## Safe JSON embedding

Generate script-element JSON with a serializer rather than string concatenation:

1. Serialize with `JSON.stringify`.
2. Replace every `<` with `\u003c`.
3. Replace U+2028 with `\u2028`.
4. Replace U+2029 with `\u2029`.

These substitutions prevent a value such as `</script>` from closing the data element. Never interpolate untrusted values into tag names, attributes, styles, or executable script. `scripts/export-map.mjs` uses the project serializer and validates generated identifiers, library URLs, integrity values, and CSP nonces.

## Public API

### Attributes

| Attribute | Behavior |
|---|---|
| `data-source="id"` | Parses the text of the document-level `script[type="application/json"]` with the matching ID. |
| `style-nonce="value"` | Adds the supplied CSP nonce to component-owned shadow styles. |
| `sync-hash="namespace"` | Enables hash synchronization through `namespace.location` and `namespace.day`. |

`data-source` is ignored while the `itinerary` property contains an object.

### Property, method, and version

```js
const map = document.querySelector("itinerary-map");

map.itinerary = itineraryObject;
map.reload();

console.info(customElements.get("itinerary-map").version); // "1.0.0"
```

- `itinerary`: a structured itinerary object; assigning `null` or `undefined` returns input selection to `data-source`.
- `reload()`: reparses, revalidates, and rerenders the effective input. Calls made while disconnected are deferred.
- `version`: static component-library API version.

Connected attribute/property updates are scheduled and coalesced. A valid input revision creates one controller, one map, and one ready event. A validation failure creates one error event and no map controller.

### Events

| Event | Detail | Meaning |
|---|---|---|
| `itinerary-map-ready` | `{ schemaVersion, tripId }` | Validation and UI initialization completed. |
| `itinerary-map-error` | `{ code, message, errors }` | Input resolution, parsing, size, or validation failed. |

Events bubble and use `composed: true`.

Error codes are:

- `source_missing`
- `source_invalid`
- `source_too_large`
- `json_invalid`
- `itinerary_invalid`

`errors` contains detailed validator messages when available. User-facing component errors use an alert region and do not expose an interactive map for invalid input.

## Multiple components and focus hashes

Each component has its own shadow root, renderer controller, MapLibre instance, resize observation, media listeners, and cleanup.

```html
<itinerary-map id="north" data-source="north-data" sync-hash="north"></itinerary-map>
<itinerary-map id="south" data-source="south-data" sync-hash="south"></itinerary-map>
```

Hash behavior is explicit:

- No `sync-hash` attribute: no hash read, hash/history write, or navigation listener.
- `sync-hash="north"`: uses `north.location` and `north.day`.
- Empty `sync-hash`: uses the component `id`, or `itinerary` when no ID exists.
- Distinct namespaces preserve each other's parameters.
- A shared namespace creates shared focus; the latest valid interaction writes the shared values.
- Browser back and forward navigation restore focus for subscribed components.
- Unknown or hostile encoded values do not bypass itinerary focus validation.

Example URL:

```text
https://site.example/trip.html#north.location=hanoi&north.day=hanoi-old-quarter
```

## Rendering and interaction

The map and timeline expose one itinerary state:

- **Active markers** belong to the selected day.
- **Selected markers** identify the focused activity or transport endpoints.
- **Context markers** belong to another day within the active destination/trip scope. Their labels identify them as not on the selected day; activating one selects and frames its map context without changing the destination or day filters.
- Category filters apply to active and context markers.
- Transport legs use independent **Flight** and **Transfer** filters: `flight` maps to Flight, while `walk`, `bike`, `drive`, `bus`, `rail`, `ferry`, and `other` map to Transfer.
- Cancelled activities do not produce normal markers.
- Unreferenced catalog places do not appear and do not affect camera bounds.
- Selected transport endpoints and routes have the strongest map emphasis.

The timeline can stay day-filtered while the map provides contextual orientation.

The Destination selector is the only interaction that changes the destination
filter. The Day selector and visible day headings are the only interactions that
change the day filter. Activity rows, transport rows, markers, and routes change
selection, popup, and camera state only. **Overview** is the explicit reset and
clears both filters.

Selecting a timeline row preserves the timeline scroll position and keyboard
focus. Marker selection may reveal a corresponding rendered row with the
smallest necessary scroll; hidden contextual rows do not move the timeline.
Destination, Day, day-heading, and Overview changes reset the timeline to its
beginning because they replace the visible filter scope.

## Sizing and responsive controls

The host controls the component’s outer dimensions:

```css
itinerary-map {
  display: block;
  width: 100%;
  height: min(80vh, 900px);
  min-height: 420px;
  container-type: inline-size;
}
```

The component uses container queries, not only viewport queries. Narrow components inside wide pages receive the compact layout:

- title and date summary use reduced spacing;
- overview, destination, and day selectors form a dense layout with 44px touch targets;
- category and stay-area controls move into a keyboard-accessible disclosure;
- the disclosure reports active filter state and preserves selections;
- the map legend starts collapsed and uses a compact map position;
- map and timeline receive usable vertical space without horizontal overflow.

Full-page canvas and static-folder pages use equivalent viewport rules. If container queries are unavailable, the component’s fallback resize state supplies compact classes and camera padding.

## Theme, motion, and accessibility

- Light and dark palettes follow `prefers-color-scheme`.
- Style changes preserve selected day, destination, categories, and focus.
- Context marker fill and border contrast distinguish state without relying on opacity alone.
- `prefers-reduced-motion` disables nonessential transitions and animated camera movement.
- The component root is `<section role="region" aria-label="Interactive itinerary map">`; applications can place multiple maps inside their own `<main>` without duplicate main landmarks.
- Controls have programmatic labels, visible focus, keyboard operation, and touch-sized targets.
- Status, validation, and persistent map-source/worker failures use live or alert semantics.
- OpenFreeMap/OpenStreetMap attribution stays visible when the map is present.

## Lifecycle

Disconnecting a component removes the map, listeners, resize observer, media subscriptions, and runtime adapter subscriptions. Input changes and `reload()` calls while disconnected do not create resources. Reconnection renders the latest effective input once.

Adoption into another document tears down old-document resources and initializes against the destination document. Page lifecycle cleanup also releases map and browser listeners.

## Content Security Policy

The bundled MapLibre worker uses a blob URL. OpenFreeMap styles, tiles, sprites, and glyphs use `https://tiles.openfreemap.org`.

The following template matches a relative library URL. A server-rendered application should replace `RANDOM_NONCE` with one fresh, cryptographically random URL-safe nonce per HTTP response and apply it to every shown `nonce` attribute.

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self' 'nonce-RANDOM_NONCE'; style-src 'self' 'nonce-RANDOM_NONCE'; img-src 'self' data: blob: https://tiles.openfreemap.org; connect-src https://tiles.openfreemap.org; font-src 'self' data: https://tiles.openfreemap.org; worker-src blob:; base-uri 'none'; object-src 'none'">
<style nonce="RANDOM_NONCE">itinerary-map{display:block;height:100vh}</style>
<script defer nonce="RANDOM_NONCE" src="./dist/itinerary-map.v1.js"></script>
<itinerary-map data-source="trip-data" style-nonce="RANDOM_NONCE"></itinerary-map>
<script id="trip-data" type="application/json" nonce="RANDOM_NONCE">...</script>
```

For an HTTPS library host, add that exact origin to `script-src` and use the matching SHA-384 SRI value. Do not add broad wildcard sources.

Static generated HTML cannot provide an unpredictable per-response nonce. The exporter derives a deterministic content-specific token so its inline sizing style and runtime-injected component styles satisfy the emitted CSP. That token is an integrity/build mechanism, not a defense against an attacker who can inject arbitrary HTML into the generated document: such an attacker can read and reuse it. Safety therefore depends on the exporter’s strict validation and escaping plus deployment controls that prevent untrusted HTML modification. The generated CSP’s library source exactly matches the accepted library URL.

## Hosting and network behavior

Use static HTTP for development and deployment. A direct `file://` document can work in some browsers, but local script, worker, and security behavior is browser-dependent.

The library can be deployed on GitHub Pages, an internal static host, or a versioned CDN path controlled by the consumer. This repository does not publish a CDN endpoint. For cross-origin library delivery:

- use HTTPS;
- pin an immutable versioned path;
- serve the JavaScript with a valid JavaScript content type;
- send an appropriate CORS header when SRI is used;
- copy the exact value from `dist/itinerary-map.v1.sri`.

The library and MapLibre worker are local assets. Basemap styles, tiles, glyphs, and sprites need network access to OpenFreeMap. Itinerary content is processed in the browser and is not sent to the map provider.

If WebGL, the worker, style loading, or map sources fail, the timeline and controls continue to function and an accessible diagnostic explains the map limitation.

## License and attribution

Structured Itinerary Map source and browser distribution use the [MIT License](../LICENSE). Distribute [`dist/itinerary-map.v1.LICENSES.txt`](../dist/itinerary-map.v1.LICENSES.txt) with the browser library; it contains the project MIT terms and the MapLibre GL JS BSD-3-Clause notice and text. Repository dependency notices are in [`THIRD_PARTY_LICENSES.md`](../THIRD_PARTY_LICENSES.md).

Do not remove the visible OpenFreeMap/OpenStreetMap attribution control or suppress required provider attribution in a deployment.

## Related reference

- [README](../README.md)
- [Itinerary contract](itinerary-contract.md)
- [Standalone export](standalone-export.md)
- [Canonical JSON Schema](../.github/extensions/structured-itinerary-map/itinerary.schema.json)
- [Generated consumer example](../examples/standalone.html)
