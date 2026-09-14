const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const MAX_TIME_ZONE_FORMATTERS = 128;
const MAX_LOCAL_DATE_TIME_EPOCHS = 4096;
const timeZoneFormatters = new Map();
const timeZoneNameFormatters = new Map();
const localDateTimeEpochs = new Map();

function formatterForTimeZone(timeZone) {
    if (typeof timeZone !== "string" || !timeZone) return undefined;
    if (timeZoneFormatters.has(timeZone)) {
        const formatter = timeZoneFormatters.get(timeZone);
        timeZoneFormatters.delete(timeZone);
        timeZoneFormatters.set(timeZone, formatter);
        return formatter;
    }
    let formatter;
    try {
        formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        });
        formatter.format(new Date(0));
    } catch {
        return undefined;
    }
    timeZoneFormatters.set(timeZone, formatter);
    if (timeZoneFormatters.size > MAX_TIME_ZONE_FORMATTERS) {
        timeZoneFormatters.delete(timeZoneFormatters.keys().next().value);
    }
    return formatter;
}

function localDateTimeParts(value) {
    const match = LOCAL_DATE_TIME_PATTERN.exec(value ?? "");
    if (!match) return undefined;
    const [, year, month, day, hour, minute] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
        || date.getUTCHours() !== hour
        || date.getUTCMinutes() !== minute
    ) return undefined;
    return { year, month, day, hour, minute };
}

function partsInTimeZone(epoch, timeZone) {
    const formatter = formatterForTimeZone(timeZone);
    if (!formatter) return undefined;
    return Object.fromEntries(
        formatter.formatToParts(new Date(epoch))
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, Number(part.value)]),
    );
}

export function isValidTimeZone(timeZone) {
    return Boolean(formatterForTimeZone(timeZone));
}

function computeLocalDateTimeEpoch(value, timeZone) {
    const requested = localDateTimeParts(value);
    if (!requested || !formatterForTimeZone(timeZone)) return undefined;
    const utcGuess = Date.UTC(requested.year, requested.month - 1, requested.day, requested.hour, requested.minute);
    const guessedParts = partsInTimeZone(utcGuess, timeZone);
    const guessedAsUtc = Date.UTC(
        guessedParts.year,
        guessedParts.month - 1,
        guessedParts.day,
        guessedParts.hour,
        guessedParts.minute,
    );
    let epoch = utcGuess - (guessedAsUtc - utcGuess);
    const correctedParts = partsInTimeZone(epoch, timeZone);
    const correctedAsUtc = Date.UTC(
        correctedParts.year,
        correctedParts.month - 1,
        correctedParts.day,
        correctedParts.hour,
        correctedParts.minute,
    );
    if (correctedAsUtc !== utcGuess) epoch += utcGuess - correctedAsUtc;
    const actual = partsInTimeZone(epoch, timeZone);
    if (Object.keys(requested).some((key) => requested[key] !== actual[key])) return undefined;
    return epoch;
}

export function localDateTimeToEpoch(value, timeZone) {
    const key = `${timeZone}\0${value}`;
    if (localDateTimeEpochs.has(key)) {
        const epoch = localDateTimeEpochs.get(key);
        localDateTimeEpochs.delete(key);
        localDateTimeEpochs.set(key, epoch);
        return epoch;
    }
    const epoch = computeLocalDateTimeEpoch(value, timeZone);
    localDateTimeEpochs.set(key, epoch);
    if (localDateTimeEpochs.size > MAX_LOCAL_DATE_TIME_EPOCHS) {
        localDateTimeEpochs.delete(localDateTimeEpochs.keys().next().value);
    }
    return epoch;
}

export function shortTimeZoneLabel(timeZone, epoch = Date.now()) {
    if (typeof timeZone !== "string" || !timeZone || !Number.isFinite(epoch)) return "";
    let formatter = timeZoneNameFormatters.get(timeZone);
    if (!formatter) {
        if (!formatterForTimeZone(timeZone)) return "";
        formatter = new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: "short" });
        timeZoneNameFormatters.set(timeZone, formatter);
        if (timeZoneNameFormatters.size > MAX_TIME_ZONE_FORMATTERS) {
            timeZoneNameFormatters.delete(timeZoneNameFormatters.keys().next().value);
        }

    }
    try {
        return formatter.formatToParts(new Date(epoch)).find((part) => part.type === "timeZoneName")?.value ?? "";
    } catch {
        return "";
    }
}

export function transportTimeZoneLabel(leg, day, timeZone) {
    if (!leg?.departureLocalDateTime || !day?.date) return "";
    const referenceInstant = localDateTimeToEpoch(`${day.date}T12:00`, timeZone);
    return shortTimeZoneLabel(timeZone, referenceInstant);
}

export function timeZoneFormatterCacheSize() {
    return timeZoneFormatters.size;
}

export function localDateTimeEpochCacheSize() {
    return localDateTimeEpochs.size;
}

export function clearTimeZoneFormatterCache() {
    timeZoneFormatters.clear();
    timeZoneNameFormatters.clear();
    localDateTimeEpochs.clear();
}

export { MAX_LOCAL_DATE_TIME_EPOCHS, MAX_TIME_ZONE_FORMATTERS };
