import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
    ItineraryValidationError,
    parseValidationArguments,
    validateItineraryFile,
} from "../scripts/validate-itinerary.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const command = join(root, "scripts", "validate-itinerary.mjs");
const sample = JSON.parse(await readFile(join(root, "examples", "sample-itinerary.json"), "utf8"));

async function fixture(t) {
    const projectRoot = await mkdtemp(join(tmpdir(), "itinerary-validator-"));
    t.after(() => rm(projectRoot, { recursive: true, force: true }));
    const itineraryDirectory = join(projectRoot, "itineraries");
    await mkdir(itineraryDirectory);
    const path = join(itineraryDirectory, "sample.json");
    await writeFile(path, `${JSON.stringify(sample, null, 2)}\n`);
    return { projectRoot, path };
}

test("validation CLI helper accepts the canonical sample", async (t) => {
    const { projectRoot } = await fixture(t);
    const result = await validateItineraryFile("itineraries/sample.json", { projectRoot });
    assert.equal(result.ok, true);
    assert.equal(result.path, "itineraries/sample.json");
    assert.equal(result.schemaVersion, "1.0");
    assert.equal(result.tripId, sample.trip.id);
    assert.deepEqual(result.errors, []);
});

test("validation CLI helper reports schema and semantic errors", async (t) => {
    const { projectRoot, path } = await fixture(t);
    await writeFile(path, JSON.stringify({ schemaVersion: "1.0" }));
    const schemaResult = await validateItineraryFile("itineraries/sample.json", { projectRoot });
    assert.equal(schemaResult.ok, false);
    assert(schemaResult.errors.some((error) => error.includes("$.trip: is required")));

    const semanticInvalid = structuredClone(sample);
    semanticInvalid.days[0].locationIds = ["missing-location"];
    await writeFile(path, JSON.stringify(semanticInvalid));
    const semanticResult = await validateItineraryFile("itineraries/sample.json", { projectRoot });
    assert.equal(semanticResult.ok, false);
    assert(semanticResult.errors.some((error) => error.includes('unknown location "missing-location"')));
});

test("validation CLI helper rejects missing, oversized, outside, and invalid paths", async (t) => {
    const { projectRoot } = await fixture(t);
    await assert.rejects(
        validateItineraryFile("itineraries/missing.json", { projectRoot }),
        (error) => error instanceof ItineraryValidationError && error.code === "itinerary_file_unreadable",
    );
    const oversized = join(projectRoot, "itineraries", "oversized.json");
    await writeFile(oversized, " ".repeat(1024 * 1024 + 1));
    await assert.rejects(
        validateItineraryFile("itineraries/oversized.json", { projectRoot }),
        (error) => error.code === "itinerary_file_too_large",
    );
    await assert.rejects(
        validateItineraryFile("../outside.json", { projectRoot }),
        (error) => error.code === "itinerary_path_invalid",
    );
    await assert.rejects(
        validateItineraryFile("itineraries/sample.JSON", { projectRoot }),
        (error) => error.code === "itinerary_path_invalid",
    );
});

test("validation CLI exit codes and human and JSON output are actionable", async (t) => {
    const valid = await execFileAsync(process.execPath, [command, "examples/sample-itinerary.json"], { cwd: root });
    assert.match(valid.stdout, /^Valid itinerary: examples\/sample-itinerary\.json/);
    assert.equal(valid.stderr, "");

    const directory = await mkdtemp(join(root, ".test-work-validator-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const invalidPath = join(directory, "invalid.json");
    await writeFile(invalidPath, JSON.stringify({ schemaVersion: "1.0" }));
    const relativePath = invalidPath.slice(root.length + 1).replaceAll("\\", "/");
    await assert.rejects(
        execFileAsync(process.execPath, [command, relativePath, "--json"], { cwd: root }),
        (error) => {
            assert.equal(error.code, 1);
            const result = JSON.parse(error.stdout);
            return result.ok === false && result.errors.some((item) => item.includes("$.trip: is required"));
        },
    );
});

test("validation CLI argument parser rejects ambiguous input", () => {
    assert.deepEqual(parseValidationArguments(["itineraries/trip.json", "--json"]), {
        inputPath: "itineraries/trip.json",
        json: true,
    });
    assert.throws(() => parseValidationArguments(["one.json", "two.json"]), /exactly one/);
    assert.throws(() => parseValidationArguments(["--verbose"]), /Unknown option/);
});
