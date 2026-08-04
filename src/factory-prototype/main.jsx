import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../prototype/styles.css";
import "./styles.css";

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
  { label: "Connections", icon: "connections" },
  { label: "Conversations", icon: "messages" },
  { label: "Saved", icon: "bookmarks" },
  { label: "Settings", icon: "settings" },
  { label: "Notifications", icon: "notification" }
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
  "Organic shirts - due today": "有机棉衬衫 - 今天截止",
  "Quote for": "报价：",
  "Stretch jersey capsule - 2 questions": "弹力针织系列 - 2 个问题",
  "Recycled fleece overshirt - new brief": "再生摇粒绒外套 - 新需求",
  "Verification renewal due this month.": "本月需要更新验证资料。",
  "Production step": "生产阶段",
  "Next due": "下个截止日",
  "PRODUCTION STEP": "生产阶段",
  "NEXT DUE": "下个截止日",
  "unit target": "单价目标",
  "quantity": "数量",
  "samples": "样品",
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
  "Verified brand": "已验证品牌",
  "Yes": "是",
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
        languageHelp: "You can change this anytime.",
        cta: "Get started"
      },
      {
        title: "Tell us about your factory",
        fields: [
          ["Factory Name", "e.g. Golden Thread Manufacturing"],
          ["Year Founded", "YYYY"],
          ["Website URL", "www.example.com"],
          ["Factory Location", "City, Country"],
          ["Nearest Port", "e.g. Port of Shanghai"]
        ],
        helper: "The seaport or airport you ship from most often."
      },
      {
        title: "A little about your company",
        fields: [
          ["Company Registration Date", "MM/YYYY"],
          ["Registered capital (optional)", "Amount"],
          ["Total Employees", "e.g. 120"]
        ],
        helper: "Use your business registration details where applicable."
      },
      {
        title: "What type of production does your factory specialize in?",
        intro: "Start with the production method, then choose the garment categories you can reliably make.",
        groups: [
          ["Production type", ["Cut & sew knits", "Wovens", "Sweaters / knitwear", "Denim", "Seamless / circular knit", "Intimates / delicate garments", "Leather / suede", "Bags / soft goods", "Other"], ["Cut & sew knits", "Wovens"]],
          ["Product categories", ["Tops", "Bottoms", "Dresses & jumpsuits", "Outerwear", "Activewear", "Intimates / underwear", "Swimwear", "Sleepwear / loungewear", "Childrenswear / baby", "Uniforms / workwear", "Accessories", "Other"], ["Tops", "Bottoms"]],
          ["Market level", ["Luxury / high-end", "Premium / contemporary", "Mid range", "Mass market"], ["Premium / contemporary"]]
        ],
      },
      {
        title: "Specialty, services, and tools",
        intro: "Add the capabilities brands use to understand your sampling support and production setup.",
        groups: [
          ["Design Services", ["Pattern making", "Grading", "Sample development", "Tech pack support", "Full package (FPP)", "CMT only"], ["Full package (FPP)"]],
          ["3D & digital tools (optional)", ["CLO 3D", "Browzwear", "Lectra", "Gerber", "None"], []]
        ],
        specialtyLabel: "Specialty & Machines",
        specialtyPlaceholder: "Search or type a specialty"
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
          ["Production fit", [["Production Type", "Cut & sew knits, Wovens"], ["Product Categories", "Tops, Bottoms, Activewear"], ["Market Level", "Premium / contemporary"], ["Services", "Full package (FPP), Pattern making"]]],
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
        languageHelp: "你可以随时更改。",
        cta: "开始设置"
      },
      {
        title: "告诉我们你的工厂信息",
        fields: [["工厂名称", "例如：金线服装制造"], ["成立年份", "YYYY"], ["官网", "www.example.com"], ["工厂所在地", "城市，国家/地区"], ["最近港口", "例如：深圳港"]],
        helper: "你最常使用的海港或机场。"
      },
      {
        title: "公司基本信息",
        fields: [["公司注册日期", "MM/YYYY"], ["注册资本（选填）", "金额"], ["员工总数", "例如：120"]],
        helper: "如适用，请按营业执照或注册资料填写。"
      },
      {
        title: "你的工厂擅长哪类生产？",
        intro: "先选择生产工艺，再选择可稳定生产的品类。",
        groups: [
          ["生产类型", ["针织裁剪缝制", "梭织", "毛衫 / 针织成衣", "牛仔", "无缝 / 圆机针织", "内衣 / 精细工艺", "皮革 / 麂皮", "包袋 / 软配件", "其他"], ["针织裁剪缝制", "梭织"]],
          ["产品品类", ["上装", "下装", "连衣裙 / 连体衣", "外套", "运动服", "内衣", "泳装", "睡衣 / 家居服", "童装 / 婴童", "制服 / 工装", "配饰", "其他"], ["上装", "下装"]],
          ["市场层级", ["奢侈 / 高端", "高级成衣 / 当代品牌", "中端市场", "大众市场"], ["高级成衣 / 当代品牌"]]
        ],
      },
      {
        title: "专长、服务与工具",
        intro: "补充品牌会用于判断打样支持和生产配置的能力信息。",
        groups: [
          ["设计服务", ["制版", "放码", "样衣开发", "Tech pack 支持", "全包生产 FPP", "仅 CMT"], ["全包生产 FPP"]],
          ["3D 和数字工具（选填）", ["CLO 3D", "Browzwear", "Lectra", "Gerber", "无"], []]
        ],
        specialtyLabel: "专长与机器",
        specialtyPlaceholder: "搜索或输入专长"
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
          ["生产匹配", [["生产类型", "针织裁剪缝制，梭织"], ["产品品类", "上装，下装，运动服"], ["市场层级", "高级成衣 / 当代品牌"], ["服务", "全包生产 FPP，制版"]]],
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
  const requestedScreen = new URLSearchParams(window.location.search).get("screen");
  const shouldOpenPrototypeScreen = ["dashboard", "browse", "rfqs", "projects", "detail", "profile", "messages", "saved", "settings"].includes(requestedScreen);
  const [onboardingComplete, setOnboardingComplete] = useState(shouldOpenPrototypeScreen);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingLanguage, setOnboardingLanguage] = useState("en");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [screen, setScreen] = useState(shouldOpenPrototypeScreen ? requestedScreen : "dashboard");
  const [detailBackTarget, setDetailBackTarget] = useState("browse");
  const [quoteBackTarget, setQuoteBackTarget] = useState("detail");
  const [capacityDrawerOpen, setCapacityDrawerOpen] = useState(false);
  const [dashboardCapacity, setDashboardCapacity] = useState("2400");
  const selectedProject = brandProjects[0];
  const activeNav = screen === "dashboard" ? "Dashboard" : screen === "rfqs" || screen === "rfqReadOnly" ? "RFQs" : screen === "projects" || screen === "projectDetail" || screen === "projectPostedUpdate" ? "Production orders" : screen === "messages" ? "Conversations" : screen === "saved" ? "Saved" : screen === "settings" ? "Settings" : screen === "profile" ? "" : "Browse RFQs";
  const goToDashboard = () => {
    window.history.replaceState(null, "", `${window.location.pathname}?screen=dashboard`);
    setScreen("dashboard");
  };

  if (!onboardingComplete) {
    return (
      <FactoryOnboarding
        language={onboardingLanguage}
        step={onboardingStep}
        onLanguageChange={setOnboardingLanguage}
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
      <aside className={sidebarCollapsed ? "side-nav collapsed" : "side-nav"}>
        <button
          className="collapse-toggle"
          type="button"
          onClick={() => setSidebarCollapsed((value) => !value)}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <img src={`/assets/prototype-icons/${sidebarCollapsed ? "expand" : "collapse"}.svg`} alt="" />
        </button>
        {!sidebarCollapsed && <img src="/assets/logo.svg" alt="The Sourcing Club" className="side-logo" />}
        <button className={sidebarCollapsed ? "account-card collapsed-account" : "account-card"} type="button" aria-label="Factory account" onClick={() => setScreen("profile")}>
          <span>AM</span>
          <div>
            <strong>Atelier Minho</strong>
            <small>Factory account</small>
          </div>
        </button>
        <nav>
          {nav.map((item, index) => (
            <React.Fragment key={item.label}>
              {index === 3 || index === 7 ? <span className="nav-divider" /> : null}
              <button
                className={item.label === activeNav ? "active" : ""}
                type="button"
                onClick={() => {
                  if (item.label === "Dashboard") setScreen("dashboard");
                  if (item.label === "RFQs") setScreen("rfqs");
                  if (item.label === "Production orders") setScreen("projects");
                  if (item.label === "Browse RFQs") setScreen("browse");
                  if (item.label === "Conversations") setScreen("messages");
                  if (item.label === "Saved") setScreen("saved");
                  if (item.label === "Settings") setScreen("settings");
                }}
                aria-label={item.label}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <img className="nav-icon" src={`/assets/prototype-icons/${item.icon}.svg`} alt="" />
                <span className="nav-label">{item.label}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>
      </aside>

      {screen === "dashboard" && (
        <FactoryDashboardPage
          language={onboardingLanguage}
          capacityValue={dashboardCapacity}
          onUpdateCapacity={() => setCapacityDrawerOpen(true)}
          onViewRfqs={() => setScreen("rfqs")}
          onViewRfqDetail={() => {
            setDetailBackTarget("browse");
            setScreen("detail");
          }}
          onViewProjects={() => setScreen("projects")}
        />
      )}
      {screen === "profile" && (
        <FactoryProfilePage language={onboardingLanguage} />
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
          onViewRfq={() => {
            setDetailBackTarget("saved");
            setScreen("detail");
          }}
        />
      )}
      {screen === "messages" && (
        <main className="messages-page factory-messages-page">
          <FactoryMessagesScreen />
        </main>
      )}
      {screen === "settings" && (
        <main className="settings-page-shell factory-settings-page">
          <FactorySettingsScreen />
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
          onSendQuote={() => setScreen("quoteSent")}
        />
      )}
      {screen === "quoteSent" && (
        <FactoryQuoteSent
          project={selectedProject}
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
    </div>
  );
}

function FactoryDashboardPage({ language, capacityValue, onUpdateCapacity, onViewRfqs, onViewRfqDetail, onViewProjects }) {
  const capacityUnits = getCapacityUnitRange(capacityValue);

  return (
    <main className="factory-dashboard-page">
      <div className="factory-dashboard-shell">
        <header className="factory-dashboard-header">
          <h1>Hi Atelier Minho</h1>
        </header>

        <section className="factory-dashboard-grid" aria-label="Factory dashboard overview">
          <div className="factory-dashboard-metrics">
            <FactoryMetricCard label="Open RFQs" value="7" note="+3 invited this week" tone="blue" />
            <FactoryMetricCard label="Quotes sent this month" value="14" note="4 awaiting brand review" tone="green" />
            <FactoryMetricCard label="Active production orders" value="5" note="2 need sample updates" tone="amber" />
          </div>

          <section className="factory-dashboard-capacity">
            <span>August capacity</span>
            <strong>Mostly open</strong>
            <div className="capacity-chip-row">
              <span>Open August</span>
              <span>Capacity {capacityUnits} units</span>
            </div>
            <button className="primary-btn" type="button" onClick={onUpdateCapacity}>Update capacity</button>
          </section>

          <FactoryDashboardPanel
            className="factory-rfq-invites-panel"
            title="RFQ invites"
            subtitle="Prioritized requests that match your capacity and capabilities."
            action="View all"
            onAction={onViewRfqs}
          >
            {factoryRfqs.slice(0, 3).map((rfq) => (
              <FactoryDashboardRfqRow rfq={rfq} language={language} onView={onViewRfqDetail} key={rfq.title} />
            ))}
          </FactoryDashboardPanel>

          <FactoryDashboardPanel
            className="factory-brand-messages-panel"
            title="Needs your attention"
            subtitle="Priority RFQs, messages, and production steps."
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
    </main>
  );
}

const factoryProfileData = {
  name: "Atelier Minho",
  location: "Porto, Portugal",
  nearestPort: "Port of Leixoes",
  founded: "2016",
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
  marketLevel: "Premium / contemporary",
  services: ["Full package (FPP)", "Pattern making", "Sample development", "Tech pack support", "Grading"],
  tools: ["CLO 3D", "Lectra", "Gerber"],
  specialties: ["Organic poplin shirts", "Low-MOQ woven tops", "Fit sample development", "Small capsule production", "QC photo reporting"],
  moq: "100 units / style",
  leadTime: "30-45 days",
  lineHours: "2,400 hours / month",
  capacityEstimate: "Aug roughly 4,800-8,000 woven shirts",
  booking: "Aug mostly open; Sep partly booked",
  referenceStyle: "Basic woven shirt · ~18 min/pc",
  certifications: [
    { name: "Business registration", status: "Verified" },
    { name: "OEKO-TEX Standard 100", status: "Uploaded" },
    { name: "GOTS", status: "Pending upload" },
    { name: "BSCI", status: "Pending upload" }
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

function FactoryProfilePage({ language }) {
  const isZh = language === "zh";
  const data = factoryProfileData;
  const [projectTab, setProjectTab] = useState("completed");
  const [profileMode, setProfileMode] = useState(new URLSearchParams(window.location.search).get("view") === "public" ? "public" : "edit");
  const isOwnerView = profileMode === "edit";
  const visibleProjects = projectTab === "completed" ? data.pastProjects : data.inProductionProjects;
  const overviewRows = [
    ["Year founded", data.founded],
    ["Registration date", data.registrationDate],
    ["Total employees", data.employees],
    ["Registered capital", data.registeredCapital],
    ["Nearest port", data.nearestPort],
    ["Market level", data.marketLevel]
  ];
  const capacityRows = [
    ["MOQ", data.moq],
    ["Typical lead time", data.leadTime],
    ["Line-hours", data.lineHours],
    ["Estimated capacity", data.capacityEstimate],
    ["Booking level", data.booking],
    ["Reference style", data.referenceStyle]
  ];

  return (
    <main className="factory-profile-page">
      <div className="factory-profile-shell">
        <section className="factory-profile-owner-bar">
          <div>
            <span>Factory profile</span>
            <strong>{isOwnerView ? "Edit what brands see" : "Public preview"}</strong>
          </div>
          <div className="factory-profile-view-toggle" role="tablist" aria-label="Profile view mode">
            <button
              className={isOwnerView ? "active" : ""}
              type="button"
              onClick={() => setProfileMode("edit")}
              role="tab"
              aria-selected={isOwnerView}
            >
              Edit profile
            </button>
            <button
              className={!isOwnerView ? "active" : ""}
              type="button"
              onClick={() => setProfileMode("public")}
              role="tab"
              aria-selected={!isOwnerView}
            >
              View as public
            </button>
          </div>
        </section>

        <section className="factory-profile-hero">
          {isOwnerView && <button className="factory-profile-banner-edit" type="button">Edit banner</button>}
          <div className="factory-profile-identity">
            <div className="factory-profile-logo-wrap">
              <div className="factory-profile-logo">AM</div>
              {isOwnerView && <button className="factory-profile-logo-edit" type="button">Edit</button>}
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
          <div className="factory-profile-actions">
            {!isOwnerView && (
              <>
                <button className="secondary-btn" type="button" onClick={() => setProfileMode("edit")}>Save factory</button>
                <button className="primary-btn" type="button">Contact factory</button>
              </>
            )}
          </div>
        </section>

        <div className="factory-profile-layout">
          <section className="factory-profile-main">
            <section className="factory-profile-card factory-profile-performance">
              <div>
                <span>Factory performance</span>
                <strong>{data.rating}</strong>
                <p>{data.reviews} reviews · {data.responseTime} avg. response</p>
              </div>
              <div className="factory-profile-score-grid">
                <Metric label="Club orders" value={data.clubOrders} />
                <Metric label="Repeat brands" value={data.repeatBrands} />
                <Metric label="Lead time" value={data.leadTime} />
              </div>
            </section>

            <section className="factory-profile-card">
              <FactoryProfileCardHeader title="Overview" editable={isOwnerView} />
              <p>{data.intro}</p>
              <div className="factory-profile-detail-grid">
                {overviewRows.map(([label, value]) => <DetailPair label={label} value={value} key={label} />)}
              </div>
            </section>

            <section className="factory-profile-card">
              <FactoryProfileCardHeader title="Production fit" editable={isOwnerView} />
              <FactoryProfileChipSection label="Product categories" items={data.categories} />
              <FactoryProfileChipSection label="Services" items={data.services} />
              <FactoryProfileChipSection label="Specialties" items={data.specialties} />
              <FactoryProfileChipSection label="Digital tools" items={data.tools} />
            </section>

            <section className="factory-profile-card">
              <FactoryProfileCardHeader title="Capacity and terms" editable={isOwnerView} />
              <div className="factory-profile-detail-grid">
                {capacityRows.map(([label, value]) => <DetailPair label={label} value={value} key={label} />)}
              </div>
            </section>

            <section className="factory-profile-card">
              <FactoryProfileCardHeader title="Factory walkthrough" editable={isOwnerView} actionLabel="Manage video" />
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
              <FactoryProfileCardHeader title="Sample work" editable={isOwnerView} actionLabel="Manage samples" />
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
                {isOwnerView && <button className="factory-profile-edit-button" type="button">Manage projects</button>}
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
              <>
                <section className="factory-profile-card factory-profile-owner-card">
                  <h2>Profile status</h2>
                  <div className="factory-profile-status-meter">
                    <strong>88%</strong>
                    <span>Profile complete</span>
                  </div>
                  <div className="factory-profile-status-track"><span /></div>
                  <p>Add the remaining certifications and one more project photo to strengthen this profile.</p>
                  <div className="factory-profile-owner-actions">
                    <button className="primary-btn" type="button">Publish changes</button>
                    <button className="secondary-btn" type="button" onClick={() => setProfileMode("public")}>View as public</button>
                  </div>
                </section>
                <section className="factory-profile-card">
                  <h2>Suggested updates</h2>
                  <div className="factory-profile-owner-task-list">
                    <span>Upload GOTS certificate</span>
                    <span>Add August available capacity</span>
                    <span>Add one production-floor photo</span>
                  </div>
                </section>
              </>
            ) : (
              <section className="factory-profile-card factory-profile-contact-card">
                <h2>Contact supplier</h2>
                <div className="factory-profile-contact-row">
                  <div className="factory-avatar">AM</div>
                  <div>
                    <strong data-no-translate>{data.name}</strong>
                    <span data-no-translate>{data.location}</span>
                  </div>
                </div>
                <button className="primary-btn" type="button">Contact factory</button>
                <button className="secondary-btn" type="button">Invite to RFQ</button>
              </section>
            )}

            <section className="factory-profile-card">
              <FactoryProfileCardHeader title="Verification" editable={isOwnerView} actionLabel="Manage docs" />
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
              <FactoryProfileCardHeader title="Client references" editable={isOwnerView} actionLabel="Edit" />
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
    </main>
  );
}

function FactoryProfileCardHeader({ title, editable = false, actionLabel = "Edit" }) {
  return (
    <div className="factory-profile-card-header">
      <h2>{title}</h2>
      {editable && <button className="factory-profile-edit-button" type="button">{actionLabel}</button>}
    </div>
  );
}

function FactoryProfileChipSection({ label, items }) {
  return (
    <div className="factory-profile-chip-section">
      <span>{label}</span>
      <div className="tag-row compact-tags">
        {items.map((item) => <span className="tag garment-tag" key={item}>{item}</span>)}
      </div>
    </div>
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

function FactoryDashboardPanel({ title, subtitle, action, onAction, className = "", children }) {
  return (
    <section className={className ? `factory-dashboard-panel ${className}` : "factory-dashboard-panel"}>
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
  const [primaryImage] = rfq.images || [];
  const dashboardPhoto = dashboardRfqPhotos[rfq.initials];
  const inviteFacts = [
    ["Unit target", rfq.facts.find(([label]) => label === "Unit target")?.[1] || ""],
    ["Quantity", rfq.facts.find(([label]) => label === "Quantity")?.[1] || ""]
  ];
  const fit = rfq.statusTone === "warning" ? "Good fit" : rfq.statusTone === "danger" ? "Potential fit" : "Strong fit";
  const fitTone = rfq.statusTone === "warning" ? "good" : rfq.statusTone === "danger" ? "warn" : "strong";

  return (
    <article className="factory-request-card factory-dashboard-mini-card factory-dashboard-rfq-row">
      <header className="factory-request-card-top">
        <div className="factory-request-title">
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
        <div className="factory-request-card-actions">
          <span className={`factory-project-fit ${fitTone}`}>{fit}</span>
          <button className="primary-btn" type="button" onClick={onView}>View RFQ</button>
        </div>
      </header>

      <div className="factory-request-brief">
        <div className="factory-request-facts">
          {inviteFacts.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <p data-no-translate>{isZh ? getTranslatedListDescription(rfq) : rfq.description}</p>
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
    <article className="factory-request-card factory-dashboard-mini-card factory-project-dashboard-row">
      <header className="factory-project-dashboard-top">
        <div className="factory-project-dashboard-heading">
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
        </div>
        <div className="factory-project-dashboard-actions">
          <span className={`project-status ${project.statusTone}`}>{statusLabel}</span>
          <button className="primary-btn factory-project-view-btn" type="button" onClick={onView}>View order</button>
        </div>
      </header>

      <div className="factory-project-dashboard-body">
        <div className="factory-project-dashboard-left">
          <div className="factory-project-dashboard-meta">
            {productionFacts.map(([label, value]) => (
              <div className="factory-project-mini-metric" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>

          <div className="factory-project-dashboard-progress">
            <ProjectProgress progress={project.progress} />
          </div>
        </div>
      </div>
    </article>
  );
}

function FactoryRfqsPage({ language, onViewRequest, onEditQuote }) {
  return (
    <main className="rfqs-page factory-rfqs-page">
      <div className="rfqs-shell">
        <header className="rfqs-header">
          <div>
            <h1>RFQs</h1>
            <p>Track active requests you were invited to, quotes you already sent, and brand questions that need an answer.</p>
          </div>
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

        <nav className="rfqs-tabs" aria-label="RFQ status">
          <button className="active" type="button">Active RFQs (4)</button>
          <button type="button">Drafts (3)</button>
          <button type="button">Invited (2)</button>
          <button type="button">Closed (6)</button>
        </nav>

        <section className="rfq-list" aria-label="Factory RFQs">
          {factoryRfqs.map((rfq) => (
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

function FactorySavedPage({ language, onViewRfq }) {
  const [tab, setTab] = useState("brands");
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
            <p>Keep track of brands you want to work with and RFQs you may quote later.</p>
          </div>
        </header>

        <nav className="rfqs-tabs saved-tabs" aria-label="Saved lists">
          <button className={tab === "brands" ? "active" : ""} type="button" onClick={() => setTab("brands")}>Saved brands ({savedBrands.length})</button>
          <button className={tab === "rfqs" ? "active" : ""} type="button" onClick={() => setTab("rfqs")}>Saved RFQs ({savedRfqs.length})</button>
        </nav>

        <section className="rfqs-controls saved-controls" aria-label="Saved filters">
          <label className="rfqs-search">
            <span>{tab === "brands" ? "Search saved brands" : "Search saved RFQs"}</span>
            <div>
              <SearchIcon />
              <input placeholder={tab === "brands" ? "Brand name, category, location..." : "RFQ name, product, brand..."} />
            </div>
          </label>
          <label className="rfqs-sort">
            <span>Sort By</span>
            <select defaultValue="recent">
              <option value="recent">Recently saved</option>
              <option value="fit">Best fit</option>
              <option value="due">Due soon</option>
            </select>
          </label>
        </section>

        {tab === "brands" ? (
          <section className="factory-saved-brand-grid" aria-label="Saved brands">
            {savedBrands.map((brand) => (
              <FactorySavedBrandCard brand={brand} key={brand.name} />
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

function FactorySavedBrandCard({ brand }) {
  const fitTone = brand.fit === "Good fit" ? "good" : brand.fit === "Potential fit" ? "warn" : "strong";

  return (
    <article className="factory-saved-brand-card">
      <header>
        <div className="factory-saved-brand-identity">
          <div className="factory-avatar">{brand.initials}</div>
          <div>
            <h2>{brand.name}</h2>
            <p>{brand.location}</p>
          </div>
        </div>
        <div className="factory-saved-card-actions">
          <button className="secondary-btn" type="button">Contact brand</button>
          <button className="primary-btn" type="button">View brand</button>
        </div>
      </header>
      <div className="factory-saved-brand-fit">
        <span className={`factory-project-fit ${fitTone}`}>{brand.fit}</span>
        <strong>{brand.focus}</strong>
      </div>
      <div className="factory-request-trust factory-saved-brand-trust">
        <span className="factory-request-trust-icon" aria-hidden="true">$</span>
        <strong>Payment verified</strong>
        <span>{brand.trust}</span>
      </div>
      <div className="tag-row compact-tags">
        {brand.tags.map((tag) => (
          <span className="tag garment-tag" key={tag}>{tag}</span>
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
          <button className="secondary-btn" type="button">Remove</button>
          <button className="primary-btn" type="button" onClick={onViewRfq}>View RFQ</button>
        </div>
      </header>

      <div className="factory-saved-rfq-body">
        <div className="factory-saved-rfq-copy">
          <div className="factory-request-facts">
            <div>
              <span>Unit target</span>
              <strong>{project.budget}</strong>
            </div>
            <div>
              <span>Quantity</span>
              <strong>{project.quantity}</strong>
            </div>
            <div>
              <span>Quote due</span>
              <strong>{project.quoteDue}</strong>
            </div>
          </div>
          <p className="rfq-description" data-no-translate>{isZh ? getTranslatedListDescription(project) : project.specialty}</p>
          <div className="factory-request-tags">
            <span className="marketplace-tag-label">Request tags</span>
            <div className="tag-row compact-tags rfq-tags">
              {project.tags.slice(0, 4).map((tag) => (
                <span className="tag" key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        </div>
        {primaryImage && (
          <figure className="factory-saved-rfq-visual">
            <img src={primaryImage.src} alt={`${project.title} ${primaryImage.label}`} />
            <figcaption>{primaryImage.label}</figcaption>
          </figure>
        )}
      </div>
    </article>
  );
}

function FactoryMessagesScreen() {
  const [activeThreadId, setActiveThreadId] = useState(factoryMessageThreads[0].id);
  const [composer, setComposer] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [callMode, setCallMode] = useState("idle");
  const [translatedMessages, setTranslatedMessages] = useState({});
  const [scheduledCalls, setScheduledCalls] = useState({
    "maison-rue": {
      title: "Sample cost review",
      factoryTime: "Tue 3:00 PM Porto",
      brandTime: "Maison Rue: Tue 10:00 AM ET",
      agenda: "Review fit sample and PP sample cost split before quote approval.",
      hasVideo: true
    }
  });
  const activeThread = factoryMessageThreads.find((thread) => thread.id === activeThreadId) || factoryMessageThreads[0];
  const activeScheduledCall = scheduledCalls[activeThread.id];

  const toggleTranslation = (threadId, index) => {
    const key = `${threadId}-${index}`;
    setTranslatedMessages((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="messages-shell factory-messages-shell">
      <aside className="messages-list-panel">
        <header className="messages-list-header">
          <div>
            <h1>Messages</h1>
          </div>
        </header>
        <label className="rfqs-search message-search-field">
          <div>
            <SearchIcon />
            <input placeholder="Search conversations..." />
          </div>
        </label>
        <div className="message-filter-row">
          <button className="pill active" type="button">All</button>
          <button className="pill" type="button">Unread</button>
        </div>
        <div className="message-thread-list">
          {factoryMessageThreads.map((thread) => (
            <button
              className={thread.id === activeThread.id ? "message-thread-card active" : "message-thread-card"}
              type="button"
              onClick={() => {
                setActiveThreadId(thread.id);
                setShowSchedule(false);
                setCallMode("idle");
              }}
              key={thread.id}
            >
              <span className="message-avatar">{thread.initials}</span>
              <span>
                <strong>{thread.name}</strong>
                <small>{thread.project}</small>
                <em>{thread.lastPreview}</em>
              </span>
              <time>{thread.lastDate}</time>
              {thread.unread > 0 && <b>{thread.unread}</b>}
            </button>
          ))}
        </div>
      </aside>

      <section className="message-workspace">
        <header className="message-room-header">
          <div className="message-room-identity">
            <span className="message-avatar large">{activeThread.initials}</span>
            <div>
              <h2>{activeThread.primaryContact}</h2>
              <p>{activeThread.name} - {activeThread.localTime} - {activeThread.project}</p>
            </div>
          </div>
          <div className="message-room-actions">
            <button className="secondary-btn compact-btn" type="button" onClick={() => setShowSchedule((value) => !value)}>Schedule call</button>
            <button className="primary-btn compact-btn" type="button" onClick={() => setCallMode("preview")}>Live video chat</button>
          </div>
        </header>

        {callMode !== "idle" && (
          <FactoryVideoCallPanel thread={activeThread} mode={callMode} setMode={setCallMode} />
        )}

        <div className="message-timeline">
          {activeThread.messages.map((message, index) => {
            const translationKey = `${activeThread.id}-${index}`;
            const showTranslation = Boolean(translatedMessages[translationKey]);
            return (
              <FactoryMessageBubble
                message={message}
                showTranslation={showTranslation}
                onToggleTranslation={() => toggleTranslation(activeThread.id, index)}
                key={`${message.time}-${index}`}
              />
            );
          })}
        </div>

        <footer className="message-composer">
          <textarea
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            placeholder={`Message ${activeThread.primaryContact}...`}
            rows={3}
          />
          <div className="message-send-actions">
            <button className="message-upload-btn" type="button">
              <img src="/assets/prototype-icons/upload.svg" alt="" />
              <span>Attach file</span>
            </button>
            <button className="primary-btn compact-btn" type="button" onClick={() => setComposer("")}>Send</button>
          </div>
        </footer>
      </section>

      <aside className="message-side-panel">
        {activeScheduledCall && <FactoryUpcomingCallCard call={activeScheduledCall} />}
        <FactoryScheduleCallPanel
          key={activeThread.id}
          thread={activeThread}
          isOpen={showSchedule}
          onOpen={() => setShowSchedule(true)}
          onSchedule={(call) => {
            setScheduledCalls((current) => ({ ...current, [activeThread.id]: call }));
            setShowSchedule(false);
          }}
        />
        <section className="message-profile-card">
          <h3>{activeThread.name}</h3>
          <p>{activeThread.location} - {activeThread.status}</p>
          <div className="message-file-list">
            {activeThread.files.map((file) => (
              <button type="button" key={file}>
                <span>{file}</span>
                <img src="/assets/prototype-icons/download.svg" alt="" />
              </button>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function FactoryMessageBubble({ message, showTranslation, onToggleTranslation }) {
  const isFactory = message.from === "factory";
  const hasTranslation = Boolean(message.translation);

  return (
    <article className={isFactory ? "message-bubble own" : "message-bubble"}>
      <div>
        <span>{isFactory ? "Atelier Minho" : "Brand"}</span>
        <time>{message.time}</time>
      </div>
      <p>{showTranslation && hasTranslation ? message.translation : message.body || message.original}</p>
      {hasTranslation && (
        <div className="message-translation-card">
          <button type="button" onClick={onToggleTranslation}>
            {showTranslation ? "Show original" : "Translate to English"}
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

function FactoryVideoCallPanel({ thread, mode, setMode }) {
  const inCall = mode === "active";

  return (
    <section className={inCall ? "video-call-panel active" : "video-call-panel"}>
      <div className="video-call-stage">
        <span className="message-avatar xl">{thread.initials}</span>
        <div>
          <h3>{inCall ? `Live with ${thread.primaryContact}` : `Ready to call ${thread.primaryContact}`}</h3>
          <p>{inCall ? "Video preview - screen share available - call notes stay in this thread" : "Start a prototype call room. This is not connected to a live video provider yet."}</p>
        </div>
      </div>
      <div className="video-call-controls">
        <button type="button" aria-label="Toggle camera">Cam</button>
        <button type="button" aria-label="Toggle microphone">Mic</button>
        <button type="button" aria-label="Share screen">Share</button>
        <button className={inCall ? "danger" : ""} type="button" onClick={() => setMode(inCall ? "idle" : "active")}>{inCall ? "End call" : "Start call"}</button>
      </div>
    </section>
  );
}

function FactoryUpcomingCallCard({ call }) {
  return (
    <section className="upcoming-call-card">
      <div className="upcoming-call-label">Scheduled call</div>
      <h3>{call.title}</h3>
      <div className="upcoming-call-time">
        <strong>{call.factoryTime}</strong>
        <span>{call.brandTime}</span>
      </div>
      <p>{call.agenda}</p>
      <div className="upcoming-call-actions">
        {call.hasVideo && <span>Video link added</span>}
        <button className="secondary-btn compact-btn" type="button">Join call</button>
      </div>
    </section>
  );
}

function FactoryScheduleCallPanel({ thread, isOpen, onOpen, onSchedule }) {
  const timeSlots = thread.scheduleSlots || [
    { factory: "Tue 3:00 PM Porto", brand: `${thread.name}: local time shown after invite` },
    { factory: "Tue 5:30 PM Porto", brand: `${thread.name}: local time shown after invite` },
    { factory: "Wed 2:30 PM Porto", brand: `${thread.name}: local time shown after invite` }
  ];
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [callTitle, setCallTitle] = useState("Sample cost review");
  const [callDescription, setCallDescription] = useState(`Review open questions with ${thread.name} and confirm next actions.`);
  const [hasVideo, setHasVideo] = useState(true);
  const selectedSlot = timeSlots[selectedSlotIndex] || timeSlots[0];

  return (
    <section className={isOpen ? "schedule-card open" : "schedule-card"}>
      <header>
        <div>
          <h3>Schedule call</h3>
          <p>{thread.scheduleNote}</p>
        </div>
        {!isOpen && <button className="secondary-btn compact-btn" type="button" onClick={onOpen}>Open</button>}
      </header>
      {isOpen && (
        <>
          <label className="schedule-field">
            <span>Title</span>
            <input value={callTitle} onChange={(event) => setCallTitle(event.target.value)} />
          </label>
          <label className="schedule-field">
            <span>Description</span>
            <textarea rows={3} value={callDescription} onChange={(event) => setCallDescription(event.target.value)} />
          </label>
          <div className="schedule-slot-grid">
            {timeSlots.map((slot, index) => (
              <button className={index === selectedSlotIndex ? "selected" : ""} type="button" onClick={() => setSelectedSlotIndex(index)} key={slot.factory}>
                <strong>{slot.factory}</strong>
                <span>{slot.brand}</span>
              </button>
            ))}
          </div>
          <div className="schedule-footer">
            <label>
              <input type="checkbox" checked={hasVideo} onChange={(event) => setHasVideo(event.target.checked)} />
              Add video link
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
              Send invite
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function FactoryRfqCard({ rfq, language, onViewRequest, onEditQuote }) {
  const isZh = language === "zh";
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
    <article className={rfq.featured ? "factory-request-card featured factory-rfq-card" : "factory-request-card factory-rfq-card"}>
      <header className="factory-request-card-top">
        <div className="factory-request-title">
          <div className="factory-avatar">{rfq.initials}</div>
          <div className="rfq-main">
            <h2 data-no-translate>{isZh ? getTranslatedProjectTitle(rfq.title) : rfq.title}</h2>
            <p className="rfq-date" data-no-translate>{isZh ? getTranslatedListMeta(meta) : meta}</p>
          </div>
        </div>
        <div className="factory-request-card-actions factory-rfq-card-actions">
          {rfq.status && <span className={`tag rfq-status ${rfq.statusTone}`}>{rfq.status}</span>}
          <button
            className="primary-btn"
            type="button"
            onClick={rfq.status === "Quote submitted" ? onViewRequest : onEditQuote}
          >
            View RFQ
          </button>
          <button className="rfq-more" type="button" aria-label={`More options for ${rfq.title}`}>...</button>
        </div>
      </header>

      <div className="factory-request-card-body">
        <aside className="factory-request-brief">
          <div className="factory-request-facts">
            {rfqFacts.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className="rfq-description" data-no-translate>{isZh ? getTranslatedListDescription(rfq) : rfq.description}</p>
          {isZh && <ListTranslationMeta />}
          <div className="factory-request-trust">
            <span className="factory-request-trust-icon" aria-hidden="true">$</span>
            <strong>Payment verified</strong>
            <span>{rfq.trust}</span>
          </div>
          <div className="factory-request-tags">
            <span className="marketplace-tag-label">Request tags</span>
            <div className="tag-row compact-tags rfq-tags">
              {visibleTags.map((tag) => (
                <span className="tag" key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        </aside>

        <div className={hasGallery ? "factory-request-visuals has-gallery" : "factory-request-visuals"} aria-label={`${rfq.brand} request references`}>
          {primaryImage ? (
            <figure className="factory-request-visual-main">
              <img src={primaryImage.src} alt={`${rfq.title} ${primaryImage.label}`} />
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
              <img src={image.src} alt={`${rfq.title} ${image.label}`} />
              <figcaption>{image.label}</figcaption>
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
                <DetailPair label="Your quote" value="$18.40" />
                <DetailPair label="Quote sent" value="Jul 24" />
                <DetailPair label="Status" value="Quote submitted" />
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
            <span>Factory</span>
            <select defaultValue="all">
              <option value="all">All factories</option>
              <option value="atelier">Atelier Minho</option>
              <option value="hansu">Hansu Studio</option>
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
          <button className="active" type="button">Active orders (4)</button>
          <button type="button">Closed (6)</button>
        </nav>

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
    <article className={project.featured ? "factory-request-card featured factory-active-project-card" : "factory-request-card factory-active-project-card"}>
      <header className="factory-request-card-top">
        <div className="factory-request-title">
          <div className="factory-avatar">{project.initials}</div>
          <div>
            <h2 data-no-translate>{isZh ? getTranslatedProjectTitle(project.title) : project.title}</h2>
            <p className="project-meta" data-no-translate>
              {isZh ? getTranslatedListMeta(`${project.brand} · ${project.location} · ${project.started}`) : `${project.brand} · ${project.location} · ${project.started}`}
            </p>
          </div>
        </div>
        <div className="factory-request-card-actions factory-project-card-actions">
          <span className={`project-status ${project.statusTone}`}>{project.status}</span>
          <button className="secondary-btn" type="button">Message</button>
          <button className="primary-btn" type="button" onClick={onViewProject}>View order</button>
        </div>
      </header>

      <div className="factory-request-card-body">
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
  return (
    <main className="directory-page factory-browse-marketplace-page">
      <div className="directory-shell">
        <section className="directory-filter-panel" aria-label="Project filters">
          <div className="directory-filter-header">
            <strong>Filters</strong>
            <button type="button">Reset</button>
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
              <h1>BROWSE BRAND REQUESTS</h1>
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
            <button className="filter-button sort-button" type="button">Sort: Best fit</button>
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
  { key: "pay", label: "Pay" },
  { key: "approve", label: "Approve" },
  { key: "reply", label: "Reply" },
  { key: "calls", label: "Calls" },
  { key: "team", label: "Team" }
];

function FactorySettingsScreen() {
  const [activeSection, setActiveSection] = useState("account");
  const [inviteEmail, setInviteEmail] = useState("");
  const [team, setTeam] = useState([
    { name: "Ines Carvalho", email: "ines@atelierminho.pt", role: "Owner", permissions: ["pay", "approve", "reply", "calls", "team"] },
    { name: "Mateo Silva", email: "mateo@atelierminho.pt", role: "Production lead", permissions: ["approve", "reply", "calls"] },
    { name: "Sofia Ramos", email: "sofia@atelierminho.pt", role: "Finance", permissions: ["pay"] }
  ]);
  const account = {
    name: "Atelier Minho",
    email: "ops@atelierminho.pt",
    phone: "+351 22 000 1842",
    location: "Porto, Portugal",
    payment: "Wise business ending in 9021",
    backup: "Visa ending in 4412"
  };

  const togglePermission = (memberEmail, permission) => {
    setTeam((current) =>
      current.map((member) => {
        if (member.email !== memberEmail || member.role === "Owner") return member;
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

  return (
    <div className="settings-page">
      <aside className="settings-nav-panel">
        <h1>Settings</h1>
        <nav aria-label="Settings sections">
          {settingsNav.map(([id, label]) => (
            <button className={activeSection === id ? "active" : ""} type="button" onClick={() => goToSettingsSection(id)} key={id}>
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="settings-content">
        <header className="settings-heading">
          <div>
            <p>Factory account</p>
            <h2>Account settings</h2>
          </div>
          <button className="primary-btn" type="button">Save changes</button>
        </header>

        <section className="settings-section" id="settings-account">
              <div className="settings-section-header">
                <h3>Basic information</h3>
                <p>Edit the details brands use for orders, calls, and account verification.</p>
              </div>
              <div className="settings-form-grid">
                <label>
                  <span>Account name</span>
                  <input defaultValue={account.name} />
                </label>
                <label>
                  <span>Email</span>
                  <input defaultValue={account.email} type="email" />
                </label>
                <label>
                  <span>Phone</span>
                  <input defaultValue={account.phone} />
                </label>
                <label>
                  <span>Location</span>
                  <input defaultValue={account.location} />
                </label>
              </div>
            </section>

            <section className="settings-section" id="settings-security">
              <div className="settings-section-header">
                <h3>Password & security</h3>
                <p>Update login access and keep payout or approval actions protected.</p>
              </div>
              <div className="settings-form-grid">
                <label>
                  <span>Current password</span>
                  <input placeholder="Enter current password" type="password" />
                </label>
                <label>
                  <span>New password</span>
                  <input placeholder="Create new password" type="password" />
                </label>
              </div>
            </section>

        <section className="settings-section" id="settings-payment">
            <div className="settings-section-header">
              <h3>Payment method</h3>
              <p>Add, update, or remove the payout methods used for production milestones.</p>
            </div>
            <div className="settings-payment-list">
              <div>
                <span className="settings-card-brand">Primary</span>
                <strong>{account.payment}</strong>
                <small>Receives released milestone funds.</small>
              </div>
              <button className="secondary-btn compact-btn" type="button">Edit</button>
            </div>
            <div className="settings-payment-list">
              <div>
                <span className="settings-card-brand">Backup</span>
                <strong>{account.backup}</strong>
                <small>Helps avoid payout interruptions.</small>
              </div>
              <button className="secondary-btn compact-btn" type="button">Remove</button>
            </div>
            <button className="settings-add-btn" type="button">+ Add payment method</button>
          </section>

        <section className="settings-section" id="settings-team">
            <div className="settings-section-header split">
              <div>
                <h3>Manage team & stakeholders</h3>
                <p>Control who can pay, approve work, reply to messages, schedule calls, and manage access.</p>
              </div>
              <button className="primary-btn compact-btn" type="button" onClick={() => setInviteEmail("")}>Invite member</button>
            </div>

            <div className="settings-invite-row">
              <label>
                <span>Invite email</span>
                <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@company.com" type="email" />
              </label>
              <label>
                <span>Role</span>
                <select defaultValue="Stakeholder">
                  <option>Stakeholder</option>
                  <option>Production lead</option>
                  <option>Finance</option>
                  <option>Viewer</option>
                </select>
              </label>
              <button className="secondary-btn" type="button">Send invite</button>
            </div>

            <div className="settings-permission-table" role="table" aria-label="Team permissions">
              <div className="settings-permission-row header" role="row">
                <span>Member</span>
                {factorySettingsPermissionLabels.map((permission) => (
                  <span key={permission.key}>{permission.label}</span>
                ))}
              </div>
              {team.map((member) => (
                <div className="settings-permission-row" role="row" key={member.email}>
                  <div>
                    <strong>{member.name}</strong>
                    <small>{member.role} - {member.email}</small>
                  </div>
                  {factorySettingsPermissionLabels.map((permission) => (
                    <label className="settings-check" key={permission.key}>
                      <input
                        type="checkbox"
                        checked={member.permissions.includes(permission.key)}
                        disabled={member.role === "Owner"}
                        onChange={() => togglePermission(member.email, permission.key)}
                      />
                      <span>{permission.label}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </section>

        <section className="settings-section" id="settings-notifications">
            <div className="settings-section-header">
              <h3>Notifications</h3>
              <p>Choose which updates should reach your team by email.</p>
            </div>
            {["New RFQ matches", "Payment and approval requests", "Messages and call invites"].map((label) => (
              <div className="settings-inline-row" key={label}>
                <div>
                  <strong>{label}</strong>
                  <span>Send email notifications to members with matching authority.</span>
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

function FactoryOnboarding({ language, step, onLanguageChange, onBack, onNext }) {
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

        <FactoryOnboardingStep step={step} content={current} language={language} onLanguageChange={onLanguageChange} />

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

function FactoryOnboardingStep({ step, content, language, onLanguageChange }) {
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
          <small>{content.languageHelp}</small>
        </label>
      </div>
    );
  }

  if ([1, 2].includes(step)) {
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

  if (step === 5) {
    return <OnboardingCapacitySetup content={content} language={language} />;
  }

  if (step === 3) {
    return (
      <div className="factory-onboarding-section production-fit-section">
        {content.groups.map(([label, options, selected]) => (
          <OnboardingChipGroup label={label} options={options} selected={selected} balanced key={label} />
        ))}
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="factory-onboarding-section production-fit-section">
        <OnboardingField label={content.specialtyLabel} placeholder={content.specialtyPlaceholder} />
        {content.groups.map(([label, options, selected]) => (
          <OnboardingChipGroup label={label} options={options} selected={selected} key={label} />
        ))}
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
    return (
      <div className="factory-review-grid">
        {content.sections.map(([title, rows]) => (
          <section className="factory-review-section" key={title}>
            <h2>{title}</h2>
            <div className="factory-onboarding-review-rows">
              {rows.map(([label, value]) => (
                <DetailPair label={label} value={value} key={label} />
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
      <img className="factory-onboarding-success-preview" src="/assets/prototype-icons/container-margin.svg" alt="" />
    </div>
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

function OnboardingChipGroup({ label, options, selected = [], balanced = false }) {
  const [selectedOptions, setSelectedOptions] = useState(selected);
  const isSingleSelect = label.toLowerCase().includes("market") || label.includes("市场");

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

  return (
    <section className={balanced ? "onboarding-chip-group balanced" : "onboarding-chip-group"}>
      <h2>{label}</h2>
      <div className="tag-row compact-tags">
        {options.map((option) => (
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
    <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.8 18.1a7.3 7.3 0 1 1 0-14.6 7.3 7.3 0 0 1 0 14.6Zm5.2-2.1 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
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
    <article className={project.featured ? "factory-request-card featured" : "factory-request-card"}>
      <header className="factory-request-card-top">
        <div className="factory-request-title">
          <div className="factory-avatar">{project.initials}</div>
          <div>
            <h2 data-no-translate={!isZh || undefined}>{isZh ? translatedTitle : project.title}</h2>
            <p data-no-translate>
              {isZh ? getTranslatedListMeta(`${project.brand} · ${project.location} · ${project.posted}`) : `${project.brand} · ${project.location} · ${project.posted}`}
            </p>
          </div>
        </div>
        <div className="factory-request-card-actions">
          <span className={`factory-project-fit ${project.fitTone}`}>{project.capacity[0]}</span>
          <button className="secondary-btn" type="button">Save</button>
          <button className="primary-btn" type="button" onClick={onViewDetails}>View RFQ</button>
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
              <DetailPair label="Target unit price" value={project.budget} />
              <DetailPair label="Quantity" value={project.quantity} />
              <DetailPair label="Color split" value="3 colors · 100 each" />
              <DetailPair label="Sample plan" value={project.samples} />
              <DetailPair label="Bulk timeline" value="Late September" />
            </div>
          </DetailCard>

          <DetailCard title="Materials and requirements">
            <ul className="factory-detail-list">
              <li>Organic cotton poplin, mid-weight</li>
              <li>GOTS preferred, but brand can confirm certification path</li>
            </ul>
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
              <li>What fabric GSM or trim details do you need before final sample cost?</li>
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
              <DetailPair label="Verified brand" value="Yes" />
              <DetailPair label="Club orders" value="4" />
              <DetailPair label="Avg. response" value="1 day" />
              <DetailPair label="Payment status" value="Verified" />
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
  const isZh = language === "zh";

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
            <button className="active" type="button">Overview</button>
            <button type="button">Messages (2)</button>
            <button type="button">Files</button>
            <button type="button">Contract details</button>
          </nav>

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
            <button className="secondary-btn factory-manage-milestones" type="button">Manage step</button>
          </section>
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

function FactoryReviewTotal({ project, language, onBack, onEdit, onSendQuote }) {
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

            <section className="factory-submit-card factory-ready-card">
              <div>
                <h2>Ready to send?</h2>
                <p>Confirm the quote is complete before it appears in the brand comparison page.</p>
              </div>
              <div className="factory-ready-actions">
                <button className="primary-btn" type="button" onClick={onSendQuote}>Send quote</button>
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
          <button className="primary-btn" type="button" onClick={onSendQuote}>Send quote</button>
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

      <SubmitSection title="Sample plan" description="Break out sample stages so the brand can compare quotes clearly.">
        <div className="factory-submit-sample-rows">
          <SamplePlanRow stage="Fit sample" cost="$95" timing="10 days" includes="1 revision round" readOnly={readOnly} />
          <SamplePlanRow stage="PP sample" cost="$165" timing="11 days" includes="1 revision round" readOnly={readOnly} />
        </div>
        {!readOnly && <button className="factory-add-stage" type="button">+ Add sample stage</button>}
      </SubmitSection>

      <SubmitSection title="Brand questions and factory notes" description="Brand asks: Can you quote fit sample and PP sample separately? Can you support 3 colors at 100 units each? What fabric GSM or trim details do you need before final sample cost?" descriptionNoTranslate>
        <QuoteTextarea value="Yes. We can quote fit and PP samples separately, support 3 colors at 100 units each, and need confirmed GSM, button trim, and final size spec before final sample cost." label="Factory response" />
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

function FactoryQuoteSent({ project, onBack, onDashboard }) {
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
              <Metric label="unit price" value="$18.40" />
              <Metric label="quantity" value="300 units" />
              <Metric label="bulk lead" value="28 days" />
              <Metric label="quote total" value="$5,780" />
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
                <DetailPair label="Brand" value={project.brand} />
                <DetailPair label="Quote due" value="Jul 24" />
                <DetailPair label="Shown total" value="$5,780" />
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
      {label && <span>{label}</span>}
      <span data-no-translate>{value}</span>
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

function DetailPair({ label, value }) {
  return (
    <div className="factory-detail-pair">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
