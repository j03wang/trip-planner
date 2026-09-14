import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    assertFocusShape,
    closeServerResources,
    isExpectedLoopbackOrigin,
    isExpectedLoopbackHost,
    parseRequestPath,
    sendSse,
} from "./runtime-helpers.mjs";
import { MAPLIBRE_SCRIPT, MAPLIBRE_STYLESHEET } from "./maplibre-config.mjs";

const extensionDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(extensionDirectory, "..", "..", "..");
const browserAssets = new Map(await Promise.all(
    ["canvas-bootstrap.mjs", "canvas-app.mjs", "client-lifecycle.mjs", "focus-sync.mjs", "renderer-helpers.mjs", "runtime-adapters.mjs", "time-helpers.mjs"].map(async (name) => [
        `/${name}`,
        await readFile(resolve(extensionDirectory, name), "utf8"),
    ]),
));
for (const [route, path] of [
    [`/${MAPLIBRE_SCRIPT}`, resolve(repositoryRoot, "dist", MAPLIBRE_SCRIPT)],
    [`/${MAPLIBRE_STYLESHEET}`, resolve(repositoryRoot, "dist", MAPLIBRE_STYLESHEET)],
]) {
    browserAssets.set(route, await readFile(path, "utf8"));
}

function json(response, status, value) {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify(value));
}

function rejectRequest(request, response, status, contentType, body) {
    response.writeHead(status, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        Connection: "close",
        "X-Content-Type-Options": "nosniff",
    });
    response.flushHeaders();
    let drainedBytes = 0;
    let finished = false;
    const finish = (terminate = false) => {
        if (finished) return;
        finished = true;
        response.end(body, () => {
            if (terminate && !request.destroyed) request.destroy();
        });
    };
    if (request.readableEnded || request.complete) {
        finish();
        return;
    }
    request.on("data", (chunk) => {
        drainedBytes += chunk.length;
        if (drainedBytes > 65_536) finish(true);
    });
    request.once("end", () => finish());
    request.once("error", () => finish(true));
    request.resume();
}

export async function startCanvasServer(state, {
    renderHtml,
    summarizeItinerary,
    validateFocus,
}) {
    const entry = {
        server: undefined,
        url: undefined,
        port: undefined,
        state,
        eventStreams: new Set(),
        sockets: new Set(),
        token: randomUUID(),
        pathPrefix: undefined,
        revision: 1,
        focusRevision: 0,
        closing: false,
    };

    const server = createServer((request, response) => {
        if (!isExpectedLoopbackHost(request.headers.host, entry.port)) {
            rejectRequest(request, response, 421, "text/plain; charset=utf-8", "Misdirected request");
            return;
        }
        const pathname = parseRequestPath(request.url);
        if (!pathname) {
            rejectRequest(request, response, 400, "text/plain; charset=utf-8", "Invalid request target");
            return;
        }
        if (pathname !== entry.pathPrefix && !pathname.startsWith(`${entry.pathPrefix}/`)) {
            rejectRequest(request, response, 404, "text/plain; charset=utf-8", "Not found");
            return;
        }
        const route = pathname.slice(entry.pathPrefix.length) || "/";
        if (request.method === "GET" && (route === "/" || route === "/index.html")) {
            const nonce = randomUUID().replaceAll("-", "");
            response.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
                "Content-Security-Policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data: blob: https://tiles.openfreemap.org; connect-src 'self' https://tiles.openfreemap.org; font-src 'self' data: https://tiles.openfreemap.org; worker-src blob:; base-uri 'none'; object-src 'none';`,
                "Referrer-Policy": "no-referrer",
                "X-Content-Type-Options": "nosniff",
            });
            response.end(renderHtml({
                itinerary: entry.state.itinerary,
                documentId: entry.state.documentId,
                initialFocus: entry.state.focus,
                revision: entry.revision,
                focusRevision: entry.focusRevision,
                nonce,
            }));
            return;
        }
        if (request.method === "GET" && browserAssets.has(route)) {
            response.writeHead(200, {
                "Content-Type": route.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            });
            response.end(browserAssets.get(route));
            return;
        }
        if (request.method === "GET" && route === "/health") {
            json(response, 200, { status: "ok", documentId: entry.state.documentId });
            return;
        }
        if (request.method === "GET" && route === "/state") {
            json(response, 200, {
                summary: summarizeItinerary(entry.state.itinerary, entry.state.documentId),
                focus: entry.state.focus,
                revision: entry.revision,
                focusRevision: entry.focusRevision,
            });
            return;
        }
        if (request.method === "GET" && route === "/events") {
            response.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
                "X-Content-Type-Options": "nosniff",
            });
            entry.eventStreams.add(response);
            sendSse(new Set([response]), "state", {
                focus: entry.state.focus,
                revision: entry.revision,
                focusRevision: entry.focusRevision,
            });
            request.on("close", () => entry.eventStreams.delete(response));
            response.on("error", () => entry.eventStreams.delete(response));
            return;
        }
        if (request.method === "POST" && route === "/focus") {
            if (!isExpectedLoopbackOrigin(request.headers.origin, entry.port)) {
                rejectRequest(
                    request,
                    response,
                    403,
                    "application/json; charset=utf-8",
                    JSON.stringify({ error: "forbidden" }),
                );
                return;
            }
            let size = 0;
            let rejected = false;
            const chunks = [];
            request.on("data", (chunk) => {
                if (rejected) return;
                size += chunk.length;
                if (size > 8192) {
                    rejected = true;
                    rejectRequest(
                        request,
                        response,
                        413,
                        "application/json; charset=utf-8",
                        JSON.stringify({ error: "focus payload exceeds 8192 bytes" }),
                    );
                    return;
                }
                chunks.push(chunk);
            });
            request.on("end", () => {
                if (rejected) return;
                try {
                    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
                        throw new Error("focus payload must be an object");
                    }
                    const unknown = Object.keys(payload).find(
                        (key) => key !== "focus" && key !== "observedRevision",
                    );
                    if (unknown) throw new Error(`${unknown}: unknown property`);
                    if (!Object.hasOwn(payload, "focus")
                        || !Number.isSafeInteger(payload.observedRevision)
                        || payload.observedRevision < 0) {
                        throw new Error("focus and a non-negative integer observedRevision are required");
                    }
                    const focus = assertFocusShape(payload.focus, "focus");
                    const errors = validateFocus(focus, entry.state.itinerary, "focus");
                    if (errors.length) throw new Error(errors.join("; "));
                    if (payload.observedRevision !== entry.focusRevision) {
                        json(response, 409, {
                            documentId: entry.state.documentId,
                            focus: entry.state.focus,
                            focusRevision: entry.focusRevision,
                        });
                        return;
                    }
                    entry.state.focus = focus;
                    entry.focusRevision += 1;
                    const accepted = {
                        documentId: entry.state.documentId,
                        focus: entry.state.focus,
                        focusRevision: entry.focusRevision,
                    };
                    sendSse(entry.eventStreams, "focus", accepted);
                    json(response, 200, accepted);
                } catch (error) {
                    json(response, 400, { error: error.message });
                }
            });
            request.on("error", () => undefined);
            return;
        }
        rejectRequest(request, response, 404, "text/plain; charset=utf-8", "Not found");
    });
    server.on("connection", (socket) => {
        entry.sockets.add(socket);
        socket.on("close", () => entry.sockets.delete(socket));
    });
    await new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    entry.port = typeof address === "object" && address ? address.port : 0;
    entry.server = server;
    entry.pathPrefix = `/${entry.token}`;
    entry.url = `http://127.0.0.1:${entry.port}${entry.pathPrefix}/`;
    entry.heartbeat = setInterval(
        () => sendSse(entry.eventStreams, "heartbeat", { revision: entry.revision }),
        15_000,
    );
    entry.heartbeat.unref();
    return entry;
}

export function replaceCanvasState(entry, state) {
    entry.state = state;
    entry.revision += 1;
    entry.focusRevision += 1;
    sendSse(entry.eventStreams, "reload", { revision: entry.revision });
}

export async function stopCanvasServer(entry) {
    await closeServerResources(entry);
}
