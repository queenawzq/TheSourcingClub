/** Replace only user-authored display fields; keep legal names and identifiers intact. */
export function englishProfileParts(parts, translations) {
  const text = (value) => translations[value] ?? value;
  return {
    ...parts,
    orgName: text(parts.orgName),
    profile: {
      ...parts.profile,
      ...Object.fromEntries(["intro", "location", "nearest_port", "equipment_notes"].map((field) => [field, text(parts.profile[field])])),
    },
    references: parts.references?.map((reference) => ({ ...reference, title: text(reference.title) })),
    samples: parts.samples.map((sample) => ({ ...sample, title: text(sample.title), caption: text(sample.caption) })),
  };
}
