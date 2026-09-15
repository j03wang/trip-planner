# Workflow scenarios

These are process examples, not itinerary templates. They demonstrate the approval boundary and contract choices.

## Single-city trip

**Prompt:** “Plan my four-day art and food trip to Montréal.”

1. Ask only for missing high-impact facts, such as dates and preferred pace.
2. Verify consequential museum closure days or timed-entry requirements from official venue pages; treat restaurant ideas as recommendations unless reservations are fixed.
3. Draft four geographically grouped days with arrival recovery, moderate activity load, meal buffers, and optional indoor alternatives.
4. Ask: “Approve this day-by-day draft for materialization, or what should change?”
5. Only after approval, write `itineraries/montreal-art-food.json`, using one `America/Toronto` location, reusable coordinate-bearing places, and schedule-only rest blocks.
6. Validate and open the canvas.

## Multi-timezone flight trip

**Prompt:** “Turn my booked New York–Reykjavík–London trip into an itinerary.”

1. Record flight and lodging confirmations as fixed anchors without collecting booking codes.
2. Verify current airport/rail transfer constraints and official entry guidance only where relevant.
3. Draft transfer days with both endpoint locations, local-time buffers, jet-lag recovery, and conservative first evenings.
4. Obtain explicit approval.
5. Create locations with `America/New_York`, `Atlantic/Reykjavik`, and `Europe/London`; create airport places; add booked transport legs with local endpoint datetimes. Omit route `lines` unless trustworthy geometry is available—the renderer supplies a direct route.
6. Validate chronology and open the first useful day.

## Update an existing itinerary

**Prompt:** “Update my Québec itinerary: the train moved to Tuesday morning.”

1. Read the existing itinerary and working-tree state before proposing edits.
2. Preserve trip, place, day, activity, and transport IDs where their entities remain the same.
3. Explain affected days, buffers, reservations, and any activity displacement. Do not change unrelated choices.
4. Ask for explicit approval of the material changes.
5. After approval, edit the existing path rather than creating a duplicate. Preserve `booked` status and update only verified local times.
6. Run validation, correct errors, and refresh the same `documentId` preview.

