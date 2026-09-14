const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
import { isValidTimeZone, localDateTimeToEpoch } from "./time-helpers.mjs";

function valueType(value) {
    if (Array.isArray(value)) return "array";
    if (value === null) return "null";
    return typeof value;
}

function resolveRef(rootSchema, ref) {
    if (!ref.startsWith("#/")) {
        throw new Error(`Unsupported schema reference "${ref}"`);
    }
    return ref
        .slice(2)
        .split("/")
        .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
        .reduce((value, part) => value?.[part], rootSchema);
}

function validateNode(value, schema, rootSchema, path, errors) {
    if (schema.$ref) {
        const resolved = resolveRef(rootSchema, schema.$ref);
        if (!resolved) {
            errors.push(`${path}: schema reference "${schema.$ref}" could not be resolved`);
            return;
        }
        validateNode(value, resolved, rootSchema, path, errors);
        return;
    }

    if (Object.hasOwn(schema, "const") && value !== schema.const) {
        errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
    }
    if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path}: must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
    }
    if (schema.type && valueType(value) !== schema.type) {
        errors.push(`${path}: expected ${schema.type}, received ${valueType(value)}`);
        return;
    }

    if (schema.type === "object") {
        const properties = schema.properties ?? {};
        for (const name of schema.required ?? []) {
            if (!Object.hasOwn(value, name)) errors.push(`${path}.${name}: is required`);
        }
        if (schema.additionalProperties === false) {
            for (const name of Object.keys(value)) {
                if (!Object.hasOwn(properties, name)) errors.push(`${path}.${name}: unknown property`);
            }
        }
        for (const [name, child] of Object.entries(properties)) {
            if (Object.hasOwn(value, name)) validateNode(value[name], child, rootSchema, `${path}.${name}`, errors);
        }
        if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
            for (const [name, childValue] of Object.entries(value)) {
                if (!Object.hasOwn(properties, name)) {
                    if (schema.propertyNames) validateNode(name, schema.propertyNames, rootSchema, `${path} key`, errors);
                    validateNode(childValue, schema.additionalProperties, rootSchema, `${path}.${name}`, errors);
                }
            }
        }
    }

    if (schema.type === "array") {
        if (schema.minItems !== undefined && value.length < schema.minItems) {
            errors.push(`${path}: must contain at least ${schema.minItems} item(s)`);
        }
        if (schema.items) {
            value.forEach((item, index) => validateNode(item, schema.items, rootSchema, `${path}[${index}]`, errors));
        }
    }

    if (schema.type === "string") {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
            errors.push(`${path}: must contain at least ${schema.minLength} character(s)`);
        }
        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
            errors.push(`${path}: must contain no more than ${schema.maxLength} character(s)`);
        }
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
            errors.push(`${path}: does not match required pattern ${schema.pattern}`);
        }
        if (schema.format === "uri") {
            try {
                new URL(value);
            } catch {
                errors.push(`${path}: must be a valid absolute URI`);
            }
        }
    }

    if (schema.type === "number") {
        if (!Number.isFinite(value)) errors.push(`${path}: must be finite`);
        if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
        if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
    }
}

function findDuplicates(values) {
    const seen = new Set();
    return [...new Set(values.filter((value) => seen.has(value) || !seen.add(value)))];
}

function isValidDate(value) {
    const match = DATE_PATTERN.exec(value ?? "");
    if (!match) return false;
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function effectiveActivityLocationId(activity, day, placesById) {
    const placeLocationId = activity.placeId ? placesById.get(activity.placeId)?.locationId : undefined;
    return placeLocationId ?? activity.locationId ?? (day.locationIds?.length === 1 ? day.locationIds[0] : undefined);
}

function validateSemanticRules(itinerary, errors) {
    const trip = itinerary.trip && typeof itinerary.trip === "object" && !Array.isArray(itinerary.trip)
        ? itinerary.trip
        : {};
    if (trip.startDate && !isValidDate(trip.startDate)) {
        errors.push("$.trip.startDate: must be a real calendar date");
    }
    if (trip.endDate && !isValidDate(trip.endDate)) {
        errors.push("$.trip.endDate: must be a real calendar date");
    }
    if (isValidDate(trip.startDate) && isValidDate(trip.endDate)
        && trip.startDate > trip.endDate) {
        errors.push("$.trip: startDate must not be after endDate");
    }

    const objects = (value) => Array.isArray(value)
        ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item))
        : [];
    const locations = objects(itinerary.locations);
    const places = objects(itinerary.places);
    const days = objects(itinerary.days);
    const transportLegs = objects(itinerary.transportLegs);
    const stayAreas = objects(itinerary.recommendedStayAreas);
    const locationIds = new Set(locations.map((location) => location.id).filter((id) => typeof id === "string"));
    const dayIds = new Set(days.map((day) => day.id).filter((id) => typeof id === "string"));
    const locationsById = new Map(locations.filter((location) => typeof location.id === "string").map((location) => [location.id, location]));
    const daysById = new Map(days.filter((day) => typeof day.id === "string").map((day) => [day.id, day]));
    const placesById = new Map(places.filter((place) => typeof place.id === "string").map((place) => [place.id, place]));

    const stringIds = (items) => items.map((item) => item.id).filter((id) => typeof id === "string");
    for (const duplicate of findDuplicates(stringIds(locations))) {
        errors.push(`$.locations: duplicate location id "${duplicate}"`);
    }
    for (const duplicate of findDuplicates(stringIds(places))) {
        errors.push(`$.places: duplicate place id "${duplicate}"`);
    }
    for (const duplicate of findDuplicates(stringIds(days))) {
        errors.push(`$.days: duplicate day id "${duplicate}"`);
    }
    const activityIds = days.flatMap((day) => stringIds(objects(day.activities)));
    for (const duplicate of findDuplicates(activityIds)) {
        errors.push(`$.days.activities: duplicate activity id "${duplicate}"`);
    }
    for (const duplicate of findDuplicates(stringIds(transportLegs))) {
        errors.push(`$.transportLegs: duplicate transport-leg id "${duplicate}"`);
    }
    for (const duplicate of findDuplicates(stringIds(stayAreas))) {
        errors.push(`$.recommendedStayAreas: duplicate stay-area id "${duplicate}"`);
    }

    locations.forEach((location, index) => {
        if (location.timezone && !isValidTimeZone(location.timezone)) {
            errors.push(`$.locations[${index}].timezone: unknown IANA timezone "${location.timezone}"`);
        }
    });
    places.forEach((place, index) => {
        if (!locationIds.has(place.locationId)) {
            errors.push(`$.places[${index}].locationId: unknown location "${place.locationId}"`);
        }
    });
    days.forEach((day, dayIndex) => {
        const hasDayLocationIds = Array.isArray(day.locationIds);
        const dayLocationIds = hasDayLocationIds ? day.locationIds : [];
        for (const duplicate of findDuplicates(dayLocationIds.filter((id) => typeof id === "string"))) {
            errors.push(`$.days[${dayIndex}].locationIds: duplicate location id "${duplicate}"`);
        }
        dayLocationIds.forEach((locationId, locationIndex) => {
            if (!locationIds.has(locationId)) {
                errors.push(`$.days[${dayIndex}].locationIds[${locationIndex}]: unknown location "${locationId}"`);
            }
        });
        if (day.date && !isValidDate(day.date)) {
            errors.push(`$.days[${dayIndex}].date: must be a real calendar date`);
        } else if (isValidDate(day.date) && isValidDate(trip.startDate) && isValidDate(trip.endDate)
            && (day.date < trip.startDate || day.date > trip.endDate)) {
            errors.push(`$.days[${dayIndex}].date: must fall within the trip date range`);
        }
        objects(day.activities).forEach((activity, activityIndex) => {
            const path = `$.days[${dayIndex}].activities[${activityIndex}]`;
            const place = activity.placeId ? placesById.get(activity.placeId) : undefined;
            if (activity.placeId && !place) errors.push(`${path}.placeId: unknown place "${activity.placeId}"`);
            if (activity.locationId && !locationIds.has(activity.locationId)) {
                errors.push(`${path}.locationId: unknown location "${activity.locationId}"`);
            }
            if (place && activity.locationId && activity.locationId !== place.locationId) {
                errors.push(`${path}: locationId "${activity.locationId}" conflicts with place "${activity.placeId}" in location "${place.locationId}"`);
            }
            const effectiveLocationId = effectiveActivityLocationId(activity, day, placesById);
            if (hasDayLocationIds && effectiveLocationId && !dayLocationIds.includes(effectiveLocationId)) {
                errors.push(`${path}: effective location "${effectiveLocationId}" is not listed in its day's locationIds`);
            }
            if (hasDayLocationIds && (activity.startTime || activity.endTime) && !effectiveLocationId) {
                errors.push(`${path}: local time requires an effective location timezone; set locationId, placeId, or use a single-location day`);
            }
            const effectiveTimeZone = locationsById.get(effectiveLocationId)?.timezone;
            for (const field of ["startTime", "endTime"]) {
                if (activity[field] && effectiveTimeZone
                    && localDateTimeToEpoch(`${day.date}T${activity[field]}`, effectiveTimeZone) === undefined) {
                    errors.push(`${path}.${field}: invalid or nonexistent local time in ${effectiveTimeZone}`);
                }
            }
            if (activity.startTime && activity.endTime && activity.endTime < activity.startTime) {
                errors.push(`${path}.endTime: must not be before startTime on the same local day`);
            }
        });
    });

    transportLegs.forEach((leg, legIndex) => {
        const path = `$.transportLegs[${legIndex}]`;
        if (leg.dayId && !dayIds.has(leg.dayId)) {
            errors.push(`${path}.dayId: unknown day "${leg.dayId}"`);
        }
        const origin = placesById.get(leg.originPlaceId);
        const destination = placesById.get(leg.destinationPlaceId);
        if (!origin) errors.push(`${path}.originPlaceId: unknown place "${leg.originPlaceId}"`);
        if (!destination) errors.push(`${path}.destinationPlaceId: unknown place "${leg.destinationPlaceId}"`);
        const legDay = leg.dayId ? daysById.get(leg.dayId) : undefined;
        const hasLegDayLocationIds = Array.isArray(legDay?.locationIds);
        const legDayLocationIds = hasLegDayLocationIds ? legDay.locationIds : [];
        if (hasLegDayLocationIds && origin && !legDayLocationIds.includes(origin.locationId)) {
            errors.push(`${path}.originPlaceId: location "${origin.locationId}" is not listed in day "${leg.dayId}"`);
        }
        if (hasLegDayLocationIds && destination && !legDayLocationIds.includes(destination.locationId)) {
            errors.push(`${path}.destinationPlaceId: location "${destination.locationId}" is not listed in day "${leg.dayId}"`);
        }
        if (origin && leg.departureLocalDateTime) {
            const timeZone = locationsById.get(origin.locationId)?.timezone;
            if (timeZone && localDateTimeToEpoch(leg.departureLocalDateTime, timeZone) === undefined) {
                errors.push(`${path}.departureLocalDateTime: invalid or nonexistent local time in ${timeZone}`);
            }
        }
        if (destination && leg.arrivalLocalDateTime) {
            const timeZone = locationsById.get(destination.locationId)?.timezone;
            if (timeZone && localDateTimeToEpoch(leg.arrivalLocalDateTime, timeZone) === undefined) {
                errors.push(`${path}.arrivalLocalDateTime: invalid or nonexistent local time in ${timeZone}`);
            }
        }
        if (origin && destination && leg.departureLocalDateTime && leg.arrivalLocalDateTime) {
            const originTimeZone = locationsById.get(origin.locationId)?.timezone;
            const destinationTimeZone = locationsById.get(destination.locationId)?.timezone;
            const departure = originTimeZone && localDateTimeToEpoch(leg.departureLocalDateTime, originTimeZone);
            const arrival = destinationTimeZone && localDateTimeToEpoch(leg.arrivalLocalDateTime, destinationTimeZone);
            if (departure !== undefined && arrival !== undefined && arrival < departure) {
                errors.push(`${path}.arrivalLocalDateTime: resolves before departure across endpoint timezones`);
            }
        }
        (Array.isArray(leg.lines) ? leg.lines : []).forEach((line, lineIndex) => {
            if (!Array.isArray(line)) return;
            for (let pointIndex = 1; pointIndex < line.length; pointIndex += 1) {
                const previous = line[pointIndex - 1];
                const current = line[pointIndex];
                if (previous && current && Math.abs(current.longitude - previous.longitude) > 180) {
                    errors.push(
                        `${path}.lines[${lineIndex}][${pointIndex}]: antimeridian crossing must be split into separate lines`,
                    );
                }
            }
        });
    });
    stayAreas.forEach((area, areaIndex) => {
        if (!locationIds.has(area.locationId)) {
            errors.push(`$.recommendedStayAreas[${areaIndex}].locationId: unknown location "${area.locationId}"`);
        }
        (Array.isArray(area.boundaries) ? area.boundaries : []).forEach((ring, ringIndex) => {
            if (!Array.isArray(ring)) return;
            const first = ring[0];
            const last = ring.at(-1);
            if (first && last && (first.latitude !== last.latitude || first.longitude !== last.longitude)) {
                errors.push(`$.recommendedStayAreas[${areaIndex}].boundaries[${ringIndex}]: polygon ring must be closed`);
            }
        });
    });
}

export function validateItinerary(itinerary, schema) {
    const errors = [];
    validateNode(itinerary, schema, schema, "$", errors);
    if (itinerary && typeof itinerary === "object" && !Array.isArray(itinerary)) {
        validateSemanticRules(itinerary, errors);
    }
    return errors;
}

export function validateSchemaValue(value, schema) {
    const errors = [];
    validateNode(value, schema, schema, "$", errors);
    return errors;
}

export function validateFocus(focus, itinerary, path = "initialFocus") {
    const errors = [];
    const locationExists = focus?.locationId && itinerary.locations.some((location) => location.id === focus.locationId);
    const day = focus?.dayId ? itinerary.days.find((item) => item.id === focus.dayId) : undefined;
    if (focus?.locationId && !locationExists) {
        errors.push(`${path}.locationId: unknown location "${focus.locationId}"`);
    }
    if (focus?.dayId && !day) {
        errors.push(`${path}.dayId: unknown day "${focus.dayId}"`);
    }
    if (locationExists && day && !day.locationIds.includes(focus.locationId)) {
        errors.push(`${path}: location "${focus.locationId}" is not included in day "${focus.dayId}"`);
    }
    return errors;
}

export function summarizeItinerary(itinerary, documentId) {
    const activities = itinerary.days.flatMap((day) => day.activities);
    const mappedActivities = activities.filter((activity) => activity.placeId);
    const countStatuses = (items) => items.reduce((counts, item) => {
        const status = item.status ?? "planned";
        counts[status] = (counts[status] ?? 0) + 1;
        return counts;
    }, {});
    return {
        documentId,
        schemaVersion: itinerary.schemaVersion,
        tripId: itinerary.trip.id,
        title: itinerary.trip.title,
        dateRange: { start: itinerary.trip.startDate, end: itinerary.trip.endDate },
        counts: {
            locations: itinerary.locations.length,
            places: itinerary.places.length,
            days: itinerary.days.length,
            activities: activities.length,
            mappedActivities: mappedActivities.length,
            scheduleOnlyActivities: activities.length - mappedActivities.length,
            transportLegs: itinerary.transportLegs?.length ?? 0,
            recommendedStayAreas: itinerary.recommendedStayAreas?.length ?? 0,
        },
        categories: [...new Set([
            ...activities.map((activity) => activity.category),
            ...itinerary.places.flatMap((place) => place.category ? [place.category] : []),
        ])].sort(),
        statuses: {
            days: countStatuses(itinerary.days),
            activities: countStatuses(activities),
            transportLegs: countStatuses(itinerary.transportLegs ?? []),
        },
    };
}
