const MATCH_BANDS = [
  // The design system's tiers. Below 60 is not a fit, and says so.
  [90, "Strong fit", "strong"],
  [75, "Good fit", "good"],
  [60, "Potential fit", "warn"],
  [0, "Not a fit", "tradeoff"],
];

/** Present the database's RFQ-to-factory score using the existing TSC badges. */
export function matchFit(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const numericScore = Number(score);
  const [, label, tone] = MATCH_BANDS.find(([floor]) => numericScore >= floor) ?? MATCH_BANDS.at(-1);
  return { label, tone, score: numericScore };
}

/**
 * One sentence saying why a request fits this factory, from the factors that
 * fully match in match_score_rfq(): capacity in the delivery month, the
 * minimum order, production type and product category. Only facts both sides
 * entered are named; with none of them, a plain sentence.
 */
export function matchReason({ month, capacityLevel, moq, quantity, productionTypes = [], categories = [] }, language = "en") {
  const zh = language === "zh";
  const parts = [];
  if (month && capacityLevel === "open") {
    parts.push(zh
      ? `${month.toLocaleDateString("zh-CN", { month: "long" })}产能`
      : `${month.toLocaleDateString("en-US", { month: "long" })} capacity`);
  }
  if (moq != null && quantity != null && Number(moq) <= Number(quantity)) {
    parts.push(zh ? `${Number(moq).toLocaleString("zh-CN")} 件起订量` : `${Number(moq).toLocaleString("en-US")}-unit minimum order`);
  }
  if (productionTypes[0]) parts.push(zh ? `${productionTypes[0]}生产经验` : `${productionTypes[0].toLowerCase()} production`);
  if (categories[0]) parts.push(zh ? `${categories[0]}经验` : `${categories[0].toLowerCase()} experience`);

  if (!parts.length) return zh ? "您的资料与该需求匹配。" : "Your profile matches this request.";
  if (zh) {
    const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join("、")}和${parts.at(-1)}`;
    return `您的${list}与该需求匹配。`;
  }
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Your ${list} ${parts.length === 1 ? "matches" : "match"} this request.`;
}
