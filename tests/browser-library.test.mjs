import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { Window } from "happy-dom";
import {
    createItineraryMapElementClass,
    registerItineraryMap,
} from "../.github/extensions/structured-itinerary-map/browser-component.mjs";
import { MAPLIBRE_VERSION } from "../.github/extensions/structured-itinerary-map/maplibre-config.mjs";
import { cameraAnimationOptions } from "../.github/extensions/structured-itinerary-map/renderer-helpers.mjs";
import {
    renderPortableItineraryHtml,
    safeEmbeddedJson,
    validateIntegrity,
    validateLibraryUrl,
} from "../scripts/browser-library-helpers.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const sample = JSON.parse(await readFile(resolve(root, "examples", "sample-itinerary.json"), "utf8"));

function setupWindow() {
    const window = new Window({ url: "https://example.test/maps/page.html" });
    window.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const ElementClass = createItineraryMapElementClass({
        window,
        maplibregl: {},
        maplibreCss: ".maplibregl-map{position:relative}",
        mapErrorDelay: 0,
    });
    assert.equal(ElementClass.version, "1.0.0");
    window.customElements.define("itinerary-map", ElementClass);
    return window;
}

function setMediaPreferences(window, { dark, reduced }) {
    window.matchMedia = (query) => ({
        matches: query.includes("prefers-color-scheme") ? dark
            : query.includes("prefers-reduced-motion") ? reduced
                : false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
    });
}

function appendSource(window, id, value) {
    const source = window.document.createElement("script");
    source.id = id;
    source.type = "application/json";
    source.textContent = typeof value === "string" ? value : JSON.stringify(value);
    window.document.body.appendChild(source);
    return source;
}

function appendMap(window, sourceId) {
    const element = window.document.createElement("itinerary-map");
    if (sourceId) element.setAttribute("data-source", sourceId);
    window.document.body.appendChild(element);
    return element;
}

function providerStyle() {
    return {
        version: 8,
        sources: {
            openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
        },
        layers: [
            { id: "background", type: "background", paint: { "background-color": "#ffffff" } },
            { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water" },
        ],
    };
}

const tick = () => new Promise((resolveTick) => setTimeout(resolveTick, 10));

function fakeMapLibre(records) {
    class Popup {
        setDOMContent(content) { this.content = content; return this; }
        setLngLat(value) { this.lngLat = value; return this; }
        addTo() { this.open = true; return this; }
        isOpen() { return Boolean(this.open); }
    }
    class Marker {
        constructor({ element }) { this.element = element; records.markers.push(this); }
        setLngLat(value) { this.lngLat = value; return this; }
        setPopup(value) { this.popup = value; return this; }
        getPopup() { return this.popup; }
        getElement() { return this.element; }
        addTo() { this.added = true; return this; }
        remove() { this.added = false; this.removed = true; }
        togglePopup() { this.popup.open = !this.popup.open; return this; }
    }
    class LngLatBounds {
        constructor() { this.points = []; }
        extend(point) { this.points.push(point); return this; }
    }
    class Map {
        constructor(options) {
            this.options = options;
            this.handlers = new globalThis.Map();
            this.sources = new globalThis.Map();
            this.layers = new globalThis.Map();
            this.style = options.style;
            records.maps.push(this);
            queueMicrotask(() => this.emit("style.load"));
        }
        on(name, layerOrHandler, handler) {
            const callback = handler ?? layerOrHandler;
            const key = handler ? `${name}:${layerOrHandler}` : name;
            if (!this.handlers.has(key)) this.handlers.set(key, []);
            this.handlers.get(key).push(callback);
        }
        emit(name, value = {}, layerId) {
            for (const handler of this.handlers.get(name) ?? []) handler(value);
            if (layerId) {
                for (const handler of this.handlers.get(`${name}:${layerId}`) ?? []) handler(value);
            }
        }
        addControl(control) { records.controls.push(control); }
        isStyleLoaded() { return true; }
        getStyle() { return this.style; }
        setStyle(style) { this.style = style; queueMicrotask(() => this.emit("style.load")); }
        addSource(id, source) { this.sources.set(id, source); }
        getSource(id) { return this.sources.get(id); }
        removeSource(id) { this.sources.delete(id); }
        addLayer(layer) { this.layers.set(layer.id, layer); }
        getLayer(id) { return this.layers.get(id); }
        removeLayer(id) { this.layers.delete(id); }
        setFilter(id, filter) { records.filters.push([id, filter]); }
        setLayoutProperty(id, property, value) { records.layouts.push([id, property, value]); }
        getCanvas() { return { style: {} }; }
        resize() { records.resizes += 1; }
        flyTo(options) { records.cameras.push(["fly", options]); }
        fitBounds(bounds, options) { records.cameras.push(["bounds", bounds.points, options]); }
        getZoom() { return 10; }
        remove() { this.removed = true; records.removes += 1; }
    }
    return { Map, Marker, Popup, LngLatBounds, NavigationControl: class {} };
}

test("two browser components render and filter independently with shared production UI", async (t) => {
    const window = setupWindow();
    t.after(() => window.close());
    let historyWrites = 0;
    const nativePushState = window.history.pushState.bind(window.history);
    window.history.pushState = (...args) => {
        historyWrites += 1;
        return nativePushState(...args);
    };
    appendSource(window, "trip-a", sample);
    appendSource(window, "trip-b", sample);
    const hostMain = window.document.createElement("main");
    window.document.body.appendChild(hostMain);
    const ready = [];
    const first = window.document.createElement("itinerary-map");
    first.setAttribute("data-source", "trip-a");
    first.addEventListener("itinerary-map-ready", (event) => ready.push(event.detail));
    hostMain.appendChild(first);
    const second = window.document.createElement("itinerary-map");
    second.setAttribute("data-source", "trip-b");
    hostMain.appendChild(second);
    await tick();
    assert.equal(first.shadowRoot.getElementById("trip-title").textContent, sample.trip.title);
    assert.equal(second.shadowRoot.getElementById("trip-title").textContent, sample.trip.title);
    assert.equal(first.shadowRoot.querySelectorAll(".card").length, 11);
    assert.equal(second.shadowRoot.querySelectorAll(".card").length, 11);
    first.shadowRoot.querySelector('[data-day-id="singapore-waterfront"]').click();
    await tick();
    assert.equal(window.location.hash, "");
    assert.equal(historyWrites, 0);
    const firstStreet = [...first.shadowRoot.querySelectorAll("#chips .chip")]
        .find((button) => button.textContent.includes("Street"));
    const secondStreet = [...second.shadowRoot.querySelectorAll("#chips .chip")]
        .find((button) => button.textContent.includes("Street"));
    firstStreet.click();
    assert.equal(firstStreet.getAttribute("aria-pressed"), "false");
    assert.equal(secondStreet.getAttribute("aria-pressed"), "true");
    assert.notEqual(first.shadowRoot.getElementById("count").textContent, second.shadowRoot.getElementById("count").textContent);
    assert.deepEqual(ready, [{ schemaVersion: "1.0", tripId: "asia-sampler" }]);
    assert.equal(window.location.hash, "", "hash synchronization is opt-in");
    assert.equal(first.shadowRoot.getElementById("map-unavailable").getAttribute("role"), "status");
    assert.equal(first.shadowRoot.querySelectorAll("main").length, 0);
    assert.equal(first.shadowRoot.querySelector('[role="region"]').getAttribute("aria-label"), "Interactive itinerary map");
    assert.equal(window.document.querySelectorAll("main").length, 1);
    assert.match(first.shadowRoot.querySelector("style").textContent, /@container itinerary-map \(max-width: 760px\)/);
    assert.match(first.shadowRoot.querySelector("style").textContent, /@supports not \(container-type: inline-size\)/);
});

test("pre-definition property upgrade coalesces attributes and connection into one render", async (t) => {
    const window = new Window({ url: "https://example.test/" });
    t.after(() => window.close());
    const source = appendSource(window, "deferred-source", sample);
    source.before(window.document.createRange().createContextualFragment(
        '<itinerary-map id="deferred-map" data-source="deferred-source" sync-hash="deferred"></itinerary-map>',
    ));
    const element = window.document.getElementById("deferred-map");
    const assigned = structuredClone(sample);
    assigned.trip.title = "Assigned before upgrade";
    element.itinerary = assigned;
    let starts = 0;
    let teardowns = 0;
    let ready = 0;
    element.addEventListener("itinerary-map-ready", () => { ready += 1; });
    window.customElements.define("itinerary-map", createItineraryMapElementClass({
        window,
        maplibregl: {},
        mapErrorDelay: 0,
        startApp: () => {
            starts += 1;
            return { teardown: () => { teardowns += 1; } };
        },
    }));
    await tick();
    assert.equal(element.itinerary.trip.title, "Assigned before upgrade");
    assert.equal(element.shadowRoot.getElementById("trip-title").textContent, "");
    assert.equal(starts, 1);
    assert.equal(ready, 1);
    element.remove();
    element.setAttribute("data-source", "other");
    element.itinerary = sample;
    await element.reload();
    await tick();
    assert.equal(starts, 1, "disconnected mutations and reload must not initialize the app");
    window.document.body.appendChild(element);
    await tick();
    assert.equal(starts, 2);
    assert.equal(teardowns, 1);
    const adoptedWindow = new Window({ url: "https://adopted.example.test/" });
    t.after(() => adoptedWindow.close());
    adoptedWindow.fetch = window.fetch;
    adoptedWindow.document.adoptNode(element);
    adoptedWindow.document.body.appendChild(element);
    element.adoptedCallback();
    await tick();
    assert.equal(starts, 3);
    assert.equal(teardowns, 2);
});

test("duplicate library registration reuses the existing custom element", () => {
    const window = new Window({ url: "https://example.test/" });
    const first = registerItineraryMap({ window, maplibregl: {} });
    const second = registerItineraryMap({ window, maplibregl: {} });
    assert.equal(second, first);
    window.close();
});

test("component supports property data, namespaced focus, attribute changes, and teardown", async (t) => {
    const window = setupWindow();
    t.after(() => window.close());
    let historyWrites = 0;
    const nativePushState = window.history.pushState.bind(window.history);
    window.history.pushState = (...args) => {
        historyWrites += 1;
        return nativePushState(...args);
    };
    const added = [];
    const removed = [];
    const nativeAdd = window.addEventListener.bind(window);
    const nativeRemove = window.removeEventListener.bind(window);
    window.addEventListener = (name, handler, options) => {
        added.push([name, handler]);
        nativeAdd(name, handler, options);
    };
    window.removeEventListener = (name, handler, options) => {
        removed.push([name, handler]);
        nativeRemove(name, handler, options);
    };
    const element = window.document.createElement("itinerary-map");
    element.id = "second-map";
    element.setAttribute("sync-hash", "");
    element.itinerary = structuredClone(sample);
    window.document.body.appendChild(element);
    await tick();
    const day = element.shadowRoot.querySelector('[data-day-id="singapore-waterfront"]');
    day.click();
    await tick();
    assert.equal(window.location.hash, "#second-map.day=singapore-waterfront");
    assert.equal(historyWrites, 1);
    element.shadowRoot.querySelector('[data-id="marina-bay-walk"]').click();
    await tick();
    assert.equal(
        window.location.hash,
        "#second-map.day=singapore-waterfront",
        "item selection must not synchronize a changed filter focus",
    );
    assert.equal(historyWrites, 1, "item selection must not write synchronized focus");
    element.remove();
    assert(added.some(([name]) => name === "online"));
    assert(removed.some(([name]) => name === "online"));
    assert(removed.some(([name]) => name === "popstate"));
});

test("component reports missing, malformed, schema, and semantic errors", async (t) => {
    const window = setupWindow();
    t.after(() => window.close());
    const cases = [
        ["missing", undefined, "source_missing"],
        ["bad-json", "{", "json_invalid"],
        ["too-large", `"${"x".repeat(1024 * 1024)}"`, "source_too_large"],
        ["bad-schema", { schemaVersion: "1.0" }, "itinerary_invalid"],
        ["bad-semantic", (() => {
            const value = structuredClone(sample);
            value.days[0].locationIds = ["missing"];
            return value;
        })(), "itinerary_invalid"],
    ];
    for (const [id, value, code] of cases) {
        if (value !== undefined) appendSource(window, id, value);
        const element = window.document.createElement("itinerary-map");
        element.setAttribute("data-source", id);
        let detail;
        let errorCount = 0;
        element.addEventListener("itinerary-map-error", (event) => {
            detail = event.detail;
            errorCount += 1;
        });
        window.document.body.appendChild(element);
        await tick();
        assert.equal(detail.code, code);
        assert.equal(errorCount, 1);
        assert.equal(element.shadowRoot.querySelector('[role="alert"]') !== null, true);
        element.remove();
    }
});

test("late source insertion and data-source changes rerender predictably", async (t) => {
    const window = setupWindow();
    t.after(() => window.close());
    const element = appendMap(window, "late-source");
    await tick();
    assert(element.shadowRoot.querySelector('[role="alert"]'));
    appendSource(window, "late-source", sample);
    await tick();
    assert.equal(element.shadowRoot.getElementById("trip-title").textContent, sample.trip.title);
    const replacement = structuredClone(sample);
    replacement.trip.title = "Replacement itinerary";
    appendSource(window, "replacement-source", replacement);
    element.setAttribute("data-source", "replacement-source");
    await tick();
    assert.equal(element.shadowRoot.getElementById("trip-title").textContent, "Replacement itinerary");
});

test("null and undefined itinerary assignments return to data-source exactly once", async (t) => {
    const window = setupWindow();
    t.after(() => window.close());
    const sourceItinerary = structuredClone(sample);
    sourceItinerary.trip.title = "Source itinerary";
    appendSource(window, "fallback-source", sourceItinerary);
    const assigned = structuredClone(sample);
    assigned.trip.title = "Assigned itinerary";
    const element = window.document.createElement("itinerary-map");
    element.setAttribute("data-source", "fallback-source");
    const events = [];
    element.addEventListener("itinerary-map-ready", (event) => events.push(["ready", event.detail.tripId]));
    element.addEventListener("itinerary-map-error", (event) => events.push(["error", event.detail.code]));
    element.itinerary = assigned;
    window.document.body.appendChild(element);
    await tick();
    assert.equal(element.shadowRoot.getElementById("trip-title").textContent, "Assigned itinerary");
    assert.deepEqual(events, [["ready", "asia-sampler"]]);

    element.itinerary = null;
    await tick();
    assert.equal(element.itinerary, undefined);
    assert.equal(element.shadowRoot.getElementById("trip-title").textContent, "Source itinerary");
    assert.deepEqual(events, [["ready", "asia-sampler"], ["ready", "asia-sampler"]]);

    element.remove();
    element.itinerary = assigned;
    element.itinerary = undefined;
    await element.reload();
    await tick();
    assert.equal(events.length, 2, "disconnected fallback mutations must not render");
    window.document.body.appendChild(element);
    await tick();
    assert.equal(element.shadowRoot.getElementById("trip-title").textContent, "Source itinerary");
    assert.deepEqual(events, [
        ["ready", "asia-sampler"],
        ["ready", "asia-sampler"],
        ["ready", "asia-sampler"],
    ]);
});

test("components without sync-hash ignore hostile hash state and browser history", async (t) => {
    const window = new Window({
        url: "https://example.test/maps/page.html#location=singapore&day=singapore-waterfront",
    });
    t.after(() => window.close());
    window.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const added = [];
    const nativeAdd = window.addEventListener.bind(window);
    window.addEventListener = (name, handler, options) => {
        added.push(name);
        nativeAdd(name, handler, options);
    };
    let historyWrites = 0;
    const nativePushState = window.history.pushState.bind(window.history);
    window.history.pushState = (...args) => {
        historyWrites += 1;
        return nativePushState(...args);
    };
    window.customElements.define("itinerary-map", createItineraryMapElementClass({
        window,
        maplibregl: {},
        mapErrorDelay: 0,
    }));
    appendSource(window, "no-sync-a", sample);
    appendSource(window, "no-sync-b", sample);
    const first = appendMap(window, "no-sync-a");
    const second = appendMap(window, "no-sync-b");
    await tick();
    assert.equal(first.shadowRoot.getElementById("day").value, "");
    assert.equal(second.shadowRoot.getElementById("day").value, "");
    first.shadowRoot.querySelector('[data-day-id="hanoi-old-quarter"]').click();
    second.shadowRoot.querySelector('[data-day-id="singapore-waterfront"]').click();
    await tick();
    assert.equal(
        window.location.hash,
        "#location=singapore&day=singapore-waterfront",
        "opted-out components must preserve host hash state",
    );
    assert.equal(historyWrites, 0);
    assert.equal(added.includes("popstate"), false);
    assert.equal(added.includes("hashchange"), false);
});

test("portable HTML safely embeds hostile text and validates library metadata", () => {
    const itinerary = structuredClone(sample);
    itinerary.trip.summary = "</script>\u2028\u2029";
    const encoded = safeEmbeddedJson(itinerary);
    assert.doesNotMatch(encoded, /<\/script>/i);
    assert.match(encoded, /\\u003c\/script>/);
    assert.match(encoded, /\\u2028/);
    assert.equal(validateLibraryUrl("../dist/itinerary-map.v1.js"), "../dist/itinerary-map.v1.js");
    assert.equal(validateLibraryUrl("https://cdn.example/v1.js"), "https://cdn.example/v1.js");
    assert.equal(validateLibraryUrl("http://127.0.0.1:8000/v1.js"), "http://127.0.0.1:8000/v1.js");
    for (const url of [
        "javascript:alert(1)", "//evil.example/v1.js", "https:\\\\evil.example\\v1.js",
        "https://example.test/a%5cb.js",
        "https://user:pass@example.test/v1.js", "https://example.test/v1.js#moving",
        "http://example.test/v1.js", "https://example.test/not-css.css", "x.js\"\n><script>alert(1)</script>",
    ]) assert.throws(() => validateLibraryUrl(url));
    assert.throws(() => validateIntegrity("sha384-bad"), /valid sha384/);
    const html = renderPortableItineraryHtml({
        itinerary,
        libraryUrl: "https://cdn.example/itinerary-map.v1.js",
        integrity: `sha384-${"A".repeat(64)}`,
    });

    assert.match(html, /<itinerary-map[^>]+data-source="trip-data"/);
    assert.match(html, /script-src 'self' 'nonce-[A-Za-z0-9_-]+' https:\/\/cdn\.example/);
    const scriptPolicy = /script-src ([^;]+)/.exec(html)[1];
    assert.equal((scriptPolicy.match(/'self'/g) ?? []).length, 1);
    assert.doesNotMatch(html, /nonce="itinerary-map"/);
    assert.doesNotMatch(html, /unsafe-eval|unsafe-inline/);
    for (const [field, value] of [
        ["sourceId", 'x"><script>alert(1)</script>'],
        ["componentId", "x\nonclick=alert(1)"],
        ["nonce", 'bad"nonce'],
    ]) {
        assert.throws(() => renderPortableItineraryHtml({
            itinerary,
            libraryUrl: "./library.js",
            [field]: value,
        }));
    }
});

test("component follows dark and reduced-motion preferences without host CSS leakage", async (t) => {
    const window = new Window({ url: "https://example.test/" });
    t.after(() => window.close());
    setMediaPreferences(window, { dark: true, reduced: true });
    window.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    window.customElements.define("itinerary-map", createItineraryMapElementClass({
        window,
        maplibregl: {},
        maplibreCss: ".maplibregl-popup-content{background:#fff;color:#111}.maplibregl-popup-close-button{color:#111}",
        mapErrorDelay: 0,
    }));
    appendSource(window, "dark-trip", sample);
    const element = appendMap(window, "dark-trip");
    await tick();
    assert.equal(element.dataset.systemTheme, "dark");
    assert.deepEqual(cameraAnimationOptions(window.matchMedia("(prefers-reduced-motion: reduce)").matches, 800), {
        duration: 0,
        essential: false,
    });

    test("browser component exercises MapLibre layers, markers, cameras, and teardown", async (t) => {
        const window = new Window({ url: "https://example.test/" });
        t.after(() => window.close());
        setMediaPreferences(window, { dark: false, reduced: false });
        let resizeDisconnects = 0;
        let resizeCallback;
        window.ResizeObserver = class {
            constructor(callback) { resizeCallback = callback; }
            observe() {}
            disconnect() { resizeDisconnects += 1; }
        };
        const scrollCalls = [];
        const focusCalls = [];
        let rejectPreventScrollOnce = false;
        let simulateFallbackScrollOnce = false;
        window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(options) {
            scrollCalls.push({ element: this, options });
        };
        const nativeFocus = window.HTMLElement.prototype.focus;
        window.HTMLElement.prototype.focus = function focus(options) {
            focusCalls.push({ element: this, options });
            if (rejectPreventScrollOnce && options?.preventScroll) {
                rejectPreventScrollOnce = false;
                throw new TypeError("focus options unsupported");
            }
            if (simulateFallbackScrollOnce && options === undefined) {
                simulateFallbackScrollOnce = false;
                this.getRootNode().getElementById("list").scrollTop = 0;
            }
            return nativeFocus.call(this, options);
        };
        window.fetch = async () => ({
            ok: true,
            json: async () => providerStyle(),
        });
        const records = { maps: [], markers: [], controls: [], filters: [], layouts: [], cameras: [], removes: 0, resizes: 0 };
        window.customElements.define("itinerary-map", createItineraryMapElementClass({
            window,
            maplibregl: fakeMapLibre(records),
            mapErrorDelay: 50,
        }));
        const mixedTransportSample = structuredClone(sample);
        mixedTransportSample.transportLegs[1].mode = "drive";
        appendSource(window, "map-trip", mixedTransportSample);
        const element = appendMap(window, "map-trip");
        await new Promise((resolveTick) => setTimeout(resolveTick, 40));
        assert.equal(records.maps.length, 1);
        assert(records.maps[0].sources.has("itinerary-transport"));
        assert(records.maps[0].layers.has("transport-active"));
        assert.equal(records.markers.length, sample.places.length);
        Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
        element.shadowRoot.querySelector(".shell").getBoundingClientRect = () => ({ width: 420 });
        resizeCallback();
        const markerFor = (name) => records.markers.find((marker) => marker.element.getAttribute("aria-label")?.includes(name));
        const locationSelect = element.shadowRoot.getElementById("location");
        const daySelect = element.shadowRoot.getElementById("day");
        locationSelect.value = "hanoi";
        locationSelect.dispatchEvent(new window.Event("change"));
        daySelect.value = "hanoi-old-quarter";
        daySelect.dispatchEvent(new window.Event("change"));
        const assertHanoiFilters = () => {
            assert.equal(locationSelect.value, "hanoi");
            assert.equal(daySelect.value, "hanoi-old-quarter");
        };
        assert(markerFor("Old Quarter").element.classList.contains("active"));
        assert(markerFor("Noi Bai").element.classList.contains("context"));
        assert.match(markerFor("Noi Bai").element.getAttribute("aria-label"), /not on selected day/);
        assert.equal(markerFor("Tan Son Nhat").added, false);
        const list = element.shadowRoot.getElementById("list");
        for (const [activityId, scrollTop] of [
            ["old-quarter-walk", 1],
            ["temple-literature-visit", 173],
            ["midday-rest", 999],
        ]) {
            list.scrollTop = scrollTop;
            element.shadowRoot.querySelector(`[data-id="${activityId}"]`).click();
            await tick();
            assert.equal(list.scrollTop, scrollTop, `pointer selection must preserve scroll for ${activityId}`);
        }
        const templeCard = element.shadowRoot.querySelector('[data-id="temple-literature-visit"]');
        list.scrollTop = 241;
        templeCard.focus();
        rejectPreventScrollOnce = true;
        simulateFallbackScrollOnce = true;
        templeCard.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        templeCard.click();
        templeCard.dispatchEvent(new window.KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
        await tick();
        assertHanoiFilters();
        assert.equal(list.scrollTop, 241);
        assert.equal(
            element.shadowRoot.querySelector('[data-id="temple-literature-visit"]').getAttribute("aria-pressed"),
            "true",
        );
        assert.equal(element.shadowRoot.activeElement?.dataset.id, "temple-literature-visit");
        assert(
            focusCalls.some(({ element: focused, options }) =>
                focused.dataset.id === "temple-literature-visit" && options?.preventScroll === true),
        );
        assert(
            focusCalls.some(({ element: focused, options }) =>
                focused.dataset.id === "temple-literature-visit" && options === undefined),
            "focus fallback must run when preventScroll options are unsupported",
        );
        assert.equal(scrollCalls.length, 0, "direct activity activation must not call scrollIntoView");
        assert(markerFor("Temple of Literature").element.classList.contains("selected"));
        markerFor("Temple of Literature").element.click();
        await tick();
        assertHanoiFilters();
        assert.equal(markerFor("Temple of Literature").popup.isOpen(), true);
        assert.equal(scrollCalls.length, 1);
        assert.equal(scrollCalls[0].element.dataset.id, "temple-literature-visit");
        assert.deepEqual(scrollCalls[0].options, { block: "nearest", behavior: "smooth" });

        list.scrollTop = 615;
        daySelect.value = "saigon-central";
        daySelect.dispatchEvent(new window.Event("change"));
        assert.equal(locationSelect.value, "hanoi");
        assert.equal(daySelect.value, "saigon-central");
        assert.equal(list.scrollTop, 0, "day filter changes reset the timeline to its beginning");
        const flightCard = element.shadowRoot.querySelector('[data-leg-id="hanoi-to-saigon"]');
        list.scrollTop = 312;
        flightCard.click();
        await tick();
        assert.equal(locationSelect.value, "hanoi");
        assert.equal(daySelect.value, "saigon-central");
        assert.equal(list.scrollTop, 312);
        assert.equal(
            element.shadowRoot.querySelector('[data-leg-id="hanoi-to-saigon"]').getAttribute("aria-pressed"),
            "true",
        );
        const keyboardFlightCard = element.shadowRoot.querySelector('[data-leg-id="hanoi-to-saigon"]');
        list.scrollTop = 428;
        keyboardFlightCard.focus();
        keyboardFlightCard.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
        keyboardFlightCard.click();
        keyboardFlightCard.dispatchEvent(new window.KeyboardEvent("keyup", { key: " ", bubbles: true }));
        await tick();
        assert.equal(list.scrollTop, 428);
        assert.equal(element.shadowRoot.activeElement?.dataset.legId, "hanoi-to-saigon");
        assert(
            focusCalls.some(({ element: focused, options }) =>
                focused.dataset.legId === "hanoi-to-saigon" && options?.preventScroll === true),
        );
        assert.equal(scrollCalls.length, 1, "direct transport activation must not call scrollIntoView");
        assert(markerFor("Noi Bai").element.classList.contains("selected"));
        assert(markerFor("Tan Son Nhat").element.classList.contains("selected"));

        daySelect.value = "";
        daySelect.dispatchEvent(new window.Event("change"));
        const saigonHeading = element.shadowRoot.querySelector('[data-day-id="saigon-central"]');
        saigonHeading.click();
        assert.equal(locationSelect.value, "hanoi");
        assert.equal(daySelect.value, "saigon-central");

        daySelect.value = "hanoi-old-quarter";
        daySelect.dispatchEvent(new window.Event("change"));
        const categoryChips = [...element.shadowRoot.querySelectorAll("#chips .chip")];
        const flightChip = categoryChips.find((button) => button.textContent.includes("Flight"));
        const transferChip = categoryChips.find((button) => button.textContent.includes("Transfer"));
        assert(flightChip);
        assert(transferChip);
        assert.equal(flightChip.getAttribute("aria-label"), "Flight category filter");
        assert.equal(transferChip.getAttribute("aria-label"), "Transfer category filter");
        assert.notEqual(
            flightChip.querySelector(".dot").style.background,
            transferChip.querySelector(".dot").style.background,
        );
        transferChip.click();
        assert.equal(markerFor("Noi Bai").added, true, "transfer filtering must not hide flight endpoints");
        flightChip.click();
        assert.equal(markerFor("Noi Bai").added, false);
        flightChip.click();
        assert.equal(markerFor("Noi Bai").added, true);
        transferChip.click();
        markerFor("Noi Bai").element.click();
        await tick();
        assertHanoiFilters();
        assert(markerFor("Noi Bai").element.classList.contains("selected"));
        assert(markerFor("Tan Son Nhat").element.classList.contains("selected"));
        assert.equal(markerFor("Noi Bai").popup.isOpen(), true);
        assert.equal(scrollCalls.length, 1, "hidden context rows must not be scrolled into view");
        assert(
            element.shadowRoot.querySelectorAll(".day-group").length > 0,
            "context selection must not empty the timeline",
        );
        records.maps[0].emit("click", {
            features: [{ properties: { id: "hanoi-to-saigon" } }],
        }, "transport-selected");
        assertHanoiFilters();
        assert(records.cameras.some(([kind]) => kind === "bounds"));

        locationSelect.value = "singapore";
        list.scrollTop = 512;
        locationSelect.dispatchEvent(new window.Event("change"));
        assert.equal(locationSelect.value, "singapore");
        assert.equal(daySelect.value, "", "destination changes clear an incompatible day without choosing another");
        assert.equal(list.scrollTop, 0, "destination filter changes reset the timeline to its beginning");
        locationSelect.value = "";
        locationSelect.dispatchEvent(new window.Event("change"));
        daySelect.value = "saigon-central";
        daySelect.dispatchEvent(new window.Event("change"));
        assert.equal(locationSelect.value, "", "day selector must not derive a destination");
        element.shadowRoot.getElementById("overview").click();
        assert.equal(locationSelect.value, "");
        assert.equal(daySelect.value, "");
        const filters = element.shadowRoot.getElementById("filters");
        assert.equal(filters.open, false);
        assert.equal(filters.querySelector("summary").getAttribute("aria-expanded"), "false");
        assert.equal(element.shadowRoot.querySelector(".legend").open, false);
        assert.equal(element.shadowRoot.querySelector(".legend summary").getAttribute("aria-expanded"), "false");
        const legendItems = [...element.shadowRoot.querySelectorAll(".legend-grid > span")];
        assert.equal(legendItems[0].textContent, "Booked / planned leg");
        assert.equal(legendItems[0].firstElementChild.className, "legend-route");
        assert.equal(legendItems.at(-1).textContent, "Stay area");
        assert.equal(legendItems.at(-1).firstElementChild.className, "stay-swatch");
        assert.match(element.shadowRoot.getElementById("filter-summary").textContent, /categories/);
        element.shadowRoot.querySelector(".shell").getBoundingClientRect = () => ({ width: 900 });
        resizeCallback();
        assert.equal(filters.open, true);
        assert.equal(filters.querySelector("summary").getAttribute("aria-expanded"), "true");
        assert.equal(element.shadowRoot.querySelector(".legend").open, true);
        element.shadowRoot.querySelector(".shell").getBoundingClientRect = () => ({ width: 420 });
        resizeCallback();
        assert(records.filters.length > 0);
        assert(records.cameras.some(([kind]) => kind === "bounds"));
        assert(records.cameras.some(([kind, _points, options]) => kind === "bounds" && options.padding === 36));
        const css = element.shadowRoot.querySelector("style").textContent;
        assert.match(css, /--canvas-marker-context-border:\s*#57606a/);
        assert.match(css, /--canvas-marker-context-border:\s*#b1bac4/);
        assert.match(css, /\.pin-wrap\.context \.pin/);
        assert.match(css, /\.primary-controls/);
        assert.match(css, /\.filter-disclosure:not\(\[open\]\) > \.filter-panel/);
        element.remove();
        assert.equal(records.removes, 1);
        assert.equal(records.maps[0].removed, true);
        assert.equal(resizeDisconnects, 1);
    });
    const componentStyle = element.shadowRoot.querySelector("style").textContent;
    assert.match(componentStyle, /@media \(prefers-color-scheme: dark\)/);
    assert(
        componentStyle.lastIndexOf(".maplibregl-popup-content")
            > componentStyle.indexOf(".maplibregl-popup-content"),
        "component popup theme must follow and override MapLibre defaults",
    );
    assert(
        componentStyle.lastIndexOf(".maplibregl-popup-close-button")
            > componentStyle.indexOf(".maplibregl-popup-close-button"),
        "component close-button theme must follow and override MapLibre defaults",
    );
});

test("persistent worker failures produce an accessible basemap diagnostic after style load", async (t) => {
    const window = new Window({ url: "https://example.test/" });
    t.after(() => window.close());
    setMediaPreferences(window, { dark: true, reduced: false });
    window.fetch = async () => ({ ok: true, json: async () => providerStyle() });
    const records = { maps: [], markers: [], controls: [], filters: [], layouts: [], cameras: [], removes: 0, resizes: 0 };
    window.customElements.define("itinerary-map", createItineraryMapElementClass({
        window,
        maplibregl: fakeMapLibre(records),
        mapErrorDelay: 50,
    }));
    appendSource(window, "worker-failure-trip", sample);
    const element = appendMap(window, "worker-failure-trip");
    await new Promise((resolveTick) => setTimeout(resolveTick, 40));
    assert.equal(records.maps.length, 1);
    assert.equal(element.shadowRoot.getElementById("map-unavailable"), null);

    records.maps[0].emit("error", {
        error: new Error("Failed to construct 'Worker': blocked by Content Security Policy"),
    });

    const warning = element.shadowRoot.getElementById("map-unavailable");
    assert.equal(warning.getAttribute("role"), "status");
    assert.match(warning.textContent, /basemap renderer failed to start/i);
});

test("committed browser distribution, SRI, and standalone example are reproducible", async () => {
    await execFileAsync(process.execPath, [resolve(root, "scripts", "build-browser-library.mjs"), "--check"]);
    const library = await readFile(resolve(root, "dist", "itinerary-map.v1.js"), "utf8");
    const integrity = (await readFile(resolve(root, "dist", "itinerary-map.v1.sri"), "utf8")).trim();
    assert.equal(integrity, `sha384-${createHash("sha384").update(library).digest("base64")}`);
    assert.doesNotMatch(library, /\beval\s*\(|new Function\s*\(/);
    assert.match(library, /maplibre-gl/);
    assert.match(library, /^\/\*! structured-itinerary-map browser library v1\.0\.0 \| MIT \|/);
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    const packageLock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
    assert.equal(packageJson.license, "MIT");
    assert.equal(packageLock.packages[""].license, "MIT");
    assert.equal(MAPLIBRE_VERSION, packageJson.devDependencies["maplibre-gl"]);
    assert.equal(MAPLIBRE_VERSION, packageLock.packages["node_modules/maplibre-gl"].version);
    const vendor = await readFile(resolve(root, "dist", `maplibre-gl.v${MAPLIBRE_VERSION}.js`), "utf8");
    assert.match(vendor, new RegExp(`MapLibre GL JS v${MAPLIBRE_VERSION.replaceAll(".", "\\.")}`));
    assert.match(vendor, /createObjectURL/);
    assert.match(vendor, /setWorkerUrl/);
    assert.match(library, /createObjectURL/);
    assert.match(library, /setWorkerUrl/);
    const licenses = await readFile(resolve(root, "dist", "itinerary-map.v1.LICENSES.txt"), "utf8");
    const projectLicense = await readFile(resolve(root, "LICENSE"), "utf8");
    assert.match(licenses, /Structured Itinerary Map/);
    assert(licenses.includes(projectLicense.trimEnd()));
    assert.match(licenses, /Copyright \(c\) 2023, MapLibre contributors/);
    const upstreamLicense = await readFile(resolve(root, "node_modules", "maplibre-gl", "LICENSE.txt"), "utf8");
    assert(licenses.endsWith(upstreamLicense));
    const example = await readFile(resolve(root, "examples", "standalone.html"), "utf8");
    assert.ok(example.includes(`integrity="${integrity}"`));
    for (const documentationPath of ["README.md", "docs/browser-library.md"]) {
        const documentation = await readFile(resolve(root, documentationPath), "utf8");
        const literals = documentation.match(/sha384-[A-Za-z0-9+/]{64}/g) ?? [];
        assert(literals.length > 0, `${documentationPath} must contain a generated SRI literal`);
        assert(literals.every((literal) => literal === integrity), `${documentationPath} contains stale SRI`);
    }
    assert.match(example, /<itinerary-map/);
    assert.doesNotMatch(example, /nonce="itinerary-map"/);
    const nonces = [...example.matchAll(/nonce="([^"]+)"/g)].map((match) => match[1]);
    assert(nonces.length >= 2);
    assert.equal(new Set(nonces).size, 1);
    const embedded = /<script id="trip-data" type="application\/json" nonce="[^"]+">([\s\S]+?)<\/script>/.exec(example);
    assert(embedded);
    assert.deepEqual(JSON.parse(embedded[1]), sample);
});
