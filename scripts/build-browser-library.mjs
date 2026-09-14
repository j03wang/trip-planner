import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
    MAPLIBRE_LICENSES,
    MAPLIBRE_SCRIPT,
    MAPLIBRE_STYLESHEET,
    MAPLIBRE_VERSION,
} from "../.github/extensions/structured-itinerary-map/maplibre-config.mjs";
import { renderPortableItineraryHtml } from "./browser-library-helpers.mjs";
import { GENERATED_FILES } from "./export-map.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "dist", "itinerary-map.v1.js");
const integrityPath = resolve(root, "dist", "itinerary-map.v1.sri");
const vendorScriptPath = resolve(root, "dist", MAPLIBRE_SCRIPT);
const vendorStylesheetPath = resolve(root, "dist", MAPLIBRE_STYLESHEET);
const licensesPath = resolve(root, "dist", MAPLIBRE_LICENSES);
const examplePath = resolve(root, "examples", "standalone.html");
const browserDocumentationPath = resolve(root, "docs", "browser-library.md");
const standaloneDocumentationPath = resolve(root, "docs", "standalone-export.md");
const readmePath = resolve(root, "README.md");
const projectLicensePath = resolve(root, "LICENSE");

function replaceIntegrityLiterals(source, integrity, label) {
    const pattern = /sha384-[A-Za-z0-9+/]{64}/g;
    if (!pattern.test(source)) throw new Error(`${label} contains no generated SRI literal.`);
    pattern.lastIndex = 0;
    return source.replace(pattern, integrity);
}

function documentationWithIntegrity(source, integrity) {
    const replacement = `<!-- build-sri:start -->
\`\`\`html
<script defer
  src="https://example.com/assets/itinerary-map.v1.js"
  integrity="${integrity}"
  crossorigin="anonymous"></script>
<itinerary-map data-source="trip-data" style-nonce="CONTENT_SPECIFIC_NONCE"></itinerary-map>
<script id="trip-data" type="application/json" nonce="CONTENT_SPECIFIC_NONCE">
{"schemaVersion":"1.0","trip":{"id":"sample","title":"Sample","startDate":"2026-01-01","endDate":"2026-01-01"},"locations":[{"id":"city","name":"City","timezone":"Etc/UTC","coordinates":{"latitude":0,"longitude":0}}],"places":[],"days":[{"id":"day-1","date":"2026-01-01","title":"Arrival","locationIds":["city"],"activities":[]}]}
</script>
\`\`\`
<!-- build-sri:end -->`;
    if (!/<!-- build-sri:start -->[\s\S]*?<!-- build-sri:end -->/.test(source)) {
        throw new Error("docs/browser-library.md is missing its generated SRI block.");
    }
    return source.replace(/<!-- build-sri:start -->[\s\S]*?<!-- build-sri:end -->/, replacement);
}

function documentationWithStaticFiles(source) {
    const replacement = `<!-- build-static-files:start -->
\`\`\`text
${GENERATED_FILES.join("\n")}
\`\`\`
<!-- build-static-files:end -->`;
    if (!/<!-- build-static-files:start -->[\s\S]*?<!-- build-static-files:end -->/.test(source)) {
        throw new Error("docs/standalone-export.md is missing its generated static-file block.");
    }
    return source.replace(
        /<!-- build-static-files:start -->[\s\S]*?<!-- build-static-files:end -->/,
        replacement,
    );
}

async function artifacts() {
    const workerResult = await build({
        entryPoints: [resolve(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs")],
        bundle: true,
        write: false,
        minify: true,
        format: "iife",
        target: ["es2022"],
        legalComments: "eof",
    });
    const workerSource = workerResult.outputFiles[0].contents;
    const workerScript = Buffer.from(workerSource).toString("utf8");
    if (/^\s*(?:import|export)\s/m.test(workerScript)) {
        throw new Error("The generated MapLibre worker must be self-contained classic JavaScript.");
    }
    const sharedOptions = {
        bundle: true,
        write: false,
        minify: true,
        format: "iife",
        target: ["es2022"],
        legalComments: "eof",
        define: { __MAPLIBRE_WORKER_BASE64__: JSON.stringify(Buffer.from(workerSource).toString("base64")) },
    };
    const [result, vendorResult] = await Promise.all([build({
        ...sharedOptions,
        entryPoints: [resolve(root, ".github", "extensions", "structured-itinerary-map", "browser-entry.mjs")],
        loader: { ".css": "text" },
        banner: { js: `/*! structured-itinerary-map browser library v1.0.0 | MIT | see ${MAPLIBRE_LICENSES} */` },
    }), build({
        ...sharedOptions,
        entryPoints: [resolve(root, ".github", "extensions", "structured-itinerary-map", "maplibre-global-entry.mjs")],
        banner: { js: `/*! MapLibre GL JS v${MAPLIBRE_VERSION}; see ${MAPLIBRE_LICENSES} */` },
    })]);
    const library = `${result.outputFiles[0].text.trimEnd()}\n`;
    const integrity = `sha384-${createHash("sha384").update(library).digest("base64")}`;
    const itinerary = JSON.parse(await readFile(resolve(root, "examples", "sample-itinerary.json"), "utf8"));
    const example = renderPortableItineraryHtml({
        itinerary,
        libraryUrl: "../dist/itinerary-map.v1.js",
        integrity,
    });
    const documentation = replaceIntegrityLiterals(documentationWithIntegrity(
        await readFile(browserDocumentationPath, "utf8"),
        integrity,
    ), integrity, "docs/browser-library.md");
    const readme = replaceIntegrityLiterals(
        await readFile(readmePath, "utf8"),
        integrity,
        "README.md",
    );
    const standaloneDocumentation = documentationWithStaticFiles(
        await readFile(standaloneDocumentationPath, "utf8"),
    );
    const vendorScript = `${vendorResult.outputFiles[0].text.trimEnd()}\n`;
    const vendorStylesheet = `${(await readFile(resolve(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl.css"), "utf8")).trimEnd()}\n`;
    const projectLicense = await readFile(projectLicensePath, "utf8");
    const maplibreLicense = await readFile(resolve(root, "node_modules", "maplibre-gl", "LICENSE.txt"), "utf8");
    const licenses = `Structured Itinerary Map\n\n${projectLicense.trimEnd()}\n\n---\n\nThird-party software\n\nMapLibre GL JS ${MAPLIBRE_VERSION}\n\n${maplibreLicense}`;
    return {
        library,
        integrity: `${integrity}\n`,
        example,
        documentation,
        standaloneDocumentation,
        readme,
        vendorScript,
        vendorStylesheet,
        licenses,
    };
}

async function check(expected) {
    const files = [
        [outputPath, expected.library, true],
        [integrityPath, expected.integrity, true],
        [examplePath, expected.example, false],
        [browserDocumentationPath, expected.documentation, false],
        [standaloneDocumentationPath, expected.standaloneDocumentation, false],
        [readmePath, expected.readme, false],
        [vendorScriptPath, expected.vendorScript, true],
        [vendorStylesheetPath, expected.vendorStylesheet, true],
        [licensesPath, expected.licenses, false],
    ];
    const stale = [];
    for (const [path, content, byteSensitive] of files) {
        try {
            const actual = await readFile(path, "utf8");
            const comparableActual = byteSensitive ? actual : actual.replaceAll("\r\n", "\n");
            const comparableExpected = byteSensitive ? content : content.replaceAll("\r\n", "\n");
            if (comparableActual !== comparableExpected) stale.push(path);
        } catch {
            stale.push(path);
        }
    }
    if (stale.length) {
        throw new Error(`Built browser artifacts are stale:\n${stale.map((path) => `- ${path}`).join("\n")}\nRun npm run build.`);
    }
}

const expected = await artifacts();
if (process.argv.includes("--check")) {
    await check(expected);
    process.stdout.write("Browser library and generated artifacts are current.\n");
} else {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, expected.library);
    await writeFile(integrityPath, expected.integrity);
    await writeFile(examplePath, expected.example);
    await writeFile(browserDocumentationPath, expected.documentation);
    await writeFile(standaloneDocumentationPath, expected.standaloneDocumentation);
    await writeFile(readmePath, expected.readme);
    await writeFile(vendorScriptPath, expected.vendorScript);
    await writeFile(vendorStylesheetPath, expected.vendorStylesheet);
    await writeFile(licensesPath, expected.licenses);
    process.stdout.write(`Built ${outputPath} (${Buffer.byteLength(expected.library)} bytes)\n${expected.integrity}`);
}
