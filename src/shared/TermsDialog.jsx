import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./terms-dialog.css";

const SHARED_EN = [
  ["Acceptance of Terms", "These Terms and Conditions govern your access to and use of The Sourcing Club marketplace. By creating an account, signing electronically, or continuing to use the platform, you agree to these terms and confirm that you are authorized to act for the company connected to your account."],
  ["Account Eligibility and Authority", "You must provide complete and accurate registration information, maintain a valid business identity, and ensure that every person using the account has appropriate authority. You are responsible for account credentials and all activity completed through your account."],
  ["Profile and Verification Information", "You must keep company, contact, verification, and operational information current. The Sourcing Club may request supporting evidence, review submitted information, and identify whether verification is complete, pending, or requires additional review."],
  ["Marketplace Communications and Transactions", "Users must communicate professionally and provide commercially accurate information. Requests, quotes, specifications, samples, production orders, approvals, and other marketplace records may form part of agreements between participating businesses. Each party is responsible for reviewing and accepting its own commercial obligations."],
  ["Fees, Credits, and Payments", "Applicable platform fees, quotation credits, payment schedules, deposits, and transaction charges will be shown before confirmation. Users are responsible for authorized charges, accurate billing information, and any taxes or duties that apply to their activity."],
  ["Prohibited Conduct", "You may not submit false or misleading information, misuse confidential materials, infringe intellectual property rights, circumvent platform safeguards, interfere with marketplace operation, or use the service for unlawful, abusive, or fraudulent activity."],
  ["Suspension and Termination", "The Sourcing Club may restrict, suspend, or terminate access when these terms are breached, required verification is not completed, marketplace activity creates material risk, or continued access could harm users or the platform. Where appropriate, users may be given notice and an opportunity to correct the issue."],
  ["Platform Role and Disclaimers", "The Sourcing Club provides marketplace, communication, verification-support, and workflow tools. Unless expressly stated otherwise, it is not a party to manufacturing, sourcing, supply, shipping, or payment agreements between users and does not guarantee commercial performance or product outcomes."],
  ["Limitation of Liability", "To the fullest extent permitted by applicable law, The Sourcing Club will not be liable for indirect, incidental, special, or consequential losses arising from marketplace transactions, third-party conduct, production delays, or reliance on user-submitted information."],
  ["Changes to These Terms", "The Sourcing Club may update these terms to reflect legal, operational, or product changes. The effective date will be updated when a revised version is published, and material changes may require renewed acceptance."],
  ["Contact", "Questions about these terms may be directed to The Sourcing Club operations team through the support channels provided in your account."],
];

const ACCOUNT_EN = {
  brand: [
    ["Platform Usage", "Use The Sourcing Club to create accurate sourcing briefs, discover and communicate with vendors, compare quotes, manage approvals, and coordinate legitimate sourcing opportunities."],
    ["Data Privacy and Confidentiality", "Only upload documents and media you are authorized to share. Vendor profiles, quotes, private messages, samples, technical files, pricing, and project details must be kept confidential unless the relevant parties agree otherwise."],
    ["Brand Responsibilities", "Provide accurate product specifications, quantities, target dates, approval feedback, and payment information. Awards, approvals, and production commitments must reflect decisions your company is authorized and prepared to honour."],
  ],
  factory: [
    ["Platform Usage", "Use The Sourcing Club to share accurate factory or trading-company information, respond to brand enquiries professionally, submit quotes, and communicate about legitimate sourcing opportunities."],
    ["Data Privacy and Confidentiality", "Only upload documents and media you are authorized to share. Brand enquiries, tech packs, product designs, pricing, private messages, and project details must be kept confidential unless the relevant parties agree otherwise."],
    ["Vendor Responsibilities", "Keep your profile, capacity, certifications, contacts, quotes, lead times, quality requirements, and production commitments accurate and current. Only accept work your business can realistically deliver."],
  ],
};

const FACTORY_ZH = [
  ["接受条款", "本条款与条件适用于您访问及使用 The Sourcing Club 平台。创建账户、进行电子签名或继续使用平台，即表示您同意本条款，并确认您有权代表与账户关联的公司行事。"],
  ["账户资格与授权", "您必须提供完整、准确的注册信息，维持有效的企业身份，并确保每位账户使用者均获得适当授权。您须对账户凭证及通过账户完成的所有活动负责。"],
  ["平台使用", "请使用 The Sourcing Club 准确展示工厂或贸易公司的信息，专业回复品牌询盘、提交报价，并就真实的采购机会进行沟通。"],
  ["资料与验证信息", "您必须及时更新公司、联系人、验证及运营信息。The Sourcing Club 可要求提供证明材料、审核已提交的信息，并标明验证状态为已完成、处理中或需要进一步审核。"],
  ["数据隐私与保密", "仅上传您获准分享的文件和媒体。除非相关各方另有约定，品牌询盘、技术包、产品设计、定价、私人消息及项目详情均须保密。"],
  ["供应商责任", "请确保您的资料、产能、认证、联系人、报价、交期、质量要求及生产承诺准确且最新。仅接受您的企业能够切实交付的工作。"],
  ["平台沟通与交易", "用户须进行专业沟通并提供准确的商业信息。需求、报价、规格、样品、生产订单、审批及其他平台记录可能构成参与企业之间协议的一部分。各方须自行审阅并接受其商业义务。"],
  ["费用、额度与付款", "适用的平台费用、报价额度、付款计划、定金及交易费用会在确认前显示。用户须对已授权费用、准确的账单信息以及适用的税费或关税负责。"],
  ["禁止行为", "您不得提交虚假或误导性信息、滥用保密材料、侵犯知识产权、规避平台保障措施、干扰平台运行，或将服务用于违法、滥用或欺诈活动。"],
  ["暂停与终止", "如违反本条款、未完成必要验证、平台活动造成重大风险，或继续访问可能损害用户或平台，The Sourcing Club 可限制、暂停或终止访问。在适当情况下，用户可能会收到通知并有机会纠正问题。"],
  ["平台角色与免责声明", "The Sourcing Club 提供撮合、沟通、验证支持及工作流程工具。除非明确说明，平台并非用户之间制造、采购、供货、运输或付款协议的当事方，也不保证商业履约或产品结果。"],
  ["责任限制", "在适用法律允许的最大范围内，The Sourcing Club 不对因平台交易、第三方行为、生产延误或依赖用户提交信息而产生的间接、附带、特殊或后果性损失承担责任。"],
  ["条款变更", "The Sourcing Club 可为反映法律、运营或产品变化而更新本条款。发布修订版本时将更新生效日期，重大变更可能要求您重新确认同意。"],
  ["联系我们", "如对本条款有疑问，请通过账户中提供的支持渠道联系 The Sourcing Club 运营团队。"],
];

function sectionsFor(accountType, language) {
  if (language === "zh" && accountType === "factory") return FACTORY_ZH;
  const [usage, confidentiality, responsibilities] = ACCOUNT_EN[accountType] ?? ACCOUNT_EN.brand;
  return [SHARED_EN[0], SHARED_EN[1], usage, SHARED_EN[2], confidentiality, responsibilities, ...SHARED_EN.slice(3)];
}

export function TermsDialog({ accountType = "brand", language = "en", onClose }) {
  const closeRef = useRef(null);
  const isChinese = language === "zh";

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const title = isChinese ? "条款与条件" : "Terms & Conditions";
  const accountLabel = accountType === "factory"
    ? (isChinese ? "供应商协议" : "Vendor agreement")
    : "Brand agreement";

  return createPortal(
    <div className="terms-dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="terms-dialog" role="dialog" aria-modal="true" aria-labelledby="terms-dialog-title">
        <button ref={closeRef} className="terms-dialog-close" type="button" aria-label={isChinese ? "关闭条款" : "Close terms"} onClick={onClose}>
          <img src="/assets/prototype-icons/close.svg" alt="" />
        </button>
        <header>
          <span>{accountLabel}</span>
          <h2 id="terms-dialog-title">{title}</h2>
          <p>{isChinese ? "生效日期：2026 年 9 月 18 日" : "Effective September 18, 2026"}</p>
        </header>
        <div className="terms-dialog-body">
          {sectionsFor(accountType, language).map(([heading, copy], index) => (
            <section key={heading}>
              <h3>{index + 1}. {heading}</h3>
              <p>{copy}</p>
            </section>
          ))}
        </div>
        <footer>
          <button className="terms-dialog-done" type="button" onClick={onClose}>{isChinese ? "完成" : "Done"}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
