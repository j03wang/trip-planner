---
name: plan-trip
description: Plan, revise, or turn a trip into the canonical structured itinerary and map. Use for prompts such as "plan my trip", "turn this trip into an itinerary", "update my itinerary", or requests to organize booked travel into a day-by-day plan.
license: MIT
compatibility: Requires Node.js 24, Git, and network access to refresh canonical tooling and research current facts. Canvas preview is optional.
---

# Plan a trip

Create practical travel plans in any repository, obtain explicit approval, then materialize a validated canonical itinerary. Preview the map when supported.

## Non-negotiable workflow

1. **Understand the request.** If this updates an itinerary, read the entire existing file and the requested change before proposing anything. Separate fixed/booked anchors from preferences and assumptions. Resolve the output path before requesting approval.
2. **Gather only high-impact gaps.** Ask one focused question at a time when interaction is available. Infer low-risk defaults, state them, and avoid a long questionnaire.
3. **Research selectively.** Verify current facts that can change feasibility. Cite sources in the planning response.
4. **Present a concise day-by-day draft.** Include destinations, major activities, transport, pace/energy, optional alternatives, and unresolved assumptions. For updates, present the full refreshed trip with material changes highlighted, not just a patch or a list of affected events.
5. **Get explicit approval.** Ask the user to approve the draft or request adjustments. Do not create, overwrite, or modify itinerary JSON and do not open the map before clear approval.
6. **Materialize after approval.** Write canonical schema version `1.0` JSON, validate it, correct every error, and preview the map when available.

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

For an update, use the existing itinerary path; changing a repository convention must not move existing trips. If the trip is ambiguous, ask which existing file to update. For a new trip, honor a path explicitly supplied by the user; otherwise follow the target repository's instructions and naming conventions (for example, `AGENTS.md` or accepted `.github/github-app.yml` instructions). A template such as `trips/<trip-id>/itinerary.json` sets both directory and filename. If no unambiguous path convention exists, ask where to save the JSON before seeking draft approval. Do not silently choose a directory or require `.github/github-app.yml`.

If the user selects only a directory and the repository has no filename convention, use a stable lowercase kebab-case `<trip-id>.json` filename. Keep the resolved path project-relative, inside the target repository, and ending in lowercase `.json`. Reject absolute or drive-qualified paths, `..` segments, and symlinks that escape the repository. When using the canvas, its `itineraryPath` also has a 500-character limit. Check the destination before writing; if a file already exists, ask for a different path unless the user explicitly approved updating that file. Create a missing output directory only after approval. If the selected path changes after the draft, show the new path and obtain approval again.

## Canonical tooling in other repositories

The target repository does **not** need this project's schema, npm scripts, canvas extension, or exporter. Use the installed `plan-trip` skill's `scripts/validate.mjs` and a separate checkout of `https://github.com/j03wang/trip-planner.git` in a cache **outside the target repository**. At the start of **each planning or revision request**, clone it if absent; otherwise require a clean checkout, then fetch the latest `origin/main` and check it out detached:

```text
git clone https://github.com/j03wang/trip-planner.git "<tooling-checkout>"
git -C "<tooling-checkout>" fetch origin main
git -C "<tooling-checkout>" checkout --detach origin/main
git -C "<tooling-checkout>" rev-parse HEAD
```

Only clone if the checkout does not exist; verify it is clean before updating. Keep this checkout unchanged while drafting and materializing so the schema, semantic rules, and exporter come from the same revision. The validator fetches `origin/main` again before checking the finished file; if upstream advanced meanwhile, it stops instead of validating against a changed contract. Refresh the tooling checkout, reread the contract, reconcile the draft with any changes, and seek approval again if the plan or output must change. Do not switch branches or change dependencies in the target repository. Node.js 24 and Git suffice for validation and static map export; no `npm install` is needed. If the tooling cannot be fetched or validated, explain the blocker rather than claiming completion. If the latest contract no longer supports schema `1.0`, stop rather than silently changing the requested format.

Read `<tooling-checkout>/.github/extensions/structured-itinerary-map/itinerary.schema.json` and `<tooling-checkout>/docs/itinerary-contract.md` before materialization. Use the same checkout for validation and export so contract and tooling stay in sync. The skill's `references/contract-mapping.md` is a checklist, not a substitute for the canonical contract.

## Materialization

Write to the approved output path. Do not overwrite an existing file unless the user explicitly approved updating that itinerary. For updates, preserve stable IDs for continuing entities, booked statuses, and unrelated user decisions. Apply approved changes throughout the itinerary so days, activities, transport, places, dates, and descriptions agree with the refreshed draft; do not leave conflicting or orphaned entries from the old plan. Keep the document's detail, naming, and certainty conventions consistent across changed and unchanged days.

Coordinates are required for every location and place. Resolve and verify them during planning; the renderer never geocodes. Omit optional fields that are unsupported rather than fabricating values. Verify the output directory's real path is inside the project before writing, whether it already existed or was created after approval.

Validate from the **target repository root**, using the path to this installed skill and the current tooling checkout:

```text
node "<skill-directory>/scripts/validate.mjs" "<tooling-checkout>" "<project-relative-output-path>"
```

Do not claim completion until this exits successfully. Correct all schema, reference, timezone, chronology, geometry, size, and path errors.

## Preview

If the **target repository** provides the `structured-itinerary-map` canvas, open it after validation with:

```json
{
  "documentId": "<trip-id>",
  "itineraryPath": "<project-relative-output-path>",
  "initialFocus": {
    "dayId": "<first-useful-day-id>"
  }
}
```

Use exactly one source field: `itineraryPath`, not an additional inline `itinerary`. The path must remain project-relative. Use a valid caller-chosen `instanceId`, such as `itinerary-<trip-id>`, only as a transient panel handle. `documentId` is the stable itinerary identity. For an update, refresh the same document preview when practical. Do not assume the canvas is installed just because the tooling checkout has an extension.

If the canvas is unavailable, say so and provide a fallback using the same tooling checkout's exporter and a user-chosen map output directory. Do not run it or create map files unless requested:

```text
node "<tooling-checkout>/scripts/export-map.mjs" "<project-relative-output-path>" "<map-output-directory>"
npx --yes serve@14.2.5 "<map-output-directory>" --listen tcp://127.0.0.1:8000
```

Never claim the map opened unless the canvas call succeeded.

## Completion response

State only:

- artifact path;
- successful validation result;
- map preview state or fallback command;
- remaining assumptions or decisions;
- citations for current facts used in the plan.
