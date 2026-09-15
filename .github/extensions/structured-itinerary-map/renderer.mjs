import {
    resolveFocus,
    safeJson,
    transportCategoryForMode,
} from "./renderer-helpers.mjs";
import { MAPLIBRE_SCRIPT, MAPLIBRE_STYLESHEET } from "./maplibre-config.mjs";

const DEFAULT_CATEGORY_COLORS = [
    "#0969da",
    "#bf3989",
    "#1a7f37",
    "#bc4c00",
    "#8250df",
    "#cf222e",
    "#008b8b",
    "#57606a",
];

function categoryStyles(itinerary) {
    const transportCategories = (itinerary.transportLegs ?? []).map((leg) => transportCategoryForMode(leg.mode));
    const categories = [...new Set([
        ...itinerary.days.flatMap((day) => day.activities.map((activity) => activity.category)),
        ...itinerary.places.flatMap((place) => place.category ? [place.category] : []),
        ...transportCategories,
    ])];
    return Object.fromEntries(categories.map((category, index) => [
        category,
        {
            label: itinerary.categoryStyles?.[category]?.label ?? category.replaceAll("-", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            color: itinerary.categoryStyles?.[category]?.color
                ?? (category === "flight" ? "#0969da" : category === "transfer" ? "#8250df" : DEFAULT_CATEGORY_COLORS[index % DEFAULT_CATEGORY_COLORS.length]),
        },
    ]));
}

export function renderHtml({
    itinerary,
    documentId,
    initialFocus,
    revision = 1,
    focusRevision = 0,
    nonce = "",
    runtimeMode = "canvas",
    bootstrapPath = "canvas-bootstrap.mjs",
    embedded = false,
}) {
    const normalizedInitialFocus = resolveFocus(
        initialFocus ?? {},
        new Map(itinerary.days.map((day) => [day.id, day])),
        new Map(itinerary.locations.map((location) => [location.id, location])),
    );
    const payload = safeJson({
        itinerary,
        documentId,
        initialFocus: normalizedInitialFocus,
        categoryStyles: categoryStyles(itinerary),
        revision,
        focusRevision,
        runtimeMode,
    });
    const standalonePolicy = runtimeMode === "standalone"
        ? `  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data: blob: https://tiles.openfreemap.org; connect-src 'self' https://tiles.openfreemap.org; font-src 'self' data: https://tiles.openfreemap.org; worker-src blob:; base-uri 'none'; object-src 'none'">\n  <meta name="referrer" content="no-referrer">\n`
        : "";
    const generatorMetadata = runtimeMode === "standalone"
        ? `  <meta name="generator" content="structured-itinerary-map-export/1">\n`
        : "";
    const mapElement = embedded
        ? `<section id="map" role="region" aria-label="Interactive itinerary map">`
        : `<main id="map" aria-label="Interactive itinerary map">`;
    const mapElementClose = embedded ? "</section>" : "</main>";
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
${standalonePolicy}${generatorMetadata}  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0d1117" media="(prefers-color-scheme: dark)">
  <title>${itinerary.trip.title.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</title>
  <link rel="stylesheet" href="${MAPLIBRE_STYLESHEET}">
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --canvas-bg: var(--background-color-default, #ffffff);
      --canvas-bg-subtle: var(--background-color-subtle, #f6f8fa);
      --canvas-bg-overlay: var(--background-color-overlay, #ffffff);
      --canvas-fg: var(--text-color-default, #1f2328);
      --canvas-fg-muted: var(--text-color-muted, #59636e);
      --canvas-border: var(--border-color-default, #d0d7de);
      --canvas-accent: var(--true-color-blue, #0969da);
      --canvas-accent-muted: var(--true-color-blue-muted, #ddf4ff);
      --canvas-danger: var(--true-color-red, #cf222e);
      --canvas-danger-muted: var(--true-color-red-muted, #ffebe9);
      --canvas-success: #1a7f37;
      --canvas-attention: #9a6700;
      --canvas-done: #8250df;
      --canvas-map-bg: #eef2f6;
      --canvas-map-overlay: #ffffff;
      --canvas-map-border: #d0d7de;
      --canvas-marker-border: #ffffff;
      --canvas-marker-halo: #0969da;
      --canvas-marker-context-border: #57606a;
      --canvas-stay: #008b8b;
      --canvas-route-muted: #57606a;
      --canvas-shadow: #1f232833;
      --canvas-scrollbar: #8c959f;
      --canvas-scrollbar-track: #f6f8fa;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --canvas-bg: #0d1117;
        --canvas-bg-subtle: #161b22;
        --canvas-bg-overlay: #1c2128;
        --canvas-fg: #f0f6fc;
        --canvas-fg-muted: #b1bac4;
        --canvas-border: #3d444d;
        --canvas-accent: #58a6ff;
        --canvas-accent-muted: #1f3a5f;
        --canvas-danger: #ff7b72;
        --canvas-danger-muted: #4c1f24;
        --canvas-success: #56d364;
        --canvas-attention: #f2cc60;
        --canvas-done: #d2a8ff;
        --canvas-map-bg: #111820;
        --canvas-map-overlay: #202832;
        --canvas-map-border: #596675;
        --canvas-marker-border: #ffffff;
        --canvas-marker-halo: #79c0ff;
        --canvas-marker-context-border: #b1bac4;
        --canvas-stay: #56d4dd;
        --canvas-route-muted: #c9d1d9;
        --canvas-shadow: #00000066;
        --canvas-scrollbar: #6e7681;
        --canvas-scrollbar-track: #161b22;
      }
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; height: 100dvh; overflow: hidden; }
    body {
      margin: 0;
      background: var(--canvas-bg);
      color: var(--canvas-fg);
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--text-body-medium, 14px);
      line-height: var(--leading-body-medium, 20px);
    }
    button, select { min-width: 0; font: inherit; }
    button:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid var(--canvas-accent); outline-offset: 2px; }
    .shell { display: grid; grid-template: "sidebar map" 100% / minmax(240px, 320px) minmax(0, 1fr); width: 100%; height: 100%; }
    aside {
      grid-area: sidebar; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden;
      border-right: 1px solid var(--canvas-border); background: var(--canvas-bg);
    }
    header { min-width: 0; padding: 10px 12px 7px; }
    h1 { margin: 0 0 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 18px; line-height: 23px; font-weight: var(--font-weight-semibold, 600); }
    .subtitle, .muted, .meta { color: var(--canvas-fg-muted); }
    .subtitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .controls { display: grid; min-width: 0; gap: 7px; padding: 0 12px 9px; }
    .primary-controls { display: grid; min-width: 0; gap: 7px; }
    .filter-disclosure { min-width: 0; }
    .filter-disclosure > summary {
      display: none; min-height: 34px; align-items: center; justify-content: space-between; gap: 8px;
      padding: 6px 8px; border: 1px solid var(--canvas-border); border-radius: 7px;
      background: var(--canvas-bg-overlay); color: var(--canvas-fg); cursor: pointer; font-weight: var(--font-weight-semibold, 600);
      list-style: none;
    }
    .filter-disclosure > summary::-webkit-details-marker { display: none; }
    .filter-disclosure > summary::after { content: "▾"; color: var(--canvas-fg-muted); }
    .filter-disclosure:not([open]) > summary::after { content: "›"; }
    .filter-summary { min-width: 0; margin-left: auto; overflow: hidden; text-overflow: ellipsis; color: var(--canvas-fg-muted); font-size: 10px; font-weight: 400; white-space: nowrap; }
    .filter-panel { padding-top: 0; }
    fieldset.category-group { min-width: 0; margin: 0; padding: 0; border: 0; }
    fieldset.category-group legend { padding: 0; color: var(--canvas-fg-muted); font-size: 11px; font-weight: var(--font-weight-semibold, 600); }
    .selects { display: grid; min-width: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
    label { display: block; min-width: 0; color: var(--canvas-fg-muted); font-size: 11px; font-weight: var(--font-weight-semibold, 600); }
    select {
      display: block; width: 100%; max-width: 100%; min-height: 34px; margin-top: 2px; padding: 5px 24px 5px 7px;
      overflow: hidden; text-overflow: ellipsis; border: 1px solid var(--canvas-border);
      border-radius: 6px; background: var(--canvas-bg-overlay); color: inherit;
    }
    .chips { display: flex; min-width: 0; flex-wrap: wrap; gap: 4px; padding-top: 3px; overflow: hidden; }
    button {
      border: 1px solid var(--canvas-border); border-radius: 7px; padding: 6px 9px;
      background: var(--canvas-bg-overlay); color: inherit; cursor: pointer;
    }
    button:hover { background: var(--canvas-bg-subtle); }
    #overview { width: 100%; min-height: 34px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; font-weight: var(--font-weight-semibold, 600); }
    .chip { flex: 0 1 auto; min-height: 30px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; border-radius: 999px; padding: 4px 7px; white-space: nowrap; font-size: 11px; }
    .chip[aria-pressed="true"], button.active { border-color: var(--canvas-accent); background: var(--canvas-accent-muted); }
    .dot { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border-radius: 50%; vertical-align: 0; }
    #count { overflow-wrap: anywhere; font-size: 11px; line-height: 15px; }
    #list { flex: 1 1 auto; min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; border-top: 1px solid var(--canvas-border); padding: 0 7px 10px; scrollbar-color: var(--canvas-scrollbar) var(--canvas-scrollbar-track); }
    .day-group { position: relative; min-width: 0; margin: 0; padding: 0 0 5px; }
    .day-group::before { position: absolute; top: 42px; bottom: 0; left: 60px; width: 1px; background: var(--canvas-border); content: ""; }
    .day-heading {
      position: sticky; top: 0; z-index: 3; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
      width: 100%; min-width: 0; min-height: 42px; padding: 6px 5px; border: 0; border-radius: 0;
      border-bottom: 1px solid var(--canvas-border); background: color-mix(in srgb, var(--canvas-bg) 96%, transparent);
      text-align: left; backdrop-filter: blur(8px);
    }
    .day-heading:hover { background: var(--canvas-accent-muted); }
    .day-heading.cancelled { border-left: 3px dashed var(--canvas-danger); }
    .day-heading.cancelled .day-title { text-decoration: line-through; }
    .day-heading.cancelled .day-title::after { margin-left: 5px; content: "Cancelled"; font-size: 9px; font-weight: 600; text-transform: uppercase; }
    .day-heading-main { min-width: 0; }
    .day-kicker { display: block; color: var(--canvas-accent); font-size: 10px; line-height: 13px; font-weight: 700; letter-spacing: .025em; text-transform: uppercase; }
    .day-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 17px; font-weight: var(--font-weight-semibold, 600); }
    .day-side { display: grid; justify-items: end; gap: 2px; padding-left: 6px; }
    .day-count { color: var(--canvas-fg-muted); font-size: 10px; line-height: 12px; font-weight: 400; white-space: nowrap; }
    .card {
      position: relative; display: grid; grid-template-columns: 48px 7px minmax(0, 1fr); align-items: start;
      width: 100%; min-width: 0; min-height: 44px; margin: 0; padding: 6px 5px; border: 0; border-radius: 6px; text-align: left;
    }
    .card:hover { background: color-mix(in srgb, var(--canvas-accent-muted) 65%, transparent); }
    .card.active { background: var(--canvas-accent-muted); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--canvas-accent) 60%, transparent); }
    .time-slot { padding-top: 1px; color: var(--canvas-fg-muted); font-size: 10px; line-height: 13px; text-align: right; white-space: normal; }
    .time-slot strong { display: block; color: var(--canvas-fg); font-size: 11px; font-weight: var(--font-weight-semibold, 600); }
    .zone-context { display: block; overflow: hidden; text-overflow: ellipsis; color: var(--canvas-fg-muted); font-size: 9px; white-space: nowrap; }
    .timeline-accent { align-self: stretch; justify-self: center; width: 3px; min-height: 30px; border-radius: 999px; background: var(--accent, var(--canvas-fg-muted)); }
    .timeline-main { min-width: 0; overflow: hidden; }
    .item-title-row { display: flex; min-width: 0; align-items: baseline; gap: 5px; }
    .item-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 16px; font-weight: var(--font-weight-semibold, 600); }
    .secondary { display: -webkit-box; overflow: hidden; color: var(--canvas-fg-muted); font-size: 10px; line-height: 14px; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .badges { display: flex; min-width: 0; flex-wrap: wrap; gap: 3px; margin-top: 2px; }
    .badge {
      display: inline-flex; align-items: center; min-height: 16px; max-width: 100%; padding: 0 5px;
      overflow: hidden; text-overflow: ellipsis; border: 1px solid var(--canvas-border); border-radius: 999px;
      color: var(--canvas-fg-muted); font-size: 9px; line-height: 14px; font-weight: 600; white-space: nowrap;
    }
    .badge-booked { border-color: color-mix(in srgb, var(--canvas-success) 60%, transparent); background: color-mix(in srgb, var(--canvas-success) 16%, var(--canvas-bg)); color: var(--canvas-fg); }
    .badge-tentative { border-color: color-mix(in srgb, var(--canvas-attention) 65%, transparent); background: color-mix(in srgb, var(--canvas-attention) 17%, var(--canvas-bg)); color: var(--canvas-fg); }
    .badge-cancelled { border-color: color-mix(in srgb, var(--canvas-danger) 60%, transparent); background: color-mix(in srgb, var(--canvas-danger) 15%, var(--canvas-bg)); color: var(--canvas-fg); }
    .badge-optional { border-color: color-mix(in srgb, var(--canvas-done) 60%, transparent); background: color-mix(in srgb, var(--canvas-done) 15%, var(--canvas-bg)); color: var(--canvas-fg); }
    .cancelled { opacity: .75; }
    .cancelled .item-title { text-decoration: line-through; }
    .transport-card { --accent: var(--canvas-route-muted); }
    #map { grid-area: map; position: relative; width: 100%; height: 100%; min-height: 0; background: var(--canvas-map-bg); }
    .pin-wrap { width: 32px; height: 32px; padding: 6px; border: 0; border-radius: 50%; background: transparent; cursor: pointer; }
    .pin { display: block; width: 20px; height: 20px; border: 2px solid var(--canvas-marker-border); border-radius: 50%; box-shadow: 0 1px 5px #0008; transition: opacity .16s, transform .16s, filter .16s, box-shadow .16s; }
    .pin-wrap.transport .pin { border-radius: 5px; }
    .pin-wrap.context .pin { opacity: .58; transform: scale(.82); border-color: var(--canvas-marker-context-border); box-shadow: 0 0 0 1px color-mix(in srgb, var(--canvas-map-bg) 75%, transparent), 0 1px 4px #000a; filter: saturate(.72); }
    .pin-wrap.active .pin { opacity: 1; transform: scale(1.12); filter: drop-shadow(0 0 3px var(--canvas-marker-border)); }
    .pin-wrap.selected .pin { opacity: 1; transform: scale(1.2); filter: none; box-shadow: 0 0 0 3px var(--canvas-marker-border), 0 0 0 6px var(--canvas-marker-halo), 0 2px 8px #0008; }
    .pin-wrap.cancelled-marker .pin { border-style: dashed; background: var(--canvas-fg-muted) !important; }
    .pin-wrap:focus-visible { outline: 3px solid var(--canvas-accent); outline-offset: 2px; }
    .maplibregl-popup-content { min-width: 210px; max-width: 300px; border: 1px solid var(--canvas-map-border); background: var(--canvas-map-overlay); color: var(--canvas-fg); box-shadow: 0 3px 16px var(--canvas-shadow); line-height: 1.45; border-radius: 8px; }
    .maplibregl-popup[class*="maplibregl-popup-anchor-bottom"] .maplibregl-popup-tip { border-top-color: var(--canvas-map-overlay); }
    .maplibregl-popup[class*="maplibregl-popup-anchor-top"] .maplibregl-popup-tip { border-bottom-color: var(--canvas-map-overlay); }
    .maplibregl-popup[class*="maplibregl-popup-anchor-left"] .maplibregl-popup-tip { border-right-color: var(--canvas-map-overlay); }
    .maplibregl-popup[class*="maplibregl-popup-anchor-right"] .maplibregl-popup-tip { border-left-color: var(--canvas-map-overlay); }
    .maplibregl-popup-close-button { color: var(--canvas-fg); }
    .maplibregl-ctrl-group, .maplibregl-ctrl-attrib { background: var(--canvas-bg-overlay); color: var(--canvas-fg-muted); }
    .maplibregl-ctrl-group button { background-color: transparent; }
    .maplibregl-ctrl-group button:hover { background-color: var(--canvas-bg-subtle); }
    .maplibregl-ctrl-attrib a { color: var(--canvas-accent); }
    .popup-title { font-size: 15px; font-weight: 700; }
    .popup-meta { margin: 2px 0 7px; color: var(--canvas-fg-muted); font-size: 12px; }
    .map-top-stack {
      position: absolute; z-index: 5; top: 12px; left: 12px; display: flex; width: min(370px, calc(100% - 80px));
      max-height: calc(100% - 24px); flex-direction: column; gap: 8px; pointer-events: none;
    }
    .map-top-stack > * { flex: 0 1 auto; max-height: min(42vh, 320px); overflow: auto; pointer-events: auto; }
    .day-note {
      scrollbar-color: var(--canvas-scrollbar) var(--canvas-scrollbar-track);
      padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--canvas-accent) 55%, transparent);
      border-radius: 10px; background: color-mix(in srgb, var(--canvas-bg-overlay) 94%, transparent);
      color: var(--canvas-fg); box-shadow: 0 3px 16px var(--canvas-shadow); backdrop-filter: blur(8px);
    }
    .day-note[hidden] { display: none; }
    .day-note h2 { margin: 2px 0 5px; font-size: 17px; line-height: 1.3; }
    .day-note p { margin: 0 0 5px; }
    .day-date { color: var(--canvas-accent); font-size: 12px; font-weight: 700; }
    .legend {
      position: absolute; z-index: 4; right: 10px; bottom: 26px; max-width: 210px; padding: 7px 8px;
      border: 1px solid var(--canvas-map-border); border-radius: 8px; background: var(--canvas-map-overlay);
      color: var(--canvas-fg); box-shadow: 0 1px 5px var(--canvas-shadow); font-size: 10px;
    }
    .legend summary { cursor: pointer; font-weight: 600; }
    .legend-grid { display: grid; grid-template-columns: 1fr; gap: 4px; margin-top: 5px; }
    .legend-route { display: inline-block; width: 18px; margin-right: 5px; border-top: 3px solid var(--canvas-accent); vertical-align: 3px; }
    .legend-route.tentative { border-color: var(--canvas-attention); border-top-style: dashed; }
    .legend-route.cancelled { border-color: var(--canvas-fg-muted); border-top-style: dashed; opacity: .85; }
    .stay-swatch { display: inline-block; width: 11px; height: 11px; margin-right: 5px; border: 2px dashed var(--canvas-stay); background: color-mix(in srgb, var(--canvas-stay) 34%, transparent); vertical-align: -1px; }
    .error {
      position: absolute; z-index: 10; inset: 12px auto auto 12px; max-width: calc(100% - 24px); padding: 10px 12px;
      border: 1px solid var(--canvas-danger); border-radius: 8px; background: var(--canvas-danger-muted); color: var(--canvas-fg);
    }
    .map-top-stack > .error { position: static; inset: auto; max-width: none; }
    .sync-error { position: static; margin: 0 12px 8px; font-size: 11px; }
    @media (max-width: 760px) {
      .shell { grid-template: "map" minmax(250px, 52%) "sidebar" minmax(0, 48%) / minmax(0, 1fr); }
      aside { border-top: 1px solid var(--canvas-border); border-right: 0; padding-bottom: env(safe-area-inset-bottom, 0); }
      header { padding: 5px 8px 3px; }
      h1 { font-size: 15px; line-height: 19px; }
      .subtitle { font-size: 11px; line-height: 15px; }
      .controls { padding: 0 8px 4px; gap: 3px; }
      .primary-controls { grid-template-columns: minmax(82px, .7fr) minmax(0, 2fr); align-items: end; gap: 4px; }
      .selects { gap: 4px; }
      label { font-size: 10px; line-height: 13px; }
      select { min-height: 44px; margin-top: 1px; padding: 4px 18px 4px 5px; font-size: 14px; }
      #overview { min-height: 44px; padding: 5px 7px; font-size: 12px; text-align: center; }
      .filter-disclosure > summary { display: flex; min-height: 44px; padding-block: 5px; font-size: 12px; }
      .filter-disclosure:not([open]) > .filter-panel { display: none; }
      .filter-panel { padding-top: 3px; }
      fieldset.category-group legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
      .chips { flex-wrap: nowrap; gap: 3px; padding: 0 0 2px; overflow-x: auto; }
      .chip { flex: 0 0 auto; min-height: 44px; padding: 4px 8px; }
      #count { font-size: 10px; line-height: 13px; }
      .card, .day-heading { min-height: 44px; }
      #list { padding-inline: 6px; }
      .map-top-stack { top: max(8px, env(safe-area-inset-top, 0)); left: 8px; width: min(330px, calc(100% - 64px)); max-height: calc(100% - 16px); }
      .map-top-stack > * { max-height: min(36vh, 260px); }
      .day-note { padding: 9px 11px; font-size: 12px; }
      .legend { right: 8px; bottom: 22px; max-width: min(180px, calc(100% - 16px)); padding: 5px 7px; }
      .legend summary { min-height: 44px; display: flex; align-items: center; }
    }
    @media (max-width: 430px) {
      .shell { grid-template-rows: minmax(230px, 50%) minmax(0, 50%); }
      .card { grid-template-columns: 44px 6px minmax(0, 1fr); }
      .day-group::before { left: 55px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0s !important; }
    }
    @media (prefers-color-scheme: dark) {
      .maplibregl-ctrl-icon { filter: invert(1) brightness(1.4); }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside aria-label="Itinerary navigation">
      <header>
        <h1 id="trip-title"></h1>
        <div class="subtitle" id="trip-subtitle"></div>
      </header>
      <div class="controls">
        <div class="primary-controls">
          <button id="overview" type="button" aria-label="Show complete trip overview">Trip overview</button>
          <div class="selects">
            <label>Destination<select id="location"></select></label>
            <label>Day<select id="day"></select></label>
          </div>
        </div>
        <details id="filters" class="filter-disclosure">
          <summary aria-controls="filter-panel"><span>Filters</span><span id="filter-summary" class="filter-summary"></span></summary>
          <div id="filter-panel" class="filter-panel">
            <fieldset class="category-group"><legend>Categories</legend><div class="chips" id="chips"></div></fieldset>
          </div>
        </details>
        <div class="muted" id="count" aria-live="polite"></div>
      </div>
      <div id="sync-error" class="error sync-error" role="status" aria-live="polite" hidden></div>
      <div id="list"></div>
    </aside>
    ${mapElement}
      <div id="map-top-stack" class="map-top-stack">
        <section id="day-note" class="day-note" aria-label="Selected day details" hidden></section>
      </div>
    ${mapElementClose}
  </div>
  <script id="maplibre-loader" defer src="${MAPLIBRE_SCRIPT}"></script>
  <script id="itinerary-payload" type="application/json" nonce="${nonce}">${payload}</script>
  <script type="module" src="${bootstrapPath}"></script>
</body>
</html>`;
}
