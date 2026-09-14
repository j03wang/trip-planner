function focusKeys(namespace) {
    const prefix = namespace ? `${namespace}.` : "";
    return { location: `${prefix}location`, day: `${prefix}day` };
}

function focusFromHash(hash, namespace) {
    if (namespace === undefined) return {};
    const keys = focusKeys(namespace);
    const parameters = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
    return {
        ...(parameters.get(keys.location) ? { locationId: parameters.get(keys.location) } : {}),
        ...(parameters.get(keys.day) ? { dayId: parameters.get(keys.day) } : {}),
    };
}

function hashForFocus(focus, namespace, existingHash = "") {
    if (namespace === undefined) return existingHash;
    const keys = focusKeys(namespace);
    const parameters = new URLSearchParams(String(existingHash).replace(/^#/, ""));
    parameters.delete(keys.location);
    parameters.delete(keys.day);
    if (focus.locationId) parameters.set(keys.location, focus.locationId);
    if (focus.dayId) parameters.set(keys.day, focus.dayId);
    const value = parameters.toString();
    return value ? `#${value}` : "";
}

export function createCanvasRuntimeAdapter({
    fetch,
    EventSource,
    eventUrl = "events",
    focusUrl = "focus",
    stateUrl = "state",
}) {
    let events;
    return {
        kind: "canvas",
        initialFocus: (fallback) => fallback,
        async updateFocus(focus, observedRevision) {
            const response = await fetch(focusUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ focus, observedRevision }),
            });
            return { status: response.status, ok: response.ok, state: await response.json() };
        },
        async readState() {
            const response = await fetch(stateUrl, { cache: "no-store" });
            if (!response.ok) throw new Error(`state read returned HTTP ${response.status}`);
            return response.json();
        },
        subscribe(handlers) {
            events = new EventSource(eventUrl);
            for (const name of ["focus", "state", "reload"]) {
                events.addEventListener(name, (event) => handlers[name]?.(JSON.parse(event.data)));
            }
            events.addEventListener("open", handlers.connected);
            events.addEventListener("error", handlers.disconnected);
            return () => events?.close();
        },
    };
}

export function createStandaloneRuntimeAdapter({ window, namespace }) {
    let focus = focusFromHash(window.location.hash, namespace);
    let observedHash = window.location.hash;
    let revision = 0;
    let onFocus;
    const handleHistory = () => {
        if (window.location.hash === observedHash) return;
        observedHash = window.location.hash;
        focus = focusFromHash(window.location.hash, namespace);
        revision += 1;
        onFocus?.({ focus, focusRevision: revision });
    };
    return {
        kind: "standalone",
        initialFocus: (fallback) => Object.keys(focus).length ? focus : fallback,
        async updateFocus(nextFocus) {
            focus = { ...nextFocus };
            revision += 1;
            const hash = hashForFocus(focus, namespace, window.location.hash);
            observedHash = hash;
            if (namespace !== undefined) {
                window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
            }
            return { status: 200, ok: true, state: { focus, focusRevision: revision } };
        },
        async readState() {
            return { focus, focusRevision: revision };
        },
        subscribe(handlers) {
            onFocus = handlers.focus;
            if (namespace !== undefined) {
                window.addEventListener("popstate", handleHistory);
                window.addEventListener("hashchange", handleHistory);
            }
            return () => {
                onFocus = undefined;
                if (namespace !== undefined) {
                    window.removeEventListener("popstate", handleHistory);
                    window.removeEventListener("hashchange", handleHistory);
                }
            };
        },
    };
}

export { focusFromHash, hashForFocus };
