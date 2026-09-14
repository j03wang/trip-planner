import * as maplibregl from "maplibre-gl";
import maplibreCss from "maplibre-gl/dist/maplibre-gl.css";
import { registerItineraryMap } from "./browser-component.mjs";
import { configureMapLibreWorker } from "./maplibre-worker.mjs";

configureMapLibreWorker(maplibregl);
globalThis.maplibregl ??= maplibregl;
registerItineraryMap({ window, maplibregl, maplibreCss });
