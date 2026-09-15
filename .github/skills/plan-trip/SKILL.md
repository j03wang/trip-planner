---
name: plan-trip
description: Plan, revise, or turn a trip into the canonical structured itinerary and map. Use for prompts such as "plan my trip", "turn this trip into an itinerary", "update my itinerary", or requests to organize booked travel into a day-by-day plan.
license: MIT
compatibility: Requires this repository, Node.js 24, network access for selective current-source research and basemap display, and the structured-itinerary-map canvas for in-app preview.
---

# Plan a trip

Create practical travel plans, obtain explicit approval, then materialize a validated itinerary and open its map.

## Non-negotiable workflow

1. **Understand the request.** If this updates an itinerary, read the existing file before proposing changes. Separate fixed/booked anchors from preferences and assumptions.
2. **Gather only high-impact gaps.** Ask one focused question at a time when interaction is available. Infer low-risk defaults, state them, and avoid a long questionnaire.
3. **Research selectively.** Verify current facts that can change feasibility. Cite sources in the planning response.
4. **Present a concise day-by-day draft.** Include destinations, major activities, transport, pace/energy, optional alternatives, and unresolved assumptions.
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

## Approval gate

End the draft with a direct approval request. A valid approval clearly accepts materialization, such as “Approve this draft” or an unambiguous equivalent. Questions, partial preferences, and tentative reactions are not approval. Incorporate requested adjustments and present the revised draft before asking again.

## Materialization

Use `itineraries/<trip-id>.json`, where `<trip-id>` is a stable lowercase kebab-case identifier. Do not overwrite an existing file unless the user explicitly approved updating that itinerary. For updates, preserve stable IDs, booked statuses, and unrelated user decisions; show material changes before approval.

Build the document from the canonical schema and shared semantics:

- `.github/extensions/structured-itinerary-map/itinerary.schema.json`
- `docs/itinerary-contract.md`

Coordinates are required for every location and place. Resolve and verify them during planning; the renderer never geocodes. Omit optional fields that are unsupported rather than fabricating values.

Validate from the repository root:

```powershell
npm run validate:itinerary -- itineraries\<trip-id>.json
```

Do not claim completion until this exits successfully. Correct all schema, reference, timezone, chronology, geometry, size, and path errors.

## Preview

After validation, open the `structured-itinerary-map` canvas with:

```json
{
  "documentId": "<trip-id>",
  "itineraryPath": "itineraries/<trip-id>.json",
  "initialFocus": {
    "dayId": "<first-useful-day-id>"
  }
}
```

Use exactly one source field: `itineraryPath`, not an additional inline `itinerary`. The path must remain project-relative. Use a valid caller-chosen `instanceId`, such as `itinerary-<trip-id>`, only as a transient panel handle. `documentId` is the stable itinerary identity. For an update, refresh the same document preview when practical.

If the canvas is unavailable, say so and provide this exact fallback, substituting the trip ID:

```powershell
node scripts\export-map.mjs itineraries\<trip-id>.json .test-work\<trip-id>-map
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
