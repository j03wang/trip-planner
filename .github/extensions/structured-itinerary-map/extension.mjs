import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { replaceCanvasState, startCanvasServer, stopCanvasServer } from "./canvas-server.mjs";
import { createCanvasController } from "./extension-core.mjs";
import { renderHtml } from "./renderer.mjs";

const extensionDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(extensionDirectory, "..", "..", "..");
const itinerarySchema = JSON.parse(await readFile(resolve(extensionDirectory, "itinerary.schema.json"), "utf8"));
const openSchemaSource = JSON.parse(await readFile(resolve(extensionDirectory, "open-input.schema.json"), "utf8"));
const { descriptor } = createCanvasController({
    CanvasError,
    itinerarySchema,
    openSchemaSource,
    projectRoot,
    renderHtml,
    startCanvasServer,
    replaceCanvasState,
    stopCanvasServer,
});

await joinSession({ canvases: [createCanvas(descriptor)] });
