export const ERROR_CODES = Object.freeze({
    inputInvalid: "itinerary_input_invalid",
    sourceInvalid: "itinerary_source_invalid",
    pathInvalid: "itinerary_path_invalid",
    fileUnreadable: "itinerary_file_unreadable",
    fileTooLarge: "itinerary_file_too_large",
    jsonInvalid: "itinerary_json_invalid",
    schemaInvalid: "itinerary_schema_invalid",
    focusInvalid: "itinerary_focus_invalid",
    instanceMissing: "canvas_instance_missing",
});

export const PUBLIC_ERROR_CODES = Object.freeze(Object.values(ERROR_CODES));
