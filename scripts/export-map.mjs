import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHtml } from "../.github/extensions/structured-itinerary-map/renderer.mjs";
import { MAX_ITINERARY_BYTES } from "../.github/extensions/structured-itinerary-map/runtime-helpers.mjs";
import { validateItinerary } from "../.github/extensions/structured-itinerary-map/validation.mjs";
import {
    MAPLIBRE_LICENSES,
    MAPLIBRE_SCRIPT,
    MAPLIBRE_STYLESHEET,
} from "../.github/extensions/structured-itinerary-map/maplibre-config.mjs";
import {
    contentNonce,
    renderPortableItineraryHtml,
    validateIntegrity,
    validateLibraryUrl,
} from "./browser-library-helpers.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = resolve(repositoryRoot, ".github", "extensions", "structured-itinerary-map");
const MANIFEST_NAME = ".itinerary-map-export.json";
const PROJECT_LICENSE = "LICENSE";
export const EXPORT_VERSION = 2;
const MODULES = [
    ["canvas-bootstrap.mjs", "app.mjs"],
    ["canvas-app.mjs", "canvas-app.mjs"],
    ["client-lifecycle.mjs", "client-lifecycle.mjs"],
    ["focus-sync.mjs", "focus-sync.mjs"],
    ["renderer-helpers.mjs", "renderer-helpers.mjs"],
    ["runtime-adapters.mjs", "runtime-adapters.mjs"],
    ["time-helpers.mjs", "time-helpers.mjs"],
];
const VENDOR_FILES = [MAPLIBRE_SCRIPT, MAPLIBRE_STYLESHEET, MAPLIBRE_LICENSES];
export const GENERATED_FILES = [
    "index.html",
    ...MODULES.map(([, destination]) => destination),
    ...VENDOR_FILES,
    PROJECT_LICENSE,
    MANIFEST_NAME,
];

export class ExportError extends Error {
    constructor(message) {
        super(message);
        this.name = "ExportError";
    }
}

function isWithin(parent, child) {
    const path = relative(parent, child);
    return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function loadSource(sourcePath) {
    if (extname(sourcePath).toLowerCase() !== ".json") throw new ExportError("Source itinerary must end in .json.");
    let sourceRealPath;
    let sourceStats;
    try {
        sourceRealPath = await realpath(sourcePath);
        sourceStats = await stat(sourceRealPath);
    } catch (error) {
        throw new ExportError(`Could not access source itinerary "${sourcePath}": ${error.message}`);
    }

    if (!sourceStats.isFile()) throw new ExportError(`Source itinerary "${sourcePath}" is not a regular file.`);
    if (sourceStats.size > MAX_ITINERARY_BYTES) {
        throw new ExportError(`Source itinerary is ${sourceStats.size} bytes; the maximum is ${MAX_ITINERARY_BYTES} bytes.`);
    }
    const source = await readFile(sourceRealPath, "utf8");
    const bytes = Buffer.byteLength(source, "utf8");
    if (bytes > MAX_ITINERARY_BYTES) {
        throw new ExportError(`Source itinerary grew to ${bytes} bytes while being read; the maximum is ${MAX_ITINERARY_BYTES} bytes.`);
    }
    let itinerary;
    try {
        itinerary = JSON.parse(source);
    } catch (error) {
        throw new ExportError(`Could not parse source itinerary as JSON: ${error.message}`);
    }
    return { itinerary, sourceRealPath };
}

async function loadValidatedSource(sourcePath) {
    const loaded = await loadSource(resolve(sourcePath));
    const schema = JSON.parse(await readFile(resolve(extensionRoot, "itinerary.schema.json"), "utf8"));
    const errors = validateItinerary(loaded.itinerary, schema);
    if (errors.length) {
        throw new ExportError(`Itinerary validation failed:\n${errors.slice(0, 20).map((error) => `- ${error}`).join("\n")}${errors.length > 20 ? `\n- …and ${errors.length - 20} more` : ""}`);
    }
    return loaded;
}

async function inspectOutput(outputPath, sourceRealPath) {
    let resolvedOutput = resolve(outputPath);
    if (resolvedOutput === sourceRealPath) {
        throw new ExportError("Output directory must not equal the source itinerary.");
    }
    let outputStats;
    try {
        outputStats = await stat(resolvedOutput);
    } catch (error) {
        if (error.code !== "ENOENT") throw new ExportError(`Could not inspect output "${outputPath}": ${error.message}`);
        let ancestor = dirname(resolvedOutput);
        const suffix = [basename(resolvedOutput)];
        while (true) {
            try {
                const realAncestor = await realpath(ancestor);
                resolvedOutput = resolve(realAncestor, ...suffix.reverse());
                break;
            } catch (ancestorError) {
                if (ancestorError.code !== "ENOENT") throw new ExportError(`Could not resolve output "${outputPath}": ${ancestorError.message}`);
                const parent = dirname(ancestor);
                if (parent === ancestor) throw new ExportError(`Could not resolve an existing parent for output "${outputPath}".`);
                suffix.push(basename(ancestor));
                ancestor = parent;
            }
        }
        if (resolvedOutput === sourceRealPath) {
            throw new ExportError("Output directory must not equal the source itinerary.");
        }
        if (isWithin(resolvedOutput, sourceRealPath)) {
            throw new ExportError("Output directory must not contain or equal the source itinerary.");
        }
        return resolvedOutput;
    }
    resolvedOutput = await realpath(resolvedOutput);
    if (resolvedOutput === sourceRealPath) {
        throw new ExportError("Output directory must not equal the source itinerary.");
    }
    if (isWithin(resolvedOutput, sourceRealPath)) {
        throw new ExportError("Output directory must not contain or equal the source itinerary.");
    }
    if (!outputStats.isDirectory()) throw new ExportError(`Output "${outputPath}" exists and is not a directory.`);
    let manifest;
    try {
        manifest = JSON.parse(await readFile(resolve(resolvedOutput, MANIFEST_NAME), "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") {
            const entries = await readdir(resolvedOutput);
            if (entries.length) {
                throw new ExportError(`Output directory is not empty and has no ${MANIFEST_NAME} ownership marker.`);
            }
            return resolvedOutput;
        }
        throw new ExportError(`Output ownership marker is invalid: ${error.message}`);
    }
    if (manifest.generator !== "structured-itinerary-map-export"
        || manifest.version !== EXPORT_VERSION
        || !Array.isArray(manifest.files)
        || manifest.files.length !== GENERATED_FILES.length
        || manifest.files.some((file, index) => file !== GENERATED_FILES[index])) {
        throw new ExportError(`Output ownership marker ${MANIFEST_NAME} is not recognized.`);
    }
    return resolvedOutput;
}

export async function exportItineraryMap(sourcePath, outputPath) {
    if (!sourcePath || !outputPath) throw new ExportError("Usage: node scripts/export-map.mjs <itinerary.json> <output-directory>");
    const { itinerary, sourceRealPath } = await loadValidatedSource(sourcePath);
    const resolvedOutput = await inspectOutput(outputPath, sourceRealPath);
    await mkdir(resolvedOutput, { recursive: true });
    const documentId = basename(sourceRealPath, extname(sourceRealPath)).replace(/[^A-Za-z0-9._-]/g, "-") || "itinerary";
    const files = new Map();
    files.set("index.html", renderHtml({
        itinerary,
        documentId,
        initialFocus: {},
        revision: 1,
        focusRevision: 0,
        nonce: contentNonce(itinerary, "static-folder", documentId, "standalone-map"),
        runtimeMode: "standalone",
        bootstrapPath: "app.mjs",
    }));
    for (const [source, destination] of MODULES) {
        files.set(destination, await readFile(resolve(extensionRoot, source), "utf8"));
    }
    for (const name of VENDOR_FILES) {
        files.set(name, await readFile(resolve(repositoryRoot, "dist", name), "utf8"));
    }
    files.set(PROJECT_LICENSE, await readFile(resolve(repositoryRoot, PROJECT_LICENSE), "utf8"));
    files.set(MANIFEST_NAME, `${JSON.stringify({
        generator: "structured-itinerary-map-export",
        version: EXPORT_VERSION,
        files: GENERATED_FILES,
        schemaVersion: itinerary.schemaVersion,
    }, null, 2)}\n`);
    for (const [name, content] of files) {
        await writeFile(resolve(resolvedOutput, name), content, "utf8");
    }
    return { outputDirectory: resolvedOutput, files: [...files.keys()] };
}

export async function exportPortableHtml(sourcePath, outputPath, { libraryUrl, integrity = "" }) {
    if (!sourcePath || !outputPath) {
        throw new ExportError("Usage: node scripts/export-map.mjs <itinerary.json> <output.html> --library-url <url> [--integrity <sha384-value>]");
    }
    if (extname(outputPath).toLowerCase() !== ".html") throw new ExportError("Single-HTML output path must end in .html.");
    let url;
    let sri;
    try {
        url = validateLibraryUrl(libraryUrl);
        sri = validateIntegrity(integrity);
    } catch (error) {
        throw new ExportError(error.message);
    }
    if (/^https?:/i.test(url) && !sri) {
        throw new ExportError("A sha384 --integrity value is required for an HTTP(S) library URL.");
    }
    const { itinerary, sourceRealPath } = await loadValidatedSource(sourcePath);
    const resolvedOutput = resolve(outputPath);
    if (resolvedOutput === sourceRealPath) throw new ExportError("Output HTML must not equal the source itinerary.");
    try {
        const outputStats = await lstat(resolvedOutput);
        if (outputStats.isSymbolicLink()) throw new ExportError("Output HTML must not be a symbolic link.");
        if (!outputStats.isFile()) throw new ExportError(`Output "${outputPath}" exists and is not a regular file.`);
        const existing = await readFile(resolvedOutput, "utf8");
        if (!existing.includes('<meta name="generator" content="structured-itinerary-map-library/1">')) {
            throw new ExportError("Output HTML exists and was not generated by this itinerary-map exporter.");
        }
    } catch (error) {
        if (error instanceof ExportError) throw error;
        if (error.code !== "ENOENT") throw new ExportError(`Could not inspect output HTML "${outputPath}": ${error.message}`);
    }
    await mkdir(dirname(resolvedOutput), { recursive: true });
    await writeFile(resolvedOutput, renderPortableItineraryHtml({ itinerary, libraryUrl: url, integrity: sri }), "utf8");
    return { outputFile: resolvedOutput };
}

export function parseCliArguments(args) {
    const [sourcePath, outputPath, ...options] = args;
    const parsed = { sourcePath, outputPath, libraryUrl: undefined, integrity: "" };
    for (let index = 0; index < options.length; index += 1) {
        const option = options[index];
        if (option === "--library-url" || option === "--integrity") {
            const value = options[index + 1];
            if (!value || value.startsWith("--")) throw new ExportError(`${option} requires a value.`);
            parsed[option === "--library-url" ? "libraryUrl" : "integrity"] = value;
            index += 1;
        } else {
            throw new ExportError(`Unknown option "${option}".`);
        }
    }
    return parsed;
}

async function main() {
    try {
        const options = parseCliArguments(process.argv.slice(2));
        if (options.outputPath?.toLowerCase().endsWith(".html") || options.libraryUrl) {
            const result = await exportPortableHtml(options.sourcePath, options.outputPath, options);
            process.stdout.write(`Exported portable itinerary HTML to ${result.outputFile}\n`);
        } else {
            const result = await exportItineraryMap(options.sourcePath, options.outputPath);
            process.stdout.write(`Exported ${result.files.length} files to ${result.outputDirectory}\n`);
        }
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
