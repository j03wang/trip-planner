import { realpath, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { ERROR_CODES } from "./error-codes.mjs";
import { MAX_ITINERARY_BYTES } from "./itinerary-limits.mjs";

export { MAX_ITINERARY_BYTES };
export const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class ItineraryRuntimeError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "ItineraryRuntimeError";
        this.code = code;
    }
}

export function createKeyedSerializer() {
    const queues = new Map();
    return function serialize(key, operation) {
        const previous = queues.get(key) ?? Promise.resolve();
        const current = previous.catch(() => undefined).then(operation);
        queues.set(key, current);
        return current.finally(() => {
            if (queues.get(key) === current) queues.delete(key);
        });
    };
}

export function assertSourceEnvelope(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new ItineraryRuntimeError(ERROR_CODES.inputInvalid, "Canvas input must be an object.");
    }
    const hasInline = Object.hasOwn(input ?? {}, "itinerary");
    const hasPath = Object.hasOwn(input ?? {}, "itineraryPath");
    if (hasInline === hasPath) {
        throw new ItineraryRuntimeError(
            ERROR_CODES.sourceInvalid,
            "Provide exactly one itinerary source: either itinerary or itineraryPath.",
        );
    }

    if (hasInline) return "inline";
    if (typeof input.itineraryPath !== "string"
        || input.itineraryPath.length > 500
        || !/\.json$/.test(input.itineraryPath)
        || input.itineraryPath.split(/[\\/]+/).includes("..")) {
        throw new ItineraryRuntimeError(
            ERROR_CODES.pathInvalid,
            "itineraryPath must be a project-relative path ending in .json.",
        );
    }
    return "path";
}

export function assertIdentifier(value, path, code = ERROR_CODES.inputInvalid) {
    if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
        throw new ItineraryRuntimeError(code, `${path} must be a valid identifier.`);
    }
}

export function assertFocusShape(focus, path = "focus") {
    if (focus === undefined) return {};
    if (!focus || typeof focus !== "object" || Array.isArray(focus)) {
        throw new ItineraryRuntimeError(ERROR_CODES.focusInvalid, `${path} must be an object.`);
    }
    const keys = Object.keys(focus);
    const unknown = keys.find((key) => key !== "locationId" && key !== "dayId");
    if (unknown) {
        throw new ItineraryRuntimeError(ERROR_CODES.focusInvalid, `${path}.${unknown}: unknown property`);
    }
    for (const key of keys) assertIdentifier(focus[key], `${path}.${key}`, ERROR_CODES.focusInvalid);
    return { ...focus };
}

export function assertOpenEnvelope(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new ItineraryRuntimeError(ERROR_CODES.inputInvalid, "Canvas input must be an object.");
    }
    const unknown = Object.keys(input).find(
        (key) => !["documentId", "itinerary", "itineraryPath", "initialFocus"].includes(key),
    );
    if (unknown) {
        throw new ItineraryRuntimeError(ERROR_CODES.inputInvalid, `${unknown}: unknown property`);
    }
    assertIdentifier(input.documentId, "documentId");
    const source = assertSourceEnvelope(input);
    if (source === "inline") {
        let byteLength;
        try {
            byteLength = Buffer.byteLength(JSON.stringify(input.itinerary), "utf8");
        } catch (error) {
            throw new ItineraryRuntimeError(ERROR_CODES.jsonInvalid, `Inline itinerary cannot be serialized as JSON: ${error.message}`);
        }
        if (byteLength > MAX_ITINERARY_BYTES) {
            throw new ItineraryRuntimeError(
                ERROR_CODES.fileTooLarge,
                `Inline itinerary is ${byteLength} bytes; the maximum is ${MAX_ITINERARY_BYTES} bytes.`,
            );
        }
    }
    assertFocusShape(input.initialFocus, "initialFocus");
}

export function parseRequestPath(requestTarget) {
    if (typeof requestTarget !== "string" || !requestTarget.startsWith("/") || requestTarget.startsWith("//")) {
        return undefined;
    }
    try {
        return new URL(requestTarget, "http://127.0.0.1").pathname;
    } catch {
        return undefined;
    }
}

function assertContainedPath(root, target, message) {
    const relativePath = relative(root, target);
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        throw new ItineraryRuntimeError(ERROR_CODES.pathInvalid, message);
    }
}

export async function loadItinerarySource(input, projectRoot, fileOps = { realpath, stat, readFile }) {
    if (assertSourceEnvelope(input) === "inline") return input.itinerary;
    if (isAbsolute(input.itineraryPath)) {
        throw new ItineraryRuntimeError(ERROR_CODES.pathInvalid, "itineraryPath must be relative to the project root.");
    }
    const candidate = resolve(projectRoot, input.itineraryPath);
    assertContainedPath(projectRoot, candidate, "itineraryPath must resolve to a JSON file inside the project.");

    let realRoot;
    let realTarget;
    try {
        [realRoot, realTarget] = await Promise.all([
            fileOps.realpath(projectRoot),
            fileOps.realpath(candidate),
        ]);
    } catch (error) {
        throw new ItineraryRuntimeError(
            ERROR_CODES.fileUnreadable,
            `Could not access "${input.itineraryPath}": ${error.message}`,
        );
    }
    assertContainedPath(realRoot, realTarget, "itineraryPath must not resolve through a symlink outside the project.");
    let fileStats;
    try {
        fileStats = await fileOps.stat(realTarget);
    } catch (error) {
        throw new ItineraryRuntimeError(
            ERROR_CODES.fileUnreadable,
            `Could not inspect "${input.itineraryPath}": ${error.message}`,
        );
    }
    if (!fileStats.isFile()) {
        throw new ItineraryRuntimeError(ERROR_CODES.fileUnreadable, `"${input.itineraryPath}" is not a regular file.`);
    }
    if (fileStats.size > MAX_ITINERARY_BYTES) {
        throw new ItineraryRuntimeError(
            ERROR_CODES.fileTooLarge,
            `"${input.itineraryPath}" is ${fileStats.size} bytes; the maximum is ${MAX_ITINERARY_BYTES} bytes.`,
        );
    }

    let source;
    try {
        source = await fileOps.readFile(realTarget, "utf8");
    } catch (error) {
        throw new ItineraryRuntimeError(
            ERROR_CODES.fileUnreadable,
            `Could not read "${input.itineraryPath}": ${error.message}`,
        );
    }
    const sourceBytes = Buffer.byteLength(source, "utf8");
    if (sourceBytes > MAX_ITINERARY_BYTES) {
        throw new ItineraryRuntimeError(
            ERROR_CODES.fileTooLarge,
            `"${input.itineraryPath}" grew to ${sourceBytes} bytes while being read; the maximum is ${MAX_ITINERARY_BYTES} bytes.`,
        );
    }
    try {
        return JSON.parse(source);
    } catch (error) {
        throw new ItineraryRuntimeError(
            ERROR_CODES.jsonInvalid,
            `Could not parse "${input.itineraryPath}" as JSON: ${error.message}`,
        );
    }
}

export function isExpectedLoopbackHost(hostHeader, port) {
    if (typeof hostHeader !== "string") return false;
    try {
        const parsed = new URL(`http://${hostHeader}`);
        return parsed.port === String(port)
            && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]");
    } catch {
        return false;
    }
}

export function isExpectedLoopbackOrigin(originHeader, port) {
    if (typeof originHeader !== "string") return false;
    try {
        const origin = new URL(originHeader);
        return origin.protocol === "http:"
            && !origin.username
            && !origin.password
            && origin.pathname === "/"
            && isExpectedLoopbackHost(origin.host, port);
    } catch {
        return false;
    }
}

export function sendSse(eventStreams, eventName, data) {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const response of [...eventStreams]) {
        if (response.destroyed || response.writableEnded) {
            eventStreams.delete(response);
            continue;
        }
        try {
            response.write(payload);
        } catch {
            eventStreams.delete(response);
            response.destroy();
        }
    }
}

export async function closeServerResources(entry, { graceMs = 250, forceMs = 750 } = {}) {
    if (entry.closing) return;
    entry.closing = true;
    clearInterval(entry.heartbeat);
    for (const response of [...entry.eventStreams]) {
        entry.eventStreams.delete(response);
        if (!response.writableEnded) response.end();
    }
    let closed = false;
    const closedPromise = new Promise((resolveClose) => {
        entry.server.close(() => {
            closed = true;
            resolveClose();
        });
    });
    entry.server.closeIdleConnections?.();
    await Promise.race([closedPromise, new Promise((resolveWait) => setTimeout(resolveWait, graceMs))]);
    if (!closed) {
        entry.server.closeAllConnections?.();
        for (const socket of entry.sockets) socket.destroy();
        await Promise.race([closedPromise, new Promise((resolveWait) => setTimeout(resolveWait, forceMs))]);
    }
}
