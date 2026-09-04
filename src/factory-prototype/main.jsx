import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { ProfileCardHeader, ProfileChipSection, ProfileCompletionSummaryRow, ProfileDetailPair, ProfileOwnerBar, ProfilePerformanceCard, ProjectCardActions, PrototypeSideNav } from "../shared/ProfileShell.jsx";
import "../prototype/styles.css";
import "./styles.css";
import "../shared/profile-shell.css";
import "../shared/production-order-cards.css";

const factorySamplePhotos = [
  "https://images.pexels.com/photos/7752674/pexels-photo-7752674.jpeg?auto=compress&dpr=1&w=600",
  "https://images.pexels.com/photos/7752585/pexels-photo-7752585.jpeg?auto=compress&dpr=1&w=600",
  "https://images.pexels.com/photos/7505060/pexels-photo-7505060.jpeg?auto=compress&dpr=1&w=600"
];

const dashboardRfqPhotos = {
  MR: { src: "/assets/dashboard-rfq-shirt.jpg", position: "50% 35%" },
  ES: { src: "/assets/dashboard-rfq-knit.jpg", position: "52% 45%" },
  NL: { src: "/assets/dashboard-rfq-denim.jpg", position: "50% 42%" }
};

const dashboardOrderPhotos = {
  MR: { src: "/assets/dashboard-rfq-shirt.jpg", position: "50% 35%" },
  LR: { src: "/assets/dashboard-rfq-knit.jpg", position: "52% 45%" }
};

const brandProjects = [
  {
    initials: "MR",
    title: "Organic cotton woven shirt production",
    brand: "Maison Rue",
    location: "New York, USA",
    posted: "Posted 18 minutes ago",
    match: "94%",
    quoteDue: "Jul 24",
    budget: "$18-$24",
    quantity: "300 units",
    samples: "Fit + PP",
    specialty:
      "Women's woven shirts in organic cotton poplin: 3 colors, 100 units per color. Brand needs fit sample and PP sample before bulk approval.",
    tags: ["Cut & sew", "GOTS preferred", "3 colors", "China / Portugal / Korea"],
    capacity: ["Strong fit", "August capacity works"],
    images: [
      { label: "Poplin shirt reference", src: "https://images.pexels.com/photos/7752674/pexels-photo-7752674.jpeg?auto=compress&dpr=1&w=900" },
      { label: "Material direction", src: "https://images.pexels.com/photos/6461392/pexels-photo-6461392.jpeg?auto=compress&dpr=1&w=900" },
      { label: "Fit detail", src: "https://images.pexels.com/photos/7760024/pexels-photo-7760024.jpeg?auto=compress&dpr=1&w=900" }
    ],
    fitTone: "strong",
    trust: "$5k+ spent",
    insight: [
      "Client payment verified with $5k+ spent through the Club.",
      "Best match for your woven shirt capacity and sample-first workflow."
    ],
    featured: true
  },
  {
    initials: "ES",
    title: "Premium knit capsule for resort drop",
    brand: "Elara Studio",
    location: "Los Angeles, USA",
    posted: "Posted yesterday",
    match: "87%",
    quoteDue: "Jul 26",
    budget: "$40-$55",
    quantity: "180 units",
    samples: "Fit + size set",
    specialty:
      "Fine-gauge merino blend tops and cardigans for a small resort capsule. Looking for visible sample-room support and yarn sourcing.",
    tags: ["Knitwear", "OEKO-TEX", "Yarn sourcing", "China / Portugal / Korea"],
    capacity: ["Good fit", "Premium knit experience"],
    images: [
      { label: "Cardigan reference", src: "https://images.pexels.com/photos/9603624/pexels-photo-9603624.jpeg?auto=compress&dpr=1&w=900" }
    ],
    fitTone: "good",
    trust: "$25k+ spent",
    insight: [
      "Client payment verified with $25k+ spent through the Club.",
      "Strong opportunity if your sample room can support yarn decisions."
    ]
  },
  {
    initials: "NL",
    title: "Denim jacket wash development and small bulk",
    brand: "Northline",
    location: "Toronto, Canada",
    posted: "Posted 2 days ago",
    match: "76%",
    quoteDue: "Jul 29",
    budget: "$28-$36",
    quantity: "500 units",
    samples: "Wash sample",
    specialty:
      "Rigid denim jacket with two washes. Brand needs wash-down samples, trim confirmation, and split delivery for first retail test.",
    tags: ["Denim", "Middle $18-$40", "Yarn sourcing", "Wash development"],
    capacity: ["Potential fit", "Check wash capacity"],
    images: [
      { label: "Denim jacket reference", src: "https://images.pexels.com/photos/28174872/pexels-photo-28174872.jpeg?auto=compress&dpr=1&w=900" }
    ],
    fitTone: "warn",
    trust: "$5k+ spent",
    insight: [
      "Client payment verified with $5k+ spent through the Club.",
      "Quote only if wash development bandwidth is open this month."
    ]
  }
];

const factoryMessageThreads = [
  {
    id: "maison-rue",
    name: "Maison Rue",
    primaryContact: "Ari Chen",
    initials: "MR",
    location: "New York, USA",
    status: "Online",
    localTime: "4:18 PM local time",
    project: "Organic cotton woven shirt production",
    kind: "Production order",
    lastDate: "12 min",
    lastPreview: "Can you split fit and PP sample cost?",
    unread: 1,
    scheduleNote: "Your time: Porto time - Maison Rue: ET",
    scheduleSlots: [
      { factory: "Tue 3:00 PM Porto", brand: "Maison Rue: Tue 10:00 AM ET" },
      { factory: "Tue 5:30 PM Porto", brand: "Maison Rue: Tue 12:30 PM ET" },
      { factory: "Wed 2:30 PM Porto", brand: "Maison Rue: Wed 9:30 AM ET" }
    ],
    files: ["Tech pack v3.pdf", "Measurement chart", "Reference photos"],
    messages: [
      {
        from: "brand",
        time: "9:48 AM",
        body: "Can you split fit and PP sample cost in the quote? We want to approve the first fit sample before locking PP timing."
      },
      {
        from: "factory",
        time: "10:12 AM",
        body: "Yes. We can separate fit sample, PP sample, and bulk unit pricing. I will update the assumptions in the quote."
      },
      {
        from: "factory",
        time: "10:18 AM",
        language: "pt",
        original: "Podemos enviar fotos de controle de qualidade antes do saldo final.",
        translation: "We can send quality control photos before the final balance."
      }
    ]
  },
  {
    id: "elara-studio",
    name: "Elara Studio",
    primaryContact: "Maya Hart",
    initials: "ES",
    location: "Los Angeles, USA",
    status: "Away",
    localTime: "1:18 PM local time",
    project: "Premium knit capsule for resort drop",
    kind: "RFQ",
    lastDate: "1 hr",
    lastPreview: "Uploaded updated colorway sheet.",
    unread: 0,
    scheduleNote: "Your time: Porto time - Elara Studio: PT",
    scheduleSlots: [
      { factory: "Wed 5:00 PM Porto", brand: "Elara Studio: Wed 9:00 AM PT" },
      { factory: "Thu 6:30 PM Porto", brand: "Elara Studio: Thu 10:30 AM PT" },
      { factory: "Fri 4:00 PM Porto", brand: "Elara Studio: Fri 8:00 AM PT" }
    ],
    files: ["Colorway sheet", "Yarn card"],
    messages: [
      {
        from: "brand",
        time: "Yesterday",
        body: "We uploaded the updated colorway sheet. Please quote the lab dip review as a separate line."
      },
      {
        from: "factory",
        time: "Today",
        body: "Received. We can quote yarn sourcing and lab dip review separately."
      }
    ]
  },
  {
    id: "northline",
    name: "Northline",
    primaryContact: "Jon Bell",
    initials: "NL",
    location: "Toronto, Canada",
    status: "Online",
    localTime: "4:18 PM local time",
    project: "Denim jacket wash development and small bulk",
    kind: "Saved RFQ",
    lastDate: "Today",
    lastPreview: "Can you confirm wash sample lead time?",
    unread: 0,
    scheduleNote: "Your time: Porto time - Northline: ET",
    scheduleSlots: [
      { factory: "Tue 7:00 PM Porto", brand: "Northline: Tue 2:00 PM ET" },
      { factory: "Wed 4:00 PM Porto", brand: "Northline: Wed 11:00 AM ET" },
      { factory: "Thu 5:30 PM Porto", brand: "Northline: Thu 12:30 PM ET" }
    ],
    files: ["Wash direction", "Trim notes"],
    messages: [
      {
        from: "brand",
        time: "Today",
        body: "Can you confirm wash sample lead time before we invite the full denim RFQ group?"
      }
    ]
  }
];

const nav = [
  { label: "Dashboard", icon: "home" },
  { label: "RFQs", icon: "rfq" },
  { label: "Production orders", icon: "projects" },
  { label: "Browse RFQs", icon: "explore" },
  { label: "Conversations", icon: "messages" },
  { label: "Saved", icon: "bookmarks" },
  { label: "Payments", icon: "billing" },
  { label: "Settings", icon: "settings" }
];

const factoryMainZhText = {
  "Dashboard": "控制台",
  "Production orders": "生产订单",
  "Browse RFQs": "浏览询价",
  "Connections": "联系人",
  "Conversations": "对话",
  "Saved": "收藏",
  "Settings": "设置",
  "Notifications": "通知",
  "Factory account": "工厂账号",
  "Expand sidebar": "展开侧边栏",
  "Collapse sidebar": "收起侧边栏",
  "Factory dashboard": "工厂控制台",
  "Quotes, funded work, approvals, and brand messages in one operational view.": "报价、已付款项目、审批和品牌消息都集中在这里。",
  "Open RFQs": "待处理询价",
  "+3 invited this week": "本周新增 3 个邀请",
  "Quotes sent": "已发送报价",
  "Quotes sent this month": "本月已发送报价",
  "4 awaiting brand review": "4 个等待品牌审核",
  "Active production orders": "进行中生产订单",
  "2 need sample updates": "2 个需要样品更新",
  "August capacity": "8 月产能",
  "Mostly open": "较空",
  "Open August": "8 月可接单",
  "Update capacity": "更新产能",
  "RFQ invites": "询价邀请",
  "Prioritized requests that match your capacity and capabilities.": "优先显示与你的产能和能力匹配的需求。",
  "View all": "查看全部",
  "Add your own": "添加自定义选项",
  "Add": "添加",
  "Brand messages": "品牌消息",
  "Needs your attention": "需要你处理",
  "Priority RFQs, messages, and production steps.": "优先处理的询价、消息和生产步骤。",
  "Question": "问题",
  "Maison Rue asked about sample costs": "Maison Rue 询问样品费用",
  "Split fit and PP sample cost before quote review.": "在报价审核前拆分试衣样和产前样费用。",
  "Capacity": "产能",
  "Update August capacity": "更新 8 月产能",
  "Your capacity is marked mostly open for new RFQ matches.": "你的产能仍标记为较空，会影响新的询价匹配。",
  "Verification": "验证",
  "Review verification renewal": "查看验证续期",
  "TSC ops needs updated documents this month.": "TSC 运营本月需要更新文件。",
  "Sample": "样品",
  "Upload sample update": "上传样品更新",
  "Add fit-sample notes for the active Maison Rue order.": "为进行中的 Maison Rue 订单添加试衣样备注。",
  "Track current orders and next action dates.": "跟踪当前订单和下一步截止日期。",
  "Organic shirts - due today": "有机棉衬衫 - 今天截止",
  "Quote for": "报价：",
  "Stretch jersey capsule - 2 questions": "弹力针织系列 - 2 个问题",
  "Recycled fleece overshirt - new brief": "再生摇粒绒外套 - 新需求",
  "Verification renewal due this month.": "本月需要更新验证资料。",
  "Production step": "生产阶段",
  "Next due": "下个截止日",
  "PRODUCTION STEP": "生产阶段",
  "NEXT DUE": "下个截止日",
  "Sample approval": "样品审批",
  "Lab dip review": "色样审核",
  "unit target": "单价目标",
  "quantity": "数量",
  "samples": "样品",
  "bulk lead": "大货交期",
  "Strong fit": "高度匹配",
  "Good fit": "匹配",
  "Potential fit": "可能匹配",
  "August capacity works": "8 月产能可支持",
  "Strong fit · August capacity works": "高度匹配 · 8 月产能可支持",
  "Premium knit experience": "有高级针织经验",
  "Good fit · Premium knit experience": "匹配 · 有高级针织经验",
  "Check wash capacity": "需确认水洗产能",
  "Potential fit · Check wash capacity": "可能匹配 · 需确认水洗产能",
  "Maison Rue · 300 units": "Maison Rue · 300 件",
  "Luna Resort · Lab dips": "Luna Resort · 色样",
  "Northline · Deposit funded": "Northline · 定金已付款",
  "RFQs": "询价",
  "Track active requests you were invited to, quotes you already sent, and brand questions that need an answer.": "管理你收到邀请的需求、已发送报价，以及需要回复的品牌问题。",
  "Search RFQs": "搜索询价",
  "RFQ name, ID, or brand...": "询价名称、编号或品牌...",
  "Sort By": "排序",
  "Newest First": "最新优先",
  "Quote Due Soon": "报价即将截止",
  "Best Match": "最佳匹配",
  "Active RFQs (4)": "进行中询价 (4)",
  "Drafts (3)": "草稿 (3)",
  "Invited (2)": "已邀请 (2)",
  "Closed (6)": "已关闭 (6)",
  "Draft": "草稿",
  "Quote submitted": "报价已提交",
  "Due soon": "即将截止",
  "Due today": "今天截止",
  "Accepted": "已接受",
  "Closed": "已关闭",
  "your quote": "你的报价",
  "quote sent": "报价已发送",
  "quote due": "报价截止",
  "View RFQ": "查看询价",
  "Edit quote": "编辑报价",
  "‹ Back to RFQs": "‹ 返回询价",
  "‹ Back to view request": "‹ 返回查看需求",
  "Requested quantity": "需求数量",
  "300 units · 3 colors": "300 件 · 3 个颜色",
  "Review the brand request and the quote you submitted.": "查看品牌需求和你已提交的报价。",
  "RFQ status": "询价状态",
  "Your quote was submitted and is visible to Maison Rue.": "你的报价已提交，Maison Rue 可以查看。",
  "Your quote": "你的报价",
  "Quote sent": "报价已发送",
  "Status": "状态",
  "Helpful reminder": "提示",
  "Factories should quote exact units and exact lead time here. MOQ only belongs on profile/search, not on a response to a known order quantity.": "这里应填写准确件数和准确交期。MOQ 更适合放在工厂资料或搜索页，不适合用于已知订单数量的报价回复。",
  "Track confirmed production orders, sample approvals, milestones, messages, and shared files.": "跟踪已确认生产订单、样品审批、里程碑、消息和共享文件。",
  "Search production orders": "搜索生产订单",
  "Order name, ID, or brand...": "订单名称、编号或品牌...",
  "Factory": "工厂",
  "All factories": "所有工厂",
  "Client": "客户",
  "All clients": "所有客户",
  "Factory payments": "工厂付款",
  "Billing": "账单",
  "Earnings": "收入",
  "Payments": "付款",
  "Credits": "额度",
  "Credit balance": "额度余额",
  "Used": "已使用",
  "Earned": "已获得",
  "Pending": "待确认",
  "Verified onboarding bonus": "验证通过奖励",
  "Referral bonus available": "邀请奖励待获得",
  "Profile verified - Aug 10, 2026": "资料已验证 - 2026 年 8 月 10 日",
  "Invite a factory; both accounts earn after onboarding": "邀请工厂；对方完成入驻后双方获得奖励",
  "500 credits = $50 value. Credits are used when a quote is sent.": "500 额度 = $50 价值。发送报价时会使用额度。",
  "Get more credits": "购买更多额度",
  "Choose a credit pack to keep sending quotes. 500 credits = $50 value.": "选择额度套餐以继续发送报价。500 额度 = $50 价值。",
  "Quote credits": "报价额度",
  "Credits are charged only when you send this quote.": "只有发送报价时才会扣除额度。",
  "Required to send": "发送所需",
  "Quote type": "报价类型",
  "Production run": "生产订单",
  "Purchase more credits": "购买更多额度",
  "Filter by client": "按客户筛选",
  "total earned": "累计收入",
  "received this month": "本月已到账",
  "pending release": "待放款",
  "Sample milestone released": "样品里程碑已放款",
  "Production deposit released": "生产定金已放款",
  "Fit sample update": "试身样更新",
  "Platform service fee": "平台服务费",
  "Verified profile review": "认证资料审核",
  "Monthly billing - Aug 1, 2026": "月度账单 - 2026 年 8 月 1 日",
  "Account service - Jul 12, 2026": "账号服务 - 2026 年 7 月 12 日",
  "Received": "已到账",
  "Paid": "已支付",
  "Monthly billing": "月度账单",
  "Account service": "账号服务",
  "Date Range": "日期范围",
  "Any Time": "任意时间",
  "Last 30 days": "过去 30 天",
  "Last 90 days": "过去 90 天",
  "Next Due": "最近截止",
  "Brand": "品牌",
  "Active orders (4)": "进行中订单 (4)",
  "Message": "发消息",
  "View order": "查看订单",
  "Waiting for sample approval": "等待样品审批",
  "Waiting on brand approval to unlock fund": "等待品牌审批以解锁款项",
  "Submit lab dip": "提交色样",
  "Waiting on brand review after lab dip upload": "色样上传后等待品牌审核",
  "Awaiting payment": "等待付款",
  "First milestone payment not received": "第一笔里程碑付款尚未收到",
  "Not started": "未开始",
  "Need payment": "需要付款",
  "1st step funded": "首阶段资金托管",
  "Fit sample": "试身样",
  "Fit / lab dip": "试身 / 色样",
  "Production": "生产",
  "Shipped": "已发货",
  "Filters": "筛选",
  "Reset": "重置",
  "Product category": "产品品类",
  "Production type": "生产类型",
  "Product categories": "产品品类",
  "Cut & sew knits": "针织裁剪缝制",
  "Cut & sew apparel": "裁剪缝制成衣",
  "Sweaters / knitwear": "毛衫 / 针织成衣",
  "Seamless / circular knit": "无缝 / 圆机针织",
  "Intimates / delicate garments": "内衣 / 精细服装",
  "Leather / suede": "皮革 / 麂皮",
  "Bags / soft goods": "包袋 / 软配件",
  "Tops": "上装",
  "Bottoms": "下装",
  "Dresses & jumpsuits": "连衣裙 / 连体衣",
  "Knitwear": "针织成衣",
  "Denim": "牛仔",
  "Outerwear": "外套",
  "Activewear": "运动服",
  "Intimates / underwear": "内衣",
  "Swimwear": "泳装",
  "Sleepwear / loungewear": "睡衣 / 家居服",
  "Childrenswear / baby": "童装 / 婴童",
  "Uniforms / workwear": "制服 / 工装",
  "Accessories": "配饰",
  "Other": "其他",
  "Swim & activewear": "泳装和运动服",
  "Price point": "价格层级",
  "Mass $8-$18": "大众 $8-$18",
  "Middle $18-$40": "中端 $18-$40",
  "Premium $40-$90": "高级 $40-$90",
  "Luxury $90+": "奢侈 $90+",
  "Aug": "8 月",
  "Sep": "9 月",
  "Oct": "10 月",
  "Nov": "11 月",
  "Dec": "12 月",
  "Jan": "1 月",
  "Quantity": "数量",
  "Under 300": "300 件以下",
  "Preferred region": "偏好地区",
  "Open to my region": "开放给我的地区",
  "Worldwide": "全球",
  "Client trust": "客户可信度",
  "Payment verified": "付款已验证",
  "Timeline": "时间线",
  "Sample in 30 days": "30 天内打样",
  "Bulk in 60 days": "60 天内大货",
  "Flexible": "灵活",
  "Certifications": "认证",
  "Projects shown are matched to your capacity, certifications, region fit, client spend, and payment status.": "显示的项目会根据你的产能、认证、地区匹配度、客户消费记录和付款状态进行匹配。",
  "SOURCING MARKETPLACE": "寻源市场",
  "BROWSE BRAND REQUESTS": "浏览品牌需求",
  "Search organic cotton, denim, sample-ready...": "搜索有机棉、牛仔、可打样...",
  "24 open requests": "24 个开放需求",
  "matching wovens, low MOQ, GOTS, and available August capacity": "匹配梭织、低 MOQ、GOTS 和 8 月可用产能",
  "Sort: Best fit": "排序：最匹配",
  "Save": "保存",
  "View details": "查看详情",
  "Request details": "需求详情",
  "Review the brand request, attachments, and quote requirements before sending your factory response.": "在发送工厂回复前，查看品牌需求、附件和报价要求。",
  "Request match": "需求匹配",
  "Project brief": "项目简介",
  "‹ Back to explore": "‹ 返回浏览",
  "Quote-ready details": "报价所需信息",
  "Target unit price": "目标单价",
  "Color split": "颜色拆分",
  "3 colors · 100 each": "3 个颜色 · 每色 100 件",
  "Sample plan": "样品计划",
  "Bulk timeline": "大货时间",
  "Late September": "9 月下旬",
  "Materials and requirements": "材料和要求",
  "Organic cotton poplin, mid-weight": "中等克重有机棉府绸",
  "GOTS preferred, but brand can confirm certification path": "优先 GOTS，品牌可确认认证路径",
  "Brand attachments": "品牌附件",
  "Review these before quoting. Files open in the brand request workspace.": "报价前请查看这些文件。文件会在品牌需求工作区打开。",
  "Download files": "下载文件",
  "Tech pack v3.pdf": "Tech pack v3.pdf",
  "Tech pack v3.pdf · Measurement chart · Reference photos": "Tech pack v3.pdf · 尺寸表 · 参考图片",
  "Measurement chart": "尺寸表",
  "Reference photos": "参考图片",
  "Questions to answer in your quote": "报价中需要回答的问题",
  "Required capabilities": "所需能力",
  "Pattern support": "制版支持",
  "Sample-room support": "样品间支持",
  "Your August capacity and low-MOQ woven experience match the brand request.": "你的 8 月产能和低 MOQ 梭织经验符合品牌需求。",
  "Send quote": "发送报价",
  "Save request": "保存需求",
  "Keep track of brands you want to work with and RFQs you may quote later.": "管理你想合作的品牌，以及之后可能报价的询价。",
  "Saved brands": "收藏品牌",
  "Saved RFQs": "收藏询价",
  "Saved brands (3)": "收藏品牌 (3)",
  "Saved RFQs (3)": "收藏询价 (3)",
  "Search saved brands": "搜索收藏品牌",
  "Search saved RFQs": "搜索收藏询价",
  "Brand name, category, location...": "品牌名称、品类、地区...",
  "Recently saved": "最近收藏",
  "Best fit": "最匹配",
  "Contact brand": "联系品牌",
  "View brand": "查看品牌",
  "Remove": "移除",
  "Unit target": "单价目标",
  "Quote due": "报价截止",
  "Request tags": "需求标签",
  "No reference image uploaded": "未上传参考图片",
  "Review the written brief, request tags, and attached tech pack in details.": "请在详情中查看文字简介、需求标签和附件 tech pack。",
  "Fashion brand": "时尚品牌",
  "Contemporary brand": "当代品牌",
  "Outerwear brand": "外套品牌",
  "$1M-$5M revenue": "$1M-$5M 营收",
  "$5M-$10M revenue": "$5M-$10M 营收",
  "4 Club orders": "4 个 Club 订单",
  "2 repeat factories": "2 家复购工厂",
  "Toronto market": "多伦多市场",
  "1 day avg. response": "平均 1 天回复",
  "Denim jacket reference": "牛仔夹克参考图",
  "$5k+ spent": "已消费 5k+ 美元",
  "$25k+ spent": "已消费 25k+ 美元",
  "Cut & sew": "裁剪缝制",
  "GOTS preferred": "优先 GOTS",
  "3 colors": "3 个颜色",
  "China / Portugal / Korea": "中国 / 葡萄牙 / 韩国",
  "OEKO-TEX": "OEKO-TEX",
  "Yarn sourcing": "纱线采购",
  "Poplin shirt reference": "府绸衬衫参考图",
  "Material direction": "材料方向",
  "Fit detail": "版型细节",
  "Cardigan reference": "开衫参考图",
  "Verified brand": "已验证品牌",
  "Yes": "是",
  "Settings sections": "设置分区",
  "Account settings": "账号设置",
  "Basic information": "基本信息",
  "Edit the details brands use for orders, calls, and account verification.": "编辑品牌用于订单、通话和账号验证的资料。",
  "Account name": "账号名称",
  "Email": "邮箱",
  "Phone": "电话",
  "Location": "所在地",
  "Password & security": "密码与安全",
  "Update login access and keep payout or approval actions protected.": "更新登录权限，并保护收款或审批操作。",
  "Current password": "当前密码",
  "New password": "新密码",
  "Enter current password": "输入当前密码",
  "Create new password": "创建新密码",
  "Payment method": "付款方式",
  "Payment methods": "付款方式",
  "Manage where you receive earnings and which method is used for billing.": "管理收款账户，以及用于账单扣费的付款方式。",
  "Payment method type": "付款方式类型",
  "Primary": "主要",
  "Secondary": "备用",
  "Wise business ending in 9021": "Wise 企业账户尾号 9021",
  "Bank account ending in 1184": "银行账户尾号 1184",
  "Visa ending in 4412": "Visa 尾号 4412",
  "Mastercard ending in 8840": "Mastercard 尾号 8840",
  "Receives released milestone funds from brand orders.": "接收品牌订单已放款的里程碑款项。",
  "Backup account for receiving earnings.": "用于接收收入的备用账户。",
  "Used to pay platform fees, services, or billing charges.": "用于支付平台费、服务费或账单扣费。",
  "Backup method for billing charges.": "用于账单扣费的备用付款方式。",
  "+ Add payment method": "+ 添加付款方式",
  "Team & stakeholders": "团队与相关人员",
  "Manage team & stakeholders": "管理团队与相关人员",
  "Control who can quote RFQs, post updates, and act as the primary contact.": "管理谁可以报价、发布更新，以及担任主要联系人。",
  "Invite member": "邀请成员",
  "Team permissions": "团队权限",
  "Member": "成员",
  "RFQ flow": "询价流程",
  "Give quotes and submit RFQ details": "报价并提交询价详情",
  "Post production updates and files": "发布生产更新和文件",
  "Primary contact": "主要联系人",
  "Main contact for messages and calls": "消息和通话的主要联系人",
  "Settings access": "设置权限",
  "Account, payments, and invites": "账号、付款和邀请",
  "Owner": "所有者",
  "Production lead": "生产负责人",
  "Finance": "财务",
  "Viewer": "查看者",
  "Stakeholder": "相关人员",
  "Close invite panel": "关闭邀请面板",
  "Invite stakeholder": "邀请相关人员",
  "Add their details and choose what they can manage.": "添加对方资料，并选择他们可以管理的内容。",
  "Name": "姓名",
  "Full name": "完整姓名",
  "Role": "角色",
  "Authority": "权限",
  "Send invite": "发送邀请",
  "Choose which updates should reach your team by email.": "选择哪些更新需要通过邮件发送给团队。",
  "New RFQ matches": "新的询价匹配",
  "Payment and approval requests": "付款和审批请求",
  "Messages and call invites": "消息和通话邀请",
  "Send email notifications to members with matching authority.": "向拥有对应权限的成员发送邮件通知。",
  "Club orders": "平台订单",
  "Avg. response": "平均回复",
  "1 day": "1 天",
  "Payment status": "付款状态",
  "Verified": "已验证",
  "New York, USA": "纽约，美国",
  "Los Angeles, USA": "洛杉矶，美国",
  "Toronto, Canada": "多伦多，加拿大",
  "Miami, USA": "迈阿密，美国",
  "Porto, Portugal": "波尔图，葡萄牙",
  "Activity on this request": "该需求动态",
  "3 quotes received": "已收到 3 个报价",
  "Last viewed by brand: 12 min ago": "品牌最后查看：12 分钟前",
  "Shortlist starts after Jul 24": "7 月 24 日后开始筛选",
  "Add fit sample update": "添加试身样更新",
  "Line-hours available per month": "每月可用产线工时",
  "Category": "品类",
  "Wovens — your registered specialization": "梭织 — 你注册的专长",
  "hours / month": "小时 / 月",
  "Total across all your lines. This is the number that stays true no matter what style a brand orders.": "所有产线的总工时。无论品牌下单什么款式，这个数字都是基础。",
  "Estimate uses a standard reference style": "估算使用标准参考款",
  "Basic woven shirt": "基础梭织衬衫",
  "~18 min/pc": "约 18 分钟 / 件",
  "We use a standard woven shirt reference so brands can compare capacity across factories. Once a brand shares a tech pack, the estimate can be adjusted to the actual style.": "我们使用标准梭织衬衫作为参考，方便品牌比较不同工厂的产能。品牌提供 tech pack 后，可按实际款式调整估算。",
  "Booking level, month by month": "每月接单状态",
  "Percentage of your hours still free that month. We multiply this against your reference-style estimate to get units.": "当月仍可用工时比例。我们会用它乘以参考款估算，得到件数。",
  "Partly booked": "部分已订",
  "Mostly full": "较满",
  "60-100% open": "60-100% 可接单",
  "25-60% open": "25-60% 可接单",
  "0-25% open": "0-25% 可接单",
  "BRANDS WILL SEE": "品牌将看到",
  "Save changes": "保存更改",
  "Prepare quote": "准备报价",
  "Set the unit price, sample path, lead time, and any questions before sending your quote.": "发送报价前，填写单价、样品路径、交期和需要确认的问题。",
  "‹ Back to view project": "‹ 返回项目详情",
  "Back": "返回",
  "Save draft": "保存草稿",
  "Review quote": "审核报价",
  "Review total": "审核报价",
  "Quote terms": "报价条款",
  "Enter exact commercial terms for this request.": "填写该需求的准确商务条款。",
  "You can fill this in Chinese. We'll create an English version for you to review before sending.": "可用中文填写，提交前会生成英文版本供你确认。",
  "You can fill this page in Chinese. We'll create an English version for you to review before sending.": "本页可用中文填写，提交前会生成英文版本供你确认。",
  "Unit price": "单价",
  "Exact production quantity *": "准确生产数量 *",
  "Bulk lead time *": "大货交期 *",
  "Open capacity window *": "可接单时间窗口 *",
  "Payment terms": "付款条款",
  "Shipping / incoterms": "运输 / 贸易条款",
  "Quote valid until": "报价有效期至",
  "Material sourcing and component costs": "材料采购和辅料成本",
  "Specify what is included in your quote and what the brand must provide.": "说明报价中包含哪些项目，以及品牌需要提供什么。",
  "Factory includes": "工厂报价包含",
  "Main production materials and standard components from the approved direction.": "按确认方向采购的主要生产材料和标准辅料。",
  "Main production materials and standard components from approved direction, included in unit price": "按确认方向采购的主要生产材料和标准辅料，已包含在单价中",
  "Brand provides separately": "品牌另行提供",
  "Labels, packaging, final color standards, and special branded trims.": "商标、包装、最终颜色标准和特殊品牌辅料。",
  "Brand will provide or approve before sampling": "品牌将在打样前提供或确认",
  "Assumptions to confirm": "待确认假设",
  "Fabric GSM, trim spec, MOQ surcharge, certification path, and lead-time impact": "面料 GSM、辅料规格、MOQ 附加费、认证路径和交期影响",
  "Confirm in quote": "报价中确认",
  "Which fabric, trim, or component costs are included, plus any MOQ or lead-time assumptions.": "哪些面料、辅料或组件成本已包含，以及任何 MOQ 或交期假设。",
  "Break out sample stages so the brand can compare quotes clearly.": "拆分样品阶段，方便品牌清楚比较报价。",
  "Stage": "阶段",
  "Cost": "费用",
  "Timing": "时间",
  "Includes": "包含",
  "+ Add sample stage": "+ 添加样品阶段",
  "Brand questions and factory notes": "品牌问题和工厂备注",
  "Factory response": "工厂回复",
  "Additional details and questions": "补充信息和问题",
  "Add supporting files or questions regarding the quote.": "添加与报价相关的支持文件或问题。",
  "‹ Back to edit quote": "‹ 返回编辑报价",
  "Totals are calculated after saving the quote. Review the breakdown before sending it to Maison Rue.": "保存报价后会计算总计。发送给 Maison Rue 前请确认明细。",
  "Production subtotal": "生产小计",
  "Sample shipping": "样品运费",
  "Quote total shown to brand": "品牌将看到的报价总计",
  "Ready to send?": "准备发送？",
  "Confirm the quote is complete before it appears in the brand comparison page.": "发送前请确认报价完整，它会出现在品牌的报价比较页。",
  "Quote sent successfully": "报价发送成功",
  "Your quote is now visible to the brand. They can compare it with other factory quotes, message you, or choose your quote for contract terms.": "品牌现在可以看到你的报价。他们可以与其他工厂报价比较、给你发消息，或选择你的报价进入合同条款。",
  "quote submitted": "报价已提交",
  "The brand will see your unit price, sample plan, production timing, open capacity, and factory notes in their quote comparison view.": "品牌会在报价比较页看到你的单价、样品计划、生产时间、可用产能和工厂备注。",
  "quote total": "报价总计",
  "Go to dashboard": "返回控制台",
  "Browse more requests": "浏览更多需求",
  "Quote status": "报价状态",
  "Maison Rue has been notified. Your quote appears on their comparison page with your factory notes and assumptions.": "Maison Rue 已收到通知。你的报价会和工厂备注及假设一起显示在他们的比较页。",
  "Shown total": "显示总计",
  "Keep the quote current": "保持报价更新",
  "If price, capacity, or sample timing changes before the brand chooses, edit the quote from the submitted quote page.": "如果品牌选择前价格、产能或样品时间有变化，请在已提交报价页修改。",
  "Order activity": "订单动态",
  "‹ Back to production orders": "‹ 返回生产订单",
  "order total": "订单总额",
  "funded": "资金已托管",
  "remaining": "剩余金额",
  "next payment": "下一笔付款",
  "Overview": "概览",
  "Messages (2)": "消息 (2)",
  "Files": "文件",
  "Contract details": "合同详情",
  "Funded · due Aug 16": "资金已托管 · 8 月 16 日截止",
  "Factory prepares first sample and uploads sample photos for approval.": "工厂准备第一件样品，并上传样品照片供审批。",
  "Lab dip / color": "色样 / 颜色",
  "Awaiting brand approval": "等待品牌审批",
  "Brand reviews fabric color standard before bulk materials are ordered.": "品牌在订购大货物料前审核面料颜色标准。",
  "Strike-off / print": "印花打样 / 印刷",
  "Factory update due Aug 18": "工厂更新截止 8 月 18 日",
  "Factory confirms print, embroidery, or construction details before bulk.": "工厂在大货前确认印花、刺绣或结构细节。",
  "Size set / fit notes": "齐码样 / 试身备注",
  "Brand reviews graded sizes or fit notes when needed for the style.": "如款式需要，品牌会审核齐码尺寸或试身备注。",
  "Bulk deposit": "大货定金",
  "QC photos": "QC 照片",
  "Before final payment": "尾款前",
  "Brand approves QC photos before final balance can release.": "品牌审批 QC 照片后才可释放尾款。",
  "Final payment": "尾款",
  "Before shipment / QC photos": "出货前 / QC 照片",
  "Final balance releases after QC photos and shipment details are confirmed.": "QC 照片和出货信息确认后释放尾款。",
  "Factory last viewed order 2h ago": "工厂 2 小时前查看订单",
  "Last message yesterday": "最后消息：昨天",
  "Sample photos expected Aug 16": "预计 8 月 16 日上传样品照片",
  "Bulk deposit locked until approval": "大货定金需审批后解锁",
  "Production timeline": "生产时间线",
  "Manage step": "管理步骤",
  "Add update": "添加更新",
  "View all updates (7)": "查看全部更新 (7)",
  "Fit sample is ready for review. Uploaded front, side, and detail photos for approval.": "试身样已准备好审核。已上传正面、侧面和细节照片供审批。",
  "Front photo": "正面照片",
  "Detail photo": "细节照片",
  "Back photo": "背面照片",
  "+3 files": "+3 个文件",
  "Upload note": "更新说明",
  "Optional: packaging, QC expectations, shipping notes, or anything factories should know before quoting.": "选填：包装、质检要求、运输备注，或工厂报价前需要了解的信息。",
  "+ Upload photos": "+ 上传照片",
  "JPG or PNG, up to 10 files": "JPG 或 PNG，最多 10 个文件",
  "Cancel": "取消",
  "Post update": "发布更新"
};

const factoryMainZhReplacements = [
  [/Capacity ([\d,.-]+) units/g, "产能 $1 件"],
  [/(\d+) units/g, "$1 件"],
  [/(\d+) colors/g, "$1 个颜色"],
  [/per color/g, "每色"],
  [/(\d+) days/g, "$1 天"],
  [/(\d+) files/g, "$1 个文件"],
  [/China \/ Portugal \/ Korea/g, "中国 / 葡萄牙 / 韩国"],
  [/New York, USA/g, "纽约，美国"],
  [/Los Angeles, USA/g, "洛杉矶，美国"],
  [/Toronto, Canada/g, "多伦多，加拿大"],
  [/Miami, USA/g, "迈阿密，美国"],
  [/Porto, Portugal/g, "波尔图，葡萄牙"],
  [/Posted 18 minutes ago/g, "18 分钟前发布"],
  [/Posted yesterday/g, "昨天发布"],
  [/Posted 2 days ago/g, "2 天前发布"],
  [/Started Jul 19/g, "7 月 19 日开始"],
  [/Started Jul 12/g, "7 月 12 日开始"],
  [/Started Jul 10/g, "7 月 10 日开始"],
  [/Started Jul 8/g, "7 月 8 日开始"],
  [/Payment verified/g, "付款已验证"],
  [/(\d+) units/g, "$1 件"],
  [/\$(\d+)k\+ spent/g, "已消费 $1k+ 美元"],
  [/Cut & sew/g, "裁剪缝制"],
  [/Knitwear/g, "针织成衣"],
  [/Wovens/g, "梭织"],
  [/Denim/g, "牛仔"],
  [/Swim/g, "泳装"],
  [/GOTS preferred/g, "优先 GOTS"],
  [/Yarn sourcing/g, "纱线采购"],
  [/Wash development/g, "洗水开发"],
  [/Fit \+ size set/g, "试身样 + 齐码样"],
  [/Wash sample/g, "洗水样"],
  [/Fit sample/g, "试身样"],
  [/fit sample/g, "试身样"],
  [/PP sample/g, "PP 样"],
  [/after PP approval/g, "PP 样确认后"],
  [/before shipment/g, "出货前"],
  [/deposit/g, "定金"],
  [/\/ unit/g, "/ 件"],
  [/Jul 24/g, "7 月 24 日"],
  [/July 26/g, "7 月 26 日"],
  [/July 29/g, "7 月 29 日"],
  [/Jul 10, 2026/g, "2026 年 7 月 10 日"],
  [/Jul 12, 2026/g, "2026 年 7 月 12 日"],
  [/Jul 18, 2026/g, "2026 年 7 月 18 日"],
  [/Jul 29, 2026/g, "2026 年 7 月 29 日"],
  [/Today/g, "今天"],
  [/Yesterday/g, "昨天"],
  [/Aug 1, 2026/g, "2026 年 8 月 1 日"],
  [/Aug 08/g, "8 月 8 日"],
  [/Aug 12-30/g, "8 月 12-30 日"],
  [/Aug 16/g, "8 月 16 日"],
  [/Jul 28/g, "7 月 28 日"],
  [/Jul 30/g, "7 月 30 日"],
  [/Wovens · ([A-Z][a-z]{2}) start · roughly ([\d,.-]+) pieces that month/g, "梭织 · $1 可开始 · 当月约 $2 件"],
  [/([A-Z][a-z]{2}) mostly open; ([A-Z][a-z]{2}) partly booked/g, "$1 较空；$2 部分已订"]
];

function translateFactoryMainText(value) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  let translated = factoryMainZhText[trimmed] || trimmed;
  factoryMainZhReplacements.forEach(([pattern, replacement]) => {
    translated = translated.replace(pattern, replacement);
  });
  return `${leading}${translated}${trailing}`;
}

function translateFactoryMainDom(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "TEXTAREA"].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.closest("[data-no-translate]")) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach((node) => {
    node.nodeValue = translateFactoryMainText(node.nodeValue);
  });

  root.querySelectorAll("input[placeholder]").forEach((input) => {
    input.placeholder = translateFactoryMainText(input.placeholder);
  });
  root.querySelectorAll("[aria-label]").forEach((element) => {
    element.setAttribute("aria-label", translateFactoryMainText(element.getAttribute("aria-label") || ""));
  });
  root.querySelectorAll("[title]").forEach((element) => {
    element.setAttribute("title", translateFactoryMainText(element.getAttribute("title") || ""));
  });
}

function FactoryMainLanguageLayer({ language }) {
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    if (language !== "zh") return;
    const frame = window.requestAnimationFrame(() => {
      translateFactoryMainDom(document.querySelector(".factory-flow"));
    });
    return () => window.cancelAnimationFrame(frame);
  });

  return null;
}

const factoryRfqs = [
  {
    initials: "MR",
    title: "Organic cotton woven shirt production",
    brand: "Maison Rue",
    location: "New York, USA",
    trust: "$25k+ spent",
    description: "300 women’s woven shirts in organic cotton poplin. Fit + PP sample before bulk approval.",
    tags: ["Cut & sew", "Fit + size set · $340 total", "420 units", "GOTS"],
    facts: [
      ["Unit target", "$18-$24"],
      ["Quantity", "300 units"],
      ["Samples", "Fit + size set"],
      ["Quote due", "Jul 24"]
    ],
    images: [
      { label: "Poplin shirt reference", src: "https://images.pexels.com/photos/7752674/pexels-photo-7752674.jpeg?auto=compress&dpr=1&w=900" },
      { label: "Material direction", src: "https://images.pexels.com/photos/6461392/pexels-photo-6461392.jpeg?auto=compress&dpr=1&w=900" },
      { label: "Fit detail", src: "https://images.pexels.com/photos/7760024/pexels-photo-7760024.jpeg?auto=compress&dpr=1&w=900" }
    ],
    status: "Quote submitted",
    statusTone: "ready",
    metrics: [
      ["$18.40", "your quote"],
      ["Jul 24", "quote sent"]
    ],
    featured: true
  },
  {
    initials: "ES",
    title: "Premium knit capsule for resort drop",
    brand: "Elara Studio",
    location: "Los Angeles, USA",
    trust: "$5k+ spent",
    description: "Fine-gauge merino blend tops and cardigans. Brand wants visible sample-room support.",
    tags: ["Knitwear", "Premium $40-$90", "180 units", "Fit + size set", "GOTS"],
    facts: [
      ["Unit target", "$40-$55"],
      ["Quantity", "180 units"],
      ["Samples", "Fit + size set"],
      ["Quote due", "Jul 26"]
    ],
    images: [
      { label: "Cardigan reference", src: "https://images.pexels.com/photos/9603624/pexels-photo-9603624.jpeg?auto=compress&dpr=1&w=900" }
    ],
    status: "Due soon",
    statusTone: "warning",
    metrics: [
      ["Draft", "your quote"],
      ["July 26", "quote due"]
    ]
  },
  {
    initials: "NL",
    title: "Denim jacket wash development and small bulk",
    brand: "Northline",
    location: "Toronto, Canada",
    trust: "$25k+ spent",
    description: "Rigid denim jacket with two washes. Needs wash-down samples, trims confirmation, and split delivery.",
    tags: ["Denim", "Middle $18-$40", "180 units", "Wash sample", "GOTS"],
    facts: [
      ["Unit target", "$28-$36"],
      ["Quantity", "500 units"],
      ["Samples", "Wash sample"],
      ["Quote due", "Jul 29"]
    ],
    images: [
      { label: "Denim jacket reference", src: "https://images.pexels.com/photos/28174872/pexels-photo-28174872.jpeg?auto=compress&dpr=1&w=900" }
    ],
    metrics: [
      ["Draft", "your quote"],
      ["July 29", "quote due"]
    ]
  },
  {
    initials: "AS",
    title: "Low-MOQ swim capsule with recycled nylon",
    brand: "Aster Swim",
    location: "Miami, USA",
    trust: "$5k+ spent",
    description: "Small recycled nylon swim run with size set sample and packaging guidance.",
    tags: ["Swim", "Mass $8-$18", "220 units", "Fit + size set"],
    facts: [
      ["Unit target", "$14-$18"],
      ["Quantity", "220 units"],
      ["Samples", "Fit + size set"],
      ["Quote due", "Today"]
    ],
    images: [
      { label: "Swim capsule reference", src: "https://images.pexels.com/photos/3998649/pexels-photo-3998649.jpeg?auto=compress&dpr=1&w=900" },
      { label: "Recycled nylon direction", src: "https://images.pexels.com/photos/5405652/pexels-photo-5405652.jpeg?auto=compress&dpr=1&w=900" }
    ],
    status: "Due today",
    statusTone: "danger",
    metrics: [
      ["Draft", "your quote"],
      ["Today", "quote due"]
    ]
  }
];

const factoryDraftRfqs = factoryRfqs.filter((rfq) => rfq.metrics?.[0]?.[0] === "Draft");
const factoryInvitedRfqs = factoryRfqs.slice(1, 3).map((rfq) => ({
  ...rfq,
  status: "Invited",
  statusTone: "ready",
  metrics: [
    ["Not started", "your quote"],
    [rfq.facts.find(([label]) => label === "Quote due")?.[1] || "TBD", "quote due"]
  ]
}));
const factoryClosedRfqs = [
  {
    ...factoryRfqs[0],
    title: "Linen camp shirt summer run",
    description: "Short-sleeve linen shirts with corozo buttons and garment wash. Quote accepted and moved to production.",
    status: "Accepted",
    statusTone: "ready",
    metrics: [
      ["$21.20", "your quote"],
      ["Jul 12", "closed"]
    ]
  },
  {
    ...factoryRfqs[2],
    title: "Rib knit base layer set",
    brand: "Northline",
    description: "Rib tank and short set with compact MOQ and two lab dip rounds.",
    status: "Closed",
    statusTone: "neutral",
    metrics: [
      ["$16.80", "your quote"],
      ["Jun 28", "closed"]
    ]
  }
];

const factoryProjects = [
  {
    initials: "MR",
    title: "Organic cotton woven shirt production",
    brand: "Maison Rue",
    location: "New York, USA",
    started: "Started Jul 19",
    description: "300 women’s woven shirts in organic cotton poplin. Fit + PP sample before bulk approval.",
    status: "Waiting for sample approval",
    statusTone: "ready",
    statusDetail: "Waiting on brand approval to unlock fund",
    currentStep: "Fit sample",
    nextDue: "Aug 16",
    progress: 2,
    images: [
      { label: "Poplin shirt reference", src: "https://images.pexels.com/photos/7752674/pexels-photo-7752674.jpeg?auto=compress&dpr=1&w=900" }
    ],
    featured: true
  },
  {
    initials: "LR",
    title: "Premium knit capsule for resort drop",
    brand: "Luna Resort",
    location: "Los Angeles, USA",
    started: "Started Jul 12",
    description: "Small capsule of lightweight knit tops with PP sample before bulk approval.",
    status: "Submit lab dip",
    statusTone: "warning",
    statusDetail: "Waiting on brand review after lab dip upload",
    currentStep: "Fit / lab dip",
    nextDue: "Aug 08",
    progress: 3,
    images: [
      { label: "Knit capsule reference", src: "https://images.pexels.com/photos/9603624/pexels-photo-9603624.jpeg?auto=compress&dpr=1&w=900" }
    ]
  },
  {
    initials: "NS",
    title: "Denim jacket wash development and small bulk",
    brand: "Northline Supply",
    location: "Austin, USA",
    started: "Started Jul 10",
    description: "Denim jacket wash development with revised 500-unit production run.",
    status: "Awaiting payment",
    statusTone: "neutral",
    statusDetail: "First milestone payment not received",
    currentStep: "Not started",
    nextDue: "Jul 30",
    progress: 1,
    images: [
      { label: "Denim jacket reference", src: "https://images.pexels.com/photos/28174872/pexels-photo-28174872.jpeg?auto=compress&dpr=1&w=900" }
    ]
  },
  {
    initials: "MS",
    title: "Low-MOQ swim capsule with recycled nylon",
    brand: "Marea Swim",
    location: "Miami, USA",
    started: "Started Jul 8",
    description: "Low-MOQ swim set capsule using recycled nylon and contrast binding.",
    status: "Awaiting payment",
    statusTone: "neutral",
    statusDetail: "First milestone payment not received",
    currentStep: "Not started",
    nextDue: "Jul 28",
    progress: 1,
    images: [
      { label: "Swim capsule reference", src: "https://images.pexels.com/photos/3998649/pexels-photo-3998649.jpeg?auto=compress&dpr=1&w=900" }
    ]
  }
];

const projectSteps = ["1st step funded", "Fit sample", "Fit / lab dip", "Production", "Shipped"];

const onboardingCopy = {
  en: {
    steps: [
      {
        title: "Welcome to The Sourcing Club",
        intro: "Let's set up your factory profile so brands can find you. It takes about 5 minutes, and you can edit everything later.",
        meta: "11 steps · 5 minutes",
        languageLabel: "Language",
        languageHelp: "",
        cta: "Get started"
      },
      {
        title: "Tell us about your factory",
        fields: [
          ["Factory Name", "e.g. Golden Thread Manufacturing"],
          ["Year Founded", "YYYY"],
          ["Website URL", "www.example.com"],
          ["Factory Location", "City, Country"],
          ["Nearest Port", "e.g. Port of Shanghai"],
          ["Total Employees", "e.g. 120"]
        ],
        helper: "The seaport or airport you ship from most often."
      },
      {
        title: "Add factory context",
        intro: "Share the details that help brands understand your factory, production strengths, and working style.",
        brandLabel: "About the factory",
        brandPlaceholder: "A short overview of your factory, production strengths, typical customers, quality standards, and what brands should understand before they send an RFQ.",
        logoTitle: "Factory logo",
        logoHelper: "Upload your factory logo, wordmark, or icon mark.",
        logoAccept: "SVG, PNG, or JPG",
        imagesTitle: "Samples developed",
        imagesHelper: "Upload sample garments, product development examples, construction details, or finished pieces your factory has made.",
        imagesAccept: "PNG, JPG, or PDF"
      },
      {
        title: "What type of production does your factory specialize in?",
        intro: "Start with the production method, then choose the garment categories you can reliably make.",
        groups: [
          ["Production type", ["Cut & sew knits", "Wovens", "Sweaters / knitwear", "Denim", "Seamless / circular knit", "Intimates / delicate garments", "Leather / suede", "Bags / soft goods"], ["Cut & sew knits", "Wovens"]],
          ["Product categories", ["Tops", "Bottoms", "Dresses & jumpsuits", "Outerwear", "Activewear", "Intimates / underwear", "Swimwear", "Sleepwear / loungewear", "Childrenswear / baby", "Uniforms / workwear", "Accessories"], ["Tops", "Bottoms"]],
          ["Makes", ["Button-down shirts", "Poplin blouses", "Woven dresses", "Linen co-ords", "Lightweight jackets", "Pleated skirts", "Rib tops", "Canvas totes", "Denim jackets", "Swim sets"], ["Button-down shirts", "Poplin blouses", "Woven dresses"]],
          ["Market level", ["Luxury / high-end", "Premium / contemporary", "Mid range", "Mass market"], ["Premium / contemporary"]]
        ],
      },
      {
        title: "Specialty, services, and tools",
        intro: "Add the capabilities brands use to understand your sampling support and production setup.",
        groups: [
          ["Specializes in", ["In-house pattern room", "Fit sample + PP sample", "Small-batch export", "GOTS cotton", "Wash development", "Trim sourcing", "QC photo updates", "Low-MOQ sampling"], ["In-house pattern room", "Fit sample + PP sample", "Small-batch export", "GOTS cotton"]],
          ["Design Services", ["Pattern making", "Grading", "Sample development", "Tech pack support", "Full package (FPP)", "CMT only"], ["Full package (FPP)"]],
          ["3D & digital tools (optional)", ["CLO 3D", "Browzwear", "Lectra", "Gerber", "None"], []]
        ],
        equipmentLabel: "Key machines or equipment",
        equipmentPlaceholder: "Optional: flatlock, linking, embroidery, washing, laser cutting..."
      },
      {
        title: "Your capacity and terms",
        intro: "Share your monthly line-hours and booking level. We translate this into capacity estimates brands can understand.",
        fields: [
          ["Minimum Order Quantity", "e.g. 100 units / style"],
          ["Typical Lead Time", "e.g. 30-45 days"]
        ],
        category: "Wovens — based on your selected production type",
        lineHoursLabel: "Line-hours available per month",
        referenceTitle: "Basic woven shirt",
        referenceMeta: "~18 min/pc reference style",
        referenceCopy: "This gives brands a comparable estimate before they share a tech pack.",
        monthTitle: "Booking level, month by month",
        brandPreview: "Brands will see: Wovens · Aug start · roughly 4,800-8,000 pieces that month"
      },
      {
        title: "Get verified, get found",
        intro: "We review these in the background. Required documents help us verify your factory, while optional references and reports make your profile stronger.",
        businessLabel: "Business registration certificate *",
        businessUpload: "Click or drag files to upload",
        businessHelper: "Required for verification.",
        certificationLabel: "Add certifications you hold",
        search: "Search or select a certification",
        add: "Add certification",
        certifications: [["GOTS", "pending"], ["OEKO-TEX Standard 100", "uploaded"], ["BSCI", "pending"]],
        uploadCertificate: "Click or drag certificate to upload",
        uploadedCertificate: "Certificate uploaded",
        deleteCertificate: "Delete",
        certificateHelper: "PDF, PNG, or JPG",
        reference: "Client references",
        addReference: "+ Add another reference",
        referenceHelper: "Brands or retailers you have produced for."
      },
      {
        title: "Add your factory walkthrough",
        intro: "Record or upload one continuous 2-4 minute walkthrough of your facility. No editing needed.",
        laterNote: "You can complete this step later from your profile.",
        instructionTitle: "What to record",
        instructionCopy: "Start at the entrance or reception and say your factory name, city, and today's date. Then walk slowly through the main production floor, materials or components area, key machines or workstations, quality control area, and packing or warehouse area.",
        instructionMeta: "Target length: 2-4 minutes. Maximum: 5 minutes.",
        checklistTitle: "Your video should include:",
        checklist: ["Entrance or reception", "Main production floor", "Materials/components", "Key machines/workstations", "Quality control area", "Packing or warehouse"],
        optionTitle: "Choose how to add your video (optional)",
        options: [["Record directly", "Open the recorder and capture the walkthrough now."], ["Upload video", "Add a completed walkthrough video file."]]
      },
      {
        title: "Review your profile",
        intro: "Confirm the main details brands will use to understand and match with your factory.",
        sections: [
          ["Factory details", [["Factory Name", "Golden Thread Manufacturing"], ["Year Founded", "2016"], ["Location", "Dongguan, China"], ["Nearest Port", "Shenzhen"]]],
          ["Production fit", [["Production Type", "Cut & sew knits, Wovens"], ["Product Categories", "Tops, Bottoms, Activewear"], ["Makes", "Button-down shirts, Poplin blouses, Woven dresses"], ["Specializes in", "In-house pattern room, Fit sample + PP sample, Small-batch export, GOTS cotton"], ["Market Level", "Premium / contemporary"], ["Services", "Full package (FPP), Pattern making"]]],
          ["Capacity & verification", [["MOQ", "100 units / style"], ["Lead Time", "30-45 days"], ["Line-hours", "2,400 hours / month"], ["Estimated units", "Aug roughly 4,800-8,000 pcs"], ["Booking level", "Aug mostly open; Sep partly booked"], ["Verification", "Registration uploaded; certificates pending"]]]
        ],
        cta: "Confirm"
      },
      {
        title: "Terms & Conditions",
        intro: "Please read and sign our terms before continuing.",
        terms: [
          ["Platform Usage", "Use The Sourcing Club to share accurate factory information, respond to brand enquiries professionally, and keep communication related to sourcing opportunities."],
          ["Data Privacy & Confidentiality", "Only upload documents and media you are allowed to share. Brand enquiries, tech packs, pricing, and project details should be kept confidential unless both sides agree otherwise."],
          ["Factory Responsibilities", "Keep your profile, capacity, certifications, and contact details up to date. Quotes, lead times, and production commitments should reflect what your factory can realistically deliver."]
        ],
        agreement: "I have read and agree to the Terms and Conditions",
        signature: "Type your full name to sign electronically",
        cta: "Sign & Continue"
      },
      {
        title: "You're all set",
        intro: "Your factory profile has been submitted. We'll review your verification documents and let you know when your profile is ready for brands to discover.",
        cta: "Go to Dashboard"
      }
    ],
    back: "Previous",
    next: "Next"
  },
  zh: {
    steps: [
      {
        title: "欢迎来到 The Sourcing Club",
        intro: "我们将帮你建立工厂资料，让品牌更容易找到你。大约需要 5 分钟，之后可以随时修改。",
        meta: "11 步 · 约 5 分钟",
        languageLabel: "语言",
        languageHelp: "",
        cta: "开始设置"
      },
      {
        title: "告诉我们你的工厂信息",
        fields: [["工厂名称", "例如：金线服装制造"], ["成立年份", "YYYY"], ["官网", "www.example.com"], ["工厂所在地", "城市，国家/地区"], ["最近港口", "例如：深圳港"], ["员工总数", "例如：120"]],
        helper: "你最常使用的海港或机场。"
      },
      {
        title: "添加工厂背景",
        intro: "补充工厂介绍、生产优势和合作方式，帮助品牌更快判断是否匹配。",
        brandLabel: "工厂介绍",
        brandPlaceholder: "简要说明工厂情况、生产优势、常合作客户、质量标准，以及品牌发送 RFQ 前需要了解的信息。",
        logoTitle: "工厂 Logo",
        logoHelper: "上传工厂 logo、字标或图标。",
        logoAccept: "SVG、PNG 或 JPG",
        imagesTitle: "已开发样品",
        imagesHelper: "上传工厂开发过的样衣、产品开发案例、结构细节或成品图片。",
        imagesAccept: "PNG、JPG 或 PDF"
      },
      {
        title: "你的工厂擅长哪类生产？",
        intro: "先选择生产工艺，再选择可稳定生产的品类。",
        groups: [
          ["生产类型", ["针织裁剪缝制", "梭织", "毛衫 / 针织成衣", "牛仔", "无缝 / 圆机针织", "内衣 / 精细工艺", "皮革 / 麂皮", "包袋 / 软配件", "其他"], ["针织裁剪缝制", "梭织"]],
          ["产品品类", ["上装", "下装", "连衣裙 / 连体衣", "外套", "运动服", "内衣", "泳装", "睡衣 / 家居服", "童装 / 婴童", "制服 / 工装", "配饰", "其他"], ["上装", "下装"]],
          ["可生产款式", ["纽扣衬衫", "府绸上衣", "梭织连衣裙", "亚麻套装", "轻薄外套", "百褶裙", "罗纹上衣", "帆布托特包", "牛仔夹克", "泳装套装"], ["纽扣衬衫", "府绸上衣", "梭织连衣裙"]],
          ["市场层级", ["奢侈 / 高端", "高级成衣 / 当代品牌", "中端市场", "大众市场"], ["高级成衣 / 当代品牌"]]
        ],
      },
      {
        title: "专长、服务与工具",
        intro: "补充品牌会用于判断打样支持和生产配置的能力信息。",
        groups: [
          ["专长", ["内部制版房", "试身样 + 产前样", "小批量出口", "GOTS 棉", "水洗开发", "辅料采购", "QC 图片更新", "低起订量打样"], ["内部制版房", "试身样 + 产前样", "小批量出口", "GOTS 棉"]],
          ["设计服务", ["制版", "放码", "样衣开发", "Tech pack 支持", "全包生产 FPP", "仅 CMT"], ["全包生产 FPP"]],
          ["3D 和数字工具（选填）", ["CLO 3D", "Browzwear", "Lectra", "Gerber", "无"], []]
        ],
        equipmentLabel: "关键机器或设备",
        equipmentPlaceholder: "选填：绷缝机、套口机、刺绣、水洗、激光裁剪..."
      },
      {
        title: "产能与合作条件",
        intro: "填写每月可用工时和接单状态。我们会转化成品牌更容易理解的产能估算。",
        fields: [["最低起订量 MOQ", "例如：100 件 / 款"], ["常规交期", "例如：30-45 天"]],
        category: "梭织 — 基于你选择的生产类型",
        lineHoursLabel: "每月可用产线工时",
        referenceTitle: "基础梭织衬衫",
        referenceMeta: "约 18 分钟 / 件参考款",
        referenceCopy: "在品牌提供 tech pack 前，用这个参考款给出可比较的估算。",
        monthTitle: "每月接单状态",
        brandPreview: "品牌将看到：梭织 · 8 月可开始 · 当月约 4,800-8,000 件"
      },
      {
        title: "完成验证，获得更多曝光",
        intro: "我们会在后台审核这些资料。必填文件用于验证工厂身份，选填资料可以提升资料可信度。",
        businessLabel: "营业执照 / 公司注册文件 *",
        businessUpload: "点击或拖拽文件上传",
        businessHelper: "验证必填。",
        certificationLabel: "添加你已持有的认证",
        search: "搜索或选择认证",
        add: "添加认证",
        certifications: [["GOTS", "pending"], ["OEKO-TEX Standard 100", "uploaded"], ["BSCI", "pending"]],
        uploadCertificate: "点击或拖拽证书上传",
        uploadedCertificate: "证书已上传",
        deleteCertificate: "删除",
        certificateHelper: "PDF、PNG 或 JPG",
        reference: "客户参考",
        addReference: "+ 添加另一个客户参考",
        referenceHelper: "你曾合作过的品牌或零售商。"
      },
      {
        title: "添加工厂介绍视频",
        intro: "录制或上传一段连续的 2-4 分钟工厂介绍视频。无需剪辑。",
        laterNote: "你可以之后在资料页完成此步骤。",
        instructionTitle: "录制内容",
        instructionCopy: "从入口或前台开始，说出工厂名称、城市和当天日期。然后慢慢拍摄主要生产车间、物料或组件区域、关键机器或工位、质检区域，以及包装或仓库区域。",
        instructionMeta: "建议长度：2-4 分钟。最长：5 分钟。",
        checklistTitle: "视频应包括：",
        checklist: ["入口或前台", "主要生产车间", "物料 / 组件区域", "关键机器 / 工位", "质检区域", "包装或仓库"],
        optionTitle: "选择添加视频的方式（选填）",
        options: [["直接录制", "打开录制器，现在拍摄工厂介绍视频。"], ["上传视频", "上传已拍好的工厂介绍视频文件。"]]
      },
      {
        title: "确认你的工厂资料",
        intro: "请确认品牌将看到并用于匹配的主要信息。",
        sections: [
          ["工厂信息", [["工厂名称", "金线服装制造"], ["成立年份", "2016"], ["所在地", "中国东莞"], ["最近港口", "深圳"]]],
          ["生产匹配", [["生产类型", "针织裁剪缝制，梭织"], ["产品品类", "上装，下装，运动服"], ["可生产款式", "纽扣衬衫，府绸上衣，梭织连衣裙"], ["专长", "内部制版房，试身样 + 产前样，小批量出口，GOTS 棉"], ["市场层级", "高级成衣 / 当代品牌"], ["服务", "全包生产 FPP，制版"]]],
          ["产能与验证", [["MOQ", "100 件 / 款"], ["交期", "30-45 天"], ["产线工时", "2,400 小时 / 月"], ["估算件数", "8 月约 4,800-8,000 件"], ["接单状态", "8 月较空；9 月部分已订"], ["验证状态", "注册文件已上传；认证待补充"]]]
        ],
        cta: "确认"
      },
      {
        title: "条款与条件",
        intro: "继续前请阅读并签署平台条款。",
        terms: [
          ["平台使用", "请在 The Sourcing Club 上提供真实准确的工厂信息，专业回复品牌询盘，并将沟通内容用于相关采购合作机会。"],
          ["数据隐私与保密", "只上传你有权分享的文件和媒体。品牌询盘、技术包、报价和项目细节应予以保密，除非双方另有约定。"],
          ["工厂责任", "请及时更新工厂资料、产能、认证和联系方式。报价、交期和生产承诺应符合工厂实际可交付能力。"]
        ],
        agreement: "我已阅读并同意条款与条件",
        signature: "输入你的全名作为电子签名",
        cta: "签署并继续"
      },
      {
        title: "全部完成",
        intro: "你的工厂资料已提交。我们会审核你的验证文件，并在资料准备好后通知你，让品牌可以找到你的工厂。",
        cta: "进入控制台"
      }
    ],
    back: "上一步",
    next: "下一步"
  }
};

const factoryOnboardingSteps = onboardingCopy.en.steps;
const factoryScreens = [
  "dashboard",
  "browse",
  "rfqs",
  "projects",
  "detail",
  "profile",
  "profileCompletion",
  "messages",
  "saved",
  "billing",
  "settings",
  "rfqReadOnly",
  "projectDetail",
  "projectPostedUpdate",
  "quote",
  "reviewTotal",
  "quoteSent"
];

const factoryProjectMilestones = [
  {
    title: "Fit sample",
    meta: "Funded · due Aug 16",
    amount: "$120",
    description: "Factory prepares first sample and uploads sample photos for approval.",
    active: true
  },
  {
    title: "Lab dip / color",
    meta: "Awaiting brand approval",
    description: "Brand reviews fabric color standard before bulk materials are ordered."
  },
  {
    title: "Strike-off / print",
    meta: "Factory update due Aug 18",
    description: "Factory confirms print, embroidery, or construction details before bulk."
  },
  {
    title: "Size set / fit notes",
    meta: "Factory update due Aug 18",
    description: "Brand reviews graded sizes or fit notes when needed for the style."
  },
  {
    title: "Bulk deposit",
    meta: "Before shipment / QC photos",
    amount: "$1,656",
    description: "Final balance releases after QC photos and shipment details are confirmed."
  },
  {
    title: "QC photos",
    meta: "Before final payment",
    description: "Brand approves QC photos before final balance can release."
  },
  {
    title: "Final payment",
    meta: "Before shipment / QC photos",
    amount: "$1,656",
    description: "Final balance releases after QC photos and shipment details are confirmed."
  }
];

function getCapacityUnitRange(lineHours, minPercent = 60, maxPercent = 100) {
  const availableHours = Math.max(0, Number.parseInt(lineHours || "0", 10) || 0);
  const availableMinutes = availableHours * 60;
  const minUnits = Math.round((availableMinutes * (minPercent / 100)) / 18);
  const maxUnits = Math.round((availableMinutes * (maxPercent / 100)) / 18);
  return minUnits === maxUnits ? `${maxUnits}` : `${minUnits}-${maxUnits}`;
}

function App() {
  const query = new URLSearchParams(window.location.search);
  const requestedScreen = query.get("screen");
  const shouldForceOnboarding = requestedScreen === "onboarding" || query.get("onboarding") === "1" || query.get("view") === "onboarding";
  if (shouldForceOnboarding) {
    window.localStorage.removeItem("tscFactoryPrototypeScreen");
  }
  const savedScreen = window.localStorage.getItem("tscFactoryPrototypeScreen");
  const restoredScreen = !shouldForceOnboarding && factoryScreens.includes(requestedScreen)
    ? requestedScreen
    : !shouldForceOnboarding && factoryScreens.includes(savedScreen)
      ? savedScreen
      : "";
  const shouldOpenPrototypeScreen = Boolean(restoredScreen);
  const [onboardingComplete, setOnboardingComplete] = useState(shouldOpenPrototypeScreen);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingLanguage, setOnboardingLanguage] = useState("en");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [screen, setScreen] = useState(shouldOpenPrototypeScreen ? restoredScreen : "dashboard");
  const [detailBackTarget, setDetailBackTarget] = useState("browse");
  const [quoteBackTarget, setQuoteBackTarget] = useState("detail");
  const [capacityDrawerOpen, setCapacityDrawerOpen] = useState(false);
  const [activityDrawerOpen, setActivityDrawerOpen] = useState(false);
  const [dashboardCapacity, setDashboardCapacity] = useState("2400");
  const [creditBalance, setCreditBalance] = useState(factoryCreditStartingBalance);
  const [quoteSentUsesCredit, setQuoteSentUsesCredit] = useState(false);
  const [creditPurchaseOpen, setCreditPurchaseOpen] = useState(false);
  const selectedProject = brandProjects[0];
  const activeNav = screen === "dashboard" ? "Dashboard" : screen === "rfqs" || screen === "rfqReadOnly" ? "RFQs" : screen === "projects" || screen === "projectDetail" || screen === "projectPostedUpdate" ? "Production orders" : screen === "messages" ? "Conversations" : screen === "saved" ? "Saved" : screen === "billing" ? "Payments" : screen === "settings" ? "Settings" : screen === "profile" || screen === "profileCompletion" ? "" : "Browse RFQs";

  useEffect(() => {
    const mobileNav = window.matchMedia("(max-width: 760px)");
    const syncSidebar = () => setSidebarCollapsed(mobileNav.matches);
    mobileNav.addEventListener("change", syncSidebar);
    return () => mobileNav.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    if (sidebarCollapsed || !window.matchMedia("(max-width: 760px)").matches) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setSidebarCollapsed(true);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!onboardingComplete || !factoryScreens.includes(screen)) return;
    window.localStorage.setItem("tscFactoryPrototypeScreen", screen);
    window.history.replaceState(null, "", `${window.location.pathname}?screen=${screen}`);
  }, [onboardingComplete, screen]);

  const goToDashboard = () => {
    setScreen("dashboard");
  };

  if (!onboardingComplete) {
    return (
      <FactoryOnboarding
        language={onboardingLanguage}
        step={onboardingStep}
        onLanguageChange={setOnboardingLanguage}
        onEditSection={(targetStep) => {
          setOnboardingStep(targetStep);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        onBack={() => setOnboardingStep((value) => Math.max(0, value - 1))}
        onNext={() => {
          if (onboardingStep >= factoryOnboardingSteps.length - 1) {
            setOnboardingComplete(true);
            setScreen("dashboard");
          } else {
            setOnboardingStep((value) => value + 1);
          }
        }}
      />
    );
  }

  return (
    <div className={sidebarCollapsed ? "app-shell nav-collapsed factory-flow" : "app-shell factory-flow"}>
      <FactoryMainLanguageLayer language={onboardingLanguage} />
      <PrototypeSideNav
        account={{ initials: "AM", name: "Atelier Minho", type: "Factory account" }}
        active={activeNav}
        ariaLabel="Factory account"
        collapsed={sidebarCollapsed}
        navItems={nav}
        onNav={(label) => {
          if (label === "Dashboard") setScreen("dashboard");
          if (label === "RFQs") setScreen("rfqs");
          if (label === "Production orders") setScreen("projects");
          if (label === "Browse RFQs") setScreen("browse");
          if (label === "Conversations") setScreen("messages");
          if (label === "Saved") setScreen("saved");
          if (label === "Payments") setScreen("billing");
          if (label === "Settings") setScreen("settings");
        }}
        onProfile={() => setScreen("profile")}
        onToggle={() => setSidebarCollapsed((value) => !value)}
      />
      {!sidebarCollapsed && (
        <button
          className="mobile-nav-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setSidebarCollapsed(true)}
        />
      )}

      {screen === "dashboard" && (
        <FactoryDashboardPage
          language={onboardingLanguage}
          capacityValue={dashboardCapacity}
          creditBalance={creditBalance}
          onUpdateCapacity={() => setCapacityDrawerOpen(true)}
          onPurchaseCredits={() => setCreditPurchaseOpen(true)}
          onViewRfqs={() => setScreen("rfqs")}
          onViewRfqDetail={() => {
            setDetailBackTarget("browse");
            setScreen("detail");
          }}
          onViewProjects={() => setScreen("projects")}
          onOpenActivity={() => setActivityDrawerOpen(true)}
        />
      )}
      {screen === "profile" && (
        <FactoryProfilePage language={onboardingLanguage} onViewCompletion={() => setScreen("profileCompletion")} />
      )}
      {screen === "profileCompletion" && (
        <FactoryProfileCompletionPage onBack={() => setScreen("profile")} />
      )}
      {screen === "browse" && (
        <FactoryBrowsePage
          language={onboardingLanguage}
          onViewDetails={() => {
            setDetailBackTarget("browse");
            setScreen("detail");
          }}
        />
      )}
      {screen === "projects" && (
        <FactoryProjectsPage
          language={onboardingLanguage}
          onViewProject={() => setScreen("projectDetail")}
        />
      )}
      {screen === "rfqs" && (
        <FactoryRfqsPage
          language={onboardingLanguage}
          onBrowseRfqs={() => setScreen("browse")}
          onViewRequest={() => setScreen("rfqReadOnly")}
          onEditQuote={() => {
            setQuoteBackTarget("rfqs");
            setScreen("quote");
          }}
        />
      )}
      {screen === "saved" && (
        <FactorySavedPage
          language={onboardingLanguage}
          onViewBrand={() => {
            window.location.href = "/prototype.html?screen=profile&view=public";
          }}
          onViewRfq={() => {
            setDetailBackTarget("saved");
            setScreen("detail");
          }}
        />
      )}
      {screen === "messages" && (
        <main className="messages-page factory-messages-page">
          <FactoryMessagesScreen language={onboardingLanguage} />
        </main>
      )}
      {screen === "settings" && (
        <main className="settings-page-shell factory-settings-page">
          <FactorySettingsScreen language={onboardingLanguage} />
        </main>
      )}
      {screen === "billing" && (
        <main className="billing-page-shell factory-billing-page">
          <BillingScreen language={onboardingLanguage} creditBalance={creditBalance} quoteSent={quoteSentUsesCredit} />
        </main>
      )}
      {screen === "rfqReadOnly" && (
        <FactoryReadOnlyRfqPage
          project={selectedProject}
          language={onboardingLanguage}
          onBack={() => setScreen("rfqs")}
          onEdit={() => {
            setQuoteBackTarget("rfqs");
            setScreen("quote");
          }}
        />
      )}
      {screen === "detail" && (
        <FactoryProjectDetail
          project={selectedProject}
          language={onboardingLanguage}
          onBack={() => setScreen(detailBackTarget)}
          onSendQuote={() => {
            setQuoteBackTarget("detail");
            setScreen("quote");
          }}
        />
      )}
      {screen === "projectDetail" && (
        <FactoryProjectProgressDetail
          language={onboardingLanguage}
          onBack={() => setScreen("projects")}
          onPostUpdate={() => setScreen("projectPostedUpdate")}
        />
      )}
      {screen === "projectPostedUpdate" && (
        <FactoryProjectProgressDetail
          language={onboardingLanguage}
          onBack={() => setScreen("projects")}
          onPostUpdate={() => setScreen("projectPostedUpdate")}
          showPostedUpdate
        />
      )}
      {screen === "quote" && (
        <FactorySubmitQuote
          project={selectedProject}
          language={onboardingLanguage}
          backLabel={quoteBackTarget === "rfqs" ? "‹ Back to RFQs" : "‹ Back to view request"}
          onBack={() => setScreen(quoteBackTarget)}
          onReviewTotal={() => setScreen("reviewTotal")}
        />
      )}
      {screen === "reviewTotal" && (
        <FactoryReviewTotal
          project={selectedProject}
          language={onboardingLanguage}
          onBack={() => setScreen("quote")}
          onEdit={() => setScreen("quote")}
          creditBalance={creditBalance}
          onPurchaseCredits={() => setCreditPurchaseOpen(true)}
          onSendQuote={() => {
            if (!quoteSentUsesCredit) {
              setCreditBalance((current) => Math.max(0, current - factoryQuoteCreditCost.credits));
              setQuoteSentUsesCredit(true);
            }
            setScreen("quoteSent");
          }}
        />
      )}
      {screen === "quoteSent" && (
        <FactoryQuoteSent
          project={selectedProject}
          language={onboardingLanguage}
          creditBalance={creditBalance}
          onBack={() => setScreen("quote")}
          onDashboard={goToDashboard}
        />
      )}
      {capacityDrawerOpen && (
        <FactoryCapacityDrawer
          language={onboardingLanguage}
          initialCapacity={dashboardCapacity}
          onClose={() => setCapacityDrawerOpen(false)}
          onSaveCapacity={(value) => {
            setDashboardCapacity(value || "0");
            setCapacityDrawerOpen(false);
          }}
        />
      )}
      {activityDrawerOpen && <FactoryActivityDrawer language={onboardingLanguage} onClose={() => setActivityDrawerOpen(false)} />}
      {creditPurchaseOpen && (
        <CreditPurchaseModal language={onboardingLanguage} onClose={() => setCreditPurchaseOpen(false)} />
      )}
    </div>
  );
}

function FactoryDashboardPage({ language, capacityValue, creditBalance, onUpdateCapacity, onPurchaseCredits, onViewRfqs, onViewRfqDetail, onViewProjects, onOpenActivity }) {
  const capacityUnits = getCapacityUnitRange(capacityValue);
  const [inviteFactoryOpen, setInviteFactoryOpen] = useState(false);
  const tx = (value) => (language === "zh" ? translateFactoryMainText(value) : value);
  const creditCardCopy = language === "zh"
    ? {
        label: "剩余额度",
        value: `${creditBalance} 额度`,
        description: "500 额度 = $50 价值。邀请已验证工厂可再获得 500 额度。",
        purchase: "购买额度",
        invite: "邀请工厂"
      }
    : {
        label: "Remaining credits",
        value: `${creditBalance} credits`,
        description: "500 credits = $50 value. Invite a verified factory to earn 500 more.",
        purchase: "Purchase credits",
        invite: "Invite factory"
      };

  return (
    <main className="factory-dashboard-page">
      <div className="factory-dashboard-shell">
        <header className="factory-dashboard-header">
          <h1>{language === "zh" ? "你好，Atelier Minho" : "Hi Atelier Minho"}</h1>
          <button className="activity-icon-btn" type="button" onClick={onOpenActivity} aria-label="Open activity">
            <img src="/assets/prototype-icons/notification.svg" alt="" />
            <b aria-hidden="true">4</b>
          </button>
        </header>

        <section className="factory-dashboard-grid" aria-label="Factory dashboard overview">
          <div className="factory-dashboard-main-stack">
            <div className="factory-dashboard-metrics">
              <FactoryMetricCard label={tx("Open RFQs")} value="7" note={tx("+3 invited this week")} tone="blue" />
              <FactoryMetricCard label={tx("Quotes sent this month")} value="14" note={tx("4 awaiting brand review")} tone="green" />
              <FactoryMetricCard label={tx("Active production orders")} value="5" note={tx("2 need sample updates")} tone="amber" />
            </div>

            <FactoryDashboardPanel
              className="factory-rfq-invites-panel"
              title={tx("RFQ invites")}
              subtitle={tx("Prioritized requests that match your capacity and capabilities.")}
              action={tx("View all")}
              onAction={onViewRfqs}
            >
              {factoryRfqs.slice(0, 4).map((rfq) => (
                <FactoryDashboardRfqRow rfq={rfq} language={language} onView={onViewRfqDetail} key={rfq.title} />
              ))}
            </FactoryDashboardPanel>
          </div>

          <div className="factory-dashboard-side-stack">
            <section className="factory-dashboard-capacity">
              <span>{tx("August capacity")}</span>
              <strong>{tx("Mostly open")}</strong>
              <div className="capacity-chip-row">
                <span>{tx("Open August")}</span>
                <span>{language === "zh" ? `产能 ${capacityUnits} 件` : `Capacity ${capacityUnits} units`}</span>
              </div>
              <button className="primary-btn" type="button" onClick={onUpdateCapacity}>{tx("Update capacity")}</button>
            </section>

            <section className="factory-dashboard-credit-card">
              <div>
                <span>{creditCardCopy.label}</span>
                <strong>{creditCardCopy.value}</strong>
                <p>{creditCardCopy.description}</p>
              </div>
              <div className="factory-dashboard-credit-actions">
                <button className="primary-btn compact-btn" type="button" onClick={onPurchaseCredits}>{creditCardCopy.purchase}</button>
                <button className="secondary-btn compact-btn" type="button" onClick={() => setInviteFactoryOpen(true)}>{creditCardCopy.invite}</button>
              </div>
            </section>

            <FactoryDashboardPanel
              className="factory-brand-messages-panel"
              title="Needs your attention"
              subtitle="Priority RFQs, messages, and production steps."
              preHeader={<FactoryDashboardCallCard language={language} />}
            >
              <FactoryAttentionCard
                type="Question"
                tone="info"
                title="Maison Rue asked about sample costs"
                meta="Split fit and PP sample cost before quote review."
                action="Reply"
              />
              <FactoryAttentionCard
                type="Capacity"
                tone="danger"
                title="Update August capacity"
                meta="Your capacity is marked mostly open for new RFQ matches."
                action="Update"
                onAction={onUpdateCapacity}
              />
              <FactoryAttentionCard
                type="Verification"
                tone="success"
                title="Review verification renewal"
                meta="TSC ops needs updated documents this month."
                action="Review"
              />
              <FactoryAttentionCard
                type="Sample"
                tone="warning"
                title="Upload sample update"
                meta="Add fit-sample notes for the active Maison Rue order."
                action="Update"
                onAction={onViewProjects}
              />
            </FactoryDashboardPanel>
          </div>

          <FactoryDashboardPanel
            className="factory-active-projects-panel"
            title="Active production orders"
            subtitle="Track current orders and next action dates."
            action="View all"
            onAction={onViewProjects}
          >
            {factoryProjects.slice(0, 2).map((project) => (
              <FactoryProjectDashboardRow project={project} language={language} onView={onViewProjects} key={project.title} />
            ))}
          </FactoryDashboardPanel>
        </section>
      </div>
      {inviteFactoryOpen && (
        <InviteFactoryModal language={language} onClose={() => setInviteFactoryOpen(false)} />
      )}
    </main>
  );
}

const factoryPassiveActivityItems = [
  {
    type: "RFQ",
    title: "New RFQ match added to your invite list",
    meta: "Premium knit capsule for resort drop",
    time: "18 min ago",
    unread: true
  },
  {
    type: "File",
    title: "Maison Rue downloaded your sample cost sheet",
    meta: "Organic cotton woven shirt production",
    time: "1 hr ago",
    unread: true
  },
  {
    type: "Status",
    title: "Fit sample milestone moved to brand review",
    meta: "Washed denim overshirt reorder",
    time: "Yesterday"
  },
  {
    type: "Profile",
    title: "Your GOTS certificate was viewed 6 times",
    meta: "Factory profile activity",
    time: "Jul 22"
  }
];

function getFactoryActivityCopy(value) {
  const copy = {
    "Activity": "动态",
    "Passive updates from RFQs, files, brands, and production.": "来自询价、文件、品牌和生产订单的被动更新。",
    "Close activity": "关闭动态",
    "RFQ": "询价",
    "File": "文件",
    "Status": "状态",
    "Profile": "资料",
    "18 min ago": "18 分钟前",
    "1 hr ago": "1 小时前",
    "Yesterday": "昨天",
    "Jul 22": "7 月 22 日",
    "New RFQ match added to your invite list": "新的询价匹配已加入你的邀请列表",
    "Maison Rue downloaded your sample cost sheet": "Maison Rue 下载了你的样品费用表",
    "Fit sample milestone moved to brand review": "试身样里程碑已进入品牌审核",
    "Your GOTS certificate was viewed 6 times": "你的 GOTS 证书已被查看 6 次",
    "Washed denim overshirt reorder": "水洗牛仔衬衫外套复单",
    "Factory profile activity": "工厂资料动态"
  };

  return copy[value] || getTranslatedProjectTitle(value);
}

function InviteFactoryModal({ language = "en", onClose }) {
  const copy = language === "zh"
    ? {
        close: "关闭邀请工厂弹窗",
        title: "邀请工厂",
        intro: "发送邀请链接给你信任的工厂。对方完成入驻并通过验证后，双方都会获得 500 额度。",
        email: "工厂邮箱",
        message: "留言",
        defaultMessage: "我觉得 The Sourcing Club 可能适合你的工厂。如果你加入并通过验证，我们双方都可以获得 500 报价额度。",
        cancel: "取消",
        send: "发送邀请"
      }
    : {
        close: "Close invite factory",
        title: "Invite a factory",
        intro: "Send an invite link to a factory you trust. When they onboard and get verified, both accounts earn 500 credits.",
        email: "Factory email",
        message: "Message",
        defaultMessage: "I thought The Sourcing Club could be useful for your factory. If you join and get verified, we both earn 500 quote credits.",
        cancel: "Cancel",
        send: "Send invite"
      };
  return createPortal((
    <div className="factory-update-modal-layer factory-invite-modal-layer" role="presentation">
      <div className="factory-update-modal factory-invite-modal" role="dialog" aria-modal="true" aria-labelledby="factory-invite-title">
        <CloseIconButton className="factory-update-close" label={copy.close} onClick={onClose} />
        <header>
          <h2 id="factory-invite-title">{copy.title}</h2>
          <p>{copy.intro}</p>
        </header>

        <label className="factory-invite-field">
          <span>{copy.email}</span>
          <input type="email" placeholder="name@factory.com" />
        </label>

        <label className="factory-invite-field">
          <span>{copy.message}</span>
          <textarea defaultValue={copy.defaultMessage} />
        </label>

        <footer>
          <button className="secondary-btn" type="button" onClick={onClose}>{copy.cancel}</button>
          <button className="primary-btn" type="button" onClick={onClose}>{copy.send}</button>
        </footer>
      </div>
    </div>
  ), document.body);
}

function FactoryActivityDrawer({ language = "en", onClose }) {
  const isZh = language === "zh";
  const tx = (value) => (isZh ? getFactoryActivityCopy(value) : value);

  return createPortal((
    <div className="activity-drawer-layer" role="presentation">
      <button className="activity-drawer-scrim" type="button" aria-label={tx("Close activity")} onClick={onClose} />
      <aside className="activity-drawer" role="dialog" aria-modal="true" aria-labelledby="factory-activity-drawer-title">
        <header className="activity-drawer-header">
          <div>
            <h2 id="factory-activity-drawer-title">{tx("Activity")}</h2>
            <p>{tx("Passive updates from RFQs, files, brands, and production.")}</p>
          </div>
          <button className="activity-close-btn" type="button" aria-label={tx("Close activity")} onClick={onClose}>
            <img src="/assets/prototype-icons/close.svg" alt="" />
          </button>
        </header>
        <div className="activity-drawer-list">
          {factoryPassiveActivityItems.map((item) => (
            <article className={item.unread ? "activity-drawer-item unread" : "activity-drawer-item"} key={item.title}>
              <div>
                <div className="activity-drawer-meta">
                  <span>{tx(item.type)}</span>
                  <time>{tx(item.time)}</time>
                </div>
                <h3>{tx(item.title)}</h3>
                <p>{tx(item.meta)}</p>
              </div>
            </article>
          ))}
        </div>
      </aside>
    </div>
  ), document.body);
}

const factoryProfileData = {
  name: "Atelier Minho",
  location: "Porto, Portugal",
  nearestPort: "Port of Leixoes",
  founded: "2016",
  website: "www.atelierminho.pt",
  registrationDate: "Feb 2016",
  employees: "120",
  registeredCapital: "€500k",
  responseTime: "1 day",
  rating: "4.8",
  reviews: "29",
  clubOrders: "12",
  repeatBrands: "7",
  profileVerified: "Business registration verified",
  intro:
    "Premium cut-and-sew partner for woven shirts, lightweight tops, bottoms, and contemporary capsule production. Best for brands that need sampling support, clear production communication, and smaller paid production runs.",
  productionTypes: ["Cut & sew knits", "Wovens"],
  categories: ["Tops", "Bottoms", "Activewear", "Outerwear"],
  makes: ["Button-down shirts", "Poplin blouses", "Woven dresses"],
  marketLevel: "Premium / contemporary",
  services: ["Full package (FPP)", "Pattern making", "Sample development", "Tech pack support", "Grading"],
  tools: ["CLO 3D", "Lectra", "Gerber"],
  specialties: ["Organic poplin shirts", "Low-MOQ woven tops", "Fit sample development", "Small capsule production", "QC photo reporting"],
  moq: "100 units / style",
  leadTime: "30-45 days",
  lineHours: "2,400 hours / month",
  capacityCategoryKey: "wovens",
  capacityInputMode: "units",
  capacityMonthlyUnits: "7200",
  capacityMonthSelections: {
    Aug: "open",
    Sep: "partial",
    Oct: "full"
  },
  capacityEstimate: "Aug roughly 4,800-8,000 woven shirts",
  booking: "Aug mostly open; Sep partly booked",
  referenceStyle: "Basic woven shirt · ~18 min/pc",
  certifications: [
    { name: "Business registration", status: "Verified" },
    { name: "OEKO-TEX Standard 100", status: "Uploaded" },
    { name: "GOTS", status: "Not uploaded" },
    { name: "BSCI", status: "Not uploaded" }
  ],
  walkthrough: ["Entrance or reception", "Main production floor", "Materials/components", "Quality control area", "Packing or warehouse"],
  references: ["Maison Rue", "Elara Studio", "Northline"],
  products: [
    { title: "Organic cotton poplin shirt", meta: "Wovens · MOQ 100", src: "/assets/dashboard-rfq-shirt.jpg" },
    { title: "Fine-gauge knit capsule", meta: "Knitwear · sample room", src: "/assets/dashboard-rfq-knit.jpg" },
    { title: "Denim jacket development", meta: "Denim · wash sample", src: "/assets/dashboard-rfq-denim.jpg" }
  ],
  pastProjects: [
    {
      title: "Organic cotton woven shirt production",
      brand: "Maison Rue",
      date: "May 2026 - Jul 2026",
      result: "Completed on time",
      summary: "Fit and PP sample path for 300 organic cotton poplin shirts, followed by small-batch production.",
      rating: "5.0",
      review: "Clear sample updates, careful sewing, and quick communication through approval rounds.",
      tags: ["Wovens", "Fit sample", "PP sample", "Low MOQ", "Responsive"]
    },
    {
      title: "Resort knit capsule sampling",
      brand: "Elara Studio",
      date: "Feb 2026 - Apr 2026",
      result: "Repeat brand",
      summary: "Sample-room support, yarn sourcing coordination, and size-set development for lightweight knit tops.",
      rating: "4.8",
      review: "Strong fit support and good production planning for a small capsule with changing color direction.",
      tags: ["Knitwear", "Sample room", "Yarn sourcing", "Premium", "Solution oriented"]
    }
  ],
  inProductionProjects: [
    {
      title: "Organic poplin shirt bulk",
      brand: "Maison Rue",
      date: "Started Jul 19",
      result: "Fit sample",
      summary: "Factory is preparing fit sample photos and construction notes before PP sample approval.",
      rating: "Active",
      review: "Next update due Aug 16; brand approval unlocks the next sample milestone.",
      tags: ["Wovens", "Fit sample", "Sample approval", "QC photos"]
    },
    {
      title: "Lightweight knit resort capsule",
      brand: "Luna Resort",
      date: "Started Jul 12",
      result: "Lab dip review",
      summary: "Lab dip and yarn color review are in progress before bulk materials are ordered.",
      rating: "Active",
      review: "Factory uploaded lab dip notes; brand review is pending.",
      tags: ["Knitwear", "Lab dip", "Yarn sourcing", "Color review"]
    }
  ]
};

const factoryProfileEditorOptions = {
  productionTypes: ["Cut & sew knits", "Wovens", "Sweaters / knitwear", "Denim", "Seamless / circular knit", "Intimates / delicate garments", "Leather / suede", "Bags / soft goods"],
  categories: ["Tops", "Bottoms", "Dresses & jumpsuits", "Outerwear", "Activewear", "Intimates / underwear", "Swimwear", "Sleepwear / loungewear", "Childrenswear / baby", "Uniforms / workwear", "Accessories"],
  makes: ["Button-down shirts", "Poplin blouses", "Woven dresses", "Linen co-ords", "Lightweight jackets", "Pleated skirts", "Rib tops", "Canvas totes", "Denim jackets", "Swim sets"],
  marketLevel: ["Luxury / high-end", "Premium / contemporary", "Mid range", "Mass market"],
  services: ["Pattern making", "Grading", "Sample development", "Tech pack support", "Full package (FPP)", "CMT only"],
  specialties: ["In-house pattern room", "Fit sample + PP sample", "Small-batch export", "GOTS cotton", "Wash development", "Trim sourcing", "QC photo updates", "Low-MOQ sampling", "Organic poplin shirts", "Low-MOQ woven tops"],
  tools: ["CLO 3D", "Browzwear", "Lectra", "Gerber", "None"]
};

function FactoryProfilePage({ language, onViewCompletion }) {
  const isZh = language === "zh";
  const [profileData, setProfileData] = useState(factoryProfileData);
  const data = profileData;
  const [projectTab, setProjectTab] = useState("completed");
  const [profileMode, setProfileMode] = useState(new URLSearchParams(window.location.search).get("view") === "public" ? "public" : "edit");
  const [activeEditor, setActiveEditor] = useState(null);
  const isOwnerView = profileMode === "edit";
  const visibleProjects = projectTab === "completed" ? data.pastProjects : data.inProductionProjects;
  const openEditor = (editor) => {
    setProfileMode("edit");
    setActiveEditor(editor);
  };
  const saveProfileSection = (updates) => {
    setProfileData((current) => ({ ...current, ...updates }));
    setActiveEditor(null);
  };
  const overviewRows = [
    ["Factory name", data.name],
    ["Year founded", data.founded],
    ["Website URL", data.website],
    ["Factory location", data.location],
    ["Nearest port", data.nearestPort],
    ["Total employees", data.employees]
  ];
  const capacityRows = [
    ["MOQ", data.moq],
    ["Typical lead time", data.leadTime],
    ["Line-hours", data.lineHours],
    ["Estimated capacity", data.capacityEstimate],
    ["Booking level", data.booking],
    ["Reference style", data.referenceStyle]
  ];
  const renderProfileStatusCard = (responsiveClass) => (
    <section className={`factory-profile-card factory-profile-owner-card ${responsiveClass}`}>
      <div className="factory-profile-card-header">
        <h2>Profile status</h2>
        <button className="factory-profile-edit-button" type="button" onClick={onViewCompletion}>See details</button>
      </div>
      <div className="factory-profile-status-meter">
        <strong>88%</strong>
        <span>Profile complete</span>
      </div>
      <div className="factory-profile-status-track"><span /></div>
      <p>Add the remaining certifications and keep monthly capacity current to strengthen this profile.</p>
      <div className="factory-profile-owner-actions">
        <button className="primary-btn" type="button">Publish changes</button>
      </div>
    </section>
  );
  const renderContactCard = (responsiveClass) => (
    <section className={`factory-profile-card factory-profile-contact-card ${responsiveClass}`}>
      <h2>Contact supplier</h2>
      <div className="factory-profile-contact-row">
        <div className="factory-avatar">AM</div>
        <div>
          <strong data-no-translate>{data.name}</strong>
          <span data-no-translate>{data.location}</span>
        </div>
      </div>
      <button className="primary-btn" type="button">Contact factory</button>
    </section>
  );

  return (
    <main className={`factory-profile-page ${isOwnerView ? "is-owner-view" : "is-public-view"}`}>
      <div className="factory-profile-shell">
        <ProfileOwnerBar
          ariaLabel="Profile view mode"
          isOwnerView={isOwnerView}
          onEdit={() => isOwnerView ? openEditor("overview") : setProfileMode("edit")}
          onPublic={() => setProfileMode("public")}
          ownerText="Edit what brands see"
          profileLabel="Factory profile"
        />

        {isOwnerView && renderProfileStatusCard("factory-profile-compact-status-card")}
        {!isOwnerView && renderContactCard("factory-profile-compact-contact-card")}

        <section className="factory-profile-hero">
          {isOwnerView && <button className="factory-profile-banner-edit" type="button" onClick={() => openEditor("banner")}>Edit</button>}
          {!isOwnerView && <button className="factory-profile-banner-edit" type="button" onClick={() => setProfileMode("edit")}>Save factory</button>}
          <div className="factory-profile-identity">
            <div className="factory-profile-logo-wrap">
              <div className="factory-profile-logo">AM</div>
            </div>
            <div>
              <div className="factory-profile-title-row">
                <h1 data-no-translate>{data.name}</h1>
                <span className="factory-profile-verified" title={data.profileVerified} aria-label={data.profileVerified}>
                  <img src="/assets/prototype-icons/basic.svg" alt="" />
                </span>
              </div>
              <p data-no-translate>{data.location} · {data.nearestPort} · {data.employees} employees</p>
              <div className="tag-row compact-tags factory-profile-hero-tags">
                {data.productionTypes.map((tag) => <span className="tag garment-tag" key={tag}>{tag}</span>)}
                <span className="tag garment-tag">{data.marketLevel}</span>
              </div>
            </div>
          </div>
        </section>

        <div className="factory-profile-layout">
          <section className="factory-profile-main">
            <ProfilePerformanceCard
              eyebrow="Factory performance"
              primary={data.rating}
              primaryLabel={`${data.reviews} reviews · ${data.responseTime} avg. response`}
              metrics={[
                { label: "Club orders", value: data.clubOrders },
                { label: "Repeat brands", value: data.repeatBrands },
                { label: "Lead time", value: data.leadTime }
              ]}
            />

            <section className="factory-profile-card">
              <ProfileCardHeader title="Overview" editable={isOwnerView} onEdit={() => openEditor("overview")} />
              <p>{data.intro}</p>
              <div className="factory-profile-detail-grid">
                {overviewRows.map(([label, value]) => <ProfileDetailPair label={label} value={value} key={label} />)}
              </div>
            </section>

            <section className="factory-profile-card">
              <ProfileCardHeader title="Production fit" editable={isOwnerView} onEdit={() => openEditor("production")} />
              <ProfileChipSection label="Production type" items={data.productionTypes} />
              <ProfileChipSection label="Product categories" items={data.categories} />
              <ProfileChipSection label="Makes" items={data.makes} />
              <ProfileChipSection label="Services" items={data.services} />
              <ProfileChipSection label="Specialties" items={data.specialties} />
              <ProfileChipSection label="Digital tools" items={data.tools} />
            </section>

            <section className="factory-profile-card">
              <ProfileCardHeader title="Capacity and terms" editable={isOwnerView} onEdit={() => openEditor("capacity")} />
              <div className="factory-profile-detail-grid">
                {capacityRows.map(([label, value]) => <ProfileDetailPair label={label} value={value} key={label} />)}
              </div>
            </section>

            <section className="factory-profile-card">
              <ProfileCardHeader title="Factory walkthrough" editable={isOwnerView} actionLabel="Manage video" onEdit={() => openEditor("walkthrough")} />
              <div className="factory-profile-video-card">
                <div className="factory-profile-video-preview">
                  <img src="/assets/factory-header.png" alt="Factory walkthrough preview" />
                  <span>2:48</span>
                </div>
                <div>
                  <strong>Verified production-floor walkthrough</strong>
                  <p>Continuous facility walkthrough covering the core areas requested during onboarding.</p>
                  <div className="tag-row compact-tags">
                    {data.walkthrough.map((item) => <span className="tag garment-tag" key={item}>{item}</span>)}
                  </div>
                </div>
              </div>
            </section>

            <section className="factory-profile-card">
              <ProfileCardHeader title="Samples developed" editable={isOwnerView} actionLabel="Manage images" onEdit={() => openEditor("samples")} />
              <div className="factory-profile-product-grid">
                {data.products.map((product) => (
                  <article className="factory-profile-product" key={product.title}>
                    <img src={product.src} alt={`${product.title} reference`} />
                    <strong>{product.title}</strong>
                    <span>{product.meta}</span>
                  </article>
                ))}
              </div>
            </section>

            <section className="factory-profile-card">
              <div className="factory-profile-section-header">
                <div>
                  <h2>Past projects</h2>
                  <p>Completed TSC orders with brand feedback, project scope, and production strengths.</p>
                </div>
                {isOwnerView && <span className="factory-profile-sync-pill">Auto-added</span>}
              </div>
              <div className="factory-profile-project-tabs" role="tablist" aria-label="Past project status">
                <button
                  className={projectTab === "completed" ? "active" : ""}
                  type="button"
                  onClick={() => setProjectTab("completed")}
                  role="tab"
                  aria-selected={projectTab === "completed"}
                >
                  Completed ({data.pastProjects.length})
                </button>
                <button
                  className={projectTab === "inProduction" ? "active" : ""}
                  type="button"
                  onClick={() => setProjectTab("inProduction")}
                  role="tab"
                  aria-selected={projectTab === "inProduction"}
                >
                  In production ({data.inProductionProjects.length})
                </button>
              </div>
              <div className="factory-profile-project-list">
                {visibleProjects.map((project) => (
                  <article className="factory-profile-history-card" key={project.title}>
                    <header>
                      <div>
                        <h3>{project.title}</h3>
                        <p>{project.brand} · {project.date}</p>
                      </div>
                      <span>{project.result}</span>
                    </header>
                    <p>{project.summary}</p>
                    {projectTab === "completed" && (
                      <div className="factory-profile-history-review">
                        <strong>{project.rating}</strong>
                        <p>"{project.review}"</p>
                      </div>
                    )}
                    <div className="factory-profile-history-footer">
                      <div className="tag-row compact-tags">
                        {project.tags.map((tag) => <span className="tag garment-tag" key={tag}>{tag}</span>)}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </section>

          <aside className="factory-profile-side">
            {isOwnerView ? (
              renderProfileStatusCard("factory-profile-sidebar-status-card")
            ) : (
              renderContactCard("factory-profile-sidebar-contact-card")
            )}

            <section className="factory-profile-card">
              <ProfileCardHeader title="Verification" editable={isOwnerView} actionLabel="Manage docs" onEdit={() => openEditor("verification")} />
              <div className="factory-profile-cert-list">
                {data.certifications.map((cert) => (
                  <div className="factory-profile-cert" key={cert.name}>
                    <strong>{cert.name}</strong>
                    <span className={cert.status === "Verified" || cert.status === "Uploaded" ? "verified" : ""}>{cert.status}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="factory-profile-card">
              <ProfileCardHeader title="Client references" editable={isOwnerView} actionLabel="Edit" onEdit={() => openEditor("references")} />
              <div className="factory-profile-reference-list">
                {data.references.map((reference) => (
                  <div key={reference}>
                    <span>{reference.slice(0, 2).toUpperCase()}</span>
                    <strong>{reference}</strong>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
      {activeEditor && createPortal((
        <FactoryProfileEditModal
          editor={activeEditor}
          data={data}
          onClose={() => setActiveEditor(null)}
          onSave={saveProfileSection}
        />
      ), document.body)}
    </main>
  );
}

const profileCompletionChecks = [
  {
    title: "Factory identity",
    status: "Verified",
    tone: "complete",
    description: "Factory name, location, nearest port, company registration date, employee count, and registered capital are complete."
  },
  {
    title: "Production fit",
    status: "Verified",
    tone: "complete",
    description: "Production type, product categories, make tags, services, specialties, market level, and digital tools are filled in."
  },
  {
    title: "Capacity and terms",
    status: "Verified",
    tone: "complete",
    description: "MOQ, lead time, booking level, reference style, and estimated monthly capacity are visible to brands."
  },
  {
    title: "Client proof",
    status: "Verified",
    tone: "complete",
    description: "Completed projects, repeat-brand history, client references, and sample work are attached to support buyer trust."
  },
  {
    title: "Verification documents",
    status: "In review",
    tone: "progress",
    description: "Business registration is verified and OEKO-TEX is uploaded. GOTS and BSCI are still pending, so verified-certification matching is not fully unlocked yet."
  },
  {
    title: "Factory walkthrough",
    status: "Verified",
    tone: "complete",
    description: "The walkthrough video is present and covers the core production areas requested during onboarding."
  },
  {
    title: "GOTS certificate",
    status: "Needs attention",
    tone: "missing",
    description: "Upload the certificate file or remove the pending certification if it is not currently held.",
    action: "Upload certificate"
  },
  {
    title: "Monthly capacity freshness",
    status: "Needs attention",
    tone: "missing",
    description: "August capacity is available, but the profile needs the latest monthly update to improve RFQ matching confidence.",
    action: "Update capacity"
  },
];

const profileCompletionIconMap = {
  complete: "/assets/prototype-icons/done.svg",
  progress: "/assets/prototype-icons/pending.svg",
  missing: "/assets/prototype-icons/warning.svg"
};

function FactoryProfileCompletionPage({ onBack }) {
  const completeCount = profileCompletionChecks.filter((item) => item.tone === "complete").length;
  const progressCount = profileCompletionChecks.filter((item) => item.tone === "progress").length;
  const attentionCount = profileCompletionChecks.filter((item) => item.tone === "missing").length;

  return (
    <main className="factory-profile-page factory-profile-completion-page">
      <div className="factory-profile-shell">
        <button className="text-link factory-profile-completion-back" type="button" onClick={onBack}>‹ Back to profile</button>

        <section className="factory-profile-completion-hero">
          <div>
            <span>Profile verification</span>
            <h1>Profile completion summary</h1>
            <p>You can publish and receive matching RFQs now. Complete the items below to improve trust signals and help brands understand the factory faster.</p>
          </div>
          <div className="factory-profile-completion-score">
            <strong>88%</strong>
            <span>Profile complete</span>
            <div className="factory-profile-status-track"><span /></div>
          </div>
        </section>

        <section className="factory-profile-completion-layout">
          <div className="factory-profile-completion-main">
            <section className="factory-profile-card factory-profile-completion-group">
              <div className="factory-profile-section-header">
                <div>
                  <h2>Verification checklist</h2>
                  <p>Each item shows whether brands can rely on it now, whether TSC is still reviewing it, or whether action is needed.</p>
                </div>
              </div>
              <div className="profile-completion-check-list">
                {profileCompletionChecks.map((item) => (
                  <article className={`profile-completion-check ${item.tone}`} key={item.title}>
                    <span className="profile-completion-check-icon" aria-hidden="true">
                      <img src={profileCompletionIconMap[item.tone]} alt="" />
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.status}</small>
                      <p>{item.description}</p>
                      {item.action && <button className="secondary-btn compact-btn" type="button">{item.action}</button>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <aside className="factory-profile-side">
            <section className="factory-profile-card">
              <h2>Summary</h2>
              <div className="profile-completion-summary-grid">
                <ProfileCompletionSummaryRow label="Verified" value={`${completeCount} items`} />
                <ProfileCompletionSummaryRow label="In review" value={`${progressCount} items`} />
                <ProfileCompletionSummaryRow label="Needs attention" value={`${attentionCount} items`} />
              </div>
            </section>
            <section className="factory-profile-card">
              <h2>Suggested updates</h2>
              <div className="factory-profile-owner-task-list">
                <span>Upload GOTS certificate</span>
                <span>Add August available capacity</span>
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}

function FactoryProfileEditModal({ editor, data, onClose, onSave }) {
  const isSimpleMediaEditor = ["banner", "walkthrough", "samples", "projects"].includes(editor);
  const editorTitles = {
    overview: ["Edit overview", "Update the factory details brands see at the top of this profile."],
    production: ["Edit production fit", "Update the production tags brands use to find and evaluate this factory."],
    capacity: ["Edit capacity and terms", "Keep MOQ, lead time, booking level, and capacity estimates current."],
    references: ["Edit client references", "Add or update the brand references shown on the public profile."],
    banner: ["Edit profile images", "Upload or replace the profile image and banner image used on this profile."],
    walkthrough: ["Manage walkthrough", "Update the verified production-floor walkthrough and covered areas."],
    samples: ["Update sample images", "Add images of sample garments, development examples, and finished pieces that represent the factory's strongest production fit."],
    projects: ["Manage projects", "Update completed and in-production project proof for brands."],
    verification: ["Manage verification documents", "Upload certificates and registration documents for profile review."]
  };
  const [title, helper] = editorTitles[editor] || editorTitles.overview;
  const [form, setForm] = useState(() => ({
    name: data.name,
    location: data.location,
    nearestPort: data.nearestPort,
    founded: data.founded,
    website: data.website,
    registrationDate: data.registrationDate,
    employees: data.employees,
    registeredCapital: data.registeredCapital,
    intro: data.intro,
    moq: data.moq,
    leadTime: data.leadTime,
    lineHoursInput: data.lineHours.replace(/\D/g, "") || "2400",
    lineHours: data.lineHours,
    capacityCategoryKey: data.capacityCategoryKey,
    capacityInputMode: data.capacityInputMode,
    capacityMonthlyUnits: data.capacityMonthlyUnits,
    capacityMonthSelections: data.capacityMonthSelections,
    capacityEstimate: data.capacityEstimate,
    booking: data.booking,
    referenceStyle: data.referenceStyle,
    productionTypes: data.productionTypes,
    categories: data.categories,
    makes: data.makes,
    marketLevel: [data.marketLevel],
    services: data.services,
    specialties: data.specialties,
    tools: data.tools,
    referencesText: data.references.join("\n"),
    certifications: data.certifications
  }));
  const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = () => {
    if (editor === "overview") {
      onSave({
        name: form.name,
        location: form.location,
        nearestPort: form.nearestPort,
        founded: form.founded,
        website: form.website,
        employees: form.employees,
        intro: form.intro
      });
      return;
    }

    if (editor === "production") {
      onSave({
        productionTypes: form.productionTypes,
        categories: form.categories,
        makes: form.makes,
        marketLevel: form.marketLevel[0] || data.marketLevel,
        services: form.services,
        specialties: form.specialties,
        tools: form.tools
      });
      return;
    }

    if (editor === "capacity") {
      const category = FACTORY_CAPACITY_CATEGORIES.find((item) => item.key === form.capacityCategoryKey) || FACTORY_CAPACITY_CATEGORIES[1];
      const activeMonth = "Aug";
      const activeLevel = form.capacityMonthSelections?.[activeMonth] || "open";
      const levelRanges = {
        open: { label: "mostly open", min: 60, max: 100 },
        partial: { label: "partly booked", min: 25, max: 60 },
        full: { label: "mostly full", min: 0, max: 25 }
      };
      const range = levelRanges[activeLevel] || levelRanges.open;
      const availableHours = Number.parseInt(form.lineHoursInput || "0", 10) || 0;
      const monthlyUnits = form.capacityInputMode === "hours"
        ? Math.round((availableHours * 60) / category.minutesPerPiece)
        : Number.parseInt(form.capacityMonthlyUnits || "0", 10) || 0;
      const minPieces = Math.round(monthlyUnits * (range.min / 100));
      const maxPieces = Math.round(monthlyUnits * (range.max / 100));
      const pieceSummary = minPieces === maxPieces ? maxPieces.toLocaleString() : `${minPieces.toLocaleString()}-${maxPieces.toLocaleString()}`;
      const monthSummary = Object.entries(form.capacityMonthSelections || {})
        .map(([month, level]) => `${month} ${levelRanges[level]?.label || "mostly open"}`)
        .join("; ");

      onSave({
        moq: form.moq,
        leadTime: form.leadTime,
        lineHours: `${availableHours.toLocaleString()} hours / month`,
        capacityCategoryKey: form.capacityCategoryKey,
        capacityInputMode: form.capacityInputMode,
        capacityMonthlyUnits: String(monthlyUnits),
        capacityMonthSelections: form.capacityMonthSelections,
        capacityEstimate: `${activeMonth} roughly ${pieceSummary} ${category.label.toLowerCase()} units`,
        booking: monthSummary,
        referenceStyle: `${category.referenceStyle} · ~${category.minutesPerPiece} min/pc`
      });
      return;
    }

    if (editor === "references") {
      onSave({
        references: form.referencesText.split("\n").map((item) => item.trim()).filter(Boolean)
      });
      return;
    }

    if (editor === "verification") {
      onSave({
        certifications: form.certifications
      });
      return;
    }

    onClose();
  };

  return (
    <div className="factory-profile-modal-layer" role="presentation">
      <button className="factory-profile-modal-scrim" type="button" aria-label="Close profile editor" onClick={onClose} />
      <section className="factory-profile-modal factory-onboarding-card" role="dialog" aria-modal="true" aria-labelledby="factory-profile-edit-title">
        <CloseIconButton className="factory-update-close" label="Close profile editor" onClick={onClose} />
        <header className="factory-onboarding-card-header">
          <h1 id="factory-profile-edit-title">{title}</h1>
          <p>{helper}</p>
        </header>

        {editor === "overview" && (
          <div className="factory-onboarding-form-grid">
            <label className="factory-onboarding-field full-width">
              <span>Profile overview</span>
              <textarea value={form.intro} onChange={(event) => updateField("intro", event.target.value)} />
            </label>
            <ProfileEditField label="Factory name" value={form.name} onChange={(value) => updateField("name", value)} />
            <ProfileEditField label="Year founded" value={form.founded} onChange={(value) => updateField("founded", value)} />
            <ProfileEditField label="Website URL" value={form.website} onChange={(value) => updateField("website", value)} />
            <ProfileEditField label="Factory location" value={form.location} onChange={(value) => updateField("location", value)} />
            <ProfileEditField label="Nearest port" value={form.nearestPort} onChange={(value) => updateField("nearestPort", value)} />
            <ProfileEditField label="Total employees" value={form.employees} onChange={(value) => updateField("employees", value)} />
          </div>
        )}

        {editor === "production" && (
          <div className="factory-onboarding-section production-fit-section">
            <ProfileChipEditor label="Production type" options={factoryProfileEditorOptions.productionTypes} selected={form.productionTypes} onChange={(items) => updateField("productionTypes", items)} />
            <ProfileChipEditor label="Product categories" options={factoryProfileEditorOptions.categories} selected={form.categories} onChange={(items) => updateField("categories", items)} />
            <ProfileChipEditor label="Makes" options={factoryProfileEditorOptions.makes} selected={form.makes} onChange={(items) => updateField("makes", items)} allowCustom />
            <ProfileChipEditor label="Market level" options={factoryProfileEditorOptions.marketLevel} selected={form.marketLevel} onChange={(items) => updateField("marketLevel", items)} singleSelect />
            <ProfileChipEditor label="Services" options={factoryProfileEditorOptions.services} selected={form.services} onChange={(items) => updateField("services", items)} />
            <ProfileChipEditor label="Specialties" options={factoryProfileEditorOptions.specialties} selected={form.specialties} onChange={(items) => updateField("specialties", items)} allowCustom />
            <ProfileChipEditor label="Digital tools" options={factoryProfileEditorOptions.tools} selected={form.tools} onChange={(items) => updateField("tools", items)} />
          </div>
        )}

        {editor === "capacity" && (
          <ProfileCapacityEditor form={form} onChange={updateField} />
        )}

        {editor === "references" && (
          <label className="factory-onboarding-field">
            <span>Client references</span>
            <textarea value={form.referencesText} onChange={(event) => updateField("referencesText", event.target.value)} />
            <small>One brand name per line.</small>
          </label>
        )}

        {editor === "verification" && (
          <ProfileVerificationEditor certifications={form.certifications} onChange={(items) => updateField("certifications", items)} />
        )}

        {isSimpleMediaEditor && (
          <FactoryProfileMediaEditor
            assets={getFactoryProfileMediaAssets(editor, data)}
            uploadHelper={editor === "projects" ? "Add completed work, in-production orders, or project proof that helps brands understand your reliability." : editor === "samples" ? "Add sample garments, development examples, construction details, or finished pieces." : "Add another image or file."}
            itemType={editor === "projects" ? "project" : "image"}
          />
        )}

        <footer className="factory-onboarding-actions">
          <button className="secondary-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-btn" type="button" onClick={save}>Save changes</button>
        </footer>
      </section>
    </div>
  );
}

function ProfileVerificationEditor({ certifications, onChange }) {
  const [customCertificationName, setCustomCertificationName] = useState("");
  const displayedCertifications = certifications.filter((cert) => cert.name !== "Business registration");
  const addCustomCertification = (event) => {
    event.preventDefault();
    const nextName = customCertificationName.trim();
    if (!nextName || displayedCertifications.some((cert) => cert.name.toLowerCase() === nextName.toLowerCase())) return;
    onChange([...certifications, { name: nextName, status: "Not uploaded" }]);
    setCustomCertificationName("");
  };

  return (
    <div className="factory-onboarding-section verification-step profile-verification-editor">
      <div className="verification-upload-block">
        <strong>Business registration certificate</strong>
        <div className="certification-file-row">
          <div>
            <span>business-registration.pdf</span>
            <small>Verified</small>
          </div>
          <button type="button">
            <img src="/assets/prototype-icons/download.svg" alt="" />
            View
          </button>
        </div>
      </div>

      <form className="certification-add-control" onSubmit={addCustomCertification}>
        <label className="factory-onboarding-field">
          <span>Add certifications you hold</span>
          <input
            value={customCertificationName}
            onChange={(event) => setCustomCertificationName(event.target.value)}
            placeholder="Type certification name, e.g. WRAP, SEDEX, ISO 9001"
          />
        </label>
        <button className="secondary-btn" type="submit">Add certification</button>
      </form>

      <div className="certification-upload-list">
        {displayedCertifications.map((cert) => {
          const isUploaded = cert.status === "Uploaded" || cert.status === "Verified";

          return (
            <div className="certification-upload-row" key={cert.name}>
              <div className="certification-upload-heading">
                <strong>{cert.name}</strong>
                <small>{isUploaded ? cert.status : "Not uploaded"}</small>
              </div>
              {isUploaded ? (
                <div className="certification-file-row">
                  <div>
                    <span>{`${cert.name.replace(/\s+/g, "-").toLowerCase()}-certificate.pdf`}</span>
                    <small>Certificate uploaded</small>
                  </div>
                  <button type="button">
                    <img src="/assets/prototype-icons/download.svg" alt="" />
                    View
                  </button>
                </div>
              ) : (
                <>
                  <button className="onboarding-file-upload certification-file-upload" type="button">Click or drag certificate to upload</button>
                  <small>PDF, PNG, or JPG</small>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getFactoryProfileMediaAssets(editor, data) {
  if (editor === "samples") return data.products;

  if (editor === "banner") {
    return [
      { title: "Profile image", meta: "Current factory profile image", src: "/assets/factory-label.png" },
      { title: "Profile banner", meta: "Current profile header image", src: "/assets/factory-header.png" }
    ];
  }

  if (editor === "walkthrough") {
    return [{ title: "Factory walkthrough", meta: "2:48 verified production-floor video", src: "/assets/factory-header.png" }];
  }

  if (editor === "projects") {
    return [...data.pastProjects, ...data.inProductionProjects].map((project, index) => ({
      title: project.title,
      meta: `${project.brand} · ${project.result}`,
      src: ["/assets/dashboard-rfq-shirt.jpg", "/assets/dashboard-rfq-knit.jpg", "/assets/dashboard-rfq-denim.jpg"][index % 3]
    }));
  }

  return [];
}

function FactoryProfileMediaEditor({ assets, uploadHelper, itemType = "image" }) {
  const [items, setItems] = useState(assets);
  const [addImageOpen, setAddImageOpen] = useState(false);
  const [openAssetMenu, setOpenAssetMenu] = useState("");
  const [editingAsset, setEditingAsset] = useState(null);
  const isProject = itemType === "project";

  return (
    <div className="factory-profile-modal-placeholder">
      {items.length > 0 && (
        <div className="profile-asset-manager-grid">
          {items.map((asset) => (
            <article className="profile-asset-manager-card" key={asset.title}>
              <div className="profile-asset-card-menu">
                <button
                  className="settings-menu-btn"
                  type="button"
                  aria-label={`More options for ${asset.title}`}
                  aria-expanded={openAssetMenu === asset.title}
                  onClick={() => setOpenAssetMenu((current) => current === asset.title ? "" : asset.title)}
                />
                {openAssetMenu === asset.title && (
                  <div className="profile-asset-overflow-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setEditingAsset(asset);
                        setOpenAssetMenu("");
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="danger"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setItems((current) => current.filter((item) => item.title !== asset.title));
                        setOpenAssetMenu("");
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              <img src={asset.src} alt={`${asset.title} preview`} />
              <div>
                <strong>{asset.title}</strong>
                <span>{asset.meta}</span>
              </div>
            </article>
          ))}
        </div>
      )}
      <button className="secondary-btn profile-asset-add-button" type="button" onClick={() => setAddImageOpen(true)}>{isProject ? "+ Add project" : "+ Add image"}</button>
      {addImageOpen && (
        <FactoryProfileAssetUploadDialog
          helper={uploadHelper}
          itemType={itemType}
          onClose={() => setAddImageOpen(false)}
        />
      )}
      {editingAsset && (
        <FactoryProfileAssetUploadDialog
          asset={editingAsset}
          helper={isProject ? "Update the project image, title, or summary shown on this card." : "Update the image, name, or description shown on this card."}
          itemType={itemType}
          mode="edit"
          onClose={() => setEditingAsset(null)}
        />
      )}
    </div>
  );
}

function FactoryProfileAssetUploadDialog({ asset = null, helper, itemType = "image", mode = "add", onClose }) {
  const isEdit = mode === "edit";
  const isProject = itemType === "project";

  return (
    <div className="profile-asset-upload-layer" role="presentation">
      <button className="profile-asset-upload-scrim" type="button" aria-label={isEdit ? "Close edit image dialog" : "Close add image dialog"} onClick={onClose} />
      <section className="profile-asset-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-asset-upload-title">
        <CloseIconButton className="factory-update-close profile-asset-upload-close" label={isEdit ? "Close edit image dialog" : "Close add image dialog"} onClick={onClose} />
        <header>
          <h2 id="profile-asset-upload-title">{isEdit ? (isProject ? "Edit project" : "Edit image") : (isProject ? "Add project" : "Add image")}</h2>
          <p>{helper}</p>
        </header>
        {isEdit && asset?.src && (
          <div className="profile-asset-edit-preview">
            <img src={asset.src} alt={`${asset.title} preview`} />
          </div>
        )}
        <button className="onboarding-file-upload" type="button">{isEdit ? (isProject ? "Click or drag files to replace project image" : "Click or drag files to replace image") : "Click or drag files to upload"}</button>
        <div className="profile-asset-metadata-grid">
          <label className="factory-onboarding-field">
            <span>{isProject ? "Project title" : "Image name"}</span>
            <input defaultValue={asset?.title || ""} placeholder={isProject ? "e.g. Organic cotton woven shirt production" : "e.g. Organic poplin fit sample"} />
          </label>
          <label className="factory-onboarding-field">
            <span>{isProject ? "Project summary" : "Description"}</span>
            <input defaultValue={asset?.meta || ""} placeholder={isProject ? "e.g. Maison Rue · Completed on time" : "e.g. Wovens · sample development"} />
          </label>
        </div>
        <footer className="profile-asset-upload-actions">
          <button className="secondary-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-btn" type="button" onClick={onClose}>{isEdit ? "Save changes" : (isProject ? "Add project" : "Add image")}</button>
        </footer>
      </section>
    </div>
  );
}

function ProfileEditField({ label, value, onChange }) {
  return (
    <label className="factory-onboarding-field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ProfileCapacityEditor({ form, onChange }) {
  const monthNames = ["Aug", "Sep", "Oct"];
  const selectedCategory = FACTORY_CAPACITY_CATEGORIES.find((category) => category.key === form.capacityCategoryKey) || FACTORY_CAPACITY_CATEGORIES[1];
  const availableHours = Number.parseInt(form.lineHoursInput || "0", 10) || 0;
  const directUnits = Number.parseInt(form.capacityMonthlyUnits || "0", 10) || 0;
  const monthlyUnits = form.capacityInputMode === "hours"
    ? Math.round((availableHours * 60) / selectedCategory.minutesPerPiece)
    : directUnits;
  const levelRanges = {
    open: { min: 60, max: 100 },
    partial: { min: 25, max: 60 },
    full: { min: 0, max: 25 }
  };
  const activeRange = levelRanges[form.capacityMonthSelections?.Aug || "open"] || levelRanges.open;
  const minPieces = Math.round(monthlyUnits * (activeRange.min / 100));
  const maxPieces = Math.round(monthlyUnits * (activeRange.max / 100));
  const pieceSummary = minPieces === maxPieces ? maxPieces.toLocaleString() : `${minPieces.toLocaleString()}-${maxPieces.toLocaleString()}`;
  const previewFormula = form.capacityInputMode === "hours"
    ? `${availableHours.toLocaleString()} hours × 60 min ÷ ${selectedCategory.minutesPerPiece} min/pc reference style × ${activeRange.min}%-${activeRange.max}% free`
    : `${monthlyUnits.toLocaleString()} units / month × ${activeRange.min}%-${activeRange.max}% free`;
  const updateMonth = (month, selected) => {
    onChange("capacityMonthSelections", { ...form.capacityMonthSelections, [month]: selected });
  };

  return (
    <div className="profile-capacity-editor">
      <div className="factory-onboarding-form-grid">
        <ProfileEditField label="Minimum order quantity" value={form.moq} onChange={(value) => onChange("moq", value)} />
        <ProfileEditField label="Typical lead time" value={form.leadTime} onChange={(value) => onChange("leadTime", value)} />
      </div>

      <section className="onboarding-capacity-panel profile-capacity-editor-panel">
        <div className="profile-capacity-input-stack">
          <div className="onboarding-capacity-topline">
            <span>Category</span>
            <label className="capacity-select-field onboarding-capacity-select">
              <select value={form.capacityCategoryKey} onChange={(event) => onChange("capacityCategoryKey", event.target.value)} aria-label="Select category">
                {FACTORY_CAPACITY_CATEGORIES.map((category) => (
                  <option value={category.key} key={category.key}>{category.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="capacity-section-heading-row onboarding-capacity-input-heading">
            <p className="capacity-helper">{form.capacityInputMode === "hours" ? "Line-hours available per month" : "Units available per month"}</p>
            <div className="capacity-mode-toggle" role="group" aria-label="Capacity input method">
              <button className={form.capacityInputMode === "units" ? "selected" : ""} type="button" onClick={() => onChange("capacityInputMode", "units")}>Units</button>
              <button className={form.capacityInputMode === "hours" ? "selected" : ""} type="button" onClick={() => onChange("capacityInputMode", "hours")}>Hours</button>
            </div>
          </div>

          <label className="line-hours-control onboarding-line-hours">
            {form.capacityInputMode === "hours" ? (
              <input
                inputMode="numeric"
                value={form.lineHoursInput}
                onChange={(event) => onChange("lineHoursInput", event.target.value.replace(/\D/g, ""))}
                aria-label="Line-hours available per month"
              />
            ) : (
              <input
                inputMode="numeric"
                value={form.capacityMonthlyUnits}
                onChange={(event) => onChange("capacityMonthlyUnits", event.target.value.replace(/\D/g, ""))}
                aria-label="Units available per month"
              />
            )}
            <span>{form.capacityInputMode === "hours" ? "hours / month" : "units / month"}</span>
          </label>

          {form.capacityInputMode === "hours" && (
            <div className="reference-style-card onboarding-reference-style">
              <div>
                <strong>{selectedCategory.referenceStyle}</strong>
                <span>~{selectedCategory.minutesPerPiece} min/pc reference style</span>
              </div>
              <p>Changing category updates the reference style and estimated monthly unit range.</p>
            </div>
          )}
        </div>

        <div className="onboarding-month-section">
          <div className="onboarding-month-heading-row">
            <h2>Booking level, month by month</h2>
          </div>
          <div className="onboarding-month-list">
            {monthNames.map((month) => (
              <CapacityMonthRow
                language="en"
                month={month}
                selected={form.capacityMonthSelections?.[month] || "open"}
                onSelect={(selected) => updateMonth(month, selected)}
                key={month}
              />
            ))}
          </div>
        </div>

        <div className="capacity-brand-preview onboarding-capacity-preview">
          <span>BRANDS WILL SEE</span>
          <strong>{`${selectedCategory.label} · Aug start · roughly ${pieceSummary} pieces that month`}</strong>
          <p>{previewFormula}</p>
        </div>
      </section>
    </div>
  );
}

function ProfileChipEditor({ label, options, selected, onChange, allowCustom = false, singleSelect = false }) {
  const [customValue, setCustomValue] = useState("");
  const visibleOptions = [...options, ...selected.filter((item) => !options.includes(item))];
  const toggleOption = (option) => {
    if (singleSelect) {
      onChange([option]);
      return;
    }

    onChange(selected.includes(option)
      ? selected.filter((item) => item !== option)
      : [...selected, option]);
  };
  const addCustomOption = (event) => {
    event.preventDefault();
    const nextOption = customValue.trim();
    if (!nextOption || visibleOptions.includes(nextOption)) return;
    onChange([...selected, nextOption]);
    setCustomValue("");
  };

  return (
    <section className="onboarding-chip-group balanced">
      <div className="onboarding-chip-heading">
        <h2>{label}</h2>
      </div>
      <div className="tag-row compact-tags">
        {visibleOptions.map((option) => (
          <button
            className={selected.includes(option) ? "tag selected" : "tag"}
            type="button"
            aria-pressed={selected.includes(option)}
            onClick={() => toggleOption(option)}
            key={option}
          >
            {option}
          </button>
        ))}
      </div>
      {allowCustom && (
        <form className="onboarding-chip-add-row" onSubmit={addCustomOption}>
          <input value={customValue} onChange={(event) => setCustomValue(event.target.value)} placeholder="Add your own" />
          <button className="secondary-btn compact-btn" type="submit">Add</button>
        </form>
      )}
    </section>
  );
}

function FactoryMetricCard({ label, value, note, tone }) {
  return (
    <article className="factory-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p className={`metric-note ${tone}`}>{note}</p>
    </article>
  );
}

function FactoryDashboardPanel({ title, subtitle, action, onAction, className = "", preHeader = null, children }) {
  return (
    <section className={className ? `factory-dashboard-panel ${className}` : "factory-dashboard-panel"}>
      {preHeader}
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action && <button className="secondary-btn" type="button" onClick={onAction}>{action}</button>}
      </header>
      <div className="factory-dashboard-panel-list">{children}</div>
    </section>
  );
}

function FactoryDashboardRfqRow({ rfq, language, onView }) {
  const isZh = language === "zh";
  const tx = (value) => (isZh ? translateFactoryMainText(value) : value);
  const [primaryImage] = rfq.images || [];
  const dashboardPhoto = dashboardRfqPhotos[rfq.initials];
  const inviteFacts = [
    ["Unit target", rfq.facts.find(([label]) => label === "Unit target")?.[1] || ""],
    ["Quantity", rfq.facts.find(([label]) => label === "Quantity")?.[1] || ""]
  ];
  const fit = rfq.statusTone === "warning" ? "Good fit" : rfq.statusTone === "danger" ? "Potential fit" : "Strong fit";
  const fitTone = rfq.statusTone === "warning" ? "good" : rfq.statusTone === "danger" ? "warn" : "strong";

  return (
    <article className="factory-request-card factory-dashboard-mini-card factory-dashboard-rfq-row shared-responsive-card">
      <header className="factory-request-card-top shared-card-header">
        <div className="factory-request-title shared-card-heading">
          {dashboardPhoto || primaryImage ? (
            <img
              className="factory-dashboard-rfq-image"
              src={dashboardPhoto?.src || primaryImage.src}
              alt={`${rfq.title} reference`}
              style={dashboardPhoto ? { objectPosition: dashboardPhoto.position } : undefined}
            />
          ) : (
            <div className="factory-avatar">{rfq.initials}</div>
          )}
          <div>
            <h2 data-no-translate>{isZh ? getTranslatedProjectTitle(rfq.title) : rfq.title}</h2>
            <p data-no-translate>
              {isZh ? getTranslatedListMeta(`${rfq.brand} · ${rfq.location} · ${rfq.trust}`) : `${rfq.brand} · ${rfq.location} · ${rfq.trust}`}
            </p>
          </div>
        </div>
        <div className="factory-request-card-actions shared-card-actions">
          <span className={`factory-project-fit shared-card-status ${fitTone}`}>{tx(fit)}</span>
          <button className="primary-btn" type="button" onClick={onView}>{tx("View RFQ")}</button>
        </div>
      </header>

      <div className="factory-request-brief shared-card-body">
        <div className="factory-request-facts">
          {inviteFacts.map(([label, value]) => (
            <div key={label}>
              <span>{tx(label)}</span>
              <strong>{isZh ? translateFactoryMainText(value) : value}</strong>
            </div>
          ))}
        </div>
        <p data-no-translate>{isZh ? getTranslatedListDescription(rfq) : rfq.description}</p>
      </div>
    </article>
  );
}

function FactoryDashboardCallCard({ language }) {
  const isZh = language === "zh";
  const calls = [
    {
      title: isZh ? "样衣评审通话" : "Sample review call",
      time: isZh ? "周二 3:00 PM" : "Tue 3:00 PM",
      counterpartTime: isZh ? "Maison Rue: 周二 10:00 AM ET" : "Maison Rue: Tue 10:00 AM ET",
      description: isZh ? "查看样衣照片并确认袖长尺寸更新。" : "Review sample photos and confirm sleeve measurement update."
    },
    {
      title: isZh ? "大货启动同步" : "Bulk kickoff sync",
      time: isZh ? "周四 4:30 PM" : "Thu 4:30 PM",
      counterpartTime: isZh ? "Maison Rue: 周四 11:30 AM ET" : "Maison Rue: Thu 11:30 AM ET",
      description: isZh ? "确认大货排期和生产开始前的付款节点。" : "Confirm bulk timing and payment milestone before production starts."
    }
  ];

  return (
    <article className="factory-upcoming-call-card">
      <h2 className="factory-upcoming-call-label">{isZh ? "已安排通话" : "Scheduled calls"}</h2>
      <div className="factory-upcoming-call-list">
        {calls.map((call) => (
          <section className="factory-upcoming-call-time" key={call.title}>
            <div className="factory-upcoming-call-heading">
              <h3>{call.title}</h3>
              <strong>{call.time}</strong>
            </div>
            <span>{call.counterpartTime}</span>
            <div className="factory-upcoming-call-actions">
              <p className="factory-upcoming-call-description">{call.description}</p>
              <button className="secondary-btn compact-btn" type="button">{isZh ? "加入通话" : "Join call"}</button>
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

function FactoryAttentionCard({ type, tone, title, meta, action, onAction }) {
  return (
    <article className={`factory-attention-card ${tone}`}>
      <div className="factory-attention-type">
        <span>{type}</span>
      </div>
      <div className="factory-attention-copy">
        <h3>{title}</h3>
        <p>{meta}</p>
      </div>
      <button className="secondary-btn compact-btn" type="button" onClick={onAction}>{action}</button>
    </article>
  );
}

function FactoryMessageRow({ brand, message, time, unread = false, brandAuthored = false }) {
  return (
    <article className="factory-message-row">
      <span className={unread ? "message-dot unread" : "message-dot"} />
      <div>
        <strong>{brand}</strong>
        <p data-no-translate={brandAuthored || undefined}>{message}</p>
      </div>
      <time>{time}</time>
    </article>
  );
}

function FactoryProjectDashboardRow({ project, language, onView }) {
  const isZh = language === "zh";
  const dashboardPhoto = dashboardOrderPhotos[project.initials];
  const [primaryImage] = project.images || [];
  const statusLabel = {
    "Waiting for sample approval": "Sample approval",
    "Submit lab dip": "Lab dip review"
  }[project.status] || project.status;
  const productionFacts = [
    ["Production step", project.currentStep],
    ["Next due", project.nextDue]
  ];
  const imageSrc = dashboardPhoto?.src || primaryImage?.src;
  const imagePosition = dashboardPhoto?.position;

  return (
    <article className="factory-project-dashboard-row shared-responsive-card shared-dashboard-card">
      <header className="factory-project-dashboard-heading shared-card-heading">
          <img
            className="factory-project-dashboard-thumb-image"
            src={imageSrc}
            alt={`${project.title} reference`}
            style={imagePosition ? { objectPosition: imagePosition } : undefined}
          />
          <div>
            <strong data-no-translate>{isZh ? getTranslatedProjectTitle(project.title) : project.title}</strong>
            <p className="project-meta" data-no-translate>
              {isZh ? getTranslatedListMeta(`${project.brand} · ${project.location} · ${project.started}`) : `${project.brand} · ${project.location} · ${project.started}`}
            </p>
          </div>
      </header>
      <div className="factory-project-dashboard-meta shared-card-body">
          {productionFacts.map(([label, value]) => (
            <div className="factory-project-mini-metric" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
      </div>

      <div className="factory-project-dashboard-actions shared-card-actions">
          <span className={`project-status shared-card-status ${project.statusTone}`}>{statusLabel}</span>
          <button className="primary-btn factory-project-view-btn" type="button" onClick={onView}>View order</button>
      </div>
      <div className="factory-project-dashboard-progress">
          <ProjectProgress progress={project.progress} />
      </div>
    </article>
  );
}

function FactoryRfqsPage({ language, onBrowseRfqs, onViewRequest, onEditQuote }) {
  const [activeTab, setActiveTab] = useState("active");
  const [rfqTabs, setRfqTabs] = useState([
    { key: "active", label: "Active RFQs (4)", locked: true },
    { key: "drafts", label: "Drafts (3)", locked: true },
    { key: "invited", label: "Invited (2)", locked: true },
    { key: "closed", label: "Closed (6)", locked: true }
  ]);
  const [isAddingTab, setIsAddingTab] = useState(false);
  const [newTabName, setNewTabName] = useState("");
  const [manageTabsOpen, setManageTabsOpen] = useState(false);
  const [draftTabs, setDraftTabs] = useState(rfqTabs);
  const rfqDataByTab = {
    active: factoryRfqs,
    drafts: factoryDraftRfqs,
    invited: factoryInvitedRfqs,
    closed: factoryClosedRfqs
  };
  const activeRfqs = rfqDataByTab[activeTab] || factoryRfqs;

  function openManageTabs() {
    setDraftTabs(rfqTabs);
    setIsAddingTab(false);
    setManageTabsOpen(true);
  }

  function addCustomTab(event) {
    event.preventDefault();
    const trimmedName = newTabName.trim();
    if (!trimmedName || rfqTabs.some((tab) => tab.label === trimmedName)) return;
    const nextTab = { key: `custom-${trimmedName}`, label: trimmedName, locked: false };
    setRfqTabs((tabs) => [...tabs, nextTab]);
    setActiveTab(nextTab.key);
    setNewTabName("");
    setIsAddingTab(false);
  }

  function updateDraftTab(index, value) {
    setDraftTabs((tabs) => tabs.map((tab, tabIndex) => (tabIndex === index ? { ...tab, label: value } : tab)));
  }

  function removeDraftTab(index) {
    setDraftTabs((tabs) => tabs.filter((tab, tabIndex) => tabIndex !== index || tab.locked));
  }

  function moveDraftTab(index, direction) {
    setDraftTabs((tabs) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= tabs.length) return tabs;
      const reorderedTabs = [...tabs];
      [reorderedTabs[index], reorderedTabs[nextIndex]] = [reorderedTabs[nextIndex], reorderedTabs[index]];
      return reorderedTabs;
    });
  }

  function saveManagedTabs() {
    const cleanedTabs = [];
    const seenKeys = new Set();
    draftTabs.forEach((tab) => {
      const label = tab.label.trim();
      if (!label) return;
      const key = tab.locked ? tab.key : `custom-${label}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      cleanedTabs.push({ key, label, locked: tab.locked });
    });
    const nextTabs = cleanedTabs.length ? cleanedTabs : rfqTabs;
    setRfqTabs(nextTabs);
    if (!nextTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(nextTabs[0]?.key || "active");
    }
    setManageTabsOpen(false);
  }

  return (
    <main className="rfqs-page factory-rfqs-page">
      <div className="rfqs-shell">
        <header className="rfqs-header">
          <div>
            <h1>RFQs</h1>
            <p>Track active requests you were invited to, quotes you already sent, and brand questions that need an answer.</p>
          </div>
          <button className="primary-btn" type="button" onClick={onBrowseRfqs}>Browse RFQs</button>
        </header>

        <section className="rfqs-controls" aria-label="RFQ filters">
          <label className="rfqs-search">
            <span>Search RFQs</span>
            <div>
              <SearchIcon />
              <input placeholder="RFQ name, ID, or brand..." />
            </div>
          </label>
          <label className="rfqs-sort">
            <span>Sort By</span>
            <select defaultValue="newest">
              <option value="newest">Newest First</option>
              <option value="due">Quote Due Soon</option>
              <option value="fit">Best Fit</option>
            </select>
          </label>
        </section>

        <nav className="rfqs-tabs projects-tabs" aria-label="RFQ status">
          <div className="project-tabs-scroll">
            {rfqTabs.map((tab) => (
              !tab.locked ? (
                <div className={activeTab === tab.key ? "project-custom-tab active" : "project-custom-tab"} key={tab.key}>
                  <button
                    className={activeTab === tab.key ? "active" : ""}
                    type="button"
                    aria-current={activeTab === tab.key ? "page" : undefined}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                </div>
              ) : (
                <button
                  className={activeTab === tab.key ? "active" : ""}
                  type="button"
                  aria-current={activeTab === tab.key ? "page" : undefined}
                  onClick={() => setActiveTab(tab.key)}
                  key={tab.key}
                >
                  {tab.label}
                </button>
              )
            ))}
            {isAddingTab ? (
              <form className="project-tab-add-form" onSubmit={addCustomTab}>
                <input
                  value={newTabName}
                  onChange={(event) => setNewTabName(event.target.value)}
                  placeholder="Tab name"
                  autoFocus
                />
                <button type="submit">Add</button>
                <button
                  className="project-tab-add-cancel"
                  type="button"
                  aria-label="Cancel adding tab"
                  onClick={() => {
                    setNewTabName("");
                    setIsAddingTab(false);
                  }}
                >
                  ×
                </button>
              </form>
            ) : (
              <button className="project-tab-add" type="button" onClick={() => setIsAddingTab(true)}>
                + Add tab
              </button>
            )}
          </div>
          <button className="project-tab-add project-tab-manage" type="button" onClick={openManageTabs}>
            Manage tabs
          </button>
        </nav>

        {manageTabsOpen && createPortal(
          <div className="brand-profile-modal-layer">
            <button className="brand-profile-modal-scrim" type="button" aria-label="Close tab manager" onClick={() => setManageTabsOpen(false)} />
            <section className="brand-profile-modal project-tabs-modal" role="dialog" aria-modal="true" aria-labelledby="factory-rfq-tabs-title">
              <button className="brand-profile-modal-close" type="button" aria-label="Close" onClick={() => setManageTabsOpen(false)}>×</button>
              <header className="brand-profile-modal-header">
                <h1 id="factory-rfq-tabs-title">Manage tabs</h1>
                <p>Create RFQ tabs for categories, seasons, brand groups, or any request grouping your team uses.</p>
              </header>

              <div className="project-tabs-manager">
                {draftTabs.map((tab, index) => (
                  <div className="project-tabs-manager-row" key={`${tab.key}-${index}`}>
                    <label>
                      <span>Tab name {tab.locked ? <small>Default</small> : null}</span>
                      <input value={tab.label} onChange={(event) => updateDraftTab(index, event.target.value)} />
                    </label>
                    <div className="project-tabs-manager-actions">
                      <button type="button" disabled={index === 0} onClick={() => moveDraftTab(index, -1)}>Up</button>
                      <button type="button" disabled={index === draftTabs.length - 1} onClick={() => moveDraftTab(index, 1)}>Down</button>
                      <button type="button" disabled={tab.locked} onClick={() => removeDraftTab(index)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>

              <footer className="brand-profile-modal-actions">
                <button className="secondary-btn" type="button" onClick={() => setManageTabsOpen(false)}>Cancel</button>
                <button className="primary-btn" type="button" onClick={saveManagedTabs}>Save changes</button>
              </footer>
            </section>
          </div>,
          document.body
        )}

        <section className="rfq-list" aria-label="Factory RFQs">
          {activeRfqs.map((rfq) => (
            <FactoryRfqCard
              rfq={rfq}
              language={language}
              key={rfq.title}
              onViewRequest={onViewRequest}
              onEditQuote={onEditQuote}
            />
          ))}
        </section>
      </div>
    </main>
  );
}

function FactorySavedPage({ language, onViewBrand, onViewRfq }) {
  const [tab, setTab] = useState("brands");
  const isZh = language === "zh";
  const tx = (value) => (isZh ? translateFactoryMainText(value) : value);
  const savedBrandProfiles = {
    "Maison Rue": ["Fashion brand", "$1M-$5M revenue", "4 Club orders"],
    "Elara Studio": ["Contemporary brand", "$5M-$10M revenue", "2 repeat factories"],
    Northline: ["Outerwear brand", "Toronto market", "1 day avg. response"]
  };
  const savedBrands = brandProjects.slice(0, 3).map((project) => ({
    initials: project.initials,
    name: project.brand,
    location: project.location,
    trust: project.trust,
    focus: project.title,
    fit: project.capacity[0],
    note: project.insight[0],
    tags: savedBrandProfiles[project.brand]
  }));
  const savedRfqs = brandProjects.slice(0, 3);

  return (
    <main className="rfqs-page factory-saved-page">
      <div className="rfqs-shell saved-shell">
        <header className="rfqs-header saved-header">
          <div>
            <h1>Saved</h1>
            <p>{tx("Keep track of brands you want to work with and RFQs you may quote later.")}</p>
          </div>
        </header>

        <nav className="rfqs-tabs saved-tabs" aria-label="Saved lists">
          <button className={tab === "brands" ? "active" : ""} type="button" onClick={() => setTab("brands")}>{tx(`Saved brands (${savedBrands.length})`)}</button>
          <button className={tab === "rfqs" ? "active" : ""} type="button" onClick={() => setTab("rfqs")}>{tx(`Saved RFQs (${savedRfqs.length})`)}</button>
        </nav>

        <section className="rfqs-controls saved-controls" aria-label="Saved filters">
          <label className="rfqs-search">
            <span>{tab === "brands" ? tx("Search saved brands") : tx("Search saved RFQs")}</span>
            <div>
              <SearchIcon />
              <input placeholder={tab === "brands" ? tx("Brand name, category, location...") : tx("RFQ name, product, brand...")} />
            </div>
          </label>
          <label className="rfqs-sort">
            <span>{tx("Sort By")}</span>
            <select defaultValue="recent">
              <option value="recent">{tx("Recently saved")}</option>
              <option value="fit">{tx("Best fit")}</option>
              <option value="due">{tx("Due soon")}</option>
            </select>
          </label>
        </section>

        {tab === "brands" ? (
          <section className="factory-saved-brand-grid" aria-label="Saved brands">
            {savedBrands.map((brand) => (
              <FactorySavedBrandCard brand={brand} language={language} onViewBrand={onViewBrand} key={brand.name} />
            ))}
          </section>
        ) : (
          <section className="factory-saved-rfq-list" aria-label="Saved RFQs">
            {savedRfqs.map((project) => (
              <FactorySavedRfqCard project={project} language={language} onViewRfq={onViewRfq} key={project.title} />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function FactorySavedBrandCard({ brand, language = "en", onViewBrand }) {
  const isZh = language === "zh";
  const tx = (value) => (isZh ? translateFactoryMainText(value) : value);
  const fitTone = brand.fit === "Good fit" ? "good" : brand.fit === "Potential fit" ? "warn" : "strong";

  return (
    <article className="factory-saved-brand-card">
      <header>
        <button className="factory-saved-brand-identity factory-saved-brand-link" type="button" onClick={onViewBrand}>
          <div className="factory-avatar">{brand.initials}</div>
          <div>
            <h2>{brand.name}</h2>
            <p>{tx(brand.location)}</p>
          </div>
        </button>
        <div className="factory-saved-card-actions">
          <span className={`factory-project-fit ${fitTone}`}>{tx(brand.fit)}</span>
          <button className="secondary-btn" type="button">{tx("Contact brand")}</button>
        </div>
      </header>
      <div className="factory-saved-brand-fit">
        <strong>{isZh ? getTranslatedProjectTitle(brand.focus) : brand.focus}</strong>
      </div>
      <div className="factory-request-trust factory-saved-brand-trust">
        <span className="factory-request-trust-icon" aria-hidden="true">$</span>
        <strong>{tx("Payment verified")}</strong>
        <span>{tx(brand.trust)}</span>
      </div>
      <div className="tag-row compact-tags">
        {brand.tags.map((tag) => (
          <span className="tag garment-tag" key={tag}>{tx(tag)}</span>
        ))}
      </div>
    </article>
  );
}

function FactorySavedRfqCard({ project, language, onViewRfq }) {
  const isZh = language === "zh";
  const title = isZh ? getTranslatedProjectTitle(project.title) : project.title;
  const meta = `${project.brand} · ${project.location} · ${project.posted}`;
  const [primaryImage] = project.images || [];

  return (
    <article className="factory-request-card factory-saved-rfq-card">
      <header className="factory-request-card-top">
        <div className="factory-request-title">
          <div className="factory-avatar">{project.initials}</div>
          <div className="rfq-main">
            <h2 data-no-translate>{title}</h2>
            <p className="rfq-date" data-no-translate>{isZh ? getTranslatedListMeta(meta) : meta}</p>
          </div>
        </div>
        <div className="factory-saved-card-actions">
          <button className="secondary-btn" type="button">{isZh ? translateFactoryMainText("Remove") : "Remove"}</button>
          <button className="primary-btn" type="button" onClick={onViewRfq}>{isZh ? translateFactoryMainText("View RFQ") : "View RFQ"}</button>
        </div>
      </header>

      <div className="factory-saved-rfq-body">
        <div className="factory-saved-rfq-copy">
          <div className="factory-request-facts">
            <div>
              <span>{isZh ? translateFactoryMainText("Unit target") : "Unit target"}</span>
              <strong>{project.budget}</strong>
            </div>
            <div>
              <span>{isZh ? translateFactoryMainText("Quantity") : "Quantity"}</span>
              <strong>{project.quantity}</strong>
            </div>
            <div>
              <span>{isZh ? translateFactoryMainText("Quote due") : "Quote due"}</span>
              <strong>{project.quoteDue}</strong>
            </div>
          </div>
          <p className="rfq-description" data-no-translate>{isZh ? getTranslatedListDescription(project) : project.specialty}</p>
          <div className="factory-request-tags">
            <span className="marketplace-tag-label">{isZh ? translateFactoryMainText("Request tags") : "Request tags"}</span>
            <div className="tag-row compact-tags rfq-tags">
              {project.tags.slice(0, 4).map((tag) => (
                <span className="tag" key={tag}>{isZh ? translateFactoryMainText(tag) : tag}</span>
              ))}
            </div>
          </div>
        </div>
        {primaryImage && (
          <figure className="factory-saved-rfq-visual">
            <img src={primaryImage.src} alt={`${project.title} ${primaryImage.label}`} />
            <figcaption>{isZh ? translateFactoryMainText(primaryImage.label) : primaryImage.label}</figcaption>
          </figure>
        )}
      </div>
    </article>
  );
}

function getFactoryMessageCopy(value) {
  const copy = {
    "Messages": "对话",
    "Search conversations...": "搜索对话...",
    "All": "全部",
    "Unread": "未读",
    "Schedule call": "预约通话",
    "Live video chat": "视频通话",
    "Attach file": "上传文件",
    "Send": "发送",
    "Brand": "品牌",
    "Translate to English": "翻译成中文",
    "Show original": "查看原文",
    "Scheduled call": "已预约通话",
    "Join call": "加入通话",
    "Video link added": "已添加视频链接",
    "Open": "打开",
    "Title": "标题",
    "Description": "说明",
    "Add video link": "添加视频链接",
    "Send invite": "发送邀请",
    "Ready to call": "准备呼叫",
    "Live with": "正在通话",
    "Start call": "开始通话",
    "End call": "结束通话",
    "Cam": "摄像头",
    "Mic": "麦克风",
    "Share": "共享",
    "Organic cotton woven shi...": "有机棉梭织衬衫...",
    "Premium knit capsule for re...": "高级针织度假系列...",
    "牛仔 jacket wash developm...": "牛仔夹克洗水开发...",
    "Can you split fit and PP sample cost?": "可以拆分试身样和 PP 样费用吗？",
    "Uploaded updated colorway sheet.": "已上传更新后的配色表。",
    "Can you confirm wash sample lead time?": "可以确认洗水样周期吗？",
    "12 min": "12 分钟",
    "1 hr": "1 小时",
    "Today": "今天",
    "4:18 PM local time": "当地时间 4:18 PM",
    "1:18 PM local time": "当地时间 1:18 PM",
    "Organic cotton woven shirt production": "有机棉梭织衬衫生产订单",
    "Premium knit capsule for resort drop": "高级针织度假系列生产订单",
    "Denim jacket wash development and small bulk": "牛仔夹克洗水开发与小批量生产",
    "Can you split fit and PP sample cost in the quote? We want to approve the first fit sample before locking PP timing.": "报价里可以把试身样和 PP 样费用拆开吗？我们想先确认第一版试身样，再锁定 PP 样时间。",
    "Yes. We can separate fit sample, PP sample, and bulk unit pricing. I will update the assumptions in the quote.": "可以。我们可以把试身样、PP 样和大货单价分开列。我会更新报价里的假设条件。",
    "We can send quality control photos before the final balance.": "我们可以在支付尾款前发送质检照片。",
    "We uploaded the updated colorway sheet. Please quote the lab dip review as a separate line.": "我们已上传更新后的配色表。请把色样审核作为单独项目报价。",
    "Received. We can quote yarn sourcing and lab dip review separately.": "已收到。我们可以把纱线采购和色样审核分别报价。",
    "Can you confirm wash sample lead time before we invite the full denim RFQ group?": "在邀请完整牛仔报价组之前，可以先确认洗水样周期吗？"
  };

  return copy[value] || getTranslatedProjectTitle(value);
}

function getFactoryThreadScheduleCopy(value) {
  return value
    .replace("Your time: Porto time", "你的时间：波尔图时间")
    .replace("local time shown after invite", "邀请后显示当地时间")
    .replace("Tue", "周二")
    .replace("Wed", "周三")
    .replace("Thu", "周四")
    .replace("Fri", "周五")
    .replace("Sample cost review", "样品费用确认")
    .replace("Review open questions with", "和")
    .replace("and confirm next actions.", "确认待处理问题和下一步。");
}

function FactoryMessagesScreen({ language = "en" }) {
  const isZh = language === "zh";
  const tx = (value) => (isZh ? getFactoryMessageCopy(value) : value);
  const [activeThreadId, setActiveThreadId] = useState(factoryMessageThreads[0].id);
  const [composer, setComposer] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [isCallPanelOpen, setIsCallPanelOpen] = useState(false);
  const [translatedMessages, setTranslatedMessages] = useState({});
  const [scheduledCalls, setScheduledCalls] = useState({});
  const activeThread = factoryMessageThreads.find((thread) => thread.id === activeThreadId) || factoryMessageThreads[0];
  const activeScheduledCall = scheduledCalls[activeThread.id];

  useEffect(() => {
    if (!showSchedule) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showSchedule]);

  const toggleTranslation = (threadId, index) => {
    const key = `${threadId}-${index}`;
    setTranslatedMessages((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className={activeScheduledCall ? "messages-shell factory-messages-shell has-side-panel" : "messages-shell factory-messages-shell"}>
      <aside className="messages-list-panel">
        <header className="messages-list-header">
          <div>
            <h1>{tx("Messages")}</h1>
          </div>
        </header>
        <label className="rfqs-search message-search-field">
          <div>
            <SearchIcon />
            <input placeholder={tx("Search conversations...")} />
          </div>
        </label>
        <div className="message-filter-row">
          <button className="pill active" type="button">{tx("All")}</button>
          <button className="pill" type="button">{tx("Unread")}</button>
        </div>
        <div className="message-thread-list">
          {factoryMessageThreads.map((thread) => (
            <button
              className={thread.id === activeThread.id ? "message-thread-card active" : "message-thread-card"}
              type="button"
              onClick={() => {
                setActiveThreadId(thread.id);
                setShowSchedule(false);
                setIsCallPanelOpen(false);
              }}
              key={thread.id}
            >
              <span className="message-avatar">{thread.initials}</span>
              <span>
                <strong>{thread.name}</strong>
                <small>{tx(thread.project)}</small>
                <em>{tx(thread.lastPreview)}</em>
              </span>
              <time>{tx(thread.lastDate)}</time>
              {thread.unread > 0 && <b>{thread.unread}</b>}
            </button>
          ))}
        </div>
      </aside>

      <section className="message-workspace">
        <header className="message-room-header">
          <div className="message-room-identity">
            <div>
              <h2>{activeThread.primaryContact}</h2>
              <p>{activeThread.name} - {tx(activeThread.localTime)} - {tx(activeThread.project)}</p>
            </div>
          </div>
          <div className="message-room-actions">
            {activeScheduledCall && !isCallPanelOpen && (
              <button className="message-call-drawer-button" type="button" aria-label={isZh ? "显示预约通话" : "Show scheduled call"} onClick={() => setIsCallPanelOpen(true)}>
                <img className="message-call-drawer-icon" src="/assets/prototype-icons/scheduled-call.svg" alt="" />
              </button>
            )}
            <button className="secondary-btn compact-btn" type="button" onClick={() => setShowSchedule(true)}>{tx("Schedule call")}</button>
            <button className="primary-btn compact-btn" type="button">{tx("Live video chat")}</button>
          </div>
        </header>

        <div className="message-timeline">
          {activeThread.messages.map((message, index) => {
            const translationKey = `${activeThread.id}-${index}`;
            const showTranslation = Boolean(translatedMessages[translationKey]);
            return (
              <FactoryMessageBubble
                message={message}
                showTranslation={showTranslation}
                onToggleTranslation={() => toggleTranslation(activeThread.id, index)}
                language={language}
                key={`${message.time}-${index}`}
              />
            );
          })}
        </div>

        <footer className="message-composer">
          <textarea
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            placeholder={isZh ? `发送消息给 ${activeThread.primaryContact}...` : `Message ${activeThread.primaryContact}...`}
            rows={3}
          />
          <div className="message-send-actions">
            <button className="message-upload-btn" type="button">
              <img src="/assets/prototype-icons/upload.svg" alt="" />
              <span>{tx("Attach file")}</span>
            </button>
            <button className="primary-btn compact-btn" type="button" onClick={() => setComposer("")}>{tx("Send")}</button>
          </div>
        </footer>
      </section>

      {activeScheduledCall && (
        <>
          {isCallPanelOpen && (
            <button className="message-side-panel-scrim" type="button" aria-label={isZh ? "隐藏预约通话" : "Hide scheduled call"} onClick={() => setIsCallPanelOpen(false)} />
          )}
          <aside className={isCallPanelOpen ? "message-side-panel open" : "message-side-panel"}>
            <header className="message-side-panel-header">
              <h2>{tx("Scheduled call")}</h2>
              <button className="settings-drawer-close message-side-panel-close" type="button" aria-label={isZh ? "隐藏预约通话" : "Hide scheduled call"} onClick={() => setIsCallPanelOpen(false)}>
                <img src="/assets/prototype-icons/close.svg" alt="" />
              </button>
            </header>
            <FactoryUpcomingCallCard call={activeScheduledCall} language={language} />
          </aside>
        </>
      )}
      {showSchedule && createPortal((
        <div className="message-schedule-modal-layer" role="presentation">
          <button className="message-schedule-modal-scrim" type="button" aria-label={isZh ? "关闭预约通话" : "Close schedule call"} onClick={() => setShowSchedule(false)} />
          <div className="message-schedule-modal" role="dialog" aria-label={tx("Schedule call")}>
            <button className="settings-drawer-close" type="button" aria-label={isZh ? "关闭预约通话" : "Close schedule call"} onClick={() => setShowSchedule(false)}>
              <img src="/assets/prototype-icons/close.svg" alt="" />
            </button>
            <FactoryScheduleCallPanel
              key={activeThread.id}
              thread={activeThread}
              isOpen
              language={language}
              onSchedule={(call) => {
                setScheduledCalls((current) => ({ ...current, [activeThread.id]: call }));
                setShowSchedule(false);
              }}
            />
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

function FactoryMessageBubble({ message, showTranslation, onToggleTranslation, language = "en" }) {
  const isFactory = message.from === "factory";
  const isZh = language === "zh";
  const tx = (value) => (isZh ? getFactoryMessageCopy(value) : value);
  const sourceBody = message.body || message.original;
  const sourceLanguage = message.language || "en";
  const targetLanguage = isZh ? "zh" : "en";
  const canTranslateBrandMessage = !isFactory && sourceLanguage !== targetLanguage;
  const translatedBody = (() => {
    if (isFactory) {
      const factoryDisplayBody = message.translation || sourceBody;
      return isZh ? tx(factoryDisplayBody) : factoryDisplayBody;
    }

    if (!canTranslateBrandMessage || !showTranslation) {
      return sourceBody;
    }

    return isZh ? tx(sourceBody) : (message.translation || sourceBody);
  })();

  return (
    <article className={isFactory ? "message-bubble own" : "message-bubble"}>
      <div>
        <span>{isFactory ? "Atelier Minho" : tx("Brand")}</span>
        <time>{message.time}</time>
      </div>
      <p data-no-translate>{translatedBody}</p>
      {canTranslateBrandMessage && (
        <div className="message-translation-card">
          <button type="button" onClick={onToggleTranslation}>
            {isZh
              ? (showTranslation ? "查看原文" : "翻译成中文")
              : (showTranslation ? "Show original" : "Translate to English")}
          </button>
        </div>
      )}
      {message.attachments && (
        <div className="message-attachment-row">
          {message.attachments.map((attachment) => (
            <button type="button" key={attachment}>
              <span>{attachment}</span>
              <img src="/assets/prototype-icons/download.svg" alt="" />
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function FactoryUpcomingCallCard({ call, language = "en" }) {
  const isZh = language === "zh";
  const tx = (value) => (isZh ? getFactoryMessageCopy(value) : value);
  return (
    <section className="upcoming-call-card home-upcoming-call-time">
      <div className="home-upcoming-call-heading">
        <div>
          <h3>{isZh ? getFactoryThreadScheduleCopy(call.title) : call.title}</h3>
          <span>{isZh ? getFactoryThreadScheduleCopy(call.brandTime) : call.brandTime}</span>
        </div>
        <strong>{isZh ? getFactoryThreadScheduleCopy(call.factoryTime) : call.factoryTime}</strong>
      </div>
      <div className="home-upcoming-call-actions">
        <p className="home-upcoming-call-description">{isZh ? getFactoryThreadScheduleCopy(call.agenda) : call.agenda}</p>
        <button className="secondary-btn compact-btn" type="button">{tx("Join call")}</button>
      </div>
    </section>
  );
}

function FactoryScheduleCallPanel({ thread, isOpen, onOpen, onSchedule, language = "en" }) {
  const isZh = language === "zh";
  const tx = (value) => (isZh ? getFactoryMessageCopy(value) : value);
  const timeSlots = thread.scheduleSlots || [
    { factory: "Tue 3:00 PM Porto", brand: `${thread.name}: local time shown after invite` },
    { factory: "Tue 5:30 PM Porto", brand: `${thread.name}: local time shown after invite` },
    { factory: "Wed 2:30 PM Porto", brand: `${thread.name}: local time shown after invite` }
  ];
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [callTitle, setCallTitle] = useState(isZh ? "样品费用确认" : "Sample cost review");
  const [callDescription, setCallDescription] = useState(isZh ? `和 ${thread.name} 确认待处理问题和下一步。` : `Review open questions with ${thread.name} and confirm next actions.`);
  const [hasVideo, setHasVideo] = useState(true);
  const selectedSlot = timeSlots[selectedSlotIndex] || timeSlots[0];

  return (
    <section className={isOpen ? "schedule-card open" : "schedule-card"}>
      <header>
        <div>
          <h3>{tx("Schedule call")}</h3>
          <p>{isZh ? getFactoryThreadScheduleCopy(thread.scheduleNote) : thread.scheduleNote}</p>
        </div>
        {!isOpen && <button className="secondary-btn compact-btn" type="button" onClick={onOpen}>{tx("Open")}</button>}
      </header>
      {isOpen && (
        <>
          <label className="schedule-field">
            <span>{tx("Title")}</span>
            <input value={callTitle} onChange={(event) => setCallTitle(event.target.value)} />
          </label>
          <label className="schedule-field">
            <span>{tx("Description")}</span>
            <textarea rows={3} value={callDescription} onChange={(event) => setCallDescription(event.target.value)} />
          </label>
          <div className="schedule-slot-grid">
            {timeSlots.map((slot, index) => (
              <button className={index === selectedSlotIndex ? "selected" : ""} type="button" onClick={() => setSelectedSlotIndex(index)} key={slot.factory}>
                <strong>{isZh ? getFactoryThreadScheduleCopy(slot.factory) : slot.factory}</strong>
                <span>{isZh ? getFactoryThreadScheduleCopy(slot.brand) : slot.brand}</span>
              </button>
            ))}
          </div>
          <div className="schedule-footer">
            <label>
              <input type="checkbox" checked={hasVideo} onChange={(event) => setHasVideo(event.target.checked)} />
              {tx("Add video link")}
            </label>
            <button
              className="primary-btn compact-btn"
              type="button"
              onClick={() => onSchedule?.({
                title: callTitle,
                factoryTime: selectedSlot.factory,
                brandTime: selectedSlot.brand,
                agenda: callDescription,
                hasVideo
              })}
            >
              {tx("Send invite")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function FactoryRfqCard({ rfq, language, onViewRequest, onEditQuote }) {
  const isZh = language === "zh";
  const tx = (value) => (isZh ? translateFactoryMainText(value) : value);
  const meta = `${rfq.brand} · ${rfq.location} · Payment verified · ${rfq.trust}`;
  const visibleTags = rfq.tags.slice(0, 4);
  const [primaryImage, ...supportImages] = rfq.images || [];
  const hasGallery = (rfq.images || []).length > 1;
  const rfqFacts = [
    ["Your quote", rfq.metrics[0]?.[0] || "Draft"],
    rfq.facts.find(([label]) => label === "Quantity"),
    [rfq.metrics[1]?.[1] || "Quote due", rfq.metrics[1]?.[0] || ""],
    rfq.facts.find(([label]) => label === "Samples")
  ].filter(Boolean);

  return (
    <article className={rfq.featured ? "factory-request-card featured factory-rfq-card shared-responsive-card" : "factory-request-card factory-rfq-card shared-responsive-card"}>
      <header className="factory-request-card-top shared-card-header">
        <div className="factory-request-title shared-card-heading">
          <div className="factory-avatar">{rfq.initials}</div>
          <div className="rfq-main">
            <h2 data-no-translate>{isZh ? getTranslatedProjectTitle(rfq.title) : rfq.title}</h2>
            <p className="rfq-date" data-no-translate>{isZh ? getTranslatedListMeta(meta) : meta}</p>
          </div>
        </div>
        <div className="factory-request-card-actions factory-rfq-card-actions shared-card-actions">
          {rfq.status && <span className={`tag rfq-status shared-card-status ${rfq.statusTone}`}>{tx(rfq.status)}</span>}
          <button
            className="primary-btn"
            type="button"
            onClick={rfq.status === "Quote submitted" ? onViewRequest : onEditQuote}
          >
            {tx("View RFQ")}
          </button>
          <button className="rfq-more" type="button" aria-label={isZh ? `${getTranslatedProjectTitle(rfq.title)} 的更多操作` : `More options for ${rfq.title}`}>...</button>
        </div>
      </header>

      <div className="factory-request-card-body shared-card-body">
        <aside className="factory-request-brief">
          <div className="factory-request-facts">
            {rfqFacts.map(([label, value]) => (
              <div key={label}>
                <span>{tx(label)}</span>
                <strong>{tx(value)}</strong>
              </div>
            ))}
          </div>
          <p className="rfq-description" data-no-translate>{isZh ? getTranslatedListDescription(rfq) : rfq.description}</p>
          {isZh && <ListTranslationMeta />}
          <div className="factory-request-trust">
            <span className="factory-request-trust-icon" aria-hidden="true">$</span>
            <strong>{tx("Payment verified")}</strong>
            <span>{tx(rfq.trust)}</span>
          </div>
          <div className="factory-request-tags">
            <span className="marketplace-tag-label">{tx("Request tags")}</span>
            <div className="tag-row compact-tags rfq-tags">
              {visibleTags.map((tag) => (
                <span className="tag" key={tag}>{tx(tag)}</span>
              ))}
            </div>
          </div>
        </aside>

        <div className={hasGallery ? "factory-request-visuals has-gallery" : "factory-request-visuals"} aria-label={`${rfq.brand} request references`}>
          {primaryImage ? (
            <figure className="factory-request-visual-main">
              <img src={primaryImage.src} alt={`${rfq.title} ${primaryImage.label}`} />
              <figcaption>{tx(primaryImage.label)}</figcaption>
            </figure>
          ) : (
            <div className="factory-request-visual-placeholder">
              <strong>{tx("No reference image uploaded")}</strong>
              <span>{tx("Review the written brief, request tags, and attached tech pack in details.")}</span>
            </div>
          )}
          {hasGallery && supportImages.slice(0, 2).map((image) => (
            <figure key={image.label}>
              <img src={image.src} alt={`${rfq.title} ${image.label}`} />
              <figcaption>{tx(image.label)}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </article>
  );
}

function FactoryReadOnlyRfqPage({ project, language, onBack, onEdit }) {
  return (
    <main className="factory-detail-page factory-submit-page factory-rfq-read-page">
      <div className="factory-submit-content">
        <header className="factory-detail-header factory-submit-header factory-rfq-read-header">
          <button className="text-link" type="button" onClick={onBack}>‹ Back to RFQs</button>
          <h1>View RFQ</h1>
          <p>Review the brand request and the quote you submitted.</p>
          <button className="secondary-btn factory-rfq-edit-btn" type="button" onClick={onEdit}>Edit quote</button>
        </header>

        <div className="factory-submit-layout factory-rfq-read-layout">
          <section className="factory-submit-main">
            <FactoryQuoteRequestCard project={project} language={language} />
            <FactoryQuoteSections readOnly />
          </section>

          <aside className="factory-submit-side">
            <FactoryPriceTotalCard project={project} />

            <section className="factory-submit-card factory-status-card">
              <h2>RFQ status</h2>
              <p>Your quote was submitted and is visible to Maison Rue.</p>
              <div className="factory-status-facts">
                <ProfileDetailPair label="Your quote" value="$18.40" />
                <ProfileDetailPair label="Quote sent" value="Jul 24" />
                <ProfileDetailPair label="Status" value="Quote submitted" />
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function FactoryPriceTotalCard({ project }) {
  const rows = [
    ["Unit price", "$18.40"],
    ["Quantity", "300 units"],
    ["Production subtotal", "$5,520"],
    ["Sample plan", "Fit + PP · $260"],
    ["Sample shipping", "TBD"],
    ["Payment terms", "30% / 70%"],
  ];

  return (
    <section className="factory-submit-card factory-review-card">
      <header className="factory-review-card-header">
        <h2>Price total</h2>
        <p data-no-translate>{project.brand} · {project.location}</p>
      </header>

      <div className="factory-review-rows">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <span>{label}</span>
            <strong data-no-translate>{value}</strong>
          </React.Fragment>
        ))}
      </div>

      <div className="factory-review-total">
        <span>Brand sees</span>
        <strong data-no-translate>$5,780</strong>
      </div>
    </section>
  );
}

function FactoryProjectsPage({ language, onViewProject }) {
  const [activeTab, setActiveTab] = useState("active");
  const [projectTabs, setProjectTabs] = useState([
    { key: "active", label: "Active orders (4)", locked: true },
    { key: "closed", label: "Closed (6)", locked: true }
  ]);
  const [isAddingTab, setIsAddingTab] = useState(false);
  const [newTabName, setNewTabName] = useState("");
  const [manageTabsOpen, setManageTabsOpen] = useState(false);
  const [draftTabs, setDraftTabs] = useState(projectTabs);

  function openManageTabs() {
    setDraftTabs(projectTabs);
    setIsAddingTab(false);
    setManageTabsOpen(true);
  }

  function addCustomTab(event) {
    event.preventDefault();
    const trimmedName = newTabName.trim();
    if (!trimmedName || projectTabs.some((tab) => tab.label === trimmedName)) return;
    const nextTab = { key: `custom-${trimmedName}`, label: trimmedName, locked: false };
    setProjectTabs((tabs) => [...tabs, nextTab]);
    setActiveTab(nextTab.key);
    setNewTabName("");
    setIsAddingTab(false);
  }

  function updateDraftTab(index, value) {
    setDraftTabs((tabs) => tabs.map((tab, tabIndex) => (tabIndex === index ? { ...tab, label: value } : tab)));
  }

  function removeDraftTab(index) {
    setDraftTabs((tabs) => tabs.filter((tab, tabIndex) => tabIndex !== index || tab.locked));
  }

  function moveDraftTab(index, direction) {
    setDraftTabs((tabs) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= tabs.length) return tabs;
      const reorderedTabs = [...tabs];
      [reorderedTabs[index], reorderedTabs[nextIndex]] = [reorderedTabs[nextIndex], reorderedTabs[index]];
      return reorderedTabs;
    });
  }

  function saveManagedTabs() {
    const cleanedTabs = [];
    const seenKeys = new Set();
    draftTabs.forEach((tab) => {
      const label = tab.label.trim();
      if (!label) return;
      const key = tab.locked ? tab.key : `custom-${label}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      cleanedTabs.push({ key, label, locked: tab.locked });
    });
    const nextTabs = cleanedTabs.length ? cleanedTabs : projectTabs;
    setProjectTabs(nextTabs);
    if (!nextTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(nextTabs[0]?.key || "active");
    }
    setManageTabsOpen(false);
  }

  return (
    <main className="rfqs-page factory-projects-page">
      <div className="rfqs-shell projects-shell">
        <header className="rfqs-header projects-header">
          <div>
            <h1>Production orders</h1>
            <p>Track confirmed production orders, sample approvals, milestones, messages, and shared files.</p>
          </div>
        </header>

        <section className="projects-controls" aria-label="Production order filters">
          <label className="rfqs-search">
            <span>Search production orders</span>
            <div>
              <SearchIcon />
              <input placeholder="Order name, ID, or brand..." />
            </div>
          </label>
          <label className="rfqs-sort">
            <span>Brand</span>
            <select defaultValue="all">
              <option value="all">All brands</option>
              <option value="maison">Maison Rue</option>
              <option value="elara">Elara Studio</option>
            </select>
          </label>
          <label className="rfqs-sort">
            <span>Date Range</span>
            <select defaultValue="any">
              <option value="any">Any Time</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>
          <label className="rfqs-sort">
            <span>Sort By</span>
            <select defaultValue="newest">
              <option value="newest">Newest First</option>
              <option value="due">Next Due</option>
              <option value="brand">Brand</option>
            </select>
          </label>
        </section>

        <nav className="rfqs-tabs projects-tabs" aria-label="Production order status">
          <div className="project-tabs-scroll">
            {projectTabs.map((tab) => (
              !tab.locked ? (
                <div className={activeTab === tab.key ? "project-custom-tab active" : "project-custom-tab"} key={tab.key}>
                  <button
                    className={activeTab === tab.key ? "active" : ""}
                    type="button"
                    aria-current={activeTab === tab.key ? "page" : undefined}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                </div>
              ) : (
                <button
                  className={activeTab === tab.key ? "active" : ""}
                  type="button"
                  aria-current={activeTab === tab.key ? "page" : undefined}
                  onClick={() => setActiveTab(tab.key)}
                  key={tab.key}
                >
                  {tab.label}
                </button>
              )
            ))}
            {isAddingTab ? (
              <form className="project-tab-add-form" onSubmit={addCustomTab}>
                <input
                  value={newTabName}
                  onChange={(event) => setNewTabName(event.target.value)}
                  placeholder="Tab name"
                  autoFocus
                />
                <button type="submit">Add</button>
                <button
                  className="project-tab-add-cancel"
                  type="button"
                  aria-label="Cancel adding tab"
                  onClick={() => {
                    setNewTabName("");
                    setIsAddingTab(false);
                  }}
                >
                  ×
                </button>
              </form>
            ) : (
              <button className="project-tab-add" type="button" onClick={() => setIsAddingTab(true)}>
                + Add tab
              </button>
            )}
          </div>
          <button className="project-tab-add project-tab-manage" type="button" onClick={openManageTabs}>
            Manage tabs
          </button>
        </nav>

        {manageTabsOpen && createPortal(
          <div className="brand-profile-modal-layer">
            <button className="brand-profile-modal-scrim" type="button" aria-label="Close tab manager" onClick={() => setManageTabsOpen(false)} />
            <section className="brand-profile-modal project-tabs-modal" role="dialog" aria-modal="true" aria-labelledby="factory-project-tabs-title">
              <button className="brand-profile-modal-close" type="button" aria-label="Close" onClick={() => setManageTabsOpen(false)}>×</button>
              <header className="brand-profile-modal-header">
                <h1 id="factory-project-tabs-title">Manage tabs</h1>
                <p>Create tabs for collections, seasons, brands, or any order grouping your team uses.</p>
              </header>

              <div className="project-tabs-manager">
                {draftTabs.map((tab, index) => (
                  <div className="project-tabs-manager-row" key={`${tab.key}-${index}`}>
                    <label>
                      <span>Tab name {tab.locked ? <small>Default</small> : null}</span>
                      <input value={tab.label} onChange={(event) => updateDraftTab(index, event.target.value)} />
                    </label>
                    <div className="project-tabs-manager-actions">
                      <button type="button" disabled={index === 0} onClick={() => moveDraftTab(index, -1)}>Up</button>
                      <button type="button" disabled={index === draftTabs.length - 1} onClick={() => moveDraftTab(index, 1)}>Down</button>
                      <button type="button" disabled={tab.locked} onClick={() => removeDraftTab(index)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>

              <footer className="brand-profile-modal-actions">
                <button className="secondary-btn" type="button" onClick={() => setManageTabsOpen(false)}>Cancel</button>
                <button className="primary-btn" type="button" onClick={saveManagedTabs}>Save changes</button>
              </footer>
            </section>
          </div>,
          document.body
        )}

        <section className="projects-list" aria-label="Active factory production orders">
          {factoryProjects.map((project) => (
            <FactoryProjectListCard
              project={project}
              language={language}
              onViewProject={onViewProject}
              key={project.title}
            />
          ))}
        </section>
      </div>
    </main>
  );
}

function FactoryProjectListCard({ project, language, onViewProject }) {
  const isZh = language === "zh";
  const [primaryImage] = project.images || [];
  const productionFacts = [
    ["Production step", project.currentStep],
    ["Next due", project.nextDue]
  ];

  return (
    <article className={project.featured ? "factory-request-card featured factory-active-project-card shared-responsive-card" : "factory-request-card factory-active-project-card shared-responsive-card"}>
      <header className="factory-request-card-top shared-card-header">
        <div className="factory-request-title shared-card-heading">
          <div className="factory-avatar">{project.initials}</div>
          <div>
            <h2 data-no-translate>{isZh ? getTranslatedProjectTitle(project.title) : project.title}</h2>
            <p className="project-meta" data-no-translate>
              {isZh ? getTranslatedListMeta(`${project.brand} · ${project.location} · ${project.started}`) : `${project.brand} · ${project.location} · ${project.started}`}
            </p>
          </div>
        </div>
        <ProjectCardActions
          actionLabel="View order"
          actionsClassName="factory-request-card-actions factory-project-card-actions"
          onAction={onViewProject}
          status={project.status}
          statusTone={project.statusTone}
        >
          <button className="rfq-more" type="button" aria-label="More order actions">...</button>
        </ProjectCardActions>
      </header>

      <div className="factory-request-card-body shared-card-body">
        <aside className="factory-request-brief factory-order-brief">
          <div className="factory-request-facts">
            {productionFacts.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className="project-description" data-no-translate>{isZh ? getTranslatedListDescription(project) : project.description}</p>
          {isZh && <ListTranslationMeta />}
          <div className="project-status-row">
            <span><strong>Current status:</strong> {project.statusDetail}</span>
          </div>
          <ProjectProgress progress={project.progress} />
        </aside>

        <div className="factory-request-visuals factory-order-visuals" aria-label={`${project.title} production reference`}>
          {primaryImage && (
            <figure className="factory-request-visual-main">
              <img src={primaryImage.src} alt={`${project.title} ${primaryImage.label}`} />
              <figcaption>{primaryImage.label}</figcaption>
            </figure>
          )}
        </div>
      </div>
    </article>
  );
}

function ProjectProgress({ progress }) {
  const progressPercent = progress <= 1 ? 0 : ((progress - 1) / (projectSteps.length - 1)) * 100;

  return (
    <div className="project-progress" style={{ "--project-progress": `${progressPercent}%` }}>
      <div className="project-progress-line" aria-hidden="true" />
      {projectSteps.map((step, index) => {
        const stepNumber = index + 1;
        const isComplete = stepNumber < progress;
        const isCurrent = stepNumber === progress;
        return (
          <div className={isComplete ? "project-progress-step complete" : isCurrent ? "project-progress-step current" : "project-progress-step"} key={step}>
            <span>{isComplete ? "✓" : stepNumber}</span>
            <small>{progress === 1 && index === 0 ? "Need payment" : step}</small>
          </div>
        );
      })}
    </div>
  );
}

function FactoryBrowsePage({ language, onViewDetails }) {
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (!filtersOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [filtersOpen]);

  return (
    <main className="directory-page factory-browse-marketplace-page">
      <div className="directory-shell">
        {filtersOpen && (
          <button
            className="marketplace-filter-backdrop"
            type="button"
            aria-label="Close filters"
            onClick={() => setFiltersOpen(false)}
          />
        )}
        <section
          className={filtersOpen ? "directory-filter-panel marketplace-filter-panel is-mobile-open" : "directory-filter-panel marketplace-filter-panel"}
          id="factory-browse-filter-panel"
          role={filtersOpen ? "dialog" : undefined}
          aria-modal={filtersOpen ? "true" : undefined}
          aria-label="Project filters"
        >
          <div className="directory-filter-header">
            <strong>Filters</strong>
            <div className="marketplace-filter-header-actions">
              <button type="button">Reset</button>
              <button className="marketplace-filter-close" type="button" onClick={() => setFiltersOpen(false)}>Close</button>
            </div>
          </div>
          <FilterGroup title="Production type">
            <FilterCheck label="Cut & sew knits" />
            <FilterCheck checked label="Wovens" />
            <FilterCheck label="Sweaters / knitwear" />
            <FilterCheck label="Denim" />
            <FilterCheck label="Seamless / circular knit" />
            <FilterCheck label="Intimates / delicate garments" />
            <FilterCheck label="Leather / suede" />
            <FilterCheck label="Bags / soft goods" />
          </FilterGroup>
          <FilterGroup title="Product categories">
            <FilterCheck checked label="Tops" />
            <FilterCheck label="Bottoms" />
            <FilterCheck label="Dresses & jumpsuits" />
            <FilterCheck label="Outerwear" />
            <FilterCheck label="Activewear" />
            <FilterCheck label="Intimates / underwear" />
            <FilterCheck label="Swimwear" />
            <FilterCheck label="Sleepwear / loungewear" />
            <FilterCheck label="Childrenswear / baby" />
            <FilterCheck label="Uniforms / workwear" />
            <FilterCheck label="Accessories" />
          </FilterGroup>
          <FilterGroup title="Price point">
            <div className="directory-chip-grid">
              {["Mass $8-$18", "Middle $18-$40", "Premium $40-$90", "Luxury $90+"].map((label) => (
                <button className={label.startsWith("Middle") ? "directory-chip selected" : "directory-chip"} type="button" key={label}>
                  {label}
                </button>
              ))}
            </div>
          </FilterGroup>
          <FilterGroup title="Quantity">
            <div className="directory-chip-grid">
              {["Under 300", "300-500", "500+"].map((label) => (
                <button className={label === "300-500" ? "directory-chip selected" : "directory-chip"} type="button" key={label}>
                  {label}
                </button>
              ))}
            </div>
          </FilterGroup>
          <FilterGroup title="Preferred region">
            <div className="directory-chip-grid">
              {["Open to my region", "Worldwide"].map((label) => (
                <button className={label === "Open to my region" ? "directory-chip selected" : "directory-chip"} type="button" key={label}>
                  {label}
                </button>
              ))}
            </div>
          </FilterGroup>
          <FilterGroup title="Client trust">
            <div className="directory-chip-grid">
              {["Payment verified", "$5k+ spent", "$10k+ spent", "$25k+ spent"].map((label) => (
                <button className="directory-chip" type="button" key={label}>{label}</button>
              ))}
            </div>
          </FilterGroup>
          <FilterGroup title="Timeline">
            <div className="directory-chip-grid">
              {["Sample in 30 days", "Bulk in 60 days", "Flexible"].map((label) => (
                <button className={label === "Sample in 30 days" ? "directory-chip selected" : "directory-chip"} type="button" key={label}>
                  {label}
                </button>
              ))}
            </div>
          </FilterGroup>
          <FilterGroup title="Certifications">
            <div className="directory-chip-grid">
              {["GOTS", "OEKO-TEX", "BSCI", "WRAP", "Fair Trade"].map((label) => (
                <button className={label === "GOTS" ? "directory-chip selected" : "directory-chip"} type="button" key={label}>{label}</button>
              ))}
            </div>
          </FilterGroup>
          <p className="factory-filter-note">
            Projects shown are matched to your capacity, certifications, region fit, client spend, and payment status.
          </p>
        </section>

        <section className="directory-results" aria-label="Brand project results">
          <header className="directory-hero">
            <div>
              <p className="eyebrow">SOURCING MARKETPLACE</p>
              <h1>Browse RFQs</h1>
            </div>
            <label className="directory-search">
              <SearchIcon />
              <input placeholder="Search organic cotton, denim, sample-ready..." />
            </label>
          </header>
          <div className="directory-summary">
            <div>
              <strong>24 open requests</strong>
              <span>matching wovens, low MOQ, GOTS, and available August capacity</span>
            </div>
            <div className="directory-summary-actions">
              <button
                className="filter-button compact-filter-button"
                type="button"
                aria-controls="factory-browse-filter-panel"
                aria-expanded={filtersOpen}
                aria-haspopup="dialog"
                onClick={() => setFiltersOpen(true)}
              >
                Filters
              </button>
              <button className="filter-button sort-button" type="button">Sort: Best fit</button>
            </div>
          </div>
          <div className="directory-card-list">
            {brandProjects.map((project) => (
              <BrandProjectCard project={project} language={language} key={project.title} onViewDetails={onViewDetails} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

const FACTORY_CAPACITY_CATEGORIES = [
  {
    key: "cut-sew-knits",
    label: "Cut & sew knits",
    labelZh: "裁剪车缝针织",
    referenceStyle: "Basic jersey T-shirt",
    referenceStyleZh: "基础针织 T 恤",
    minutesPerPiece: 12
  },
  {
    key: "wovens",
    label: "Wovens",
    labelZh: "梭织",
    referenceStyle: "Basic woven shirt",
    referenceStyleZh: "基础梭织衬衫",
    minutesPerPiece: 18
  },
  {
    key: "sweaters",
    label: "Sweaters / knitwear",
    labelZh: "毛衫 / 针织衫",
    referenceStyle: "Basic crewneck sweater",
    referenceStyleZh: "基础圆领毛衫",
    minutesPerPiece: 42
  },
  {
    key: "denim",
    label: "Denim",
    labelZh: "牛仔",
    referenceStyle: "Five-pocket denim jean",
    referenceStyleZh: "五袋牛仔裤",
    minutesPerPiece: 34
  },
  {
    key: "seamless",
    label: "Seamless / circular knit",
    labelZh: "无缝 / 圆机针织",
    referenceStyle: "Seamless knit top",
    referenceStyleZh: "无缝针织上衣",
    minutesPerPiece: 9
  },
  {
    key: "intimates",
    label: "Intimates / delicate garments",
    labelZh: "内衣 / 精细服装",
    referenceStyle: "Soft bra or delicate top",
    referenceStyleZh: "软杯文胸或精细上衣",
    minutesPerPiece: 26
  },
  {
    key: "bags",
    label: "Bags / soft goods",
    labelZh: "包袋 / 软配件",
    referenceStyle: "Simple tote bag",
    referenceStyleZh: "基础托特包",
    minutesPerPiece: 22
  }
];

function FactoryCapacityDrawer({ language, initialCapacity, onClose, onSaveCapacity }) {
  const isZh = language === "zh";
  const [lineHours, setLineHours] = useState(initialCapacity || "2400");
  const [capacityUnits, setCapacityUnits] = useState("7200");
  const [capacityInputMode, setCapacityInputMode] = useState("units");
  const [selectedCategory, setSelectedCategory] = useState("wovens");
  const [monthOffset, setMonthOffset] = useState(0);
  const [monthSelections, setMonthSelections] = useState({
    Aug: "open",
    Sep: "partial",
    Oct: "full",
    Nov: "partial",
    Dec: "open",
    Jan: "open"
  });
  const monthNames = ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan"];
  const visibleMonths = monthNames.slice(monthOffset, monthOffset + 3);
  const monthPageSize = 3;
  const currentMonth = visibleMonths[0];
  const selectedLevel = monthSelections[currentMonth] || "open";
  const levelRanges = {
    open: { label: "Mostly open", min: 60, max: 100 },
    partial: { label: "Partly booked", min: 25, max: 60 },
    full: { label: "Mostly full", min: 0, max: 25 }
  };
  const categoryOptions = FACTORY_CAPACITY_CATEGORIES;
  const activeCategory = categoryOptions.find((category) => category.key === selectedCategory) || categoryOptions[1];
  const activeRange = levelRanges[selectedLevel];
  const availableHours = Math.max(0, Number.parseInt(lineHours || "0", 10) || 0);
  const directUnits = Math.max(0, Number.parseInt(capacityUnits || "0", 10) || 0);
  const monthlyUnitCapacity = capacityInputMode === "hours"
    ? Math.round((availableHours * 60) / activeCategory.minutesPerPiece)
    : directUnits;
  const estimatedHours = capacityInputMode === "hours"
    ? availableHours
    : Math.round((directUnits * activeCategory.minutesPerPiece) / 60);
  const minPieces = Math.round(monthlyUnitCapacity * (activeRange.min / 100));
  const maxPieces = Math.round(monthlyUnitCapacity * (activeRange.max / 100));
  const pieceSummary = minPieces === maxPieces ? maxPieces.toLocaleString() : `${minPieces.toLocaleString()}-${maxPieces.toLocaleString()}`;
  const monthLabel = isZh ? translateFactoryMainText(currentMonth) : currentMonth;
  const categoryLabel = isZh ? activeCategory.labelZh : activeCategory.label;
  const previewTitle = isZh
    ? `${categoryLabel} · ${monthLabel} 可开始 · 当月约 ${pieceSummary} 件`
    : `${categoryLabel} · ${currentMonth} start · roughly ${pieceSummary} pieces that month`;
  const previewFormula = isZh
    ? capacityInputMode === "hours"
      ? `${availableHours.toLocaleString()} 小时 × 60 分钟 ÷ ${activeCategory.minutesPerPiece} 分钟 / 件参考款 × ${activeRange.min}%-${activeRange.max}% 可用`
      : `${directUnits.toLocaleString()} 件 / 月 × ${activeRange.min}%-${activeRange.max}% 可用`
    : capacityInputMode === "hours"
      ? `${availableHours.toLocaleString()} hours × 60 min ÷ ${activeCategory.minutesPerPiece} min/pc reference style × ${activeRange.min}%-${activeRange.max}% free`
      : `${directUnits.toLocaleString()} units / month × ${activeRange.min}%-${activeRange.max}% free`;

  const updateMonthSelection = (month, selected) => {
    setMonthSelections((current) => ({ ...current, [month]: selected }));
  };

  return (
    <div className="factory-capacity-drawer-layer" role="presentation">
      <button className="factory-capacity-scrim" type="button" aria-label="Close update capacity" onClick={onClose} />
      <aside className="factory-capacity-drawer" aria-label="Update capacity">
        <header className="factory-capacity-drawer-header">
          <div>
            <h2>{isZh ? "更新产能" : "Update capacity"}</h2>
            <p>
              {isZh
                ? "选择品类，并用工时或件数更新你的月产能。我们会转换成品牌容易理解的接单状态、可用比例和估算件数。"
                : "Choose a category and update capacity by hours or units. We'll translate it into booking level, open percentage, and estimated units brands can understand."}
            </p>
          </div>
          <CloseIconButton label={isZh ? "关闭更新产能" : "Close update capacity"} onClick={onClose} />
        </header>

        <section className="capacity-drawer-section">
          <h3>{isZh ? "品类" : "Category"}</h3>
          <label className="capacity-select-field">
            <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} aria-label={isZh ? "选择品类" : "Select category"}>
              {categoryOptions.map((category) => (
                <option value={category.key} key={category.key}>{isZh ? category.labelZh : category.label}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="capacity-drawer-section">
          <div className="capacity-section-heading-row">
            <h3>{capacityInputMode === "hours" ? (isZh ? "每月可用产线工时" : "Line-hours available per month") : (isZh ? "每月可生产件数" : "Units available per month")}</h3>
            <div className="capacity-mode-toggle" role="group" aria-label={isZh ? "产能输入方式" : "Capacity input method"}>
              <button className={capacityInputMode === "units" ? "selected" : ""} type="button" onClick={() => setCapacityInputMode("units")}>{isZh ? "件数" : "Units"}</button>
              <button className={capacityInputMode === "hours" ? "selected" : ""} type="button" onClick={() => setCapacityInputMode("hours")}>{isZh ? "工时" : "Hours"}</button>
            </div>
          </div>
          <div className="line-hours-control">
            {capacityInputMode === "hours" ? (
              <input
                inputMode="numeric"
                value={lineHours}
                onChange={(event) => setLineHours(event.target.value.replace(/\D/g, ""))}
                aria-label={isZh ? "每月可用产线工时" : "Line-hours available per month"}
              />
            ) : (
              <input
                inputMode="numeric"
                value={capacityUnits}
                onChange={(event) => setCapacityUnits(event.target.value.replace(/\D/g, ""))}
                aria-label={isZh ? "每月可生产件数" : "Units available per month"}
              />
            )}
            <span>{capacityInputMode === "hours" ? (isZh ? "小时 / 月" : "hours / month") : (isZh ? "件 / 月" : "units / month")}</span>
          </div>
          <p className="capacity-helper">
            {capacityInputMode === "hours"
              ? (isZh ? "所有产线合计。系统会按所选品类的参考款时间估算件数。" : "Total across all your lines. We estimate units using the selected category's reference timing.")
              : (isZh ? "如果你按件数管理产能，可以直接输入每月可接的参考款件数。" : "If you plan capacity by units, enter the monthly reference-style units you can accept.")}
          </p>
        </section>

        {capacityInputMode === "hours" && (
          <section className="capacity-drawer-section">
            <h3>{isZh ? "估算使用标准参考款" : "Estimate uses a standard reference style"}</h3>
            <div className="reference-style-card">
              <div>
                <strong>{isZh ? activeCategory.referenceStyleZh : activeCategory.referenceStyle}</strong>
                <span>~{activeCategory.minutesPerPiece} min/pc</span>
              </div>
              <p>
                {isZh
                  ? "切换品类时，参考款和每件用时会一起改变。品牌提供 tech pack 后，可以按实际款式调整估算。"
                  : "When the category changes, the reference style and time per unit change with it. Once a brand shares a tech pack, the estimate can be adjusted to the actual style."}
              </p>
            </div>
          </section>
        )}

        <section className="capacity-drawer-section">
          <h3>{isZh ? "每月接单状态" : "Booking level, month by month"}</h3>
          <p className="capacity-helper">
            {isZh
              ? "选择每个月仍可接单的比例。系统会乘以你的参考款产能，得到品牌看到的件数范围。"
              : "Select the share of capacity still free each month. We multiply this against your reference-style capacity to get units."}
          </p>
          <div className="capacity-month-nav" aria-hidden="true">
            <button type="button" onClick={() => setMonthOffset((offset) => Math.max(0, offset - monthPageSize))}><span>‹</span></button>
            <button type="button" onClick={() => setMonthOffset((offset) => Math.min(monthNames.length - monthPageSize, offset + monthPageSize))}><span>›</span></button>
          </div>
          <div className="capacity-month-list">
            {visibleMonths.map((month) => (
              <CapacityMonthRow
                language={language}
                month={month}
                selected={monthSelections[month]}
                onSelect={(selected) => updateMonthSelection(month, selected)}
                key={month}
              />
            ))}
          </div>
        </section>

        <footer className="capacity-drawer-footer">
          <div className="capacity-brand-preview">
            <span>{isZh ? "品牌将看到" : "BRANDS WILL SEE"}</span>
            <strong>{previewTitle}</strong>
            <p>{previewFormula}</p>
          </div>
          <button className="primary-btn" type="button" onClick={() => onSaveCapacity(String(estimatedHours))}>{isZh ? "保存更改" : "Save changes"}</button>
        </footer>
      </aside>
    </div>
  );
}

function CapacityMonthRow({ language, month, selected, onSelect }) {
  const isZh = language === "zh";
  const options = [
    { key: "open", label: "Mostly open", note: "60-100% open" },
    { key: "partial", label: "Partly booked", note: "25-60% open" },
    { key: "full", label: "Mostly full", note: "0-25% open" }
  ];

  return (
    <div className="capacity-month-row">
      <span>{isZh ? translateFactoryMainText(month) : month}</span>
      <div>
        {options.map((option) => (
          <button
            className={selected === option.key ? "selected" : ""}
            type="button"
            onClick={() => onSelect(option.key)}
            key={option.key}
          >
            <strong>{isZh ? translateFactoryMainText(option.label) : option.label}</strong>
            <small>{isZh ? translateFactoryMainText(option.note) : option.note}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

const factorySettingsPermissionLabels = [
  { key: "rfqFlow", label: "RFQ flow", detail: "Give quotes and submit RFQ details", single: true },
  { key: "addUpdate", label: "Add update", detail: "Post production updates and files" },
  { key: "primaryContact", label: "Primary contact", detail: "Main contact for messages and calls", single: true },
  { key: "settingsAccess", label: "Settings access", detail: "Account, payments, and invites" }
];

const factoryCreditStartingBalance = 500;
const factoryQuoteCreditCost = {
  label: "Production run",
  range: "$2k-$10k quote",
  credits: 25,
  quoteTotal: "$5,780"
};
const factoryCreditPackages = [
  { label: "500 credits", value: "$50" },
  { label: "1,000 credits", value: "$100" },
  { label: "2,500 credits", value: "$250" }
];

const factoryPageBillingHistory = {
  earnings: [
    { title: "Sample milestone released", client: "Maison Rue", meta: "Maison Rue - Jul 29, 2026", status: "Received", amount: "$620.00" },
    { title: "Production deposit released", client: "Maison Rue", meta: "Maison Rue - Jul 18, 2026", status: "Received", amount: "$1,840.00" },
    { title: "Fit sample update", client: "Northline Studio", meta: "Northline Studio - Jul 10, 2026", status: "Received", amount: "$410.00" }
  ],
  payments: [
    { title: "Platform service fee", client: "The Sourcing Club", meta: "Monthly billing - Aug 1, 2026", status: "Paid", amount: "$49.00" },
    { title: "Verified profile review", client: "The Sourcing Club", meta: "Account service - Jul 12, 2026", status: "Paid", amount: "$95.00" }
  ],
  credits: [
    { title: "Verified onboarding bonus", client: "The Sourcing Club", meta: "Profile verified - Aug 10, 2026", status: "Earned", amount: "+500 credits" },
    { title: "Referral bonus available", client: "The Sourcing Club", meta: "Invite a factory; both accounts earn after onboarding", status: "Pending", amount: "+500 credits" }
  ]
};

function BillingScreen({ language = "en", creditBalance = factoryCreditStartingBalance, quoteSent = false }) {
  const [tab, setTab] = useState("earnings");
  const [client, setClient] = useState("All clients");
  const [creditPurchaseOpen, setCreditPurchaseOpen] = useState(false);
  const isZh = language === "zh";
  const tx = (value) => (isZh ? translateFactoryMainText(value) : value);
  const formatCreditAmount = (value) => (isZh ? value.replace(/credits/g, "额度") : value);
  const formatBillingMeta = (row) => `${row.client} - ${tx(row.meta)}`;
  const allRows = quoteSent && tab === "credits"
    ? [
        { title: "Quote submitted", client: "Maison Rue", meta: `${factoryQuoteCreditCost.range} - ${factoryQuoteCreditCost.quoteTotal}`, status: "Used", amount: `-${factoryQuoteCreditCost.credits} credits` },
        ...factoryPageBillingHistory.credits
      ]
    : factoryPageBillingHistory[tab];
  const clients = ["All clients", ...Array.from(new Set(allRows.map((row) => row.client)))];
  const selectedClient = clients.includes(client) ? client : "All clients";
  const rows = tab !== "earnings" || selectedClient === "All clients" ? allRows : allRows.filter((row) => row.client === selectedClient);
  const total = rows.reduce((sum, row) => row.amount.startsWith("$") ? sum + Number(row.amount.replace(/[$,]/g, "")) : sum, 0);
  const formattedTotal = `$${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const summaryMetrics = [
    ["total earned", formattedTotal],
    ["received this month", "$1,214.00"],
    ["pending release", "$1,656.00"],
    ["next payment", "$828.00", "highlight"]
  ];
  const changeTab = (nextTab) => {
    setTab(nextTab);
    setClient("All clients");
  };

  return (
    <section className="billing-history-page">
      <header className="billing-history-header">
        <div>
          <h1>{tx("Payments")}</h1>
        </div>
      </header>
      <div className="billing-controls">
        <div className="settings-access-tabs billing-tabs" role="tablist" aria-label="Billing history type">
          <button className={tab === "earnings" ? "active" : ""} type="button" role="tab" aria-selected={tab === "earnings"} onClick={() => changeTab("earnings")}>{tx("Earnings")}</button>
          <button className={tab === "payments" ? "active" : ""} type="button" role="tab" aria-selected={tab === "payments"} onClick={() => changeTab("payments")}>{tx("Payments")}</button>
          <button className={tab === "credits" ? "active" : ""} type="button" role="tab" aria-selected={tab === "credits"} onClick={() => changeTab("credits")}>{tx("Credits")}</button>
        </div>
        {tab === "earnings" && (
          <label>
            <span>{tx("Filter by client")}</span>
            <select value={selectedClient} onChange={(event) => setClient(event.target.value)}>
              {clients.map((item) => (
                <option key={item} value={item}>{tx(item)}</option>
              ))}
            </select>
          </label>
        )}
        {tab !== "earnings" && (
          <label className="billing-filter-placeholder" aria-hidden="true">
            <span>{tx("Filter by client")}</span>
            <select tabIndex={-1} value="All clients" readOnly>
              <option>{tx("All clients")}</option>
            </select>
          </label>
        )}
      </div>
      {tab === "earnings" && (
        <div className="factory-project-summary-card factory-billing-summary-strip" aria-label="Earnings payment summary">
          {summaryMetrics.map(([label, value, tone]) => (
            <Metric label={tx(label)} value={value} className={tone || ""} key={label} />
          ))}
        </div>
      )}
      {tab === "credits" && (
        <section className="factory-credit-billing-card">
          <div>
            <span>{tx("Credit balance")}</span>
            <strong>{creditBalance} {isZh ? "额度" : "credits"}</strong>
            <p>{tx("500 credits = $50 value. Credits are used when a quote is sent.")}</p>
          </div>
          <div className="factory-credit-billing-action">
            <button className="secondary-btn compact-btn" type="button" onClick={() => setCreditPurchaseOpen(true)}>{tx("Get more credits")}</button>
          </div>
        </section>
      )}
      <div className="billing-history-list">
        {rows.map((row) => (
          <article className="billing-history-row" key={`${row.title}-${row.meta}`}>
            <div>
              <strong>{tx(row.title)}</strong>
              <span>{formatBillingMeta(row)}</span>
            </div>
            <span className="billing-status">{tx(row.status)}</span>
            <strong>{formatCreditAmount(row.amount)}</strong>
          </article>
        ))}
      </div>
      {creditPurchaseOpen && (
        <CreditPurchaseModal language={language} onClose={() => setCreditPurchaseOpen(false)} />
      )}
    </section>
  );
}

function CreditPurchaseModal({ language = "en", onClose }) {
  const isZh = language === "zh";
  const tx = (value) => (isZh ? translateFactoryMainText(value) : value);
  return (
    <div className="factory-update-modal-layer" role="presentation">
      <div className="factory-update-modal factory-credit-purchase-modal" role="dialog" aria-modal="true" aria-labelledby="factory-credit-purchase-title">
        <CloseIconButton className="factory-update-close" label={isZh ? "关闭购买额度弹窗" : "Close credit purchase"} onClick={onClose} />
        <header>
          <h2 id="factory-credit-purchase-title">{tx("Get more credits")}</h2>
          <p>{tx("Choose a credit pack to keep sending quotes. 500 credits = $50 value.")}</p>
        </header>

        <div className="factory-credit-purchase-options">
          {factoryCreditPackages.map((pack) => (
            <button type="button" key={pack.label}>
              <span>{isZh ? pack.label.replace(/credits/g, "额度") : pack.label}</span>
              <strong>{pack.value}</strong>
            </button>
          ))}
        </div>

        <footer>
          <button className="secondary-btn" type="button" onClick={onClose}>{tx("Cancel")}</button>
          <button className="primary-btn" type="button" onClick={onClose}>{isZh ? "继续" : "Continue"}</button>
        </footer>
      </div>
    </div>
  );
}

function FactorySettingsScreen({ language = "en" }) {
  const [activeSection, setActiveSection] = useState("account");
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInvitePanelOpen, setIsInvitePanelOpen] = useState(false);
  const [paymentTab, setPaymentTab] = useState("earnings");
  const isZh = language === "zh";
  const tx = (value) => (isZh ? translateFactoryMainText(value) : value);
  const [team, setTeam] = useState([
    { name: "Ines Carvalho", email: "ines@atelierminho.pt", role: "Owner", permissions: ["rfqFlow", "addUpdate", "primaryContact", "settingsAccess"] },
    { name: "Mateo Silva", email: "mateo@atelierminho.pt", role: "Production lead", permissions: ["addUpdate"] },
    { name: "Sofia Ramos", email: "sofia@atelierminho.pt", role: "Finance", permissions: [] }
  ]);
  const account = {
    name: "Atelier Minho",
    email: "ops@atelierminho.pt",
    phone: "+351 22 000 1842",
    location: "Porto, Portugal",
    earningsPrimary: "Wise business ending in 9021",
    earningsSecondary: "Bank account ending in 1184",
    billingPrimary: "Visa ending in 4412",
    billingSecondary: "Mastercard ending in 8840"
  };
  const paymentMethods = {
    earnings: [
      { label: "Primary", name: account.earningsPrimary, note: "Receives released milestone funds from brand orders." },
      { label: "Secondary", name: account.earningsSecondary, note: "Backup account for receiving earnings." }
    ],
    billing: [
      { label: "Primary", name: account.billingPrimary, note: "Used to pay platform fees, services, or billing charges." },
      { label: "Secondary", name: account.billingSecondary, note: "Backup method for billing charges." }
    ]
  };

  const togglePermission = (memberEmail, permission) => {
    const permissionMeta = factorySettingsPermissionLabels.find((item) => item.key === permission);
    setTeam((current) =>
      current.map((member) => {
        if (permissionMeta?.single) {
          return {
            ...member,
            permissions:
              member.email === memberEmail
                ? Array.from(new Set([...member.permissions, permission]))
                : member.permissions.filter((item) => item !== permission)
          };
        }
        if (member.email !== memberEmail) return member;
        const hasPermission = member.permissions.includes(permission);
        return {
          ...member,
          permissions: hasPermission
            ? member.permissions.filter((item) => item !== permission)
            : [...member.permissions, permission]
        };
      })
    );
  };
  const removeMember = (memberEmail) => {
    setTeam((current) => current.filter((member) => member.email !== memberEmail));
  };

  const settingsNav = [
    ["account", "Basic information"],
    ["security", "Password & security"],
    ["payment", "Payment method"],
    ["team", "Team & stakeholders"],
    ["notifications", "Notifications"]
  ];
  const goToSettingsSection = (id) => {
    setActiveSection(id);
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  useEffect(() => {
    if (!isInvitePanelOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isInvitePanelOpen]);

  return (
    <div className="settings-page factory-settings-page">
      <aside className="settings-nav-panel">
        <h1>{tx("Settings")}</h1>
        <nav aria-label={tx("Settings sections")}>
          {settingsNav.map(([id, label]) => (
            <button className={activeSection === id ? "active" : ""} type="button" onClick={() => goToSettingsSection(id)} key={id}>
              {tx(label)}
            </button>
          ))}
        </nav>
      </aside>

      <section className="settings-content">
        <header className="settings-heading">
          <div>
            <p>{tx("Factory account")}</p>
            <h2>{tx("Account settings")}</h2>
          </div>
          <button className="primary-btn" type="button">{tx("Save changes")}</button>
        </header>

        <section className="settings-section" id="settings-account">
              <div className="settings-section-header">
                <h3>{tx("Basic information")}</h3>
                <p>{tx("Edit the details brands use for orders, calls, and account verification.")}</p>
              </div>
              <div className="settings-form-grid">
                <label>
                  <span>{tx("Account name")}</span>
                  <input defaultValue={account.name} />
                </label>
                <label>
                  <span>{tx("Email")}</span>
                  <input defaultValue={account.email} type="email" />
                </label>
                <label>
                  <span>{tx("Phone")}</span>
                  <input defaultValue={account.phone} />
                </label>
                <label>
                  <span>{tx("Location")}</span>
                  <input defaultValue={tx(account.location)} />
                </label>
              </div>
            </section>

            <section className="settings-section" id="settings-security">
              <div className="settings-section-header">
                <h3>{tx("Password & security")}</h3>
                <p>{tx("Update login access and keep payout or approval actions protected.")}</p>
              </div>
              <div className="settings-form-grid">
                <label>
                  <span>{tx("Current password")}</span>
                  <input placeholder={tx("Enter current password")} type="password" />
                </label>
                <label>
                  <span>{tx("New password")}</span>
                  <input placeholder={tx("Create new password")} type="password" />
                </label>
              </div>
            </section>

        <section className="settings-section" id="settings-payment">
            <div className="settings-section-header">
              <h3>{tx("Payment methods")}</h3>
              <p>{tx("Manage where you receive earnings and which method is used for billing.")}</p>
            </div>
            <div className="settings-access-tabs settings-payment-tabs" role="tablist" aria-label={tx("Payment method type")}>
              <button
                className={paymentTab === "earnings" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={paymentTab === "earnings"}
                onClick={() => setPaymentTab("earnings")}
              >
                {tx("Earnings")}
              </button>
              <button
                className={paymentTab === "billing" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={paymentTab === "billing"}
                onClick={() => setPaymentTab("billing")}
              >
                {tx("Billing")}
              </button>
            </div>
            {paymentMethods[paymentTab].map((method) => (
              <div className="settings-payment-list" key={`${paymentTab}-${method.label}`}>
                <div>
                  <span className="settings-card-brand">{tx(method.label)}</span>
                  <strong>{tx(method.name)}</strong>
                  <small>{tx(method.note)}</small>
                </div>
                <button className="settings-menu-btn" type="button" aria-label={isZh ? `更多选项：${tx(method.name)}` : `More options for ${method.name}`} />
              </div>
            ))}
            <button className="settings-add-btn" type="button">{tx("+ Add payment method")}</button>
          </section>

        <section className="settings-section" id="settings-team">
            <div className="settings-section-header split">
              <div>
                <h3>{tx("Manage team & stakeholders")}</h3>
                <p>{tx("Control who can quote RFQs, post updates, and act as the primary contact.")}</p>
              </div>
              <button className="primary-btn compact-btn" type="button" onClick={() => setIsInvitePanelOpen(true)}>{tx("Invite member")}</button>
            </div>

            <div className="settings-permission-table" role="table" aria-label={tx("Team permissions")}>
              <div className="settings-permission-row header" role="row">
                <span>{tx("Member")}</span>
                {factorySettingsPermissionLabels.map((permission) => (
                  <span key={permission.key}>
                    {tx(permission.label)}
                    {permission.detail && <small>{tx(permission.detail)}</small>}
                  </span>
                ))}
                <span aria-hidden="true" />
              </div>
              {team.map((member) => (
                <div className="settings-permission-row" role="row" key={member.email}>
                  <div>
                    <strong>{member.name}</strong>
                    <small>{tx(member.role)} - {member.email}</small>
                  </div>
                  {factorySettingsPermissionLabels.map((permission) => (
                    <label className="settings-check" key={permission.key}>
                      <input
                        type="checkbox"
                        checked={member.permissions.includes(permission.key)}
                        onChange={() => togglePermission(member.email, permission.key)}
                      />
                      <span>{tx(permission.label)}</span>
                    </label>
                  ))}
                  <button
                    className="settings-remove-member-btn"
                    type="button"
                    aria-label={isZh ? `移除 ${member.name}` : `Remove ${member.name}`}
                    disabled={member.role === "Owner"}
                    onClick={() => removeMember(member.email)}
                  >
                    <img src="/assets/prototype-icons/trash.svg" alt="" />
                  </button>
                </div>
              ))}
            </div>
          </section>

        {isInvitePanelOpen && createPortal((
          <div className="settings-drawer-layer" role="presentation">
            <button className="settings-drawer-scrim" type="button" aria-label={tx("Close invite panel")} onClick={() => setIsInvitePanelOpen(false)} />
            <aside className="settings-drawer" aria-label={tx("Invite stakeholder")}>
              <header>
                <div>
                  <h3>{tx("Invite member")}</h3>
                  <p>{tx("Add their details and choose what they can manage.")}</p>
                </div>
                <button className="settings-drawer-close" type="button" aria-label={tx("Close invite panel")} onClick={() => setIsInvitePanelOpen(false)}>
                  <img src="/assets/prototype-icons/close.svg" alt="" />
                </button>
              </header>
              <div className="settings-drawer-form">
                <label>
                  <span>{tx("Name")}</span>
                  <input placeholder={tx("Full name")} />
                </label>
                <label>
                  <span>{tx("Email")}</span>
                  <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@company.com" type="email" />
                </label>
                <label>
                  <span>{tx("Role")}</span>
                  <select defaultValue="Stakeholder">
                    <option value="Stakeholder">{tx("Stakeholder")}</option>
                    <option value="Production lead">{tx("Production lead")}</option>
                    <option value="Finance">{tx("Finance")}</option>
                    <option value="Viewer">{tx("Viewer")}</option>
                  </select>
                </label>
                <fieldset className="settings-drawer-authority">
                  <legend>{tx("Authority")}</legend>
                  {factorySettingsPermissionLabels.map((permission) => (
                    <label key={permission.key}>
                      <input type="checkbox" defaultChecked={permission.key === "addUpdate"} />
                      <span>
                        <strong>{tx(permission.label)}</strong>
                        {permission.detail && <small>{tx(permission.detail)}</small>}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </div>
              <footer>
                <button className="secondary-btn" type="button" onClick={() => setIsInvitePanelOpen(false)}>{tx("Cancel")}</button>
                <button className="primary-btn" type="button" onClick={() => setIsInvitePanelOpen(false)}>{tx("Send invite")}</button>
              </footer>
            </aside>
          </div>
        ), document.body)}

        <section className="settings-section" id="settings-notifications">
            <div className="settings-section-header">
              <h3>{tx("Notifications")}</h3>
              <p>{tx("Choose which updates should reach your team by email.")}</p>
            </div>
            {["New RFQ matches", "Payment and approval requests", "Messages and call invites"].map((label) => (
              <div className="settings-inline-row" key={label}>
                <div>
                  <strong>{tx(label)}</strong>
                  <span>{tx("Send email notifications to members with matching authority.")}</span>
                </div>
                <label className="settings-switch">
                  <input type="checkbox" defaultChecked />
                  <span />
                </label>
              </div>
            ))}
          </section>
      </section>
    </div>
  );
}

function FactoryOnboarding({ language, step, onLanguageChange, onEditSection, onBack, onNext }) {
  const copy = onboardingCopy[language];
  const current = copy.steps[step];
  const isFirst = step === 0;
  const isLast = step === copy.steps.length - 1;

  return (
    <main className="factory-onboarding-page">
      <header className="factory-onboarding-topbar">
        <img src="/assets/logo.svg" alt="The Sourcing Club" />
        <span>{language === "zh" ? `第 ${step + 1} 步 / 共 ${copy.steps.length} 步` : `Step ${step + 1} of ${copy.steps.length}`}</span>
      </header>

      <section className={`factory-onboarding-card step-${step + 1}`} aria-label={current.title}>
        {!isLast && (
          <div className="factory-onboarding-card-header">
            {isFirst && <img className="factory-onboarding-label" src="/assets/onboarding-sourcing-club-label-clean.png" alt="" />}
            <h1>{current.title}</h1>
            {current.intro && <p>{current.intro}</p>}
          </div>
        )}

        <FactoryOnboardingStep
          step={step}
          content={current}
          language={language}
          onLanguageChange={onLanguageChange}
          onEditSection={onEditSection}
        />

        <footer className="factory-onboarding-actions">
          {!isFirst && !isLast && (
            <button className="secondary-btn" type="button" onClick={onBack}>
              {copy.back}
            </button>
          )}
          <button className="primary-btn" type="button" onClick={onNext}>
            {current.cta || (isLast ? copy.steps[copy.steps.length - 1].cta : copy.next)}
          </button>
        </footer>
      </section>

      <div className="factory-onboarding-progress" aria-label="Onboarding progress">
        {copy.steps.map((item, index) => (
          <span className={index === step ? "current" : index < step ? "complete" : ""} key={item.title} />
        ))}
      </div>
    </main>
  );
}

function FactoryOnboardingStep({ step, content, language, onLanguageChange, onEditSection }) {
  if (step === 0) {
    return (
      <div className="factory-onboarding-section welcome-section">
        <p className="onboarding-time">{content.meta}</p>
        <label className="factory-onboarding-field">
          <span>{content.languageLabel}</span>
          <select value={language} onChange={(event) => onLanguageChange(event.target.value)}>
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
          {content.languageHelp && <small>{content.languageHelp}</small>}
        </label>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="factory-onboarding-form-grid">
        {content.fields.map(([label, placeholder]) => (
          <OnboardingField label={label} placeholder={placeholder} key={label} />
        ))}
        {content.add && <button className="onboarding-text-action" type="button">{content.add}</button>}
        {content.helper && <p className="onboarding-helper">{content.helper}</p>}
      </div>
    );
  }

  if (step === 2) {
    return <OnboardingBrandContext content={content} language={language} />;
  }

  if (step === 5) {
    return <OnboardingCapacitySetup content={content} language={language} />;
  }

  if (step === 3) {
    return (
      <div className="factory-onboarding-section production-fit-section">
        {content.groups.map(([label, options, selected]) => (
          <OnboardingChipGroup label={label} options={options} selected={selected} balanced language={language} key={label} />
        ))}
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="factory-onboarding-section production-fit-section">
        {content.groups.map(([label, options, selected]) => (
          <OnboardingChipGroup label={label} options={options} selected={selected} language={language} key={label} />
        ))}
        <OnboardingField label={content.equipmentLabel} placeholder={content.equipmentPlaceholder} />
      </div>
    );
  }

  if (step === 6) {
    return (
      <div className="factory-onboarding-section verification-step">
        <div className="verification-upload-block">
          <strong>{content.businessLabel}</strong>
          <button className="onboarding-file-upload" type="button">{content.businessUpload}</button>
          <small>{content.businessHelper}</small>
        </div>
        <div className="certification-add-control">
          <label className="factory-onboarding-field">
            <span>{content.certificationLabel}</span>
            <input placeholder={content.search} />
          </label>
          <button className="secondary-btn" type="button">{content.add}</button>
        </div>
        <div className="certification-upload-list">
          {content.certifications.map(([name, status]) => (
            <div className="certification-upload-row" key={name}>
              <div className="certification-upload-heading">
                <strong>{name}</strong>
              </div>
              {status === "uploaded" ? (
                <div className="certification-file-row">
                  <div>
                    <span>{`${name.replace(/\s+/g, "-").toLowerCase()}-certificate.pdf`}</span>
                    <small>{content.uploadedCertificate}</small>
                  </div>
                  <button type="button">
                    <img src="/assets/prototype-icons/trash.svg" alt="" />
                    {content.deleteCertificate}
                  </button>
                </div>
              ) : (
                <>
                  <button className="onboarding-file-upload certification-file-upload" type="button">{content.uploadCertificate}</button>
                  <small>{content.certificateHelper}</small>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="onboarding-reference-row compact">
          <strong>{content.reference}</strong>
          <div>
            <input placeholder={language === "zh" ? "公司名称" : "Company name"} />
            <input placeholder={language === "zh" ? "联系人或公开链接" : "Contact or public link"} />
          </div>
          <button className="onboarding-text-action muted" type="button">{content.addReference}</button>
          <small>{content.referenceHelper}</small>
        </div>
      </div>
    );
  }

  if (step === 7) {
    const [primaryChecklist, secondaryChecklist] = [content.checklist.slice(0, 3), content.checklist.slice(3)];

    return (
      <div className="factory-onboarding-section walkthrough-section">
        <p className="onboarding-later-note">{content.laterNote}</p>
        <section className="walkthrough-panel">
          <strong>{content.instructionTitle}</strong>
          <p>{content.instructionCopy}</p>
          <span>{content.instructionMeta}</span>
        </section>
        <section className="walkthrough-panel walkthrough-checklist">
          <strong>{content.checklistTitle}</strong>
          <div>
            {[primaryChecklist, secondaryChecklist].map((items, index) => (
              <ul key={index}>
                {items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ))}
          </div>
        </section>
        <section className="walkthrough-options">
          <strong>{content.optionTitle}</strong>
          <div>
            {content.options.map(([title, helper]) => (
              <button className="walkthrough-option" type="button" key={title}>
                <strong>{title}</strong>
                <small>{helper}</small>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (step === 8) {
    const reviewEditSteps = [1, 3, 5];
    const editLabel = language === "zh" ? "编辑" : "Edit";

    return (
      <div className="factory-review-grid">
        {content.sections.map(([title, rows], index) => (
          <section className="factory-review-section" key={title}>
            <div className="factory-review-section-header">
              <h2>{title}</h2>
              <button
                className="factory-review-section-edit"
                type="button"
                aria-label={`${editLabel} ${title}`}
                onClick={() => onEditSection?.(reviewEditSteps[index] || 1)}
              >
                {editLabel}
              </button>
            </div>
            <div className="factory-onboarding-review-rows">
              {rows.map(([label, value]) => (
                <ProfileDetailPair label={label} value={value} key={label} />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  if (step === 9) {
    return (
      <div className="factory-onboarding-section terms-section">
        {content.terms.map(([term, description], index) => (
          <article key={term}>
            <h2>{index + 1}. {term}</h2>
            <p>{description}</p>
          </article>
        ))}
        <label className="directory-check terms-check">
          <input type="checkbox" defaultChecked />
          <span>{content.agreement}</span>
        </label>
        <OnboardingField label={language === "zh" ? "签名" : "Signature"} placeholder={content.signature} />
      </div>
    );
  }

  return (
    <div className="factory-onboarding-complete">
      <img className="factory-onboarding-success-icon" src="/assets/prototype-icons/success.svg" alt="" />
      <h1>{content.title}</h1>
      <p>{content.intro}</p>
      <section className="factory-onboarding-credit-reward">
        <span>{language === "zh" ? "验证奖励" : "Verification reward"}</span>
        <strong>{language === "zh" ? "500 额度" : "500 credits"}</strong>
        <p>{language === "zh" ? "资料通过验证后可用于发送报价。500 额度 = $50 价值。" : "Available after your profile is verified. 500 credits = $50 value."}</p>
      </section>
    </div>
  );
}

function OnboardingBrandContext({ content, language }) {
  return (
    <div className="factory-brand-context-step">
      <label className="factory-onboarding-field full-width">
        <span>{content.brandLabel}</span>
        <textarea placeholder={content.brandPlaceholder} />
      </label>

      <div className="factory-brand-context-upload-grid">
        <OnboardingAssetUploadCard
          title={content.logoTitle}
          helper={content.logoHelper}
          accept={content.logoAccept}
          uploadLabel={language === "zh" ? "点击或拖拽文件上传" : "Click or drag files to upload"}
        />
        <OnboardingAssetUploadCard
          title={content.imagesTitle}
          helper={content.imagesHelper}
          accept={content.imagesAccept}
          uploadLabel={language === "zh" ? "点击或拖拽文件上传" : "Click or drag files to upload"}
        />
      </div>
    </div>
  );
}

function OnboardingAssetUploadCard({ title, helper, accept, uploadLabel }) {
  return (
    <section className="factory-brand-asset-card">
      <div>
        <strong>{title}</strong>
        <span>{helper}</span>
      </div>
      <button className="onboarding-file-upload factory-brand-asset-upload" type="button">{uploadLabel}</button>
      <small>{accept}</small>
    </section>
  );
}

function OnboardingField({ label, placeholder }) {
  return (
    <label className="factory-onboarding-field">
      <span>{label}</span>
      <input placeholder={placeholder} />
    </label>
  );
}

function OnboardingCapacitySetup({ content, language }) {
  const [lineHours, setLineHours] = useState("2400");
  const [capacityUnits, setCapacityUnits] = useState("7200");
  const [capacityInputMode, setCapacityInputMode] = useState("units");
  const [selectedCategory, setSelectedCategory] = useState("wovens");
  const [monthOffset, setMonthOffset] = useState(0);
  const [monthSelections, setMonthSelections] = useState({
    Aug: "open",
    Sep: "partial",
    Oct: "full",
    Nov: "partial",
    Dec: "open",
    Jan: "open"
  });
  const months = ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan"];
  const monthPageSize = 3;
  const visibleMonths = months.slice(monthOffset, monthOffset + monthPageSize);
  const currentMonth = visibleMonths[0];
  const options = language === "zh"
    ? [
        { key: "open", label: "较空", note: "60-100% 可接单" },
        { key: "partial", label: "部分已订", note: "25-60% 可接单" },
        { key: "full", label: "较满", note: "0-25% 可接单" }
      ]
    : [
        { key: "open", label: "Mostly open", note: "60-100% open" },
        { key: "partial", label: "Partly booked", note: "25-60% open" },
        { key: "full", label: "Mostly full", note: "0-25% open" }
      ];
  const levelRanges = {
    open: { min: 60, max: 100 },
    partial: { min: 25, max: 60 },
    full: { min: 0, max: 25 }
  };
  const activeCategory = FACTORY_CAPACITY_CATEGORIES.find((category) => category.key === selectedCategory) || FACTORY_CAPACITY_CATEGORIES[1];
  const activeRange = levelRanges[monthSelections[currentMonth]] || levelRanges.open;
  const availableHours = Math.max(0, Number.parseInt(lineHours || "0", 10) || 0);
  const directUnits = Math.max(0, Number.parseInt(capacityUnits || "0", 10) || 0);
  const monthlyUnitCapacity = capacityInputMode === "hours"
    ? Math.round((availableHours * 60) / activeCategory.minutesPerPiece)
    : directUnits;
  const minPieces = Math.round(monthlyUnitCapacity * (activeRange.min / 100));
  const maxPieces = Math.round(monthlyUnitCapacity * (activeRange.max / 100));
  const pieceSummary = minPieces === maxPieces ? maxPieces.toLocaleString() : `${minPieces.toLocaleString()}-${maxPieces.toLocaleString()}`;
  const categoryLabel = language === "zh" ? activeCategory.labelZh : activeCategory.label;
  const monthLabel = language === "zh" ? translateFactoryMainText(currentMonth) : currentMonth;
  const brandPreview = language === "zh"
    ? `品牌将看到：${categoryLabel} · ${monthLabel} 可开始 · 当月约 ${pieceSummary} 件`
    : `Brands will see: ${categoryLabel} · ${currentMonth} start · roughly ${pieceSummary} pieces that month`;

  return (
    <div className="onboarding-capacity-setup">
      <div className="factory-onboarding-form-grid">
        {content.fields.map(([label, placeholder]) => (
          <OnboardingField label={label} placeholder={placeholder} key={label} />
        ))}
      </div>

      <section className="onboarding-capacity-panel">
        <div className="onboarding-capacity-topline">
          <span>{language === "zh" ? "品类" : "Category"}</span>
          <label className="capacity-select-field onboarding-capacity-select">
            <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} aria-label={language === "zh" ? "选择品类" : "Select category"}>
              {FACTORY_CAPACITY_CATEGORIES.map((category) => (
                <option value={category.key} key={category.key}>{language === "zh" ? category.labelZh : category.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="capacity-section-heading-row onboarding-capacity-input-heading">
          <p className="capacity-helper">
            {capacityInputMode === "hours"
              ? (language === "zh" ? "每月可用产线工时" : "Line-hours available per month")
              : (language === "zh" ? "每月可生产件数" : "Units available per month")}
          </p>
          <div className="capacity-mode-toggle" role="group" aria-label={language === "zh" ? "产能输入方式" : "Capacity input method"}>
            <button className={capacityInputMode === "units" ? "selected" : ""} type="button" onClick={() => setCapacityInputMode("units")}>{language === "zh" ? "件数" : "Units"}</button>
            <button className={capacityInputMode === "hours" ? "selected" : ""} type="button" onClick={() => setCapacityInputMode("hours")}>{language === "zh" ? "工时" : "Hours"}</button>
          </div>
        </div>

        <label className="line-hours-control onboarding-line-hours">
          {capacityInputMode === "hours" ? (
            <input
              inputMode="numeric"
              value={lineHours}
              onChange={(event) => setLineHours(event.target.value.replace(/\D/g, ""))}
              aria-label={content.lineHoursLabel}
            />
          ) : (
            <input
              inputMode="numeric"
              value={capacityUnits}
              onChange={(event) => setCapacityUnits(event.target.value.replace(/\D/g, ""))}
              aria-label={language === "zh" ? "每月可生产件数" : "Units available per month"}
            />
          )}
          <span>{capacityInputMode === "hours" ? (language === "zh" ? "小时 / 月" : "hours / month") : (language === "zh" ? "件 / 月" : "units / month")}</span>
        </label>

        {capacityInputMode === "hours" && (
          <div className="reference-style-card onboarding-reference-style">
            <div>
              <strong>{language === "zh" ? activeCategory.referenceStyleZh : activeCategory.referenceStyle}</strong>
              <span>{language === "zh" ? `~${activeCategory.minutesPerPiece} 分钟 / 件参考款` : `~${activeCategory.minutesPerPiece} min/pc reference style`}</span>
            </div>
            <p>
              {language === "zh"
                ? "切换品类时，参考款和每件用时会一起改变。"
                : "Changing category updates the reference style and time per unit."}
            </p>
          </div>
        )}

        <div className="onboarding-month-section">
          <div className="onboarding-month-heading-row">
            <h2>{content.monthTitle}</h2>
            <div className="capacity-month-nav onboarding-month-nav" aria-hidden="true">
              <button type="button" onClick={() => setMonthOffset((offset) => Math.max(0, offset - monthPageSize))}><span>‹</span></button>
              <button type="button" onClick={() => setMonthOffset((offset) => Math.min(months.length - monthPageSize, offset + monthPageSize))}><span>›</span></button>
            </div>
          </div>
          <div className="onboarding-month-list">
            {visibleMonths.map((month) => (
              <div className="onboarding-month-row" key={month}>
                <span>{language === "zh" ? translateFactoryMainText(month) : month}</span>
                <div>
                  {options.map((option) => (
                    <button
                      className={monthSelections[month] === option.key ? "selected" : ""}
                      type="button"
                      onClick={() => setMonthSelections((current) => ({ ...current, [month]: option.key }))}
                      key={option.key}
                    >
                      <strong>{option.label}</strong>
                      <small>{option.note}</small>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="capacity-brand-preview onboarding-capacity-preview">
          <span>{language === "zh" ? "品牌将看到" : "BRANDS WILL SEE"}</span>
          <strong>{brandPreview}</strong>
        </div>
      </section>
    </div>
  );
}

function OnboardingChipGroup({ label, options, selected = [], balanced = false, language = "en" }) {
  const [selectedOptions, setSelectedOptions] = useState(selected);
  const [customOptions, setCustomOptions] = useState([]);
  const [customValue, setCustomValue] = useState("");
  const isSingleSelect = label.toLowerCase().includes("market") || label.includes("市场");
  const canAddCustom = ["production type", "product categories", "makes", "specializes", "生产类型", "产品品类", "可生产款式", "专长"].some((term) =>
    label.toLowerCase().includes(term)
  );
  const groupCopy = {
    "Makes": {
      title: "What products do you make?",
      helper: "Select all that apply, then add as many specific product types as you want to help brands find you."
    },
    "Specializes in": {
      title: "What do you specialize in?",
      helper: "Select the capabilities brands should know about, then add your own."
    },
    "Production type": {
      title: "Production type",
      helper: "Choose the main production methods your factory can reliably support."
    },
    "Product categories": {
      title: "Product categories",
      helper: "Choose the garment categories your factory can produce."
    },
    "Market level": {
      title: "Market level",
      helper: "Choose the brand price level your factory is best set up for."
    },
    "Design Services": {
      title: "Design services",
      helper: "Select the product development services you can offer before production."
    },
    "3D & digital tools (optional)": {
      title: "3D & digital tools",
      helper: "Optional: select tools your team uses for development or production."
    },
    "可生产款式": {
      title: "你可以生产哪些具体款式？",
      helper: "可多选，也可以添加任意数量的自定义款式。"
    },
    "专长": {
      title: "你的工厂有哪些专长？",
      helper: "选择品牌需要了解的能力，也可以添加自定义专长。"
    },
    "生产类型": {
      title: "生产类型",
      helper: "选择工厂可以稳定支持的主要生产方式。"
    },
    "产品品类": {
      title: "产品品类",
      helper: "选择你的工厂可以生产的成衣品类。"
    },
    "市场层级": {
      title: "市场层级",
      helper: "选择你的工厂最适合服务的品牌价格层级。"
    },
    "设计服务": {
      title: "设计服务",
      helper: "选择你在生产前可以提供的产品开发服务。"
    },
    "3D 和数字工具（选填）": {
      title: "3D 和数字工具",
      helper: "选填：选择团队在开发或生产中使用的工具。"
    }
  };
  const copy = groupCopy[label] || { title: label, helper: "" };
  const visibleOptions = [...options, ...customOptions];
  const isZh = language === "zh";

  const toggleOption = (option) => {
    setSelectedOptions((current) => {
      if (isSingleSelect) {
        return [option];
      }

      return current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option];
    });
  };
  const addCustomOption = (event) => {
    event.preventDefault();
    const nextOption = customValue.trim();
    if (!nextOption || visibleOptions.includes(nextOption)) return;
    setCustomOptions((current) => [...current, nextOption]);
    setSelectedOptions((current) => [...current, nextOption]);
    setCustomValue("");
  };

  return (
    <section className={balanced ? "onboarding-chip-group balanced" : "onboarding-chip-group"}>
      <div className="onboarding-chip-heading">
        <h2>{copy.title}</h2>
        {copy.helper && <p>{copy.helper}</p>}
      </div>
      <div className="tag-row compact-tags">
        {visibleOptions.map((option) => (
          <button
            className={selectedOptions.includes(option) ? "tag selected" : "tag"}
            type="button"
            aria-pressed={selectedOptions.includes(option)}
            onClick={() => toggleOption(option)}
            key={option}
          >
            {option}
          </button>
        ))}
      </div>
      {canAddCustom && (
        <form className="onboarding-chip-add-row" onSubmit={addCustomOption}>
          <input
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            placeholder={isZh ? "添加自定义选项" : "Add your own"}
          />
          <button className="secondary-btn compact-btn" type="submit">{isZh ? "添加" : "Add"}</button>
        </form>
      )}
    </section>
  );
}

function FilterGroup({ title, children }) {
  return (
    <section className="directory-filter-group">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function FilterCheck({ checked = false, label }) {
  return (
    <label className="directory-check">
      <input type="checkbox" defaultChecked={checked} />
      <span>{label}</span>
    </label>
  );
}

function SearchIcon() {
  return (
    <svg className="search-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.75" cy="8.75" r="5.25" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M12.6 12.6L16.25 16.25" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function CloseIconButton({ className = "", label, onClick }) {
  return (
    <button className={className} type="button" aria-label={label} onClick={onClick}>
      <img src="/assets/prototype-icons/close.svg" alt="" />
    </button>
  );
}

function Metric({ label, value, className = "" }) {
  return (
    <div className={className ? `metric ${className}` : "metric"}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function BrandProjectCard({ project, language, onViewDetails }) {
  const isZh = language === "zh";
  const translatedTitle = getTranslatedProjectTitle(project.title);
  const requestImages = project.images || [];
  const [primaryImage, ...supportImages] = requestImages;
  const hasGallery = requestImages.length >= 3;
  const requestFacts = [
    ["Unit target", project.budget],
    ["Quantity", project.quantity],
    ["Samples", project.samples],
    ["Quote due", project.quoteDue]
  ];

  return (
    <article className={project.featured ? "factory-request-card featured shared-responsive-card shared-browse-rfq-card" : "factory-request-card shared-responsive-card shared-browse-rfq-card"}>
      <header className="factory-request-card-top shared-card-header">
        <div className="factory-request-title shared-card-heading">
          <div className="factory-avatar">{project.initials}</div>
          <div>
            <h2 data-no-translate={!isZh || undefined}>{isZh ? translatedTitle : project.title}</h2>
            <p data-no-translate>
              {isZh ? getTranslatedListMeta(`${project.brand} · ${project.location} · ${project.posted}`) : `${project.brand} · ${project.location} · ${project.posted}`}
            </p>
          </div>
        </div>
        <div className="factory-request-card-actions shared-card-actions">
          <span className={`factory-project-fit shared-card-status ${project.fitTone}`}>{project.capacity[0]}</span>
          <button className="secondary-btn" type="button">Save</button>
          <button className="primary-btn" type="button" onClick={onViewDetails}>View RFQ</button>
        </div>
      </header>

      <div className="factory-request-card-body shared-card-body">
        <aside className="factory-request-brief">
          <div className="factory-request-facts">
            {requestFacts.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          {isZh ? (
            <TranslatedProjectSummary project={project} />
          ) : (
            <p data-no-translate>{project.specialty}</p>
          )}
          <div className="factory-request-trust">
            <span className="factory-request-trust-icon" aria-hidden="true">$</span>
            <strong>Payment verified</strong>
            <span>{project.trust}</span>
          </div>
          <div className="factory-request-tags">
            <span className="marketplace-tag-label">Request tags</span>
            <div className="tag-row compact-tags">
              {project.tags.map((tag) => (
                <span className="tag garment-tag" key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        </aside>

        <div className={hasGallery ? "factory-request-visuals has-gallery" : "factory-request-visuals"} aria-label={`${project.brand} request references`}>
          {primaryImage ? (
            <figure className="factory-request-visual-main">
              <img src={primaryImage.src} alt={`${project.title} ${primaryImage.label}`} />
              <figcaption>{primaryImage.label}</figcaption>
            </figure>
          ) : (
            <div className="factory-request-visual-placeholder">
              <strong>No reference image uploaded</strong>
              <span>Review the written brief, request tags, and attached tech pack in details.</span>
            </div>
          )}
          {hasGallery && supportImages.slice(0, 2).map((image) => (
            <figure key={image.label}>
              <img src={image.src} alt={`${project.title} ${image.label}`} />
              <figcaption>{image.label}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </article>
  );
}

function getTranslatedProjectTitle(title) {
  const translatedTitles = {
    "Organic cotton woven shirt production": "有机棉梭织衬衫生产订单",
    "Premium knit capsule for resort drop": "高级针织度假系列生产订单",
    "Denim jacket wash development and small bulk": "牛仔夹克洗水开发与小批量生产",
    "Low-MOQ swim capsule with recycled nylon": "再生尼龙低起订量泳装系列"
  };

  return translatedTitles[title] || title;
}

function ListTranslationMeta() {
  return (
    <div className="brand-brief-translation-meta list-card-translation-meta">
      <span>由英文自动翻译</span>
      <button type="button">查看英文原文</button>
    </div>
  );
}

function getTranslatedListMeta(meta) {
  const replacements = {
    "New York, USA": "纽约，美国",
    "Los Angeles, USA": "洛杉矶，美国",
    "Toronto, Canada": "多伦多，加拿大",
    "Miami, USA": "迈阿密，美国",
    "Austin, USA": "奥斯汀，美国",
    "Seoul, Korea": "首尔，韩国",
    "Porto, Portugal": "波尔图，葡萄牙",
    "Payment verified": "付款已验证",
    "$25k+ spent": "已消费 $25k+",
    "$5k+ spent": "已消费 $5k+",
    "Posted 18 minutes ago": "18 分钟前发布",
    "Posted yesterday": "昨天发布",
    "Posted 2 days ago": "2 天前发布",
    "Started Jul 19": "7 月 19 日开始",
    "Started Jul 12": "7 月 12 日开始",
    "Started Jul 10": "7 月 10 日开始",
    "Started Jul 8": "7 月 8 日开始"
  };

  return meta.split(" · ").map((part, index) => {
    if (index === 0) return part;
    return replacements[part] || part;
  }).join(" · ");
}

function getTranslatedListDescription(item) {
  const translatedDescriptions = {
    "300 women’s woven shirts in organic cotton poplin. Fit + PP sample before bulk approval.":
      "300 件女装有机棉府绸梭织衬衫。大货审批前需要试身样和 PP 样。",
    "Fine-gauge merino blend tops and cardigans. Brand wants visible sample-room support.":
      "精纺美利奴混纺上衣和开衫。品牌希望看到清晰的样品间支持。",
    "Rigid denim jacket with two washes. Needs wash-down samples, trims confirmation, and split delivery.":
      "硬挺牛仔夹克，包含两种洗水。需要洗水样、辅料确认和分批交付安排。",
    "Small recycled nylon swim run with size set sample and packaging guidance.":
      "小批量再生尼龙泳装生产，需要齐码样和包装建议。",
    "Small capsule of lightweight knit tops with PP sample before bulk approval.":
      "轻薄针织上衣小系列，大货审批前需要 PP 样。",
    "Denim jacket wash development with revised 500-unit production run.":
      "牛仔夹克洗水开发，并调整为 500 件生产安排。",
    "Low-MOQ swim set capsule using recycled nylon and contrast binding.":
      "低起订量再生尼龙泳装套装系列，包含撞色包边。"
  };

  return translatedDescriptions[item.description] || getTranslatedProjectSummary(item);
}

function TranslatedProjectSummary({ project }) {
  return (
    <div className="brand-card-translation">
      <strong>{getTranslatedProjectSummary(project)}</strong>
      <div className="brand-brief-translation-meta">
        <span>由英文自动翻译</span>
        <button type="button">查看英文原文</button>
      </div>
    </div>
  );
}

function getTranslatedProjectSummary(project) {
  const translatedSummaries = {
    "Organic cotton woven shirt production": "女装有机棉府绸梭织衬衫：3 个颜色，每色 100 件。品牌需要在大货审批前完成试身样和 PP 样。",
    "Premium knit capsule for resort drop": "高级针织度假系列：精纺美利奴混纺上衣和开衫。品牌希望看到清晰的样品间支持。",
    "Denim jacket wash development and small bulk": "牛仔夹克洗水开发和小批量生产：需要 revised 500 件生产安排，并确认洗水开发产能。"
  };

  return translatedSummaries[project.title] || project.specialty;
}

function FactoryProjectDetail({ project, language, onBack, onSendQuote }) {
  const isZh = language === "zh";
  const translatedTitle = getTranslatedProjectTitle(project.title);
  const requestImages = project.images || [];
  const [primaryImage, ...supportImages] = requestImages;
  const hasGallery = requestImages.length >= 3;
  const requestFacts = [
    ["Unit target", project.budget],
    ["Quantity", project.quantity],
    ["Samples", project.samples],
    ["Quote due", project.quoteDue]
  ];

  return (
    <main className="factory-detail-page">
      <header className="factory-detail-header">
        <button className="text-link" type="button" onClick={onBack}>‹ Back to explore</button>
        <h1>RFQ details</h1>
        <p>Review the brand request, attachments, and quote requirements before sending your factory response.</p>
      </header>

      <div className="factory-detail-layout">
        <section className="factory-detail-main">
          <article className={project.featured ? "factory-request-card featured factory-detail-hero-card" : "factory-request-card factory-detail-hero-card"}>
            <div className="factory-request-card-top">
              <div className="factory-request-title">
                <div className="factory-avatar">{project.initials}</div>
                <div>
                  <h1 data-no-translate={!isZh || undefined}>{isZh ? translatedTitle : project.title}</h1>
                  <p data-no-translate>
                    {isZh ? getTranslatedListMeta(`${project.brand} · ${project.location} · ${project.posted}`) : `${project.brand} · ${project.location} · ${project.posted}`}
                  </p>
                </div>
              </div>
            </div>

            {isZh && (
              <div className="brand-brief-translation-meta factory-detail-translation-meta">
                <span>由英文自动翻译</span>
                <button type="button">查看英文原文</button>
              </div>
            )}

            <div className="factory-request-card-body">
              <aside className="factory-request-brief">
                <div className="factory-request-facts">
                  {requestFacts.map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                {isZh ? (
                  <TranslatedProjectSummary project={project} />
                ) : (
                  <p data-no-translate>{project.specialty}</p>
                )}
                <div className="factory-request-trust">
                  <span className="factory-request-trust-icon" aria-hidden="true">$</span>
                  <strong>Payment verified</strong>
                  <span>{project.trust}</span>
                </div>
                <div className="factory-request-tags">
                  <span className="marketplace-tag-label">Request tags</span>
                  <div className="tag-row compact-tags">
                    {project.tags.map((tag) => (
                      <span className="tag garment-tag" key={tag}>{tag}</span>
                    ))}
                  </div>
                </div>
              </aside>

              <div className={hasGallery ? "factory-request-visuals has-gallery" : "factory-request-visuals"} aria-label={`${project.brand} request references`}>
                {primaryImage ? (
                  <figure className="factory-request-visual-main">
                    <img src={primaryImage.src} alt={`${project.title} ${primaryImage.label}`} />
                    <figcaption>{primaryImage.label}</figcaption>
                  </figure>
                ) : (
                  <div className="factory-request-visual-placeholder">
                    <strong>No reference image uploaded</strong>
                    <span>Review the written brief, request tags, and attached tech pack in details.</span>
                  </div>
                )}
                {hasGallery && supportImages.slice(0, 2).map((image) => (
                  <figure key={image.label}>
                    <img src={image.src} alt={`${project.title} ${image.label}`} />
                    <figcaption>{image.label}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </article>

          <DetailCard title="Project brief">
            <BrandBrief language={language} />
          </DetailCard>

          <DetailCard title="Quote-ready details">
            <div className="factory-detail-grid">
              <ProfileDetailPair label="Target unit price" value={project.budget} />
              <ProfileDetailPair label="Quantity" value={project.quantity} />
              <ProfileDetailPair label="Color split" value="3 colors · 100 each" />
              <ProfileDetailPair label="Sample plan" value={project.samples} />
              <ProfileDetailPair label="Bulk timeline" value="Late September" />
            </div>
          </DetailCard>

          <DetailCard title="Materials and requirements">
            <div className="factory-materials-summary">
              <ProfileDetailPair label="Main material" value="Organic cotton poplin, mid-weight" />
              <ProfileDetailPair label="Quality preference" value="GOTS preferred; brand can confirm certification path" />
            </div>
            <section className="factory-sourcing-responsibility">
              <h3>Material sourcing responsibility</h3>
              <div>
                <span>Factory should source</span>
                <p>Organic cotton poplin and button trims from the brand-approved direction.</p>
              </div>
              <div>
                <span>Brand will provide</span>
                <p>Labels, packaging, final color standards, and approval on material direction.</p>
              </div>
              <div>
                <span>Confirm in quote</span>
                <p>Which fabric, trim, or component costs are included, plus any MOQ or lead-time assumptions.</p>
              </div>
            </section>
          </DetailCard>

          <DetailCard title="Brand attachments">
            <div className="factory-card-header-row">
              <p>Review these before quoting. Files open in the brand request workspace.</p>
              <button className="text-link" type="button">Download files</button>
            </div>
            <div className="factory-attachment-row">
              {["Tech pack v3.pdf", "Measurement chart", "Reference photos"].map((file) => (
                <button type="button" key={file}>
                  {file}
                  <img src="/assets/prototype-icons/download.svg" alt="" />
                </button>
              ))}
            </div>
          </DetailCard>

          <DetailCard title="Questions to answer in your quote">
            <ol className="factory-detail-list" data-no-translate>
              <li>Can you quote fit sample and PP sample separately?</li>
              <li>Can you support 3 colors at 100 units each?</li>
              <li>Which materials or components can you source, and what do you need the brand to provide?</li>
            </ol>
          </DetailCard>

          <DetailCard title="Required capabilities">
            <div className="tag-row compact-tags factory-detail-tags">
              {["Cut & sew", "GOTS preferred", "Pattern support", "Sample-room support"].map((tag) => (
                <span className="tag" key={tag}>{tag}</span>
              ))}
            </div>
          </DetailCard>
        </section>

        <aside className="factory-detail-side factory-detail-top-side">
          <section className="factory-side-card project-fit-card">
            <h2>Request match</h2>
            <p>Your August capacity and low-MOQ woven experience match the brand request.</p>
            <span className="factory-project-fit strong">Strong fit</span>
            <div className="factory-side-actions">
              <button className="primary-btn" type="button" onClick={onSendQuote}>Send quote</button>
              <button className="secondary-btn" type="button">Save request</button>
            </div>
          </section>

          <section className="factory-side-card">
            <div className="factory-client-row">
              <span>MR</span>
              <div>
                <h2>Maison Rue</h2>
                <p>New York, USA</p>
              </div>
            </div>
            <div className="factory-client-facts">
              <ProfileDetailPair label="Verified brand" value="Yes" />
              <ProfileDetailPair label="Club orders" value="4" />
              <ProfileDetailPair label="Avg. response" value="1 day" />
              <ProfileDetailPair label="Payment status" value="Verified" />
            </div>
          </section>

          <section className="factory-side-card activity-card">
            <h2>Activity on this request</h2>
            <ul>
              <li>Activity on this request</li>
              <li>3 quotes received</li>
              <li>Last viewed by brand: 12 min ago</li>
              <li>Shortlist starts after Jul 24</li>
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}

function BrandBrief({ language }) {
  const isZh = language === "zh";

  return (
    <div className="brand-brief-copy">
      {isZh && (
        <div className="brand-brief-translation-meta">
          <span>由英文自动翻译</span>
          <button type="button">查看英文原文</button>
        </div>
      )}
      {isZh ? (
        <>
          <p>
            Maison Rue 正在寻找一家经过审核的裁剪车缝工厂，为女装有机棉梭织衬衫生产订单报价。
            品牌已有 tech pack，希望工厂清楚报价第一阶段样品路径和小批量生产安排。
          </p>
          <p>
            这份需求刻意保持精简：请确认单价、样品费用、时间线、面料 GSM 问题，
            以及在进入合同条款前，所需颜色分配是否可行。
          </p>
        </>
      ) : (
        <>
          <p data-no-translate>
            Maison Rue is looking for a vetted cut-and-sew factory for women's organic cotton woven shirts.
            The brand has a tech pack and wants factories to quote the first sample path and a small
            production run clearly.
          </p>
          <p data-no-translate>
            The request is intentionally lean: confirm unit price, sample costs, timeline, fabric GSM
            questions, and whether the requested color split is workable before moving to contract terms.
          </p>
        </>
      )}
    </div>
  );
}

function FactoryProjectProgressDetail({ language, onBack, onPostUpdate, showPostedUpdate = false }) {
  const [updateMilestone, setUpdateMilestone] = useState(null);
  const [activeDetailTab, setActiveDetailTab] = useState("overview");
  const isZh = language === "zh";
  const detailTabs = [
    ["overview", "Overview"],
    ["files", "Files"],
    ["contract", "Contract details"]
  ];

  return (
    <main className="factory-detail-page factory-project-detail-page">
      <header className="factory-detail-header factory-project-detail-header">
        <button className="text-link" type="button" onClick={onBack}>‹ Back to production orders</button>
        <h1 data-no-translate>{isZh ? getTranslatedProjectTitle("Organic cotton woven shirt production") : "Organic cotton woven shirt production"}</h1>
        <p data-no-translate>{isZh ? getTranslatedListMeta("Maison Rue · New York, USA · Started Jul 19") : "Maison Rue · New York, USA · Started Jul 19"}</p>
      </header>

      <div className="factory-project-detail-grid">
        <section className="factory-project-detail-main">
          <section className="factory-project-summary-card" aria-label="Production order summary">
            <Metric label="order total" value="$5,780" />
            <Metric label="funded" value="$120" />
            <Metric label="remaining" value="$5,660" />
            <Metric label="next payment" value="$1,656" className="highlight" />
          </section>

          <nav className="rfqs-tabs factory-project-detail-tabs" aria-label="Production order detail sections">
            {detailTabs.map(([key, label]) => (
              <button
                className={activeDetailTab === key ? "active" : ""}
                type="button"
                aria-current={activeDetailTab === key ? "page" : undefined}
                onClick={() => setActiveDetailTab(key)}
                key={key}
              >
                {label}
              </button>
            ))}
          </nav>

          {activeDetailTab === "overview" && (
            <section className="factory-milestone-card">
              <h2>Production timeline</h2>
              <div className="factory-milestone-list">
                {factoryProjectMilestones.map((milestone, index) => (
                  <FactoryMilestoneItem
                    milestone={milestone}
                    index={index}
                    key={milestone.title}
                    onAddUpdate={setUpdateMilestone}
                    showUpdate={showPostedUpdate && index === 0}
                  />
                ))}
              </div>
            </section>
          )}
          {activeDetailTab === "files" && <FactoryProjectFilesPanel />}
          {activeDetailTab === "contract" && <FactoryContractDetailsPanel />}
        </section>

        <aside className="factory-detail-side">
          <section className="factory-side-card">
            <div className="factory-client-row">
              <span>MR</span>
              <div>
                <h2>Maison Rue</h2>
                <p>New York, USA</p>
              </div>
            </div>
            <button className="secondary-btn" type="button">Message</button>
          </section>

          <section className="factory-side-card activity-card">
            <h2>Order activity</h2>
            <ul>
              <li>Factory last viewed order 2h ago</li>
              <li>Last message yesterday</li>
              <li>Sample photos expected Aug 16</li>
              <li>Bulk deposit locked until approval</li>
            </ul>
          </section>
        </aside>
      </div>
      {updateMilestone && (
        <AddUpdateModal
          language={language}
          milestone={updateMilestone}
          onClose={() => setUpdateMilestone(null)}
          onPost={() => {
            setUpdateMilestone(null);
            onPostUpdate();
          }}
        />
      )}
    </main>
  );
}

function FactoryProjectFilesPanel() {
  const files = [
    ["Tech pack v3.pdf", "Brand spec · updated Jul 18"],
    ["Measurement chart.xlsx", "Sizing and tolerance sheet"],
    ["Fit sample photos.zip", "Factory upload · 6 files"],
    ["Approved quote.pdf", "Commercial terms reference"]
  ];

  return (
    <section className="factory-milestone-card factory-detail-tab-panel">
      <h2>Files</h2>
      <div className="factory-detail-file-list">
        {files.map(([name, meta]) => (
          <button className="factory-detail-file-row" type="button" key={name}>
            <div>
              <strong>{name}</strong>
              <span>{meta}</span>
            </div>
            <img src="/assets/prototype-icons/download.svg" alt="" />
          </button>
        ))}
      </div>
    </section>
  );
}

function FactoryContractDetailsPanel() {
  const workDetails = [
    ["Contract title", "Organic cotton woven shirt sample + bulk production"],
    ["Scope of work", "Produce organic cotton woven shirts based on the attached tech pack. Quote covers 300 units across 3 colors, fit sample and PP sample before bulk, and a 28-day bulk lead after PP approval."],
    ["Approvals, revisions, and delivery", "Fit sample + PP sample before bulk; 3 colors at 100 units per color; one included fit sample revision; QC photos before final balance; delivery address confirmed before bulk; extra revision fees quoted separately."]
  ];
  const acceptedQuote = [
    ["Brand", "Maison Rue · New York, USA"],
    ["Unit price", "$18.40"],
    ["Quantity", "300 units"],
    ["Samples", "Fit + PP · $260"],
    ["Bulk lead", "28 days"],
    ["Capacity", "Aug 12-30"],
    ["Terms", "30/70"],
    ["Quote total", "$5,780"]
  ];
  const paymentTerms = [
    ["Payment split", "30% deposit · 70% before shipment"],
    ["Sample payment", "Fit + PP samples quoted at $260"],
    ["Milestone release", "Sample funds release after brand approval; bulk funds release after final QC approval."],
    ["Release rule", "Funds release after the brand approves the relevant production step."],
    ["Shipping / incoterms", "EXW quoted · freight not included"]
  ];
  const attachments = ["Tech pack v3.pdf", "Measurement chart", "Reference photo", "Color breakdown"];

  return (
    <section className="factory-milestone-card factory-detail-tab-panel factory-contract-readonly-panel">
      <div className="factory-contract-panel-header">
        <h2>Contract details</h2>
      </div>
      <div className="factory-contract-section">
        <h3>Work details</h3>
        <div className="factory-contract-detail-grid single">
          {workDetails.map(([label, value]) => (
            <div className="factory-contract-detail-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="factory-contract-section">
        <h3>Accepted quote</h3>
        <div className="factory-contract-detail-grid">
          {acceptedQuote.map(([label, value]) => (
            <div className="factory-contract-detail-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="factory-contract-section">
        <h3>Payment and release terms</h3>
        <div className="factory-contract-detail-grid">
          {paymentTerms.map(([label, value]) => (
            <div className="factory-contract-detail-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="factory-contract-section">
        <h3>Attachments</h3>
        <div className="factory-contract-attachment-row">
          {attachments.map((file) => (
            <span key={file}>{file}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function FactoryMilestoneItem({ milestone, index, onAddUpdate, showUpdate = false }) {
  return (
    <article className={`${milestone.active ? "factory-milestone-item active" : "factory-milestone-item"}${showUpdate ? " has-update" : ""}`}>
      <div className="factory-milestone-marker">{index + 1}</div>
      <div className="factory-milestone-copy">
        <div>
          <h3>{milestone.title}</h3>
          <p>{milestone.meta}</p>
        </div>
        {milestone.amount && <strong>{milestone.amount}</strong>}
        <p>{milestone.description}</p>
        {showUpdate && <FactoryPostedUpdateCard />}
      </div>
      <button className="secondary-btn" type="button" onClick={() => onAddUpdate(milestone)}>Add update</button>
    </article>
  );
}

function FactoryPostedUpdateCard() {
  return (
    <div className="factory-posted-update-card">
      <div className="factory-posted-update-header">
        <div>
          <strong>Atelier Minho</strong>
          <span>Today, 9:48 PM</span>
        </div>
        <button type="button">View all updates (7)</button>
      </div>
      <p>Fit sample is ready for review. Uploaded front, side, and detail photos for approval.</p>
      <div className="factory-posted-file-row">
        {["Front photo", "Detail photo", "Back photo"].map((label, index) => (
          <div className="factory-posted-file" key={label}>
            <img src={factorySamplePhotos[index]} alt="" />
            <span>{label}</span>
            <img className="factory-file-download" src="/assets/prototype-icons/download.svg" alt="" />
          </div>
        ))}
        <button type="button">+3 files</button>
      </div>
    </div>
  );
}

function AddUpdateModal({ language, milestone, onClose, onPost }) {
  const isZh = language === "zh";
  const milestoneTitle = isZh ? translateFactoryMainText(milestone.title) : milestone.title.toLowerCase();

  return (
    <div className="factory-update-modal-layer" role="presentation">
      <div className="factory-update-modal" role="dialog" aria-modal="true" aria-labelledby="factory-update-title">
        <CloseIconButton className="factory-update-close" label={isZh ? "关闭添加更新" : "Close add update"} onClick={onClose} />
        <header>
          <h2 id="factory-update-title">{isZh ? `添加${milestoneTitle}更新` : `Add ${milestoneTitle} update`}</h2>
          <p>{isZh ? "分享进度照片和简短说明，供 Maison Rue 在审批此里程碑前查看。" : "Share progress photos and a short note for Maison Rue to review before this milestone is approved."}</p>
        </header>

        <label className="factory-update-note">
          <span>{isZh ? "更新说明" : "Upload note"}</span>
          <textarea defaultValue={isZh ? "选填：包装、QC 要求、运输备注，或品牌审批前需要了解的其他信息。" : "Optional: packaging, QC expectations, shipping notes, or anything factories should know before quoting."} />
        </label>

        <button className="factory-update-upload" type="button">
          <strong>{isZh ? "+ 上传照片" : "+ Upload photos"}</strong>
          <span>{isZh ? "JPG 或 PNG，最多 10 个文件" : "JPG or PNG, up to 10 files"}</span>
        </button>

        <footer>
          <button className="secondary-btn" type="button" onClick={onClose}>{isZh ? "取消" : "Cancel"}</button>
          <button className="primary-btn" type="button" onClick={onPost}>{isZh ? "发布更新" : "Post update"}</button>
        </footer>
      </div>
    </div>
  );
}

function FactorySubmitQuote({ project, language, backLabel = "‹ Back to view request", onBack, onReviewTotal }) {
  const isZh = language === "zh";

  return (
    <main className="factory-detail-page factory-submit-page">
      <div className="factory-submit-content">
        <header className="factory-detail-header factory-submit-header">
          <button className="text-link" type="button" onClick={onBack}>{backLabel}</button>
          <h1>Prepare quote</h1>
          <p>Set the unit price, sample path, lead time, and any questions before sending your quote.</p>
          {isZh && <small className="submit-page-language-hint">You can fill this page in Chinese. We'll create an English version for you to review before sending.</small>}
        </header>

        <div className="factory-submit-layout">
          <section className="factory-submit-main">
            <FactoryQuoteRequestCard project={project} language={language} />
            <FactoryQuoteSections />
          </section>

          <FactoryQuoteReminder />
        </div>
      </div>
      <footer className="factory-submit-bottom-bar">
        <div className="factory-submit-bottom-actions">
          <button className="secondary-btn" type="button">Save draft</button>
          <button className="primary-btn" type="button" onClick={onReviewTotal}>Review quote</button>
        </div>
      </footer>
    </main>
  );
}

function FactoryReviewTotal({ project, language, creditBalance, onBack, onEdit, onPurchaseCredits, onSendQuote }) {
  const isZh = language === "zh";
  const tx = (value) => (isZh ? translateFactoryMainText(value) : value);
  const creditUnit = isZh ? "额度" : "credits";
  const sendForCredits = isZh ? `发送报价，使用 ${factoryQuoteCreditCost.credits} 额度` : `Send for ${factoryQuoteCreditCost.credits} credits`;
  return (
    <main className="factory-detail-page factory-submit-page factory-review-page">
      <div className="factory-submit-content">
        <header className="factory-detail-header factory-submit-header factory-review-header">
          <button className="text-link" type="button" onClick={onEdit}>‹ Back to edit quote</button>
          <h1>Review quote</h1>
          <p>Totals are calculated after saving the quote. Review the breakdown before sending it to Maison Rue.</p>
        </header>

        <div className="factory-review-layout">
          <section className="factory-review-main">
            <FactoryQuoteRequestCard project={project} language={language} />
            <FactoryQuoteSections readOnly />
          </section>

          <aside className="factory-review-side">
            <FactoryPriceTotalCard project={project} />

            <section className="factory-submit-card factory-credit-cost-card">
              <div className="factory-credit-card-header">
                <h2>{tx("Quote credits")}</h2>
                <p>{tx("Credits are charged only when you send this quote.")}</p>
              </div>
              <div className="factory-credit-required">
                <span>{tx("Required to send")}</span>
                <strong>{factoryQuoteCreditCost.credits} {creditUnit}</strong>
              </div>
              <div className="factory-credit-summary">
                <div>
                  <span>{tx("Quote type")}</span>
                  <strong>{tx(factoryQuoteCreditCost.label)}</strong>
                </div>
              </div>
              <div className="factory-credit-balance-strip">
                {isZh ? "剩余额度：" : "Remaining balance:"} {creditBalance} {creditUnit}
              </div>
              <button className="secondary-btn compact-btn" type="button" onClick={onPurchaseCredits}>{tx("Purchase more credits")}</button>
            </section>

            <section className="factory-submit-card factory-ready-card">
              <div className="factory-ready-card-header">
                <h2>Ready to send?</h2>
                <p>Confirm the quote is complete before it appears in the brand comparison page.</p>
              </div>
              <div className="factory-ready-actions">
                <button className="primary-btn" type="button" onClick={onSendQuote}>{sendForCredits}</button>
                <button className="secondary-btn" type="button">Save draft</button>
              </div>
            </section>
          </aside>
        </div>
      </div>
      <footer className="factory-submit-bottom-bar">
        <button className="secondary-btn" type="button" onClick={onBack}>Back</button>
        <div className="factory-submit-bottom-actions">
          <button className="secondary-btn" type="button">Save draft</button>
          <button className="primary-btn" type="button" onClick={onSendQuote}>{sendForCredits}</button>
        </div>
      </footer>
    </main>
  );
}

function QuoteTranslationReview() {
  return (
    <section className="factory-submit-card quote-translation-review">
      <header>
        <div>
          <h2>发送前确认英文版本</h2>
          <p>请确认整份报价的英文发送版本。自动翻译可编辑，中文原文会保留给工厂查看。</p>
        </div>
        <span>自动翻译，可编辑</span>
      </header>
      <div className="quote-translation-grid">
        <article>
          <span>报价条款</span>
          <p>单价 $18.40 / 件；准确生产数量 300 件；大货交期为 PP 样批准后 28 天；可接单时间窗口为 8 月 12-30 日，420 件。</p>
          <strong data-no-translate>Unit price $18.40 / unit; exact production quantity 300 units; bulk lead time is 28 days after PP approval; open capacity window is Aug 12-30, 420 units.</strong>
        </article>
        <article>
          <span>付款、运输和有效期</span>
          <p>付款条款为 30% 订金，70% 出货前支付。EXW 报价，运输待定。报价有效期至 2026 年 8 月 1 日。</p>
          <strong data-no-translate>Payment terms are 30% deposit and 70% before shipment. EXW quoted; shipping TBD. Quote valid until Aug 1, 2026.</strong>
        </article>
        <article>
          <span>样品计划</span>
          <p>试身样费用 $120，5 天完成，包含版型检查和基础车缝。PP 样费用 $140，7 天完成，包含大货前确认。</p>
          <strong data-no-translate>Fit sample cost is $120 and takes 5 days, including fit check and basic sewing. PP sample cost is $140 and takes 7 days, including pre-production confirmation.</strong>
        </article>
        <article>
          <span>工厂备注</span>
          <p>我们可以在 tech pack 确认后立即开始试身样。大货产能可保留到 8 月 30 日。</p>
          <strong data-no-translate>We can start the fit sample immediately after tech pack confirmation. Bulk capacity can be held through Aug 30.</strong>
        </article>
      </div>
    </section>
  );
}

function FactoryQuoteRequestCard({ project, language }) {
  const isZh = language === "zh";
  const translatedTitle = getTranslatedProjectTitle(project.title);
  const requestImages = project.images || [];
  const [primaryImage, ...supportImages] = requestImages;
  const hasGallery = requestImages.length >= 3;
  const requestFacts = [
    ["Unit target", project.budget],
    ["Quantity", project.quantity],
    ["Samples", project.samples],
    ["Quote due", project.quoteDue]
  ];

  return (
    <article className="factory-submit-card factory-submit-project-card factory-request-card">
      <header className="factory-request-card-top">
        <div className="factory-request-title">
          <div className="factory-avatar">{project.initials}</div>
          <div>
            <h2 data-no-translate={!isZh || undefined}>{isZh ? translatedTitle : project.title}</h2>
            <p data-no-translate>{project.brand} · {project.location} · {isZh ? "18 分钟前发布" : project.posted}</p>
          </div>
        </div>
        <div className="factory-request-card-actions">
          <span className={`factory-project-fit ${project.fitTone}`}>{project.capacity.join(" · ")}</span>
        </div>
      </header>

      <div className="factory-request-card-body">
        <aside className="factory-request-brief">
          <div className="factory-request-facts">
            {requestFacts.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          {isZh ? (
            <TranslatedProjectSummary project={project} />
          ) : (
            <p data-no-translate>{project.specialty}</p>
          )}
          <div className="factory-request-trust">
            <span className="factory-request-trust-icon" aria-hidden="true">$</span>
            <strong>Payment verified</strong>
            <span>{project.trust}</span>
          </div>
          <div className="factory-request-tags">
            <span className="marketplace-tag-label">Request tags</span>
            <div className="tag-row compact-tags factory-submit-tags">
              {project.tags.map((tag) => (
                <span className="tag garment-tag" key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        </aside>

        <div className={hasGallery ? "factory-request-visuals has-gallery" : "factory-request-visuals"} aria-label={`${project.brand} request references`}>
          {primaryImage ? (
            <figure className="factory-request-visual-main">
              <img src={primaryImage.src} alt={`${project.title} ${primaryImage.label}`} />
              <figcaption>{primaryImage.label}</figcaption>
            </figure>
          ) : (
            <div className="factory-request-visual-placeholder">
              <strong>No reference image uploaded</strong>
              <span>Review the written brief, request tags, and attached tech pack in details.</span>
            </div>
          )}
          {hasGallery && supportImages.slice(0, 2).map((image) => (
            <figure key={image.label}>
              <img src={image.src} alt={`${project.title} ${image.label}`} />
              <figcaption>{image.label}</figcaption>
            </figure>
          ))}
        </div>
      </div>

      <div className="factory-submit-attachments">
        <span>Brand attachments</span>
        <strong>Tech pack v3.pdf · Measurement chart · Reference photos</strong>
        <button className="text-link" type="button">Download files</button>
      </div>
    </article>
  );
}

function FactoryQuoteSections({ readOnly = false }) {
  const [materialCosts, setMaterialCosts] = useState([
    {
      id: "poplin",
      material: "Organic cotton poplin",
      costPerUnit: 8.64,
      included: true
    },
    {
      id: "components",
      material: "Standard buttons + interfacing",
      costPerUnit: 1.15,
      included: true
    },
    {
      id: "labels",
      material: "Custom woven labels (optional)",
      costPerUnit: 0.35,
      included: false
    }
  ]);
  const includedMaterialCost = materialCosts.reduce((total, item) => total + (item.included ? item.costPerUnit : 0), 0);
  const additionalMaterialCost = materialCosts.reduce((total, item) => total + (item.included ? 0 : item.costPerUnit), 0);

  const addMaterialCost = () => {
    setMaterialCosts((current) => [
      ...current,
      {
        id: `material-${Date.now()}`,
        material: "New material or component",
        costPerUnit: 0,
        included: false
      }
    ]);
  };

  const removeMaterialCost = (id) => {
    setMaterialCosts((current) => current.filter((item) => item.id !== id));
  };

  const updateMaterialCost = (id, updates) => {
    setMaterialCosts((current) => current.map((item) => (
      item.id === id ? { ...item, ...updates } : item
    )));
  };

  return (
    <>
      <SubmitSection title="Quote terms" description="Enter exact commercial terms for this request.">
        <div className="factory-submit-field-grid">
          <QuoteField label="Unit price" value="$18.40 / unit" />
          <QuoteField label="Exact production quantity *" value="300 units" />
          <QuoteField label="Bulk lead time *" value="28 days after PP approval" />
          <QuoteField label="Open capacity window *" value="Aug 12-30 · 420 units" />
          <QuoteField label="Payment terms" value="30% deposit / 70% before shipment" />
          <QuoteField label="Shipping / incoterms" value="EXW quoted; shipping TBD" />
          <QuoteField label="Quote valid until" value="Aug 1, 2026" />
        </div>
      </SubmitSection>

      <SubmitSection title="Material sourcing and cost breakdown" description="Show who supplies each material, what it costs, and whether it is included in the unit price.">
        <section className="factory-sourcing-brand-provided">
          <div>
            <span>Brand provides separately</span>
            <p>Labels, packaging, final color standards, and special branded trims.</p>
          </div>
        </section>
        <div className="factory-sourcing-input-grid">
          <QuoteField label="Factory includes" value="Main production materials and standard components from approved direction, included in unit price" />
        </div>
        <div className="factory-material-cost-heading">
          <div>
            <h3>Material cost breakdown</h3>
            <p>List each material or component separately. Costs marked not included are added on top of the quoted unit price.</p>
          </div>
        </div>
        <div className="factory-material-cost-rows">
          {materialCosts.map((item) => (
            <MaterialCostRow
              item={item}
              readOnly={readOnly}
              onRemove={() => removeMaterialCost(item.id)}
              onCostChange={(costPerUnit) => updateMaterialCost(item.id, { costPerUnit })}
              onTreatmentChange={(included) => updateMaterialCost(item.id, { included })}
              key={item.id}
            />
          ))}
        </div>
        <div className="factory-material-cost-summary">
          <QuoteField label="Materials included in unit price" value={`$${includedMaterialCost.toFixed(2)} / unit`} />
          <QuoteField
            label="Additional material charges"
            value={`$${additionalMaterialCost.toFixed(2)} / unit · $${(additionalMaterialCost * 300).toFixed(2)} order total`}
            helper="Charged separately from the quoted unit price"
          />
        </div>
        {!readOnly && <button className="factory-add-stage" type="button" onClick={addMaterialCost}>+ Add material cost</button>}
      </SubmitSection>

      <SubmitSection title="Sample plan" description="Break out sample stages so the brand can compare quotes clearly.">
        <div className="factory-submit-sample-rows">
          <SamplePlanRow stage="Fit sample" cost="$95" timing="10 days" includes="1 revision round" readOnly={readOnly} />
          <SamplePlanRow stage="PP sample" cost="$165" timing="11 days" includes="1 revision round" readOnly={readOnly} />
        </div>
        {!readOnly && <button className="factory-add-stage" type="button">+ Add sample stage</button>}
      </SubmitSection>

      <SubmitSection title="Brand questions and factory notes" description="Brand asks: Can you quote fit sample and PP sample separately? Can you support 3 colors at 100 units each? What fabric GSM, trim, MOQ, or certification details do you need before final cost?" descriptionNoTranslate>
        <QuoteTextarea value="Yes. We can quote fit and PP samples separately and support 3 colors at 100 units each. Final cost depends on confirmed GSM, button trim, certification path, and final size spec." label="Factory response" />
      </SubmitSection>

      <SubmitSection title="Additional details and questions" description="Add supporting files or questions regarding the quote.">
        <QuoteTextarea value="We can start fit sample immediately after tech pack confirmation. Bulk capacity is held through Aug 30." />
      </SubmitSection>
    </>
  );
}

function FactoryQuoteReminder() {
  return (
    <aside className="factory-submit-side">
      <section className="factory-submit-reminder">
        <h2>Helpful reminder</h2>
        <p>
          Factories should quote exact units and exact lead time here. MOQ only belongs on profile/search,
          not on a response to a known order quantity.
        </p>
      </section>
    </aside>
  );
}

function FactoryQuoteSent({ project, language = "en", onBack, onDashboard }) {
  const isZh = language === "zh";
  const tx = (value) => (isZh ? translateFactoryMainText(value) : value);

  return (
    <main className="factory-detail-page factory-submit-page factory-sent-page">
      <div className="factory-submit-content">
        <header className="factory-detail-header factory-submit-header factory-sent-header">
          <button className="text-link" type="button" onClick={onBack}>‹ Back to edit quote</button>
          <h1>Quote sent successfully</h1>
          <p>
            Your quote is now visible to the brand. They can compare it with other factory quotes,
            message you, or choose your quote for contract terms.
          </p>
        </header>

        <div className="factory-sent-layout">
          <section className="success-card factory-sent-card">
            <span className="success-mark">✓</span>
            <div className="success-copy">
              <h2>{project.brand} quote submitted</h2>
              <p>
                The brand will see your unit price, sample plan, production timing, open capacity,
                and factory notes in their quote comparison view.
              </p>
            </div>

            <section className="success-next-panel factory-sent-metrics">
              <Metric label={tx("unit price")} value="$18.40" />
              <Metric label={tx("quantity")} value={isZh ? "300 件" : "300 units"} />
              <Metric label={tx("bulk lead")} value={isZh ? "28 天" : "28 days"} />
              <Metric label={tx("quote total")} value="$5,780" />
            </section>

            <div className="success-actions">
              <button className="primary-btn" type="button" onClick={onDashboard}>Go to dashboard</button>
              <button className="secondary-btn" type="button">Browse more requests</button>
            </div>
          </section>

          <aside className="factory-sent-side">
            <section className="factory-submit-card factory-status-card">
              <h2>Quote status</h2>
              <p>
                Maison Rue has been notified. Your quote appears on their comparison page with
                your factory notes and assumptions.
              </p>
              <div className="factory-status-facts">
                <ProfileDetailPair label="Brand" value={project.brand} />
                <ProfileDetailPair label="Quote due" value="Jul 24" />
                <ProfileDetailPair label="Shown total" value="$5,780" />
              </div>
            </section>

            <section className="factory-submit-reminder factory-sent-reminder">
              <h2>Keep the quote current</h2>
              <p>
                If price, capacity, or sample timing changes before the brand chooses,
                edit the quote from the submitted quote page.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function SubmitSection({ title, description, helper, children, descriptionNoTranslate = false }) {
  return (
    <article className="factory-submit-card factory-submit-section">
      <h2>{title}</h2>
      <p data-no-translate={descriptionNoTranslate || undefined}>{description}</p>
      {helper && <small className="submit-section-language-hint">{helper}</small>}
      {children}
    </article>
  );
}

function QuoteField({ label, value, helper }) {
  return (
    <label className="factory-quote-field">
      <span>{label}</span>
      <strong data-no-translate>{value}</strong>
      <small>{helper}</small>
    </label>
  );
}

function QuoteTextarea({ value, label }) {
  return (
    <div className="factory-quote-textarea">
      {label && <span className="factory-quote-textarea-label">{label}</span>}
      <strong data-no-translate>{value}</strong>
    </div>
  );
}

function SamplePlanRow({ stage, cost, timing, includes, readOnly = false }) {
  return (
    <div className={readOnly ? "factory-submit-sample-row read-only" : "factory-submit-sample-row"}>
      <QuoteField label="Stage" value={stage} />
      <QuoteField label="Cost" value={cost} />
      <QuoteField label="Timing" value={timing} />
      <QuoteField label="Includes" value={includes} />
      {!readOnly && <CloseIconButton label={`Remove ${stage}`} />}
    </div>
  );
}

function MaterialCostRow({ item, readOnly = false, onRemove, onCostChange, onTreatmentChange }) {
  return (
    <div className={readOnly ? "factory-material-cost-row read-only" : "factory-material-cost-row"}>
      <QuoteField label="Material / component" value={item.material} />
      {readOnly ? (
        <QuoteField label="Cost per finished unit" value={`$${item.costPerUnit.toFixed(2)}`} />
      ) : (
        <label className="factory-material-cost-input">
          <span>Cost per finished unit</span>
          <div><b aria-hidden="true">$</b><input type="number" min="0" step="0.01" value={item.costPerUnit} onChange={(event) => onCostChange(Number(event.target.value) || 0)} /></div>
        </label>
      )}
      {readOnly ? (
        <QuoteField
          label="Unit price treatment"
          value={item.included ? "Included in unit price" : "Added separately"}
        />
      ) : (
        <label className="factory-material-treatment-field">
          <span>Unit price treatment</span>
          <select
            className={item.included ? "included" : "additional"}
            value={item.included ? "included" : "additional"}
            onChange={(event) => onTreatmentChange(event.target.value === "included")}
          >
            <option value="included">Included in unit price</option>
            <option value="additional">Added separately</option>
          </select>
        </label>
      )}
      {!readOnly && <CloseIconButton label={`Remove ${item.material}`} onClick={onRemove} />}
    </div>
  );
}

function QuoteAnswer({ question, answer }) {
  return (
    <section className="factory-quote-answer">
      <h3>{question}</h3>
      <div>{answer}</div>
    </section>
  );
}

function DetailCard({ title, children }) {
  return (
    <article className="factory-detail-card">
      <h2>{title}</h2>
      {children}
    </article>
  );
}

createRoot(document.getElementById("root")).render(<App />);
