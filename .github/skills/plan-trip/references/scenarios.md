# Workflow scenarios

These are process examples, not itinerary templates. They demonstrate the approval boundary and contract choices.

## Single-city trip

**Prompt:** “Plan my four-day art and food trip to Montréal.”

1. Ask only for missing high-impact facts, such as dates and preferred pace. Follow the target repository's output convention; if it is absent or ambiguous, ask where to save the JSON.
2. Verify consequential museum closure days or timed-entry requirements from official venue pages; treat restaurant ideas as recommendations unless reservations are fixed.
3. Draft four geographically grouped days with arrival recovery, moderate activity load, meal buffers, and optional indoor alternatives.
4. Include the chosen project-relative output path and ask: “Approve this day-by-day draft for materialization at this path, or what should change?”
5. Only after approval, write the approved path (for example `trips/montreal-art-food/itinerary.json` in a repository with that convention), using one `America/Toronto` location, reusable coordinate-bearing places, and schedule-only rest blocks.
6. Validate with the refreshed tooling checkout and preview with the canvas only if the target repository provides it; otherwise offer the export fallback.

## Multi-timezone flight trip

**Prompt:** “Turn my booked New York–Reykjavík–London trip into an itinerary.”

1. Record flight and lodging confirmations as fixed anchors without collecting booking codes.
2. Verify current airport/rail transfer constraints and official entry guidance only where relevant.
3. Draft transfer days with both endpoint locations, local-time buffers, jet-lag recovery, and conservative first evenings.
4. State the chosen output path and obtain explicit approval.
5. Create locations with `America/New_York`, `Atlantic/Reykjavik`, and `Europe/London`; create airport places; add booked transport legs with local endpoint datetimes. Omit route `lines` unless trustworthy geometry is available—the renderer supplies a direct route.
6. Validate chronology and preview the first useful day when the canvas is available.

## Update an existing itinerary

**Prompt:** “Update my Québec itinerary: the train moved to Tuesday morning.”

1. Read the existing itinerary and working-tree state before proposing edits.
2. Preserve trip, place, day, activity, and transport IDs where their entities remain the same.
3. Reassess every day against the new train time: arrival and departure margins, connections, opening constraints, pacing, reservations, and displaced activities. Rebalance Tuesday and neighboring days as needed without changing unrelated choices.
4. Show the full revised trip day by day at a uniform level of detail, marking material changes and explaining affected buffers, reservations, and activity displacement. State the existing output path and ask for explicit approval of the integrated revision.
5. After approval, update the existing path rather than creating a duplicate. Keep days, activities, and transport consistent with the approved draft, preserve continuing IDs and `booked` status, and use only verified local times.
6. Run validation, correct errors, and refresh the same `documentId` preview when the target repository has the canvas.
