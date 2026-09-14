import { createHash } from "node:crypto";

const SAFE_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const SAFE_NONCE = /^[A-Za-z0-9_-]{16,128}$/;

export function safeEmbeddedJson(value) {
    return JSON.stringify(value)
        .replaceAll("<", "\\u003c")
        .replaceAll("\u2028", "\\u2028")
        .replaceAll("\u2029", "\\u2029");
}

export function validateLibraryUrl(value) {
    if (typeof value !== "string" || !value.trim()) throw new Error("libraryUrl is required.");
    const url = value.trim();
    if (/[\u0000-\u0020"'<>\\]/.test(url) || /%5c/i.test(url) || url.startsWith("//")) {
        throw new Error("libraryUrl contains an unsafe or protocol-relative URL.");
    }
    let parsed;
    try {
        parsed = new URL(url, "https://itinerary.invalid/");
    } catch {
        throw new Error("libraryUrl must be a safe relative or HTTPS URL.");
    }
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(url);
    if (parsed.username || parsed.password || parsed.hash || !/\.js$/i.test(parsed.pathname)) {
        throw new Error("libraryUrl must identify a .js asset without credentials or a fragment.");
    }
    if (absolute && parsed.protocol !== "https:") {
        const loopbackHttp = parsed.protocol === "http:"
            && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
        if (!loopbackHttp) throw new Error("libraryUrl must use HTTPS; HTTP is allowed only for loopback preview.");
    }
    return url;
}

export function validateIntegrity(value) {
    if (value === undefined || value === "") return "";
    if (typeof value !== "string" || !/^sha384-[A-Za-z0-9+/]{64}$/.test(value)) {
        throw new Error("integrity must be a valid sha384 Subresource Integrity value.");
    }
    return value;
}

function librarySource(url) {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return "'self'";
    return new URL(url).origin;
}

function htmlAttribute(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\r", "&#13;")
        .replaceAll("\n", "&#10;");
}

function htmlText(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function validateId(name, value) {
    if (typeof value !== "string" || !SAFE_ID.test(value)) {
        throw new Error(`${name} must be a safe HTML identifier.`);
    }
    return value;
}

export function contentNonce(itinerary, url = "", sourceId = "trip-data", componentId = "trip-map") {
    return createHash("sha256")
        .update(safeEmbeddedJson({ itinerary, url, sourceId, componentId }))
        .digest("base64url")
        .slice(0, 32);
}

export function renderPortableItineraryHtml({
    itinerary,
    libraryUrl,
    integrity = "",
    sourceId = "trip-data",
    componentId = "trip-map",
    syncHash = true,
    nonce,
}) {
    const url = validateLibraryUrl(libraryUrl);
    const sri = validateIntegrity(integrity);
    const safeSourceId = validateId("sourceId", sourceId);
    const safeComponentId = validateId("componentId", componentId);
    const safeNonce = nonce ?? contentNonce(itinerary, url, safeSourceId, safeComponentId);
    if (!SAFE_NONCE.test(safeNonce)) throw new Error("nonce must contain 16-128 URL-safe characters.");
    const title = htmlText(itinerary.trip.title);
    const libraryPolicySource = librarySource(url);
    const scriptSources = [...new Set(["'self'", `'nonce-${safeNonce}'`, libraryPolicySource])].join(" ");
    const csp = [
        "default-src 'self'",
        `script-src ${scriptSources}`,
        `style-src 'self' 'nonce-${safeNonce}'`,
        "img-src 'self' data: blob: https://tiles.openfreemap.org",
        "connect-src https://tiles.openfreemap.org",
        "font-src 'self' data: https://tiles.openfreemap.org",
        "worker-src blob:",
        "base-uri 'none'",
        "object-src 'none'",
    ].join("; ");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="${htmlAttribute(csp)}">
  <meta name="generator" content="structured-itinerary-map-library/1">
  <title>${title}</title>
  <style nonce="${safeNonce}">html,body{height:100%;margin:0}itinerary-map{display:block;height:100%;min-height:420px}</style>
  <script defer src="${htmlAttribute(url)}"${sri ? ` integrity="${htmlAttribute(sri)}" crossorigin="anonymous"` : ""}></script>
</head>
<body>
  <itinerary-map id="${safeComponentId}" data-source="${safeSourceId}" style-nonce="${safeNonce}"${syncHash ? ` sync-hash="${safeComponentId}"` : ""}></itinerary-map>
  <script id="${safeSourceId}" type="application/json" nonce="${safeNonce}">${safeEmbeddedJson(itinerary)}</script>
</body>
</html>
`;
}

export { htmlAttribute, htmlText };
