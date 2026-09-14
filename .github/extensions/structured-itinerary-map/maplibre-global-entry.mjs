import * as maplibregl from "maplibre-gl";
import { configureMapLibreWorker } from "./maplibre-worker.mjs";

globalThis.maplibregl = maplibregl;
configureMapLibreWorker(maplibregl);
