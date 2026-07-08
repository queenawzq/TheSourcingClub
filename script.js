const modal = document.querySelector('#waitlistModal');
const openButtons = document.querySelectorAll('.js-open-modal');
const closeButtons = document.querySelectorAll('.js-close-modal');
const langToggle = document.querySelector('[data-lang-toggle]');
const googleSheetsUrl = 'https://script.google.com/macros/s/AKfycbx9IDJRjpskLHrM2ry7nEiPxeXXyDUmlCswojA1p7nEheM5cXNtFwJIth1-N7DC2lRU/exec';
const motionTargets = document.querySelectorAll(
  '.stats div, .problem-title, .calculator, .issue-card, .how-copy, .steps article, .level-card, .standard-copy, .comparison-section h2, .comparison, .pricing-copy, .price-card, .faq-copy, .faq-grid article, .final-copy, .closing-people, .factory-hero-copy, .factory-hero-intro, .factory-section-copy, .factory-info-card, .rfq-panel, .translation-copy, .translation-panel, .translation-benefits article, .fit-grid article, .factory-meaning, .factory-cta-visual'
);

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const staggerGroups = [
  '.stats div',
  '.issue-card',
  '.steps article',
  '.level-card',
  '.price-card',
  '.faq-grid article',
  '.factory-info-card',
  '.translation-benefits article',
  '.fit-grid article'
];
const factoryTranslations = {
  en: {
    'nav.how': 'How it works',
    'nav.fit': 'Good fit',
    'nav.verification': 'Verification',
    'nav.brands': 'For Brands',
    'cta.apply': 'Apply to join',
    'hero.eyebrow': 'For factories',
    'hero.title1': 'Grow with',
    'hero.title2': 'Western',
    'hero.title3': 'brands ready',
    'hero.title4': 'to produce.',
    'hero.body': 'The Sourcing Club brings you qualified, production-ready orders from vetted US and European fashion brands. No bidding wars, no tire-kickers, no middlemen taking your margin.',
    'hero.tiny': '✧ Built for real factories that want serious buyers, clear specs, protected milestones, and long-term brand relationships.',
    'stats.one.value': '100%',
    'stats.one.label': 'buyer briefs structured',
    'stats.two.value': 'Protected',
    'stats.two.label': 'payments before production',
    'stats.three.value': 'Trusted',
    'stats.three.label': 'badge brands understand',
    'stats.four.value': 'Qualified',
    'stats.four.label': 'brands ready to produce',
    'partner.eyebrow': 'Why partner with us',
    'partner.title': 'More serious orders. Less wasted quoting.',
    'partner.body': 'Marketplaces reward the lowest quote. Agents hide the buyer. Cold emails waste your team’s time. The Club is built to make good factories easier for serious brands to find and trust.',
    'partner.card1.title': 'Real projects, not fishing expeditions',
    'partner.card1.body': 'Every request comes through a structured brief with product details, target quantity, materials, timeline, and references.',
    'partner.card2.title': 'Get paid, protected',
    'partner.card2.body': 'Brands fund the project before you cut a single panel. Payment is held and released at agreed milestones.',
    'partner.card3.title': 'A badge that wins orders',
    'partner.card3.body': 'Passing the Club Standard puts you apart from unverified suppliers and gives buyers a simple reason to trust you.',
    'rfq.eyebrow': 'How it works',
    'rfq.title': 'Quote requests with the details your team actually needs.',
    'rfq.body': 'Every project starts with a structured brief, so you know the product, quantity, timeline, and buyer context before deciding whether to quote.',
    'rfq.summary': 'RFQ Summary',
    'rfq.panelTitle': 'Structured brand brief',
    'rfq.item1': 'Product type: cut & sew set',
    'rfq.item2': 'Target units: 240 per style',
    'rfq.item3': 'Sample budget: approved',
    'rfq.item4': 'Tech pack: partial, references attached',
    'rfq.item5': 'Decision owner: founder',
    'rfq.ready': 'ready',
    'translation.eyebrow': 'Built-in translation',
    'translation.title': 'Speak with brands in your own language.',
    'translation.body': 'Factories can write profiles, quote notes, and chat in the language your team already uses. The platform translates messages for brands, so clarity does not depend on perfect English.',
    'translation.pill': 'Native-language factory workflow + translated brand chat',
    'translation.panelTitle': 'Chat/translate',
    'translation.factoryLabel': 'Factory message',
    'translation.nativeMessage': '我们可以支持 300 件起订，并在 21 天内完成样衣。',
    'translation.brandLabel': 'Automatically translated for the brand',
    'translation.translatedMessage': 'We can support a 300-unit MOQ and complete the sample within 21 days.',
    'translation.card1.title': 'Use your native language',
    'translation.card1.body': 'Factories do not need perfect English to present capability clearly.',
    'translation.card2.title': 'Chat without translation gaps',
    'translation.card2.body': 'Messages are translated in-platform while both sides keep context.',
    'translation.card3.title': 'Quote with less confusion',
    'translation.card3.body': 'MOQ, timeline, sample notes, and risk questions stay understandable.',
    'verification.level1': 'Level 1',
    'verification.basic': 'Basic',
    'verification.basicBody': 'Business license confirmed against the official government registry.',
    'verification.license': 'License',
    'verification.level2': 'Level 2',
    'verification.verified': 'Verified',
    'verification.verifiedBody': 'Live factory-floor walkthrough plus export records confirming what you produce and ship.',
    'verification.video': 'Video + records',
    'verification.level3': 'Level 3',
    'verification.trusted': 'Trusted',
    'verification.trustedBody': 'Buyer references checked, completed Club orders, on-time delivery, and visible quality history.',
    'verification.performance': 'Earned performance',
    'verification.eyebrow': 'Trust signal for buyers',
    'verification.title': 'Verification becomes a sales advantage.',
    'verification.body': 'Brands are nervous because online supplier listings all look the same. The Club Standard gives your factory a visible trust layer.',
    'verification.note': 'The Club Standard publishes exactly what each level takes, and every quote wears its level openly.',
    'verification.strip': 'A stronger profile means fewer cold negotiations and more brands who already understand why your factory is worth choosing.',
    'join.eyebrow': 'How to join',
    'join.title': 'Apply once. Quote only projects that fit.',
    'join.step1.title': 'Apply',
    'join.step1.body': 'Submit factory details, capabilities, production categories, region, and contact language.',
    'join.step2.title': 'Verification review',
    'join.step2.body': 'We review license documents, complete a live facility walkthrough, and check references.',
    'join.step3.title': 'Onboarding',
    'join.step3.body': 'Your profile, categories, MOQ, lead times, and Club Standard level are published for vetted brands.',
    'join.step4.title': 'Quote matched projects',
    'join.step4.body': 'Receive projects that fit your capability and quote directly with clear payment milestones.',
    'fit.eyebrow': 'Good fit',
    'fit.title': 'Factories built for serious brand work.',
    'fit.body': 'The Club works best for factories that can communicate clearly, show real production capability, and protect buyer designs.',
    'fit.card1.title': 'Registered manufacturing business',
    'fit.card1.body': 'Legal operating documents can be verified against official records.',
    'fit.card2.title': 'Real production capability',
    'fit.card2.body': 'You own the production floor or clearly disclose the facility network you use.',
    'fit.card3.title': 'Ready for transparent verification',
    'fit.card3.body': 'You are comfortable with a live walkthrough and reference checks.',
    'fit.card4.title': 'Small-run friendly',
    'fit.card4.body': 'You can support emerging brands, sample orders, or runs under 500 when the fit is right.',
    'fit.card5.title': 'Clear production communication',
    'fit.card5.body': 'MOQ, lead time, sampling cost, payment terms, and risks are communicated early.',
    'fit.card6.title': 'Buyer designs stay protected',
    'fit.card6.body': 'You agree to Club project rules, NDA expectations, and approval-sharing only.',
    'fit.meaning.title': 'What this means for factories',
    'fit.meaning.one': 'No margin taken',
    'fit.meaning.two': 'Quote by fit',
    'fit.meaning.three': 'Identity visible',
    'final.title': 'Ready for better-fit brand orders?',
    'modal.leftEyebrow': 'Factory partner<br />application',
    'modal.leftTitle': 'Bring better-fit brand orders to your line.',
    'modal.leftBody': 'Apply to join the Club network and get access to structured quote requests from production-ready fashion brands.',
    'modal.close': 'Close application form',
    'modal.title': 'Apply to join as a factory',
    'modal.body': 'Leave your contact details now. When onboarding opens, we will guide you through factory verification, capability review, and the Club Standard process.',
    'modal.nameLabel': 'Contact name',
    'modal.namePlaceholder': 'Your name',
    'modal.emailLabel': 'Work email',
    'modal.emailPlaceholder': 'you@factory.com',
    'modal.companyLabel': 'Factory / company name',
    'modal.companyPlaceholder': 'Company name',
    'modal.regionLabel': 'Country / region',
    'modal.regionPlaceholder': 'China, Portugal, India...',
    'modal.categoryLabel': 'Main product category',
    'modal.categoryPlaceholder': 'Knitwear, denim, cut & sew...',
    'modal.note': 'We will only contact you about factory onboarding and relevant Club opportunities.',
    'form.submitted': 'You are on the list'
  },
  zh: {
    'nav.how': '合作流程',
    'nav.fit': '适合对象',
    'nav.verification': '认证标准',
    'nav.brands': '品牌页面',
    'cta.apply': '申请加入',
    'hero.eyebrow': '工厂合作',
    'hero.title1': '对接',
    'hero.title2': '欧美',
    'hero.title3': '已准备投产',
    'hero.title4': '的品牌订单。',
    'hero.body': 'The Sourcing Club 为你带来经过筛选、已具备生产条件的美国和欧洲时尚品牌订单。没有竞价大战，没有无效询盘，也没有中间商压缩你的利润。',
    'hero.tiny': '✧ 为真正想服务严肃买家、清晰规格、受保护里程碑和长期品牌关系的工厂而建。',
    'stats.one.value': '100%',
    'stats.one.label': '买家需求结构化',
    'stats.two.value': '有保障',
    'stats.two.label': '生产前确认付款',
    'stats.three.value': '可信任',
    'stats.three.label': '品牌看得懂的认证',
    'stats.four.value': '高匹配',
    'stats.four.label': '准备投产的品牌',
    'partner.eyebrow': '为什么合作',
    'partner.title': '更严肃的订单。更少无效报价。',
    'partner.body': '传统平台奖励最低报价，代理隐藏买家，冷邮件浪费团队时间。The Club 让优质工厂更容易被严肃品牌找到并信任。',
    'partner.card1.title': '真实项目，不是试探性询盘',
    'partner.card1.body': '每个需求都包含结构化简报：产品细节、目标数量、材料、时间线和参考资料。',
    'partner.card2.title': '先有保障，再生产',
    'partner.card2.body': '品牌在你裁第一片布之前先为项目付款。款项按约定节点托管并释放。',
    'partner.card3.title': '帮助赢得订单的认证',
    'partner.card3.body': '通过 Club Standard 后，你会从未验证供应商中脱颖而出，给买家一个清晰的信任理由。',
    'rfq.eyebrow': '合作流程',
    'rfq.title': '报价需求包含团队真正需要的细节。',
    'rfq.body': '每个项目都从结构化简报开始，让你在决定是否报价前了解产品、数量、时间线和买家背景。',
    'rfq.summary': 'RFQ 摘要',
    'rfq.panelTitle': '结构化品牌简报',
    'rfq.item1': '产品类型：梭织套装',
    'rfq.item2': '目标数量：每款 240 件',
    'rfq.item3': '样衣预算：已确认',
    'rfq.item4': '技术包：部分完成，参考资料已附',
    'rfq.item5': '决策人：创始人',
    'rfq.ready': '就绪',
    'translation.eyebrow': '内置翻译',
    'translation.title': '用你的母语与品牌沟通。',
    'translation.body': '工厂可以用团队已经习惯的语言填写资料、备注报价并与品牌聊天。平台会为品牌翻译信息，让清晰沟通不依赖完美英文。',
    'translation.pill': '母语工厂流程 + 已翻译的品牌聊天',
    'translation.panelTitle': '聊天 / 翻译',
    'translation.factoryLabel': '工厂消息',
    'translation.nativeMessage': '我们可以支持 300 件起订，并在 21 天内完成样衣。',
    'translation.brandLabel': '自动翻译给品牌',
    'translation.translatedMessage': 'We can support a 300-unit MOQ and complete the sample within 21 days.',
    'translation.card1.title': '使用你的母语',
    'translation.card1.body': '工厂不需要完美英文，也能清楚展示自己的生产能力。',
    'translation.card2.title': '聊天减少翻译断层',
    'translation.card2.body': '消息在平台内翻译，双方都能保留上下文。',
    'translation.card3.title': '报价沟通更少误解',
    'translation.card3.body': 'MOQ、时间线、样衣备注和风险问题都更容易理解。',
    'verification.level1': '等级 1',
    'verification.basic': '基础',
    'verification.basicBody': '营业执照已与官方政府登记信息核验。',
    'verification.license': '执照',
    'verification.level2': '等级 2',
    'verification.verified': '已验证',
    'verification.verifiedBody': '完成工厂现场视频走访，并用出口记录确认生产与出货能力。',
    'verification.video': '视频 + 记录',
    'verification.level3': '等级 3',
    'verification.trusted': '可信赖',
    'verification.trustedBody': '买家推荐、已完成 Club 订单、准时交付和可见质量记录均已核查。',
    'verification.performance': '履约表现',
    'verification.eyebrow': '给买家的信任信号',
    'verification.title': '认证会成为销售优势。',
    'verification.body': '品牌担心线上供应商看起来都一样。Club Standard 为你的工厂提供清晰可见的信任层。',
    'verification.note': 'Club Standard 会公开每个等级的要求，每一份报价都会展示对应等级。',
    'verification.strip': '更强的工厂资料意味着更少冷启动谈判，也让更多品牌提前理解你的工厂为什么值得选择。',
    'join.eyebrow': '如何加入',
    'join.title': '申请一次。只报价真正匹配的项目。',
    'join.step1.title': '申请',
    'join.step1.body': '提交工厂信息、能力、生产品类、地区和沟通语言。',
    'join.step2.title': '认证审核',
    'join.step2.body': '我们会审核执照文件，完成现场视频走访，并核查参考信息。',
    'join.step3.title': '入驻',
    'join.step3.body': '你的资料、品类、MOQ、交期和 Club Standard 等级会展示给已审核品牌。',
    'join.step4.title': '匹配项目报价',
    'join.step4.body': '收到与你能力匹配的项目，并基于清晰付款节点直接报价。',
    'fit.eyebrow': '适合对象',
    'fit.title': '为严肃品牌业务准备好的工厂。',
    'fit.body': 'The Club 最适合能够清晰沟通、展示真实生产能力并保护买家设计的工厂。',
    'fit.card1.title': '正规制造企业',
    'fit.card1.body': '合法经营文件可与官方记录核验。',
    'fit.card2.title': '真实生产能力',
    'fit.card2.body': '你拥有生产车间，或清楚披露所使用的工厂网络。',
    'fit.card3.title': '愿意透明认证',
    'fit.card3.body': '你愿意配合现场视频走访和参考信息核查。',
    'fit.card4.title': '适合小批量',
    'fit.card4.body': '在项目匹配时，你可以支持新兴品牌、样衣订单或 500 件以下批量。',
    'fit.card5.title': '清晰生产沟通',
    'fit.card5.body': 'MOQ、交期、打样成本、付款条款和风险都会提前沟通。',
    'fit.card6.title': '保护买家设计',
    'fit.card6.body': '你同意 Club 项目规则、NDA 要求和仅经批准的分享方式。',
    'fit.meaning.title': '这对工厂意味着什么',
    'fit.meaning.one': '不抽取差价',
    'fit.meaning.two': '按匹配度报价',
    'fit.meaning.three': '身份可见',
    'final.title': '准备好获得更匹配的品牌订单了吗？',
    'modal.leftEyebrow': '工厂合作<br />申请',
    'modal.leftTitle': '把更匹配的品牌订单带到你的产线。',
    'modal.leftBody': '申请加入 Club 工厂网络，获取来自已准备投产品牌的结构化报价需求。',
    'modal.close': '关闭申请表',
    'modal.title': '申请以工厂身份加入',
    'modal.body': '现在留下联系方式。开放入驻后，我们会引导你完成工厂认证、能力审核和 Club Standard 流程。',
    'modal.nameLabel': '联系人姓名',
    'modal.namePlaceholder': '你的姓名',
    'modal.emailLabel': '工作邮箱',
    'modal.emailPlaceholder': 'you@factory.com',
    'modal.companyLabel': '工厂 / 公司名称',
    'modal.companyPlaceholder': '公司名称',
    'modal.regionLabel': '国家 / 地区',
    'modal.regionPlaceholder': '中国、葡萄牙、印度...',
    'modal.categoryLabel': '主要产品品类',
    'modal.categoryPlaceholder': '针织、牛仔、梭织...',
    'modal.note': '我们只会就工厂入驻和相关 Club 机会与你联系。',
    'form.submitted': '已加入名单'
  }
};
let currentLang = localStorage.getItem('factoryLang') || 'en';

document.body.classList.add('motion-ready');

function translate(key) {
  return factoryTranslations[currentLang]?.[key] || factoryTranslations.en[key] || '';
}

function applyFactoryLanguage(lang) {
  if (!factoryTranslations[lang]) return;
  currentLang = lang;
  localStorage.setItem('factoryLang', lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en';
  document.body.classList.toggle('lang-zh', lang === 'zh');

  document.querySelectorAll('[data-i18n]').forEach((node) => {
    if (node.matches('button[type="submit"]:disabled')) {
      node.innerHTML = translate('form.submitted');
      return;
    }
    node.innerHTML = translate(node.dataset.i18n);
  });

  document.querySelectorAll('[data-i18n-attr]').forEach((node) => {
    node.dataset.i18nAttr.split(',').forEach((pair) => {
      const [attribute, key] = pair.split(':').map((part) => part.trim());
      if (attribute && key) node.setAttribute(attribute, translate(key));
    });
  });

  if (langToggle) {
    langToggle.classList.toggle('is-active', lang === 'zh');
    langToggle.setAttribute('aria-pressed', String(lang === 'zh'));
    langToggle.setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切换到中文');
  }
}

if (langToggle) {
  applyFactoryLanguage(currentLang);
  langToggle.addEventListener('click', () => {
    applyFactoryLanguage(currentLang === 'zh' ? 'en' : 'zh');
  });
}

motionTargets.forEach((target) => {
  target.classList.add('reveal');
  target.style.setProperty('--reveal-delay', '0ms');
});

staggerGroups.forEach((selector) => {
  document.querySelectorAll(selector).forEach((target, index) => {
    target.style.setProperty('--reveal-delay', `${Math.min(index, 3) * 80}ms`);
  });
});

if (prefersReducedMotion) {
  motionTargets.forEach((target) => target.classList.add('is-visible'));
} else if ('IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.14 }
  );

  motionTargets.forEach((target) => revealObserver.observe(target));
} else {
  motionTargets.forEach((target) => target.classList.add('is-visible'));
}

function openModal() {
  modal?.classList.add('is-open');
  modal?.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  modal?.querySelector('input')?.focus();
}

function closeModal() {
  modal?.classList.remove('is-open');
  modal?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

openButtons.forEach((button) => button.addEventListener('click', openModal));
closeButtons.forEach((button) => button.addEventListener('click', closeModal));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

document.querySelectorAll('.faq-question').forEach((button) => {
  button.addEventListener('click', () => {
    const item = button.closest('.faq-item');
    const isOpen = item?.classList.toggle('is-open');
    const marker = button.querySelector('.faq-marker');

    button.setAttribute('aria-expanded', String(Boolean(isOpen)));
    if (marker) marker.textContent = isOpen ? '-' : '+';
  });
});

document.querySelectorAll('[data-signup-form]').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const originalText = submit?.textContent || '';

    if (!googleSheetsUrl) {
      if (submit) submit.textContent = 'Add Google Sheets URL';
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Sending...';
    }

    const formData = new FormData(form);
    formData.append('source', form.dataset.source || 'signup');
    formData.append('page', window.location.pathname);
    formData.append('submittedAt', new Date().toISOString());

    try {
      await fetch(googleSheetsUrl, {
        method: 'POST',
        body: formData,
        mode: 'no-cors'
      });

      form.reset();
      if (submit) submit.textContent = langToggle ? translate('form.submitted') : 'You are on the list';
    } catch (error) {
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    }
  });
});
