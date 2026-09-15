import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_ITINERARY_BYTES } from "../.github/extensions/structured-itinerary-map/itinerary-limits.mjs";
import { validateItinerary } from "../.github/extensions/structured-itinerary-map/validation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(repositoryRoot, ".github", "extensions", "structured-itinerary-map", "itinerary.schema.json");
const schema = JSON.parse(await readFile(schemaPath, "utf8"));

export class ItineraryValidationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "ItineraryValidationError";
        this.code = code;
    }
}

function isContained(root, target) {
    const path = relative(root, target);
    return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export async function validateItineraryFile(inputPath, { projectRoot = repositoryRoot } = {}) {
    if (typeof inputPath !== "string" || !inputPath) {
        throw new ItineraryValidationError(
            "itinerary_path_required",
            "Provide a project-relative itinerary path ending in .json.",
        );
    }
    if (isAbsolute(inputPath) || /^[A-Za-z]:[\\/]/.test(inputPath) || /^[\\/]/.test(inputPath)
        || !/\.json$/.test(inputPath)) {
        throw new ItineraryValidationError(
            "itinerary_path_invalid",
            "Itinerary path must be project-relative and end in lowercase .json.",
        );
    }

    const lexicalRoot = resolve(projectRoot);
    const lexicalTarget = resolve(lexicalRoot, inputPath);
    if (!isContained(lexicalRoot, lexicalTarget)) {
        throw new ItineraryValidationError(
            "itinerary_path_invalid",
            "Itinerary path must resolve to a file inside the project.",
        );
    }

    let realRoot;
    let realTarget;
    try {
        realRoot = await realpath(projectRoot);
        realTarget = await realpath(lexicalTarget);
    } catch (error) {
        throw new ItineraryValidationError(
            "itinerary_file_unreadable",
            `Could not access itinerary "${inputPath}": ${error.message}`,
        );
    }
    if (!isContained(realRoot, realTarget)) {
        throw new ItineraryValidationError(
            "itinerary_path_invalid",
            "Itinerary path must resolve to a file inside the project.",
        );
    }

    let fileStats;
    try {
        fileStats = await stat(realTarget);
    } catch (error) {
        throw new ItineraryValidationError(
            "itinerary_file_unreadable",
            `Could not inspect itinerary "${inputPath}": ${error.message}`,
        );
    }
    if (!fileStats.isFile()) {
        throw new ItineraryValidationError(
            "itinerary_file_unreadable",
            `Itinerary "${inputPath}" is not a regular file.`,
        );
    }
    if (fileStats.size > MAX_ITINERARY_BYTES) {
        throw new ItineraryValidationError(
            "itinerary_file_too_large",
            `Itinerary is ${fileStats.size} bytes; the maximum is ${MAX_ITINERARY_BYTES} bytes.`,
        );
    }

    let source;
    try {
        source = await readFile(realTarget, "utf8");
    } catch (error) {
        throw new ItineraryValidationError(
            "itinerary_file_unreadable",
            `Could not read itinerary "${inputPath}": ${error.message}`,
        );
    }
    const bytes = Buffer.byteLength(source, "utf8");
    if (bytes > MAX_ITINERARY_BYTES) {
        throw new ItineraryValidationError(
            "itinerary_file_too_large",
            `Itinerary grew to ${bytes} bytes while being read; the maximum is ${MAX_ITINERARY_BYTES} bytes.`,
        );
    }

    let itinerary;
    try {
        itinerary = JSON.parse(source);
    } catch (error) {
        throw new ItineraryValidationError(
            "itinerary_json_invalid",
            `Could not parse itinerary as JSON: ${error.message}`,
        );
    }
    const errors = validateItinerary(itinerary, schema);
    return {
        ok: errors.length === 0,
        path: relative(realRoot, realTarget).split(sep).join("/"),
        bytes,
        schemaVersion: itinerary?.schemaVersion,
        tripId: itinerary?.trip?.id,
        errors,
    };
}

export function parseValidationArguments(args) {
    let inputPath;
    let json = false;
    for (const argument of args) {
        if (argument === "--json") {
            json = true;
        } else if (argument.startsWith("--")) {
            throw new ItineraryValidationError("itinerary_option_invalid", `Unknown option "${argument}".`);
        } else if (inputPath) {
            throw new ItineraryValidationError("itinerary_argument_invalid", "Provide exactly one itinerary path.");
        } else {
            inputPath = argument;
        }
    }
    return { inputPath, json };
}

async function main() {
    let json = process.argv.includes("--json");
    try {
        const options = parseValidationArguments(process.argv.slice(2));
        json = options.json;
        const result = await validateItineraryFile(options.inputPath);
        if (json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        } else if (result.ok) {
            process.stdout.write(`Valid itinerary: ${result.path} (${result.bytes} bytes, schema ${result.schemaVersion}, trip ${result.tripId})\n`);
        } else {
            process.stderr.write(`Itinerary validation failed with ${result.errors.length} error(s):\n`);
            process.stderr.write(`${result.errors.map((error) => `- ${error}`).join("\n")}\n`);
        }
        if (!result.ok) process.exitCode = 1;
    } catch (error) {
        const code = error instanceof ItineraryValidationError ? error.code : "itinerary_validation_internal";
        if (json) {
            process.stderr.write(`${JSON.stringify({ ok: false, code, message: error.message }, null, 2)}\n`);
        } else {
            process.stderr.write(`${code}: ${error.message}\n`);
        }
        process.exitCode = 1;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
