import {
    advanceRevision as advanceKnownRevision,
    activitySelection,
    activityMatchesFilters as matchesActivityFilters,
    boundsForCoordinates,
    basemapStyleHealth,
    cameraAnimationOptions,
    canonicalMarkerStates,
    canonicalVisiblePlaceIds,
    chooseMarkerLeg as chooseVisibleMarkerLeg,
    darkStyleTransformCoverage,
    dayTimeZoneContext,
    directTransportLines as makeDirectTransportLines,
    destinationFilterTransition,
    disposeMapResources,
    focusIdentity,
    focusSelector as selectorForFocus,
    dayFilterTransition,
    legMatchesFilters as matchesLegFilters,
    mapPalette as paletteForTheme,
    mapErrorSeverity,
    mapStyleUrl as styleUrlForTheme,
    overviewFilterTransition,
    precomputeTimelineRows,
    resolveFocus as resolveFocusState,
    shouldApplyAuthoritativeFocus,
    shouldRestoreMapStyle,
    shouldReloadRevision as needsRevisionReload,
    themeFromPreference as resolveTheme,
    timelineEntriesForDay,
    transformMapStyle as transformStyleForTheme,
    transportSelection,
    unwrapTransportPoints as unwrapLegPoints,
    visibleStayLocationIds,
    visibleTransportLegIds,
} from "./renderer-helpers.mjs";
import { shortTimeZoneLabel, transportTimeZoneLabel } from "./time-helpers.mjs";
import {
    createFocusSyncState,
    queueLocalFocus,
    receiveAuthoritativeFocus,
    settleLocalFocus,
} from "./focus-sync.mjs";
import { attachClientLifecycle } from "./client-lifecycle.mjs";
import { createCanvasRuntimeAdapter, createStandaloneRuntimeAdapter } from "./runtime-adapters.mjs";

export function startCanvasApp({
    document = globalThis.document,
    window = globalThis.window,
    fetch = globalThis.fetch,
    EventSource = globalThis.EventSource,
    ResizeObserver = globalThis.ResizeObserver,
    requestAnimationFrame = globalThis.requestAnimationFrame,
    CSS = globalThis.CSS,
    maplibregl,
    payload = JSON.parse(document.getElementById("itinerary-payload").textContent),
    runtimeAdapter,
    mapErrorDelay = 4000,
} = {}) {
    const runtime = runtimeAdapter ?? (payload.runtimeMode === "standalone"
      ? createStandaloneRuntimeAdapter({ window, namespace: "" })
      : createCanvasRuntimeAdapter({ fetch, EventSource }));
    const mapLibrary = () => maplibregl ?? window.maplibregl;
    const layoutWidth = () => document.querySelector(".shell")?.getBoundingClientRect?.().width || window.innerWidth || 1024;
    const cameraPadding = () => layoutWidth() <= 760 ? 36 : 70;
    const createOption = (label, value) => {
      const option = document.createElement("option");
      option.textContent = label;
      option.value = value;
      return option;
    };
    const itinerary = payload.itinerary;
    const styles = payload.categoryStyles;
    const locationsById = new Map(itinerary.locations.map(location => [location.id, location]));
    const placesById = new Map(itinerary.places.map(place => [place.id, place]));
    const daysById = new Map(itinerary.days.map(day => [day.id, day]));
    payload.initialFocus = resolveFocusState(runtime.initialFocus(payload.initialFocus ?? {}), daysById, locationsById);
    const orderedDays = [...itinerary.days].sort((left, right) => left.date.localeCompare(right.date));
    const precomputed = precomputeTimelineRows(itinerary, { placesById, locationsById });
    const transportLegs = precomputed.legs;
    const transportLegsById = new Map(transportLegs.map(leg => [leg.id, leg]));
    const legsByDay = new Map();
    const legsByPlace = new Map();
    transportLegs.forEach(leg => {
      if (leg.dayId) {
        if (!legsByDay.has(leg.dayId)) legsByDay.set(leg.dayId, []);
        legsByDay.get(leg.dayId).push(leg);
      }
      for (const placeId of [leg.originPlaceId, leg.destinationPlaceId]) {
        if (!legsByPlace.has(placeId)) legsByPlace.set(placeId, []);
        legsByPlace.get(placeId).push(leg);
      }
    });
    let activityIndex = 0;
    const activityRows = itinerary.days.flatMap(day => day.activities.map(activity => ({
      ...activity,
      ...precomputed.activities[activityIndex++],
      day,
      place: activity.placeId ? placesById.get(activity.placeId) : null,
      effectiveLocationId: activity.placeId
        ? placesById.get(activity.placeId).locationId
        : activity.locationId || (day.locationIds.length === 1 ? day.locationIds[0] : null),
      effectiveStatus: activity.status || "planned"
    })));
    const activitiesById = new Map(activityRows.map(row => [row.id, row]));
    const placeActivities = new Map();
    activityRows.filter(row => row.place).forEach(row => {
      if (!placeActivities.has(row.place.id)) placeActivities.set(row.place.id, []);
      placeActivities.get(row.place.id).push(row);
    });
    const referencedPlaces = itinerary.places;
    const selectedCategories = new Set(Object.keys(styles));
    let selectedLocationId = payload.initialFocus.locationId || "";
    let selectedDayId = payload.initialFocus.dayId || "";
    let selectedActivityId = "";
    let selectedLegId = "";
    let selectedMarkerPlaceIds = new Set();
    let stayAreasVisible = true;
    let styleReady = false;
    let initialViewApplied = false;
    let renderedNoteDayId;
    let serverFocusRevision = payload.focusRevision;
    const focusState = createFocusSyncState(payload.focusRevision);
    let focusSync = Promise.resolve();
    const visibleMarkerIds = new Set();
    const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let currentTheme = resolveTheme(themeQuery.matches);
    let appliedMapTheme = currentTheme;
    let pendingMapTheme = currentTheme;
    document.documentElement.dataset.systemTheme = currentTheme;
    document.documentElement.dataset.mapTheme = appliedMapTheme;
    document.getElementById("trip-title").textContent = itinerary.trip.title;
    document.getElementById("trip-subtitle").textContent =
      formatDateRange(itinerary.trip.startDate, itinerary.trip.endDate) + " · " + itinerary.locations.length
      + (itinerary.locations.length === 1 ? " destination" : " destinations");
    const filterDisclosure = document.getElementById("filters");
    const filterDisclosureSummary = filterDisclosure.querySelector("summary");
    let narrowControls;
    let legend;
    let legendSummary;
    function syncResponsiveControls() {
      const nextNarrow = layoutWidth() <= 760;
      if (nextNarrow !== narrowControls) {
        narrowControls = nextNarrow;
        filterDisclosure.open = !nextNarrow;
        if (legend) legend.open = !nextNarrow;
      }
      filterDisclosureSummary.setAttribute("aria-expanded", String(filterDisclosure.open));
      if (legendSummary) legendSummary.setAttribute("aria-expanded", String(legend.open));
    }
    filterDisclosure.addEventListener("toggle", () => {
      filterDisclosureSummary.setAttribute("aria-expanded", String(filterDisclosure.open));
    });
    syncResponsiveControls();

    let map = null;
    let mapErrorTimer;
    let mapHadSuccessfulStyle = false;
    let persistentMapError = false;
    let themeSwitchFailed = false;
    let mapInteractionsBound = false;
    let rebuildingMapStyle = false;
    let styleGeneration = 0;
    let styleSetGeneration = 0;
    let stylePollTimer;
    let mapInitializationPending = false;
    let mapResizeObserver;
    let styleFallback;
    let styleFallbackTheme;
    let lastSuccessfulStyle;
    let lastSuccessfulTheme = currentTheme;
    let lastMapFilterSignature = "";
    let sourceErrorCount = 0;
    function showMapError(message, persistent = false) {
      let warning = document.getElementById("map-unavailable");
      if (!warning) {
        warning = document.createElement("div");
        warning.id = "map-unavailable";
        warning.className = "error";
        warning.setAttribute("role", "status");
        warning.setAttribute("aria-live", "polite");
        document.getElementById("map-top-stack").appendChild(warning);
      }
      warning.textContent = message;
      persistentMapError ||= persistent;
    }
    function clearMapError(allowPersistent = false) {
      window.clearTimeout(mapErrorTimer);
      mapErrorTimer = undefined;
      if (persistentMapError && !allowPersistent) return;
      persistentMapError = false;
      document.getElementById("map-unavailable")?.remove();
    }
    function scheduleStyleTimeout() {
      window.clearTimeout(mapErrorTimer);
      mapErrorTimer = window.setTimeout(() => {
        mapErrorTimer = undefined;
        if (styleReady) return;
        if (styleFallback && map) {
          const fallback = styleFallback;
          const fallbackTheme = styleFallbackTheme;
          styleFallback = undefined;
          styleFallbackTheme = undefined;
          styleGeneration += 1;
          pendingMapTheme = fallbackTheme;
          currentTheme = fallbackTheme;
          styleSetGeneration = styleGeneration;
          try {
            map.setStyle(fallback);
            scheduleStyleRebuild();
            showMapError("The requested map theme was unavailable; the previous basemap was restored.", true);
            return;
          } catch {
            // Fall through to the general degraded-map message.
          }
        }
        showMapError("The basemap is unavailable. Check network access; itinerary navigation remains available.", mapHadSuccessfulStyle);
      }, mapErrorDelay);
    }
    function scheduleStyleRebuild() {
      window.clearTimeout(stylePollTimer);
      const generation = styleGeneration;
      if (styleSetGeneration !== generation) return;
      let attempts = 0;
      const poll = () => {
        if (!map || generation !== styleGeneration || generation !== styleSetGeneration
          || styleReady || rebuildingMapStyle) return;
        if (map.isStyleLoaded()) {
          rebuildMapStyle();
          return;
        }
        attempts += 1;
        if (attempts < 200) stylePollTimer = window.setTimeout(poll, 50);
      };
      poll();
    }
    async function initializeMap() {
      const maplibre = mapLibrary();
      if (map || mapInitializationPending || !maplibre) return;
      mapInitializationPending = true;
      try {
        let initialTheme;
        let styleDocument;
        do {
          initialTheme = currentTheme;
          const response = await fetch(styleUrlForTheme(initialTheme), { cache: "force-cache" });
          if (!response.ok) throw new Error("style request returned HTTP " + response.status);
          styleDocument = transformStyleForTheme(await response.json(), initialTheme);
          const styleHealth = basemapStyleHealth(styleDocument);
          if (!styleHealth.healthy) {
            throw new Error(`style contains ${styleHealth.sourceCount} sources and ${styleHealth.visibleLayerCount} visible layers`);
          }
          if (initialTheme === "dark" && !darkStyleTransformCoverage(styleDocument).adequate) {
            showMapError("The dark basemap provider changed; using its available styling with itinerary overlays.");
          }
        } while (initialTheme !== currentTheme);
        pendingMapTheme = initialTheme;
        appliedMapTheme = initialTheme;
        const candidateMap = new maplibre.Map({
          container: document.getElementById("map"),
          style: styleDocument,
          center: [itinerary.locations[0].coordinates.longitude, itinerary.locations[0].coordinates.latitude],
          zoom: itinerary.locations[0].zoom || 10,
          attributionControl: true
        });
        map = candidateMap;
        clearMapError(true);
        map.addControl(new maplibre.NavigationControl(), "top-right");
        if (typeof ResizeObserver !== "undefined") {
          mapResizeObserver = new ResizeObserver(() => {
            syncResponsiveControls();
            map?.resize();
          });
          mapResizeObserver.observe(document.getElementById("map"));
          mapResizeObserver.observe(document.querySelector(".shell"));
        }
        map.on("error", event => {
          if (mapErrorSeverity(event) === "fatal") {
            showMapError(
              "The basemap renderer failed to start. Check browser worker and Content Security Policy settings; itinerary navigation remains available.",
              true
            );
            return;
          }
          sourceErrorCount += 1;
          if (styleReady && sourceErrorCount >= 3) {
            showMapError(
              "The basemap data could not be loaded. Check network access; itinerary navigation remains available.",
              true
            );
          } else if (!styleReady && !mapErrorTimer) {
            scheduleStyleTimeout();
          }
        });
        map.on("style.load", scheduleStyleRebuild);
        map.on("styledata", scheduleStyleRebuild);
        scheduleStyleTimeout();
        scheduleStyleRebuild();
      } catch {
        disposeMapResources(map, mapResizeObserver);
        mapResizeObserver = undefined;
        map = null;
        showMapError("The basemap style could not be loaded. Itinerary navigation remains available.", true);
      } finally {
        mapInitializationPending = false;
      }
    }
    const maplibreLoader = document.getElementById("maplibre-loader");
    maplibreLoader?.addEventListener("load", initializeMap, { once: true });
    maplibreLoader?.addEventListener("error", () => {
      showMapError("The map library is unavailable. Itinerary navigation remains available.");
    }, { once: true });
    window.addEventListener("online", initializeMap);
    initializeMap();
    if (!map) {
      mapErrorTimer = window.setTimeout(() => {
        mapErrorTimer = undefined;
        if (!map && !mapInitializationPending) {
          showMapError(
            !mapLibrary()
              ? "The map library is unavailable. Itinerary navigation remains available."
              : "The basemap style is slow or unavailable. Itinerary navigation remains available."
          );
        }
      }, mapErrorDelay);
    }

    async function handleThemeChange(event) {
      const nextTheme = resolveTheme(event.matches);
      document.documentElement.dataset.systemTheme = nextTheme;
      if (nextTheme === currentTheme) {
        if (!map) {
          await initializeMap();
          return;
        }
        if (nextTheme === appliedMapTheme && themeSwitchFailed) {
          themeSwitchFailed = false;
          clearMapError(true);
        }
        return;
      }
      currentTheme = nextTheme;
      if (!map) {
        await initializeMap();
        return;
      }
      styleGeneration += 1;
      const generation = styleGeneration;
      const previousTheme = lastSuccessfulTheme;
      const previousStyle = lastSuccessfulStyle ?? structuredClone(map.getStyle());
      let styleWasSet = false;
      try {
        const response = await fetch(styleUrlForTheme(currentTheme), { cache: "force-cache" });
        if (!response.ok) throw new Error("style request returned HTTP " + response.status);
        const styleDocument = transformStyleForTheme(await response.json(), nextTheme);
        const styleHealth = basemapStyleHealth(styleDocument);
        if (!styleHealth.healthy) {
          throw new Error(`style contains ${styleHealth.sourceCount} sources and ${styleHealth.visibleLayerCount} visible layers`);
        }
        if (generation !== styleGeneration) return;
        if (nextTheme === "dark" && !darkStyleTransformCoverage(styleDocument).adequate) {
          showMapError("The dark basemap provider changed; using its available styling with itinerary overlays.", false);
        }
        pendingMapTheme = nextTheme;
        styleFallback = previousStyle;
        styleFallbackTheme = previousTheme;
        styleReady = false;
        sourceErrorCount = 0;
        scheduleStyleTimeout();
        map.setStyle(styleDocument);
        styleWasSet = true;
        styleSetGeneration = generation;
        scheduleStyleRebuild();
      } catch (error) {
        if (generation !== styleGeneration) return;
        currentTheme = previousTheme;
        pendingMapTheme = previousTheme;
        styleSetGeneration = styleGeneration;
        themeSwitchFailed = true;
        if (shouldRestoreMapStyle({ styleReady, styleWasSet }) && previousStyle) {
          try {
            styleReady = false;
            map.setStyle(previousStyle);
            styleSetGeneration = styleGeneration;
            scheduleStyleRebuild();
          } catch {
            styleReady = false;
          }
        } else if (mapHadSuccessfulStyle) {
          styleReady = true;
          render();
          applyCurrentCamera();
        }
        window.clearTimeout(mapErrorTimer);
        mapErrorTimer = undefined;
        showMapError(
          "The map theme could not be applied. Itinerary navigation remains available. " + error.message,
          true
        );
      }
    }
    themeQuery.addEventListener("change", handleThemeChange);

    function currentFocus() {
      return {
        ...(selectedLocationId ? { locationId: selectedLocationId } : {}),
        ...(selectedDayId ? { dayId: selectedDayId } : {})
      };
    }

    function applyAuthoritativeFocus(result) {
      if (shouldApplyAuthoritativeFocus(result, currentFocus(), daysById, locationsById)) applyFocus(result.focus);
    }

    function syncFocus() {
      const focus = currentFocus();
      const localRequest = queueLocalFocus(focusState, focus);
      focusSync = focusSync.then(async () => {
        const warning = document.getElementById("sync-error");
        try {
          const response = await runtime.updateFocus(focus, serverFocusRevision);
          const state = response.state;
          if (response.ok || response.status === 409) {
            const stale = Number.isSafeInteger(state.focusRevision) && state.focusRevision < serverFocusRevision;
            serverFocusRevision = advanceKnownRevision(serverFocusRevision, state.focusRevision);
            const result = settleLocalFocus(focusState, localRequest.version, state, {
              authoritative: response.status === 409 && !stale
            });
            applyAuthoritativeFocus(result);
            warning.hidden = true;
            return;
          }
          throw new Error("focus update returned HTTP " + response.status);
        } catch {
          try {
            const state = await runtime.readState();
            const stale = Number.isSafeInteger(state.focusRevision) && state.focusRevision < serverFocusRevision;
            serverFocusRevision = advanceKnownRevision(serverFocusRevision, state.focusRevision);
            const result = settleLocalFocus(focusState, localRequest.version, state, {
              authoritative: !stale
            });
            applyAuthoritativeFocus(result);
            warning.textContent = "Focus synchronization is unavailable. The authoritative server focus has been restored.";
            warning.hidden = false;
          } catch {
            settleLocalFocus(focusState, localRequest.version);
            warning.textContent = "Focus synchronization is unavailable. Your local selection may be replaced when the connection recovers.";
            warning.hidden = false;
          }
        }
      });
    }

    const markers = new Map();
    function initializeMarkers() {
      if (!map || !styleReady) return;
      for (const place of referencedPlaces) {
      if (markers.has(place.id)) continue;
      const scheduled = placeActivities.get(place.id) || [];
      const category = place.category || scheduled[0]?.category || "transport";
      const wrapper = document.createElement("button");
      wrapper.type = "button";
      wrapper.className = "pin-wrap" + (category === "transport" ? " transport" : "");
      wrapper.setAttribute("aria-label", "Show " + place.name + " schedule");
      wrapper.setAttribute("aria-pressed", "false");
      const pin = document.createElement("span");
      pin.className = "pin";
      pin.style.background = styles[category]?.color || "#57606a";
      wrapper.appendChild(pin);
      const popupContent = document.createElement("div");
      const popupTitle = document.createElement("div");
      popupTitle.className = "popup-title";
      popupTitle.textContent = place.name;
      const popupMeta = document.createElement("div");
      popupMeta.className = "popup-meta";
      popupMeta.textContent = locationsById.get(place.locationId).name + " · " + (styles[category]?.label || category);
      const popupNotes = document.createElement("div");
      const activeScheduled = scheduled.filter(row => !activityIsCancelled(row));
      popupNotes.textContent = activeScheduled.length
        ? activeScheduled.map(row => formatShortDate(row.day.date) + ": " + row.name).join(" | ")
        : place.notes || "Transport endpoint";
      popupContent.append(popupTitle, popupMeta, popupNotes);
      const marker = new (mapLibrary().Marker)({ element: wrapper })
        .setLngLat([place.coordinates.longitude, place.coordinates.latitude])
        .setPopup(new (mapLibrary().Popup)({ offset: 13 }).setDOMContent(popupContent));
      wrapper.addEventListener("click", () => {
        const markerLeg = chooseVisibleMarkerLeg(legsByPlace.get(place.id) || [], {
          selectedDayId,
          selectedLocationId,
          transportEnabled: selectedCategories.has("transport"),
          placesById
        }, selectedLegId);
        if (markerLeg) {
          selectTransportLeg(markerLeg.id, place.id);
          return;
        }
        const eligibleScheduled = activeScheduled.filter(row => selectedCategories.has(row.category));
        const scheduledForFocus = eligibleScheduled.find(row => row.day.id === selectedDayId)
          || eligibleScheduled.find(row => !selectedLocationId || row.effectiveLocationId === selectedLocationId)
          || eligibleScheduled[0];
        if (scheduledForFocus) {
          selectActivity(scheduledForFocus.id, true);
          return;
        }
        const contextLeg = chooseVisibleMarkerLeg(legsByPlace.get(place.id) || [], {
          selectedDayId: "",
          selectedLocationId,
          transportEnabled: selectedCategories.has("transport"),
          placesById
        }, selectedLegId);
        if (contextLeg) selectTransportLeg(contextLeg.id, place.id);
      });
      markers.set(place.id, marker);
      }
    }

    function bindMapInteractions() {
      if (mapInteractionsBound) return;
      mapInteractionsBound = true;
      map.on("click", "stay-fill", event => {
        const properties = event.features[0].properties;
        const content = document.createElement("div");
        const title = document.createElement("div");
        title.className = "popup-title";
        title.textContent = "Recommended stay: " + properties.name;
        const notes = document.createElement("div");
        notes.textContent = properties.notes;
        content.append(title, notes);
        new (mapLibrary().Popup)().setLngLat(event.lngLat).setDOMContent(content).addTo(map);
      });
      map.on("mouseenter", "stay-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "stay-fill", () => { map.getCanvas().style.cursor = ""; });
      const selectRoute = event => {
        const legId = event.features?.[0]?.properties?.id;
        if (legId) selectTransportLeg(legId);
      };
      for (const layerId of ["transport-active", "transport-tentative", "transport-cancelled", "transport-selected"]) {
        map.on("click", layerId, selectRoute);
        map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
      }
    }

    function rebuildMapStyle() {
      if (rebuildingMapStyle) return;
      rebuildingMapStyle = true;
      try {
      const palette = paletteForTheme(pendingMapTheme);
      [
        "transport-selected", "transport-selected-casing", "stay-label", "stay-outline",
        "stay-fill", "transport-cancelled", "transport-tentative", "transport-active", "transport-casing"
      ].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
      ["stay-areas", "itinerary-transport"].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
      map.addSource("itinerary-transport", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: transportLegs.map(leg => {
            const origin = placesById.get(leg.originPlaceId);
            const destination = placesById.get(leg.destinationPlaceId);
            const lines = leg.lines || makeDirectTransportLines(origin, destination);
            return {
              type: "Feature",
              properties: {
                id: leg.id,
                dayId: leg.dayId || "",
                originLocationId: origin.locationId,
                destinationLocationId: destination.locationId,
                status: legIsCancelled(leg) ? "cancelled" : (leg.status || "planned"),
                mode: leg.mode,
                name: leg.name || leg.mode
              },
              geometry: {
                type: "MultiLineString",
                coordinates: lines.map(line => line.map(point => [point.longitude, point.latitude]))
              }
            };
          })
        }
      });
      map.addLayer({
        id: "transport-casing", type: "line", source: "itinerary-transport",
        paint: { "line-color": palette.casing, "line-width": 7, "line-opacity": .9 }
      });
      map.addLayer({
        id: "transport-active", type: "line", source: "itinerary-transport",
        filter: ["in", ["get", "status"], ["literal", ["booked", "planned", "optional"]]],
        paint: {
          "line-color": ["match", ["get", "status"], "booked", palette.route, palette.routeMuted],
          "line-width": 3.2,
          "line-opacity": .9
        }
      });
      map.addLayer({
        id: "transport-tentative", type: "line", source: "itinerary-transport",
        filter: ["==", ["get", "status"], "tentative"],
        paint: { "line-color": palette.tentative, "line-width": 3, "line-opacity": .9, "line-dasharray": [2, 1.5] }
      });
      map.addLayer({
        id: "transport-cancelled", type: "line", source: "itinerary-transport",
        filter: ["==", ["get", "status"], "cancelled"],
        paint: { "line-color": palette.cancelled, "line-width": 2.6, "line-opacity": .65, "line-dasharray": [1, 2] }
      });
      map.addSource("stay-areas", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: (itinerary.recommendedStayAreas || []).map(area => ({
            type: "Feature",
            properties: { id: area.id, locationId: area.locationId, name: area.name, notes: area.notes || "" },
            geometry: {
              type: "Polygon",
              coordinates: area.boundaries.map(ring => ring.map(point => [point.longitude, point.latitude]))
            }
          }))
        }
      });
      map.addLayer({ id: "stay-fill", type: "fill", source: "stay-areas", paint: { "fill-color": palette.stay, "fill-opacity": palette.stayFillOpacity } });
      map.addLayer({ id: "stay-outline", type: "line", source: "stay-areas", paint: { "line-color": palette.stay, "line-width": 2, "line-dasharray": [2, 1] } });
      map.addLayer({
        id: "stay-label", type: "symbol", source: "stay-areas", minzoom: 8,
        layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, -0.5] },
        paint: { "text-color": palette.stayLabel, "text-halo-color": palette.labelHalo, "text-halo-width": 1.5 }
      });
      map.addLayer({
        id: "transport-selected-casing", type: "line", source: "itinerary-transport",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": palette.casing, "line-width": 10, "line-opacity": .98 }
      });
      map.addLayer({
        id: "transport-selected", type: "line", source: "itinerary-transport",
        filter: ["==", ["get", "id"], ""],
        paint: {
          "line-color": ["match", ["get", "status"], "cancelled", palette.selectedCancelled, "tentative", palette.tentative, palette.selected],
          "line-width": 5.8,
          "line-opacity": 1
        }
      });
      bindMapInteractions();
      styleReady = true;
      lastMapFilterSignature = "";
      window.clearTimeout(stylePollTimer);
      stylePollTimer = undefined;
      window.clearTimeout(mapErrorTimer);
      mapErrorTimer = undefined;
      clearMapError(true);
      mapHadSuccessfulStyle = true;
      styleFallback = undefined;
      styleFallbackTheme = undefined;
      themeSwitchFailed = false;
      appliedMapTheme = pendingMapTheme;
      document.documentElement.dataset.mapTheme = appliedMapTheme;
      initializeMarkers();
      render();
      lastSuccessfulStyle = structuredClone(map.getStyle());
      lastSuccessfulTheme = appliedMapTheme;
      if (!initialViewApplied) {
        initialViewApplied = true;
        applyInitialView();
      }
      } catch (error) {
        styleReady = false;
        showMapError(
          "The map layers could not be initialized. Itinerary navigation remains available. " + error.message,
          true
        );
      } finally {
        rebuildingMapStyle = false;
      }
    }

    const locationSelect = document.getElementById("location");
    locationSelect.add(createOption("All destinations", ""));
    itinerary.locations.forEach(location => locationSelect.add(createOption(location.name, location.id)));
    locationSelect.value = selectedLocationId;
    locationSelect.addEventListener("change", () => {
      const next = destinationFilterTransition(currentFocus(), locationSelect.value, daysById);
      selectedLocationId = next.locationId;
      selectedDayId = next.dayId;
      selectedActivityId = "";
      selectedLegId = "";
      selectedMarkerPlaceIds = new Set();
      daySelect.value = selectedDayId;
      updateDayOptions();
      if (selectedLocationId) focusLocation(selectedLocationId);
      else if (selectedDayId) focusDay(selectedDayId);
      else focusPlaces(currentVisiblePlaces());
      render({ resetListScroll: true });
      syncFocus();
    });

    const daySelect = document.getElementById("day");
    daySelect.add(createOption("All days", ""));
    orderedDays.forEach(day => daySelect.add(createOption(formatShortDate(day.date) + " — " + day.title, day.id)));
    daySelect.value = selectedDayId;
    function updateDayOptions() {
      for (const option of daySelect.options) {
        const day = option.value ? daysById.get(option.value) : undefined;
        const incompatible = Boolean(day && selectedLocationId && !day.locationIds.includes(selectedLocationId));
        option.disabled = incompatible;
        option.hidden = incompatible;
      }
    }
    updateDayOptions();
    daySelect.addEventListener("change", () => {
      const next = dayFilterTransition(currentFocus(), daySelect.value, daysById);
      selectedDayId = next.dayId;
      daySelect.value = selectedDayId;
      selectedActivityId = "";
      selectedLegId = "";
      selectedMarkerPlaceIds = new Set();
      if (selectedDayId) {
        focusDay(selectedDayId);
      } else if (selectedLocationId) focusLocation(selectedLocationId);
      else focusPlaces(currentVisiblePlaces());
      render({ resetListScroll: true });
      syncFocus();
    });

    const chips = document.getElementById("chips");
    for (const [category, style] of Object.entries(styles)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.setAttribute("aria-pressed", "true");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = style.color;
      button.append(dot, document.createTextNode(style.label));
      button.addEventListener("click", () => {
        selectedCategories.has(category) ? selectedCategories.delete(category) : selectedCategories.add(category);
        if (selectedActivityId && !selectedCategories.has(activitiesById.get(selectedActivityId).category)) {
          selectedActivityId = "";
          selectedMarkerPlaceIds = new Set();
        }
        if (category === "transport" && !selectedCategories.has("transport")) {
          selectedLegId = "";
          selectedMarkerPlaceIds = new Set();
        }
        button.setAttribute("aria-pressed", String(selectedCategories.has(category)));
        render();
      });
      chips.appendChild(button);
    }
    if ((itinerary.recommendedStayAreas || []).length) {
      const stayButton = document.createElement("button");
      stayButton.type = "button";
      stayButton.className = "chip";
      stayButton.setAttribute("aria-pressed", "true");
      const swatch = document.createElement("span");
      swatch.className = "stay-swatch";
      stayButton.append(swatch, document.createTextNode("Stay areas"));
      stayButton.addEventListener("click", () => {
        stayAreasVisible = !stayAreasVisible;
        stayButton.setAttribute("aria-pressed", String(stayAreasVisible));
        render();
      });
      chips.appendChild(stayButton);
    }

    document.getElementById("overview").addEventListener("click", () => {
      const next = overviewFilterTransition();
      selectedLocationId = next.locationId;
      selectedDayId = next.dayId;
      selectedActivityId = "";
      selectedLegId = "";
      selectedMarkerPlaceIds = new Set();
      locationSelect.value = "";
      daySelect.value = "";
      updateDayOptions();
      render({ resetListScroll: true });
      focusPlaces(currentVisiblePlaces());
      syncFocus();
    });

    function visibleActivities() {
      return activityRows.filter(row => matchesActivityFilters(row, {
        selectedCategories,
        selectedDayId,
        selectedLocationId
      }));
    }

    function visibleLegs() {
      return transportLegs.filter(leg => matchesLegFilters(leg, {
        selectedDayId,
        selectedLocationId,
        transportEnabled: selectedCategories.has("transport"),
        placesById
      }));
    }

    function currentVisiblePlaceIds(rows = visibleActivities(), legs = visibleLegs()) {
      return canonicalVisiblePlaceIds({
        activityRows: rows,
        visibleLegs: legs,
        selectedLeg: transportLegsById.get(selectedLegId),
        selectedPlaceIds: selectedMarkerPlaceIds,
      });
    }

    function currentVisiblePlaces(rows, legs) {
      const ids = currentVisiblePlaceIds(rows, legs);
      return referencedPlaces.filter(place => ids.has(place.id));
    }

    function updateMapLayers(visibleLegIds = visibleTransportLegIds(transportLegs, {
      selectedDayId,
      selectedLocationId,
      transportEnabled: selectedCategories.has("transport"),
      placesById
    })) {
      if (!map || !styleReady) return;
      const stayLocationIds = visibleStayLocationIds({ selectedDayId, selectedLocationId, daysById });
      const filterSignature = JSON.stringify([
        visibleLegIds,
        selectedLegId,
        stayAreasVisible,
        stayLocationIds
      ]);
      if (filterSignature === lastMapFilterSignature) return;
      lastMapFilterSignature = filterSignature;
      const baseTransportFilter = ["in", ["get", "id"], ["literal", visibleLegIds]];
      map.setFilter("transport-casing", baseTransportFilter);
      map.setFilter("transport-active", combineFilters(baseTransportFilter, ["in", ["get", "status"], ["literal", ["booked", "planned", "optional"]]]));
      map.setFilter("transport-tentative", combineFilters(baseTransportFilter, ["==", ["get", "status"], "tentative"]));
      map.setFilter("transport-cancelled", combineFilters(baseTransportFilter, ["==", ["get", "status"], "cancelled"]));
      const selectedLegFilter = ["==", ["get", "id"], selectedLegId || ""];
      map.setFilter("transport-selected-casing", selectedLegFilter);
      map.setFilter("transport-selected", selectedLegFilter);
      const stayVisibility = stayAreasVisible ? "visible" : "none";
      ["stay-fill", "stay-outline", "stay-label"].forEach(id => map.setLayoutProperty(id, "visibility", stayVisibility));
      const stayFilter = stayLocationIds.length
        ? ["in", ["get", "locationId"], ["literal", stayLocationIds]]
        : null;
      ["stay-fill", "stay-outline", "stay-label"].forEach(id => map.setFilter(id, stayFilter));
    }

    function render({ preserveListScroll = false, resetListScroll = false } = {}) {
      const list = document.getElementById("list");
      const nextScrollTop = preserveListScroll ? list.scrollTop : resetListScroll ? 0 : undefined;
      const focusedSelector = selectorForFocus(focusIdentity(document.activeElement), CSS.escape);
      const rows = visibleActivities();
      const filteredLegs = visibleLegs();
      const filteredLegIds = filteredLegs.map(leg => leg.id);
      updateMapLayers(filteredLegIds);
      const filteredLegsByDay = new Map();
      filteredLegs.forEach(leg => {
        if (!leg.dayId) return;
        if (!filteredLegsByDay.has(leg.dayId)) filteredLegsByDay.set(leg.dayId, []);
        filteredLegsByDay.get(leg.dayId).push(leg);
      });
      const markerStates = canonicalMarkerStates({
        activityRows,
        transportLegs,
        selectedCategories,
        selectedDayId,
        selectedLocationId,
        selectedLeg: transportLegsById.get(selectedLegId),
        selectedPlaceIds: selectedMarkerPlaceIds,
        daysById,
        placesById
      });
      const selectedActivity = activitiesById.get(selectedActivityId);
      const selectedLeg = transportLegsById.get(selectedLegId);
      if (map) for (const [placeId, marker] of markers) {
        const scheduled = placeActivities.get(placeId) || [];
        const markerState = markerStates.get(placeId);
        const shouldShow = Boolean(markerState);
        if (shouldShow && !visibleMarkerIds.has(placeId)) {
          marker.addTo(map);
          visibleMarkerIds.add(placeId);
        } else if (!shouldShow && visibleMarkerIds.has(placeId)) {
          marker.remove();
          visibleMarkerIds.delete(placeId);
        }
        const wrapper = marker.getElement();
        const activeCategory = scheduled.find(row => selectedCategories.has(row.category)
          && (!selectedDayId || row.day.id === selectedDayId))?.category
          || scheduled.find(row => selectedCategories.has(row.category))?.category
          || placesById.get(placeId).category
          || "transport";
        wrapper.querySelector(".pin").style.background = styles[activeCategory]?.color || "#57606a";
        for (const state of ["active", "context", "selected"]) {
          wrapper.classList.toggle(state, markerState === state);
        }
        const selectedCancelled = markerState === "selected" && (
          (selectedActivity?.place?.id === placeId && activityIsCancelled(selectedActivity))
          || (selectedLeg && [selectedLeg.originPlaceId, selectedLeg.destinationPlaceId].includes(placeId)
            && ((selectedLeg.status ?? "planned") === "cancelled"
              || (selectedLeg.dayId && (daysById.get(selectedLeg.dayId)?.status ?? "planned") === "cancelled")))
        );
        wrapper.classList.toggle("cancelled-marker", Boolean(selectedCancelled));
        wrapper.setAttribute("aria-pressed", String(markerState === "selected"));
        wrapper.setAttribute(
          "aria-label",
          "Show " + placesById.get(placeId).name + " schedule"
            + (markerState === "context" ? " (not on selected day)" : "")
            + (selectedCancelled ? " (cancelled)" : "")
        );
      }
      const grouped = new Map();
      rows.forEach(row => {
        if (!grouped.has(row.day.id)) grouped.set(row.day.id, []);
        grouped.get(row.day.id).push(row);
      });
      const mappedCount = rows.filter(row => row.place && !activityIsCancelled(row)).length;
      document.getElementById("filter-summary").textContent = selectedCategories.size + "/" + Object.keys(styles).length
        + " categories · Stay " + (stayAreasVisible ? "on" : "off");
      document.getElementById("count").textContent = rows.length + " activities · " + filteredLegs.length
        + (filteredLegs.length === 1 ? " leg" : " legs") + " · " + mappedCount + " mapped";
      const note = selectedDayId ? daysById.get(selectedDayId) : null;
      const notePanel = document.getElementById("day-note");
      if (renderedNoteDayId !== selectedDayId) {
        renderedNoteDayId = selectedDayId;
        notePanel.hidden = !note;
        notePanel.replaceChildren();
        if (note) {
          const date = document.createElement("div");
          date.className = "day-date";
          date.textContent = formatLongDate(note.date);
          const heading = document.createElement("h2");
          heading.textContent = note.title;
          notePanel.append(date, heading);
          if (note.summary) { const p = document.createElement("p"); p.textContent = note.summary; notePanel.appendChild(p); }
          if (note.notes) { const p = document.createElement("p"); p.className = "muted"; p.textContent = note.notes; notePanel.appendChild(p); }
          if (note.tip) { const p = document.createElement("p"); p.className = "muted"; p.textContent = "Tip: " + note.tip; notePanel.appendChild(p); }
        }
      }
      list.replaceChildren();
      for (const day of orderedDays) {
        const dayId = day.id;
        const dayRows = grouped.get(dayId) || [];
        const dayLegs = filteredLegsByDay.get(dayId) || [];
        if (!dayRows.length && !dayLegs.length) continue;
        const section = document.createElement("section");
        section.className = "day-group";
        const heading = document.createElement("button");
        heading.type = "button";
        heading.className = "day-heading" + (selectedDayId === dayId ? " active" : "") + ((day.status || "planned") === "cancelled" ? " cancelled" : "");
        heading.dataset.dayId = dayId;
        const dayItemCount = dayRows.length + dayLegs.length;
        const dayStatus = day.status || "planned";
        heading.setAttribute("aria-label", "Focus " + formatLongDate(day.date) + ", " + day.title
          + ", " + titleCase(dayStatus) + ", " + dayItemCount + (dayItemCount === 1 ? " item" : " items"));
        const headingMain = document.createElement("span");
        headingMain.className = "day-heading-main";
        const kicker = document.createElement("span");
        kicker.className = "day-kicker";
        kicker.textContent = formatLongDate(day.date);
        const dayTitle = document.createElement("span");
        dayTitle.className = "day-title";
        dayTitle.textContent = day.title;
        headingMain.append(kicker, dayTitle);
        const daySide = document.createElement("span");
        daySide.className = "day-side";
        daySide.append(
          createBadge(titleCase(dayStatus), dayStatus),
          Object.assign(document.createElement("span"), {
            className: "day-count",
            textContent: dayItemCount + (dayItemCount === 1 ? " item" : " items")
          })
        );
        heading.append(headingMain, daySide);
        heading.addEventListener("click", () => {
          const next = dayFilterTransition(currentFocus(), dayId, daysById);
          selectedDayId = next.dayId;
          selectedActivityId = "";
          selectedLegId = "";
          selectedMarkerPlaceIds = new Set();
          daySelect.value = selectedDayId;
          render({ resetListScroll: true });
          if (selectedDayId) focusDay(selectedDayId);
          syncFocus();
        });
        section.appendChild(heading);
        const timelineEntries = timelineEntriesForDay(day, dayRows, dayLegs, { placesById, locationsById });
        timelineEntries.forEach(entry => section.appendChild(
          entry.kind === "activity" ? renderActivityCard(entry.value) : renderTransportCard(entry.value)
        ));
        list.appendChild(section);
      }
      const unscheduledLegs = filteredLegs.filter(leg => !leg.dayId);
      if (unscheduledLegs.length) {
        const section = document.createElement("section");
        section.className = "day-group";
        const heading = document.createElement("div");
        heading.className = "day-heading";
        heading.textContent = "Unscheduled transport";
        section.appendChild(heading);
        unscheduledLegs.forEach(leg => section.appendChild(renderTransportCard(leg)));
        list.appendChild(section);
      }
      const restoreListScroll = () => {
        if (nextScrollTop !== undefined) list.scrollTop = nextScrollTop;
      };
      const focusedElement = focusedSelector ? list.querySelector(focusedSelector) : null;
      if (focusedElement) {
        try {
          focusedElement.focus({ preventScroll: true });
        } catch {
          focusedElement.focus();
        }
      }
      restoreListScroll();
      if (nextScrollTop !== undefined) requestAnimationFrame(restoreListScroll);
    }

    function renderActivityCard(row) {
      const location = row.effectiveLocationId ? locationsById.get(row.effectiveLocationId) : null;
      const cancelled = activityIsCancelled(row);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card" + (selectedActivityId === row.id ? " active" : "") + (cancelled ? " cancelled" : "");
      card.dataset.id = row.id;
      card.setAttribute("aria-pressed", String(selectedActivityId === row.id));
      card.setAttribute("aria-label", activityAriaLabel(row, location));
      card.style.setProperty("--accent", styles[row.category].color);

      const timeSlot = document.createElement("span");
      timeSlot.className = "time-slot";
      const primaryTime = document.createElement("strong");
      primaryTime.textContent = row.startTime ? formatTime(row.startTime) : "Anytime";
      timeSlot.appendChild(primaryTime);
      if (row.endTime) timeSlot.append(document.createTextNode("to " + formatTime(row.endTime)));
      if (dayTimeZoneContext(row.day, { locationsById }).size && row.effectiveLocationId) {
        const zone = document.createElement("span");
        zone.className = "zone-context";
        zone.textContent = shortTimeZoneLabel(
          locationsById.get(row.effectiveLocationId)?.timezone,
          Date.parse(row.day.date + "T12:00:00Z")
        );
        timeSlot.appendChild(zone);
      }

      const accent = document.createElement("span");
      accent.className = "timeline-accent";
      accent.setAttribute("aria-hidden", "true");

      const content = document.createElement("span");
      content.className = "timeline-main";
      const titleRow = document.createElement("span");
      titleRow.className = "item-title-row";
      const title = document.createElement("span");
      title.className = "item-title";
      title.textContent = row.name;
      titleRow.appendChild(title);
      const secondary = document.createElement("span");
      secondary.className = "secondary";
      secondary.textContent = activitySecondary(row, location);
      const badges = document.createElement("span");
      badges.className = "badges";
      badges.appendChild(createBadge(titleCase(row.effectiveStatus), row.effectiveStatus));
      if (!row.place) badges.appendChild(createBadge("Schedule only", "neutral"));
      if (row.energy) badges.appendChild(createBadge(titleCase(row.energy) + " energy", "neutral"));
      if ((row.day.status || "planned") === "cancelled" && row.effectiveStatus !== "cancelled") {
        badges.appendChild(createBadge("Day cancelled", "cancelled"));
      }
      content.append(titleRow, secondary, badges);
      card.append(timeSlot, accent, content);
      card.addEventListener("click", () => selectActivity(row.id));
      return card;
    }

    function renderTransportCard(leg) {
      const origin = placesById.get(leg.originPlaceId);
      const destination = placesById.get(leg.destinationPlaceId);
      const status = leg.status || "planned";
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card transport-card" + (selectedLegId === leg.id ? " active" : "") + (legIsCancelled(leg) ? " cancelled" : "");
      card.dataset.legId = leg.id;
      card.setAttribute("aria-pressed", String(selectedLegId === leg.id));
      card.setAttribute("aria-label", transportAriaLabel(leg, origin, destination));

      const timeSlot = document.createElement("span");
      timeSlot.className = "time-slot";
      const primaryTime = document.createElement("strong");
      primaryTime.textContent = leg.departureLocalDateTime ? formatLocalDateTimeTime(leg.departureLocalDateTime) : "Travel";
      timeSlot.appendChild(primaryTime);
      if (leg.arrivalLocalDateTime) timeSlot.append(document.createTextNode("arr " + formatLocalDateTimeTime(leg.arrivalLocalDateTime)));
      const legDay = leg.dayId ? daysById.get(leg.dayId) : undefined;
      if (legDay && leg.departureLocalDateTime && dayTimeZoneContext(legDay, { locationsById }).size) {
        const zone = document.createElement("span");
        zone.className = "zone-context";
        zone.textContent = transportTimeZoneLabel(
          leg,
          legDay,
          locationsById.get(origin.locationId)?.timezone
        );
        if (zone.textContent) timeSlot.appendChild(zone);
      }

      const accent = document.createElement("span");
      accent.className = "timeline-accent";
      accent.setAttribute("aria-hidden", "true");

      const content = document.createElement("span");
      content.className = "timeline-main";
      const title = document.createElement("span");
      title.className = "item-title";
      title.textContent = leg.name || origin.name + " to " + destination.name;
      const secondary = document.createElement("span");
      secondary.className = "secondary";
      secondary.textContent = origin.name + " to " + destination.name
        + (leg.departureLocalDateTime ? "; " + readableTimeZone(origin.locationId) + " departure" : "")
        + (leg.arrivalLocalDateTime ? ", " + readableTimeZone(destination.locationId) + " arrival" : "");
      const badges = document.createElement("span");
      badges.className = "badges";
      badges.append(
        createBadge(titleCase(status), status),
        createBadge(titleCase(leg.mode), "neutral")
      );
      if (leg.carrier) badges.appendChild(createBadge(leg.carrier + (leg.serviceNumber ? " " + leg.serviceNumber : ""), "neutral"));
      if (leg.dayId && (daysById.get(leg.dayId)?.status || "planned") === "cancelled" && status !== "cancelled") {
        badges.appendChild(createBadge("Day cancelled", "cancelled"));
      }
      content.append(title, secondary, badges);
      card.append(timeSlot, accent, content);
      card.addEventListener("click", () => selectTransportLeg(leg.id));
      return card;
    }

    function focusPlaces(places) {
      if (!map || !styleReady) return;
      places = places.filter(Boolean);
      const uniquePlaces = [...new Map(places.map(place => [place.id, place])).values()];
      if (!uniquePlaces.length) return;
      if (uniquePlaces.length === 1) {
        map.flyTo({
          center: [uniquePlaces[0].coordinates.longitude, uniquePlaces[0].coordinates.latitude],
          zoom: 15,
          ...cameraAnimationOptions(motionQuery.matches, 650)
        });
        return;
      }
      const framed = boundsForCoordinates(uniquePlaces.map(place => place.coordinates));
      const bounds = new (mapLibrary().LngLatBounds)();
      bounds.extend([framed.west, framed.south]);
      bounds.extend([framed.east, framed.north]);
      map.fitBounds(bounds, { padding: cameraPadding(), maxZoom: 14, ...cameraAnimationOptions(motionQuery.matches, 750) });
    }

    function focusTransportLeg(leg) {
      if (!map || !styleReady || !leg) return;
      const origin = placesById.get(leg.originPlaceId);
      const destination = placesById.get(leg.destinationPlaceId);
      const lines = leg.lines || makeDirectTransportLines(origin, destination);
      const points = unwrapLegPoints(lines);
      if (!points.length || points.some(point => !Number.isFinite(point.longitude) || !Number.isFinite(point.latitude))) return;
      const bounds = new (mapLibrary().LngLatBounds)();
      points.forEach(point => bounds.extend([point.longitude, point.latitude]));
      map.fitBounds(bounds, {
        padding: cameraPadding(),
        maxZoom: leg.mode === "flight" ? 9 : 14,
        ...cameraAnimationOptions(motionQuery.matches, 800)
      });
    }

    function focusLocation(locationId) {
      const location = locationsById.get(locationId);
      if (!map || !styleReady || !location) return;
      const locationPlaces = currentVisiblePlaces().filter(place => place.locationId === locationId);
      if (locationPlaces.length) {
        focusPlaces(locationPlaces);
        return;
      }
      map.flyTo({
        center: [location.coordinates.longitude, location.coordinates.latitude],
        zoom: location.zoom || 12,
        ...cameraAnimationOptions(motionQuery.matches, 700)
      });
    }

    function focusDay(dayId) {
      const places = currentVisiblePlaces();
      if (!places.length) {
        const fallbackLocationIds = selectedLocationId ? [selectedLocationId] : daysById.get(dayId).locationIds;
        fallbackLocationIds.forEach(locationId => places.push(locationsById.get(locationId)));
      }
      focusPlaces(places);
    }

    function revealTimelineRow(selector) {
      requestAnimationFrame(() => {
        document.querySelector(selector)?.scrollIntoView({
          block: "nearest",
          behavior: reducedMotion() ? "auto" : "smooth",
        });
      });
    }

    function selectActivity(activityId, fromMarker = false) {
      const row = activitiesById.get(activityId);
      if (!row) return;
      const selection = activitySelection(row);
      selectedActivityId = selection.activityId;
      selectedLegId = selection.legId;
      selectedMarkerPlaceIds = new Set(selection.placeIds);
      render({ preserveListScroll: !fromMarker });
      if (row.place && !activityIsCancelled(row)) {
        if (map && styleReady) {
        map.flyTo({
          center: [row.place.coordinates.longitude, row.place.coordinates.latitude],
          zoom: Math.max(map.getZoom(), 15),
          ...cameraAnimationOptions(motionQuery.matches, 600)
        });
        const marker = markers.get(row.place.id);
        if (!fromMarker && marker && !marker.getPopup().isOpen()) marker.togglePopup();
        if (fromMarker && marker) {
          requestAnimationFrame(() => {
            if (!marker.getPopup().isOpen()) marker.togglePopup();
          });
        }
        }
      }
      if (fromMarker) revealTimelineRow('[data-id="' + CSS.escape(activityId) + '"]');
    }

    function selectTransportLeg(legId, markerPlaceId = "") {
      const leg = transportLegsById.get(legId);
      if (!leg) return;
      const origin = placesById.get(leg.originPlaceId);
      const destination = placesById.get(leg.destinationPlaceId);
      const selection = transportSelection(leg);
      selectedActivityId = selection.activityId;
      selectedLegId = selection.legId;
      selectedMarkerPlaceIds = new Set(selection.placeIds);
      render({ preserveListScroll: !markerPlaceId });
      focusTransportLeg(leg);
      if (markerPlaceId) {
        const marker = markers.get(markerPlaceId);
        requestAnimationFrame(() => {
          if (marker && !marker.getPopup().isOpen()) marker.togglePopup();
        });
      }
      if (markerPlaceId) revealTimelineRow('[data-leg-id="' + CSS.escape(legId) + '"]');
    }

    function applyFocus(focus) {
      selectedActivityId = "";
      selectedLegId = "";
      selectedMarkerPlaceIds = new Set();
      const next = resolveFocusState(focus, daysById, locationsById);
      selectedDayId = next.dayId;
      selectedLocationId = next.locationId;
      daySelect.value = selectedDayId;
      locationSelect.value = selectedLocationId;
      updateDayOptions();
      render({ resetListScroll: true });
      if (selectedDayId) focusDay(selectedDayId);
      else if (selectedLocationId) focusLocation(selectedLocationId);
      else focusPlaces(currentVisiblePlaces());
    }

    function applyInitialView() {
      if (selectedDayId || selectedLocationId) applyFocus(payload.initialFocus);
      else focusPlaces(currentVisiblePlaces());
    }

    function applyCurrentCamera() {
      if (!map || !styleReady) return;
      if (selectedLegId) focusTransportLeg(transportLegsById.get(selectedLegId));
      else if (selectedDayId) focusDay(selectedDayId);
      else if (selectedLocationId) focusLocation(selectedLocationId);
      else focusPlaces(currentVisiblePlaces());
    }

    function activityIsCancelled(row) {
      return row.effectiveStatus === "cancelled" || (row.day.status || "planned") === "cancelled";
    }

    function legIsCancelled(leg) {
      return (leg.status || "planned") === "cancelled"
        || (leg.dayId && (daysById.get(leg.dayId)?.status || "planned") === "cancelled");
    }

    function combineFilters(baseFilter, stateFilter) {
      return baseFilter ? ["all", baseFilter, stateFilter] : stateFilter;
    }

    function dateValue(date) {
      return new Date(date + "T00:00:00Z");
    }

    function formatDateRange(start, end) {
      const startDate = dateValue(start);
      const endDate = dateValue(end);
      const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
      const startText = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
        timeZone: "UTC"
      }).format(startDate);
      const endText = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(endDate);
      return startText + " – " + endText;
    }

    function formatShortDate(date) {
      return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(dateValue(date));
    }

    function formatLongDate(date) {
      return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(dateValue(date));
    }

    function formatTime(time) {
      const [hour, minute] = time.split(":").map(Number);
      return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
        .format(new Date(Date.UTC(1970, 0, 1, hour, minute)));
    }

    function formatLocalDateTimeTime(value) {
      return formatTime(value.slice(11));
    }

    function titleCase(value) {
      return value.replaceAll("-", " ").replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
    }

    function readableTimeZone(locationId) {
      const location = locationsById.get(locationId);
      return location.name + " time";
    }

    function activitySecondary(row, location) {
      const parts = [styles[row.category].label];
      if (location) parts.push("in " + location.name);
      if (row.place && row.place.name !== row.name) parts.push("at " + row.place.name);
      return parts.join(" ");
    }

    function activityAriaLabel(row, location) {
      const parts = [
        row.startTime ? formatTime(row.startTime) : "Anytime",
        row.name,
        titleCase(row.effectiveStatus)
      ];
      if (location) parts.push(location.name + " time");
      if (!row.place) parts.push("Schedule only");
      if ((row.day.status || "planned") === "cancelled" && row.effectiveStatus !== "cancelled") {
        parts.push("Parent day cancelled");
      }
      return parts.join(", ");
    }

    function transportAriaLabel(leg, origin, destination) {
      const parts = [
        titleCase(leg.mode),
        leg.name || origin.name + " to " + destination.name,
        "from " + origin.name + " to " + destination.name,
        titleCase(leg.status || "planned")
      ];
      if (leg.departureLocalDateTime) parts.push("departs " + formatLocalDateTimeTime(leg.departureLocalDateTime));
      if (leg.arrivalLocalDateTime) parts.push("arrives " + formatLocalDateTimeTime(leg.arrivalLocalDateTime));
      if (leg.dayId && (daysById.get(leg.dayId)?.status || "planned") === "cancelled"
        && (leg.status || "planned") !== "cancelled") {
        parts.push("Parent day cancelled");
      }
      return parts.join(", ");
    }

    function createBadge(label, status) {
      const badge = document.createElement("span");
      badge.className = "badge badge-" + status;
      badge.textContent = label;
      return badge;
    }

    function reducedMotion() {
      return motionQuery.matches;
    }

    legend = document.createElement("details");
    legend.className = "legend";
    legend.open = !narrowControls;
    legendSummary = document.createElement("summary");
    legendSummary.textContent = "Map legend";
    legendSummary.setAttribute("aria-expanded", String(legend.open));
    legend.addEventListener("toggle", () => {
      legendSummary.setAttribute("aria-expanded", String(legend.open));
    });
    const grid = document.createElement("div");
    grid.className = "legend-grid";
    [
      ["legend-route", "Booked / planned leg"],
      ["legend-route tentative", "Tentative leg"],
      ["legend-route cancelled", "Cancelled leg"]
    ].forEach(([className, label]) => {
      const item = document.createElement("span");
      const swatch = document.createElement("span");
      swatch.className = className;
      item.append(swatch, document.createTextNode(label));
      grid.appendChild(item);
    });
    if ((itinerary.recommendedStayAreas || []).length) {
      const stayItem = document.createElement("span");
      const staySwatch = document.createElement("span");
      staySwatch.className = "stay-swatch";
      stayItem.append(staySwatch, document.createTextNode("Stay area"));
      grid.appendChild(stayItem);
    }
    legend.append(legendSummary, grid);
    document.getElementById("map").appendChild(legend);

    render({ resetListScroll: true });
    if (map && styleReady) applyInitialView();

    const handleRuntimeFocus = state => {
      if (!Number.isSafeInteger(state.focusRevision) || state.focusRevision < serverFocusRevision) return;
      serverFocusRevision = advanceKnownRevision(serverFocusRevision, state.focusRevision);
      const inbound = receiveAuthoritativeFocus(focusState, state);
      applyAuthoritativeFocus(inbound);
    };
    const handleRuntimeState = state => {
      if (needsRevisionReload(payload.revision, state.revision)) {
        window.location.replace("?revision=" + state.revision);
        return;
      }
      if (!Number.isSafeInteger(state.focusRevision) || state.focusRevision < serverFocusRevision) return;
      serverFocusRevision = advanceKnownRevision(serverFocusRevision, state.focusRevision);
      const inbound = receiveAuthoritativeFocus(focusState, state);
      applyAuthoritativeFocus(inbound);
    };
    const handleRuntimeReload = state => {
      if (needsRevisionReload(payload.revision, state.revision)) {
        window.location.replace("?revision=" + state.revision);
      }
    };
    const onConnected = () => {
      const warning = document.getElementById("sync-error");
      if (warning?.dataset.connectionError === "true") {
        warning.hidden = true;
        delete warning.dataset.connectionError;
      }
    };
    const onDisconnected = () => {
      const warning = document.getElementById("sync-error");
      if (!warning || warning.hidden === false) return;
      warning.dataset.connectionError = "true";
      warning.textContent = "Live updates are reconnecting. Current itinerary controls remain available.";
      warning.hidden = false;
    };
    const unsubscribeRuntime = runtime.subscribe({
      focus: handleRuntimeFocus,
      state: handleRuntimeState,
      reload: handleRuntimeReload,
      connected: onConnected,
      disconnected: onDisconnected,
    });
    const lifecycleEvents = {
      addEventListener() {},
      removeEventListener() {},
      close: unsubscribeRuntime,
    };
    const { teardown } = attachClientLifecycle({
      events: lifecycleEvents, window, themeQuery, onlineHandler: initializeMap, themeHandler: handleThemeChange,
      onConnected: () => {}, onDisconnected: () => {},
      dispose: () => {
        window.clearTimeout(mapErrorTimer);
        window.clearTimeout(stylePollTimer);
        disposeMapResources(map, mapResizeObserver);
        map = null;
        mapResizeObserver = undefined;
      }
    });
    return {
      teardown,
      getState: () => ({
        focus: currentFocus(),
        selection: {
          activityId: selectedActivityId,
          legId: selectedLegId,
          placeIds: [...selectedMarkerPlaceIds],
        },
        serverFocusRevision,
        styleReady,
        theme: {
          requestedTheme: currentTheme,
          appliedTheme: appliedMapTheme,
          switching: currentTheme !== appliedMapTheme,
          styleReady,
        },
      }),
    };
}
