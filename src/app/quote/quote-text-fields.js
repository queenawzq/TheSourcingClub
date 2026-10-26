export function quoteTextPatch(values) {
  const text = (value) => String(value ?? "").trim() || null;
  return {
    sourcing_includes: text(values.sourcingIncludes),
    factory_response: text(values.factoryResponse),
    factory_notes: text(values.factoryNotes),
  };
}

export function quoteTextValues(quote) {
  return {
    sourcingIncludes: quote?.sourcing_includes ?? "",
    factoryResponse: quote?.factory_response ?? "",
    factoryNotes: quote?.factory_notes ?? "",
  };
}
