# Standalone export

`scripts/export-map.mjs` validates a structured itinerary and emits either a one-HTML consumer of the browser library or a self-contained static deployment folder. Both modes use the canonical schema, semantic validator, renderer, MapLibre 6.9.0 assets, and safe HTML helpers.

Node.js 24 is required.

## Syntax

### One-HTML library-reference mode

```text
node scripts/export-map.mjs <itinerary.json> <output.html> --library-url <url> [--integrity <sha384-value>]
```

This mode writes one HTML file containing the validated itinerary, component element, sizing, CSP, and safe embedded JSON. The browser library is referenced rather than copied into the HTML.

The mode is selected when either condition is true:

- the output path ends in `.html`; or
- `--library-url` is present.

An `.html` output requires `--library-url`.

Repository-relative example:

```powershell
node scripts\export-map.mjs examples\sample-itinerary.json .test-work\sample.html `
  --library-url ../dist/itinerary-map.v1.js
```

HTTPS-hosted example:

```powershell
node scripts\export-map.mjs examples\sample-itinerary.json .test-work\sample.html `
  --library-url https://your-host.example/assets/itinerary-map.v1.js `
  --integrity (Get-Content dist\itinerary-map.v1.sri)
```

`your-host.example` is a placeholder. Publish the exact `dist/itinerary-map.v1.js` bytes at the selected immutable URL.

### Static-folder mode

```text
node scripts/export-map.mjs <itinerary.json> <output-directory>
```

Example:

```powershell
node scripts\export-map.mjs examples\sample-itinerary.json .test-work\sample-map
```

This mode writes a deployable directory with local application modules and local MapLibre runtime assets.

## Options

| Option | Applies to | Rules |
|---|---|---|
| `--library-url <url>` | One-HTML | Required. Accepts a safe relative `.js` URL, an HTTPS `.js` URL, or an HTTP loopback `.js` URL for preview. |
| `--integrity <sha384-value>` | One-HTML | Optional for relative URLs and required for HTTP(S) URLs. Must be a valid SHA-384 SRI value. |

No other options are accepted.

Library URLs reject:

- protocol-relative values;
- backslashes and encoded backslashes;
- whitespace, control characters, quotes, and markup delimiters;
- credentials or URL fragments;
- schemes other than HTTPS, except HTTP on `localhost`, `127.0.0.1`, or `[::1]`;
- paths that do not identify a `.js` asset.

The generated CSP uses the same normalized source policy as URL validation and does not add duplicate sources.

## Input requirements

The source:

- is a regular file with a `.json` extension;
- is no larger than 1 MiB before and during the read;
- parses as JSON;
- validates against [`itinerary.schema.json`](../.github/extensions/structured-itinerary-map/itinerary.schema.json);
- passes the semantic rules described in the [itinerary contract](itinerary-contract.md).

Validation errors are printed with actionable paths. User-facing error lists are capped at 20 causes.

## Output safety

### One-HTML files

The exporter:

- refuses a source/output collision;
- refuses a symbolic-link output;
- creates missing parent directories;
- overwrites only a regular file containing its generator marker;
- refuses unrelated existing HTML;
- escapes HTML text and attribute values;
- embeds JSON with script-closing protection;
- validates source IDs, component IDs, nonces, URLs, and integrity values;
- derives a content-specific URL-safe CSP nonce.

### Static folders

The exporter:

- refuses a source inside or equal to the output directory;
- resolves real paths and checks containment;
- accepts a missing directory or an empty directory;
- overwrites only a directory containing a recognized `.itinerary-map-export.json` manifest;
- refuses unrelated nonempty directories and foreign or malformed manifests;
- rewrites exactly the manifest-owned file set.

These rules protect source data and unrelated deployment files from accidental replacement.

## Static-folder contents

A folder export contains 13 files. The build generates this list from the exporter manifest:

<!-- build-static-files:start -->
```text
index.html
app.mjs
canvas-app.mjs
client-lifecycle.mjs
focus-sync.mjs
renderer-helpers.mjs
runtime-adapters.mjs
time-helpers.mjs
maplibre-gl.v6.9.0.js
maplibre-gl.v6.9.0.css
itinerary-map.v1.LICENSES.txt
LICENSE
.itinerary-map-export.json
```
<!-- build-static-files:end -->

`index.html` references sibling assets with relative URLs, so the folder can be hosted at a domain root or nested path. The ownership manifest records generator version, file list, and itinerary schema version.

The folder output uses the same full-page UI as the Copilot canvas without loopback APIs. Focus can use the unnamespaced `location` and `day` URL hash parameters.

## Deterministic output

Identical source bytes, project source, dependency lockfile, and exporter options produce identical output bytes. The one-HTML CSP token is derived from validated content and configuration. It lets deterministic inline and runtime-injected styles satisfy CSP, but it is not unpredictable and does not protect a document that an attacker can modify. Export safety comes from strict input validation, contextual HTML escaping, safe identifier/URL rules, and deployment integrity. The static folder copies canonical source modules, generated vendor assets, and project license.

Run the build freshness check before export:

```powershell
npm run build:check
```

## Preview

Browsers apply different restrictions to modules, workers, and local files under `file://`. Serve output over HTTP:

```powershell
npx --yes serve@14.2.5 .test-work\sample-map --listen 8000
```

Open:

```text
http://127.0.0.1:8000
```

For one-HTML output, serve a common ancestor containing both the HTML and its relative library path:

```powershell
npx --yes serve@14.2.5 . --listen 8000
```

Then open the exported HTML through its served path.

## Deployment

### One-HTML

Deploy:

1. the generated HTML;
2. the exact versioned browser-library file referenced by `--library-url`;
3. `dist/itinerary-map.v1.LICENSES.txt` alongside the library or in the distribution’s license notices.

Use the SRI value from `dist/itinerary-map.v1.sri`. If the library is cross-origin, configure CORS and a valid JavaScript content type.

### Static folder

Deploy the entire output folder without renaming or omitting assets. Preserve `.itinerary-map-export.json` if future exporter runs will target the same directory. `LICENSE` contains the project MIT terms; `itinerary-map.v1.LICENSES.txt` contains project and bundled MapLibre terms.

GitHub Pages and ordinary static hosts can serve either mode. No server-side runtime is required.

## Network, privacy, and degraded map behavior

The library, renderer, and MapLibre worker are local to the chosen distribution. OpenFreeMap styles, vector tiles, glyphs, and sprites load from `https://tiles.openfreemap.org`.

Itinerary JSON is embedded in the generated page and is not sent to OpenFreeMap. The exporter performs no geocoding or network request.

A deployment is not a fully offline map. If WebGL or map resources fail, the timeline and controls continue to work and the page displays an accessible map diagnostic.

Keep OpenFreeMap/OpenStreetMap attribution visible. Preserve `LICENSE` and `itinerary-map.v1.LICENSES.txt` in folder exports, and distribute [`dist/itinerary-map.v1.LICENSES.txt`](../dist/itinerary-map.v1.LICENSES.txt) with the browser library.

## Related reference

- [README](../README.md)
- [Browser library guide](browser-library.md)
- [Itinerary contract](itinerary-contract.md)
- [Sample itinerary](../examples/sample-itinerary.json)
