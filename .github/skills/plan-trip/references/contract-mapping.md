# Contract mapping reference

The canonical source is [`../../../extensions/structured-itinerary-map/itinerary.schema.json`](../../../extensions/structured-itinerary-map/itinerary.schema.json), with semantic rules in [`../../../../docs/itinerary-contract.md`](../../../../docs/itinerary-contract.md). Use this reference as a mapping checklist, not a substitute for validation.

## Document mapping

| Planning concept | Contract field |
|---|---|
| Stable trip identity and inclusive dates | `trip.id`, `startDate`, `endDate` |
| Destination/timezone context | `locations[]` |
| Reusable mapped entity | `places[]` |
| Daily schedule | `days[]` and `activities[]` |
| Inter-place movement | `transportLegs[]` |
| Supportable lodging neighborhood | `recommendedStayAreas[]` |
| Presentation label/color | `categoryStyles` |

Use stable lowercase kebab-case IDs. Keep existing IDs during updates unless the underlying entity changes.

## Important distinctions

- A **location** is a destination or timezone-bearing context. It always has center coordinates and an IANA timezone.
- A **place** is a reusable mapped point inside one location. It always has coordinates.
- An **activity** is a schedule entry. It never embeds coordinates; `placeId` maps it, while `locationId` supplies schedule/time context only.
- An activity without `placeId` is schedule-only and has no marker. Use this for rest, check-in, reminders, free time, or other non-mappable blocks.
- Only referenced places render. Do not add speculative catalog entries: they can confuse maintenance even though unreferenced entries do not affect framing.

## Days and timezones

A single-location day can let an activity inherit its effective location. A multi-location day must list every relevant location in `locationIds`; timed schedule-only activities need an explicit `locationId`, and mapped activities inherit the place location. If both `placeId` and `locationId` are present, they must agree.

`startTime` and `endTime` are local `HH:mm` values on the day date. Transport endpoint datetimes use `YYYY-MM-DDTHH:mm` without an offset; the origin and destination place locations supply their timezones. Never convert these fields to UTC or append `Z`.

## Status and certainty

Allowed status values are `tentative`, `planned`, `booked`, `optional`, and `cancelled`; omission means `planned`. Use `booked` only for a user-confirmed reservation. Preserve cancelled entries when they remain useful context rather than silently deleting them.

## Transport

Every transport leg requires reusable origin and destination places. Add local endpoint datetimes only when known. Direct geometry is valid when `lines` is omitted; the renderer connects endpoints. Add `lines` only from trustworthy route geometry. Split antimeridian crossings into separate line arrays so no adjacent longitude jump exceeds 180 degrees.

Use `dayId` when the leg belongs to a schedule day. That day's `locationIds` must explicitly contain both the origin place's location and the destination place's location. Multi-timezone chronology is checked using each endpoint location timezone.

## Stay areas and categories

Add a recommended stay area only when the recommendation and polygon are supportable. Boundaries must be closed rings and antimeridian-safe. Omit the field rather than drawing an invented neighborhood.

Categories control filters and marker accents. Every activity requires a category. A place category is optional but useful. `categoryStyles` is optional; add concise labels and accessible colors only when custom styling helps.

## Final checks

- Every location/place has verified coordinates.
- Dates fall inside the trip range.
- IDs and cross-references are unique and valid.
- Booked anchors retain `booked`.
- Timed activities resolve a timezone.
- Transfer days include both locations.
- Unsupported prices, hours, availability, geometry, and stay polygons are omitted.
- `npm run validate:itinerary -- <path>` exits zero.
