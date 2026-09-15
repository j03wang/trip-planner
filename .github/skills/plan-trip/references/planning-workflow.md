# Planning workflow reference

## Focused intake

Start from information already supplied. Classify it as:

- **Fixed:** booked travel, required events, paid lodging, hard dates, accessibility needs.
- **Preferred:** destinations, interests, pace, budget, lodging style, meal preferences.
- **Assumed:** low-risk defaults that can be changed without invalidating fixed anchors.
- **Unknown:** facts that can materially change feasibility.

Ask one question at a time, prioritizing:

1. trip dates/flexibility and traveler count;
2. origin, arrival/departure points, and booked transport;
3. required destinations/events and fixed lodging;
4. pace, energy, jet lag, mobility, diet, and accessibility;
5. interests, budget/comfort, base preferences, risk tolerance, and optionality.

Stop asking when a useful draft can be produced. State inferred defaults in the draft.

## Selective research

Research facts whose current state affects the route or a fixed anchor:

- official transport schedules and operator notices;
- venue hours, closure days, timed-entry rules, and access restrictions;
- border/entry rules from government sources when relevant;
- official weather or climate-season information;
- booking windows, reservation requirements, and major local disruptions.

Prefer official or primary sources. Use reputable secondary sources for qualitative neighborhood or activity comparisons. Do not browse every subjective recommendation.

For each consequential fact, retain:

- page title;
- URL;
- access date;
- the verified fact and any uncertainty.

Cite these in the draft and completion response. Keep recommendations and estimates visibly separate from verified facts. If a source is inaccessible, stale, or contradictory, disclose that and avoid turning it into a precise claim. Put a URL in an itinerary `url` or `notes` field only when it naturally describes that place/activity; citations belong primarily in the planning response.

## Draft shape

Keep the proposal compact:

```text
Assumptions
- ...

Day 1 — Destination — pace
- Arrival/transport anchor
- Major activity cluster
- Meal/rest buffer
- Optional alternative

Tradeoffs and unresolved decisions
- ...

Sources
- [Official source title](https://source.example/path), accessed YYYY-MM-DD — verified fact
```

Show local times only when known or clearly labeled as estimates. Protect arrival and departure days. On transfer days, include both endpoint contexts and realistic terminal/station buffers. Ask for explicit approval after the draft.

## Updates

Read the current JSON and its Git state first, and retain the original content or hash used for the proposal. Summarize only material changes: dates, destinations, booked anchors, day structure, transport, removed activities, and newly unresolved assumptions. Preserve stable IDs for unchanged domain objects, even if labels or notes change. Immediately before writing, reread the file. If it changed after the proposal, merge both intents only when every change is understood; otherwise stop and present the conflict for approval. Do not overwrite unrelated modifications or downgrade `booked` status without explicit approval.
