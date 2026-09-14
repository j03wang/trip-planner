export function composeOpenInputSchema(openSchemaSource, itinerarySchema) {
    const itineraryDefinition = { ...itinerarySchema };
    delete itineraryDefinition.$schema;
    delete itineraryDefinition.$id;
    delete itineraryDefinition.$defs;
    return {
        ...openSchemaSource,
        properties: {
            ...openSchemaSource.properties,
            itinerary: { $ref: "#/$defs/itinerary" },
        },
        $defs: {
            ...itinerarySchema.$defs,
            itinerary: itineraryDefinition,
        },
    };
}

export function unresolvedSchemaRefs(schema) {
    const refs = [];
    const visit = (value) => {
        if (!value || typeof value !== "object") return;
        if (typeof value.$ref === "string" && value.$ref.startsWith("#/")) {
            const resolved = value.$ref.slice(2).split("/")
                .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
                .reduce((current, part) => current?.[part], schema);
            if (!resolved) refs.push(value.$ref);
        }
        Object.values(value).forEach(visit);
    };
    visit(schema);
    return [...new Set(refs)];
}
