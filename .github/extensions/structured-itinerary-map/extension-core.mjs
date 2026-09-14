import { ERROR_CODES } from "./error-codes.mjs";
import { composeOpenInputSchema } from "./schema.mjs";
import {
    ItineraryRuntimeError,
    assertFocusShape,
    assertOpenEnvelope,
    createKeyedSerializer,
    loadItinerarySource,
    sendSse,
} from "./runtime-helpers.mjs";
import { summarizeItinerary, validateFocus, validateItinerary } from "./validation.mjs";

export function createCanvasController({
    CanvasError,
    itinerarySchema,
    openSchemaSource,
    projectRoot,
    renderHtml,
    startCanvasServer,
    replaceCanvasState,
    stopCanvasServer,
}) {
    const servers = new Map();
    const serializeInstance = createKeyedSerializer();
    const openInputSchema = composeOpenInputSchema(openSchemaSource, itinerarySchema);
    const focusSchema = {
        type: "object",
        additionalProperties: false,
        properties: {
            locationId: { $ref: "#/$defs/identifier" },
            dayId: { $ref: "#/$defs/identifier" },
        },
        $defs: { identifier: itinerarySchema.$defs.identifier },
    };

    async function loadItinerary(input) {
        try {
            assertOpenEnvelope(input);
            return await loadItinerarySource(input, projectRoot);
        } catch (error) {
            if (error instanceof ItineraryRuntimeError) throw new CanvasError(error.code, error.message);
            throw error;
        }
    }

    function assertValidItinerary(itinerary) {
        const errors = validateItinerary(itinerary, itinerarySchema);
        if (errors.length) {
            throw new CanvasError(
                ERROR_CODES.schemaInvalid,
                `Itinerary validation failed:\n${errors.slice(0, 20).map((error) => `- ${error}`).join("\n")}${errors.length > 20 ? `\n- …and ${errors.length - 20} more` : ""}`,
            );
        }
    }

    function assertValidFocus(focus, itinerary, label = "Focus") {
        let normalized;
        try {
            normalized = assertFocusShape(focus, label);
        } catch (error) {
            if (error instanceof ItineraryRuntimeError) throw new CanvasError(error.code, error.message);
            throw error;
        }
        const errors = validateFocus(normalized, itinerary, label);
        if (errors.length) {
            throw new CanvasError(
                ERROR_CODES.focusInvalid,
                `${label} validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
            );
        }
        return normalized;
    }

    const getSummary = (ctx) => serializeInstance(ctx.instanceId, async () => {
        const entry = servers.get(ctx.instanceId);
        if (!entry) throw new CanvasError(ERROR_CODES.instanceMissing, `No open canvas instance named "${ctx.instanceId}".`);
        return {
            ...summarizeItinerary(entry.state.itinerary, entry.state.documentId),
            focus: entry.state.focus,
            revision: entry.revision,
        };
    });

    const setFocus = (ctx) => serializeInstance(ctx.instanceId, async () => {
        const entry = servers.get(ctx.instanceId);
        if (!entry) throw new CanvasError(ERROR_CODES.instanceMissing, `No open canvas instance named "${ctx.instanceId}".`);
        entry.state.focus = assertValidFocus(ctx.input, entry.state.itinerary, "set_focus");
        entry.focusRevision += 1;
        sendSse(entry.eventStreams, "focus", {
            documentId: entry.state.documentId,
            focus: entry.state.focus,
            focusRevision: entry.focusRevision,
        });
        return { documentId: entry.state.documentId, focus: entry.state.focus };
    });

    const open = (ctx) => serializeInstance(ctx.instanceId, async () => {
        const itinerary = await loadItinerary(ctx.input);
        assertValidItinerary(itinerary);
        const focus = assertValidFocus(ctx.input.initialFocus, itinerary, "initialFocus");
        const state = { documentId: ctx.input.documentId, itinerary, focus };
        let entry = servers.get(ctx.instanceId);
        if (entry) {
            replaceCanvasState(entry, state);
        } else {
            entry = await startCanvasServer(state, { renderHtml, summarizeItinerary, validateFocus });
            servers.set(ctx.instanceId, entry);
        }
        return {
            title: itinerary.trip.title,
            status: `${itinerary.days.length} ${itinerary.days.length === 1 ? "day" : "days"} · ${itinerary.locations.length} ${itinerary.locations.length === 1 ? "destination" : "destinations"}`,
            url: `${entry.url}?revision=${entry.revision}`,
        };
    });

    const onClose = (ctx) => serializeInstance(ctx.instanceId, async () => {
        const entry = servers.get(ctx.instanceId);
        if (!entry) return;
        servers.delete(ctx.instanceId);
        await stopCanvasServer(entry);
    });

    return {
        servers,
        descriptor: {
            id: "structured-itinerary-map",
            displayName: "Structured itinerary map",
            description: "Explore a versioned structured itinerary with destination and day navigation, reusable places, transport legs, stay areas, and notes.",
            inputSchema: openInputSchema,
            actions: [
                {
                    name: "get_summary",
                    description: "Return the identity, revision, synchronized focus, and item/status counts for the itinerary currently shown.",
                    inputSchema: { type: "object", additionalProperties: false },
                    handler: getSummary,
                },
                {
                    name: "set_focus",
                    description: "Focus the open map on a destination, a day, or both; pass an empty object for trip overview.",
                    inputSchema: focusSchema,
                    handler: setFocus,
                },
            ],
            open,
            onClose,
        },
    };
}
