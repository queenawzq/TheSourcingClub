import { supabase, unwrap } from "../supabase.js";

export async function getContractAttachments(quoteId) {
  return unwrap(await supabase.rpc("get_contract_attachments", { target_quote: quoteId }), "load contract attachments");
}

export async function saveContractAttachments(quoteId, files) {
  return unwrap(await supabase.rpc("save_contract_attachments", {
    target_quote: quoteId,
    selected_documents: files.map((file) => file.id),
  }), "save contract attachments");
}
