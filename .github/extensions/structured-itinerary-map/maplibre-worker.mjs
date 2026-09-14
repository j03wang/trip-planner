const WORKER_URL_KEY = Symbol.for("structured-itinerary-map.maplibre-worker-url");

export function configureMapLibreWorker(maplibregl, scope = globalThis) {
    let workerUrl = scope[WORKER_URL_KEY];
    if (!workerUrl) {
        const encoded = scope.atob(__MAPLIBRE_WORKER_BASE64__);
        const workerBytes = Uint8Array.from(encoded, (character) => character.charCodeAt(0));
        workerUrl = scope.URL.createObjectURL(new scope.Blob(
            [workerBytes],
            { type: "text/javascript" },
        ));
        scope[WORKER_URL_KEY] = workerUrl;
    }
    maplibregl.setWorkerUrl(workerUrl);
    return workerUrl;
}
