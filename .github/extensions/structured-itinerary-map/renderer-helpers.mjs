import { localDateTimeToEpoch } from "./time-helpers.mjs";

export function safeJson(value) {
    return JSON.stringify(value)
        .replaceAll("<", "\\u003c")
        .replaceAll("\u2028", "\\u2028")
        .replaceAll("\u2029", "\\u2029");
}

export function themeFromPreference(prefersDark) {
    return prefersDark ? "dark" : "light";
}

export function mapStyleUrl(theme) {
    return theme === "dark"
        ? "https://tiles.openfreemap.org/styles/dark"
        : "https://tiles.openfreemap.org/styles/liberty";
}

export function transformMapStyle(style, theme) {
    const transformed = JSON.parse(JSON.stringify(style));
    if (theme !== "dark" || !Array.isArray(transformed.layers)) return transformed;

    const paintById = {
        background: { "background-color": "#111820" },
        water: { "fill-color": "#172b3a" },
        landcover_ice_shelf: { "fill-color": "#263744", "fill-opacity": 0.72 },
        landcover_glacier: { "fill-color": "#314655" },
        landuse_residential: { "fill-color": "#1b222b", "fill-opacity": 0.65 },
        landcover_wood: { "fill-color": "#182820" },
        landuse_park: { "fill-color": "#192a22" },
        waterway: { "line-color": "#27475b" },
        water_name: {
            "text-color": "#7fb6d6",
            "text-halo-color": "#101820",
            "text-halo-width": 1.5,
        },
        building: { "fill-color": "#1c232b", "fill-outline-color": "#303a45" },
        "aeroway-taxiway": { "line-color": "#303b47", "line-opacity": 0.75 },
        "aeroway-runway-casing": { "line-color": "#111820" },
        "aeroway-area": { "fill-color": "#28323c" },
        "aeroway-runway": { "line-color": "#465566" },
        road_area_pier: { "fill-color": "#202a33" },
        road_pier: { "line-color": "#202a33" },
        highway_path: { "line-color": "#343e49", "line-opacity": 0.45 },
        highway_minor: { "line-color": "#303b47", "line-opacity": 0.78 },
        highway_major_casing: { "line-color": "#111820" },
        highway_major_inner: { "line-color": "#3c4b5a" },
        highway_major_subtle: { "line-color": "#334252" },
        highway_motorway_casing: { "line-color": "#111820" },
        highway_motorway_inner: { "line-color": "#52677a" },
        highway_motorway_subtle: { "line-color": "#3b4c5c" },
        road_oneway: { "icon-opacity": 0.35 },
        road_oneway_opposite: { "icon-opacity": 0.35 },
        highway_name_other: {
            "text-color": "#b7c4d1",
            "text-halo-color": "#111820",
            "text-halo-width": 1.5,
        },
        highway_name_motorway: {
            "text-color": "#d2dbe4",
            "text-halo-color": "#111820",
            "text-halo-width": 1.5,
        },
        boundary_state: { "line-color": "#687786", "line-opacity": 0.8 },
        "boundary_country_z0-4": { "line-color": "#8fa1b3", "line-opacity": 0.92 },
        "boundary_country_z5-": { "line-color": "#8fa1b3", "line-opacity": 0.92 },
    };
    const quietPlaces = new Set(["place_other", "place_suburb", "place_village"]);
    const placeColors = {
        place_town: "#b7c2cd",
        place_city: "#d5dde5",
        place_city_large: "#f0f6fc",
        place_state: "#bac6d1",
        place_country_other: "#d7e0e8",
        place_country_minor: "#e1e8ef",
        place_country_major: "#f0f6fc",
    };

    let matchedLayers = 0;
    for (const layer of transformed.layers) {
        const paint = paintById[layer.id];
        if (paint) {
            layer.paint = { ...(layer.paint || {}), ...paint };
            matchedLayers += 1;
        }
        if (layer.id?.startsWith("railway")) {
            layer.paint = { ...(layer.paint || {}), "line-opacity": 0.42 };
        }
        if (quietPlaces.has(layer.id)) {
            layer.paint = {
                ...(layer.paint || {}),
                "text-color": "#7f8b97",
                "text-halo-color": "#111820",
                "text-halo-width": 1.25,
                "text-opacity": 0.68,
            };
        }
        if (placeColors[layer.id]) {
            layer.paint = {
                ...(layer.paint || {}),
                "text-color": placeColors[layer.id],
                "text-halo-color": "#111820",
                "text-halo-width": layer.id.includes("country") || layer.id === "place_city_large" ? 2 : 1.5,
            };
            matchedLayers += 1;
        }
    }
    transformed.metadata = {
        ...(transformed.metadata || {}),
        "structured-itinerary-map:dark-transform": {
            matchedLayers,
            expectedLayers: Object.keys(paintById).length + Object.keys(placeColors).length,
        },
    };
    return transformed;
}

export function darkStyleTransformCoverage(style) {
    const coverage = style?.metadata?.["structured-itinerary-map:dark-transform"];
    if (!coverage || !Number.isInteger(coverage.matchedLayers) || !Number.isInteger(coverage.expectedLayers)) {
        return { adequate: false, matchedLayers: 0, expectedLayers: 0 };
    }
    return {
        ...coverage,
        adequate: coverage.matchedLayers >= Math.max(8, Math.floor(coverage.expectedLayers * 0.35)),
    };
}

export function basemapStyleHealth(style) {
    const sources = style?.sources && typeof style.sources === "object"
        ? Object.keys(style.sources)
        : [];
    const layers = Array.isArray(style?.layers) ? style.layers : [];
    const visibleLayers = layers.filter((layer) => {
        if (layer?.layout?.visibility === "none") return false;
        const opacityValues = Object.entries(layer?.paint ?? {})
            .filter(([name, value]) => name.endsWith("-opacity") && typeof value === "number")
            .map(([, value]) => value);
        return opacityValues.length === 0 || opacityValues.some((value) => value > 0);
    });
    return {
        healthy: sources.length > 0 && visibleLayers.length > 0,
        sourceCount: sources.length,
        layerCount: layers.length,
        visibleLayerCount: visibleLayers.length,
    };
}

export function mapErrorSeverity(event) {
    const message = String(event?.error?.message ?? event?.message ?? "");
    if (/worker|content security policy|content-security-policy/i.test(message)) {
        return "fatal";
    }
    return "source";
}

export function mapPalette(theme) {
    return theme === "dark"
        ? {
            casing: "#081018",
            route: "#58b8ff",
            routeMuted: "#d0dae4",
            tentative: "#f2cc60",
            cancelled: "#b1bac4",
            selected: "#8bd0ff",
            selectedCancelled: "#ff7b72",
            stay: "#45c6c9",
            stayLabel: "#b8f3f4",
            labelHalo: "#081018",
            stayFillOpacity: 0.14,
        }
        : {
            casing: "#ffffff",
            route: "#0969da",
            routeMuted: "#57606a",
            tentative: "#9a6700",
            cancelled: "#6e7781",
            selected: "#0969da",
            selectedCancelled: "#cf222e",
            stay: "#008b8b",
            stayLabel: "#006b6b",
            labelHalo: "#ffffff",
            stayFillOpacity: 0.2,
        };
}

export function advanceRevision(current, candidate) {
    return Number.isSafeInteger(candidate) && candidate >= 0
        ? Math.max(current, candidate)
        : current;
}

export function shouldReloadRevision(embedded, candidate) {
    return Number.isSafeInteger(candidate)
        && candidate >= 0
        && candidate > embedded;
}

export function resolveFocus(focus, daysById, locationsById) {
    if (focus?.dayId && daysById.has(focus.dayId)) {
        const day = daysById.get(focus.dayId);
        return {
            dayId: focus.dayId,
            locationId: focus.locationId && day.locationIds.includes(focus.locationId)
                ? focus.locationId
                : (day.locationIds.length === 1 ? day.locationIds[0] : ""),
        };
    }
    return {
        dayId: "",
        locationId: focus?.locationId && (!locationsById || locationsById.has(focus.locationId))
            ? focus.locationId
            : "",
    };
}

export function shouldApplyAuthoritativeFocus(result, currentFocus, daysById, locationsById) {
    if (!result?.apply) return false;
    const next = resolveFocus(result.focus, daysById, locationsById);
    return next.dayId !== (currentFocus.dayId ?? "") || next.locationId !== (currentFocus.locationId ?? "");
}

export function directTransportLines(origin, destination) {
    const start = origin.coordinates;
    const end = destination.coordinates;
    const difference = end.longitude - start.longitude;
    if (Math.abs(difference) <= 180) return [[start, end]];
    const adjustedEndLongitude = difference > 180 ? end.longitude - 360 : end.longitude + 360;
    if (adjustedEndLongitude === start.longitude) {
        return [[start, { latitude: end.latitude, longitude: start.longitude }]];
    }
    const boundary = adjustedEndLongitude > start.longitude ? 180 : -180;
    const fraction = (boundary - start.longitude) / (adjustedEndLongitude - start.longitude);
    const crossingLatitude = start.latitude + (end.latitude - start.latitude) * fraction;
    const oppositeBoundary = boundary === 180 ? -180 : 180;
    return [
        [start, { latitude: crossingLatitude, longitude: boundary }],
        [{ latitude: crossingLatitude, longitude: oppositeBoundary }, end],
    ];
}

export function focusForTransportLeg(leg, daysById) {
    if (!leg.dayId || !daysById.has(leg.dayId)) return { dayId: "", locationId: "" };
    return resolveFocus({ dayId: leg.dayId }, daysById);
}

export function chooseMarkerLeg(legs, filters, currentLegId = "") {
    const visible = legs.filter((leg) => legMatchesFilters(leg, filters));
    return visible.find((leg) => leg.id === currentLegId) ?? visible[0];
}

export function legMatchesFilters(leg, {
    selectedDayId,
    selectedLocationId,
    transportEnabled,
    placesById,
}) {
    if (!transportEnabled) return false;
    if (selectedDayId && leg.dayId !== selectedDayId) return false;
    if (!selectedLocationId) return true;
    const origin = placesById.get(leg.originPlaceId);
    const destination = placesById.get(leg.destinationPlaceId);
    return origin?.locationId === selectedLocationId || destination?.locationId === selectedLocationId;
}

export function activityMatchesFilters(row, {
    selectedCategories,
    selectedDayId,
    selectedLocationId,
}) {
    return selectedCategories.has(row.category)
        && (!selectedDayId || row.day.id === selectedDayId)
        && (!selectedLocationId || row.effectiveLocationId === selectedLocationId);
}

export function unwrapTransportPoints(lines) {
    const points = [];
    let previousLongitude;
    for (const line of lines) {
        for (const point of line) {
            let longitude = point.longitude;
            if (previousLongitude !== undefined) {
                while (longitude - previousLongitude > 180) longitude -= 360;
                while (longitude - previousLongitude < -180) longitude += 360;
            }
            points.push({ latitude: point.latitude, longitude });
            previousLongitude = longitude;
        }
    }
    return points;
}

export function unwrapCoordinates(points) {
    if (points.length < 2) return points.map((point) => ({ ...point }));
    const normalized = points.map((point) => ({
        longitude: ((point.longitude % 360) + 360) % 360,
    })).sort((left, right) => left.longitude - right.longitude);
    let largestGap = -1;
    let startLongitude = normalized[0].longitude;
    for (let index = 0; index < normalized.length; index += 1) {
        const current = normalized[index].longitude;
        const next = index + 1 < normalized.length
            ? normalized[index + 1].longitude
            : normalized[0].longitude + 360;
        if (next - current > largestGap) {
            largestGap = next - current;
            startLongitude = next % 360;
        }
    }
    const unwrapped = points.map((point) => {
        let longitude = ((point.longitude % 360) + 360) % 360;
        if (longitude < startLongitude) longitude += 360;
        return { ...point, longitude };
    });
    const worldShift = Math.round((points[0].longitude - unwrapped[0].longitude) / 360) * 360;
    return unwrapped.map((point) => ({ ...point, longitude: point.longitude + worldShift }));
}

export function boundsForCoordinates(points) {
    const unwrapped = unwrapCoordinates(points);
    if (!unwrapped.length) return undefined;
    return unwrapped.reduce((bounds, point) => ({
        west: Math.min(bounds.west, point.longitude),
        east: Math.max(bounds.east, point.longitude),
        south: Math.min(bounds.south, point.latitude),
        north: Math.max(bounds.north, point.latitude),
    }), {
        west: Infinity,
        east: -Infinity,
        south: Infinity,
        north: -Infinity,
    });
}

export function cameraAnimationOptions(prefersReducedMotion, duration) {
    return { duration: prefersReducedMotion ? 0 : duration, essential: false };
}

export function disposeMapResources(map, resizeObserver) {
    resizeObserver?.disconnect?.();
    try {
        map?.remove?.();
    } catch {
        return false;
    }
    return true;
}

export function focusIdentity(element) {
    if (element?.dataset?.id) return { type: "activity", id: element.dataset.id };
    if (element?.dataset?.legId) return { type: "transport", id: element.dataset.legId };
    if (element?.dataset?.dayId) return { type: "day", id: element.dataset.dayId };
    return undefined;
}

export function focusSelector(identity, escape = (value) => value) {
    const attributes = {
        activity: "data-id",
        transport: "data-leg-id",
        day: "data-day-id",
    };
    return identity && attributes[identity.type]
        ? `[${attributes[identity.type]}="${escape(identity.id)}"]`
        : "";
}

export function visibleTransportLegIds(legs, filters) {
    return legs.filter((leg) => legMatchesFilters(leg, filters)).map((leg) => leg.id);
}

export function visibleStayLocationIds({ selectedDayId, selectedLocationId, daysById }) {
    if (selectedLocationId) return [selectedLocationId];
    if (selectedDayId) return [...(daysById.get(selectedDayId)?.locationIds ?? [])];
    return [];
}

export function standalonePlaceMatchesFilters(place, {
    hasScheduledActivities,
    selectedCategories,
    selectedDayId,
    selectedLocationId,
    daysById,
}) {
    if (hasScheduledActivities || !place.category || !selectedCategories.has(place.category)) return false;
    if (selectedLocationId) return place.locationId === selectedLocationId;
    if (selectedDayId) return Boolean(daysById.get(selectedDayId)?.locationIds.includes(place.locationId));
    return true;
}

export function shouldRestoreMapStyle({ styleReady, styleWasSet }) {
    return !styleReady || styleWasSet;
}

export function timelineEntriesForDay(day, activities, legs, { placesById, locationsById }) {
    const entries = [
        ...activities.map((activity, index) => {
            const locationId = activity.effectiveLocationId
                ?? (activity.placeId ? placesById.get(activity.placeId)?.locationId : undefined)
                ?? activity.locationId
                ?? (day.locationIds?.length === 1 ? day.locationIds[0] : undefined);
            const timeZone = locationsById.get(locationId)?.timezone;
            return {
                kind: "activity",
                value: activity,
                instant: activity.timelinePrepared ? activity.timelineInstant : (activity.startTime && timeZone
                    ? localDateTimeToEpoch(`${day.date}T${activity.startTime}`, timeZone)
                    : undefined),
                wallTime: activity.startTime ?? "99:99",
                index,
                timeZone: activity.timelineTimeZone ?? timeZone,
            };
        }),
        ...legs.map((leg, index) => {
            const origin = placesById.get(leg.originPlaceId);
            const timeZone = locationsById.get(origin?.locationId)?.timezone;
            return {
                kind: "transport",
                value: leg,
                instant: leg.timelinePrepared ? leg.timelineInstant : (leg.departureLocalDateTime && timeZone
                    ? localDateTimeToEpoch(leg.departureLocalDateTime, timeZone)
                    : undefined),
                wallTime: leg.departureLocalDateTime?.slice(11) ?? "99:99",
                index: activities.length + index,
                timeZone: leg.timelineTimeZone ?? timeZone,
            };
        }),
    ];
    return entries.sort((left, right) => {
        if (left.instant !== undefined && right.instant !== undefined) return left.instant - right.instant || left.index - right.index;
        if (left.instant !== undefined) return -1;
        if (right.instant !== undefined) return 1;
        return left.wallTime.localeCompare(right.wallTime) || left.index - right.index;
    });
}

export function precomputeTimelineRows(itinerary, { placesById, locationsById }) {
    const activities = itinerary.days.flatMap((day) => day.activities.map((activity) => {
        const locationId = activity.placeId
            ? placesById.get(activity.placeId)?.locationId
            : activity.locationId ?? (day.locationIds.length === 1 ? day.locationIds[0] : undefined);
        const timeZone = locationsById.get(locationId)?.timezone;
        return {
            ...activity,
            timelineInstant: activity.startTime && timeZone
                ? localDateTimeToEpoch(`${day.date}T${activity.startTime}`, timeZone)
                : undefined,
            timelineTimeZone: timeZone,
            timelinePrepared: true,
        };
    }));
    const legs = (itinerary.transportLegs ?? []).map((leg) => {
        const origin = placesById.get(leg.originPlaceId);
        const timeZone = locationsById.get(origin?.locationId)?.timezone;
        return {
            ...leg,
            timelineInstant: leg.departureLocalDateTime && timeZone
                ? localDateTimeToEpoch(leg.departureLocalDateTime, timeZone)
                : undefined,
            timelineTimeZone: timeZone,
            timelinePrepared: true,
        };
    });
    return { activities, legs };
}

export function canonicalVisiblePlaceIds({
    activityRows,
    visibleLegs,
    selectedLeg,
    selectedPlaceIds = [],
}) {
    const ids = new Set();
    activityRows.filter((row) => row.place && row.effectiveStatus !== "cancelled"
        && (row.day.status ?? "planned") !== "cancelled").forEach((row) => ids.add(row.place.id));
    visibleLegs.filter((leg) => (leg.status ?? "planned") !== "cancelled")
        .forEach((leg) => {
            ids.add(leg.originPlaceId);
            ids.add(leg.destinationPlaceId);
        });
    if (selectedLeg) {
        ids.add(selectedLeg.originPlaceId);
        ids.add(selectedLeg.destinationPlaceId);
    }
    for (const placeId of selectedPlaceIds) ids.add(placeId);
    return ids;
}

export function canonicalMarkerStates({
    activityRows,
    transportLegs,
    selectedCategories,
    selectedDayId,
    selectedLocationId,
    selectedLeg,
    selectedPlaceIds = [],
    daysById,
    placesById,
}) {
    const states = new Map();
    const setState = (placeId, state) => {
        const current = states.get(placeId);
        if (current === "selected" || (current === "active" && state === "context")) return;
        states.set(placeId, state);
    };
    for (const row of activityRows) {
        if (!row.place || row.effectiveStatus === "cancelled" || (row.day.status ?? "planned") === "cancelled") continue;
        if (!selectedCategories.has(row.category)) continue;
        if (selectedLocationId && row.effectiveLocationId !== selectedLocationId) continue;
        setState(row.place.id, selectedDayId && row.day.id !== selectedDayId ? "context" : "active");
    }
    if (selectedCategories.has("transport")) {
        for (const leg of transportLegs) {
            if ((leg.status ?? "planned") === "cancelled"
                || (leg.dayId && (daysById.get(leg.dayId)?.status ?? "planned") === "cancelled")) continue;
            const active = !selectedDayId || leg.dayId === selectedDayId;
            const origin = placesById.get(leg.originPlaceId);
            const destination = placesById.get(leg.destinationPlaceId);
            if (active && selectedLocationId
                && origin?.locationId !== selectedLocationId && destination?.locationId !== selectedLocationId) continue;
            for (const placeId of [leg.originPlaceId, leg.destinationPlaceId]) {
                if (!active && selectedLocationId && placesById.get(placeId)?.locationId !== selectedLocationId) continue;
                setState(placeId, active ? "active" : "context");
            }
        }
    }
    for (const placeId of selectedPlaceIds) setState(placeId, "selected");
    if (selectedLeg) {
        setState(selectedLeg.originPlaceId, "selected");
        setState(selectedLeg.destinationPlaceId, "selected");
    }
    return states;
}

export function dayTimeZoneContext(day, { locationsById }) {
    const zones = [...new Set((day.locationIds ?? [])
        .map((id) => locationsById.get(id)?.timezone)
        .filter(Boolean))];
    return zones.length > 1 ? new Set(zones) : new Set();
}
