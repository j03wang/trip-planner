import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const validator = join(root, ".github", "skills", "plan-trip", "scripts", "validate.mjs");
test("portable skill validates a nested itinerary from another project", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "plan-trip-portable-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const upstream = join(directory, "upstream");
    const tooling = join(directory, "tooling");
    const project = join(directory, "my-trips");
    const itineraryPath = "trips/asia-sample/itinerary.json";
    await execFileAsync("git", ["clone", "--quiet", "--no-checkout", root, upstream]);
    await execFileAsync("git", ["-C", upstream, "checkout", "--quiet", "-B", "main", "HEAD"]);
    await execFileAsync("git", ["clone", "--quiet", "--branch", "main", upstream, tooling]);
    await mkdir(join(project, "trips", "asia-sample"), { recursive: true });
    const itinerary = await readFile(join(root, "examples", "sample-itinerary.json"), "utf8");
    await writeFile(join(project, itineraryPath), itinerary);

    const result = await execFileAsync(process.execPath, [validator, tooling, itineraryPath], { cwd: project });
    assert.match(result.stdout, /^Valid itinerary: trips\/asia-sample\/itinerary\.json/);
    assert.equal(result.stderr, "");

    const mapOutput = join(directory, "map");
    const exportResult = await execFileAsync(process.execPath, [
        join(tooling, "scripts", "export-map.mjs"), itineraryPath, mapOutput,
    ], { cwd: project });
    assert.match(exportResult.stdout, /^Exported 13 files/);
    assert.match(await readFile(join(mapOutput, "index.html"), "utf8"), /asia-sampler/);

    await writeFile(join(project, itineraryPath), JSON.stringify({ schemaVersion: "1.0" }));
    await assert.rejects(
        execFileAsync(process.execPath, [validator, tooling, itineraryPath], { cwd: project }),
        (error) => error.code === 1 && error.stderr.includes("$.trip: is required"),
    );
    await assert.rejects(
        execFileAsync(process.execPath, [validator, tooling, "../outside.json"], { cwd: project }),
        (error) => error.code === 1 && error.stderr.includes("project"),
    );

    await writeFile(join(upstream, "fresh.txt"), "updated tooling\n");
    await execFileAsync("git", ["-C", upstream, "add", "fresh.txt"]);
    await execFileAsync("git", [
        "-C", upstream, "-c", "user.name=Test", "-c", "user.email=test@example.com",
        "commit", "--quiet", "-m", "Update tooling",
    ]);
    await assert.rejects(
        execFileAsync(process.execPath, [validator, tooling, itineraryPath], { cwd: project }),
        (error) => error.code === 1 && error.stderr.includes("outdated"),
    );

    await execFileAsync("git", ["-C", tooling, "checkout", "--quiet", "--detach", "origin/main"]);
    await writeFile(join(project, itineraryPath), itinerary);
    const refreshed = await execFileAsync(process.execPath, [validator, tooling, itineraryPath], { cwd: project });
    assert.match(refreshed.stdout, /^Valid itinerary:/);

    await writeFile(join(tooling, "scripts", "validate-itinerary.mjs"), "// modified\n");
    await assert.rejects(
        execFileAsync(process.execPath, [validator, tooling, itineraryPath], { cwd: project }),
        (error) => error.code === 1 && error.stderr.includes("modified tracked files"),
    );
});
