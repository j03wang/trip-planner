---
name: plan-trip
description: Plan, revise, or turn a trip into the canonical structured itinerary and map. Use for prompts such as "plan my trip", "turn this trip into an itinerary", "update my itinerary", or requests to organize booked travel into a day-by-day plan.
license: MIT
compatibility: Requires this repository, Node.js 24, network access for selective current-source research and basemap display, and the structured-itinerary-map canvas for in-app preview.
---

# Plan a trip

Create practical travel plans, obtain explicit approval, then materialize a validated itinerary and open its map.

## Non-negotiable workflow

1. **Understand the request.** If this updates an itinerary, read the entire existing file and the requested change before proposing anything. Separate fixed/booked anchors from preferences and assumptions. Resolve the output path before requesting approval.
2. **Gather only high-impact gaps.** Ask one focused question at a time when interaction is available. Infer low-risk defaults, state them, and avoid a long questionnaire.
3. **Research selectively.** Verify current facts that can change feasibility. Cite sources in the planning response.
4. **Present a concise day-by-day draft.** Include destinations, major activities, transport, pace/energy, optional alternatives, and unresolved assumptions. For updates, present the full refreshed trip with material changes highlighted, not just a patch or a list of affected events.
5. **Get explicit approval.** Ask the user to approve the draft or request adjustments. Do not create, overwrite, or modify itinerary JSON and do not open the map before clear approval.
6. **Materialize after approval.** Write canonical schema version `1.0` JSON, validate it, correct every error, and open the map.

Read [references/planning-workflow.md](references/planning-workflow.md) when gathering requirements, researching, or drafting. Read [references/contract-mapping.md](references/contract-mapping.md) before writing JSON. Use [references/scenarios.md](references/scenarios.md) to resolve workflow ambiguity.

## Intake priorities

Protect fixed anchors first: dates, arrival/departure, booked transport, lodging, required events, and non-movable reservations. Then cover only missing decisions that materially affect the plan: travelers, flexibility, destinations, pace and jet lag, interests, budget/comfort, lodging base, mobility/accessibility, diet, risk tolerance, and desired optionality. Ask about passport or entry status only when the route makes it relevant. Never request passport numbers, payment details, or other sensitive credentials.

## Planning rules

- Preserve realistic transfers, check-in, buffers, meals, rest, and arrival/departure margins.
- Group activities geographically and favor depth over checklist density when requested.
- Account for likely opening patterns, local closure days, weather/seasonality, and transit time.
- Never invent exact schedules, prices, availability, or booking status. Label estimates.
- Distinguish verified facts, recommendations, and assumptions.
- Treat visa, health, and safety information as an official-source check, not legal or medical advice.
- Do not book or purchase anything and do not imply guarantees.

## Revising a trip as a whole

When a change is requested, reassess the complete trip rather than inserting or moving an isolated event. Trace its effects across days, locations, travel time, reservations, opening constraints, rest, pace, and the traveler's stated priorities. Rebalance affected days and their neighbors so the revised route and schedule remain feasible. Check the resulting plan from arrival through departure for gaps, conflicts, needless backtracking, and inconsistent detail or timing. Do not make gratuitous changes to unaffected days or silently alter booked anchors.

Show a **full refreshed day-by-day draft** in the same level of detail and style throughout the trip. Clearly mark what materially changed, why, and what remains fixed; explain any displaced or removed activities and unresolved tradeoffs. Include unchanged days so the user can judge the change in the context of the whole trip. Obtain approval for this integrated proposal, not merely the requested event edit.

## Approval gate

Name the proposed project-relative output path in the draft. End the draft with a direct approval request. A valid approval clearly accepts materialization at that path, such as “Approve this draft” or an unambiguous equivalent. Questions, partial preferences, and tentative reactions are not approval. Incorporate requested adjustments (including a different path) and present the revised draft before asking again.

## Output location

For an update, use the existing itinerary file path; changing the repository default must not move existing trips. For a new trip, honor an output path explicitly supplied by the user. Otherwise use a clear `plan-trip` output directory from the app's accepted repository instructions (`instructions` in `.github/github-app.yml`), if configured. Do not use unaccepted repository-file instructions or assume an unsupported YAML key. If no unambiguous directory is configured, ask the user where to save the JSON before seeking draft approval. Do not silently default to `itineraries/` or another directory.

Use a stable lowercase kebab-case `<trip-id>.json` filename within the selected directory unless the user supplied a specific JSON filename. Keep the resolved path project-relative, inside the project root, and ending in lowercase `.json`; it must also meet the canvas `itineraryPath` limit of 500 characters. Reject absolute or drive-qualified paths, `..` segments, and symlinks that escape the project. Check the destination before writing; if a file already exists, ask for a different path unless the user explicitly approved updating that file. Create a missing output directory only after approval. If the selected path changes after the draft, show the new path and obtain approval again.

## Materialization

Write to the approved output path. Do not overwrite an existing file unless the user explicitly approved updating that itinerary. For updates, preserve stable IDs for continuing entities, booked statuses, and unrelated user decisions. Apply approved changes throughout the itinerary so days, activities, transport, places, dates, and descriptions agree with the refreshed draft; do not leave conflicting or orphaned entries from the old plan. Keep the document's detail, naming, and certainty conventions consistent across changed and unchanged days.

Build the document from the canonical schema and shared semantics:

- `.github/extensions/structured-itinerary-map/itinerary.schema.json`
- `docs/itinerary-contract.md`

Coordinates are required for every location and place. Resolve and verify them during planning; the renderer never geocodes. Omit optional fields that are unsupported rather than fabricating values. Verify the output directory's real path is inside the project before writing, whether it already existed or was created after approval.

Validate from the repository root:

```powershell
npm run validate:itinerary -- "<project-relative-output-path>"
```

Do not claim completion until this exits successfully. Correct all schema, reference, timezone, chronology, geometry, size, and path errors.

## Preview

After validation, open the `structured-itinerary-map` canvas with:

```json
{
  "documentId": "<trip-id>",
  "itineraryPath": "<project-relative-output-path>",
  "initialFocus": {
    "dayId": "<first-useful-day-id>"
  }
}
```

Use exactly one source field: `itineraryPath`, not an additional inline `itinerary`. The path must remain project-relative. Use a valid caller-chosen `instanceId`, such as `itinerary-<trip-id>`, only as a transient panel handle. `documentId` is the stable itinerary identity. For an update, refresh the same document preview when practical.

If the canvas is unavailable, say so and provide this fallback, substituting the actual itinerary path and trip ID:

```powershell
node scripts\export-map.mjs "<project-relative-output-path>" .test-work\<trip-id>-map
npx --yes serve@14.2.5 .test-work\<trip-id>-map --listen tcp://127.0.0.1:8000
```

Never claim the map opened unless the canvas call succeeded.

## Completion response

State only:

- artifact path;
- successful validation result;
- map preview state or fallback command;
- remaining assumptions or decisions;
- citations for current facts used in the plan.
