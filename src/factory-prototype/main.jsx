import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../prototype/styles.css";
import "./styles.css";

const factorySamplePhotos = [
  "https://www.figma.com/api/mcp/asset/34578f9c-c721-48f7-9bb1-74b4a599cf31",
  "https://www.figma.com/api/mcp/asset/2d98726a-f212-432c-a44a-858969b0b506",
  "https://www.figma.com/api/mcp/asset/34578f9c-c721-48f7-9bb1-74b4a599cf31"
];

const brandProjects = [
  {
    initials: "MR",
    title: "Organic cotton woven shirt production",
    brand: "Maison Rue",
    location: "New York, USA",
    posted: "Posted 18 minutes ago",
    match: "94%",
    budget: "$18-$24",
    quantity: "300 units",
    samples: "Fit + PP",
    specialty:
      "Women's woven shirts in organic cotton poplin: 3 colors, 100 units per color. Brand needs fit sample and PP sample before bulk approval.",
    tags: ["Cut & sew", "GOTS preferred", "3 colors", "China / Portugal / Korea"],
    capacity: ["Strong fit", "August capacity works"],
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
    budget: "$40-$55",
    quantity: "180 units",
    samples: "Fit + size set",
    specialty:
      "Fine-gauge merino blend tops and cardigans for a small resort capsule. Looking for visible sample-room support and yarn sourcing.",
    tags: ["Knitwear", "OEKO-TEX", "Yarn sourcing", "China / Portugal / Korea"],
    capacity: ["Good fit", "Premium knit experience"],
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
    budget: "$28-$36",
    quantity: "500 units",
    samples: "Wash sample",
    specialty:
      "Rigid denim jacket with two washes. Brand needs wash-down samples, trim confirmation, and split delivery for first retail test.",
    tags: ["Denim", "Middle $18-$40", "Yarn sourcing", "Wash development"],
    capacity: ["Potential fit", "Check wash capacity"],
    fitTone: "warn",
    trust: "$5k+ spent",
    insight: [
      "Client payment verified with $5k+ spent through the Club.",
      "Quote only if wash development bandwidth is open this month."
    ]
  }
];

const nav = [
  { label: "Dashboard", icon: "home" },
  { label: "RFQs", icon: "rfq" },
  { label: "Projects", icon: "projects" },
  { label: "Explore requests", icon: "explore" },
  { label: "Connections", icon: "connections" },
  { label: "Messages", icon: "messages" },
  { label: "Bookmarks", icon: "bookmarks" },
  { label: "Settings", icon: "settings" },
  { label: "Notifications", icon: "notification" }
];

const factoryMainZhText = {
  "Dashboard": "控制台",
  "Projects": "项目",
  "Explore requests": "浏览需求",
  "Connections": "联系人",
  "Messages": "消息",
  "Bookmarks": "收藏",
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
  "Active projects": "进行中项目",
  "2 need sample updates": "2 个需要样品更新",
  "August capacity": "8 月产能",
  "Mostly open": "较空",
  "Open August": "8 月可接单",
  "Update capacity": "更新产能",
  "RFQ invites": "询价邀请",
  "Prioritized requests that match your capacity and capabilities.": "优先显示与你的产能和能力匹配的需求。",
  "View all": "查看全部",
  "Brand messages": "品牌消息",
  "Organic shirts - due today": "有机棉衬衫 - 今天截止",
  "Organic cotton woven shirt production": "有机棉梭织衬衫生产",
  "Premium knit capsule for resort drop": "度假系列高级针织小单",
  "Denim jacket wash development and small bulk": "牛仔夹克洗水开发与小批量生产",
  "Low-MOQ swim capsule with recycled nylon": "再生尼龙低 MOQ 泳装系列",
  "Women's woven shirts in organic cotton poplin: 3 colors, 100 units per color. Brand needs fit sample and PP sample before bulk approval.": "女装有机棉府绸梭织衬衫：3 个颜色，每色 100 件。品牌需要试身样和 PP 样，之后再审批大货。",
  "300 women’s woven shirts in organic cotton poplin. Fit + PP sample before bulk approval.": "300 件女装有机棉府绸梭织衬衫。大货审批前需要试身样和 PP 样。",
  "300 women's woven shirts in organic cotton poplin. Fit + PP sample before bulk approval.": "300 件女装有机棉府绸梭织衬衫。大货审批前需要试身样和 PP 样。",
  "Fine-gauge merino blend tops and cardigans for a small resort capsule. Looking for visible sample-room support and yarn sourcing.": "小型度假系列的细针距美利奴混纺上衣和开衫。希望工厂能提供清晰的样品间支持和纱线采购能力。",
  "Rigid denim jacket with two washes. Brand needs wash-down samples, trim confirmation, and split delivery for first retail test.": "硬挺牛仔夹克，两种洗水。品牌需要洗水样、辅料确认，并为首次零售测试分批交付。",
  "Small recycled nylon swim run with size set sample and packaging guidance.": "小批量再生尼龙泳装订单，需要齐码样和包装建议。",
  "Denim jacket wash development with revised 500-unit production run.": "牛仔夹克洗水开发，更新后大货数量为 500 件。",
  "Low-MOQ swim set capsule using recycled nylon and contrast binding.": "使用再生尼龙和撞色包边的低 MOQ 泳装套装系列。",
  "Stretch jersey capsule - 2 questions": "弹力针织系列 - 2 个问题",
  "Recycled fleece overshirt - new brief": "再生摇粒绒外套 - 新需求",
  "Can you split fit and PP sample cost?": "可以把试身样和 PP 样费用分开报价吗？",
  "Uploaded updated colorway sheet.": "已上传更新后的配色表。",
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
  "Check wash capacity": "需确认水洗产能",
  "Maison Rue · 300 units": "Maison Rue · 300 件",
  "Luna Resort · Lab dips": "Luna Resort · 色样",
  "Northline · Deposit funded": "Northline · 定金已付款",
  "RFQs": "询价",
  "Track active requests you were invited to, quotes you already sent, and brand questions that need an answer.": "管理你收到邀请的需求、已发送报价，以及需要回复的品牌问题。",
  "Search Projects": "搜索项目",
  "Project name, ID, or factory...": "项目名称、编号或工厂...",
  "Sort By": "排序",
  "Newest First": "最新优先",
  "Quote Due Soon": "报价即将截止",
  "Best Match": "最佳匹配",
  "Active RFQs (4)": "进行中询价 (4)",
  "Drafts (2)": "草稿 (2)",
  "Invited (2)": "已邀请 (2)",
  "Closed (6)": "已关闭 (6)",
  "Quote submitted": "报价已提交",
  "Brand question": "品牌有问题",
  "Due today": "今天截止",
  "your quote": "你的报价",
  "quote sent": "报价已发送",
  "quote due": "报价截止",
  "View RFQ": "查看询价",
  "‹ Back to RFQs": "‹ 返回询价",
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
  "Track funded factory work, sample approvals, milestones, messages, and shared files.": "跟踪已付款项目、样品审批、里程碑、消息和共享文件。",
  "Factory": "工厂",
  "All factories": "所有工厂",
  "Date Range": "日期范围",
  "Any Time": "任意时间",
  "Last 30 days": "过去 30 天",
  "Last 90 days": "过去 90 天",
  "Next Due": "最近截止",
  "Brand": "品牌",
  "Active projects (4)": "进行中项目 (4)",
  "Message": "发消息",
  "View project": "查看项目",
  "Waiting for sample approval": "等待样品审批",
  "Waiting on brand approval to unlock fund": "等待品牌审批以解锁款项",
  "Submit lab dip": "提交色样",
  "Waiting on brand review after lab dip upload": "色样上传后等待品牌审核",
  "Awaiting funding": "等待付款",
  "First milestone not funded": "第一个里程碑尚未付款",
  "Not started": "未开始",
  "Need funding": "需要付款",
  "1st step funded": "第一步已付款",
  "Fit sample": "试身样",
  "Fit / lab dip": "试身 / 色样",
  "Production": "生产",
  "Shipped": "已发货",
  "Filters": "筛选",
  "Reset": "重置",
  "Product category": "产品品类",
  "Cut & sew apparel": "裁剪缝制成衣",
  "Knitwear": "针织成衣",
  "Denim": "牛仔",
  "Outerwear": "外套",
  "Swim & activewear": "泳装和运动服",
  "Price point": "价格层级",
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
  "PROJECT MARKETPLACE": "项目市场",
  "BROWSE BRAND REQUESTS": "浏览品牌需求",
  "Search organic cotton, denim, sample-ready...": "搜索有机棉、牛仔、可打样...",
  "24 open requests": "24 个开放需求",
  "matching wovens, low MOQ, GOTS, and available August capacity": "匹配梭织、低 MOQ、GOTS 和 8 月可用产能",
  "Sort: Best fit": "排序：最匹配",
  "Save": "保存",
  "View details": "查看详情",
  "Project brief": "项目简介",
  "Maison Rue is looking for a vetted cut-and-sew factory for women's organic cotton woven shirts. The brand has a tech pack and wants factories to quote the first sample path and a small production run clearly.": "Maison Rue 正在寻找经过审核的裁剪缝制工厂，生产女装有机棉梭织衬衫。品牌已有 tech pack，希望工厂清楚报价第一轮样品路径和小批量生产。",
  "The request is intentionally lean: confirm unit price, sample costs, timeline, fabric GSM questions, and whether the requested color split is workable before moving to contract terms.": "这个需求刻意保持精简：在进入合同条款前，请确认单价、样品费用、时间线、面料 GSM 问题，以及所需颜色拆分是否可行。",
  "‹ Back to explore": "‹ 返回浏览",
  "Quote-ready details": "报价所需信息",
  "Target unit price": "目标单价",
  "Color split": "颜色拆分",
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
  "Can you quote fit sample and PP sample separately?": "可以把试身样和 PP 样分开报价吗？",
  "Can you support 3 colors at 100 units each?": "可以支持 3 个颜色、每色 100 件吗？",
  "What fabric GSM or trim details do you need before final sample cost?": "确认最终样品费用前，你需要哪些面料克重或辅料信息？",
  "Required capabilities": "所需能力",
  "Pattern support": "制版支持",
  "Sample-room support": "样品间支持",
  "Your August capacity and low-MOQ woven experience match the brand request.": "你的 8 月产能和低 MOQ 梭织经验符合品牌需求。",
  "Send quote": "发送报价",
  "Save project": "保存项目",
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
  "Submit quote": "提交报价",
  "Quote the exact unit price, sample path, lead time, and any questions before the brand chooses a factory.": "在品牌选择工厂前，填写准确单价、样品路径、交期和需要确认的问题。",
  "‹ Back to view project": "‹ 返回项目详情",
  "Back": "返回",
  "Save draft": "保存草稿",
  "Review total": "查看总计",
  "Quote terms": "报价条款",
  "Enter exact commercial terms for this request.": "填写该需求的准确商务条款。",
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
  "Brand asks: Can you quote fit sample and PP sample separately? Can you support 3 colors at 100 units each? What fabric GSM or trim details do you need before final sample cost?": "品牌问题：可以把试身样和 PP 样分开报价吗？可以支持 3 个颜色、每色 100 件吗？确认最终样品费用前，你需要哪些面料 GSM 或辅料信息？",
  "Factory response": "工厂回复",
  "Additional details and questions": "补充信息和问题",
  "Add supporting files or questions regarding the quote.": "添加与报价相关的支持文件或问题。",
  "Review quote total": "确认报价总计",
  "Quote for Organic cotton woven shirt production": "有机棉梭织衬衫生产报价",
  "Quote for 有机棉梭织衬衫生产": "有机棉梭织衬衫生产报价",
  "‹ Back to edit quote": "‹ 返回编辑报价",
  "Totals are calculated after saving the quote. Review the breakdown before sending it to Maison Rue.": "保存报价后会计算总计。发送给 Maison Rue 前请确认明细。",
  "Production subtotal": "生产小计",
  "Sample shipping": "样品运费",
  "Quote total shown to brand": "品牌将看到的报价总计",
  "Ready to send?": "准备发送？",
  "Confirm the quote is complete before it appears in the brand comparison page.": "发送前请确认报价完整，它会出现在品牌的报价比较页。",
  "Save progress": "保存进度",
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
  "Project activity": "项目动态",
  "Factory last viewed project 2h ago": "工厂 2 小时前查看项目",
  "Last message yesterday": "最后消息：昨天",
  "Sample photos expected Aug 16": "预计 8 月 16 日上传样品照片",
  "Bulk deposit locked until approval": "大货定金需审批后解锁",
  "Production timeline": "生产时间线",
  "Manage milestones": "管理里程碑",
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
    title: "Organic cotton woven shirt production",
    meta: "Maison Rue · New York, USA · Payment verified · $25k+ spent",
    description: "300 women’s woven shirts in organic cotton poplin. Fit + PP sample before bulk approval.",
    tags: ["Cut & sew", "Fit + size set · $340 total", "Sep capacity", "420 units", "GOTS"],
    status: "Quote submitted",
    statusTone: "ready",
    metrics: [
      ["$18.40", "your quote"],
      ["Jul 24", "quote sent"]
    ],
    featured: true
  },
  {
    title: "Premium knit capsule for resort drop",
    meta: "Elara Studio · Los Angeles, USA · Payment verified · $5k+ spent",
    description: "Fine-gauge merino blend tops and cardigans. Brand wants visible sample-room support.",
    tags: ["Knitwear", "Premium $40-$90", "180 units", "Fit + size set", "GOTS"],
    status: "Brand question",
    statusTone: "warning",
    metrics: [
      ["Draft", "your quote"],
      ["July 26", "quote due"]
    ]
  },
  {
    title: "Denim jacket wash development and small bulk",
    meta: "Northline · Toronto, Canada · Payment verified · $25k+ spent",
    description: "Rigid denim jacket with two washes. Needs wash-down samples, trims confirmation, and split delivery.",
    tags: ["Denim", "Middle $18-$40", "180 units", "Wash sample", "GOTS"],
    metrics: [
      ["Draft", "your quote"],
      ["July 29", "quote due"]
    ]
  },
  {
    title: "Low-MOQ swim capsule with recycled nylon",
    meta: "Aster Swim · Miami, USA · Payment verified · $5k+ spent",
    description: "Small recycled nylon swim run with size set sample and packaging guidance.",
    tags: ["Swim", "Mass $8-$18", "220 units", "Fit + size set"],
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
    featured: true
  },
  {
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
    progress: 3
  },
  {
    title: "Denim jacket wash development and small bulk",
    brand: "Northline Supply",
    location: "Austin, USA",
    started: "Started Jul 10",
    description: "Denim jacket wash development with revised 500-unit production run.",
    status: "Awaiting funding",
    statusTone: "neutral",
    statusDetail: "First milestone not funded",
    currentStep: "Not started",
    nextDue: "Jul 30",
    progress: 1
  },
  {
    title: "Low-MOQ swim capsule with recycled nylon",
    brand: "Marea Swim",
    location: "Miami, USA",
    started: "Started Jul 8",
    description: "Low-MOQ swim set capsule using recycled nylon and contrast binding.",
    status: "Awaiting funding",
    statusTone: "neutral",
    statusDetail: "First milestone not funded",
    currentStep: "Not started",
    nextDue: "Jul 28",
    progress: 1
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
        search: "Search or select a certification",
        certifications: [["GOTS", "Upload certificate"], ["OEKO-TEX Standard 100", "Uploaded"], ["BSCI", "Upload certificate"]],
        add: "+ Add another certification",
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
        search: "搜索或选择认证",
        certifications: [["GOTS", "上传证书"], ["OEKO-TEX Standard 100", "已上传"], ["BSCI", "上传证书"]],
        add: "+ 添加另一个认证",
        reference: "客户参考",
        addReference: "+ 添加另一个客户参考",
        referenceHelper: "你曾合作过的品牌或零售商。"
      },
      {
        title: "添加工厂视频 walkthrough",
        intro: "录制或上传一段连续的 2-4 分钟工厂 walkthrough 视频。无需剪辑。",
        laterNote: "你可以之后在资料页完成此步骤。",
        instructionTitle: "录制内容",
        instructionCopy: "从入口或前台开始，说出工厂名称、城市和当天日期。然后慢慢拍摄主要生产车间、物料或组件区域、关键机器或工位、质检区域，以及包装或仓库区域。",
        instructionMeta: "建议长度：2-4 分钟。最长：5 分钟。",
        checklistTitle: "视频应包括：",
        checklist: ["入口或前台", "主要生产车间", "物料 / 组件区域", "关键机器 / 工位", "质检区域", "包装或仓库"],
        optionTitle: "选择添加视频的方式（选填）",
        options: [["直接录制", "打开录制器，现在拍摄 walkthrough。"], ["上传视频", "上传已拍好的 walkthrough 视频文件。"]]
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
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingLanguage, setOnboardingLanguage] = useState("en");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [screen, setScreen] = useState("dashboard");
  const [detailBackTarget, setDetailBackTarget] = useState("browse");
  const [capacityDrawerOpen, setCapacityDrawerOpen] = useState(false);
  const [dashboardCapacity, setDashboardCapacity] = useState("2400");
  const selectedProject = brandProjects[0];
  const activeNav = screen === "dashboard" ? "Dashboard" : screen === "rfqs" || screen === "rfqReadOnly" ? "RFQs" : screen === "projects" || screen === "projectDetail" || screen === "projectPostedUpdate" ? "Projects" : "Explore requests";

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
        <button className={sidebarCollapsed ? "account-card collapsed-account" : "account-card"} type="button" aria-label="Factory account">
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
                  if (item.label === "Projects") setScreen("projects");
                  if (item.label === "Explore requests") setScreen("browse");
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
          capacityValue={dashboardCapacity}
          onUpdateCapacity={() => setCapacityDrawerOpen(true)}
          onViewRfqs={() => setScreen("rfqs")}
          onViewProjects={() => setScreen("projects")}
        />
      )}
      {screen === "browse" && (
        <FactoryBrowsePage
          onViewDetails={() => {
            setDetailBackTarget("browse");
            setScreen("detail");
          }}
        />
      )}
      {screen === "projects" && (
        <FactoryProjectsPage onViewProject={() => setScreen("projectDetail")} />
      )}
      {screen === "rfqs" && (
        <FactoryRfqsPage
          onViewRequest={() => setScreen("rfqReadOnly")}
          onEditQuote={() => setScreen("quote")}
        />
      )}
      {screen === "rfqReadOnly" && (
        <FactoryReadOnlyRfqPage
          project={selectedProject}
          onBack={() => setScreen("rfqs")}
        />
      )}
      {screen === "detail" && (
        <FactoryProjectDetail
          project={selectedProject}
          onBack={() => setScreen(detailBackTarget)}
          onSendQuote={() => setScreen("quote")}
        />
      )}
      {screen === "projectDetail" && (
        <FactoryProjectProgressDetail
          onBack={() => setScreen("projects")}
          onPostUpdate={() => setScreen("projectPostedUpdate")}
        />
      )}
      {screen === "projectPostedUpdate" && (
        <FactoryProjectProgressDetail
          onBack={() => setScreen("projects")}
          onPostUpdate={() => setScreen("projectPostedUpdate")}
          showPostedUpdate
        />
      )}
      {screen === "quote" && (
        <FactorySubmitQuote
          project={selectedProject}
          onBack={() => setScreen("detail")}
          onReviewTotal={() => setScreen("reviewTotal")}
        />
      )}
      {screen === "reviewTotal" && (
        <FactoryReviewTotal
          project={selectedProject}
          onBack={() => setScreen("quote")}
          onEdit={() => setScreen("quote")}
          onSendQuote={() => setScreen("quoteSent")}
        />
      )}
      {screen === "quoteSent" && (
        <FactoryQuoteSent
          project={selectedProject}
          onBack={() => setScreen("quote")}
          onDashboard={() => setScreen("dashboard")}
        />
      )}
      {capacityDrawerOpen && (
        <FactoryCapacityDrawer
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

function FactoryDashboardPage({ capacityValue, onUpdateCapacity, onViewRfqs, onViewProjects }) {
  const capacityUnits = getCapacityUnitRange(capacityValue);

  return (
    <main className="factory-dashboard-page">
      <div className="factory-dashboard-shell">
        <header className="factory-dashboard-header">
          <h1>Factory dashboard</h1>
          <p>Quotes, funded work, approvals, and brand messages in one operational view.</p>
        </header>

        <section className="factory-dashboard-grid" aria-label="Factory dashboard overview">
          <div className="factory-dashboard-metrics">
            <FactoryMetricCard label="Open RFQs" value="7" note="+3 invited this week" tone="blue" />
            <FactoryMetricCard label="Quotes sent" value="14" note="4 awaiting brand review" tone="green" />
            <FactoryMetricCard label="Active projects" value="5" note="2 need sample updates" tone="amber" />
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
            <FactoryDashboardRfqRow brand="Maison Rue" brief="Organic shirts - due today" budget="$18-$24" quantity="300 units" fit="Strong fit" tone="strong" />
            <FactoryDashboardRfqRow brand="Elara Studio" brief="Stretch jersey capsule - 2 questions" budget="$40-$55" quantity="180 units" fit="Good fit" tone="good" />
            <FactoryDashboardRfqRow brand="Northline Supply" brief="Recycled fleece overshirt - new brief" budget="$28-$36" quantity="500 units" fit="Potential fit" tone="warn" />
          </FactoryDashboardPanel>

          <FactoryDashboardPanel
            className="factory-brand-messages-panel"
            title="Brand messages"
            action="View all"
            onAction={() => {}}
          >
            <FactoryMessageRow unread brand="Maison Rue" message="Can you split fit and PP sample cost?" time="12 min" />
            <FactoryMessageRow brand="Elara Studio" message="Uploaded updated colorway sheet." time="1 hr" />
            <FactoryMessageRow brand="TSC ops" message="Verification renewal due this month." time="Today" />
          </FactoryDashboardPanel>

          <FactoryDashboardPanel
            className="factory-active-projects-panel"
            title="Active projects"
            subtitle="Prioritized requests that match your capacity and capabilities."
            action="View all"
            onAction={onViewProjects}
          >
            <FactoryProjectDashboardRow title="Organic cotton woven shirt production" meta="Maison Rue · 300 units" step="Fit sample" due="Aug 16" status="Waiting for sample approval" tone="strong" />
            <FactoryProjectDashboardRow title="Premium knit capsule for resort drop" meta="Luna Resort · Lab dips" step="Fit / lab dip" due="Aug 08" status="Submit lab dip" tone="warn" />
            <FactoryProjectDashboardRow title="Denim jacket wash development and small bulk" meta="Northline · Deposit funded" step="Not started" due="Aug 08" status="Awaiting funding" tone="neutral" />
          </FactoryDashboardPanel>
        </section>
      </div>
    </main>
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

function FactoryDashboardRfqRow({ brand, brief, budget, quantity, fit, tone }) {
  return (
    <article className="factory-dashboard-row factory-dashboard-rfq-row">
      <span className="factory-dashboard-thumb" />
      <div className="factory-dashboard-row-main">
        <strong>{brand}</strong>
        <p>{brief}</p>
      </div>
      <Metric label="unit target" value={budget} />
      <Metric label="quantity" value={quantity} />
      <span className={`factory-project-fit ${tone}`}>{fit}</span>
    </article>
  );
}

function FactoryMessageRow({ brand, message, time, unread = false }) {
  return (
    <article className="factory-message-row">
      <span className={unread ? "message-dot unread" : "message-dot"} />
      <div>
        <strong>{brand}</strong>
        <p>{message}</p>
      </div>
      <time>{time}</time>
    </article>
  );
}

function FactoryProjectDashboardRow({ title, meta, step, due, status, tone }) {
  return (
    <article className="factory-dashboard-row factory-project-dashboard-row">
      <span className="factory-dashboard-thumb" />
      <div className="factory-dashboard-row-main">
        <strong>{title}</strong>
        <p>{meta}</p>
      </div>
      <div className="factory-project-mini-metric">
        <span>Production step</span>
        <strong>{step}</strong>
      </div>
      <div className="factory-project-mini-metric">
        <span>Next due</span>
        <strong>{due}</strong>
      </div>
      <span className={`factory-project-fit ${tone}`}>{status}</span>
    </article>
  );
}

function FactoryRfqsPage({ onViewRequest, onEditQuote }) {
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
            <span>Search Projects</span>
            <div>
              <SearchIcon />
              <input placeholder="Project name, ID, or factory..." />
            </div>
          </label>
          <label className="rfqs-sort">
            <span>Sort By</span>
            <select defaultValue="newest">
              <option value="newest">Newest First</option>
              <option value="due">Quote Due Soon</option>
              <option value="match">Best Match</option>
            </select>
          </label>
        </section>

        <nav className="rfqs-tabs" aria-label="RFQ status">
          <button className="active" type="button">Active RFQs (4)</button>
          <button type="button">Drafts (2)</button>
          <button type="button">Invited (2)</button>
          <button type="button">Closed (6)</button>
        </nav>

        <section className="rfq-list" aria-label="Factory RFQs">
          {factoryRfqs.map((rfq) => (
            <FactoryRfqCard
              rfq={rfq}
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

function FactoryRfqCard({ rfq, onViewRequest, onEditQuote }) {
  return (
    <article className={rfq.featured ? "rfq-card featured factory-rfq-card" : "rfq-card factory-rfq-card"}>
      <div className="rfq-thumbnail" aria-hidden="true" />
      <div className="rfq-main">
        <h2>{rfq.title}</h2>
        <p className="rfq-date">{rfq.meta}</p>
        <p className="rfq-description">{rfq.description}</p>
      </div>
      <div className="tag-row compact-tags rfq-tags">
        {rfq.tags.map((tag) => (
          <span className="tag" key={tag}>{tag}</span>
        ))}
        {rfq.status && <span className={`tag rfq-status ${rfq.statusTone}`}>{rfq.status}</span>}
      </div>
      <div className="rfq-metrics">
        {rfq.metrics.map(([value, label]) => (
          <Metric label={label} value={value} key={label} />
        ))}
      </div>
      <button className="rfq-more" type="button" aria-label={`More options for ${rfq.title}`}>...</button>
      <div className="rfq-actions">
        <button
          className="primary-btn"
          type="button"
          onClick={rfq.status === "Quote submitted" ? onViewRequest : onEditQuote}
        >
          View RFQ
        </button>
      </div>
    </article>
  );
}

function FactoryReadOnlyRfqPage({ project, onBack }) {
  return (
    <main className="factory-detail-page factory-submit-page factory-rfq-read-page">
      <div className="factory-submit-content">
        <header className="factory-detail-header factory-submit-header factory-rfq-read-header">
          <button className="text-link" type="button" onClick={onBack}>‹ Back to RFQs</button>
          <h1>View RFQ</h1>
          <p>Review the brand request and the quote you submitted.</p>
        </header>

        <div className="factory-submit-layout factory-rfq-read-layout">
          <section className="factory-submit-main">
            <FactoryQuoteRequestCard project={project} />
            <FactoryQuoteSections readOnly />
          </section>

          <aside className="factory-submit-side">
            <section className="factory-submit-card factory-status-card">
              <h2>RFQ status</h2>
              <p>Your quote was submitted and is visible to Maison Rue.</p>
              <div className="factory-status-facts">
                <DetailPair label="Your quote" value="$18.40" />
                <DetailPair label="Quote sent" value="Jul 24" />
                <DetailPair label="Status" value="Quote submitted" />
              </div>
            </section>

            <section className="factory-submit-reminder">
              <h2>Helpful reminder</h2>
              <p>
                Factories should quote exact units and exact lead time here. MOQ only belongs on profile/search,
                not on a response to a known order quantity.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function FactoryProjectsPage({ onViewProject }) {
  return (
    <main className="rfqs-page factory-projects-page">
      <div className="rfqs-shell projects-shell">
        <header className="rfqs-header projects-header">
          <div>
            <h1>Projects</h1>
            <p>Track funded factory work, sample approvals, milestones, messages, and shared files.</p>
          </div>
        </header>

        <section className="projects-controls" aria-label="Project filters">
          <label className="rfqs-search">
            <span>Search Projects</span>
            <div>
              <SearchIcon />
              <input placeholder="Project name, ID, or factory..." />
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

        <nav className="rfqs-tabs projects-tabs" aria-label="Project status">
          <button className="active" type="button">Active projects (4)</button>
          <button type="button">Closed (6)</button>
        </nav>

        <section className="projects-list" aria-label="Active factory projects">
          {factoryProjects.map((project) => (
            <FactoryProjectListCard project={project} onViewProject={onViewProject} key={project.title} />
          ))}
        </section>
      </div>
    </main>
  );
}

function FactoryProjectListCard({ project, onViewProject }) {
  return (
    <article className={project.featured ? "brand-project-card featured factory-active-project-card" : "brand-project-card factory-active-project-card"}>
      <div className="project-thumbnail" aria-hidden="true" />
      <div className="project-main">
        <h2>{project.title}</h2>
        <p className="project-meta">{project.brand} · {project.location} · {project.started}</p>
        <p className="project-description">{project.description}</p>
        <div className="project-status-row">
          <span className={`project-status ${project.statusTone}`}>{project.status}</span>
          <span>{project.statusDetail}</span>
        </div>
        <ProjectProgress progress={project.progress} />
      </div>
      <div className="project-facts">
        <div>
          <span>PRODUCTION STEP</span>
          <strong>{project.currentStep}</strong>
        </div>
        <div>
          <span>NEXT DUE</span>
          <strong>{project.nextDue}</strong>
        </div>
      </div>
      <div className="project-actions">
        <button className="secondary-btn" type="button">Message</button>
        <button className="primary-btn" type="button" onClick={onViewProject}>View project</button>
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
            <small>{progress === 1 && index === 0 ? "Need funding" : step}</small>
          </div>
        );
      })}
    </div>
  );
}

function FactoryBrowsePage({ onViewDetails }) {
  return (
    <main className="directory-page">
      <div className="directory-shell">
        <section className="directory-filter-panel" aria-label="Project filters">
          <div className="directory-filter-header">
            <strong>Filters</strong>
            <button type="button">Reset</button>
          </div>
          <FilterGroup title="Product category">
            <FilterCheck checked label="Cut & sew apparel" />
            <FilterCheck label="Knitwear" />
            <FilterCheck label="Denim" />
            <FilterCheck label="Outerwear" />
            <FilterCheck label="Swim & activewear" />
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
              <p className="eyebrow">PROJECT MARKETPLACE</p>
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
              <BrandProjectCard project={project} key={project.title} onViewDetails={onViewDetails} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function FactoryCapacityDrawer({ initialCapacity, onClose, onSaveCapacity }) {
  const [lineHours, setLineHours] = useState(initialCapacity || "2400");
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
  const activeRange = levelRanges[selectedLevel];
  const availableHours = Math.max(0, Number.parseInt(lineHours || "0", 10) || 0);
  const availableMinutes = availableHours * 60;
  const minPieces = Math.round((availableMinutes * (activeRange.min / 100)) / 18);
  const maxPieces = Math.round((availableMinutes * (activeRange.max / 100)) / 18);
  const pieceSummary = minPieces === maxPieces ? maxPieces.toLocaleString() : `${minPieces.toLocaleString()}-${maxPieces.toLocaleString()}`;

  const updateMonthSelection = (month, selected) => {
    setMonthSelections((current) => ({ ...current, [month]: selected }));
  };

  return (
    <div className="factory-capacity-drawer-layer" role="presentation">
      <button className="factory-capacity-scrim" type="button" aria-label="Close update capacity" onClick={onClose} />
      <aside className="factory-capacity-drawer" aria-label="Update capacity">
        <header className="factory-capacity-drawer-header">
          <div>
            <h2>Add fit sample update</h2>
            <p>
              Enter your monthly line-hours. We'll translate them into booking level,
              open percentage, and estimated units brands can understand.
            </p>
          </div>
          <button type="button" aria-label="Close update capacity" onClick={onClose}>×</button>
        </header>

        <section className="capacity-drawer-section">
          <h3>Category</h3>
          <p className="capacity-category">Wovens — your registered specialization</p>
        </section>

        <section className="capacity-drawer-section">
          <h3>Line-hours available per month</h3>
          <div className="line-hours-control">
            <input
              inputMode="numeric"
              value={lineHours}
              onChange={(event) => setLineHours(event.target.value.replace(/\D/g, ""))}
              aria-label="Line-hours available per month"
            />
            <span>hours / month</span>
          </div>
          <p className="capacity-helper">
            Total across all your lines. This is the number that stays true no matter what style a brand orders.
          </p>
        </section>

        <section className="capacity-drawer-section">
          <h3>Estimate uses a standard reference style</h3>
          <div className="reference-style-card">
            <div>
              <strong>Basic woven shirt</strong>
              <span>~18 min/pc</span>
            </div>
            <p>
              We use a standard woven shirt reference so brands can compare capacity across factories.
              Once a brand shares a tech pack, the estimate can be adjusted to the actual style.
            </p>
          </div>
        </section>

        <section className="capacity-drawer-section">
          <h3>Booking level, month by month</h3>
          <p className="capacity-helper">
            Percentage of your hours still free that month. We multiply this against your reference-style estimate to get units.
          </p>
          <div className="capacity-month-nav" aria-hidden="true">
            <button type="button" onClick={() => setMonthOffset((offset) => Math.max(0, offset - monthPageSize))}><span>‹</span></button>
            <button type="button" onClick={() => setMonthOffset((offset) => Math.min(monthNames.length - monthPageSize, offset + monthPageSize))}><span>›</span></button>
          </div>
          <div className="capacity-month-list">
            {visibleMonths.map((month) => (
              <CapacityMonthRow
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
            <span>BRANDS WILL SEE</span>
            <strong>Wovens · {currentMonth} start · roughly {pieceSummary} pieces that month</strong>
            <p>{availableHours.toLocaleString()} hours × 60 min × {activeRange.min}%-{activeRange.max}% free ÷ 18 min/pc reference style</p>
          </div>
          <button className="primary-btn" type="button" onClick={() => onSaveCapacity(lineHours)}>Save changes</button>
        </footer>
      </aside>
    </div>
  );
}

function CapacityMonthRow({ month, selected, onSelect }) {
  const options = [
    { key: "open", label: "Mostly open", note: "60-100% open" },
    { key: "partial", label: "Partly booked", note: "25-60% open" },
    { key: "full", label: "Mostly full", note: "0-25% open" }
  ];

  return (
    <div className="capacity-month-row">
      <span>{month}</span>
      <div>
        {options.map((option) => (
          <button
            className={selected === option.key ? "selected" : ""}
            type="button"
            onClick={() => onSelect(option.key)}
            key={option.key}
          >
            <strong>{option.label}</strong>
            <small>{option.note}</small>
          </button>
        ))}
      </div>
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
        <OnboardingField label={language === "zh" ? "持有的认证" : "Certifications you hold"} placeholder={content.search} />
        <div className="certification-upload-list">
          {content.certifications.map(([name, status]) => (
            <div className="certification-upload-row" key={name}>
              <strong>{name}</strong>
              <button className={status === "Uploaded" || status === "已上传" ? "uploaded-pill" : "secondary-btn"} type="button">
                {status}
              </button>
            </div>
          ))}
        </div>
        <button className="onboarding-text-action" type="button">{content.add}</button>
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
  const [monthSelections, setMonthSelections] = useState({
    Aug: "open",
    Sep: "partial",
    Oct: "full"
  });
  const months = ["Aug", "Sep", "Oct"];
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
  const activeRange = levelRanges[monthSelections.Aug] || levelRanges.open;
  const availableHours = Math.max(0, Number.parseInt(lineHours || "0", 10) || 0);
  const availableMinutes = availableHours * 60;
  const minPieces = Math.round((availableMinutes * (activeRange.min / 100)) / 18);
  const maxPieces = Math.round((availableMinutes * (activeRange.max / 100)) / 18);
  const pieceSummary = minPieces === maxPieces ? maxPieces.toLocaleString() : `${minPieces.toLocaleString()}-${maxPieces.toLocaleString()}`;
  const brandPreview = language === "zh"
    ? `品牌将看到：梭织 · 8 月可开始 · 当月约 ${pieceSummary} 件`
    : `Brands will see: Wovens · Aug start · roughly ${pieceSummary} pieces that month`;

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
          <strong>{content.category}</strong>
        </div>

        <label className="line-hours-control onboarding-line-hours">
          <input
            inputMode="numeric"
            value={lineHours}
            onChange={(event) => setLineHours(event.target.value.replace(/\D/g, ""))}
            aria-label={content.lineHoursLabel}
          />
          <span>{language === "zh" ? "小时 / 月" : "hours / month"}</span>
        </label>
        <p className="capacity-helper">{content.lineHoursLabel}</p>

        <div className="reference-style-card onboarding-reference-style">
          <div>
            <strong>{content.referenceTitle}</strong>
            <span>{content.referenceMeta}</span>
          </div>
          <p>{content.referenceCopy}</p>
        </div>

        <div className="onboarding-month-section">
          <h2>{content.monthTitle}</h2>
          <div className="onboarding-month-list">
            {months.map((month) => (
              <div className="onboarding-month-row" key={month}>
                <span>{month}</span>
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
  return (
    <section className={balanced ? "onboarding-chip-group balanced" : "onboarding-chip-group"}>
      <h2>{label}</h2>
      <div className="tag-row compact-tags">
        {options.map((option) => (
          <button className={selected.includes(option) ? "tag selected" : "tag"} type="button" key={option}>
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

function Metric({ label, value, className = "" }) {
  return (
    <div className={className ? `metric ${className}` : "metric"}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function BrandProjectCard({ project, onViewDetails }) {
  return (
    <article className={project.featured ? "directory-factory-card featured factory-project-card" : "directory-factory-card factory-project-card"}>
      <div className="factory-project-thumb" />
      <div className="directory-factory-intro">
        <div>
          <div className="factory-name-row">
            <h2>{project.title}</h2>
          </div>
          <p>{project.brand} · {project.location} · {project.posted}</p>
          <strong>{project.specialty}</strong>
        </div>
      </div>
      <div className="directory-factory-metrics">
        <Metric label="unit target" value={project.budget} />
        <Metric label="quantity" value={project.quantity} />
        <Metric label="samples" value={project.samples} />
      </div>
      <div className="directory-factory-actions">
        <button className="secondary-btn" type="button">Save</button>
        <button className="primary-btn" type="button" onClick={onViewDetails}>View details</button>
      </div>
      <div className="tag-row compact-tags directory-tags">
        {project.tags.map((tag) => (
          <span className="tag" key={tag}>{tag}</span>
        ))}
      </div>
      <div className="factory-project-fit-row">
        <span className={`factory-project-fit ${project.fitTone}`}>{project.capacity.join(" · ")}</span>
      </div>
      <div className="factory-project-trust">
        <img src="/assets/prototype-icons/payment-protection.svg" alt="" />
        <strong>Payment verified</strong>
        <span>|</span>
        <strong>{project.trust}</strong>
      </div>
    </article>
  );
}

function FactoryProjectDetail({ project, onBack, onSendQuote }) {
  return (
    <main className="factory-detail-page">
      <header className="factory-detail-header">
        <button className="text-link" type="button" onClick={onBack}>‹ Back to explore</button>
        <h1>{project.title}</h1>
        <p>{project.brand} · {project.location} · {project.posted}</p>
      </header>

      <div className="factory-detail-layout">
        <section className="factory-detail-main">
          <DetailCard title="Project brief">
            <p>
              Maison Rue is looking for a vetted cut-and-sew factory for women's organic cotton woven shirts.
              The brand has a tech pack and wants factories to quote the first sample path and a small
              production run clearly.
            </p>
            <p>
              The request is intentionally lean: confirm unit price, sample costs, timeline, fabric GSM
              questions, and whether the requested color split is workable before moving to contract terms.
            </p>
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
            <ol className="factory-detail-list">
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

        <aside className="factory-detail-side">
          <section className="factory-side-card project-fit-card">
            <h2>Project brief</h2>
            <p>Your August capacity and low-MOQ woven experience match the brand request.</p>
            <span className="factory-project-fit strong">Strong fit</span>
            <div className="factory-side-actions">
              <button className="primary-btn" type="button" onClick={onSendQuote}>Send quote</button>
              <button className="secondary-btn" type="button">Save project</button>
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

function FactoryProjectProgressDetail({ onBack, onPostUpdate, showPostedUpdate = false }) {
  const [updateMilestone, setUpdateMilestone] = useState(null);

  return (
    <main className="factory-detail-page factory-project-detail-page">
      <header className="factory-detail-header factory-project-detail-header">
        <button className="text-link" type="button" onClick={onBack}>‹ Back to projects</button>
        <h1>Organic cotton woven shirt production</h1>
        <p>Atelier Minho · Porto, Portugal · Started Jul 19</p>
      </header>

      <div className="factory-project-detail-grid">
        <section className="factory-project-detail-main">
          <section className="factory-project-summary-card" aria-label="Project summary">
            <Metric label="project total" value="$5,780" />
            <Metric label="project funds" value="$120" />
            <Metric label="remaining" value="$5,660" />
            <Metric label="next payment" value="$1,656" className="highlight" />
          </section>

          <nav className="rfqs-tabs factory-project-detail-tabs" aria-label="Project detail sections">
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
            <button className="secondary-btn factory-manage-milestones" type="button">Manage milestones</button>
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
            <h2>Project activity</h2>
            <ul>
              <li>Factory last viewed project 2h ago</li>
              <li>Last message yesterday</li>
              <li>Sample photos expected Aug 16</li>
              <li>Bulk deposit locked until approval</li>
            </ul>
          </section>
        </aside>
      </div>
      {updateMilestone && (
        <AddUpdateModal
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

function AddUpdateModal({ milestone, onClose, onPost }) {
  return (
    <div className="factory-update-modal-layer" role="presentation">
      <div className="factory-update-modal" role="dialog" aria-modal="true" aria-labelledby="factory-update-title">
        <button className="factory-update-close" type="button" aria-label="Close add update" onClick={onClose}>×</button>
        <header>
          <h2 id="factory-update-title">Add {milestone.title.toLowerCase()} update</h2>
          <p>Share progress photos and a short note for Maison Rue to review before this milestone is approved.</p>
        </header>

        <label className="factory-update-note">
          <span>Upload note</span>
          <textarea defaultValue="Optional: packaging, QC expectations, shipping notes, or anything factories should know before quoting." />
        </label>

        <button className="factory-update-upload" type="button">
          <strong>+ Upload photos</strong>
          <span>JPG or PNG, up to 10 files</span>
        </button>

        <footer>
          <button className="secondary-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-btn" type="button" onClick={onPost}>Post update</button>
        </footer>
      </div>
    </div>
  );
}

function FactorySubmitQuote({ project, onBack, onReviewTotal }) {
  return (
    <main className="factory-detail-page factory-submit-page">
      <div className="factory-submit-content">
        <header className="factory-detail-header factory-submit-header">
          <button className="text-link" type="button" onClick={onBack}>‹ Back to view project</button>
          <h1>Submit quote</h1>
          <p>Quote the exact unit price, sample path, lead time, and any questions before the brand chooses a factory.</p>
        </header>

        <div className="factory-submit-layout">
          <section className="factory-submit-main">
            <FactoryQuoteRequestCard project={project} />
            <FactoryQuoteSections />
          </section>

          <FactoryQuoteReminder />
        </div>
      </div>
      <footer className="factory-submit-bottom-bar">
        <button className="secondary-btn" type="button" onClick={onBack}>Back</button>
        <div className="factory-submit-bottom-actions">
          <button className="secondary-btn" type="button">Save draft</button>
          <button className="primary-btn" type="button" onClick={onReviewTotal}>Review total</button>
        </div>
      </footer>
    </main>
  );
}

function FactoryReviewTotal({ project, onBack, onEdit, onSendQuote }) {
  const rows = [
    ["Unit price", "$18.40"],
    ["Quantity", "300 units"],
    ["Production subtotal", "$5,520"],
    ["Sample plan", "Fit + PP · $260"],
    ["Sample shipping", "TBD"],
    ["Payment terms", "30% / 70%"],
  ];

  return (
    <main className="factory-detail-page factory-submit-page factory-review-page">
      <div className="factory-submit-content">
        <header className="factory-detail-header factory-submit-header factory-review-header">
          <button className="text-link" type="button" onClick={onEdit}>‹ Back to edit quote</button>
          <h1>Review quote total</h1>
          <p>Totals are calculated after saving the quote. Review the breakdown before sending it to Maison Rue.</p>
        </header>

        <div className="factory-review-layout">
          <section className="factory-submit-card factory-review-card">
            <header className="factory-review-card-header">
              <h2>Quote for {project.title}</h2>
              <p>{project.brand} · {project.location} · {project.posted}</p>
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
              <span>Quote total shown to brand</span>
              <strong data-no-translate>$5,780</strong>
            </div>
          </section>

          <aside className="factory-submit-card factory-ready-card">
            <div>
              <h2>Ready to send?</h2>
              <p>Confirm the quote is complete before it appears in the brand comparison page.</p>
            </div>
            <div className="factory-ready-actions">
              <button className="primary-btn" type="button" onClick={onSendQuote}>Send quote</button>
              <button className="secondary-btn" type="button">Save progress</button>
            </div>
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

function FactoryQuoteRequestCard({ project }) {
  return (
    <article className="factory-submit-card factory-submit-project-card">
      <div className="factory-submit-project-copy">
        <h2>{project.title}</h2>
        <p>{project.brand} · {project.location} · {project.posted}</p>
        <strong>{project.specialty}</strong>
        <div className="tag-row compact-tags factory-submit-tags">
          {project.tags.map((tag) => (
            <span className="tag" key={tag}>{tag}</span>
          ))}
        </div>
        <span className="factory-project-fit strong">{project.capacity.join(" · ")}</span>
      </div>
      <div className="factory-submit-project-meta">
        <DetailPair label="Requested quantity" value="300 units · 3 colors" />
        <DetailPair label="Quote due" value="Jul 24" />
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

      <SubmitSection title="Brand questions and factory notes" description="Brand asks: Can you quote fit sample and PP sample separately? Can you support 3 colors at 100 units each? What fabric GSM or trim details do you need before final sample cost?">
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

function SubmitSection({ title, description, children }) {
  return (
    <article className="factory-submit-card factory-submit-section">
      <h2>{title}</h2>
      <p>{description}</p>
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
      {!readOnly && <button type="button" aria-label={`Remove ${stage}`}>×</button>}
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
