import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderHtml } from "../.github/extensions/structured-itinerary-map/renderer.mjs";
import {
    replaceCanvasState,
    startCanvasServer,
    stopCanvasServer,
} from "../.github/extensions/structured-itinerary-map/canvas-server.mjs";
import {
    advanceRevision,
    activityMatchesFilters,
    activitySelection,
    basemapStyleHealth,
    boundsForCoordinates,
    cameraAnimationOptions,
    canonicalMarkerStates,
    canonicalVisiblePlaceIds,
    chooseMarkerLeg,
    darkStyleTransformCoverage,
    dayTimeZoneContext,
    directTransportLines,
    destinationFilterTransition,
    disposeMapResources,
    focusIdentity,
    focusForTransportLeg,
    focusSelector,
    legMatchesFilters,
    dayFilterTransition,
    mapPalette,
    mapErrorSeverity,
    mapStyleUrl,
    overviewFilterTransition,
    precomputeTimelineRows,
    resolveFocus,
    safeJson,
    shouldApplyAuthoritativeFocus,
    shouldRestoreMapStyle,
    shouldReloadRevision,
    standalonePlaceMatchesFilters,
    themeFromPreference,
    timelineEntriesForDay,
    transformMapStyle,
    transportCategoryForMode,
    transportRouteProperties,
    transportSelection,
    transportStatusStyle,
    unwrapCoordinates,
    unwrapTransportPoints,
    visibleStayLocationIds,
    visibleTransportLegIds,
} from "../.github/extensions/structured-itinerary-map/renderer-helpers.mjs";
import {
    MAX_LOCAL_DATE_TIME_EPOCHS,
    MAX_TIME_ZONE_FORMATTERS,
    clearTimeZoneFormatterCache,
    isValidTimeZone,
    localDateTimeEpochCacheSize,
    localDateTimeToEpoch,
    shortTimeZoneLabel,
    transportTimeZoneLabel,
    timeZoneFormatterCacheSize,
} from "../.github/extensions/structured-itinerary-map/time-helpers.mjs";
import {
    composeOpenInputSchema,
    unresolvedSchemaRefs,
} from "../.github/extensions/structured-itinerary-map/schema.mjs";
import { PUBLIC_ERROR_CODES } from "../.github/extensions/structured-itinerary-map/error-codes.mjs";
import {
    MAX_ITINERARY_BYTES,
    assertFocusShape,
    assertOpenEnvelope,
    assertSourceEnvelope,
    closeServerResources,
    createKeyedSerializer,
    isExpectedLoopbackHost,
    isExpectedLoopbackOrigin,
    loadItinerarySource,
    sendSse,
    parseRequestPath,
} from "../.github/extensions/structured-itinerary-map/runtime-helpers.mjs";
import {
    summarizeItinerary,
    validateFocus,
    validateItinerary,
    validateSchemaValue,
} from "../.github/extensions/structured-itinerary-map/validation.mjs";
import {
    createFocusSyncState,
    queueLocalFocus,
    receiveAuthoritativeFocus,
    settleLocalFocus,
} from "../.github/extensions/structured-itinerary-map/focus-sync.mjs";
import { startCanvasApp } from "../.github/extensions/structured-itinerary-map/canvas-app.mjs";
import { createCanvasController } from "../.github/extensions/structured-itinerary-map/extension-core.mjs";
import { attachClientLifecycle } from "../.github/extensions/structured-itinerary-map/client-lifecycle.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const schema = JSON.parse(await readFile(`${root}.github/extensions/structured-itinerary-map/itinerary.schema.json`, "utf8"));
const openSchemaSource = JSON.parse(await readFile(`${root}.github/extensions/structured-itinerary-map/open-input.schema.json`, "utf8"));
const sample = JSON.parse(await readFile(`${root}examples/sample-itinerary.json`, "utf8"));

function requestServer(entry, path, { method = "GET", headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        let responseComplete = false;
        let settled = false;
        let responseStatus;
        let responseHeaders;
        const chunks = [];
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve({
                status: responseStatus,
                headers: responseHeaders,
                text: Buffer.concat(chunks).toString("utf8"),
            });
        };
        const fail = (error) => {
            if (responseComplete && (error.code === "ECONNRESET" || error.code === "EPIPE")) {
                finish();
                return;
            }
            if (!settled) {
                settled = true;
                reject(error);
            }
        };
        const request = httpRequest({
            hostname: "127.0.0.1",
            port: entry.port,
            path,
            method,
            agent: false,
            headers: { Host: `127.0.0.1:${entry.port}`, ...headers },
        }, (response) => {
            responseStatus = response.statusCode;
            responseHeaders = response.headers;
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => {
                responseComplete = true;
                finish();
            });
            response.on("aborted", () => fail(Object.assign(new Error("Response aborted before completion."), {
                code: "ECONNRESET",
            })));
            response.on("error", fail);
        });
        request.on("error", fail);
        if (Array.isArray(body)) body.forEach((chunk) => request.write(chunk));
        else if (body !== undefined) request.write(body);
        request.end();
    });
}

function appPath(entry, route = "") {
    return `${entry.pathPrefix}/${route}`.replace(/\/+$/, "/");
}

function openEventStream(entry) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const request = httpRequest({
            hostname: "127.0.0.1",
            port: entry.port,
            path: appPath(entry, "events"),
            agent: false,
            headers: { Host: `127.0.0.1:${entry.port}` },
        }, (response) => {
            response.on("data", (chunk) => {
                chunks.push(chunk.toString("utf8"));
                if (/event: state\ndata: .+\n\n/.test(chunks.join(""))) {
                    resolve({ request, response, chunks });
                }
            });
            response.on("error", reject);
        });
        request.on("error", reject);
        request.end();
    });
}

async function waitFor(predicate, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error("Timed out waiting for server event");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

test("sample itinerary satisfies schema and semantic rules", () => {
    assert.equal(schema.$id, "urn:trip-planner:itinerary:1.0");
    assert.deepEqual(validateItinerary(sample, schema), []);
});

test("composed open schema resolves every local reference and validates the sample envelope", () => {
    const composed = composeOpenInputSchema(openSchemaSource, schema);
    assert.deepEqual(unresolvedSchemaRefs(composed), []);
    assert.deepEqual(validateSchemaValue({
        documentId: "sample-document",
        itinerary: sample,
        initialFocus: {},
    }, composed), []);
});

test("contract documentation lists every public extension error code", async () => {
    const contract = await readFile(`${root}docs/itinerary-contract.md`, "utf8");
    for (const code of PUBLIC_ERROR_CODES) {
        assert.match(contract, new RegExp(`\\\`${code}\\\``));
    }
});

test("schedule-only activities are valid without a place or coordinates", () => {
    const activity = sample.days[0].activities.find((item) => item.id === "midday-rest");
    assert.equal(activity.placeId, undefined);
    assert.equal(activity.coordinates, undefined);
    assert.deepEqual(validateItinerary(sample, schema), []);
});

test("strict place schema requires coordinates and rejects embedded activity coordinates", () => {
    const invalid = structuredClone(sample);
    delete invalid.places[0].coordinates;
    invalid.days[0].activities[0].coordinates = { latitude: 0, longitude: 0 };
    const errors = validateItinerary(invalid, schema);
    assert(errors.includes("$.places[0].coordinates: is required"));
    assert(errors.includes("$.days[0].activities[0].coordinates: unknown property"));
});

test("semantic rules reject invalid location, place, and day references", () => {
    const invalid = structuredClone(sample);
    invalid.days[0].locationIds[0] = "missing";
    invalid.days[1].activities[1].placeId = "missing-place";
    invalid.transportLegs[0].dayId = "missing-day";
    const errors = validateItinerary(invalid, schema);
    assert(errors.some((error) => error.includes('unknown location "missing"')));
    assert(errors.some((error) => error.includes('unknown place "missing-place"')));
    assert(errors.some((error) => error.includes('unknown day "missing-day"')));
});

test("structurally malformed itineraries return schema errors without throwing", () => {
    for (const invalid of [null, {}, { schemaVersion: "1.0" }, { ...structuredClone(sample), trip: undefined }]) {
        assert.doesNotThrow(() => validateItinerary(invalid, schema));
        assert(validateItinerary(invalid, schema).length > 0);
    }
    const missingLocationIds = structuredClone(sample);
    delete missingLocationIds.days[0].locationIds;
    assert.deepEqual(
        validateItinerary(missingLocationIds, schema),
        ["$.days[0].locationIds: is required"],
    );
});

test("missing identifiers do not produce duplicate undefined diagnostics", () => {
    const invalid = structuredClone(sample);
    delete invalid.locations[0].id;
    delete invalid.locations[1].id;
    delete invalid.places[0].id;
    delete invalid.places[1].id;
    delete invalid.days[0].id;
    delete invalid.days[1].id;
    delete invalid.days[0].activities[0].id;
    delete invalid.days[0].activities[1].id;
    delete invalid.transportLegs[0].id;
    delete invalid.transportLegs[1].id;
    const errors = validateItinerary(invalid, schema);
    assert.equal(errors.filter((error) => error.includes("duplicate")).length, 0);
    assert(errors.includes("$.locations[0].id: is required"));
    assert(errors.includes("$.transportLegs[0].id: is required"));
});

test("timezone formatter cache is reused and bounded", () => {
    clearTimeZoneFormatterCache();
    assert.equal(localDateTimeToEpoch("2026-09-13T10:00", "Asia/Tokyo"), 1789261200000);
    assert.equal(localDateTimeToEpoch("2026-09-13T10:00", "Asia/Tokyo"), 1789261200000);
    assert.equal(localDateTimeToEpoch("2026-09-13T11:00", "Asia/Tokyo"), 1789264800000);
    assert.equal(timeZoneFormatterCacheSize(), 1);
    assert.equal(localDateTimeEpochCacheSize(), 2);
    for (const zone of Intl.supportedValuesOf("timeZone").slice(0, MAX_TIME_ZONE_FORMATTERS + 20)) {
        assert.equal(isValidTimeZone(zone), true);
    }
    assert.equal(timeZoneFormatterCacheSize(), MAX_TIME_ZONE_FORMATTERS);
});

test("local datetime epoch cache preserves invalid times and evicts old entries", () => {
    clearTimeZoneFormatterCache();
    assert.equal(localDateTimeToEpoch("2026-03-08T02:30", "America/Los_Angeles"), undefined);
    assert.equal(localDateTimeToEpoch("2026-03-08T02:30", "America/Los_Angeles"), undefined);
    assert.equal(localDateTimeEpochCacheSize(), 1);
    for (let index = 0; index < MAX_LOCAL_DATE_TIME_EPOCHS + 20; index += 1) {
        const day = String(1 + Math.floor(index / 1440)).padStart(2, "0");
        const minuteOfDay = index % 1440;
        const hour = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
        const minute = String(minuteOfDay % 60).padStart(2, "0");
        localDateTimeToEpoch(`2026-01-${day}T${hour}:${minute}`, "Etc/UTC");
    }
    assert.equal(localDateTimeEpochCacheSize(), MAX_LOCAL_DATE_TIME_EPOCHS);
});

test("timezone labels are safe and reflect daylight-saving seasons", () => {
    assert.equal(shortTimeZoneLabel(undefined, Date.now()), "");
    assert.equal(shortTimeZoneLabel("Not/A_Zone", Date.now()), "");
    assert.equal(shortTimeZoneLabel("Asia/Tokyo", Number.NaN), "");
    const winter = shortTimeZoneLabel("America/Los_Angeles", Date.UTC(2026, 0, 15, 12));
    const summer = shortTimeZoneLabel("America/Los_Angeles", Date.UTC(2026, 6, 15, 12));
    assert.notEqual(winter, summer);
    const untimed = { id: "untimed-leg" };
    assert.equal(transportTimeZoneLabel(untimed, { date: "2026-07-15" }, "America/Los_Angeles"), "");
    assert.doesNotThrow(() => transportTimeZoneLabel(untimed, undefined, undefined));
});

test("near-cap timed itinerary validates with bounded conversion caches", () => {
    clearTimeZoneFormatterCache();
    const large = structuredClone(sample);
    large.days = [{
        ...large.days[0],
        activities: Array.from({ length: 8000 }, (_, index) => ({
            id: `activity-${index}`,
            name: `Activity ${index}`,
            kind: "activity",
            category: "culture",
            locationId: "hanoi",
            startTime: `${String(Math.floor(index / 60) % 24).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}`,
        })),
    }];
    large.transportLegs = [];
    const bytes = Buffer.byteLength(JSON.stringify(large));
    assert(bytes > 980_000 && bytes < MAX_ITINERARY_BYTES, `fixture size is ${bytes} bytes`);
    assert.deepEqual(validateItinerary(large, schema), []);
    const timeline = timelineEntriesForDay(
        large.days[0],
        large.days[0].activities,
        [],
        {
            placesById: new Map(large.places.map((place) => [place.id, place])),
            locationsById: new Map(large.locations.map((location) => [location.id, location])),
        },
    );
    assert.equal(timeline.length, 8000);
    assert(timeZoneFormatterCacheSize() <= large.locations.length);
    assert(localDateTimeEpochCacheSize() <= MAX_LOCAL_DATE_TIME_EPOCHS);
});

test("independent semantic errors survive unrelated structural failures", () => {
    const invalid = structuredClone(sample);
    delete invalid.places[0].coordinates;
    invalid.locations[1].timezone = "Mars/Olympus_Mons";
    const errors = validateItinerary(invalid, schema);
    assert(errors.includes("$.places[0].coordinates: is required"));
    assert(errors.some((error) => error.includes('unknown IANA timezone "Mars/Olympus_Mons"')));
});

test("place and activity URLs allow only absolute HTTP(S)", () => {
    const hostile = structuredClone(sample);
    hostile.places[0].url = "javascript:alert(1)";
    hostile.days[0].activities[0].url = "file:///private/itinerary";
    const errors = validateItinerary(hostile, schema);
    assert(errors.some((error) => error.includes("$.places[0].url: does not match")));
    assert(errors.some((error) => error.includes("$.days[0].activities[0].url: does not match")));
});

test("place and activity locations must agree with their day", () => {
    const invalid = structuredClone(sample);
    invalid.places.find((place) => place.id === "central-post-office").locationId = "singapore";
    const errors = validateItinerary(invalid, schema);
    assert(errors.some((error) => error.includes("conflicts with place")));
    assert(errors.some((error) => error.includes('effective location "singapore"')));
});

test("multi-location timed activities require an effective location", () => {
    const invalid = structuredClone(sample);
    delete invalid.days[1].activities[0].locationId;
    assert(validateItinerary(invalid, schema).some((error) => error.includes("local time requires an effective location timezone")));
});

test("semantic rules validate IANA timezones and transport chronology", () => {
    const invalidZone = structuredClone(sample);
    invalidZone.locations[0].timezone = "Mars/Olympus_Mons";
    assert(validateItinerary(invalidZone, schema).some((error) => error.includes("unknown IANA timezone")));

    const invalidChronology = structuredClone(sample);
    invalidChronology.transportLegs[1].arrivalLocalDateTime = "2026-12-11T13:00";
    assert(validateItinerary(invalidChronology, schema).some((error) => error.includes("resolves before departure")));

    const nonexistentLocalTime = structuredClone(sample);
    nonexistentLocalTime.locations[0].timezone = "America/Los_Angeles";
    nonexistentLocalTime.transportLegs[0].departureLocalDateTime = "2026-03-08T02:30";
    assert(validateItinerary(nonexistentLocalTime, schema).some((error) => error.includes("nonexistent local time")));
});

test("semantic rules reject unsplit antimeridian geometry and unclosed stay areas", () => {
    const invalid = structuredClone(sample);
    invalid.transportLegs[0].lines = [[
        { latitude: 30, longitude: 170 },
        { latitude: 31, longitude: -170 },
    ]];
    invalid.recommendedStayAreas[0].boundaries[0].at(-1).longitude = 105.845;
    const errors = validateItinerary(invalid, schema);
    assert(errors.some((error) => error.includes("antimeridian crossing must be split")));
    assert(errors.some((error) => error.includes("polygon ring must be closed")));
});

test("focus validation checks destination/day consistency", () => {
    assert.deepEqual(validateFocus({ dayId: "hanoi-old-quarter", locationId: "hanoi" }, sample), []);
    assert.deepEqual(validateFocus({ dayId: "hanoi-old-quarter", locationId: "singapore" }, sample), [
        'initialFocus: location "singapore" is not included in day "hanoi-old-quarter"',
    ]);
});

test("focus transitions clear stale state and infer only sole day locations", () => {
    const daysById = new Map(sample.days.map((day) => [day.id, day]));
    const locationsById = new Map(sample.locations.map((location) => [location.id, location]));
    assert.deepEqual(resolveFocus({ locationId: "singapore" }, daysById), {
        dayId: "",
        locationId: "singapore",
    });
    assert.deepEqual(resolveFocus({ dayId: "hanoi-old-quarter" }, daysById), {
        dayId: "hanoi-old-quarter",
        locationId: "hanoi",
    });
    assert.deepEqual(resolveFocus({ dayId: "saigon-central" }, daysById), {
        dayId: "saigon-central",
        locationId: "",
    });
    assert.deepEqual(resolveFocus({}, daysById), { dayId: "", locationId: "" });
    assert.deepEqual(resolveFocus({ dayId: "missing", locationId: "hanoi" }, daysById), {
        dayId: "",
        locationId: "hanoi",
    });
    assert.deepEqual(resolveFocus({ dayId: "missing", locationId: "missing" }, daysById, locationsById), {
        dayId: "",
        locationId: "",
    });
});

test("user filter transitions preserve ownership boundaries", () => {
    const daysById = new Map(sample.days.map((day) => [day.id, day]));
    assert.deepEqual(
        destinationFilterTransition(
            { locationId: "", dayId: "hanoi-old-quarter" },
            "hanoi",
            daysById,
        ),
        { locationId: "hanoi", dayId: "hanoi-old-quarter" },
    );
    assert.deepEqual(
        destinationFilterTransition(
            { locationId: "hanoi", dayId: "hanoi-old-quarter" },
            "singapore",
            daysById,
        ),
        { locationId: "singapore", dayId: "" },
    );
    assert.deepEqual(
        dayFilterTransition(
            { locationId: "hanoi", dayId: "" },
            "hanoi-old-quarter",
            daysById,
        ),
        { locationId: "hanoi", dayId: "hanoi-old-quarter" },
    );
    assert.deepEqual(
        dayFilterTransition(
            { locationId: "hanoi", dayId: "hanoi-old-quarter" },
            "singapore-waterfront",
            daysById,
        ),
        { locationId: "hanoi", dayId: "hanoi-old-quarter" },
    );
    assert.deepEqual(overviewFilterTransition(), { locationId: "", dayId: "" });
    const activity = {
        id: "visit",
        place: { id: "museum" },
        day: { id: "day-1", locationIds: ["city"] },
        effectiveLocationId: "city",
    };
    assert.deepEqual(activitySelection(activity), {
        activityId: "visit",
        legId: "",
        placeIds: ["museum"],
    });
    assert.deepEqual(transportSelection({
        id: "train",
        dayId: "day-2",
        originPlaceId: "station-a",
        destinationPlaceId: "station-b",
    }), {
        activityId: "",
        legId: "train",
        placeIds: ["station-a", "station-b"],
    });
});

test("transport filtering honors flight and transfer categories, day, and either endpoint location", () => {
    const placesById = new Map(sample.places.map((place) => [place.id, place]));
    const leg = sample.transportLegs[0];
    assert.equal(transportCategoryForMode("flight"), "flight");
    for (const mode of ["walk", "bike", "drive", "bus", "rail", "ferry", "other"]) {
        assert.equal(transportCategoryForMode(mode), "transfer");
    }
    assert.equal(legMatchesFilters(leg, {
        selectedDayId: "",
        selectedLocationId: "saigon",
        selectedCategories: new Set(["flight"]),
        placesById,
    }), true);
    assert.equal(legMatchesFilters(leg, {
        selectedDayId: "singapore-waterfront",
        selectedLocationId: "",
        selectedCategories: new Set(["flight"]),
        placesById,
    }), false);
    assert.equal(legMatchesFilters(leg, {
        selectedDayId: "",
        selectedLocationId: "",
        selectedCategories: new Set(["transfer"]),
        placesById,
    }), false);
    assert.equal(legMatchesFilters({ ...leg, mode: "drive" }, {
        selectedDayId: "",
        selectedLocationId: "",
        selectedCategories: new Set(["transfer"]),
        placesById,
    }), true);
});

test("transport route data uses category color while status controls emphasis and pattern", () => {
    const categoryStyles = {
        flight: { label: "Flight", color: "#123456" },
        transfer: { label: "Transfer", color: "#abcdef" },
    };
    assert.deepEqual(
        transportRouteProperties({ id: "air", mode: "flight", name: "Air", dayId: "day-1" }, categoryStyles),
        {
            id: "air",
            dayId: "day-1",
            status: "planned",
            mode: "flight",
            name: "Air",
            transportCategory: "flight",
            categoryColor: "#123456",
        },
    );
    assert.equal(
        transportRouteProperties({ id: "rail", mode: "rail" }, categoryStyles, "tentative").categoryColor,
        "#abcdef",
    );
    const booked = transportStatusStyle("booked");
    const planned = transportStatusStyle("planned");
    const optional = transportStatusStyle("optional");
    const tentative = transportStatusStyle("tentative");
    const cancelled = transportStatusStyle("cancelled");
    assert(booked.width > planned.width);
    assert(booked.opacity > planned.opacity);
    assert.equal(booked.dasharray, undefined);
    assert.equal(planned.dasharray, undefined);
    assert.notDeepEqual(optional.dasharray, tentative.dasharray);
    assert.notDeepEqual(tentative.dasharray, cancelled.dasharray);
    assert(cancelled.opacity < optional.opacity);
    for (const status of ["booked", "planned", "optional", "tentative", "cancelled"]) {
        const ordinary = transportStatusStyle(status);
        const selected = transportStatusStyle(status, { selected: true });
        assert(selected.width > ordinary.width);
        assert(selected.opacity >= ordinary.opacity);
        assert.deepEqual(selected.dasharray, ordinary.dasharray);
    }
});

test("activity filtering honors category, day, and effective location", () => {
    const row = {
        category: "culture",
        effectiveLocationId: "hanoi",
        day: { id: "hanoi-old-quarter" },
    };
    assert.equal(activityMatchesFilters(row, {
        selectedCategories: new Set(["culture"]),
        selectedDayId: "hanoi-old-quarter",
        selectedLocationId: "hanoi",
    }), true);
    assert.equal(activityMatchesFilters(row, {
        selectedCategories: new Set(["culture"]),
        selectedDayId: "saigon-central",
        selectedLocationId: "",
    }), false);
    assert.equal(activityMatchesFilters(row, {
        selectedCategories: new Set(),
        selectedDayId: "",
        selectedLocationId: "",
    }), false);
});

test("transport geometry splits and unwraps antimeridian crossings", () => {
    const origin = { coordinates: { latitude: 35, longitude: 170 } };
    const destination = { coordinates: { latitude: 37, longitude: -170 } };
    const lines = directTransportLines(origin, destination);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].at(-1).longitude, 180);
    assert.equal(lines[1][0].longitude, -180);
    const points = unwrapTransportPoints(lines);
    assert(Math.max(...points.map((point) => point.longitude)) - Math.min(...points.map((point) => point.longitude)) <= 20);
});

test("exact antimeridian endpoints never produce NaN geometry", () => {
    for (const [start, end] of [[180, -180], [-180, 180]]) {
        const lines = directTransportLines(
            { coordinates: { latitude: 10, longitude: start } },
            { coordinates: { latitude: 20, longitude: end } },
        );
        assert.equal(lines.length, 1);
        assert(lines.flat().every((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)));
        const points = unwrapTransportPoints(lines);
        assert.equal(Math.max(...points.map((point) => point.longitude))
            - Math.min(...points.map((point) => point.longitude)), 0);
    }
});

test("place collections frame the short dateline span in either direction", () => {
    for (const points of [
        [{ latitude: 10, longitude: 179 }, { latitude: 12, longitude: -179 }, { latitude: 11, longitude: 178 }],
        [{ latitude: 12, longitude: -179 }, { latitude: 10, longitude: 179 }, { latitude: 11, longitude: -178 }],
    ]) {
        const unwrapped = unwrapCoordinates(points);
        const bounds = boundsForCoordinates(points);
        assert.equal(unwrapped.length, points.length);
        assert(bounds.east - bounds.west <= 4);
        assert.equal(bounds.south, 10);
        assert.equal(bounds.north, 12);
    }
    const ordinary = boundsForCoordinates([
        { latitude: 1, longitude: 100 },
        { latitude: 2, longitude: 110 },
    ]);
    assert.equal(ordinary.east - ordinary.west, 10);
});

test("canonical camera places exclude unused catalog entries", () => {
    const distant = {
        id: "unused-distant",
        name: "Unused",
        category: undefined,
        locationId: "hanoi",
        coordinates: { latitude: 0, longitude: -170 },
    };
    const allPlaces = [...sample.places, distant];
    const activities = sample.days.flatMap((day) => day.activities.map((activity) => ({
        ...activity,
        day,
        place: activity.placeId ? sample.places.find((place) => place.id === activity.placeId) : undefined,
        effectiveStatus: activity.status ?? "planned",
    })));
    const daysById = new Map(sample.days.map((day) => [day.id, day]));
    const scheduledPlaceIds = new Set(activities.filter((row) => row.place).map((row) => row.place.id));
    for (const filters of [
        { selectedDayId: "", selectedLocationId: "" },
        { selectedDayId: "hanoi-old-quarter", selectedLocationId: "hanoi" },
        { selectedDayId: "", selectedLocationId: "hanoi" },
    ]) {
        const ids = canonicalVisiblePlaceIds({
            activityRows: activities.filter((row) => !filters.selectedDayId || row.day.id === filters.selectedDayId)
                .filter((row) => !filters.selectedLocationId || row.place?.locationId === filters.selectedLocationId),
            visibleLegs: [],
            allPlaces,
            scheduledPlaceIds,
            selectedCategories: new Set(["street", "culture", "rest", "transport"]),
            ...filters,
            selectedLeg: undefined,
            daysById,
        });
        assert.equal(ids.has("unused-distant"), false);
    }
    const selectedLeg = sample.transportLegs[0];
    const selectedIds = canonicalVisiblePlaceIds({
        activityRows: [],
        visibleLegs: [],
        allPlaces,
        scheduledPlaceIds,
        selectedCategories: new Set(),
        selectedDayId: "singapore-waterfront",
        selectedLocationId: "singapore",
        selectedLeg,
        daysById,
    });
    assert(selectedIds.has(selectedLeg.originPlaceId));
    assert(selectedIds.has(selectedLeg.destinationPlaceId));
});

test("marker states retain filtered day context without widening camera bounds", () => {
    const placesById = new Map(sample.places.map((place) => [place.id, place]));
    const daysById = new Map(sample.days.map((day) => [day.id, day]));
    const activityRows = sample.days.flatMap((day) => day.activities.map((activity) => ({
        ...activity,
        day,
        place: activity.placeId ? placesById.get(activity.placeId) : undefined,
        effectiveLocationId: activity.placeId ? placesById.get(activity.placeId)?.locationId : activity.locationId,
        effectiveStatus: activity.status ?? "planned",
    })));
    const selectedCategories = new Set(["street", "culture", "rest", "flight", "transfer", "architecture", "food"]);
    const hanoiStates = canonicalMarkerStates({
        activityRows,
        transportLegs: sample.transportLegs,
        selectedCategories,
        selectedDayId: "hanoi-old-quarter",
        selectedLocationId: "hanoi",
        daysById,
        placesById,
    });
    assert.equal(hanoiStates.get("old-quarter"), "active");
    assert.equal(hanoiStates.get("temple-literature"), "active");
    assert.equal(hanoiStates.get("hanoi-airport"), "context");
    assert.equal(hanoiStates.has("saigon-airport"), false, "destination filter excludes the remote end of a context leg");
    assert.equal(hanoiStates.has("central-post-office"), false);

    const tripStates = canonicalMarkerStates({
        activityRows,
        transportLegs: sample.transportLegs,
        selectedCategories,
        selectedDayId: "hanoi-old-quarter",
        selectedLocationId: "",
        daysById,
        placesById,
    });
    assert.equal(tripStates.get("central-post-office"), "context");
    assert.equal(tripStates.get("marina-bay"), "context");
    assert.equal(tripStates.get("singapore-airport"), "context");

    const cultureOnly = canonicalMarkerStates({
        activityRows,
        transportLegs: sample.transportLegs,
        selectedCategories: new Set(["culture"]),
        selectedDayId: "hanoi-old-quarter",
        selectedLocationId: "",
        daysById,
        placesById,
    });
    assert.equal(cultureOnly.get("temple-literature"), "active");
    assert.equal(cultureOnly.get("war-remnants"), "context");
    assert.equal(cultureOnly.has("old-quarter"), false);
    assert.equal(cultureOnly.has("hanoi-airport"), false);

    const cancelledPlace = { ...placesById.get("old-quarter"), id: "cancelled-place" };
    placesById.set(cancelledPlace.id, cancelledPlace);
    const cancelledStates = canonicalMarkerStates({
        activityRows: [...activityRows, {
            id: "cancelled-mapped",
            category: "street",
            effectiveStatus: "cancelled",
            effectiveLocationId: "hanoi",
            place: cancelledPlace,
            day: sample.days[0],
        }],
        transportLegs: sample.transportLegs,
        selectedCategories,
        selectedDayId: "hanoi-old-quarter",
        selectedLocationId: "hanoi",
        daysById,
        placesById,
    });
    assert.equal(cancelledStates.has("cancelled-place"), false);

    const selectedLeg = sample.transportLegs[1];
    const selectedStates = canonicalMarkerStates({
        activityRows,
        transportLegs: sample.transportLegs,
        selectedCategories: new Set(),
        selectedDayId: "hanoi-old-quarter",
        selectedLocationId: "hanoi",
        selectedLeg,
        daysById,
        placesById,
    });
    assert.equal(selectedStates.get(selectedLeg.originPlaceId), "selected");
    assert.equal(selectedStates.get(selectedLeg.destinationPlaceId), "selected");

    const cameraIds = canonicalVisiblePlaceIds({
        activityRows: activityRows.filter((row) => row.day.id === "hanoi-old-quarter"),
        visibleLegs: [],
    });
    assert.deepEqual([...cameraIds].sort(), ["old-quarter", "temple-literature"]);
    assert.equal(cameraIds.has("central-post-office"), false);
    assert.equal(cameraIds.has("unused-distant"), false);
});

test("timeline ordering uses absolute instants across timezones", () => {
    const day = { id: "transfer", date: "2026-09-13", locationIds: ["tokyo", "los-angeles"] };
    const locationsById = new Map([
        ["tokyo", { id: "tokyo", timezone: "Asia/Tokyo" }],
        ["los-angeles", { id: "los-angeles", timezone: "America/Los_Angeles" }],
    ]);
    const placesById = new Map([
        ["tokyo-airport", { id: "tokyo-airport", locationId: "tokyo" }],
        ["la-airport", { id: "la-airport", locationId: "los-angeles" }],
    ]);
    const activities = [
        { id: "la-breakfast", startTime: "09:00", effectiveLocationId: "los-angeles" },
        { id: "tokyo-breakfast", startTime: "10:00", effectiveLocationId: "tokyo" },
        { id: "untimed", effectiveLocationId: "los-angeles" },
    ];
    const legs = [{
        id: "flight",
        originPlaceId: "tokyo-airport",
        destinationPlaceId: "la-airport",
        departureLocalDateTime: "2026-09-13T12:00",
    }];
    assert.deepEqual(
        timelineEntriesForDay(day, activities, legs, { placesById, locationsById })
            .map((entry) => entry.value.id),
        ["tokyo-breakfast", "flight", "la-breakfast", "untimed"],
    );
    assert.equal(dayTimeZoneContext(day, { locationsById }).size, 2);
    assert.notEqual(
        shortTimeZoneLabel("Asia/Tokyo", Date.UTC(2026, 8, 13)),
        shortTimeZoneLabel("America/Los_Angeles", Date.UTC(2026, 8, 13)),
    );
});

test("precomputed timeline metadata is reused across filtering and sorting", () => {
    const placesById = new Map(sample.places.map((place) => [place.id, place]));
    const locationsById = new Map(sample.locations.map((location) => [location.id, location]));
    const prepared = precomputeTimelineRows(sample, { placesById, locationsById });
    assert(prepared.activities.every((activity) => activity.timelinePrepared));
    assert(prepared.legs.every((leg) => leg.timelinePrepared));
    const day = sample.days[2];
    const activities = prepared.activities.filter((activity) => day.activities.some((item) => item.id === activity.id));
    const first = timelineEntriesForDay(day, activities, prepared.legs.filter((leg) => leg.dayId === day.id), {
        placesById,
        locationsById,
    });
    const second = timelineEntriesForDay(day, activities.filter((activity) => activity.category === "food"), prepared.legs.filter((leg) => leg.dayId === day.id), {
        placesById,
        locationsById,
    });
    assert.equal(first[0].value.id, "saigon-to-singapore");
    assert.equal(second[0].value.id, "saigon-to-singapore");
    assert.strictEqual(activities[0], prepared.activities.find((activity) => activity.id === activities[0].id));
});

test("camera, filters, stay areas, focus restoration, and theme state are deterministic", () => {
    assert.deepEqual(cameraAnimationOptions(false, 750), { duration: 750, essential: false });
    assert.deepEqual(cameraAnimationOptions(true, 750), { duration: 0, essential: false });
    const placesById = new Map(sample.places.map((place) => [place.id, place]));
    assert.deepEqual(
        visibleTransportLegIds(sample.transportLegs, {
            selectedDayId: "singapore-waterfront",
            selectedLocationId: "singapore",
            transportEnabled: true,
            placesById,
        }),
        ["saigon-to-singapore"],
    );
    const daysById = new Map(sample.days.map((day) => [day.id, day]));
    assert.deepEqual(visibleStayLocationIds({
        selectedDayId: "singapore-waterfront",
        selectedLocationId: "",
        daysById,
    }), ["saigon", "singapore"]);
    const identity = focusIdentity({ dataset: { legId: "flight" } });
    assert.deepEqual(identity, { type: "transport", id: "flight" });
    assert.equal(focusSelector(identity), '[data-leg-id="flight"]');
    assert.equal(shouldRestoreMapStyle({ styleReady: false, styleWasSet: false }), true);
    assert.equal(shouldRestoreMapStyle({ styleReady: true, styleWasSet: false }), false);
    assert.equal(standalonePlaceMatchesFilters(
        { category: "food", locationId: "singapore" },
        {
            hasScheduledActivities: false,
            selectedCategories: new Set(["food"]),
            selectedDayId: "singapore-waterfront",
            selectedLocationId: "",
            daysById,
        },
    ), true);
    assert.equal(standalonePlaceMatchesFilters(
        { category: "food", locationId: "singapore" },
        {
            hasScheduledActivities: true,
            selectedCategories: new Set(["food"]),
            selectedDayId: "singapore-waterfront",
            selectedLocationId: "",
            daysById,
        },
    ), false);
});

test("partial map cleanup disconnects observers and tolerates remove failures", () => {
    let disconnected = 0;
    let removed = 0;
    assert.equal(disposeMapResources(
        { remove: () => { removed += 1; } },
        { disconnect: () => { disconnected += 1; } },
    ), true);
    assert.equal(disconnected, 1);
    assert.equal(removed, 1);
    assert.equal(disposeMapResources({ remove: () => { throw new Error("partial"); } }), false);
});

test("browser app imports without DOM side effects and client lifecycle cleans owned resources", () => {
    assert.equal(typeof startCanvasApp, "function");
    const listeners = new Map();
    const removed = [];
    const eventHandlers = new Map();
    let closed = 0;
    let disposed = 0;
    const fakeWindow = {
        addEventListener: (name, handler) => listeners.set(name, handler),
        removeEventListener: (name, handler) => removed.push([name, handler]),
    };
    const themeQuery = {
        removeEventListener: (name, handler) => removed.push([`theme:${name}`, handler]),
    };
    const events = {
        addEventListener: (name, handler) => eventHandlers.set(name, handler),
        removeEventListener: (name, handler) => removed.push([`events:${name}`, handler]),
        close: () => { closed += 1; },
    };
    const onlineHandler = () => undefined;
    const themeHandler = () => undefined;
    let connected = 0;
    let disconnected = 0;
    const lifecycle = attachClientLifecycle({
        events,
        window: fakeWindow,
        themeQuery,
        onlineHandler,
        themeHandler,
        onConnected: () => { connected += 1; },
        onDisconnected: () => { disconnected += 1; },
        dispose: () => { disposed += 1; },
    });
    eventHandlers.get("open")();
    eventHandlers.get("error")();
    assert.equal(connected, 1);
    assert.equal(disconnected, 1);
    listeners.get("pagehide")();
    lifecycle.teardown();
    assert.equal(closed, 1);
    assert.equal(disposed, 1);
    assert(removed.some(([name, handler]) => name === "online" && handler === onlineHandler));
    assert(removed.some(([name, handler]) => name === "theme:change" && handler === themeHandler));
    assert(removed.some(([name]) => name === "events:open"));
    assert(removed.some(([name]) => name === "events:error"));
});

test("transport selection resolves coherent focus and filtered marker legs", () => {
    const daysById = new Map(sample.days.map((day) => [day.id, day]));
    const placesById = new Map(sample.places.map((place) => [place.id, place]));
    assert.deepEqual(focusForTransportLeg(sample.transportLegs[1], daysById), {
        dayId: "singapore-waterfront",
        locationId: "",
    });
    assert.equal(chooseMarkerLeg(sample.transportLegs, {
        selectedDayId: "",
        selectedLocationId: "singapore",
        transportEnabled: true,
        placesById,
    }).id, "saigon-to-singapore");
    assert.equal(chooseMarkerLeg(sample.transportLegs, {
        selectedDayId: "",
        selectedLocationId: "singapore",
        transportEnabled: true,
        placesById,
    }, "saigon-to-singapore").id, "saigon-to-singapore");
    assert.equal(chooseMarkerLeg(sample.transportLegs, {
        selectedDayId: "hanoi-old-quarter",
        selectedLocationId: "singapore",
        transportEnabled: true,
        placesById,
    }), undefined);
    assert.equal(chooseMarkerLeg(sample.transportLegs, {
        selectedDayId: "singapore-waterfront",
        selectedLocationId: "singapore",
        transportEnabled: true,
        placesById,
    }).id, "saigon-to-singapore");
});

test("safeJson neutralizes script breaks and JavaScript line separators", () => {
    const encoded = safeJson({ value: "</script>\u2028\u2029" });
    assert(!encoded.includes("</script>"));
    assert(!encoded.includes("\u2028"));
    assert(!encoded.includes("\u2029"));
    assert.deepEqual(JSON.parse(encoded), { value: "</script>\u2028\u2029" });
});

test("theme helpers select public basemap styles and coherent palettes", () => {
    assert.equal(themeFromPreference(false), "light");
    assert.equal(themeFromPreference(true), "dark");
    assert.equal(mapStyleUrl("light"), "https://tiles.openfreemap.org/styles/liberty");
    assert.equal(mapStyleUrl("dark"), "https://tiles.openfreemap.org/styles/dark");
    assert.equal(mapStyleUrl("unexpected"), "https://tiles.openfreemap.org/styles/liberty");

    const light = mapPalette("light");
    const dark = mapPalette("dark");
    assert.equal(light.casing, "#ffffff");
    assert.equal(dark.casing, "#081018");
    assert.equal(dark.stayFillOpacity, 0.14);
    assert.notEqual(light.stayLabel, dark.stayLabel);
    assert.deepEqual(Object.keys(light), Object.keys(dark));
});

test("dark map style transform is pure, deterministic, and preserves provider semantics", () => {
    const localizedName = ["coalesce", ["get", "name_en"], ["get", "name"]];
    const filter = ["==", ["get", "admin_level"], 2];
    const style = {
        version: 8,
        sources: { openmaptiles: { type: "vector", url: "https://example.test/tiles" } },
        sprite: "https://example.test/sprite",
        glyphs: "https://example.test/fonts/{fontstack}/{range}.pbf",
        layers: [
            { id: "background", type: "background", paint: { "background-color": "#000" } },
            { id: "water", type: "fill", source: "openmaptiles", filter, paint: { "fill-color": "#111", "fill-antialias": false } },
            { id: "highway_major_inner", type: "line", layout: { "line-cap": "round" }, paint: { "line-color": "#222", "line-width": ["get", "width"] } },
            { id: "boundary_country_z0-4", type: "line", filter, paint: { "line-width": 2 } },
            { id: "railway", type: "line", paint: { "line-color": "#333", "line-width": 3 } },
            { id: "place_city_large", type: "symbol", filter: ["has", "name"], layout: { "text-field": localizedName, "text-size": 14 }, paint: { "text-color": "#444" } },
            { id: "place_other", type: "symbol", layout: { "text-field": localizedName }, paint: { "text-color": "#555" } },
        ],
    };
    const original = structuredClone(style);
    const dark = transformMapStyle(style, "dark");

    assert.deepEqual(style, original);
    assert.notStrictEqual(dark, style);
    assert.notStrictEqual(dark.sources, style.sources);
    assert.deepEqual(dark.sources, style.sources);
    assert.equal(dark.sprite, style.sprite);
    assert.equal(dark.glyphs, style.glyphs);
    assert.equal(dark.layers[0].paint["background-color"], "#111820");
    assert.equal(dark.layers[1].paint["fill-color"], "#172b3a");
    assert.equal(dark.layers[1].paint["fill-antialias"], false);
    assert.equal(dark.layers[2].paint["line-color"], "#3c4b5a");
    assert.deepEqual(dark.layers[2].paint["line-width"], ["get", "width"]);
    assert.deepEqual(dark.layers[3].filter, filter);
    assert.equal(dark.layers[3].paint["line-color"], "#8fa1b3");
    assert.equal(dark.layers[4].paint["line-opacity"], 0.42);
    assert.deepEqual(dark.layers[5].layout["text-field"], localizedName);
    assert.equal(dark.layers[5].paint["text-color"], "#f0f6fc");
    assert.equal(dark.layers[5].paint["text-halo-width"], 2);
    assert.equal(dark.layers[6].paint["text-opacity"], 0.68);
    assert.deepEqual(transformMapStyle(dark, "dark"), dark);
    assert.equal(darkStyleTransformCoverage(dark).adequate, false);
    assert.equal(darkStyleTransformCoverage({
        metadata: {
            "structured-itinerary-map:dark-transform": { matchedLayers: 20, expectedLayers: 30 },
        },
    }).adequate, true);
    const light = transformMapStyle(style, "light");
    assert.deepEqual(light, style);
    assert.notStrictEqual(light, style);
});

test("light and dark basemap transforms retain renderable provider sources and layers", () => {
    const providerStyle = {
        version: 8,
        sources: {
            openmaptiles: {
                type: "vector",
                url: "https://tiles.openfreemap.org/planet",
            },
        },
        layers: [
            { id: "background", type: "background", paint: { "background-color": "#ffffff" } },
            { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-opacity": 1 } },
            { id: "highway_major_inner", type: "line", source: "openmaptiles", "source-layer": "transportation", paint: { "line-opacity": 0.9 } },
        ],
    };

    for (const theme of ["light", "dark"]) {
        const transformed = transformMapStyle(providerStyle, theme);
        assert.deepEqual(basemapStyleHealth(transformed), {
            healthy: true,
            sourceCount: 1,
            layerCount: 3,
            visibleLayerCount: 3,
        });
        assert.equal(transformed.layers.some((layer) => layer.layout?.visibility === "none"), false);
    }
    assert.equal(basemapStyleHealth({ version: 8, sources: {}, layers: [] }).healthy, false);
    assert.equal(mapErrorSeverity({ error: new Error("Failed to construct 'Worker': blocked by Content Security Policy") }), "fatal");
    assert.equal(mapErrorSeverity({ error: new Error("tile request failed") }), "source");
});

test("revision helpers reject malformed or stale updates and detect missed reloads", () => {
    assert.equal(advanceRevision(2, 1), 2);
    assert.equal(advanceRevision(1, 2), 2);
    assert.equal(advanceRevision(2, Number.NaN), 2);
    assert.equal(advanceRevision(2, -1), 2);
    assert.equal(shouldReloadRevision(1, 2), true);
    assert.equal(shouldReloadRevision(2, 2), false);
    assert.equal(shouldReloadRevision(2, 1), false);
    assert.equal(shouldReloadRevision(2, "3"), false);
});

test("pending local focus prevents stale SSE bounce and reconciles final authority", () => {
    const state = createFocusSyncState(0);
    const first = queueLocalFocus(state, { locationId: "hanoi" });
    const second = queueLocalFocus(state, { locationId: "singapore" });
    assert.equal(receiveAuthoritativeFocus(state, {
        focus: { locationId: "hanoi" },
        focusRevision: 1,
    }).apply, false);
    assert.equal(settleLocalFocus(state, first.version, {
        focus: { locationId: "hanoi" },
        focusRevision: 1,
    }).apply, false);
    assert.equal(receiveAuthoritativeFocus(state, {
        focus: { locationId: "hanoi" },
        focusRevision: 1,
    }).apply, false);
    const settled = settleLocalFocus(state, second.version, {
        focus: { locationId: "singapore" },
        focusRevision: 2,
    });

    assert.equal(settled.apply, false, "older deferred echo must not replace the newer local selection");
    assert.deepEqual(receiveAuthoritativeFocus(state, {
        focus: { locationId: "singapore" },
        focusRevision: 2,
    }), { apply: true, focus: { locationId: "singapore" } });
});

test("matching authoritative focus preserves local card and transport selection state", () => {
    const daysById = new Map(sample.days.map((day) => [day.id, day]));
    const locationsById = new Map(sample.locations.map((location) => [location.id, location]));
    assert.equal(shouldApplyAuthoritativeFocus(
        { apply: true, focus: { dayId: "singapore-waterfront" } },
        { dayId: "singapore-waterfront" },
        daysById,
        locationsById,
    ), false);
    assert.equal(shouldApplyAuthoritativeFocus(
        { apply: true, focus: { locationId: "hanoi" } },
        { dayId: "singapore-waterfront" },
        daysById,
        locationsById,
    ), true);
});

test("focus 409 or recovery applies final authority after the local queue drains", () => {
    const state = createFocusSyncState(2);
    const request = queueLocalFocus(state, { locationId: "hanoi" });
    assert.deepEqual(settleLocalFocus(state, request.version, {
        focus: { locationId: "singapore" },
        focusRevision: 3,
    }, { authoritative: true }), {
        apply: true,
        focus: { locationId: "singapore" },
    });
});

test("runtime source guard enforces exactly one source", () => {
    assert.equal(assertSourceEnvelope({ itinerary: {} }), "inline");
    assert.equal(assertSourceEnvelope({ itineraryPath: "examples/sample.json" }), "path");
    assert.equal(assertSourceEnvelope({ itineraryPath: "examples\\sample.json" }), "path");
    for (const input of [{}, { itinerary: {}, itineraryPath: "sample.json" }]) {
        assert.throws(() => assertSourceEnvelope(input), (error) => error.code === "itinerary_source_invalid");
    }
    assert.throws(
        () => assertSourceEnvelope({ itineraryPath: "sample.txt" }),
        (error) => error.code === "itinerary_path_invalid",
    );
    for (const itineraryPath of ["examples/../sample.json", "examples\\..\\sample.json"]) {
        assert.throws(
            () => assertSourceEnvelope({ itineraryPath }),
            (error) => error.code === "itinerary_path_invalid",
        );
    }
});

test("runtime validates open envelopes and empty overview focus", () => {
    assert.doesNotThrow(() => assertOpenEnvelope({
        documentId: "valid-document",
        itinerary: {},
        initialFocus: {},
    }));
    assert.deepEqual(assertFocusShape({}), {});
    assert.throws(
        () => assertOpenEnvelope({ documentId: "not valid", itinerary: {} }),
        (error) => error.code === "itinerary_input_invalid",
    );
    assert.throws(
        () => assertFocusShape({ locationId: "../bad" }),
        (error) => error.code === "itinerary_focus_invalid",
    );
    assert.throws(
        () => assertOpenEnvelope({
            documentId: "large-inline",
            itinerary: { value: "x".repeat(MAX_ITINERARY_BYTES) },
        }),
        (error) => error.code === "itinerary_file_too_large",
    );
});

test("request path parsing rejects authority-form targets", () => {
    assert.equal(parseRequestPath("/state?x=1"), "/state");
    assert.equal(parseRequestPath("//attacker.example/state"), undefined);
});

test("runtime path loading rejects traversal, oversized files, and symlink escape", async (t) => {
    const scratch = await mkdtemp(join(tmpdir(), "trip-planner-paths-"));
    const project = await mkdtemp(join(scratch, "itinerary-project-"));
    const outside = await mkdtemp(join(scratch, "itinerary-outside-"));
    t.after(async () => {
        await rm(scratch, { recursive: true, force: true });
    });

    await mkdir(join(project, "examples"));
    await writeFile(join(project, "examples", "valid.json"), JSON.stringify({ ok: true }));
    assert.deepEqual(await loadItinerarySource({ itineraryPath: "examples/valid.json" }, project), { ok: true });
    await assert.rejects(
        loadItinerarySource({ itineraryPath: "../outside.json" }, project),
        (error) => error.code === "itinerary_path_invalid",
    );
    await writeFile(join(project, "examples", "large.json"), " ".repeat(MAX_ITINERARY_BYTES + 1));
    await assert.rejects(
        loadItinerarySource({ itineraryPath: "examples/large.json" }, project),
        (error) => error.code === "itinerary_file_too_large",
    );
    await writeFile(join(outside, "outside.json"), "{}");
    if (process.platform === "win32") {
        await symlink(outside, join(project, "examples", "outside-junction"), "junction");
        await assert.rejects(
            loadItinerarySource({ itineraryPath: "examples/outside-junction/outside.json" }, project),
            (error) => error.code === "itinerary_path_invalid",
        );
        return;
    }
    try {
        await symlink(join(outside, "outside.json"), join(project, "examples", "linked.json"), "file");
    } catch (error) {
        t.diagnostic(`Symlink test skipped: ${error.code}`);
        return;
    }
    await assert.rejects(
        loadItinerarySource({ itineraryPath: "examples/linked.json" }, project),
        (error) => error.code === "itinerary_path_invalid",
    );
});

test("path loading rechecks bytes after read to close stat-read growth", async () => {
    const project = join(root, "examples");
    const target = join(project, "sample-itinerary.json");
    await assert.rejects(
        loadItinerarySource({ itineraryPath: "sample-itinerary.json" }, project, {
            realpath: async (path) => path,
            stat: async () => ({ isFile: () => true, size: 2 }),
            readFile: async (path) => {
                assert.equal(path, target);
                return `"${"x".repeat(MAX_ITINERARY_BYTES)}"`;
            },
        }),
        (error) => error.code === "itinerary_file_too_large",
    );
});

test("loopback Host validation requires the bound port", () => {
    assert.equal(isExpectedLoopbackHost("127.0.0.1:4321", 4321), true);
    assert.equal(isExpectedLoopbackHost("localhost:4321", 4321), true);
    assert.equal(isExpectedLoopbackHost("example.com:4321", 4321), false);
    assert.equal(isExpectedLoopbackHost("127.0.0.1:9999", 4321), false);
    assert.equal(isExpectedLoopbackHost(undefined, 4321), false);
});

test("loopback Origin validation matches Host semantics", () => {
    assert.equal(isExpectedLoopbackOrigin("http://127.0.0.1:4321", 4321), true);
    assert.equal(isExpectedLoopbackOrigin("http://localhost:4321", 4321), true);
    assert.equal(isExpectedLoopbackOrigin("http://[::1]:4321", 4321), true);
    assert.equal(isExpectedLoopbackOrigin("http://127.0.0.1:9999", 4321), false);
    assert.equal(isExpectedLoopbackOrigin("https://127.0.0.1:4321", 4321), false);
    assert.equal(isExpectedLoopbackOrigin("http://example.com:4321", 4321), false);
});

test("SSE writes current events and removes dead streams", () => {
    const writes = [];
    const live = { destroyed: false, writableEnded: false, write: (value) => writes.push(value) };
    const dead = { destroyed: true, writableEnded: false, write: () => assert.fail("dead stream write") };
    const throwing = { destroyed: false, writableEnded: false, write: () => { throw new Error("closed"); }, destroy() {} };
    const streams = new Set([live, dead, throwing]);
    sendSse(streams, "state", { revision: 2 });
    assert.equal(streams.size, 1);
    assert.match(writes[0], /event: state/);
    assert.match(writes[0], /"revision":2/);
});

test("keyed serialization preserves operation order and recovers after failure", async () => {
    const serialize = createKeyedSerializer();
    const order = [];
    const first = serialize("panel", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("first");
        throw new Error("expected");
    });

    const second = serialize("panel", async () => order.push("second"));
    await assert.rejects(first, /expected/);
    await second;
    assert.deepEqual(order, ["first", "second"]);
});

test("extension controller serializes open/action/replace/close lifecycle without SDK side effects", async () => {
    class FakeCanvasError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
    let starts = 0;
    let replacements = 0;
    let stops = 0;
    const controller = createCanvasController({
        CanvasError: FakeCanvasError,
        itinerarySchema: schema,
        openSchemaSource,
        projectRoot: root,
        renderHtml,
        startCanvasServer: async (state) => {
            starts += 1;
            await new Promise((resolve) => setTimeout(resolve, 5));
            return {
                state,
                url: "http://127.0.0.1:4321/token/",
                revision: 1,
                focusRevision: 0,
                eventStreams: new Set(),
            };
        },
        replaceCanvasState: (entry, state) => {
            replacements += 1;
            entry.state = state;
            entry.revision += 1;
        },
        stopCanvasServer: async () => { stops += 1; },
    });
    const input = { documentId: "controller", itinerary: structuredClone(sample), initialFocus: {} };
    const [first, second] = await Promise.all([
        controller.descriptor.open({ instanceId: "panel", input }),
        controller.descriptor.open({ instanceId: "panel", input: { ...input, documentId: "replacement" } }),
    ]);
    assert.equal(starts, 1);
    assert.equal(replacements, 1);
    assert.match(first.url, /revision=1/);
    assert.match(second.url, /revision=2/);
    const setFocus = controller.descriptor.actions.find((action) => action.name === "set_focus").handler;
    assert.deepEqual(await setFocus({
        instanceId: "panel",
        input: { locationId: "singapore" },
    }), { documentId: "replacement", focus: { locationId: "singapore" } });
    const summary = await controller.descriptor.actions.find((action) => action.name === "get_summary").handler({
        instanceId: "panel",
        input: {},
    });
    assert.equal(summary.focus.locationId, "singapore");
    await controller.descriptor.onClose({ instanceId: "panel" });
    assert.equal(stops, 1);
    await assert.rejects(
        setFocus({ instanceId: "panel", input: {} }),
        (error) => error.code === "canvas_instance_missing",
    );
    await assert.rejects(
        controller.descriptor.open({ instanceId: "bad", input: { documentId: "bad", itinerary: {} } }),
        (error) => error.code === "itinerary_schema_invalid",
    );
});

test("server teardown ends streams and forces lingering sockets", async () => {
    let closeCallback;
    let idleClosed = false;
    let allClosed = false;
    let streamEnded = false;
    let socketDestroyed = false;
    const entry = {
        closing: false,
        heartbeat: setInterval(() => undefined, 1000),
        eventStreams: new Set([{ writableEnded: false, end: () => { streamEnded = true; } }]),
        sockets: new Set([{ destroy: () => { socketDestroyed = true; } }]),
        server: {
            close: (callback) => { closeCallback = callback; },
            closeIdleConnections: () => { idleClosed = true; },
            closeAllConnections: () => {
                allClosed = true;
                closeCallback();
            },
        },
    };
    await closeServerResources(entry, { graceMs: 1, forceMs: 10 });
    assert.equal(streamEnded, true);
    assert.equal(idleClosed, true);
    assert.equal(allClosed, true);
    assert.equal(socketDestroyed, true);
});

test("loopback server enforces HTTP boundaries and synchronizes SSE clients", async (t) => {
    const entry = await startCanvasServer({
        documentId: "integration",
        itinerary: structuredClone(sample),
        focus: {},
    }, {
        renderHtml: ({ nonce, documentId, revision }) => `<html data-document="${documentId}" data-revision="${revision}"><style nonce="${nonce}"></style><script nonce="${nonce}"></script></html>`,
        summarizeItinerary,
        validateFocus,
    });
    t.after(async () => stopCanvasServer(entry));

    const page = await requestServer(entry, appPath(entry));
    assert.equal(page.status, 200);
    assert.match(page.headers["content-security-policy"], /script-src 'self' 'nonce-[^']+'/);
    assert.doesNotMatch(page.headers["content-security-policy"], /unpkg\.com/);
    const scriptPolicy = page.headers["content-security-policy"]
        .split(";")
        .find((directive) => directive.trim().startsWith("script-src"));
    assert.doesNotMatch(scriptPolicy, /'unsafe-inline'/);
    assert.doesNotMatch(page.headers["content-security-policy"], /frame-ancestors/);
    const maplibreScript = await requestServer(entry, appPath(entry, "maplibre-gl.v6.9.0.js"));
    const maplibreStyles = await requestServer(entry, appPath(entry, "maplibre-gl.v6.9.0.css"));
    const health = await requestServer(entry, appPath(entry, "health"));
    const stateResponse = await requestServer(entry, appPath(entry, "state"));
    assert.equal(health.headers["x-content-type-options"], "nosniff");
    assert.equal(stateResponse.headers["x-content-type-options"], "nosniff");
    assert.equal(maplibreScript.status, 200);
    assert.match(maplibreScript.headers["content-type"], /text\/javascript/);
    assert.equal(maplibreScript.headers["x-content-type-options"], "nosniff");
    assert.equal(maplibreStyles.status, 200);
    assert.match(maplibreStyles.headers["content-type"], /text\/css/);
    assert.equal(maplibreStyles.headers["x-content-type-options"], "nosniff");
    const nonce = /nonce-([^']+)/.exec(page.headers["content-security-policy"])[1];
    assert.match(page.text, new RegExp(`style nonce="${nonce}"`));
    assert.match(page.text, new RegExp(`script nonce="${nonce}"`));

    const misdirected = await requestServer(entry, appPath(entry, "health"), {
        method: "POST",
        headers: { Host: "example.com" },
        body: ["first", "second"],
    });
    assert.equal(misdirected.status, 421);
    assert.equal(misdirected.headers.connection, "close");
    assert.equal(misdirected.headers["x-content-type-options"], "nosniff");
    const invalidTarget = await requestServer(entry, "http://attacker.example/state", {
        method: "POST",
        body: ["first", "second"],
    });
    assert.equal(invalidTarget.status, 400);
    assert.equal(invalidTarget.headers.connection, "close");
    assert.equal(invalidTarget.headers["x-content-type-options"], "nosniff");
    const outsideToken = await requestServer(entry, "/health", {
        method: "POST",
        body: ["first", "second"],
    });
    assert.equal(outsideToken.status, 404);
    assert.equal(outsideToken.headers.connection, "close");
    assert.equal(outsideToken.headers["x-content-type-options"], "nosniff");
    assert.equal((await requestServer(entry, "/not-the-token/state")).status, 404);
    assert.equal((await requestServer(entry, appPath(entry, "canvas-app.mjs"))).status, 200);
    assert.equal((await requestServer(entry, appPath(entry, "runtime-adapters.mjs"))).status, 200);
    assert.equal((await requestServer(entry, appPath(entry, "extension.mjs"))).status, 404);

    const forbidden = await requestServer(entry, "/not-the-token/focus", {
        method: "POST",
        headers: { Origin: new URL(entry.url).origin },
        body: JSON.stringify({ focus: {}, observedRevision: 0 }),
    });
    assert.equal(forbidden.status, 404);
    assert.equal(forbidden.headers.connection, "close");
    const wrongOrigin = await requestServer(entry, appPath(entry, "focus"), {
        method: "POST",
        headers: { Origin: "http://attacker.example" },
        body: JSON.stringify({ focus: {}, observedRevision: 0 }),
    });
    assert.equal(wrongOrigin.status, 403);
    assert.equal(wrongOrigin.headers.connection, "close");
    assert.equal(wrongOrigin.headers["x-content-type-options"], "nosniff");

    const invalid = await requestServer(entry, appPath(entry, "focus"), {
        method: "POST",
        headers: { Origin: new URL(entry.url).origin },
        body: JSON.stringify({
            focus: { dayId: "hanoi-old-quarter", locationId: "singapore" },
            observedRevision: 0,
        }),
    });
    assert.equal(invalid.status, 400);

    const first = await openEventStream(entry);
    const firstStateCount = () => first.chunks.join("").split("event: state").length - 1;
    assert.equal(firstStateCount(), 1);
    const second = await openEventStream(entry);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(firstStateCount(), 1, "opening a stream must not rebroadcast state to existing clients");

    const accepted = await requestServer(entry, appPath(entry, "focus"), {
        method: "POST",
        headers: { Origin: new URL(entry.url).origin },
        body: JSON.stringify({ focus: { locationId: "singapore" }, observedRevision: 0 }),
    });
    assert.equal(accepted.status, 200);
    await waitFor(() => first.chunks.join("").includes("event: focus")
        && second.chunks.join("").includes("event: focus"));

    const late = await openEventStream(entry);
    const lateState = /event: state\ndata: (.+)\n\n/.exec(late.chunks.join(""));
    assert(lateState);
    assert.deepEqual(JSON.parse(lateState[1]).focus, { locationId: "singapore" });
    assert.equal(JSON.parse(lateState[1]).focusRevision, 1);
    assert.equal(late.response.headers["x-content-type-options"], "nosniff");

    const stale = await requestServer(entry, appPath(entry, "focus"), {
        method: "POST",
        headers: { Origin: new URL(entry.url).origin },
        body: JSON.stringify({ focus: {}, observedRevision: 0 }),
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.headers["x-content-type-options"], "nosniff");
    assert.equal(JSON.parse(stale.text).focus.locationId, "singapore");
    const localhostAccepted = await requestServer(entry, appPath(entry, "focus"), {
        method: "POST",
        headers: {
            Host: `localhost:${entry.port}`,
            Origin: `http://localhost:${entry.port}`,
        },
        body: JSON.stringify({ focus: {}, observedRevision: 1 }),
    });
    assert.equal(localhostAccepted.status, 200);

    const oversized = await requestServer(entry, appPath(entry, "focus"), {
        method: "POST",
        headers: {
            Origin: new URL(entry.url).origin,
            "Content-Length": "9000",
        },
        body: " ".repeat(9000),
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.headers.connection, "close");
    assert.equal(oversized.headers["x-content-type-options"], "nosniff");
    const chunkedOversized = await requestServer(entry, appPath(entry, "focus"), {
        method: "POST",
        headers: { Origin: new URL(entry.url).origin },
        body: [" ".repeat(4096), " ".repeat(4096), "x"],
    });
    assert.equal(chunkedOversized.status, 413);
    assert.equal(chunkedOversized.headers.connection, "close");

    const previousRevision = entry.revision;
    replaceCanvasState(entry, {
        documentId: "replacement",
        itinerary: structuredClone(sample),
        focus: {},
    });
    assert.equal(entry.revision, previousRevision + 1);
    await waitFor(() => first.chunks.join("").includes("event: reload"));
    const state = await requestServer(entry, appPath(entry, "state"));
    assert.equal(JSON.parse(state.text).summary.documentId, "replacement");
    const replacementPage = await requestServer(entry, appPath(entry));
    assert.match(replacementPage.text, /data-document="replacement"/);
    assert.match(replacementPage.text, new RegExp(`data-revision="${entry.revision}"`));

    first.response.destroy();
    first.request.destroy();
    second.response.destroy();
    second.request.destroy();
    late.response.destroy();
    late.request.destroy();
});

test("real server teardown ends a live SSE response and releases the port", async () => {
    const entry = await startCanvasServer({
        documentId: "teardown",
        itinerary: structuredClone(sample),
        focus: {},
    }, {
        renderHtml: () => "<html></html>",
        summarizeItinerary,
        validateFocus,
    });
    const stream = await openEventStream(entry);
    const ended = new Promise((resolve) => {
        stream.response.once("end", resolve);
        stream.response.once("close", resolve);
    });
    await stopCanvasServer(entry);
    await Promise.race([
        ended,
        new Promise((_, reject) => setTimeout(() => reject(new Error("SSE stream did not end")), 1000)),
    ]);
    await assert.rejects(requestServer(entry, appPath(entry, "health")));
    stream.request.destroy();
});

test("summary reports place mapping and transport counts", () => {
    const summary = summarizeItinerary(sample, "sample-document");
    assert.deepEqual(summary.counts, {
        locations: 3,
        places: 9,
        days: 3,
        activities: 9,
        mappedActivities: 6,
        scheduleOnlyActivities: 3,
        transportLegs: 2,
        recommendedStayAreas: 1,
    });
    assert.deepEqual(summary.statuses.transportLegs, { booked: 1, tentative: 1 });
    assert.equal(summary.statuses.activities.cancelled, 1);
    assert.equal(summary.statuses.activities.planned, 5);
});

test("renderer emits a CSP-safe shell with external browser application", () => {
    const html = renderHtml({ itinerary: sample, documentId: "sample-document", initialFocus: {} });
    assert.match(html, /Hanoi to Singapore sampler/);
    assert.match(html, /maplibre-gl\.v6\.9\.0\.js/);
    assert.match(html, /overflow-x: hidden/);
    assert.match(html, /fieldset class="category-group"/);
    assert.match(html, /<details id="filters" class="filter-disclosure">/);
    assert.match(html, /<summary aria-controls="filter-panel">/);
    assert.match(html, /\.primary-controls \{ grid-template-columns: minmax\(82px, \.7fr\)/);
    assert.match(html, /\.filter-disclosure > summary \{ display: flex; min-height: 44px/);
    assert.match(html, /\.pin-wrap\.context \.pin/);
    assert.match(html, /\.pin-wrap\.selected \.pin \{ opacity: 1; transform: scale\(1\.2\)/);
    assert.doesNotMatch(html, /<label>Categories<\/label>/);
    assert.match(html, /id="maplibre-loader" defer/);
    assert.match(html, /--canvas-map-overlay: #202832/);
    assert.match(html, /--canvas-map-border: #596675/);
    assert.match(html, /prefers-color-scheme: dark/);
    assert.match(html, /name="theme-color" content="#0d1117" media="\(prefers-color-scheme: dark\)"/);
    assert.match(html, /maplibre-gl\.v6\.9\.0\.css/);
    assert.doesNotMatch(html, /unpkg\.com\/maplibre-gl/);
    assert.match(html, /<script id="itinerary-payload" type="application\/json" nonce="">/);
    assert.match(html, /<script type="module" src="canvas-bootstrap\.mjs"><\/script>/);
    assert.match(html, /\.map-top-stack\s*\{/);
    assert.match(html, /\.map-top-stack > \.error\s*\{\s*position: static;/);
    assert.match(html, /aria-label="Selected day details"/);
    assert.doesNotMatch(html, /focusToken/);
    assert.doesNotMatch(html, /Function\.prototype\.toString|const resolveFocusState = function/);
});
