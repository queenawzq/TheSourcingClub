/**
 * The message staff's approval pop-up starts with, per company type. Staff
 * edit it per company; an empty box sends the usual approval. It reaches the
 * company as typed: the approval email's "A note from our team" box and the
 * body of the "Your profile is verified" notification. Nothing translates it,
 * so a vendor's suggestion carries its own hand-written Chinese after the
 * English (a vendor may read the app in Chinese; a brand reads English).
 */
const BRAND = "Welcome, and congratulations on being approved. We're still adding factories to the marketplace, so you may see a smaller selection at first. If you don't find the right fit, just reply to this email with what you're making and we'll hand-pick factories for you.";

const FACTORY = [
  "Welcome, and congratulations on being approved. We're still bringing brands onto the marketplace, so requests may be few at first. A complete profile with clear photos, certifications and capacity will help brands find you as they join.",
  "欢迎加入，恭喜你通过审核！目前平台上的品牌还在陆续增加，刚开始收到的询价可能不多。建议把资料补充完整，比如清晰的产品照片、认证和产能信息，这样新加入的品牌就更容易找到你。",
].join("\n\n");

const TRADING = [
  "Welcome, and congratulations on being approved. We're still bringing brands onto the marketplace, so requests may be few at first. A complete profile showing your product range and partner factories will help brands find you as they join.",
  "欢迎加入，恭喜你通过审核！目前平台上的品牌还在陆续增加，刚开始收到的询价可能不多。建议把资料补充完整，比如产品范围和合作工厂的信息，这样新加入的品牌就更容易找到你。",
].join("\n\n");

/** @param entityType "Brand" | "Factory" | "Trading company" (the review page's words) */
export function suggestedApprovalMessage(entityType) {
  if (entityType === "Brand") return BRAND;
  if (entityType === "Trading company") return TRADING;
  return FACTORY;
}
