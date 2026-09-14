import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
    exportItineraryMap,
    exportPortableHtml,
    parseCliArguments,
} from "../scripts/export-map.mjs";
import {
    createCanvasRuntimeAdapter,
    createStandaloneRuntimeAdapter,
    focusFromHash,
    hashForFocus,
} from "../.github/extensions/structured-itinerary-map/runtime-adapters.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const samplePath = join(root, "examples", "sample-itinerary.json");
const extensionRoot = join(root, ".github", "extensions", "structured-itinerary-map");

async function fixture(t) {
    const directory = await mkdtemp(join(tmpdir(), "itinerary-export-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const source = join(directory, "itinerary.json");
    const sample = JSON.parse(await readFile(samplePath, "utf8"));
    await writeFile(source, `${JSON.stringify(sample, null, 2)}\n`);
    return { directory, source, sample };
}

function contentType(path) {
    return extname(path) === ".html" ? "text/html; charset=utf-8"
        : extname(path) === ".mjs" ? "text/javascript; charset=utf-8"
            : "application/octet-stream";
}

async function serveDirectory(rootDirectory) {
    const server = createServer(async (request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
            const relativePath = pathname.replace(/^\/+/, "") || "index.html";
            const target = resolve(rootDirectory, relativePath.endsWith("/") ? `${relativePath}index.html` : relativePath);
            const containment = relative(resolve(rootDirectory), target);
            if (containment === ".." || containment.startsWith("../") || containment.startsWith("..\\") || isAbsolute(containment)) {
                response.writeHead(404).end();
                return;
            }
            const content = await readFile(target);
            response.writeHead(200, { "Content-Type": contentType(target) });
            response.end(content);
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    return {
        server,
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
    };
}

test("valid standalone export is deterministic, shared, and safely repeatable", async (t) => {
    const { directory, source } = await fixture(t);
    const output = join(directory, "site");
    const first = await exportItineraryMap(source, output);
    assert.deepEqual(first.files, [
        "index.html", "app.mjs", "canvas-app.mjs", "client-lifecycle.mjs",
        "focus-sync.mjs", "renderer-helpers.mjs", "runtime-adapters.mjs",
        "time-helpers.mjs", "maplibre-gl.v6.9.0.js", "maplibre-gl.v6.9.0.css",
        "itinerary-map.v1.LICENSES.txt", "LICENSE", ".itinerary-map-export.json",
    ]);
    const before = new Map(await Promise.all(first.files.map(async (name) => [name, await readFile(join(output, name), "utf8")])));
    const html = before.get("index.html");
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /name="referrer" content="no-referrer"/);
    assert.match(html, /maplibre-gl\.v6\.9\.0\.js/);
    assert.match(html, /maplibre-gl\.v6\.9\.0\.css/);
    assert.match(html, /<script type="module" src="app\.mjs"><\/script>/);
    assert.match(html, /"runtimeMode":"standalone"/);
    assert.doesNotMatch(html, /127\.0\.0\.1|\/events|\/focus/);
    assert.equal(before.get("canvas-app.mjs"), await readFile(join(extensionRoot, "canvas-app.mjs"), "utf8"));
    assert.equal(before.get("renderer-helpers.mjs"), await readFile(join(extensionRoot, "renderer-helpers.mjs"), "utf8"));
    assert.equal(before.get("LICENSE"), await readFile(join(root, "LICENSE"), "utf8"));
    assert.match(before.get("itinerary-map.v1.LICENSES.txt"), /MIT License/);
    assert.match(before.get("itinerary-map.v1.LICENSES.txt"), /MapLibre GL JS 6\.9\.0/);
    await writeFile(join(output, "user-note.txt"), "preserve me");
    await exportItineraryMap(source, output);
    assert.equal(await readFile(join(output, "user-note.txt"), "utf8"), "preserve me");
    for (const [name, content] of before) assert.equal(await readFile(join(output, name), "utf8"), content);
    for (const name of first.files.filter((name) => name.endsWith(".mjs"))) {
        await execFileAsync(process.execPath, ["--check", join(output, name)]);
    }
});

test("export rejects schema, semantic, missing, oversized, and extension errors", async (t) => {
    const { directory, source, sample } = await fixture(t);
    const schemaInvalid = join(directory, "schema-invalid.json");
    await writeFile(schemaInvalid, JSON.stringify({ schemaVersion: "1.0" }));
    await assert.rejects(exportItineraryMap(schemaInvalid, join(directory, "schema-site")), /Itinerary validation failed/);
    const semanticInvalid = structuredClone(sample);
    semanticInvalid.days[0].locationIds = ["missing-location"];
    const semanticPath = join(directory, "semantic-invalid.json");
    await writeFile(semanticPath, JSON.stringify(semanticInvalid));
    await assert.rejects(exportItineraryMap(semanticPath, join(directory, "semantic-site")), /unknown location/);
    await assert.rejects(exportItineraryMap(join(directory, "missing.json"), join(directory, "missing-site")), /Could not access source/);
    const oversized = join(directory, "oversized.json");
    await writeFile(oversized, " ".repeat(1024 * 1024 + 1));
    await assert.rejects(exportItineraryMap(oversized, join(directory, "large-site")), /maximum is 1048576 bytes/);
    const wrongExtension = join(directory, "itinerary.txt");
    await writeFile(wrongExtension, "{}");
    await assert.rejects(exportItineraryMap(wrongExtension, join(directory, "text-site")), /must end in \.json/);
    await assert.rejects(exportItineraryMap(source, source), /must not equal the source/);
});

test("export refuses files, source-containing outputs, unrelated content, and bad markers", async (t) => {
    const { directory, source } = await fixture(t);
    const outputFile = join(directory, "output-file");
    await writeFile(outputFile, "not a directory");
    await assert.rejects(exportItineraryMap(source, outputFile), /not a directory/);
    await assert.rejects(exportItineraryMap(source, directory), /must not contain or equal the source/);
    const alias = join(dirname(directory), `${basename(directory)}-alias`);
    t.after(() => rm(alias, { recursive: true, force: true }));
    let aliasCreated = true;
    try {
        await symlink(directory, alias, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
        aliasCreated = false;
        t.diagnostic(`Output symlink safety test skipped: ${error.code}`);
    }
    if (aliasCreated) {
        await assert.rejects(exportItineraryMap(source, alias), /must not contain or equal the source/);
        const aliasedSource = join(alias, basename(source));
        await assert.rejects(exportItineraryMap(aliasedSource, aliasedSource), /must not equal the source/);
    }
    const unrelated = join(directory, "unrelated");
    await mkdir(unrelated);
    await writeFile(join(unrelated, "keep.txt"), "unrelated");
    await assert.rejects(exportItineraryMap(source, unrelated), /not empty/);
    const badMarker = join(directory, "bad-marker");
    await mkdir(badMarker);
    await writeFile(join(badMarker, ".itinerary-map-export.json"), JSON.stringify({ generator: "other", version: 1, files: [] }));
    await assert.rejects(exportItineraryMap(source, badMarker), /not recognized/);
});

test("CLI reports actionable failures with a nonzero status", async (t) => {
    const { directory } = await fixture(t);
    await assert.rejects(
        execFileAsync(process.execPath, [join(root, "scripts", "export-map.mjs"), join(directory, "missing.json"), join(directory, "site")]),
        (error) => error.code === 1 && /Could not access source/.test(error.stderr),
    );
});

test("single-HTML export validates library metadata and overwrites only its own output", async (t) => {
    const { directory, source } = await fixture(t);
    const output = join(directory, "portable.html");
    const integrity = `sha384-${"A".repeat(64)}`;
    await exportPortableHtml(source, output, {
        libraryUrl: "https://cdn.example/maps/itinerary-map.v1.js",
        integrity,
    });
    const first = await readFile(output, "utf8");
    assert.match(first, /structured-itinerary-map-library\/1/);
    assert.match(first, /src="https:\/\/cdn\.example\/maps\/itinerary-map\.v1\.js"/);
    assert.match(first, new RegExp(`integrity="${integrity}"`));
    await exportPortableHtml(source, output, {
        libraryUrl: "https://cdn.example/maps/itinerary-map.v1.js",
        integrity,
    });
    assert.equal(await readFile(output, "utf8"), first);
    const unrelated = join(directory, "unrelated.html");
    await writeFile(unrelated, "<!doctype html><title>User file</title>");
    await assert.rejects(
        exportPortableHtml(source, unrelated, { libraryUrl: "./library.js" }),
        /was not generated/,
    );
    await assert.rejects(
        exportPortableHtml(source, join(directory, "bad.txt"), { libraryUrl: "./library.js" }),
        /must end in \.html/,
    );
    await assert.rejects(
        exportPortableHtml(source, join(directory, "remote.html"), { libraryUrl: "https://cdn.example/library.js" }),
        /--integrity value is required/,
    );
    await assert.rejects(
        exportPortableHtml(source, join(directory, "unsafe.html"), { libraryUrl: "data:text/javascript,alert(1)" }),
        /libraryUrl/,
    );
    assert.deepEqual(parseCliArguments([
        source, output, "--library-url", "./library.js", "--integrity", integrity,
    ]), {
        sourcePath: source,
        outputPath: output,
        libraryUrl: "./library.js",
        integrity,
    });
});

test("generated nested site and every module load from ordinary static HTTP", async (t) => {
    const { directory, source } = await fixture(t);
    const output = join(directory, "pages", "trips", "asia");
    const result = await exportItineraryMap(source, output);
    const host = await serveDirectory(directory);
    t.after(() => host.close());
    for (const name of result.files.filter((name) => name !== ".itinerary-map-export.json")) {
        const response = await fetch(`${host.origin}/pages/trips/asia/${name}`);
        assert.equal(response.status, 200, name);
        assert((await response.arrayBuffer()).byteLength > 0, name);
    }
    const index = await (await fetch(`${host.origin}/pages/trips/asia/`)).text();
    assert.match(index, /src="app\.mjs"/);
});

test("standalone adapter keeps focus local, shareable, and back-forward safe", async () => {
    const listeners = new Map();
    const location = { pathname: "/nested/site/", search: "?view=map", hash: "#location=hanoi" };
    const window = {
        location,
        history: {
            pushState(_state, _title, value) {
                const url = new URL(value, "https://example.test");
                location.pathname = url.pathname;
                location.search = url.search;
                location.hash = url.hash;
            },
        },
        addEventListener: (name, handler) => listeners.set(name, handler),
        removeEventListener: (name) => listeners.delete(name),
    };
    assert.deepEqual(focusFromHash("#location=hanoi&day=day-1", ""), { locationId: "hanoi", dayId: "day-1" });
    assert.equal(hashForFocus({ dayId: "day-1", locationId: "hanoi" }, ""), "#location=hanoi&day=day-1");
    const adapter = createStandaloneRuntimeAdapter({ window, namespace: "" });
    assert.deepEqual(adapter.initialFocus({}), { locationId: "hanoi" });
    const received = [];
    const unsubscribe = adapter.subscribe({ focus: (state) => received.push(state.focus) });
    const update = await adapter.updateFocus({ locationId: "singapore", dayId: "day-2" });
    assert.equal(update.ok, true);
    assert.equal(location.hash, "#location=singapore&day=day-2");
    location.hash = "#location=hanoi";
    listeners.get("popstate")();
    assert.deepEqual(received, [{ locationId: "hanoi" }]);
    listeners.get("hashchange")();
    assert.equal(received.length, 1, "paired browser events must not apply the same history state twice");
    unsubscribe();
    assert.equal(listeners.size, 0);
});

test("standalone adapters preserve hash opt-out and define namespace collision behavior", async () => {
    assert.deepEqual(focusFromHash("#location=hostile&day=hostile", undefined), {});
    assert.equal(
        hashForFocus({ dayId: "ignored" }, undefined, "#location=hostile&day=hostile"),
        "#location=hostile&day=hostile",
    );
    assert.deepEqual(focusFromHash("#safe.day=%3Cscript%3E", "safe"), { dayId: "<script>" });
    assert.equal(hashForFocus({ dayId: "<script>" }, "safe"), "#safe.day=%3Cscript%3E");
    const listeners = new Map();
    const pushes = [];
    const location = { pathname: "/map/", search: "", hash: "#keep=value" };
    const window = {
        location,
        history: {
            pushState(_state, _title, value) {
                pushes.push(value);
                location.hash = new URL(value, "https://example.test").hash;
            },
        },
        addEventListener(name, handler) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(handler);
        },
        removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    };
    const firstLocal = createStandaloneRuntimeAdapter({ window, namespace: undefined });
    const secondLocal = createStandaloneRuntimeAdapter({ window, namespace: undefined });
    const unsubscribeLocal = [
        firstLocal.subscribe({ focus() {} }),
        secondLocal.subscribe({ focus() {} }),
    ];
    await firstLocal.updateFocus({ dayId: "day-1" });
    await secondLocal.updateFocus({ dayId: "day-2" });
    assert.equal(location.hash, "#keep=value");
    assert.equal(pushes.length, 0);
    assert.equal(listeners.size, 0);
    unsubscribeLocal.forEach((unsubscribe) => unsubscribe());

    const left = createStandaloneRuntimeAdapter({ window, namespace: "left" });
    const right = createStandaloneRuntimeAdapter({ window, namespace: "right" });
    await left.updateFocus({ dayId: "day-a" });
    await right.updateFocus({ dayId: "day-b" });
    assert.equal(location.hash, "#keep=value&left.day=day-a&right.day=day-b");

    const sameA = createStandaloneRuntimeAdapter({ window, namespace: "shared" });
    const sameB = createStandaloneRuntimeAdapter({ window, namespace: "shared" });
    const received = [];
    const unsubA = sameA.subscribe({ focus: ({ focus }) => received.push(["a", focus]) });
    const unsubB = sameB.subscribe({ focus: ({ focus }) => received.push(["b", focus]) });
    await sameA.updateFocus({ dayId: "first" });
    await sameB.updateFocus({ dayId: "last-writer" });
    assert.match(location.hash, /shared\.day=last-writer/);
    for (const handler of listeners.get("popstate")) handler();
    assert.deepEqual(received, [
        ["a", { dayId: "last-writer" }],
    ], "same namespaces are shared and reconcile to the last URL writer");
    unsubA();
    unsubB();
    assert.equal([...listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
});

test("canvas adapter retains production HTTP and SSE synchronization", async () => {
    const requests = [];
    const handlers = new Map();
    class FakeEventSource {
        addEventListener(name, handler) { handlers.set(name, handler); }
        close() { this.closed = true; }
    }
    const adapter = createCanvasRuntimeAdapter({
        fetch: async (url, options) => {
            requests.push([url, options]);
            return {
                ok: true,
                status: 200,
                json: async () => ({ focus: { locationId: "hanoi" }, focusRevision: 2 }),
            };
        },
        EventSource: FakeEventSource,
    });
    assert.deepEqual(adapter.initialFocus({ locationId: "singapore" }), { locationId: "singapore" });
    const result = await adapter.updateFocus({ locationId: "hanoi" }, 1);
    assert.equal(result.state.focusRevision, 2);
    assert.equal(requests[0][0], "focus");
    let received;
    const unsubscribe = adapter.subscribe({ focus: (state) => { received = state; } });
    handlers.get("focus")({ data: JSON.stringify({ focus: {}, focusRevision: 3 }) });
    assert.equal(received.focusRevision, 3);
    unsubscribe();
});
