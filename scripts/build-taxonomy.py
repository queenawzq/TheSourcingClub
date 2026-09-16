#!/usr/bin/env python3
"""Regenerate the taxonomy seed migration from supabase/seed/taxonomy.json.

The JSON is the source of truth for platform vocabularies — production types,
product categories, regions, certifications and so on — extracted from both
prototypes and reconciled where they disagreed.

Run from the repo root after editing the JSON:

    python3 scripts/build-taxonomy.py

Never hand-edit the generated migration; it is overwritten in place.
"""

import io
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEED = ROOT / "supabase" / "seed" / "taxonomy.json"
OUT = ROOT / "supabase" / "migrations" / "20260901000700_taxonomy_seed.sql"

# Kinds whose onboarding UI offers an "add your own" option. Only these accept
# org-scoped custom terms; see the insert policy in migration 002.
ALLOWS_CUSTOM = {
    "production_type",
    "product_category",
    "specialty",
    "service",
    "design_service",
    "make",
    "certification",
}

KIND_LABELS = {
    "production_type": "Production type",
    "product_category": "Product category",
    "market_level": "Market level",
    "region": "Region",
    "certification": "Certification",
    "service": "Service",
    "design_service": "Design service",
    "digital_tool": "Digital tool",
    "specialty": "Specialty",
    "make": "Makes",
    "price_point": "Price point",
    "lead_time_band": "Lead time",
    "capacity_category": "Capacity category",
    "brand_category": "Brand category",
    "annual_revenue_band": "Annual revenue",
    "pieces_per_year_band": "Pieces per year",
    "order_size_band": "Order size",
    "collections_per_year": "Collections per year",
    "reorder_cadence": "Reorder cadence",
    "sourcing_stage": "Sourcing stage",
    "client_trust_band": "Client trust",
    "timeline_band": "Timeline",
    "quantity_band": "Quantity",
    "trust_standard": "Club standard",
    "booking_level": "Booking level",
}

HEADER = """-- ============================================================================
-- 007  Taxonomy seed  (generated from supabase/seed/taxonomy.json)
-- ----------------------------------------------------------------------------
-- Canonical reference data, so this is a migration rather than a local seed:
-- it has to exist in production too. Regenerate with scripts/build-taxonomy.py
-- after editing the JSON; never hand-edit this file.
--
-- Extracted from both prototypes and reconciled. Conflicts resolved here are
-- recorded in the `conflicts` block of the source JSON — notably
-- "United States" vs "USA", three divergent certification lists, and three
-- spellings of the luxury market level.
-- ============================================================================

"""


def quote(value):
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def quote_array(values):
    if not values:
        return "'{}'"
    return "array[" + ", ".join(quote(v) for v in values) + "]"


def main():
    data = json.loads(SEED.read_text(encoding="utf-8"))
    out = io.StringIO()
    out.write(HEADER)

    for kind_block in data["kinds"]:
        kind = kind_block["kind"]
        label = KIND_LABELS.get(kind, kind)
        allows = str(kind in ALLOWS_CUSTOM).lower()
        out.write("insert into public.taxonomy_kinds (kind, label_en, allows_custom) values\n")
        out.write(f"  ({quote(kind)}, {quote(label)}, {allows})\n")
        out.write("on conflict (kind) do nothing;\n\n")

    out.write("\n-- ---------------------------------------------------------------------------\n")
    out.write("-- Terms\n")
    out.write("-- ---------------------------------------------------------------------------\n\n")

    total = 0
    for kind_block in data["kinds"]:
        kind = kind_block["kind"]
        if kind_block.get("note"):
            out.write(f"-- {kind}: {kind_block['note']}\n")
        out.write(
            "insert into public.taxonomy_terms "
            "(kind, slug, label_en, label_zh, sort, aliases, extra) values\n"
        )
        rows = []
        for term in kind_block["terms"]:
            total += 1
            extra = json.dumps(term.get("extra") or {}, ensure_ascii=False)
            rows.append(
                "  (%s, %s, %s, %s, %d, %s, %s::jsonb)"
                % (
                    quote(kind),
                    quote(term["slug"]),
                    quote(term["label_en"]),
                    quote(term.get("label_zh")),
                    term.get("sort", 0),
                    quote_array(term.get("aliases")),
                    quote(extra),
                )
            )
        out.write(",\n".join(rows))
        out.write("\non conflict (kind, slug) where org_id is null do nothing;\n\n")

    OUT.write_text(out.getvalue(), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(data['kinds'])} kinds, {total} terms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
