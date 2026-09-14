import itinerarySchema from "./itinerary.schema.json" with { type: "json" };
import { startCanvasApp } from "./canvas-app.mjs";
import { MAX_ITINERARY_BYTES } from "./itinerary-limits.mjs";
import { renderHtml } from "./renderer.mjs";
import { createStandaloneRuntimeAdapter } from "./runtime-adapters.mjs";
import { validateItinerary } from "./validation.mjs";

const TAG_NAME = "itinerary-map";

function scopedDocument(ownerDocument, shadowRoot, host) {
    return {
        documentElement: host,
        get activeElement() { return shadowRoot.activeElement; },
        getElementById: (id) => shadowRoot.getElementById(id),
        querySelector: (selector) => shadowRoot.querySelector(selector),
        createElement: ownerDocument.createElement.bind(ownerDocument),
        createTextNode: ownerDocument.createTextNode.bind(ownerDocument),
    };
}

function componentCss(css, maplibreCss) {
    const scoped = css
        .replaceAll(":root", ":host")
        .replace("html, body {", ":host { display: block;")
        .replace("body {", ":host {");
    const responsiveRules = [];
    const pattern = /@media \(max-width: (\d+)px\) \{/g;
    let cursor = 0;
    let withoutViewportRules = "";
    for (let match = pattern.exec(scoped); match; match = pattern.exec(scoped)) {
        withoutViewportRules += scoped.slice(cursor, match.index);
        let depth = 1;
        let index = pattern.lastIndex;
        while (index < scoped.length && depth > 0) {
            if (scoped[index] === "{") depth += 1;
            else if (scoped[index] === "}") depth -= 1;
            index += 1;
        }
        const body = scoped.slice(pattern.lastIndex, index - 1);
        responsiveRules.push(`@container itinerary-map (max-width: ${match[1]}px) {${body}}
@supports not (container-type: inline-size) {@media (max-width: ${match[1]}px) {${body}}}`);
        cursor = index;
        pattern.lastIndex = index;
    }
    withoutViewportRules += scoped.slice(cursor);
    return `${maplibreCss}
:host{container-name:itinerary-map;container-type:inline-size}
${withoutViewportRules}
${responsiveRules.join("\n")}`;
}

export function createItineraryMapElementClass({
    window,
    maplibregl,
    maplibreCss = "",
    mapErrorDelay = 4000,
    startApp = startCanvasApp,
    render = renderHtml,
    validate = validateItinerary,
}) {
    return class ItineraryMapElement extends window.HTMLElement {
        static version = "1.0.0";

        static get observedAttributes() {
            return ["data-source", "sync-hash", "style-nonce"];
        }

        #controller;
        #itinerary;
        #renderGeneration = 0;
        #renderPromise;
        #sourceObserver;

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
            if (Object.hasOwn(this, "itinerary")) {
                const value = this.itinerary;
                delete this.itinerary;
                this.itinerary = value;
            }
        }

        connectedCallback() {
            this.#scheduleRender();
        }

        disconnectedCallback() {
            this.#teardown();
        }

        adoptedCallback() {
            this.#teardown();
            this.#scheduleRender();
        }

        attributeChangedCallback() {
            this.#scheduleRender();
        }

        get itinerary() {
            return this.#itinerary;
        }

        set itinerary(value) {
            this.#itinerary = value ?? undefined;
            this.#scheduleRender();
        }

        reload() {
            return this.#scheduleRender();
        }

        #teardown() {
            this.#renderGeneration += 1;
            this.#sourceObserver?.disconnect();
            this.#sourceObserver = undefined;
            this.#controller?.teardown();
            this.#controller = undefined;
        }

        #scheduleRender() {
            if (!this.isConnected) return Promise.resolve();
            if (!this.#renderPromise) {
                this.#renderPromise = Promise.resolve().then(() => {
                    this.#renderPromise = undefined;
                    if (this.isConnected) this.#render();
                });
            }
            return this.#renderPromise;
        }

        #error(code, message, errors = []) {
            const view = this.ownerDocument.defaultView ?? window;
            this.#controller?.teardown();
            this.#controller = undefined;
            const style = this.ownerDocument.createElement("style");
            if (this.getAttribute("style-nonce")) style.nonce = this.getAttribute("style-nonce");
            style.textContent = `:host{display:block;font:14px/1.5 system-ui,sans-serif;color:#1f2328}.error{padding:12px;border:1px solid #cf222e;border-radius:8px;background:#ffebe9;color:inherit}h2{margin:0 0 6px;font-size:16px}ul{margin:6px 0 0;padding-left:22px}@media(prefers-color-scheme:dark){:host{color:#f0f6fc}.error{border-color:#ff7b72;background:#4c1f24}}`;
            const panel = this.ownerDocument.createElement("section");
            panel.className = "error";
            panel.setAttribute("role", "alert");
            const heading = this.ownerDocument.createElement("h2");
            heading.textContent = "Itinerary map could not be rendered";
            const summary = this.ownerDocument.createElement("div");
            summary.textContent = message;
            panel.append(heading, summary);
            if (errors.length) {
                const list = this.ownerDocument.createElement("ul");
                for (const error of errors.slice(0, 20)) {
                    const item = this.ownerDocument.createElement("li");
                    item.textContent = error;
                    list.appendChild(item);
                }
                panel.appendChild(list);
            }
            this.shadowRoot.replaceChildren(style, panel);
            this.dispatchEvent(new view.CustomEvent("itinerary-map-error", {
                bubbles: true,
                composed: true,
                detail: { code, message, errors },
            }));
        }

        #readItinerary() {
            const view = this.ownerDocument.defaultView ?? window;
            if (this.#itinerary !== undefined) return this.#itinerary;
            const sourceId = this.getAttribute("data-source");
            if (!sourceId) {
                this.#error("source_missing", "Set data-source to the id of an application/json script element, or assign the itinerary property.");
                return undefined;
            }
            const source = this.ownerDocument.getElementById(sourceId);
            if (!source) {
                this.#error("source_missing", `No itinerary source element with id "${sourceId}" exists.`);
                this.#sourceObserver?.disconnect();
                this.#sourceObserver = new view.MutationObserver(() => {
                    if (this.ownerDocument.getElementById(sourceId)) {
                        this.#sourceObserver.disconnect();
                        this.#sourceObserver = undefined;
                        this.#scheduleRender();
                    }
                });
                this.#sourceObserver.observe(this.ownerDocument.documentElement, { childList: true, subtree: true });
                return undefined;
            }
            if (source.tagName !== "SCRIPT" || source.type !== "application/json") {
                this.#error("source_invalid", `Source "${sourceId}" must be a script element with type="application/json".`);
                return undefined;
            }
            const bytes = new (view.TextEncoder ?? globalThis.TextEncoder)().encode(source.textContent).byteLength;
            if (bytes > MAX_ITINERARY_BYTES) {
                this.#error("source_too_large", `Source "${sourceId}" is ${bytes} bytes; the maximum is ${MAX_ITINERARY_BYTES} bytes.`);
                return undefined;
            }
            try {
                return JSON.parse(source.textContent);
            } catch (error) {
                this.#error("json_invalid", `Source "${sourceId}" is not valid JSON: ${error.message}`);
                return undefined;
            }
        }

        #render() {
            const view = this.ownerDocument.defaultView ?? window;
            const generation = ++this.#renderGeneration;
            this.#sourceObserver?.disconnect();
            this.#sourceObserver = undefined;
            const itinerary = this.#readItinerary();
            if (itinerary === undefined || generation !== this.#renderGeneration) return;
            if (this.#itinerary !== undefined) {
                let bytes;
                try {
                    bytes = new (view.TextEncoder ?? globalThis.TextEncoder)().encode(JSON.stringify(itinerary)).byteLength;
                } catch (error) {
                    this.#error("json_invalid", `Assigned itinerary cannot be serialized as JSON: ${error.message}`);
                    return;
                }
                if (bytes > MAX_ITINERARY_BYTES) {
                    this.#error("source_too_large", `Assigned itinerary is ${bytes} bytes; the maximum is ${MAX_ITINERARY_BYTES} bytes.`);
                    return;
                }
            }
            const errors = validate(itinerary, itinerarySchema);
            if (errors.length) {
                this.#error("itinerary_invalid", "Itinerary validation failed.", errors);
                return;
            }
            this.#controller?.teardown();
            this.#controller = undefined;
            const sourceId = this.getAttribute("data-source") || this.id || "itinerary";
            const html = render({
                itinerary,
                documentId: sourceId,
                initialFocus: {},
                revision: 1,
                focusRevision: 0,
                runtimeMode: "standalone",
                bootstrapPath: "",
                embedded: true,
            });
            const parsed = new view.DOMParser().parseFromString(html, "text/html");
            const style = this.ownerDocument.createElement("style");
            if (this.getAttribute("style-nonce")) style.nonce = this.getAttribute("style-nonce");
            style.textContent = componentCss(parsed.querySelector("style").textContent, maplibreCss);
            const shell = this.ownerDocument.importNode(parsed.querySelector(".shell"), true);
            this.shadowRoot.replaceChildren(style, shell);
            const payload = JSON.parse(parsed.getElementById("itinerary-payload").textContent);
            const namespace = this.hasAttribute("sync-hash")
                ? (this.getAttribute("sync-hash") || this.id || "itinerary")
                : undefined;
            const runtimeAdapter = createStandaloneRuntimeAdapter({ window: view, namespace });
            this.#controller = startApp({
                document: scopedDocument(this.ownerDocument, this.shadowRoot, this),
                window: view,
                fetch: view.fetch.bind(view),
                ResizeObserver: view.ResizeObserver,
                requestAnimationFrame: view.requestAnimationFrame.bind(view),
                CSS: view.CSS ?? { escape: (value) => String(value).replaceAll('"', '\\"') },
                maplibregl,
                mapErrorDelay,
                payload,
                runtimeAdapter,
            });
            if (generation !== this.#renderGeneration) {
                this.#controller.teardown();
                this.#controller = undefined;
                return;
            }
            this.dispatchEvent(new view.CustomEvent("itinerary-map-ready", {
                bubbles: true,
                composed: true,
                detail: { schemaVersion: itinerary.schemaVersion, tripId: itinerary.trip.id },
            }));
        }
    };
}

export function registerItineraryMap(options) {
    const registry = options.window.customElements;
    if (!registry.get(TAG_NAME)) {
        registry.define(TAG_NAME, createItineraryMapElementClass(options));
    }
    return registry.get(TAG_NAME);
}

export { TAG_NAME };
