/**
 * Requests for quotes.
 *
 * Follows the per-step save pattern the onboarding flows established, with one
 * difference that shapes the whole module: an org has exactly one profile but
 * many RFQs, so a draft row has to exist before the first field is typed.
 * Losing a free-text brief to a closed tab is precisely what per-step saving
 * exists to prevent.
 */
import { supabase, unwrap } from "../supabase.js";

const RFQ_COLUMNS = `
  id, brand_org_id, title, brief, status, visibility,
  quantity_total, material_notes, sourcing_responsibility_term_id,
  target_delivery_month, requires_sample, sample_notes,
  target_unit_price_min_cents, target_unit_price_max_cents, currency,
  quote_deadline, additional_details,
  published_at, awarded_at, awarded_quote_id, created_at, updated_at
`;

export async function createDraftRfq(orgId) {
  return unwrap(
    await supabase
      .from("rfqs")
      // Visibility is set here rather than left to the column default: the
      // composer shows a choice, and the shown choice must be the stored one.
      // Open to all is the better default — more quotes, and verification
      // already gates who may actually bid.
      .insert({ brand_org_id: orgId, status: "draft", visibility: "open_to_all" })
      .select(RFQ_COLUMNS)
      .single(),
    "start a new request",
  );
}

export async function getRfq(rfqId) {
  return unwrap(
    await supabase.from("rfqs").select(RFQ_COLUMNS).eq("id", rfqId).maybeSingle(),
    "load the request",
  );
}

export async function saveRfq(rfqId, patch) {
  return unwrap(
    await supabase.from("rfqs").update(patch).eq("id", rfqId).select(RFQ_COLUMNS).single(),
    "save the request",
  );
}

/** A brand's own requests. RLS keeps this to the caller's org. */
export async function listRfqs(orgId) {
  return unwrap(
    await supabase
      .from("rfqs")
      // The embed must name the constraint: there are two foreign keys between
      // rfqs and quotes (quotes.rfq_id, and rfqs.awarded_quote_id pointing
      // back), so an unqualified `quotes(count)` is ambiguous and PostgREST
      // refuses it rather than guessing.
      .select(`${RFQ_COLUMNS}, quotes!quotes_rfq_id_fkey(count), rfq_invitations(count)`)
      .eq("brand_org_id", orgId)
      .order("created_at", { ascending: false }),
    "load your requests",
  );
}

/**
 * Open requests a factory may quote on.
 *
 * Returns everything the factory is allowed to see — the RLS policy already
 * decides that, so this deliberately does not re-implement the visibility rule
 * in JS where it could drift from the policy.
 */
export async function listOpenRfqs() {
  return unwrap(
    await supabase
      .from("rfqs")
      .select(`${RFQ_COLUMNS}, orgs!rfqs_brand_org_id_fkey (name)`)
      .eq("status", "open")
      .order("created_at", { ascending: false }),
    "load open requests",
  );
}

/**
 * Publishing is a separate act from saving the last step.
 *
 * Same reason completeOnboarding() is separate from saveBrandProfile(): "I
 * finished typing" and "send this to factories" are different intentions, and
 * conflating them means a half-written request goes out because someone
 * clicked Continue.
 */
export async function publishRfq(rfqId, visibility) {
  return saveRfq(rfqId, {
    status: "open",
    visibility,
    published_at: new Date().toISOString(),
  });
}

export async function cancelRfq(rfqId) {
  return saveRfq(rfqId, { status: "cancelled" });
}

// ---- Colour splits --------------------------------------------------------

export async function getColourSplits(rfqId) {
  return unwrap(
    await supabase
      .from("rfq_colour_splits")
      .select("id, colour, quantity, sort")
      .eq("rfq_id", rfqId)
      .order("sort"),
    "load the colour breakdown",
  );
}

/** Replace the whole breakdown; it is edited as one list, not row by row. */
export async function setColourSplits(rfqId, splits) {
  unwrap(
    await supabase.from("rfq_colour_splits").delete().eq("rfq_id", rfqId),
    "clear the colour breakdown",
  );

  const rows = splits
    .filter((split) => split.colour?.trim() && Number(split.quantity) > 0)
    .map((split, index) => ({
      rfq_id: rfqId,
      colour: split.colour.trim(),
      quantity: Number(split.quantity),
      sort: index,
    }));

  if (!rows.length) return [];

  return unwrap(
    await supabase.from("rfq_colour_splits").insert(rows).select(),
    "save the colour breakdown",
  );
}

/**
 * Scope an uploaded document to this request.
 *
 * documents key on org_id alone, so without this a brand with three open
 * requests would be offered every tech pack it has ever uploaded on all of
 * them.
 */
export async function attachDocumentToRfq(documentId, rfqId) {
  return unwrap(
    await supabase.from("documents").update({ rfq_id: rfqId }).eq("id", documentId).select().single(),
    "attach the file to this request",
  );
}

// ---- Questions ------------------------------------------------------------

export async function getQuestions(rfqId) {
  return unwrap(
    await supabase
      .from("rfq_questions")
      .select("id, prompt, is_sensitive, sort")
      .eq("rfq_id", rfqId)
      .order("sort"),
    "load your questions",
  );
}

export async function setQuestions(rfqId, questions) {
  unwrap(await supabase.from("rfq_questions").delete().eq("rfq_id", rfqId), "clear questions");

  const rows = questions
    .filter((question) => question.prompt?.trim())
    .map((question, index) => ({
      rfq_id: rfqId,
      prompt: question.prompt.trim(),
      is_sensitive: Boolean(question.is_sensitive),
      sort: index,
    }));

  if (!rows.length) return [];

  return unwrap(
    await supabase.from("rfq_questions").insert(rows).select(),
    "save your questions",
  );
}

// ---- Invitations ----------------------------------------------------------

export async function getInvitations(rfqId) {
  return unwrap(
    await supabase
      .from("rfq_invitations")
      .select("id, factory_org_id, status, created_at, orgs (name, slug)")
      .eq("rfq_id", rfqId),
    "load the invited factories",
  );
}

export async function setInvitations(rfqId, factoryOrgIds) {
  const existing = await getInvitations(rfqId);
  const current = existing.map((row) => row.factory_org_id);

  const toAdd = factoryOrgIds.filter((id) => !current.includes(id));
  const toRemove = existing.filter((row) => !factoryOrgIds.includes(row.factory_org_id));

  if (toRemove.length) {
    unwrap(
      await supabase
        .from("rfq_invitations")
        .delete()
        .in("id", toRemove.map((row) => row.id)),
      "withdraw an invitation",
    );
  }

  if (toAdd.length) {
    unwrap(
      await supabase
        .from("rfq_invitations")
        .insert(toAdd.map((id) => ({ rfq_id: rfqId, factory_org_id: id }))),
      "invite factories",
    );
  }
}

/**
 * What is still missing, computed rather than stored so it can never disagree
 * with the request itself. Mirrors brandProfileGaps().
 */
export function rfqGaps(rfq, selected, questions) {
  const has = (kind) => (selected?.[kind]?.length ?? 0) > 0;

  return [
    { key: "brief", label: "What you need made", done: Boolean(rfq?.brief?.trim()) },
    { key: "specifics", label: "Quantity and materials", done: Boolean(rfq?.quantity_total) },
    { key: "categories", label: "Product category", done: has("product_category") },
    { key: "timeline", label: "Timeline and price", done: Boolean(rfq?.target_delivery_month) },
    { key: "questions", label: "Questions for factories", done: (questions?.length ?? 0) > 0 },
  ];
}
