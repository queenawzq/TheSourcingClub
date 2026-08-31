import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import "./styles.css";

const samplePhotos = [
  "https://images.pexels.com/photos/7752674/pexels-photo-7752674.jpeg?auto=compress&dpr=1&w=600",
  "https://images.pexels.com/photos/7752585/pexels-photo-7752585.jpeg?auto=compress&dpr=1&w=600",
  "https://images.pexels.com/photos/7505060/pexels-photo-7505060.jpeg?auto=compress&dpr=1&w=600"
];

const steps = [
  { title: "Describe request", meta: "Draft product need" },
  { title: "Review brief", meta: "Quote-ready basics" },
  { title: "Invite factories", meta: "Choose who can quote" },
  { title: "Review quotes", meta: "Compare responses" },
  { title: "Contract terms", meta: "Scope + delivery" },
  { title: "Production steps", meta: "Payment + approvals" },
  { title: "Fund first payment", meta: "Start sample work" }
];

const screenOrder = [
  "describe",
  "review",
  "invite",
  "inviteSuccess",
  "quotes",
  "quoteDetail",
  "contract",
  "milestones",
  "fund",
  "success"
];

const screenMeta = {
  home: {
    step: 0,
    title: "Hi Maison Rue",
    description: "",
    cta: ""
  },
  profile: {
    step: 0,
    title: "Maison Rue",
    description: "",
    cta: ""
  },
  profileCompletion: {
    step: 0,
    title: "Profile completion",
    description: "",
    cta: ""
  },
  messages: {
    step: 0,
    title: "Messages",
    description: "",
    cta: ""
  },
  saved: {
    step: 0,
    title: "Saved",
    description: "",
    cta: ""
  },
  settings: {
    step: 0,
    title: "Settings",
    description: "",
    cta: ""
  },
  describe: {
    step: 0,
    title: "Describe what you need made.",
    description: "Start with the product, quantity, timeline, sample needs, target price, and any quality requirements factories should price against.",
    cta: "Generate brief"
  },
  review: {
    step: 1,
    title: "Review your quote brief.",
    description: "Check the structured request before it goes to factories, so every partner sees the same product details and expectations.",
    cta: "Invite factories"
  },
  invite: {
    step: 2,
    title: "Invite factories to quote.",
    description: "Choose matched factories and send the quote request to partners with the right category, MOQ, region, and service fit.",
    cta: "Invite factories"
  },
  inviteSuccess: {
    step: 2,
    title: "Quote request sent.",
    description: "Factories have the brief, attachments, and questions they need to decide whether to quote.",
    cta: "Review quotes"
  },
  quotes: {
    step: 3,
    title: "Review factory quotes.",
    description: "Compare pricing, timelines, sample plans, open questions, and factory fit before selecting who should move forward.",
    cta: "Review quote"
  },
  quoteDetail: {
    step: 3,
    title: "Review Atelier Minho quote.",
    description: "Inspect one factory response in detail, including unit pricing, lead time, sample terms, assumptions, and included revisions.",
    cta: "Choose quote"
  },
  contract: {
    step: 4,
    title: "Set contract terms.",
    description: "Confirm the selected quote, production scope, delivery term, revisions, and approval expectations before building the payment schedule.",
    cta: "Add production steps"
  },
  milestones: {
    step: 5,
    title: "Add production steps",
    description:
      "Build your own production schedule with as many steps as needed. Each step can be update-only, approval-only, or a paid release.",
    cta: "Continue to funding"
  },
  fund: {
    step: 6,
    title: "Fund first payment",
    description:
      "The brand funds the sample payment now. Bulk production stays locked until sample approval.",
    cta: "Fund payment & start"
  },
  success: {
    step: 6,
    title: "First payment funded",
    description:
      "Your sample payment is funded. The factory can start work, and funds are only released after you approve the sample.",
    cta: "Go to dashboard"
  }
};

const factories = [
  {
    initials: "AM",
    name: "Atelier Minho",
    location: "Porto, Portugal",
    trust: "trusted",
    fit: "96%",
    response: "< 6h",
    fitType: "Strong fit",
    fitSummary: "Premium shirting fit, low-MOQ sampling, and available August capacity.",
    factoryNote: "Premium finish support and tighter sample review. No open questions after tech pack upload.",
    price: "$18.40",
    quoteQuantity: "300 units",
    lead: "28 days",
    note: "Best match for organic cotton woven shirts with sample-first production.",
    stats: [
      ["MOQ", "150/style"],
      ["Price point", "$18-$40"],
      ["Bulk lead", "22-28 days"],
      ["Capacity", "420 units"]
    ],
    products: [
      { name: "Organic poplin shirt", image: "https://images.pexels.com/photos/7752674/pexels-photo-7752674.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Linen resort set", image: "https://images.pexels.com/photos/6461392/pexels-photo-6461392.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Light trench shell", image: "https://images.pexels.com/photos/7760024/pexels-photo-7760024.jpeg?auto=compress&dpr=1&w=900" }
    ],
    tags: ["Cut & sew", "Middle $18-$40", "MOQ 150", "22-28 days lead", "Open Aug 12-30", "420 units"]
  },
  {
    initials: "HS",
    name: "Hanshu Studio",
    location: "Seoul, Korea",
    trust: "verified",
    fit: "91%",
    response: "< 12h",
    fitType: "Good fit",
    fitSummary: "Higher unit cost, but strongest finish quality and responsive team.",
    factoryNote: "Premium finish support and tighter sample review. No open questions after tech pack upload.",
    price: "$21.10",
    quoteQuantity: "300 units",
    lead: "32 days",
    note: "Strong construction and finishing, slightly higher sample cost.",
    stats: [
      ["MOQ", "150/style"],
      ["Price point", "$18-$40"],
      ["Bulk lead", "22-28 days"],
      ["Capacity", "420 units"]
    ],
    products: [
      { name: "Fine-gauge cardigan", image: "https://images.pexels.com/photos/9603624/pexels-photo-9603624.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Ribbed knit tank", image: "https://images.pexels.com/photos/8433475/pexels-photo-8433475.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Merino polo", image: "https://images.pexels.com/photos/914668/pexels-photo-914668.jpeg?auto=compress&dpr=1&w=900" }
    ],
    tags: ["Cut & sew", "Middle $18-$40", "MOQ 150", "22-28 days lead", "Open Aug 12-30", "420 units"]
  },
  {
    initials: "NW",
    name: "Ningbo Woven Co",
    location: "Ningbo, China",
    trust: "basic",
    fit: "78%",
    response: "< 24h",
    fitType: "Tradeoff",
    fitSummary: "Best price, but quoted at a revised 500-unit production run.",
    factoryNote: "Can split colorways after deposit. Brand should accept 500 units or request a revised 300-unit quote.",
    price: "$16.90",
    quoteQuantity: "500 units",
    lead: "35 days",
    note: "Competitive bulk pricing, needs closer sample approval before production.",
    stats: [
      ["MOQ", "500/style"],
      ["Price point", "$8-$18"],
      ["Bulk lead", "32 days"],
      ["Capacity", "Best price"]
    ],
    products: [
      { name: "Cotton shirt run", image: "https://images.pexels.com/photos/4621919/pexels-photo-4621919.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Bulk cutting table", image: "https://images.pexels.com/photos/4620625/pexels-photo-4620625.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Garment finishing", image: "https://images.pexels.com/photos/31031119/pexels-photo-31031119.jpeg?auto=compress&dpr=1&w=900" }
    ],
    tags: ["Cut & sew", "Mass $8-$18", "MOQ 500", "32 days lead", "GOTS", "Best price", "split colorways"]
  }
];

const directoryFactories = [
  {
    initials: "AM",
    name: "Atelier Minho",
    location: "Porto, Portugal",
    specialty: "Women's woven, shirting, lightweight outerwear",
    trust: "trusted",
    match: "92%",
    rating: "4.9",
    orders: "12 Club orders",
    tags: ["Cut & sew", "Middle $18-$40", "MOQ 150", "22-28 day lead", "GOTS", "+6"],
    capacity: ["Open Aug 12-30", "Capacity 420 units"],
    insight: [
      "Low-MOQ woven line with export-ready sampling and in-house QC.",
      "Strong fit for premium shirting, sets, and lightweight jackets."
    ],
    featured: true
  },
  {
    initials: "SK",
    name: "Seoul Knit Works",
    location: "Seoul, South Korea",
    specialty: "Fine-gauge knitwear, merino blends, capsule runs",
    trust: "verified",
    match: "88%",
    rating: "4.8",
    orders: "8 Club orders",
    tags: ["Knitwear", "Premium $40-$90", "MOQ 200", "35 day lead", "OEKO-TEX", "+4"],
    capacity: ["Open Sep 2-20", "Capacity 300 units"],
    insight: [
      "Verified walkthrough shows linked knitting, washing, and finishing rooms.",
      "Best for small sweater capsules where yarn selection matters."
    ]
  },
  {
    initials: "TN",
    name: "Tirupur Natural Studio",
    location: "Tirupur, India",
    specialty: "Organic jersey, loungewear sets, low-impact dye partners",
    trust: "trusted",
    match: "88%",
    rating: "4.8",
    orders: "8 Club orders",
    tags: ["Jersey", "Mass $8-$18", "MOQ 250", "30 day lead", "GOTS", "+5"],
    capacity: ["Open in 3 weeks", "Capacity 650 units"],
    insight: [
      "Organic jersey specialist with low-impact dye partners and GOTS-ready sourcing.",
      "Good fit for loungewear capsules that need flexible capacity."
    ]
  },
  {
    initials: "HD",
    name: "Hangzhou Denim Lab",
    location: "Hangzhou, China",
    specialty: "Denim jackets, trousers, wash development, trims sourcing",
    trust: "basic",
    match: "88%",
    rating: "4.8",
    orders: "8 Club orders",
    tags: ["Denim", "Middle $18-$40", "MOQ 300", "28 day lead", "BSCI", "Wash dev", "+3"],
    capacity: ["Open Aug 18", "Capacity 500 units"],
    insight: [
      "Denim wash development, trim sourcing, and export-ready sampling in one line.",
      "Best for jackets and trousers where wash testing matters before bulk."
    ]
  }
];

const marketplaceFactories = [
  {
    initials: "AM",
    name: "Atelier Minho",
    location: "Porto, Portugal",
    trust: "trusted",
    match: "96%",
    rating: "4.9",
    response: "< 6h",
    orders: "12 Club orders",
    specialty: "Premium woven tops, shirting, dresses, and lightweight outerwear",
    categories: [
      "Button-down shirts",
      "Poplin blouses",
      "Woven dresses",
      "Linen co-ords",
      "Lightweight jackets",
      "Pleated skirts"
    ],
    capabilities: ["In-house pattern room", "Fit sample + PP sample", "Small-batch export", "GOTS cotton"],
    stats: [
      ["MOQ", "150/style"],
      ["Price point", "$18-$40"],
      ["Bulk lead", "22-28 days"],
      ["Capacity", "420 units"]
    ],
    products: [
      { name: "Organic poplin shirt", image: "https://images.pexels.com/photos/7752674/pexels-photo-7752674.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Linen resort set", image: "https://images.pexels.com/photos/6461392/pexels-photo-6461392.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Light trench shell", image: "https://images.pexels.com/photos/7760024/pexels-photo-7760024.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Factory floor", image: "https://images.pexels.com/photos/31031119/pexels-photo-31031119.jpeg?auto=compress&dpr=1&w=900" }
    ],
    notes: ["Best for elevated woven capsules that need visible fit support, trim sourcing, grading, and QC photo updates before final balance.", "Can quote trim sourcing, grading, and QC photos before final balance."],
    featured: true
  },
  {
    initials: "SK",
    name: "Seoul Knit Works",
    location: "Seoul, South Korea",
    trust: "verified",
    match: "91%",
    rating: "4.8",
    response: "< 12h",
    orders: "8 Club orders",
    specialty: "Fine-gauge knitwear, sweater sets, rib basics, and merino blends",
    categories: ["Merino cardigans", "Rib tanks", "Fine-gauge polos", "Sweater dresses", "Knit co-ords", "Jacquard panels"],
    capabilities: ["Yarn sourcing", "Linking + washing", "Lab dip review", "OEKO-TEX yarns"],
    stats: [
      ["MOQ", "200/style"],
      ["Price point", "$40-$90"],
      ["Bulk lead", "32-40 days"],
      ["Capacity", "300 units"]
    ],
    products: [
      { name: "Fine-gauge cardigan", image: "https://images.pexels.com/photos/9603624/pexels-photo-9603624.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Ribbed knit tank", image: "https://images.pexels.com/photos/8433475/pexels-photo-8433475.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Merino polo", image: "https://cdn.shopify.com/s/files/1/0207/9406/files/02_Merino_LS_Polo_Quaker_Front.jpg?v=1725536429&width=900" },
      { name: "Knitting room", image: "https://images.pexels.com/photos/31031119/pexels-photo-31031119.jpeg?auto=compress&dpr=1&w=900" }
    ],
    notes: ["Strong for small sweater capsules where yarn hand-feel, color standards, linking quality, and shrinkage testing need close review.", "Good communication on color standards and shrinkage testing."]
  },
  {
    initials: "TN",
    name: "Tirupur Natural Studio",
    location: "Tirupur, India",
    trust: "trusted",
    match: "89%",
    rating: "4.8",
    response: "< 8h",
    orders: "15 Club orders",
    specialty: "Organic jersey, fleece sets, loungewear, babywear, and low-impact dye",
    categories: ["Jersey tees", "Sweatshirt sets", "Leggings", "Baby rompers", "Lounge shorts", "Rib dresses"],
    capabilities: ["GOTS jersey", "Low-impact dye", "Screen print", "Garment wash"],
    stats: [
      ["MOQ", "250/style"],
      ["Price point", "$8-$18"],
      ["Bulk lead", "24-32 days"],
      ["Capacity", "650 units"]
    ],
    products: [
      { name: "Organic tee", image: "https://images.pexels.com/photos/37704838/pexels-photo-37704838.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Fleece lounge set", image: "https://images.pexels.com/photos/3894389/pexels-photo-3894389.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Rib baby romper", image: "https://images.pexels.com/photos/16681603/pexels-photo-16681603.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Dye partner", image: "https://images.pexels.com/photos/31031119/pexels-photo-31031119.jpeg?auto=compress&dpr=1&w=900" }
    ],
    notes: ["Best for loungewear capsules that need flexible organic jersey capacity, low-impact dye coordination, and colorway splits after lab dip approval.", "Can split colorways after lab dip approval."]
  },
  {
    initials: "HD",
    name: "Hangzhou Denim Lab",
    location: "Hangzhou, China",
    trust: "basic",
    match: "84%",
    rating: "4.6",
    response: "< 24h",
    orders: "3 Club orders",
    specialty: "Denim jackets, jeans, workwear shirts, wash development, and trims sourcing",
    categories: ["Rigid denim jackets", "Straight-leg jeans", "Washed trousers", "Workwear overshirts", "Cargo skirts", "Denim vests"],
    capabilities: ["Wash development", "Trim sourcing", "Laser whiskers", "BSCI"],
    stats: [
      ["MOQ", "300/style"],
      ["Price point", "$18-$40"],
      ["Bulk lead", "28-36 days"],
      ["Capacity", "500 units"]
    ],
    products: [
      { name: "Washed denim jacket", image: "https://images.pexels.com/photos/28174872/pexels-photo-28174872.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Straight-leg jean", image: "https://images.pexels.com/photos/17720437/pexels-photo-17720437.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Workwear overshirt", image: "https://images.pexels.com/photos/3998647/pexels-photo-3998647.jpeg?auto=compress&dpr=1&w=900" },
      { name: "Wash line", image: "https://images.pexels.com/photos/31031120/pexels-photo-31031120.jpeg?auto=compress&dpr=1&w=900" }
    ],
    notes: ["Useful when denim wash testing, trims sourcing, and production assumptions need to be confirmed before final price lock.", "Quoted capacity is stronger for 500-unit production runs."]
  }
];

const activeRfqs = [
  {
    title: "Organic cotton woven shirt production",
    date: "Posted Jul 18 · Quote due Jul 24",
    description: "300 women's woven shirts in organic cotton poplin. Fit + PP sample before bulk approval.",
    tags: ["Cut & sew", "Middle $18-$40", "300 units"],
    images: [
      { label: "Poplin shirt reference", src: "https://images.pexels.com/photos/7752674/pexels-photo-7752674.jpeg?auto=compress&dpr=1&w=900" },
      { label: "Material direction", src: "https://images.pexels.com/photos/6461392/pexels-photo-6461392.jpeg?auto=compress&dpr=1&w=900" },
      { label: "Fit detail", src: "https://images.pexels.com/photos/7760024/pexels-photo-7760024.jpeg?auto=compress&dpr=1&w=900" }
    ],
    status: "Ready to compare",
    statusTone: "ready",
    metrics: [
      ["3", "quotes"],
      ["7", "invited"],
      ["2", "message"]
    ],
    featured: true
  },
  {
    title: "Premium knit capsule for resort drop",
    date: "Posted yesterday · Quote due Jul 26",
    description: "Fine-gauge merino blend tops and cardigans. Looking for visible sample-room support.",
    tags: ["Cut & sew", "Premium $40-$90", "300 units"],
    images: [
      { label: "Cardigan reference", src: "https://images.pexels.com/photos/9603624/pexels-photo-9603624.jpeg?auto=compress&dpr=1&w=900" },
      { label: "Yarn direction", src: "https://images.pexels.com/photos/6069552/pexels-photo-6069552.jpeg?auto=compress&dpr=1&w=900" }
    ],
    status: "Ready to compare",
    statusTone: "ready",
    metrics: [
      ["4", "quotes"],
      ["9", "invited"],
      ["1", "message"]
    ]
  },
  {
    title: "Denim jacket wash development and small bulk",
    date: "Posted 2 days ago · Quote due Jul 29",
    description: "Rigid denim jacket with two washes, trim confirmation, and split delivery for first retail test.",
    tags: ["Denim", "Middle $18-$40", "500 units"],
    images: [
      { label: "Denim jacket reference", src: "https://images.pexels.com/photos/28174872/pexels-photo-28174872.jpeg?auto=compress&dpr=1&w=900" },
      { label: "Wash direction", src: "https://images.pexels.com/photos/31031120/pexels-photo-31031120.jpeg?auto=compress&dpr=1&w=900" }
    ],
    status: "Question open",
    statusTone: "warning",
    metrics: [
      ["4", "quotes"],
      ["9", "invited"],
      ["1", "message"]
    ]
  },
  {
    title: "Silk slip dress capsule",
    date: "Posted today · Quote due Aug 4",
    description: "Bias-cut silk blend slip dresses across two colors. Need final size range and target price before inviting factories.",
    tags: ["Wovens", "Premium $40-$90", "180 units"],
    images: [
      { label: "Slip dress reference", src: "https://images.pexels.com/photos/1036622/pexels-photo-1036622.jpeg?auto=compress&dpr=1&w=900" },
      { label: "Fabric direction", src: "https://images.pexels.com/photos/7679720/pexels-photo-7679720.jpeg?auto=compress&dpr=1&w=900" }
    ],
    status: "Draft needs review",
    statusTone: "warning",
    metrics: [
      ["0", "quotes"],
      ["5", "invited"],
      ["0", "message"]
    ]
  }
];

const draftRfqs = [
  {
    title: "Silk slip dress capsule",
    date: "Draft saved Aug 2 · Needs factory invite",
    description: "Bias-cut silk blend slip dresses across two colors. Need final size range and target price before inviting factories.",
    tags: ["Wovens", "Premium $40-$90", "180 units"],
    images: [
      { label: "Slip dress reference", src: "https://images.pexels.com/photos/1036622/pexels-photo-1036622.jpeg?auto=compress&dpr=1&w=900" },
      { label: "Fabric direction", src: "https://images.pexels.com/photos/7679720/pexels-photo-7679720.jpeg?auto=compress&dpr=1&w=900" }
    ],
    status: "Draft",
    statusTone: "warning",
    metrics: [
      ["0", "quotes"],
      ["0", "invited"],
      ["0", "message"]
    ]
  },
  {
    title: "Cotton canvas tote reorder",
    date: "Draft saved Jul 30 · Missing artwork",
    description: "Structured canvas totes with printed logo, inside pocket, and two handle lengths.",
    tags: ["Accessories", "Value $8-$18", "600 units"],
    images: [
      { label: "Canvas tote reference", src: "https://images.pexels.com/photos/5706277/pexels-photo-5706277.jpeg?auto=compress&dpr=1&w=900" }
    ],
    status: "Needs brief",
    statusTone: "warning",
    metrics: [
      ["0", "quotes"],
      ["0", "invited"],
      ["0", "message"]
    ]
  }
];

const closedRfqs = [
  {
    title: "Linen camp shirt summer run",
    date: "Closed Jul 12 · Quote accepted",
    description: "Short-sleeve linen shirts with corozo buttons and garment wash. Moved to production with Atelier Minho.",
    tags: ["Wovens", "Middle $18-$40", "240 units"],
    images: [
      { label: "Linen shirt reference", src: "https://images.pexels.com/photos/7752674/pexels-photo-7752674.jpeg?auto=compress&dpr=1&w=900" },
      { label: "Wash direction", src: "https://images.pexels.com/photos/6461321/pexels-photo-6461321.jpeg?auto=compress&dpr=1&w=900" }
    ],
    status: "Accepted",
    statusTone: "ready",
    metrics: [
      ["5", "quotes"],
      ["8", "invited"],
      ["4", "message"]
    ]
  },
  {
    title: "Rib knit base layer set",
    date: "Closed Jun 28 · Archived",
    description: "Rib tank and short set with compact MOQ and two lab dip rounds.",
    tags: ["Knits", "Value $8-$18", "400 units"],
    images: [
      { label: "Rib set reference", src: "https://images.pexels.com/photos/6069552/pexels-photo-6069552.jpeg?auto=compress&dpr=1&w=900" }
    ],
    status: "Closed",
    statusTone: "neutral",
    metrics: [
      ["3", "quotes"],
      ["6", "invited"],
      ["2", "message"]
    ]
  }
];

const activeProjects = [
  {
    title: "Organic cotton woven shirt production",
    factory: "Atelier Minho",
    location: "Porto, Portugal",
    started: "Started Jul 19",
    description: "300 women's woven shirts in organic cotton poplin. Fit + PP sample before bulk approval.",
    status: "Fit sample ready",
    statusTone: "ready",
    statusDetail: "Approve payment after sample review",
    currentStep: "Fit sample",
    nextDue: "Aug 16",
    progress: 2,
    image: { label: "Poplin shirt reference", src: "https://images.pexels.com/photos/7752674/pexels-photo-7752674.jpeg?auto=compress&dpr=1&w=900" },
    featured: true
  },
  {
    title: "Premium knit capsule for resort drop",
    factory: "Hansu Studio",
    location: "Seoul, Korea",
    started: "Started Jul 12",
    description: "Small capsule of lightweight knit tops with PP sample before bulk approval.",
    status: "Lab dip review",
    statusTone: "warning",
    statusDetail: "Lab dip approval requested by factory",
    currentStep: "Fit / lab dip",
    nextDue: "Aug 08",
    progress: 3,
    image: { label: "Knit capsule reference", src: "https://images.pexels.com/photos/9603624/pexels-photo-9603624.jpeg?auto=compress&dpr=1&w=900" }
  },
  {
    title: "Denim jacket wash development and small bulk",
    factory: "Ningbo Woven Co",
    location: "Ningbo, China",
    started: "Started Jul 10",
    description: "Denim jacket wash development with revised 500-unit production run.",
    status: "Awaiting funding",
    statusTone: "neutral",
    statusDetail: "First milestone not funded",
    currentStep: "Fund milestone",
    nextDue: "Jul 30",
    progress: 1,
    image: { label: "Denim jacket reference", src: "https://images.pexels.com/photos/28174872/pexels-photo-28174872.jpeg?auto=compress&dpr=1&w=900" }
  },
  {
    title: "Low-MOQ swim capsule with recycled nylon",
    factory: "Tirupur Natural Studio",
    location: "Tirupur, India",
    started: "Started Jul 8",
    description: "Low-MOQ swim set capsule using recycled nylon and contrast binding.",
    status: "Awaiting funding",
    statusTone: "neutral",
    statusDetail: "First milestone not funded",
    currentStep: "Fund milestone",
    nextDue: "Jul 28",
    progress: 1,
    image: { label: "Swim capsule reference", src: "https://images.pexels.com/photos/3998649/pexels-photo-3998649.jpeg?auto=compress&dpr=1&w=900" }
  }
];

const projectSteps = ["1st step funded", "Samples", "Fit / lab dip", "Production", "Shipped"];

const projectDetailMilestones = [
  {
    title: "Fit sample",
    meta: "Funded · due Aug 16",
    amount: "$120",
    description: "Factory prepares first sample and uploads sample photos for approval.",
    action: "Approve fund",
    tone: "primary",
    update: true
  },
  {
    title: "Lab dip / color",
    meta: "Awaiting brand approval",
    description: "Brand reviews fabric color standard before bulk materials are ordered.",
    action: "Approve"
  },
  {
    title: "Strike-off / print",
    meta: "Factory update due Aug 18",
    description: "Factory confirms print, embroidery, or construction details before bulk.",
    action: "Approve"
  },
  {
    title: "Size set / fit notes",
    meta: "Factory update due Aug 18",
    description: "Brand reviews graded sizes or fit notes when needed for the style.",
    action: "Approve"
  },
  {
    title: "Bulk deposit",
    meta: "Before shipment / QC photos",
    amount: "$1,656",
    description: "Final balance releases after QC photos and shipment details are confirmed.",
    action: "Fund milestone",
    tone: "primary"
  },
  {
    title: "QC photos",
    meta: "Before final payment",
    description: "Brand approves QC photos before final balance can release.",
    action: "Approve"
  },
  {
    title: "Final payment",
    meta: "Before shipment / QC photos",
    amount: "$1,656",
    description: "Final balance releases after QC photos and shipment details are confirmed.",
    action: "Fund milestone",
    tone: "primary"
  }
];

const milestones = [
  {
    name: "Fit sample",
    type: "Paid release",
    description: "Factory prepares fit sample and uploads sample photos for approval.",
    amount: "$120",
    due: "Aug 16, 2026"
  },
  {
    name: "Lab dip / color standard",
    type: "Approval only",
    description: "Brand confirms fabric color before bulk materials are ordered.",
    amount: "No payment",
    due: "After fit approval"
  },
  {
    name: "Strike-off / print approval",
    type: "Approval only",
    description: "Factory confirms print, embroidery, or construction details before bulk.",
    amount: "No payment",
    due: "Aug 18, 2026"
  },
  {
    name: "Bulk deposit",
    type: "Paid release",
    description: "30% deposit reserves the production window and starts bulk purchasing.",
    amount: "$1,656",
    due: "After sample approvals"
  },
  {
    name: "Bulk production",
    type: "Update only",
    description: "Factory adds progress updates during cutting, sewing, finishing, and packing.",
    amount: "No payment",
    due: "Aug 20-Sep 18"
  },
  {
    name: "QC photos / packing check",
    type: "Approval only",
    description: "Brand reviews QC photos and packing confirmation before final payment.",
    amount: "No payment",
    due: "Before final payment"
  },
  {
    name: "Final payment & shipment",
    type: "Paid release",
    description: "Final balance releases after QC and shipment details are confirmed.",
    amount: "$4,004",
    due: "Before shipment"
  }
];

const messageThreads = [
  {
    id: "atelier",
    name: "Atelier Minho",
    initials: "AM",
    location: "Porto, Portugal",
    status: "Online",
    localTime: "9:18 PM local time",
    project: "Organic cotton woven shirt production",
    kind: "Production order",
    lastDate: "Today",
    lastPreview: "Fit sample front, side, and detail photos are ready for review.",
    unread: 2,
    responseLabel: "Usually replies in 2h",
    scheduleNote: "Your time: ET · Atelier Minho: Porto time",
    scheduleSlots: [
      { brand: "Tue 10:00 AM ET", factory: "Atelier Minho: Tue 3:00 PM" },
      { brand: "Tue 12:30 PM ET", factory: "Atelier Minho: Tue 5:30 PM" },
      { brand: "Wed 9:30 AM ET", factory: "Atelier Minho: Wed 2:30 PM" }
    ],
    files: ["Front photo", "Measurement update"],
    messages: [
      {
        from: "factory",
        time: "9:48 AM",
        body: "Fit sample is ready for review. Uploaded front, side, and detail photos for approval.",
        attachments: ["Front photo", "Detail photo", "Back photo"]
      },
      {
        from: "brand",
        time: "10:12 AM",
        body: "Thanks. Can you confirm if the sleeve opening follows the updated measurement chart?"
      },
      {
        from: "factory",
        time: "11:03 AM",
        language: "pt",
        original: "Sim, seguimos a tabela atualizada. Ajustamos a abertura da manga para 28 cm conforme indicado.",
        translation: "Yes, we followed the updated chart. We adjusted the sleeve opening to 28 cm as requested."
      }
    ]
  },
  {
    id: "hansu",
    name: "Hansu Studio",
    initials: "HS",
    location: "Seoul, Korea",
    status: "Away",
    localTime: "10:18 AM local time",
    project: "Premium knit capsule for resort drop",
    kind: "Production order",
    lastDate: "Yesterday",
    lastPreview: "Yarn substitution question is waiting for your reply.",
    unread: 1,
    responseLabel: "Usually replies same day",
    scheduleNote: "Your time: ET · Hansu Studio: Seoul time",
    scheduleSlots: [
      { brand: "Mon 7:00 PM ET", factory: "Hansu Studio: Tue 8:00 AM" },
      { brand: "Tue 8:30 PM ET", factory: "Hansu Studio: Wed 9:30 AM" },
      { brand: "Wed 7:30 PM ET", factory: "Hansu Studio: Thu 8:30 AM" }
    ],
    files: ["Colorway sheet", "Yarn card"],
    messages: [
      {
        from: "factory",
        time: "Yesterday",
        body: "The original yarn supplier can still meet the lead time, but the minimum is higher than planned."
      },
      {
        from: "factory",
        time: "Yesterday",
        language: "ko",
        original: "대체 원사는 촉감이 비슷하지만 색상은 조금 더 따뜻합니다. 승인 전에 랩딥을 보내드릴 수 있습니다.",
        translation: "The substitute yarn has a similar handfeel, but the color is slightly warmer. We can send a lab dip before approval."
      }
    ]
  },
  {
    id: "northline",
    name: "Northline",
    initials: "NO",
    location: "Toronto, Canada",
    status: "Online",
    localTime: "4:18 PM local time",
    project: "Denim jacket wash development and small bulk",
    kind: "Quote",
    lastDate: "Mon",
    lastPreview: "Can you confirm target wash sample lead time?",
    unread: 0,
    responseLabel: "Usually replies in 4h",
    scheduleNote: "Your time: ET · Northline: Toronto time",
    scheduleSlots: [
      { brand: "Tue 2:00 PM ET", factory: "Northline: Tue 2:00 PM" },
      { brand: "Tue 4:30 PM ET", factory: "Northline: Tue 4:30 PM" },
      { brand: "Wed 1:00 PM ET", factory: "Northline: Wed 1:00 PM" }
    ],
    files: ["Wash direction", "Trim notes"],
    messages: [
      {
        from: "factory",
        time: "Mon",
        body: "Can you confirm target wash sample lead time? We can quote two options once timing is locked."
      },
      {
        from: "brand",
        time: "Mon",
        body: "Please quote the faster option, but note any surcharge separately."
      }
    ]
  },
  {
    id: "tirupur",
    name: "Tirupur Natural Studio",
    initials: "TN",
    location: "Tirupur, India",
    status: "Offline",
    localTime: "6:48 AM local time",
    project: "Low-MOQ swim capsule with recycled nylon",
    kind: "Saved factory",
    lastDate: "Jul 30",
    lastPreview: "Shared updated certification list and recycled nylon range.",
    unread: 0,
    responseLabel: "Usually replies in 1 day",
    scheduleNote: "Your time: ET · Tirupur Natural Studio: India time",
    scheduleSlots: [
      { brand: "Tue 8:30 AM ET", factory: "Tirupur Natural Studio: Tue 6:00 PM" },
      { brand: "Wed 9:00 AM ET", factory: "Tirupur Natural Studio: Wed 6:30 PM" },
      { brand: "Thu 8:00 AM ET", factory: "Tirupur Natural Studio: Thu 5:30 PM" }
    ],
    files: ["Certification list", "Nylon range"],
    messages: [
      {
        from: "factory",
        time: "Jul 30",
        body: "We added the updated certification list and recycled nylon range for your review."
      }
    ]
  }
];

const brandOnboardingSteps = [
  {
    title: "Welcome to The Sourcing Club",
    intro: "Let's set up your brand profile. It takes about 4 minutes, and you can edit everything later.",
    meta: "10 steps · 4 minutes",
    cta: "Get started",
    type: "welcome"
  },
  {
    title: "Tell us about your brand",
    intro: "This helps factories understand who they are quoting for.",
    type: "fields",
    fields: [
      ["Brand name", "e.g. Aria Studio"],
      ["Brand category", "", "select"],
      ["Business email", "name@maisonrue.com"],
      ["Year founded", "YYYY"],
      ["Website URL", "www.example.com"],
      ["HQ location", "City, Country"]
    ],
    helper: "We'll use this to help build your profile in a later step."
  },
  {
    title: "Add brand context",
    intro: "Share the details that help factories understand your brand direction and sourcing needs.",
    type: "brandContext"
  },
  {
    title: "What are you looking to make?",
    intro: "Choose the production methods and product categories factories should match against.",
    type: "chips",
    groups: [
      ["Production type", ["Cut & sew knits", "Wovens", "Sweaters / knitwear", "Denim", "Seamless / circular knit", "Intimates / delicate garments", "Leather / suede", "Bags / soft goods"], ["Cut & sew knits", "Wovens"]],
      ["Product categories", ["Tops", "Bottoms", "Dresses & jumpsuits", "Outerwear", "Activewear", "Intimates / underwear", "Swimwear", "Sleepwear / loungewear", "Childrenswear / baby", "Uniforms / workwear", "Accessories"], ["Tops", "Bottoms"]],
      ["Market level", ["Luxury ($500+)", "Premium / contemporary ($100-$500)", "Mid range ($50-$100)", "Mass market (under $50)"], ["Premium / contemporary ($100-$500)"]]
    ]
  },
  {
    title: "Share your sourcing volume",
    intro: "Help factories understand order size, cadence, and pricing fit before they quote.",
    type: "sourcingPlan",
    fields: [
      ["Average pieces ordered per year", ["Under 1,000", "1,000-5,000", "5,000-20,000", "20,000-100,000", "100,000+"], "5,000-20,000"],
      ["Typical order size per style", ["Under 100", "100-300", "300-1,000", "1,000-5,000", "5,000+"], "300-1,000"],
      ["Collections per year", ["1", "2", "3-4", "5-6", "Monthly drops"], "3-4"],
      ["Typical price range for core styles", "e.g. $12-$28 FOB per unit"],
      ["Typical reorder cadence", ["One-time seasonal buys", "Monthly reorders", "Quarterly reorders", "Repeat best sellers as needed"], "Quarterly reorders"],
      ["Current sourcing stage", ["Exploring factories", "Sampling soon", "Ready for production", "Replacing current supplier"], "Sampling soon"]
    ]
  },
  {
    title: "Factory preferences",
    intro: "Set the regions, certifications, and services you care about most.",
    type: "chips",
    groups: [
      ["Preferred regions", ["Portugal", "China", "Korea", "India", "Turkey", "United States"], ["Portugal", "China", "Korea"]],
      ["Certifications", ["GOTS", "OEKO-TEX", "BSCI", "GRS", "WRAP", "No preference"], ["GOTS", "OEKO-TEX"]],
      ["Services needed", ["Full package", "CMT", "Pattern making", "Sample development", "Fabric sourcing"], ["Full package", "Sample development"]]
    ]
  },
  {
    title: "Help factories trust you",
    intro: "Verified brands get faster responses. We review this in the background so you can keep exploring while we do.",
    type: "trust"
  },
  {
    title: "Review your profile",
    intro: "Confirm the information factories will use to understand your brand.",
    type: "review",
    cta: "Confirm & Continue"
  },
  {
    title: "Terms & Conditions",
    intro: "Please read and sign our terms before continuing.",
    type: "terms",
    terms: [
      ["Platform Usage", "Use The Sourcing Club to share accurate brand information, submit real sourcing needs, and communicate with factories in good faith."],
      ["Data Privacy & Confidentiality", "Only upload assets, product references, and company documents you are allowed to share. Factory quotes, pricing, and private project details should remain confidential."],
      ["Brand Responsibilities", "Keep your profile, project briefs, payment status, and decision-maker details accurate so factories can quote and plan production confidently."]
    ],
    agreement: "I have read and agree to the Terms and Conditions",
    signature: "Type your full name to sign electronically",
    cta: "Sign & Continue"
  },
  {
    title: "You're all set",
    intro: "Your brand profile has been submitted. We'll review your verification documents and let you know when your profile is ready for factories to discover.",
    cta: "Go to Dashboard",
    type: "complete"
  }
];

function App() {
  const query = new URLSearchParams(window.location.search);
  const requestedScreen = query.get("screen");
  const initialScreen = requestedScreen === "brandOnboarding" || query.get("view") === "brand-onboarding"
    ? "brandOnboarding"
    : screenMeta[requestedScreen]
      ? requestedScreen
      : query.get("view") === "marketplace"
        ? "factoryMarketplace"
        : "projects";
  const [screen, setScreen] = useState(initialScreen);
  const [brandOnboardingStep, setBrandOnboardingStep] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedFactories, setSelectedFactories] = useState(["Atelier Minho", "Hanshu Studio"]);
  const [selectedQuote, setSelectedQuote] = useState("Atelier Minho");
  const [selectedQuotesForCompare, setSelectedQuotesForCompare] = useState(["Atelier Minho", "Hanshu Studio"]);
  const [quoteCompareOpen, setQuoteCompareOpen] = useState(false);
  const [selectedReorderProject, setSelectedReorderProject] = useState(null);
  const [fundingMilestone, setFundingMilestone] = useState(null);
  const [milestoneTypes, setMilestoneTypes] = useState(
    Object.fromEntries(milestones.map((milestone) => [milestone.name, milestone.type]))
  );
  const [toast, setToast] = useState("");
  const [activityDrawerOpen, setActivityDrawerOpen] = useState(false);
  const [transitionKey, setTransitionKey] = useState(0);

  const index = screenOrder.indexOf(screen);
  const meta = screenMeta[screen];
  const activeMeta = screen === "fund" && fundingMilestone
    ? {
        ...meta,
        title: `Fund ${fundingMilestone.title.toLowerCase()}`,
        description: `Add ${fundingMilestone.amount} to project funds for ${fundingMilestone.title.toLowerCase()}. Funds stay protected until the related step is approved.`,
        cta: `Fund ${fundingMilestone.amount}`
      }
    : meta;
  const isStandalone = screen === "home" || screen === "profile" || screen === "profileCompletion" || screen === "factorySearch" || screen === "factoryMarketplace" || screen === "rfqs" || screen === "projects" || screen === "projectDetail" || screen === "messages" || screen === "saved" || screen === "settings" || screen === "billing";
  const isWideFlow = screen === "invite" || screen === "quotes" || screen === "quoteDetail";

  const goTo = (next) => {
    if (next !== "fund") setFundingMilestone(null);
    setScreen(next);
    setTransitionKey((value) => value + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToFundingMilestone = (milestone) => {
    setFundingMilestone(milestone);
    goTo("fund");
  };

  const next = () => {
    if (screen === "invite") setToast("Quote request sent to 2 selected factories");
    if (screen === "quoteDetail") setSelectedQuote("Atelier Minho");
    if (screen === "fund") setToast(fundingMilestone ? `${fundingMilestone.title} funded` : "Sample payment funded");
    goTo(screenOrder[Math.min(index + 1, screenOrder.length - 1)]);
  };

  const back = () => goTo(screenOrder[Math.max(index - 1, 0)]);

  const content = useMemo(() => {
    const props = {
      selectedFactories,
      setSelectedFactories,
      selectedQuote,
      setSelectedQuote,
      selectedQuotesForCompare,
      setSelectedQuotesForCompare,
      quoteCompareOpen,
      setQuoteCompareOpen,
      setSelectedReorderProject,
      milestoneTypes,
      setMilestoneTypes,
      goTo
    };

    switch (screen) {
      case "home":
        return <HomeScreen goTo={goTo} onOpenActivity={() => setActivityDrawerOpen(true)} />;
      case "profile":
        return <BrandProfileScreen onViewCompletion={() => goTo("profileCompletion")} />;
      case "profileCompletion":
        return <BrandProfileCompletionPage onBack={() => goTo("profile")} onAddPayment={() => goTo("profile")} />;
      case "factorySearch":
        return <FactorySearchScreen goTo={goTo} />;
      case "factoryMarketplace":
        return <FactoryMarketplaceScreen goTo={goTo} />;
      case "rfqs":
        return <RfqsScreen goTo={goTo} />;
      case "projects":
        return <ProjectsScreen goTo={goTo} setSelectedReorderProject={setSelectedReorderProject} />;
      case "projectDetail":
        return <ProjectDetailScreen goTo={goTo} goToFundingMilestone={goToFundingMilestone} />;
      case "messages":
        return <MessagesScreen />;
      case "saved":
        return <SavedFactoriesScreen goTo={goTo} />;
      case "billing":
        return <BillingScreen accountType="brand" />;
      case "settings":
        return <SettingsScreen accountType="brand" />;
      case "describe":
        return <DescribeScreen onContinue={next} />;
      case "review":
        return <ReviewScreen />;
      case "invite":
        return <InviteScreen {...props} />;
      case "inviteSuccess":
        return <InviteSuccessScreen goTo={goTo} selectedFactories={selectedFactories} />;
      case "quotes":
        return <QuotesScreen {...props} />;
      case "quoteDetail":
        return <QuoteDetailScreen selectedQuote={selectedQuote} goTo={goTo} setSelectedReorderProject={setSelectedReorderProject} />;
      case "contract":
        return <ContractScreen selectedQuote={selectedQuote} reorderProject={selectedReorderProject} />;
      case "payment":
        return <PaymentScreen />;
      case "milestones":
        return <MilestonesScreen milestoneTypes={milestoneTypes} setMilestoneTypes={setMilestoneTypes} />;
      case "fund":
        return <FundScreen fundingMilestone={fundingMilestone} goTo={goTo} setFundingMilestone={setFundingMilestone} />;
      case "success":
        return <SuccessScreen goTo={goTo} />;
      default:
        return null;
    }
  }, [screen, selectedFactories, selectedQuote, selectedQuotesForCompare, quoteCompareOpen, selectedReorderProject, milestoneTypes]);

  if (screen === "brandOnboarding") {
    return (
      <BrandOnboarding
        step={brandOnboardingStep}
        onBack={() => setBrandOnboardingStep((value) => Math.max(0, value - 1))}
        onNext={() => {
          if (brandOnboardingStep >= brandOnboardingSteps.length - 1) {
            goTo("home");
          } else {
            setBrandOnboardingStep((value) => value + 1);
          }
        }}
      />
    );
  }

  return (
    <div className={sidebarCollapsed ? "app-shell nav-collapsed" : "app-shell"}>
      <SideNav
        active={screen === "home" ? "Dashboard" : screen === "factorySearch" || screen === "factoryMarketplace" ? "Browse factories" : screen === "profile" || screen === "profileCompletion" ? "" : screen === "projects" || screen === "projectDetail" ? "Production orders" : screen === "messages" ? "Conversations" : screen === "saved" ? "Saved" : screen === "billing" ? "Payments" : screen === "settings" ? "Settings" : screen === "rfqs" ? "Quotes" : "Quotes"}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onNav={(label) => {
          if (label === "Dashboard") goTo("home");
          if (label === "Quotes") goTo("rfqs");
          if (label === "Production orders") goTo("projects");
          if (label === "Browse factories") goTo("factoryMarketplace");
          if (label === "Conversations") goTo("messages");
          if (label === "Saved") goTo("saved");
          if (label === "Payments") goTo("billing");
          if (label === "Settings") goTo("settings");
        }}
        onProfile={() => goTo("profile")}
      />
      <main key={screen} className={screen === "profileCompletion" ? "profile-completion-shell" : screen === "messages" ? "messages-page" : screen === "settings" ? "settings-page-shell" : screen === "billing" ? "billing-page-shell" : screen === "factorySearch" || screen === "factoryMarketplace" ? "directory-page" : screen === "rfqs" ? "rfqs-page brand-rfqs-page" : screen === "projects" || screen === "projectDetail" || screen === "saved" ? "rfqs-page" : isStandalone ? "home-page" : isWideFlow ? "flow-page wide-flow" : screen === "describe" ? "flow-page describe-flow" : screen === "review" ? "flow-page review-flow" : screen === "payment" ? "flow-page quote-action-flow trade-flow" : ["contract", "milestones"].includes(screen) ? "flow-page quote-action-flow" : "flow-page"}>
        {!isStandalone && <JourneyRail current={activeMeta.step} isMilestoneFunding={Boolean(fundingMilestone)} />}
        <section className="flow-content">
          {!isStandalone && screen !== "quoteDetail" && (
            <header className="flow-header">
              {screen === "fund" && fundingMilestone ? (
                <button
                  className="project-back-link funding-header-link"
                  type="button"
                  onClick={() => {
                    setFundingMilestone(null);
                    goTo("projectDetail");
                  }}
                >
                  ‹ Back to production detail
                </button>
              ) : (
                <p className="eyebrow">FACTORY QUOTE REQUEST</p>
              )}
              <h1>{activeMeta.title}</h1>
              <p>
                {activeMeta.description ||
                  "Move this quote request forward with the next project detail."}
              </p>
            </header>
          )}
          <div className="screen-transition" key={transitionKey}>
            {content}
          </div>
        </section>
        {!isStandalone && <RightRail screen={screen} selectedQuote={selectedQuote} fundingMilestone={fundingMilestone} />}
      </main>
      {!isStandalone && screen !== "describe" && (
        <BottomBar
          canBack={index > 0}
          onBack={back}
          onNext={screen === "success" ? () => goTo("describe") : screen === "inviteSuccess" ? () => goTo("quotes") : next}
          primaryLabel={screen === "quotes" || screen === "success" ? "" : activeMeta.cta}
          centerText={screen === "invite" ? `${selectedFactories.length} factories selected · 5 recommended` : ""}
          secondaryLabel={screen === "invite" ? "Save draft" : ""}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast("")} />}
      {activityDrawerOpen && <ActivityDrawer onClose={() => setActivityDrawerOpen(false)} />}
    </div>
  );
}

function SideNav({ active, collapsed, onToggle, onNav, onProfile }) {
  const nav = [
    { label: "Dashboard", icon: "home" },
    { label: "Quotes", icon: "rfq" },
    { label: "Production orders", icon: "projects" },
    { label: "Browse factories", icon: "explore" },
    { label: "Conversations", icon: "messages" },
    { label: "Saved", icon: "bookmarks" },
    { label: "Payments", icon: "billing" },
    { label: "Settings", icon: "settings" }
  ];

  return (
    <aside className={collapsed ? "side-nav collapsed" : "side-nav"}>
      <button className="collapse-toggle" type="button" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        <img src={`/assets/prototype-icons/${collapsed ? "expand" : "collapse"}.svg`} alt="" />
      </button>
      {!collapsed && <img src="/assets/logo.svg" alt="The Sourcing Club" className="side-logo" />}
      <button className={collapsed ? "account-card collapsed-account" : "account-card"} type="button" onClick={onProfile}>
        <span>MR</span>
        <div>
          <strong>Maison Rue</strong>
          <small>Brand account</small>
        </div>
      </button>
      <nav>
        {nav.map((item, index) => (
          <React.Fragment key={item.label}>
            {(index === 3 || index === 6) && <span className="nav-divider" />}
            <button
              className={item.label === active ? "active" : ""}
              type="button"
              onClick={() => onNav?.(item.label)}
              title={collapsed ? item.label : undefined}
            >
              <img className="nav-icon" src={`/assets/prototype-icons/${item.icon}.svg`} alt="" />
              <span className="nav-label">{item.label}</span>
            </button>
          </React.Fragment>
        ))}
      </nav>
    </aside>
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

function CloseIconButton({ label }) {
  return (
    <button type="button" aria-label={label}>
      <img src="/assets/prototype-icons/close.svg" alt="" />
    </button>
  );
}

function BillingScreen({ accountType = "brand" }) {
  const isFactory = accountType === "factory";
  const [tab, setTab] = useState(isFactory ? "earnings" : "payments");
  const defaultFilter = isFactory ? "All clients" : "All factories";
  const [client, setClient] = useState(defaultFilter);
  const allRows = isFactory ? factoryBillingHistory[tab] : tab === "discounts" ? [] : brandBillingHistory;
  const clients = [defaultFilter, ...Array.from(new Set(allRows.map((row) => row.client)))];
  const selectedClient = clients.includes(client) ? client : defaultFilter;
  const rows = selectedClient === defaultFilter ? allRows : allRows.filter((row) => row.client === selectedClient);
  const total = rows.reduce((sum, row) => sum + Number(row.amount.replace(/[$,]/g, "")), 0);
  const formattedTotal = `$${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const brandSummaryMetrics = [
    ["total paid", formattedTotal],
    ["funded", "$120.00"],
    ["remaining", "$5,660.00"],
    ["next payment", "$1,656.00", "highlight"]
  ];

  return (
    <section className="billing-history-page">
      <header className="billing-history-header">
        <div>
          <p>{isFactory ? "Factory payments" : "Brand payments"}</p>
          <h1>Payments</h1>
        </div>
      </header>
      <div className="billing-controls">
        {isFactory && (
          <div className="settings-access-tabs billing-tabs" role="tablist" aria-label="Billing history type">
            <button className={tab === "earnings" ? "active" : ""} type="button" role="tab" aria-selected={tab === "earnings"} onClick={() => setTab("earnings")}>Earnings</button>
            <button className={tab === "payments" ? "active" : ""} type="button" role="tab" aria-selected={tab === "payments"} onClick={() => setTab("payments")}>Payments</button>
          </div>
        )}
        {!isFactory && (
          <div className="settings-access-tabs billing-tabs" role="tablist" aria-label="Brand payment type">
            <button className={tab === "payments" ? "active" : ""} type="button" role="tab" aria-selected={tab === "payments"} onClick={() => setTab("payments")}>Payments</button>
            <button className={tab === "discounts" ? "active" : ""} type="button" role="tab" aria-selected={tab === "discounts"} onClick={() => setTab("discounts")}>Discounts</button>
          </div>
        )}
        {(isFactory || tab === "payments") && (
          <label>
            <span>{isFactory && tab === "payments" ? "Filter by source" : isFactory ? "Filter by client" : "Filter by factory"}</span>
            <select value={selectedClient} onChange={(event) => setClient(event.target.value)}>
              {clients.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        )}
        {!isFactory && tab === "discounts" && (
          <label className="billing-filter-placeholder" aria-hidden="true">
            <span>Filter by factory</span>
            <select tabIndex={-1} value="All factories" readOnly>
              <option>All factories</option>
            </select>
          </label>
        )}
      </div>
      {!isFactory && tab === "payments" && (
        <div className="project-summary-strip billing-payment-strip" aria-label="Billing payment summary">
          {brandSummaryMetrics.map(([label, value, tone]) => (
            <Metric label={label} value={value} className={tone || ""} key={label} />
          ))}
        </div>
      )}
      {!isFactory && tab === "discounts" && (
        <section className="brand-discounts-tab">
          <section className="brand-discount-summary-card">
            <div>
              <span>Available discount</span>
              <strong>$50</strong>
            </div>
            <p>For eligible orders. Invite a brand to earn another $50 discount.</p>
          </section>
          <header>
            <h2>Discount codes</h2>
            <p>Use an unused code at payment. Used codes stay here so finance can track order discounts.</p>
          </header>
          <div className="brand-discount-code-list">
            {brandDiscountCodes.map((item) => (
              <article className={item.status === "Used" ? "brand-discount-code-row used" : "brand-discount-code-row"} key={item.code}>
                <div>
                  <span>{item.source}</span>
                  <strong>{item.code}</strong>
                  {item.usedOn && <p>Used on {item.usedOn}</p>}
                  {item.status === "Unused" && <button className="brand-copy-code-btn" type="button">Copy code</button>}
                </div>
                <div>
                  <b>{item.value}</b>
                  <em>{item.status}</em>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {isFactory && (
        <div className="billing-summary-grid">
          <div>
            <span>{tab === "earnings" ? "Total received" : "Total paid"}</span>
            <strong>{formattedTotal}</strong>
          </div>
          <div>
            <span>Latest activity</span>
            <strong>{rows[0]?.status || "Received"}</strong>
          </div>
          <div>
            <span>Records</span>
            <strong>{rows.length}</strong>
          </div>
        </div>
      )}
      {(isFactory || tab === "payments") && (
        <div className="billing-history-list">
          {rows.map((row) => (
            <article className="billing-history-row" key={`${row.title}-${row.meta}`}>
              <div>
                <strong>{row.title}</strong>
                <span>{row.client} - {row.meta}</span>
              </div>
              <span className="billing-status">{row.status}</span>
              <strong>{row.amount}</strong>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MessagesScreen() {
  const [activeThreadId, setActiveThreadId] = useState(messageThreads[0].id);
  const [composer, setComposer] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [callMode, setCallMode] = useState("idle");
  const [translatedMessages, setTranslatedMessages] = useState({});
  const [scheduledCalls, setScheduledCalls] = useState({
    atelier: {
      title: "Sample review call",
      brandTime: "Tue 10:00 AM ET",
      factoryTime: "Atelier Minho: Tue 3:00 PM",
      agenda: "Review sample photos and confirm sleeve measurement update.",
      hasVideo: true
    }
  });
  const activeThread = messageThreads.find((thread) => thread.id === activeThreadId) || messageThreads[0];
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
    <div className="messages-shell">
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
          {messageThreads.map((thread) => (
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
              <h2>{activeThread.name}</h2>
              <p>{activeThread.localTime} · {activeThread.project}</p>
            </div>
          </div>
          <div className="message-room-actions">
            <button className="secondary-btn compact-btn" type="button" onClick={() => setShowSchedule(true)}>Schedule call</button>
            <button className="primary-btn compact-btn" type="button" onClick={() => setCallMode("preview")}>Live video chat</button>
          </div>
        </header>

        {callMode !== "idle" && (
          <VideoCallPanel thread={activeThread} mode={callMode} setMode={setCallMode} />
        )}

        <div className="message-timeline">
          {activeThread.messages.map((message, index) => {
            const translationKey = `${activeThread.id}-${index}`;
            const showTranslation = Boolean(translatedMessages[translationKey]);
            return (
              <MessageBubble
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
            placeholder={`Message ${activeThread.name}...`}
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
        {activeScheduledCall && <UpcomingCallCard call={activeScheduledCall} thread={activeThread} />}
      </aside>
      {showSchedule && createPortal((
        <div className="message-schedule-modal-layer" role="presentation">
          <button className="message-schedule-modal-scrim" type="button" aria-label="Close schedule call" onClick={() => setShowSchedule(false)} />
          <div className="message-schedule-modal" role="dialog" aria-label="Schedule call">
            <button className="settings-drawer-close" type="button" aria-label="Close schedule call" onClick={() => setShowSchedule(false)}>
              <img src="/assets/prototype-icons/close.svg" alt="" />
            </button>
            <ScheduleCallPanel
              key={activeThread.id}
              thread={activeThread}
              isOpen
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

function MessageBubble({ message, showTranslation, onToggleTranslation }) {
  const isBrand = message.from === "brand";
  const hasTranslation = Boolean(message.translation);

  return (
    <article className={isBrand ? "message-bubble own" : "message-bubble"}>
      <div>
        <span>{isBrand ? "Maison Rue" : "Factory"}</span>
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

function VideoCallPanel({ thread, mode, setMode }) {
  const inCall = mode === "active";

  return (
    <section className={inCall ? "video-call-panel active" : "video-call-panel"}>
      <div className="video-call-stage">
        <span className="message-avatar xl">{thread.initials}</span>
        <div>
          <h3>{inCall ? `Live with ${thread.name}` : `Ready to call ${thread.name}`}</h3>
          <p>{inCall ? "Video preview · screen share available · call notes stay in this thread" : "Start a prototype call room. This is not connected to a live video provider yet."}</p>
        </div>
      </div>
      <div className="video-call-controls">
        <button type="button" aria-label="Toggle camera">▣</button>
        <button type="button" aria-label="Toggle microphone">◉</button>
        <button type="button" aria-label="Share screen">⇧</button>
        <button className={inCall ? "danger" : ""} type="button" onClick={() => setMode(inCall ? "idle" : "active")}>{inCall ? "End call" : "Start call"}</button>
      </div>
    </section>
  );
}

function UpcomingCallCard({ call, thread }) {
  return (
    <section className="upcoming-call-card">
      <div className="upcoming-call-label">Scheduled call</div>
      <h3>{call.title}</h3>
      <div className="upcoming-call-time">
        <strong>{call.brandTime}</strong>
        <span>{call.factoryTime}</span>
      </div>
      <p>{call.agenda}</p>
      <div className="upcoming-call-actions">
        {call.hasVideo && <span>Video link added</span>}
        <button className="secondary-btn compact-btn" type="button">Join call</button>
      </div>
    </section>
  );
}

function ScheduleCallPanel({ thread, isOpen, onOpen, onSchedule }) {
  const timeSlots = thread.scheduleSlots || [
    { brand: "Tue 10:00 AM ET", factory: `${thread.name}: local time shown after invite` },
    { brand: "Tue 12:30 PM ET", factory: `${thread.name}: local time shown after invite` },
    { brand: "Wed 9:30 AM ET", factory: `${thread.name}: local time shown after invite` }
  ];
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [callTitle, setCallTitle] = useState("Sample review call");
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
              <button className={index === selectedSlotIndex ? "selected" : ""} type="button" onClick={() => setSelectedSlotIndex(index)} key={slot.brand}>
                <strong>{slot.brand}</strong>
                <span>{slot.factory}</span>
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
                brandTime: selectedSlot.brand,
                factoryTime: selectedSlot.factory,
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

const settingsPermissionLabels = [
  { key: "rfqFlow", label: "Quote flow", detail: "Create quote request, choose quote, set terms and milestones", single: true },
  { key: "approve", label: "Approve samples", detail: "Lab dip, strike-off, sample, and more" },
  { key: "releaseFunds", label: "Release funds", detail: "Release approved payments from project funds" },
  { key: "primaryContact", label: "Primary contact", detail: "Main factory contact for messages and calls", single: true },
  { key: "settingsAccess", label: "Settings access", detail: "Account, payments, and invites" }
];

const factoryAccountPermissionLabels = [
  { key: "rfqFlow", label: "Quote flow", detail: "Give quotes and submit quote details", single: true },
  { key: "addUpdate", label: "Add update", detail: "Post production updates and files" },
  { key: "primaryContact", label: "Primary contact", detail: "Main contact for messages and calls", single: true },
  { key: "settingsAccess", label: "Settings access", detail: "Account, payments, and invites" }
];

const brandBillingHistory = [
  { title: "Initial deposit", client: "Atelier Minho", meta: "Organic cotton woven shirt - Jul 18, 2026", status: "Paid", amount: "$1,840.00" },
  { title: "Sample milestone", client: "Atelier Minho", meta: "Atelier Minho - Jul 29, 2026", status: "Paid", amount: "$620.00" },
  { title: "Platform service fee", client: "The Sourcing Club", meta: "Monthly billing - Aug 1, 2026", status: "Paid", amount: "$79.00" }
];

const factoryBillingHistory = {
  earnings: [
    { title: "Sample milestone released", client: "Maison Rue", meta: "Maison Rue - Jul 29, 2026", status: "Received", amount: "$620.00" },
    { title: "Production deposit released", client: "Maison Rue", meta: "Maison Rue - Jul 18, 2026", status: "Received", amount: "$1,840.00" },
    { title: "Fit sample update", client: "Northline Studio", meta: "Northline Studio - Jul 10, 2026", status: "Received", amount: "$410.00" }
  ],
  payments: [
    { title: "Platform service fee", client: "The Sourcing Club", meta: "Monthly billing - Aug 1, 2026", status: "Paid", amount: "$49.00" },
    { title: "Verified profile review", client: "The Sourcing Club", meta: "Account service - Jul 12, 2026", status: "Paid", amount: "$95.00" }
  ]
};

function SettingsScreen({ accountType = "brand" }) {
  const isFactory = accountType === "factory";
  const [activeSection, setActiveSection] = useState("account");
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInvitePanelOpen, setIsInvitePanelOpen] = useState(false);
  const [stakeholderTab, setStakeholderTab] = useState("members");
  const [paymentTab, setPaymentTab] = useState("earnings");
  const [team, setTeam] = useState(
    isFactory
      ? [
          { name: "Ines Carvalho", email: "ines@atelierminho.pt", role: "Owner", permissions: ["rfqFlow", "addUpdate", "primaryContact", "settingsAccess"] },
          { name: "Mateo Silva", email: "mateo@atelierminho.pt", role: "Production lead", permissions: ["addUpdate"] },
          { name: "Sofia Ramos", email: "sofia@atelierminho.pt", role: "Finance", permissions: [] }
        ]
      : [
          { name: "Ari Chen", email: "ari@maisonrue.com", role: "Founder", permissions: ["rfqFlow", "approve", "primaryContact", "settingsAccess"] },
          { name: "Maya Lee", email: "maya@maisonrue.com", role: "Production lead", permissions: ["approve"] },
          { name: "Jon Bell", email: "jon@maisonrue.com", role: "Finance", permissions: ["releaseFunds"] }
        ]
  );
  const account = isFactory
    ? {
        name: "Atelier Minho",
        email: "ops@atelierminho.pt",
        phone: "+351 22 000 1842",
        location: "Porto, Portugal",
        payment: "Wise business ending in 9021",
        backup: "Visa ending in 4412",
        earningsPrimary: "Wise business ending in 9021",
        earningsSecondary: "Bank account ending in 1184",
        billingPrimary: "Visa ending in 4412",
        billingSecondary: "Mastercard ending in 8840"
      }
    : {
        name: "Maison Rue",
        email: "studio@maisonrue.com",
        phone: "+1 212 555 0188",
        location: "New York, USA",
        payment: "American Express ending in 1021",
        backup: "ACH ending in 7782"
      };
  const factoryPaymentMethods = {
    earnings: [
      { label: "Primary", name: account.earningsPrimary, note: "Receives released milestone funds from brand orders." },
      { label: "Secondary", name: account.earningsSecondary, note: "Backup account for receiving earnings." }
    ],
    billing: [
      { label: "Primary", name: account.billingPrimary, note: "Used to pay platform fees, services, or billing charges." },
      { label: "Secondary", name: account.billingSecondary, note: "Backup method for billing charges." }
    ]
  };
  const pendingInvites = isFactory
    ? [
        { email: "quality@atelierminho.pt", role: "Production lead", sent: "Sent today" },
        { email: "finance@atelierminho.pt", role: "Finance", sent: "Sent yesterday" }
      ]
    : [
        { email: "lena@maisonrue.com", role: "Stakeholder", sent: "Sent today" },
        { email: "ops@maisonrue.com", role: "View only", sent: "Sent yesterday" }
      ];
  const activePermissionLabels = isFactory ? factoryAccountPermissionLabels : settingsPermissionLabels;

  const togglePermission = (memberEmail, permission) => {
    const permissionMeta = activePermissionLabels.find((item) => item.key === permission);
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
    ["team", "Roles & access"],
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
    <div className={isFactory ? "settings-page factory-settings-page" : "settings-page brand-settings-page"}>
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
            <p>{isFactory ? "Factory account" : "Brand account"}</p>
            <h2>Account settings</h2>
          </div>
          <button className="primary-btn" type="button">Save changes</button>
        </header>

        <section className="settings-section" id="settings-account">
              <div className="settings-section-header">
                <h3>Basic information</h3>
                <p>Edit the details other teams use for orders, calls, and account verification.</p>
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
                <p>Update login access and keep payment or approval actions protected.</p>
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
              <h3>{isFactory ? "Payment methods" : "Payment method"}</h3>
              <p>{isFactory ? "Manage where you receive earnings and which method is used for billing." : "Add, update, or remove the payment methods used for production milestones."}</p>
            </div>
            {isFactory ? (
              <>
                <div className="settings-access-tabs settings-payment-tabs" role="tablist" aria-label="Payment method type">
                  <button
                    className={paymentTab === "earnings" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={paymentTab === "earnings"}
                    onClick={() => setPaymentTab("earnings")}
                  >
                    Earnings
                  </button>
                  <button
                    className={paymentTab === "billing" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={paymentTab === "billing"}
                    onClick={() => setPaymentTab("billing")}
                  >
                    Billing
                  </button>
                </div>
                {factoryPaymentMethods[paymentTab].map((method) => (
                  <div className="settings-payment-list" key={`${paymentTab}-${method.label}`}>
                    <div>
                      <span className="settings-card-brand">{method.label}</span>
                      <strong>{method.name}</strong>
                      <small>{method.note}</small>
                    </div>
                    <button className="settings-menu-btn" type="button" aria-label={`More options for ${method.name}`} />
                  </div>
                ))}
              </>
            ) : (
              <>
                <div className="settings-payment-list">
                  <div>
                    <span className="settings-card-brand">Primary</span>
                    <strong>{account.payment}</strong>
                    <small>Used for deposits and milestone funding</small>
                  </div>
                  <button className="settings-menu-btn" type="button" aria-label={`More options for ${account.payment}`} />
                </div>
                <div className="settings-payment-list">
                  <div>
                    <span className="settings-card-brand">Backup</span>
                    <strong>{account.backup}</strong>
                    <small>Helps avoid payment interruptions.</small>
                  </div>
                  <button className="settings-menu-btn" type="button" aria-label={`More options for ${account.backup}`} />
                </div>
              </>
            )}
            <button className="settings-add-btn" type="button">+ Add payment method</button>
          </section>

        <section className="settings-section" id="settings-team">
            <div className="settings-section-header split">
              <div>
                <h3>{isFactory ? "Manage team & stakeholders" : "Stakeholder authority"}</h3>
                <p>{isFactory ? "Control who can quote requests, post updates, and act as the primary contact." : "Assign quote flow, sample approvals, fund release, and the primary factory contact."}</p>
              </div>
              <button className="primary-btn compact-btn" type="button" onClick={() => setIsInvitePanelOpen(true)}>Invite member</button>
            </div>

            <div className="settings-access-tabs" role="tablist" aria-label="Stakeholder list">
              <button
                className={stakeholderTab === "members" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={stakeholderTab === "members"}
                onClick={() => setStakeholderTab("members")}
              >
                Members
              </button>
              <button
                className={stakeholderTab === "invited" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={stakeholderTab === "invited"}
                onClick={() => setStakeholderTab("invited")}
              >
                Invited
              </button>
            </div>

            {stakeholderTab === "members" ? (
              <div className="settings-permission-table" role="table" aria-label="Stakeholder authority">
                <div className="settings-permission-row header" role="row">
                  <span>Member</span>
                  {activePermissionLabels.map((permission) => (
                    <span key={permission.key}>
                      {permission.label}
                      {permission.detail && <small>{permission.detail}</small>}
                    </span>
                  ))}
                  <span aria-hidden="true" />
                </div>
                {team.map((member) => (
                  <div className="settings-permission-row" role="row" key={member.email}>
                    <div>
                      <strong>{member.name}</strong>
                      <small>{member.role} - {member.email}</small>
                    </div>
                    {activePermissionLabels.map((permission) => (
                      <label className="settings-check" key={permission.key}>
                        <input
                          type="checkbox"
                          checked={member.permissions.includes(permission.key)}
                          onChange={() => togglePermission(member.email, permission.key)}
                        />
                        <span>{permission.label}</span>
                      </label>
                    ))}
                    <button className="settings-remove-member-btn" type="button" aria-label={`Remove ${member.name}`} onClick={() => removeMember(member.email)}>
                      <img src="/assets/prototype-icons/trash.svg" alt="" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="settings-invited-table" role="table" aria-label="Pending stakeholder invites">
                <div className="settings-invited-row header" role="row">
                  <span>Email</span>
                  <span>Role</span>
                  <span>Status</span>
                  <span>Action</span>
                </div>
                {pendingInvites.map((invite) => (
                  <div className="settings-invited-row" role="row" key={invite.email}>
                    <strong>{invite.email}</strong>
                    <span>{invite.role}</span>
                    <small>{invite.sent}</small>
                    <button className="secondary-btn compact-btn" type="button">Resend</button>
                  </div>
                ))}
              </div>
            )}
          </section>

        {isInvitePanelOpen && createPortal((
          <div className="settings-drawer-layer" role="presentation">
            <button className="settings-drawer-scrim" type="button" aria-label="Close invite panel" onClick={() => setIsInvitePanelOpen(false)} />
            <aside className="settings-drawer" aria-label="Invite stakeholder">
              <header>
                <div>
                  <h3>Invite member</h3>
                  <p>Add their details and choose what they can manage.</p>
                </div>
                <button className="settings-drawer-close" type="button" aria-label="Close invite panel" onClick={() => setIsInvitePanelOpen(false)}>
                  <img src="/assets/prototype-icons/close.svg" alt="" />
                </button>
              </header>
              <div className="settings-drawer-form">
                <label>
                  <span>Name</span>
                  <input placeholder="Full name" />
                </label>
                <label>
                  <span>Email</span>
                  <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@company.com" type="email" />
                </label>
                <label>
                  <span>Role</span>
                  <select defaultValue="Stakeholder">
                    <option>Stakeholder</option>
                    <option>Founder</option>
                    <option>Production lead</option>
                    <option>Finance</option>
                    <option>View only</option>
                  </select>
                </label>
                <fieldset className="settings-drawer-authority">
                  <legend>Authority</legend>
                  {activePermissionLabels.map((permission) => (
                    <label key={permission.key}>
                      <input type="checkbox" defaultChecked={permission.key === (isFactory ? "addUpdate" : "approve")} />
                      <span>
                        <strong>{permission.label}</strong>
                        {permission.detail && <small>{permission.detail}</small>}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </div>
              <footer>
                <button className="secondary-btn" type="button" onClick={() => setIsInvitePanelOpen(false)}>Cancel</button>
                <button className="primary-btn" type="button" onClick={() => setIsInvitePanelOpen(false)}>Send invite</button>
              </footer>
            </aside>
          </div>
        ), document.body)}

        <section className="settings-section" id="settings-notifications">
            <div className="settings-section-header">
              <h3>Notifications</h3>
              <p>Choose which updates should reach your team by email.</p>
            </div>
            {["New quote activity", "Payment and approval requests", "Messages and call invites"].map((label) => (
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

function BrandOnboarding({ step, onBack, onNext }) {
  const current = brandOnboardingSteps[step];
  const isFirst = step === 0;
  const isLast = step === brandOnboardingSteps.length - 1;

  return (
    <main className="brand-onboarding-page">
      <header className="brand-onboarding-topbar">
        <img src="/assets/logo.svg" alt="The Sourcing Club" />
        <span>Step {step + 1} of {brandOnboardingSteps.length}</span>
      </header>

      <section className={`brand-onboarding-card ${current.type}`} aria-label={current.title}>
        {current.type !== "complete" && (
          <header className="brand-onboarding-card-header">
            {isFirst && <img className="brand-onboarding-label" src="/assets/onboarding-sourcing-club-label-clean.png" alt="" />}
            <h1>{current.title}</h1>
            {current.intro && <p>{current.intro}</p>}
          </header>
        )}

        <BrandOnboardingStep
          content={current}
          step={step}
          onEditSection={(targetStep) => {
            setBrandOnboardingStep(targetStep);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />

        <footer className="brand-onboarding-actions">
          {!isFirst && !isLast && <button className="secondary-btn" type="button" onClick={onBack}>Previous</button>}
          <button className="primary-btn" type="button" onClick={onNext}>{current.cta || "Next"}</button>
        </footer>
      </section>

      <div className="brand-onboarding-progress" aria-label="Onboarding progress">
        {brandOnboardingSteps.map((item, index) => (
          <span className={index === step ? "current" : index < step ? "complete" : ""} key={item.title} />
        ))}
      </div>
    </main>
  );
}

function BrandOnboardingStep({ content, step, onEditSection }) {
  const [onboardingStakeholders, setOnboardingStakeholders] = useState([
    { name: "Ari Chen", email: "ari@maisonrue.com", role: "Founder" },
    { name: "Maya Lee", email: "maya@maisonrue.com", role: "Production lead" }
  ]);
  const [stakeholderModalOpen, setStakeholderModalOpen] = useState(false);
  const [stakeholderDraft, setStakeholderDraft] = useState({ name: "", email: "", role: "Stakeholder" });

  function updateStakeholderDraft(key, value) {
    setStakeholderDraft((current) => ({ ...current, [key]: value }));
  }

  function addOnboardingStakeholder() {
    const nextStakeholder = {
      name: stakeholderDraft.name.trim(),
      email: stakeholderDraft.email.trim(),
      role: stakeholderDraft.role.trim() || "Stakeholder"
    };
    if (!nextStakeholder.name && !nextStakeholder.email) return;
    setOnboardingStakeholders((current) => [...current, nextStakeholder]);
    setStakeholderDraft({ name: "", email: "", role: "Stakeholder" });
    setStakeholderModalOpen(false);
  }

  function removeOnboardingStakeholder(index) {
    setOnboardingStakeholders((current) => current.filter((_, stakeholderIndex) => stakeholderIndex !== index));
  }

  if (content.type === "welcome") {
    return (
      <div className="brand-welcome-meta">
        <p className="brand-onboarding-time">{content.meta}</p>
      </div>
    );
  }

  if (content.type === "fields") {
    return (
      <div className="brand-onboarding-form-grid">
        {content.fields.map(([label, placeholder, type]) => (
          <label className="brand-onboarding-field" key={label}>
            <span>{label}</span>
            {type === "select" ? (
              <select defaultValue="">
                <option value="" disabled />
                <option>Fashion brand</option>
                <option>Retailer</option>
                <option>Emerging designer</option>
                <option>Private label</option>
              </select>
            ) : (
              <input placeholder={placeholder} />
            )}
          </label>
        ))}
      </div>
    );
  }

  if (content.type === "chips") {
    return (
      <div className="brand-onboarding-chip-stack">
        {content.groups.map(([label, options, selected]) => (
          <BrandOnboardingChipGroup label={label} options={options} selected={selected} key={label} />
        ))}
      </div>
    );
  }

  if (content.type === "sourcingPlan") {
    return (
      <div className="brand-onboarding-form-grid brand-sourcing-volume-grid">
        {content.fields.map(([label, optionsOrPlaceholder, defaultValue]) => (
          <label className="brand-onboarding-field" key={label}>
            <span>{label}</span>
            {Array.isArray(optionsOrPlaceholder) ? (
              <select defaultValue={defaultValue || ""}>
                <option value="" disabled />
                {optionsOrPlaceholder.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input placeholder={optionsOrPlaceholder} />
            )}
          </label>
        ))}
      </div>
    );
  }

  if (content.type === "brandContext") {
    return (
      <div className="brand-context-step">
        <label className="brand-onboarding-field full">
          <span>About the brand</span>
          <textarea placeholder="A short overview of your aesthetic, customer, positioning, and what factories should understand about the brand." />
        </label>

        <div className="brand-context-upload-grid">
          <BrandAssetUploadCard className="wide" title="Logo" helper="Upload your logo, wordmark, or icon mark." accept="SVG, PNG, or JPG" />
          <BrandAssetUploadCard className="wide" title="Product or production images" helper="Upload product references, production examples, construction details, material direction, or finished pieces you want factories to understand." accept="PNG, JPG, or PDF" />
        </div>
      </div>
    );
  }

  if (content.type === "assets") {
    return (
      <div className="brand-assets-step">
        <BrandAssetUploadCard title="Logo" helper="Upload your logo, wordmark, or icon mark." accept="SVG, PNG, or JPG" />
        <BrandAssetUploadCard title="Product photos" helper="Upload current styles or reference products factories should understand." accept="3-6 images recommended" />
        <BrandAssetUploadCard title="Brand direction" helper="Upload a lookbook, moodboard, range plan, or line sheet." accept="PDF, PNG, JPG, or deck" />
      </div>
    );
  }

  if (content.type === "trust") {
    return (
      <div className="brand-trust-step">
        <label className="brand-onboarding-field full">
          <span>Annual revenue</span>
          <select defaultValue="">
            <option value="" disabled />
            <option>Under $250k</option>
            <option>$250k-$1M</option>
            <option>$1M-$5M</option>
            <option>$5M+</option>
          </select>
          <small>Self-reported. Not shown publicly.</small>
        </label>

        <section className="brand-trust-group brand-onboarding-stakeholders">
          <div className="brand-onboarding-stakeholder-heading">
            <strong>Decision makers</strong>
            <button className="secondary-btn compact-btn" type="button" onClick={() => setStakeholderModalOpen(true)}>+ Add stakeholder</button>
          </div>
          <div className="brand-onboarding-stakeholder-list">
            {onboardingStakeholders.map((stakeholder, index) => (
              <article className="brand-onboarding-stakeholder-card" key={`${stakeholder.email}-${index}`}>
                <span>{(stakeholder.name || "Stakeholder").slice(0, 2).toUpperCase()}</span>
                <div>
                  <strong>{stakeholder.name || "Stakeholder"}</strong>
                  <p>{stakeholder.role}{stakeholder.email ? ` · ${stakeholder.email}` : ""}</p>
                </div>
                <button className="text-link" type="button" onClick={() => removeOnboardingStakeholder(index)}>Remove</button>
              </article>
            ))}
          </div>
          <p>Founders or decision-makers. We use this to verify your team.</p>
        </section>

        {stakeholderModalOpen && createPortal(
          <div className="brand-profile-modal-layer brand-onboarding-stakeholder-modal-layer">
            <button className="brand-profile-modal-scrim" type="button" aria-label="Close add stakeholder" onClick={() => setStakeholderModalOpen(false)} />
            <section className="brand-profile-modal brand-onboarding-stakeholder-modal" role="dialog" aria-modal="true" aria-labelledby="brand-onboarding-stakeholder-title">
              <button className="brand-profile-modal-close" type="button" aria-label="Close" onClick={() => setStakeholderModalOpen(false)}>×</button>
              <header className="brand-profile-modal-header">
                <h1 id="brand-onboarding-stakeholder-title">Add stakeholder</h1>
                <p>Add one person factories should expect to work with.</p>
              </header>
              <div className="brand-profile-edit-stack">
                <BrandProfileEditField label="Name" value={stakeholderDraft.name} onChange={(value) => updateStakeholderDraft("name", value)} />
                <BrandProfileEditField label="Email" value={stakeholderDraft.email} onChange={(value) => updateStakeholderDraft("email", value)} />
                <BrandProfileEditField label="Role" value={stakeholderDraft.role} onChange={(value) => updateStakeholderDraft("role", value)} />
              </div>
              <footer className="brand-profile-modal-actions">
                <button className="secondary-btn" type="button" onClick={() => setStakeholderModalOpen(false)}>Cancel</button>
                <button className="primary-btn" type="button" onClick={addOnboardingStakeholder}>Add stakeholder</button>
              </footer>
            </section>
          </div>,
          document.body
        )}

        <label className="brand-onboarding-field full">
          <span>Business registration or resale certificate</span>
          <button className="brand-onboarding-upload-row" type="button">
            <img src="/assets/prototype-icons/upload.svg" alt="" />
            <strong>Click or drag files to upload</strong>
          </button>
        </label>
      </div>
    );
  }

  if (content.type === "review") {
    const sections = [
      { title: "Brand basics", step: 1, rows: [["Brand name", "Maison Rue"], ["Category", "Fashion brand"], ["Business email", "name@maisonrue.com"], ["Founded", "2021"], ["Website URL", "www.maisonrue.com"], ["HQ location", "New York, USA"]] },
      { title: "Brand context", step: 2, rows: [["About the brand", "Premium wardrobe staples with clean silhouettes and natural fibers"], ["Logo", "Uploaded"], ["Product images", "Reference images added"]] },
      { title: "Sourcing fit", step: 3, rows: [["Production type", "Cut & sew knits, wovens"], ["Product categories", "Tops, bottoms"], ["Market level", "Premium / contemporary ($100-$500)"]] },
      { title: "Sourcing volume", step: 4, rows: [["Annual order volume", "5,000-20,000 pieces"], ["Typical order per style", "300-1,000 pieces"], ["Collections per year", "3-4"], ["Typical price range for core styles", "$12-$28 FOB per unit"], ["Reorder cadence", "Quarterly reorders"], ["Current sourcing stage", "Sampling soon"]] },
      { title: "Factory preferences", step: 5, rows: [["Preferred regions", "Portugal, China, Korea"], ["Certifications", "GOTS, OEKO-TEX"], ["Services needed", "Full package, sample development"]] },
      { title: "Trust", step: 6, rows: [["Annual revenue", "$1M-$5M"], ["Decision makers", "Founder / production lead added"], ["Business certificate", "Registration or resale certificate uploaded"]] }
    ];

    return (
      <div className="brand-onboarding-review-grid">
        {sections.map(({ title, step: targetStep, rows }) => (
          <section key={title}>
            <div className="brand-onboarding-review-section-header">
              <h2>{title}</h2>
              <button
                className="brand-onboarding-review-edit"
                type="button"
                aria-label={`Edit ${title}`}
                onClick={() => onEditSection?.(targetStep)}
              >
                Edit
              </button>
            </div>
            <div className="brand-onboarding-review-rows">
              {rows.map(([label, value]) => (
                <div className="detail-pair" key={label}>
                  <strong>{label}</strong>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  if (content.type === "terms") {
    return (
      <div className="brand-terms-section">
        {content.terms.map(([term, description], index) => (
          <article key={term}>
            <h2>{index + 1}. {term}</h2>
            <p>{description}</p>
          </article>
        ))}
        <label className="brand-onboarding-check brand-terms-check">
          <input type="checkbox" defaultChecked />
          <span>{content.agreement}</span>
        </label>
        <label className="brand-onboarding-field full">
          <span>Signature</span>
          <input placeholder={content.signature} />
        </label>
      </div>
    );
  }

  return (
    <div className="brand-onboarding-complete">
      <img className="brand-onboarding-success-icon" src="/assets/prototype-icons/success.svg" alt="" />
      <h1>{content.title}</h1>
      <p>{content.intro}</p>
      <section className="brand-onboarding-discount-reward">
        <span>Welcome discount</span>
        <strong>$50 discount</strong>
        <p>Available for eligible orders. Invite another brand to earn another $50 discount.</p>
      </section>
    </div>
  );
}

function BrandOnboardingChipGroup({ label, options, selected = [] }) {
  const [selectedOptions, setSelectedOptions] = useState(selected);
  const [customValue, setCustomValue] = useState("");
  const [customOptions, setCustomOptions] = useState([]);
  const isSingleSelect = label === "Market level";
  const canAddCustom = ["Production type", "Product categories", "Certifications", "Services needed"].includes(label);
  const visibleOptions = [...options, ...customOptions];

  function toggleOption(option) {
    setSelectedOptions((current) => {
      if (isSingleSelect) return [option];
      return current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option];
    });
  }

  function addCustomOption(event) {
    event.preventDefault();
    const trimmedValue = customValue.trim();
    if (!trimmedValue || visibleOptions.includes(trimmedValue)) return;
    setCustomOptions((items) => [...items, trimmedValue]);
    setSelectedOptions((items) => [...items, trimmedValue]);
    setCustomValue("");
  }

  return (
    <section className="brand-onboarding-chip-group">
      <strong>{label}</strong>
      <div className="tag-row compact-tags">
        {visibleOptions.map((option) => (
          <button
            className={selectedOptions.includes(option) ? "selected" : ""}
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
        <form className="brand-onboarding-chip-add-row" onSubmit={addCustomOption}>
          <input value={customValue} onChange={(event) => setCustomValue(event.target.value)} placeholder="Add your own" />
          <button className="secondary-btn compact-btn" type="submit">Add</button>
        </form>
      )}
    </section>
  );
}

function BrandAssetUploadCard({ title, helper, accept, className = "" }) {
  return (
    <section className={className ? `brand-asset-card ${className}` : "brand-asset-card"}>
      <div>
        <strong>{title}</strong>
        <span>{helper}</span>
      </div>
      <button className="brand-onboarding-upload-row" type="button">
        <img src="/assets/prototype-icons/upload.svg" alt="" />
        <strong>Click or drag files to upload</strong>
      </button>
      <small>{accept}</small>
    </section>
  );
}

function JourneyRail({ current, isMilestoneFunding = false }) {
  const journeySteps = steps.map((step, index) =>
    index === steps.length - 1 && isMilestoneFunding
      ? { ...step, title: "Fund payment" }
      : step
  );

  return (
    <aside className="journey-rail">
      <p>QUOTE TO CONTRACT</p>
      {journeySteps.map((step, i) => (
        <div className="journey-step" key={step.title}>
          {i < journeySteps.length - 1 && <span className={i < current ? "rail-line complete" : "rail-line"} />}
          <span className={i < current ? "dot complete" : i === current ? "dot current" : "dot"}>
            {i < current ? "✓" : i + 1}
          </span>
          <div>
            <strong>{step.title}</strong>
            <small>{step.meta}</small>
          </div>
        </div>
      ))}
    </aside>
  );
}

function formatCurrency(value) {
  const amount = Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount)) return "$0.00";
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function calculateFundingSummary(milestone) {
  const subtotal = milestone?.amount || "$120";
  const fee = Number(String(subtotal).replace(/[^0-9.]/g, "")) * 0.03;
  const taxes = fee;
  const total = Number(String(subtotal).replace(/[^0-9.]/g, "")) + fee + taxes;
  return {
    paymentLabel: milestone ? milestone.title : "Sample order",
    subtotal: formatCurrency(subtotal),
    fee: formatCurrency(fee),
    taxes: formatCurrency(taxes),
    total: formatCurrency(total)
  };
}

function RightRail({ screen, selectedQuote, fundingMilestone }) {
  if (screen === "invite" || screen === "quotes" || screen === "quoteDetail") {
    return null;
  }

  if (screen === "describe") {
    return (
      <aside className="right-rail describe-right-rail">
        <Card title="Needed for an initial quote" tone="soft">
          <ul className="clean-list">
            <li>Product type</li>
            <li>Quantity (color breakdown)</li>
            <li>Sample stages needed</li>
            <li>Timeline</li>
            <li>Material / quality level</li>
            <li>Materials and components sourcing responsibility</li>
            <li>Target unit price range</li>
            <li>Preferred region</li>
          </ul>
        </Card>
      </aside>
    );
  }

  if (screen === "review") {
    return (
      <aside className="right-rail review-right-rail">
        <Card title="What factories need" tone="soft">
          <ul className="clean-list">
            <li>Product type</li>
            <li>Quantity and color breakdown</li>
            <li>Sample stages needed</li>
            <li>Timeline</li>
            <li>Material / quality level</li>
            <li>Materials and components sourcing responsibility</li>
            <li>Target unit price range</li>
            <li>Questions factories should answer</li>
          </ul>
        </Card>
      </aside>
    );
  }

  if (screen === "fund") {
    const fundingSummary = calculateFundingSummary(fundingMilestone);
    return (
      <aside className="right-rail">
        <section className="project-funds-panel">
          <div className="accepted-factory">
            <div className="factory-avatar">AM</div>
            <div>
              <strong>{selectedQuote}</strong>
              <span>Porto, Portugal</span>
            </div>
          </div>
          <h2>Project funds</h2>
          <div className="fund-summary-rows">
            <Metric label={fundingMilestone ? "Payment" : "Payment 1"} value={fundingSummary.paymentLabel} />
            <Metric label="Subtotal" value={fundingSummary.subtotal} />
            <Metric label="TSC service fee" value={fundingSummary.fee} />
            <Metric label="Estimated taxes" value={fundingSummary.taxes} />
          </div>
          <div className="fund-total-row">
            <span>Estimated total</span>
            <strong>{fundingSummary.total}</strong>
          </div>
          <button className="primary-btn fund-side-btn" type="button">{fundingMilestone ? "Fund milestone" : "Fund payment & start"}</button>
          <p className="payment-protection">
            <img src="/assets/prototype-icons/payment-protection.svg" alt="" />
            TSC Payment Protection
          </p>
        </section>
      </aside>
    );
  }

  if (screen === "success") {
    return (
      <aside className="right-rail">
        <section className="project-funds-panel">
          <div className="accepted-factory">
            <div className="factory-avatar">AM</div>
            <div>
              <strong>{selectedQuote}</strong>
              <span>Porto, Portugal</span>
            </div>
          </div>
          <h2>Project funds</h2>
          <div className="fund-summary-rows">
            <Metric label="Payment 1" value="Sample order" />
            <Metric label="Subtotal" value="$120.00" />
            <Metric label="TSC service fee" value="$3.60" />
            <Metric label="Estimated taxes" value="$3.60" />
          </div>
          <div className="fund-total-row">
            <span>Paid today</span>
            <strong>$124.14</strong>
          </div>
          <p className="payment-protection">
            <img src="/assets/prototype-icons/payment-protection.svg" alt="" />
            TSC Payment Protection
          </p>
        </section>
      </aside>
    );
  }

  const isQuoteArea = ["quotes", "quoteDetail", "contract", "milestones"].includes(screen);
  if (isQuoteArea) {
    return (
      <aside className="right-rail">
        <section className="accepted-quote-panel">
          <div className="accepted-factory">
            <div className="factory-avatar">AM</div>
            <div>
              <strong>{selectedQuote}</strong>
              <span>Porto, Portugal</span>
            </div>
          </div>
          <button className="secondary-btn accepted-message-btn" type="button">
            Message factory
          </button>
        </section>
        {screen !== "milestones" && (
          <section className="accepted-reminder">
            <h3>TSC reminder</h3>
            <p>Message the factory to confirm sample scope, revisions, QC, delivery terms, and final pricing before funding.</p>
          </section>
        )}
        {screen === "milestones" && (
          <Card title="What should production steps cover?" tone="soft">
            <ul className="production-step-guidance-list">
              <li>Samples and revision approvals</li>
              <li>Material, trim, or color confirmations</li>
              <li>Bulk deposit and production start</li>
              <li>In-line or final QC review</li>
              <li>Shipment handoff and final balance</li>
            </ul>
          </Card>
        )}
      </aside>
    );
  }

  return (
    <aside className={screen === "inviteSuccess" ? "right-rail invite-success-right-rail" : "right-rail"}>
      <Card title="Request summary">
        <Metric label="Product" value="Organic woven shirt" />
        <Metric label="Quantity" value="300 units" />
        <Metric label="Samples" value="Fit + PP" />
        <Metric label="Target" value="$18-$24" />
      </Card>
      {screen !== "inviteSuccess" && (
        <Card title="TSC reminder" tone="soft">
          <p>
            Keep sample scope, revisions, approvals, QC, and delivery terms clear before funding.
          </p>
        </Card>
      )}
    </aside>
  );
}

const passiveActivityItems = [
  {
    type: "Quote",
    title: "Atelier Minho updated their quote",
    meta: "Organic cotton woven shirt production",
    time: "12 min ago",
    unread: true
  },
  {
    type: "File",
    title: "Seoul Knit Works uploaded a yarn card",
    meta: "Premium knit capsule for resort drop",
    time: "48 min ago",
    unread: true
  },
  {
    type: "Status",
    title: "PP sample milestone moved to in review",
    meta: "Washed denim overshirt reorder",
    time: "Yesterday"
  },
  {
    type: "Factory",
    title: "Two saved factories added summer capacity",
    meta: "Portugal and South Korea partners",
    time: "Jul 22"
  }
];

function HomeScreen({ goTo, onOpenActivity }) {
  const [inviteBrandOpen, setInviteBrandOpen] = useState(false);
  const [discountCodesOpen, setDiscountCodesOpen] = useState(false);
  const attentionItems = [
    {
      type: "Draft",
      tone: "danger",
      title: "Finish your quote draft",
      meta: "Add target pricing and invite factories before sending.",
      facts: [],
      action: "Continue draft",
      onClick: () => goTo("describe")
    },
    {
      type: "Message",
      tone: "info",
      title: "Seoul Knit Works asked about yarn substitutions",
      meta: `${activeProjects[1].title} · Reply requested today`,
      facts: [],
      action: "Reply"
    },
    {
      type: "Profile",
      tone: "warning",
      title: "Complete your profile",
      meta: "Add certifications and one more project photo to improve factory confidence.",
      facts: [],
      action: "Edit profile",
      onClick: () => goTo("profile")
    },
    {
      type: "Verification",
      tone: "success",
      title: "Review verification checklist",
      meta: "Check what is still needed while your brand profile is being verified.",
      facts: [],
      action: "View checklist"
    }
  ];

  return (
    <div className="home-stack">
      <header className="home-header">
        <div>
          <h1>Hi Maison Rue</h1>
          <span />
        </div>
        <button className="activity-icon-btn" type="button" onClick={onOpenActivity} aria-label="Open activity">
          <img src="/assets/prototype-icons/notification.svg" alt="" />
          <b aria-hidden="true">4</b>
        </button>
      </header>
      <section className="card home-search-card">
        <label className="search-field home-search-field">
          <SearchIcon />
          <input placeholder="Ask anything about sourcing, factories, or your projects..." />
          <b aria-hidden="true">✦</b>
        </label>
        <p className="home-section-label">Suggested actions</p>
        <div className="home-suggestion-row">
          <button className="pill" type="button">Find a denim factory with MOQ under 500</button>
          <button className="pill" type="button">Show me factories with GOTS certification</button>
          <button className="pill" type="button">What do I still need for verification?</button>
          <button className="pill" type="button" onClick={() => goTo("describe")}>Start a new project</button>
        </div>
      </section>
      <div className="home-dashboard-grid">
        <section className="home-active-rfqs">
          <header className="home-panel-header">
            <div>
              <h2>Active quotes</h2>
              <p>Compare quote activity and open questions before choosing a factory.</p>
            </div>
            <button className="secondary-btn" type="button" onClick={() => goTo("rfqs")}>View all</button>
          </header>
          <div className="home-rfq-list">
            {activeRfqs.slice(0, 4).map((rfq) => (
              <HomeRfqMiniCard rfq={rfq} goTo={goTo} key={rfq.title} />
            ))}
          </div>
        </section>
        <section className="home-attention">
          <header className="home-panel-header compact">
            <div>
              <h2>Savings</h2>
            </div>
            <button className="secondary-btn compact-btn" type="button" onClick={() => setInviteBrandOpen(true)}>Invite brand</button>
          </header>
          <BrandDashboardDiscountCard onInvite={() => setInviteBrandOpen(true)} onViewCodes={() => setDiscountCodesOpen(true)} />
          <HomeUpcomingCallCard />
          <header className="home-panel-header compact">
            <div>
              <h2>Needs your attention</h2>
              <p>Priority quotes, messages, and production steps.</p>
            </div>
          </header>
          <div className="home-attention-grid">
            {attentionItems.map((item) => (
              <HomeAttentionCard item={item} key={item.title} />
            ))}
          </div>
        </section>
      </div>
      <section className="home-active-orders">
        <header className="home-panel-header">
          <div>
            <h2>Active production orders</h2>
            <p>Track current orders and next action dates.</p>
          </div>
          <button className="secondary-btn" type="button" onClick={() => goTo("projects")}>View all</button>
        </header>
        <div className="projects-list home-projects-list">
          {activeProjects.slice(0, 2).map((project) => (
            <HomeProjectMiniCard project={project} goTo={goTo} key={project.title} />
          ))}
        </div>
      </section>
      {inviteBrandOpen && (
        <InviteBrandModal onClose={() => setInviteBrandOpen(false)} />
      )}
      {discountCodesOpen && (
        <DiscountCodesModal onClose={() => setDiscountCodesOpen(false)} />
      )}
    </div>
  );
}

function BrandDashboardDiscountCard({ onInvite, onViewCodes }) {
  return (
    <section className="brand-dashboard-discount-card">
      <div className="brand-discount-card-topline">
        <span>Available discount</span>
        <button className="brand-copy-code-btn" type="button" onClick={onViewCodes}>View discount codes</button>
      </div>
      <div className="brand-discount-card-body">
        <div>
          <strong>$50</strong>
          <p>For eligible orders. Invite a brand to earn another $50 discount.</p>
        </div>
      </div>
    </section>
  );
}

const brandDiscountCodes = [
  { code: "MRUE-50-AUG", status: "Unused", source: "Eligible order credit", value: "$50" },
  { code: "REFER-MAYA-50", status: "Unused", source: "Brand referral", value: "$50" },
  { code: "WELCOME-50", status: "Used", source: "First eligible order", value: "$50", usedOn: "Organic cotton woven shirt - Jul 18" }
];

function DiscountCodesModal({ onClose }) {
  return createPortal((
    <div className="brand-profile-modal-layer" role="presentation">
      <button className="brand-profile-modal-scrim" type="button" aria-label="Close discount codes" onClick={onClose} />
      <section className="brand-profile-modal brand-discount-codes-modal" role="dialog" aria-modal="true" aria-labelledby="brand-discount-codes-title">
        <button className="brand-profile-modal-close brand-compact-modal-close" type="button" aria-label="Close discount codes" onClick={onClose}>
          <img src="/assets/prototype-icons/close.svg" alt="" />
        </button>
        <header className="brand-profile-modal-header">
          <h1 id="brand-discount-codes-title">Discount codes</h1>
          <p>Use an unused code at payment. Used codes stay here so finance can track order discounts.</p>
        </header>
        <div className="brand-discount-code-list">
          {brandDiscountCodes.map((item) => (
            <article className={item.status === "Used" ? "brand-discount-code-row used" : "brand-discount-code-row"} key={item.code}>
              <div>
                <span>{item.source}</span>
                <strong>{item.code}</strong>
                {item.usedOn && <p>Used on {item.usedOn}</p>}
                {item.status === "Unused" && <button className="brand-copy-code-btn" type="button">Copy code</button>}
              </div>
              <div>
                <b>{item.value}</b>
                <em>{item.status}</em>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  ), document.body);
}

function InviteBrandModal({ onClose }) {
  return createPortal((
    <div className="brand-profile-modal-layer brand-invite-modal-layer" role="presentation">
      <button className="brand-profile-modal-scrim" type="button" aria-label="Close invite brand" onClick={onClose} />
      <section className="brand-profile-modal brand-invite-modal" role="dialog" aria-modal="true" aria-labelledby="brand-invite-title">
        <button className="brand-profile-modal-close brand-compact-modal-close" type="button" aria-label="Close invite brand" onClick={onClose}>
          <img src="/assets/prototype-icons/close.svg" alt="" />
        </button>
        <header className="brand-profile-modal-header">
          <h1 id="brand-invite-title">Invite a brand</h1>
          <p>Send an invite link to another brand. When they place an eligible order, you earn a $50 discount and they get $50 too.</p>
        </header>
        <label className="brand-profile-edit-field full-width">
          <span>Brand email</span>
          <input type="email" placeholder="name@brand.com" />
        </label>
        <label className="brand-profile-edit-field full-width">
          <span>Message</span>
          <textarea defaultValue="I thought The Sourcing Club could be useful for your next production order. If you join and place an eligible order, we both get a $50 discount." />
        </label>
        <div className="brand-profile-modal-actions">
          <button className="secondary-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-btn" type="button" onClick={onClose}>Send invite</button>
        </div>
      </section>
    </div>
  ), document.body);
}

function ActivityDrawer({ onClose }) {
  return createPortal((
    <div className="activity-drawer-layer" role="presentation">
      <button className="activity-drawer-scrim" type="button" aria-label="Close activity" onClick={onClose} />
      <aside className="activity-drawer" role="dialog" aria-modal="true" aria-labelledby="activity-drawer-title">
        <header className="activity-drawer-header">
          <div>
            <h2 id="activity-drawer-title">Activity</h2>
            <p>Passive updates from quotes, files, factories, and production.</p>
          </div>
          <button className="activity-close-btn" type="button" aria-label="Close activity" onClick={onClose}>
            <img src="/assets/prototype-icons/close.svg" alt="" />
          </button>
        </header>
        <div className="activity-drawer-list">
          {passiveActivityItems.map((item) => (
            <article className={item.unread ? "activity-drawer-item unread" : "activity-drawer-item"} key={item.title}>
              <div>
                <div className="activity-drawer-meta">
                  <span>{item.type}</span>
                  <time>{item.time}</time>
                </div>
                <h3>{item.title}</h3>
                <p>{item.meta}</p>
              </div>
            </article>
          ))}
        </div>
      </aside>
    </div>
  ), document.body);
}

function HomeUpcomingCallCard() {
  const calls = [
    {
      title: "Sample review call",
      time: "Tue 10:00 AM ET",
      counterpartTime: "Atelier Minho: Tue 3:00 PM",
      description: "Review sample photos and confirm sleeve measurement update."
    },
    {
      title: "Bulk kickoff sync",
      time: "Thu 11:30 AM ET",
      counterpartTime: "Atelier Minho: Thu 4:30 PM",
      description: "Confirm bulk timing and payment milestone before production starts."
    }
  ];

  return (
    <article className="home-upcoming-call-card">
      <h2 className="home-upcoming-call-label">Scheduled calls</h2>
      <div className="home-upcoming-call-list">
        {calls.map((call) => (
          <section className="home-upcoming-call-time" key={call.title}>
            <div className="home-upcoming-call-heading">
              <h3>{call.title}</h3>
              <strong>{call.time}</strong>
            </div>
            <span>{call.counterpartTime}</span>
            <div className="home-upcoming-call-actions">
              <p className="home-upcoming-call-description">{call.description}</p>
              <button className="secondary-btn compact-btn" type="button">Join call</button>
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

function HomeAttentionCard({ item }) {
  return (
    <article className={`home-attention-card ${item.tone}`}>
      <div className="home-attention-type">
        <span>{item.type}</span>
      </div>
      <div className="home-attention-copy">
        <h3>{item.title}</h3>
        <p>{item.meta}</p>
      </div>
      {item.facts.length > 0 && (
        <div className="home-attention-facts">
          {item.facts.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}
      <button className="secondary-btn compact-btn" type="button" onClick={item.onClick}>{item.action}</button>
    </article>
  );
}

function HomeRfqMiniCard({ rfq, goTo }) {
  const [quotesReceived, invitedCount] = rfq.metrics;
  const quoteDue = rfq.date.split("Quote due ")[1] || "TBD";
  const [primaryImage] = rfq.images || [];

  return (
    <article className="home-rfq-card">
      <header className="home-production-title">
        {primaryImage && <img src={primaryImage.src} alt={`${rfq.title} reference`} />}
        <div>
          <h3>{rfq.title}</h3>
          <p>{rfq.date}</p>
        </div>
      </header>
      <div className="home-rfq-side">
        <span className={`tag rfq-status ${rfq.statusTone}`}>{rfq.status}</span>
        <button className="primary-btn" type="button" onClick={() => goTo("quotes")}>View quote</button>
      </div>
      <div className="home-production-facts home-rfq-facts">
        <div>
          <span>Quotes received</span>
          <strong>{quotesReceived[0]}</strong>
        </div>
        <div>
          <span>Invited</span>
          <strong>{invitedCount[0]}</strong>
        </div>
        <div>
          <span>Due</span>
          <strong>{quoteDue}</strong>
        </div>
      </div>
      <p className="home-rfq-description">{rfq.description}</p>
    </article>
  );
}

function HomeProjectMiniCard({ project, goTo }) {
  const compactStatus = project.statusTone === "warning" ? "Lab dip review" : project.statusTone === "ready" ? "Sample approval" : project.status;

  return (
    <article className="home-production-card">
      <div className="home-production-main">
        <header className="home-production-title">
          {project.image && <img src={project.image.src} alt={`${project.title} reference`} />}
          <div>
            <h3>{project.title}</h3>
            <p>{project.factory} · {project.location} · {project.started}</p>
          </div>
        </header>
        <div className="home-production-facts">
          <div>
            <span>Production step</span>
            <strong>{project.currentStep}</strong>
          </div>
          <div>
            <span>Next due</span>
            <strong>{project.nextDue}</strong>
          </div>
        </div>
      </div>
      <div className="home-production-side">
        <div className="home-production-actions">
          <span className={`project-status ${project.statusTone}`}>{compactStatus}</span>
          <button className="primary-btn" type="button" onClick={() => goTo("projectDetail")}>View order</button>
        </div>
        <div className="home-production-progress">
          <ProjectProgress progress={project.progress} />
        </div>
      </div>
    </article>
  );
}

function BrandProfileScreen({ onViewCompletion }) {
  const [projectTab, setProjectTab] = useState("completed");
  const [profileMode, setProfileMode] = useState("edit");
  const isOwnerView = profileMode === "edit";
  const [activeEditor, setActiveEditor] = useState(null);
  const [profileData, setProfileData] = useState({
    name: "Maison Rue",
    location: "New York, USA",
    founded: "2021",
    category: "Fashion brand",
    website: "www.maisonrue.com",
    businessEmail: "name@maisonrue.com",
    annualRevenue: "$1M-$5M",
    paymentStatus: "Unverified",
    paymentMethodStatus: "Not added",
    responseTime: "1 day",
    clubOrders: "4",
    activeRfqs: "3",
    repeatFactories: "2",
    intro:
      "Premium womenswear brand focused on organic cotton shirts, polished woven tops, and small-batch capsule production. Maison Rue shares clear product references, quick feedback, and defined sample approval paths so factories can quote confidently.",
    productCategories: ["Tops", "Bottoms"],
    productionTypes: ["Cut & sew knits", "Wovens"],
    marketLevel: ["Premium / contemporary ($100-$500)"],
    preferredRegions: ["Portugal", "China", "Korea"],
    certifications: ["GOTS", "OEKO-TEX"],
    services: ["Full package", "Sample development", "Fabric sourcing"],
    sourcingVolume: {
      annualVolume: "5,000-20,000 pieces",
      orderSize: "300-1,000 pieces per style",
      collectionsPerYear: "3-4",
      targetPrice: "$12-$28 FOB per unit",
      reorderCadence: "Quarterly reorders",
      sourcingStage: "Sampling soon"
    },
    assets: [
      { title: "Logo", meta: "SVG, PNG, JPG uploaded", src: "/assets/logo.svg" },
      { title: "Product photos", meta: "Organic poplin shirt references", src: "/assets/dashboard-rfq-shirt.jpg" },
      { title: "Brand direction", meta: "Lookbook and material moodboard", src: "/assets/moodboard-warm-clay.jpg" }
    ],
    verification: [
      { name: "Business registration", status: "Uploaded" },
      { name: "Business email", status: "Verified" },
      { name: "Payment method", status: "Not added" },
      { name: "Payment status", status: "Unverified" }
    ],
    stakeholders: [
      { name: "Ari Chen", email: "ari@maisonrue.com", role: "Founder", permissions: ["rfqFlow", "approve", "primaryContact", "settingsAccess"] },
      { name: "Maya Lee", email: "maya@maisonrue.com", role: "Production lead", permissions: ["approve"] }
    ],
    completedProjects: [
      {
        title: "Organic cotton woven shirt production",
        partner: "Atelier Minho",
        date: "May 2026 - Jul 2026",
        result: "Completed on time",
        summary: "Fit and PP sample path for 300 organic cotton poplin shirts, followed by a small-batch production run.",
        rating: "5.0",
        review: "Clear brief, fast approvals, and thoughtful feedback during sample rounds.",
        tags: ["Wovens", "Fit sample", "PP sample", "Low MOQ", "Responsive"]
      },
      {
        title: "Denim wash development",
        partner: "Hangzhou Denim Lab",
        date: "Jan 2026 - Mar 2026",
        result: "Factory rebooked",
        summary: "Wash development and reference sampling for a premium denim jacket capsule.",
        rating: "4.9",
        review: "Strong direction and organized assets made the development process efficient.",
        tags: ["Denim", "Wash sample", "Reference photos", "Premium"]
      }
    ],
    activeProjects: [
      {
        title: "Poplin shirt restock quote",
        partner: "Atelier Minho",
        date: "Posted 18 minutes ago",
        result: "Quote due",
        summary: "300 organic cotton poplin shirts across 3 colors with fit and PP sample before bulk approval.",
        tags: ["Wovens", "GOTS preferred", "3 colors", "Fit + PP"]
      },
      {
        title: "Resort knit capsule",
        partner: "Luna Resort shortlist",
        date: "Drafting",
        result: "Preparing quote",
        summary: "Lightweight knit tops and cardigans with visible sample-room support and moodboard references.",
        tags: ["Knitwear", "Sample room", "Moodboard", "Premium"]
      }
    ]
  });
  const data = profileData;
  const openEditor = (editor) => {
    setProfileMode("edit");
    setActiveEditor(editor);
  };
  const saveProfileSection = (updates) => {
    setProfileData((current) => ({ ...current, ...updates }));
    setActiveEditor(null);
  };
  const visibleProjects = projectTab === "completed" ? data.completedProjects : data.activeProjects;
  const overviewRows = [
    ["Brand name", data.name],
    ["Brand category", data.category],
    ["Business email", data.businessEmail],
    ["Year founded", data.founded],
    ["Website URL", data.website],
    ["HQ location", data.location],
  ];
  const sourcingVolumeRows = [
    ["Annual order volume", data.sourcingVolume.annualVolume],
    ["Typical order size", data.sourcingVolume.orderSize],
    ["Collections per year", data.sourcingVolume.collectionsPerYear],
    ["Typical price range for core styles", data.sourcingVolume.targetPrice],
    ["Reorder cadence", data.sourcingVolume.reorderCadence],
    ["Current sourcing stage", data.sourcingVolume.sourcingStage]
  ];

  return (
    <div className="brand-profile brand-profile-redesign">
      <div className="factory-profile-shell">
        <section className="factory-profile-owner-bar">
          <div>
            <span>Brand profile</span>
            <strong>{isOwnerView ? "Edit what factories see" : "Public preview"}</strong>
          </div>
          <div className="factory-profile-view-toggle" role="tablist" aria-label="Brand profile view">
            <button
              className={isOwnerView ? "active" : ""}
              type="button"
              onClick={() => isOwnerView ? openEditor("overview") : setProfileMode("edit")}
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

        <section className="factory-profile-hero brand-profile-hero">
          {isOwnerView && <button className="factory-profile-banner-edit" type="button" onClick={() => openEditor("banner")}>Edit banner</button>}
          <div className="factory-profile-identity">
            <div className="factory-profile-logo-wrap">
              <div className="factory-profile-logo">MR</div>
              {isOwnerView && <button className="factory-profile-logo-edit" type="button" onClick={() => openEditor("overview")}>Edit</button>}
            </div>
            <div>
              <div className="factory-profile-title-row">
                <h1>{data.name}</h1>
              </div>
              <p>{data.location} · {data.category} · {data.annualRevenue} revenue</p>
              <div className="tag-row compact-tags factory-profile-hero-tags">
                {data.productCategories.map((tag) => <span className="tag garment-tag" key={tag}>{tag}</span>)}
                {data.productionTypes.map((tag) => <span className="tag garment-tag" key={tag}>{tag}</span>)}
                {data.marketLevel.map((tag) => <span className="tag garment-tag" key={tag}>{tag}</span>)}
              </div>
            </div>
          </div>
          {!isOwnerView && (
            <div className="factory-profile-actions">
              <button className="secondary-btn" type="button">Save brand</button>
              <button className="primary-btn" type="button">Contact brand</button>
            </div>
          )}
        </section>

        <div className="factory-profile-layout">
          <main className="factory-profile-main">
            <section className="factory-profile-card factory-profile-performance">
              <div>
                <span>Brand activity</span>
                <strong>{data.clubOrders}</strong>
                <p>Club orders · {data.responseTime} avg. response</p>
              </div>
              <div className="factory-profile-score-grid">
                <Metric label="Active quotes" value={data.activeRfqs} />
                <Metric label="Repeat factories" value={data.repeatFactories} />
                <Metric label="Payment status" value={data.paymentStatus} />
              </div>
            </section>

            <section className="factory-profile-card">
              <BrandProfileCardHeader title="Overview" editable={isOwnerView} onEdit={() => openEditor("overview")} />
              <p>{data.intro}</p>
              <div className="factory-profile-detail-grid">
                {overviewRows.map(([label, value]) => <BrandProfileDetailPair label={label} value={value} key={label} />)}
              </div>
            </section>

            <section className="factory-profile-card">
              <BrandProfileCardHeader title="Sourcing fit" editable={isOwnerView} onEdit={() => openEditor("sourcing")} />
              <BrandProfileChipSection label="Product categories" items={data.productCategories} />
              <BrandProfileChipSection label="Production type" items={data.productionTypes} />
              <BrandProfileChipSection label="Market level" items={data.marketLevel} />
              <BrandProfileChipSection label="Preferred regions" items={data.preferredRegions} />
              <BrandProfileChipSection label="Certifications requested" items={data.certifications} />
              <BrandProfileChipSection label="Services needed" items={data.services} />
            </section>

            <section className="factory-profile-card">
              <BrandProfileCardHeader title="Sourcing volume" editable={isOwnerView} onEdit={() => openEditor("sourcingVolume")} />
              <div className="factory-profile-detail-grid">
                {sourcingVolumeRows.map(([label, value]) => <BrandProfileDetailPair label={label} value={value} key={label} />)}
              </div>
            </section>

            <section className="factory-profile-card">
              <BrandProfileCardHeader title="Brand assets" editable={isOwnerView} actionLabel="Manage assets" onEdit={() => openEditor("assets")} />
              <div className="factory-profile-product-grid">
                {data.assets.map((asset) => (
                  <article className="factory-profile-product brand-profile-asset" key={asset.title}>
                    <img src={asset.src} alt={`${asset.title} preview`} />
                    <strong>{asset.title}</strong>
                    <span>{asset.meta}</span>
                  </article>
                ))}
              </div>
            </section>

            <section className="factory-profile-card">
              <div className="factory-profile-section-header">
                <div>
                  <h2>Past work with factories</h2>
                  <p>Completed and active TSC activity that helps factories understand how this brand works.</p>
                </div>
                {isOwnerView && <span className="factory-profile-sync-pill">Auto-added</span>}
              </div>
              <div className="factory-profile-project-tabs" role="tablist" aria-label="Brand project status">
                <button
                  className={projectTab === "completed" ? "active" : ""}
                  type="button"
                  onClick={() => setProjectTab("completed")}
                  role="tab"
                  aria-selected={projectTab === "completed"}
                >
                  Completed ({data.completedProjects.length})
                </button>
                <button
                  className={projectTab === "active" ? "active" : ""}
                  type="button"
                  onClick={() => setProjectTab("active")}
                  role="tab"
                  aria-selected={projectTab === "active"}
                >
                  Active ({data.activeProjects.length})
                </button>
              </div>
              <div className="factory-profile-project-list">
                {visibleProjects.map((project) => (
                  <article className="factory-profile-history-card" key={project.title}>
                    <header>
                      <div>
                        <h3>{project.title}</h3>
                        <p>{project.partner} · {project.date}</p>
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
          </main>

          <aside className="factory-profile-side">
            {isOwnerView ? (
              <>
                <section className="factory-profile-card factory-profile-owner-card">
                  <div className="factory-profile-card-header">
                    <h2>Profile status</h2>
                    <button className="factory-profile-edit-button" type="button" onClick={onViewCompletion}>View details</button>
                  </div>
                  <div className="factory-profile-status-meter">
                    <strong>88%</strong>
                    <span>Profile complete</span>
                  </div>
                  <div className="factory-profile-status-track"><span /></div>
                  <p>Review what is complete, what is in progress, and what would strengthen this profile.</p>
                  <div className="factory-profile-owner-actions">
                    <button className="primary-btn" type="button">Publish changes</button>
                    <button className="secondary-btn" type="button" onClick={() => setProfileMode("public")}>View as public</button>
                  </div>
                </section>
              </>
            ) : (
              <section className="factory-profile-card factory-profile-contact-card">
                <h2>Brand contact</h2>
                <div className="factory-profile-contact-row">
                  <div className="factory-avatar">MR</div>
                  <div>
                    <strong>{data.name}</strong>
                    <span>{data.location}</span>
                  </div>
                </div>
                <button className="primary-btn" type="button">Contact brand</button>
              </section>
            )}

            <section className="factory-profile-card">
              <BrandProfileCardHeader title="Verification" editable={isOwnerView} actionLabel="Edit" onEdit={() => openEditor("verification")} />
              <div className="factory-profile-cert-list">
                {data.verification.map((item) => (
                  <div className="factory-profile-cert" key={item.name}>
                    <strong>{item.name}</strong>
                    <span className={["Verified", "Uploaded", "Added"].includes(item.status) ? "verified" : ""}>{item.status}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="factory-profile-card">
              <BrandProfileCardHeader title="Decision makers" editable={isOwnerView} actionLabel="Edit" onEdit={() => openEditor("stakeholders")} />
              <div className="factory-profile-reference-list">
                {data.stakeholders.map((stakeholder) => (
                  <div key={typeof stakeholder === "string" ? stakeholder : stakeholder.email || stakeholder.name}>
                    <span>{(typeof stakeholder === "string" ? stakeholder : stakeholder.name).slice(0, 2).toUpperCase()}</span>
                    <strong>{typeof stakeholder === "string" ? stakeholder : `${stakeholder.name} · ${stakeholder.role}`}</strong>
                  </div>
                ))}
              </div>
            </section>

          </aside>
        </div>
      </div>
      {activeEditor && createPortal((
        <BrandProfileEditModal
          editor={activeEditor}
          data={data}
          onClose={() => setActiveEditor(null)}
          onSave={saveProfileSection}
        />
      ), document.body)}
    </div>
  );
}

function BrandProfileCardHeader({ title, editable = false, actionLabel = "Edit", onEdit }) {
  return (
    <div className="factory-profile-card-header">
      <h2>{title}</h2>
      {editable && <button className="factory-profile-edit-button" type="button" onClick={onEdit}>{actionLabel}</button>}
    </div>
  );
}

const brandProfileEditorOptions = {
  productCategories: ["Tops", "Bottoms", "Dresses & jumpsuits", "Outerwear", "Activewear", "Intimates / underwear", "Swimwear", "Sleepwear / loungewear", "Childrenswear / baby", "Uniforms / workwear", "Accessories"],
  productionTypes: ["Cut & sew knits", "Wovens", "Sweaters / knitwear", "Denim", "Seamless / circular knit", "Intimates / delicate garments", "Leather / suede", "Bags / soft goods"],
  marketLevel: ["Luxury ($500+)", "Premium / contemporary ($100-$500)", "Mid range ($50-$100)", "Mass market (under $50)"],
  preferredRegions: ["Portugal", "China", "Korea", "India", "Turkey", "United States"],
  certifications: ["GOTS", "OEKO-TEX", "BSCI", "GRS", "WRAP", "No preference"],
  services: ["Full package", "CMT", "Pattern making", "Sample development", "Fabric sourcing"]
};

const brandProfileCompletionChecks = [
  {
    title: "Business registration",
    status: "Uploaded",
    tone: "complete",
    description: "The registration document is on file and can support brand account review."
  },
  {
    title: "Business email",
    status: "Verified",
    tone: "complete",
    description: "The brand email has been confirmed, so factories can trust the listed contact channel."
  },
  {
    title: "Decision makers",
    status: "Added",
    tone: "complete",
    description: "Founder and production lead contacts are listed so factories know who they will work with."
  },
  {
    title: "Brand assets",
    status: "Added",
    tone: "complete",
    description: "Product references and visual assets are present, helping factories understand the brand direction."
  },
  {
    title: "Payment method",
    status: "Not added",
    tone: "missing",
    description: "Add a card or bank account now, or during the quote flow before confirming production.",
    action: "Add payment method"
  }
];

const brandProfileCompletionIconMap = {
  complete: "/assets/prototype-icons/done.svg",
  progress: "/assets/prototype-icons/pending.svg",
  missing: "/assets/prototype-icons/warning.svg"
};

function BrandProfileCompletionPage({ onBack, onAddPayment }) {
  const completeCount = brandProfileCompletionChecks.filter((item) => item.tone === "complete").length;
  const progressCount = brandProfileCompletionChecks.filter((item) => item.tone === "progress").length;
  const attentionCount = brandProfileCompletionChecks.filter((item) => item.tone === "missing").length;

  return (
    <main className="factory-profile-page factory-profile-completion-page brand-profile-completion-page">
      <div className="factory-profile-shell">
        <button className="text-link factory-profile-completion-back" type="button" onClick={onBack}>‹ Back to profile</button>

        <section className="factory-profile-completion-hero">
          <div>
            <span>Profile verification</span>
            <h1>Profile completion summary</h1>
            <p>You can browse factories and draft quotes now. Complete the items below to improve trust signals and make the brand easier for factories to evaluate.</p>
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
                  <p>Each item shows whether factories can rely on it now, whether it is still in progress, or whether action is needed.</p>
                </div>
              </div>
              <div className="profile-completion-check-list">
                {brandProfileCompletionChecks.map((item) => (
                  <article className={`profile-completion-check ${item.tone}`} key={item.title}>
                    <span className="profile-completion-check-icon" aria-hidden="true">
                      <img src={brandProfileCompletionIconMap[item.tone]} alt="" />
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.status}</small>
                      <p>{item.description}</p>
                      {item.action && (
                        <button
                          className="secondary-btn compact-btn"
                          type="button"
                          onClick={item.title === "Payment method" ? onAddPayment : undefined}
                        >
                          {item.action}
                        </button>
                      )}
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
                <ProfileCompletionSummaryRow label="Complete" value={`${completeCount} items`} />
                <ProfileCompletionSummaryRow label="In progress" value={`${progressCount} item`} />
                <ProfileCompletionSummaryRow label="Needs attention" value={`${attentionCount} item`} />
              </div>
            </section>
            <section className="factory-profile-card">
              <h2>Suggested updates</h2>
              <div className="factory-profile-owner-task-list">
                <span>Add payment method</span>
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}

function ProfileCompletionSummaryRow({ label, value }) {
  return (
    <div className="profile-completion-summary-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BrandProfileEditModal({ editor, data, onClose, onSave }) {
  const isUploadEditor = ["banner", "assets", "projects"].includes(editor);
  const editorTitles = {
    overview: ["Edit overview", "Update the brand details factories see on this profile."],
    sourcing: ["Edit sourcing fit", "Update the tags factories use to understand what this brand is looking for."],
    sourcingVolume: ["Edit sourcing volume", "Update order size, cadence, target pricing, and sourcing stage."],
    banner: ["Edit banner", "Upload or replace the banner image used on this profile."],
    assets: ["Manage brand assets", "Upload logos, product photos, direction files, and brand references."],
    projects: ["Manage projects", "Update completed or active TSC work shown to factories."],
    verification: ["Edit verification", "Add or update the onboarding verification details shown on this brand profile."],
    payment: ["Add payment method", "Add a card or bank account so payment status can be verified on the brand profile."],
    stakeholders: ["Edit decision makers", "Add or update the people factories should expect to work with."]
  };
  const [title, helper] = editorTitles[editor] || editorTitles.overview;
  const [form, setForm] = useState(() => ({
    name: data.name,
    location: data.location,
    category: data.category,
    founded: data.founded,
    website: data.website,
    businessEmail: data.businessEmail,
    annualRevenue: data.annualRevenue,
    intro: data.intro,
    productCategories: data.productCategories,
    productionTypes: data.productionTypes,
    marketLevel: data.marketLevel,
    preferredRegions: data.preferredRegions,
    certifications: data.certifications,
    services: data.services,
    sourcingVolume: { ...data.sourcingVolume },
    stakeholders: data.stakeholders.map((stakeholder) => typeof stakeholder === "string"
      ? { name: stakeholder, email: "", role: "Stakeholder", permissions: ["approve"] }
      : { permissions: ["approve"], ...stakeholder }),
    businessEmailVerified: data.businessEmail,
    paymentMethodType: "card",
    paymentName: data.name,
    cardNumber: "",
    cardExpiry: "",
    cardCvc: "",
    bankName: "",
    routingNumber: "",
    accountNumber: "",
    showPaymentFields: false
  }));
  const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateStakeholder = (index, key, value) => {
    setForm((current) => ({
      ...current,
      stakeholders: current.stakeholders.map((stakeholder, stakeholderIndex) => stakeholderIndex === index
        ? { ...stakeholder, [key]: value }
        : stakeholder)
    }));
  };
  const addStakeholder = () => {
    setForm((current) => ({
      ...current,
      stakeholders: [...current.stakeholders, { name: "", email: "", role: "Stakeholder", permissions: ["approve"], isInvite: true }]
    }));
  };
  const toggleStakeholderPermission = (index, key) => {
    setForm((current) => ({
      ...current,
      stakeholders: current.stakeholders.map((stakeholder, stakeholderIndex) => {
        if (stakeholderIndex !== index) return stakeholder;
        const permissions = stakeholder.permissions || [];
        return {
          ...stakeholder,
          permissions: permissions.includes(key)
            ? permissions.filter((permission) => permission !== key)
            : [...permissions, key]
        };
      })
    }));
  };
  const serializeStakeholders = (stakeholders) => stakeholders
    .map((stakeholder) => ({
      name: stakeholder.name.trim(),
      email: stakeholder.email.trim(),
      role: stakeholder.role.trim() || "Stakeholder",
      permissions: stakeholder.permissions || ["approve"]
    }))
    .filter((stakeholder) => stakeholder.name || stakeholder.email);
  const sendStakeholderInvite = (index) => {
    const nextStakeholders = form.stakeholders.map((stakeholder, stakeholderIndex) => stakeholderIndex === index
      ? { ...stakeholder, isInvite: false }
      : stakeholder);
    setForm((current) => ({ ...current, stakeholders: nextStakeholders }));
    onSave({ stakeholders: serializeStakeholders(nextStakeholders) });
  };
  const removeStakeholder = (index) => {
    setForm((current) => ({
      ...current,
      stakeholders: current.stakeholders.filter((_, stakeholderIndex) => stakeholderIndex !== index)
    }));
  };
  const save = () => {
    if (editor === "overview") {
      onSave({
        name: form.name,
        location: form.location,
        category: form.category,
        founded: form.founded,
        website: form.website,
        businessEmail: form.businessEmail,
        annualRevenue: form.annualRevenue,
        intro: form.intro
      });
      return;
    }

    if (editor === "sourcing") {
      onSave({
        productCategories: form.productCategories,
        productionTypes: form.productionTypes,
        marketLevel: form.marketLevel,
        preferredRegions: form.preferredRegions,
        certifications: form.certifications,
        services: form.services
      });
      return;
    }

    if (editor === "sourcingVolume") {
      onSave({
        sourcingVolume: form.sourcingVolume
      });
      return;
    }

    if (editor === "stakeholders") {
      onSave({
        stakeholders: serializeStakeholders(form.stakeholders)
      });
      return;
    }

    if (editor === "verification") {
      const paymentWasAdded = form.showPaymentFields;
      onSave({
        businessEmail: form.businessEmailVerified,
        paymentStatus: paymentWasAdded ? "Verified" : data.paymentStatus,
        paymentMethodStatus: paymentWasAdded ? (form.paymentMethodType === "bank" ? "Bank account added" : "Card added") : data.paymentMethodStatus,
        verification: data.verification.map((item) => {
          if (item.name === "Business registration") return { ...item, status: "Uploaded" };
          if (item.name === "Business email") return { ...item, status: form.businessEmailVerified ? "Verified" : "Not added" };
          if (paymentWasAdded && item.name === "Payment method") return { ...item, status: form.paymentMethodType === "bank" ? "Bank added" : "Card added" };
          if (paymentWasAdded && item.name === "Payment status") return { ...item, status: "Verified" };
          return item;
        })
      });
      return;
    }

    if (editor === "payment") {
      onSave({
        paymentStatus: "Verified",
        paymentMethodStatus: form.paymentMethodType === "bank" ? "Bank account added" : "Card added",
        verification: data.verification.map((item) => {
          if (item.name === "Payment method") return { ...item, status: form.paymentMethodType === "bank" ? "Bank added" : "Card added" };
          if (item.name === "Payment status") return { ...item, status: "Verified" };
          return item;
        })
      });
      return;
    }

    onClose();
  };

  return (
    <div className="brand-profile-modal-layer" role="presentation">
      <button className="brand-profile-modal-scrim" type="button" aria-label="Close brand profile editor" onClick={onClose} />
      <section className="brand-profile-modal" role="dialog" aria-modal="true" aria-labelledby="brand-profile-edit-title">
        <button className="brand-profile-modal-close" type="button" aria-label="Close brand profile editor" onClick={onClose}>×</button>
        <header className="brand-profile-modal-header">
          <h1 id="brand-profile-edit-title">{title}</h1>
          <p>{helper}</p>
        </header>

        {editor === "overview" && (
          <div className="brand-profile-edit-grid">
            <label className="brand-profile-edit-field full-width">
              <span>Profile overview</span>
              <textarea value={form.intro} onChange={(event) => updateField("intro", event.target.value)} />
            </label>
            <BrandProfileEditField label="Brand name" value={form.name} onChange={(value) => updateField("name", value)} />
            <BrandProfileEditField
              label="Brand category"
              value={form.category}
              onChange={(value) => updateField("category", value)}
              type="select"
              options={["Fashion brand", "Retailer", "Emerging designer", "Private label"]}
            />
            <BrandProfileEditField label="Business email" value={form.businessEmail} onChange={(value) => updateField("businessEmail", value)} />
            <BrandProfileEditField label="Year founded" value={form.founded} onChange={(value) => updateField("founded", value)} />
            <BrandProfileEditField label="Website URL" value={form.website} onChange={(value) => updateField("website", value)} />
            <BrandProfileEditField label="HQ location" value={form.location} onChange={(value) => updateField("location", value)} />
          </div>
        )}

        {editor === "sourcing" && (
          <div className="brand-profile-edit-stack">
            <section className="brand-profile-edit-section">
              <h2>What do you make?</h2>
              <BrandProfileChipEditor label="Product categories" options={brandProfileEditorOptions.productCategories} selected={form.productCategories} onChange={(items) => updateField("productCategories", items)} />
              <BrandProfileChipEditor label="Production type" options={brandProfileEditorOptions.productionTypes} selected={form.productionTypes} onChange={(items) => updateField("productionTypes", items)} />
              <BrandProfileChipEditor label="Market level" options={brandProfileEditorOptions.marketLevel} selected={form.marketLevel} onChange={(items) => updateField("marketLevel", items)} singleSelect />
            </section>
            <section className="brand-profile-edit-section">
              <h2>Factory preferences</h2>
              <BrandProfileChipEditor label="Preferred regions" options={brandProfileEditorOptions.preferredRegions} selected={form.preferredRegions} onChange={(items) => updateField("preferredRegions", items)} />
              <BrandProfileChipEditor label="Certifications" options={brandProfileEditorOptions.certifications} selected={form.certifications} onChange={(items) => updateField("certifications", items)} />
              <BrandProfileChipEditor label="Services needed" options={brandProfileEditorOptions.services} selected={form.services} onChange={(items) => updateField("services", items)} />
            </section>
          </div>
        )}

        {editor === "sourcingVolume" && (
          <div className="brand-profile-edit-grid">
            <BrandProfileEditField label="Average pieces ordered per year" value={form.sourcingVolume.annualVolume} onChange={(value) => updateField("sourcingVolume", { ...form.sourcingVolume, annualVolume: value })} />
            <BrandProfileEditField label="Typical order size per style" value={form.sourcingVolume.orderSize} onChange={(value) => updateField("sourcingVolume", { ...form.sourcingVolume, orderSize: value })} />
            <BrandProfileEditField label="Collections per year" value={form.sourcingVolume.collectionsPerYear} onChange={(value) => updateField("sourcingVolume", { ...form.sourcingVolume, collectionsPerYear: value })} />
            <BrandProfileEditField label="Typical price range for core styles" value={form.sourcingVolume.targetPrice} onChange={(value) => updateField("sourcingVolume", { ...form.sourcingVolume, targetPrice: value })} />
            <BrandProfileEditField label="Typical reorder cadence" value={form.sourcingVolume.reorderCadence} onChange={(value) => updateField("sourcingVolume", { ...form.sourcingVolume, reorderCadence: value })} />
            <BrandProfileEditField label="Current sourcing stage" value={form.sourcingVolume.sourcingStage} onChange={(value) => updateField("sourcingVolume", { ...form.sourcingVolume, sourcingStage: value })} />
          </div>
        )}

        {editor === "stakeholders" && (
          <div className="brand-stakeholder-fields">
            {form.stakeholders.map((stakeholder, index) => (
              <section className="brand-stakeholder-editor-card" key={`${stakeholder.email}-${index}`}>
                <div className="brand-stakeholder-editor-header">
                  <strong>{stakeholder.name || `Stakeholder ${index + 1}`}</strong>
                  <button className="text-link" type="button" onClick={() => removeStakeholder(index)}>Remove</button>
                </div>
                <BrandProfileEditField label="Name" value={stakeholder.name} onChange={(value) => updateStakeholder(index, "name", value)} />
                <BrandProfileEditField label="Email" value={stakeholder.email} onChange={(value) => updateStakeholder(index, "email", value)} />
                <BrandProfileEditField label="Role" value={stakeholder.role} onChange={(value) => updateStakeholder(index, "role", value)} />
                {stakeholder.isInvite && (
                  <>
                    <fieldset className="settings-drawer-authority brand-stakeholder-authority">
                      <legend>Authority</legend>
                      {settingsPermissionLabels.map((permission) => (
                        <label key={permission.key}>
                          <input
                            type="checkbox"
                            checked={(stakeholder.permissions || []).includes(permission.key)}
                            onChange={() => toggleStakeholderPermission(index, permission.key)}
                          />
                          <span>
                            <strong>{permission.label}</strong>
                            {permission.detail && <small>{permission.detail}</small>}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    <div className="brand-stakeholder-invite-actions">
                      <button className="primary-btn compact-btn" type="button" onClick={() => sendStakeholderInvite(index)}>Send invite</button>
                    </div>
                  </>
                )}
              </section>
            ))}
            <button className="secondary-btn" type="button" onClick={addStakeholder}>+ Add another stakeholder</button>
          </div>
        )}

        {editor === "verification" && (
          <div className="brand-verification-editor">
            <section className="brand-verification-edit-row">
              <div>
                <strong>Business registration</strong>
                <span>Uploaded</span>
              </div>
              <button className="brand-onboarding-upload-row" type="button">
                <img src="/assets/prototype-icons/upload.svg" alt="" />
                <strong>Click or drag files to upload</strong>
              </button>
            </section>
            <section className="brand-verification-edit-row">
              <div>
                <strong>Business email</strong>
                <span>{form.businessEmailVerified ? "Verified" : "Not added"}</span>
              </div>
              <BrandProfileEditField label="Email address" value={form.businessEmailVerified} onChange={(value) => updateField("businessEmailVerified", value)} />
            </section>
            <section className="brand-verification-edit-row">
              <div>
                <strong>Payment method</strong>
                <span>{data.paymentMethodStatus}</span>
              </div>
              <button className="secondary-btn" type="button" onClick={() => updateField("showPaymentFields", !form.showPaymentFields)}>
                {form.showPaymentFields ? "Hide payment fields" : "Add payment method"}
              </button>
              {form.showPaymentFields && (
                <div className="brand-payment-editor">
                  <div className="brand-payment-method-toggle" role="group" aria-label="Payment method type">
                    <button className={form.paymentMethodType === "card" ? "selected" : ""} type="button" onClick={() => updateField("paymentMethodType", "card")}>Credit card</button>
                    <button className={form.paymentMethodType === "bank" ? "selected" : ""} type="button" onClick={() => updateField("paymentMethodType", "bank")}>Bank account</button>
                  </div>
                  {form.paymentMethodType === "card" ? (
                    <div className="brand-profile-edit-grid">
                      <BrandProfileEditField label="Cardholder name" value={form.paymentName} onChange={(value) => updateField("paymentName", value)} />
                      <BrandProfileEditField label="Card number" value={form.cardNumber} onChange={(value) => updateField("cardNumber", value)} />
                      <BrandProfileEditField label="Expiry" value={form.cardExpiry} onChange={(value) => updateField("cardExpiry", value)} />
                      <BrandProfileEditField label="CVC" value={form.cardCvc} onChange={(value) => updateField("cardCvc", value)} />
                    </div>
                  ) : (
                    <div className="brand-profile-edit-grid">
                      <BrandProfileEditField label="Account holder" value={form.paymentName} onChange={(value) => updateField("paymentName", value)} />
                      <BrandProfileEditField label="Bank name" value={form.bankName} onChange={(value) => updateField("bankName", value)} />
                      <BrandProfileEditField label="Routing number" value={form.routingNumber} onChange={(value) => updateField("routingNumber", value)} />
                      <BrandProfileEditField label="Account number" value={form.accountNumber} onChange={(value) => updateField("accountNumber", value)} />
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {editor === "payment" && (
          <div className="brand-payment-editor">
            <div className="brand-payment-method-toggle" role="group" aria-label="Payment method type">
              <button className={form.paymentMethodType === "card" ? "selected" : ""} type="button" onClick={() => updateField("paymentMethodType", "card")}>Credit card</button>
              <button className={form.paymentMethodType === "bank" ? "selected" : ""} type="button" onClick={() => updateField("paymentMethodType", "bank")}>Bank account</button>
            </div>
            {form.paymentMethodType === "card" ? (
              <div className="brand-profile-edit-grid">
                <BrandProfileEditField label="Cardholder name" value={form.paymentName} onChange={(value) => updateField("paymentName", value)} />
                <BrandProfileEditField label="Card number" value={form.cardNumber} onChange={(value) => updateField("cardNumber", value)} />
                <BrandProfileEditField label="Expiry" value={form.cardExpiry} onChange={(value) => updateField("cardExpiry", value)} />
                <BrandProfileEditField label="CVC" value={form.cardCvc} onChange={(value) => updateField("cardCvc", value)} />
              </div>
            ) : (
              <div className="brand-profile-edit-grid">
                <BrandProfileEditField label="Account holder" value={form.paymentName} onChange={(value) => updateField("paymentName", value)} />
                <BrandProfileEditField label="Bank name" value={form.bankName} onChange={(value) => updateField("bankName", value)} />
                <BrandProfileEditField label="Routing number" value={form.routingNumber} onChange={(value) => updateField("routingNumber", value)} />
                <BrandProfileEditField label="Account number" value={form.accountNumber} onChange={(value) => updateField("accountNumber", value)} />
              </div>
            )}
            <p>Quotes can still be drafted. This verifies the profile payment signal and prepares the account for production milestones.</p>
          </div>
        )}

        {isUploadEditor && (
          <BrandProfileAssetEditor
            assets={editor === "assets" ? data.assets : getBrandProfileMediaAssets(editor, data)}
            uploadHelper={editor === "projects" ? "Add completed work, active production, or sampling proof that helps factories understand how this brand works." : editor === "assets" ? "Add logos, product photos, direction files, or brand references." : "Add another image or file."}
            itemType={editor === "projects" ? "project" : "image"}
          />
        )}

        <footer className="brand-profile-modal-actions">
          <button className="secondary-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-btn" type="button" onClick={save}>Save changes</button>
        </footer>
      </section>
    </div>
  );
}

function getBrandProfileMediaAssets(editor, data) {
  if (editor === "banner") {
    return [{ title: "Profile banner", meta: "Current profile header image", src: data.heroImage || "/assets/header-images.png" }];
  }

  if (editor === "projects") {
    const projects = [...(data.completedProjects || []), ...(data.activeProjects || [])];

    return projects.map((project, index) => ({
      title: project.title,
      meta: `${project.partner || "Factory partner"} · ${project.result}`,
      src: ["/assets/dashboard-rfq-shirt.jpg", "/assets/dashboard-rfq-denim.jpg", "/assets/dashboard-rfq-knit.jpg"][index % 3]
    }));
  }

  return [];
}

function BrandProfileAssetEditor({ assets, uploadHelper, itemType = "image" }) {
  const [items, setItems] = useState(assets);
  const [addImageOpen, setAddImageOpen] = useState(false);
  const [openAssetMenu, setOpenAssetMenu] = useState("");
  const [editingAsset, setEditingAsset] = useState(null);
  const isProject = itemType === "project";

  return (
    <div className="brand-profile-upload-panel">
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
        <ProfileAssetUploadDialog
          helper={uploadHelper}
          itemType={itemType}
          onClose={() => setAddImageOpen(false)}
        />
      )}
      {editingAsset && (
        <ProfileAssetUploadDialog
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

function ProfileAssetUploadDialog({ asset = null, helper, itemType = "image", mode = "add", onClose }) {
  const isEdit = mode === "edit";
  const isProject = itemType === "project";

  return (
    <div className="profile-asset-upload-layer" role="presentation">
      <button className="profile-asset-upload-scrim" type="button" aria-label={isEdit ? "Close edit image dialog" : "Close add image dialog"} onClick={onClose} />
      <section className="profile-asset-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-asset-upload-title">
        <button className="brand-profile-modal-close profile-asset-upload-close" type="button" aria-label={isEdit ? "Close edit image dialog" : "Close add image dialog"} onClick={onClose}>×</button>
        <header>
          <h2 id="profile-asset-upload-title">{isEdit ? (isProject ? "Edit project" : "Edit image") : (isProject ? "Add project" : "Add image")}</h2>
          <p>{helper}</p>
        </header>
        {isEdit && asset?.src && (
          <div className="profile-asset-edit-preview">
            <img src={asset.src} alt={`${asset.title} preview`} />
          </div>
        )}
        <button className="brand-profile-file-upload" type="button">
          <img src="/assets/prototype-icons/upload.svg" alt="" />
          <strong>{isEdit ? (isProject ? "Click or drag files to replace project image" : "Click or drag files to replace image") : "Click or drag files to upload"}</strong>
        </button>
        <div className="profile-asset-metadata-grid">
          <label>
            <span>{isProject ? "Project title" : "Image name"}</span>
            <input defaultValue={asset?.title || ""} placeholder={isProject ? "e.g. Organic cotton woven shirt production" : "e.g. Organic poplin fit sample"} />
          </label>
          <label>
            <span>{isProject ? "Project summary" : "Description"}</span>
            <input defaultValue={asset?.meta || ""} placeholder={isProject ? "e.g. Factory partner · Completed on time" : "e.g. Wovens · sample development"} />
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

function BrandProfileEditField({ label, value, onChange, type = "text", options = [] }) {
  return (
    <label className="brand-profile-edit-field">
      <span>{label}</span>
      {type === "select" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => <option value={option} key={option}>{option}</option>)}
        </select>
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function BrandProfileChipEditor({ label, options, selected, onChange, singleSelect = false }) {
  const toggleOption = (option) => {
    if (singleSelect) {
      onChange([option]);
      return;
    }

    onChange(selected.includes(option)
      ? selected.filter((item) => item !== option)
      : [...selected, option]);
  };

  return (
    <section className="brand-onboarding-chip-group brand-profile-chip-editor">
      <strong>{label}</strong>
      <div className="tag-row compact-tags">
        {options.map((option) => (
          <button
            className={selected.includes(option) ? "selected" : ""}
            type="button"
            aria-pressed={selected.includes(option)}
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

function BrandProfileChipSection({ label, items }) {
  return (
    <div className="factory-profile-chip-section">
      <span>{label}</span>
      <div className="tag-row compact-tags">
        {items.map((item) => <span className="tag garment-tag" key={item}>{item}</span>)}
      </div>
    </div>
  );
}

function BrandProfileDetailPair({ label, value }) {
  return (
    <div className="factory-detail-pair">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProjectCard({ title, dates, body, quote }) {
  return (
    <article className="card project-card">
      <div>
        <h3>{title}</h3>
        <button className="text-link" type="button">View</button>
      </div>
      <strong>{dates}</strong>
      <p>{body}</p>
      <em>"{quote}"</em>
    </article>
  );
}

function CertificationCard({ title, detail, icon }) {
  return (
    <article className="cert-card">
      <img src={`/assets/prototype-icons/${icon}.svg`} alt="" />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

function FactorySearchScreen({ goTo }) {
  return (
    <div className="directory-shell">
      <section className="directory-filter-panel" aria-label="Factory filters">
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
        <FilterGroup title="MOQ range">
          <div className="moq-chart" aria-hidden="true">
            {[18, 34, 47, 28, 58, 44, 36, 24, 31].map((height, index) => (
              <span style={{ height }} key={index} />
            ))}
            <i className="moq-track" />
            <b className="moq-handle min" />
            <b className="moq-handle max" />
          </div>
          <div className="moq-values">
            <span>150</span>
            <span>500+</span>
          </div>
        </FilterGroup>
        <FilterGroup title="Location">
          <div className="directory-chip-grid">
            {["China", "Portugal", "Korea", "Europe", "India", "Turkey", "USA"].map((label) => (
              <button className="directory-chip" type="button" key={label}>{label}</button>
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
        <FilterGroup title="Lead time">
          <div className="directory-chip-grid">
            {["Under 30 days", "30-45 days", "45+ days"].map((label) => (
              <button className={label === "Under 30 days" ? "directory-chip selected" : "directory-chip"} type="button" key={label}>{label}</button>
            ))}
          </div>
        </FilterGroup>
        <FilterGroup title="Club Standard">
          <FilterCheck checked label="Trusted" icon="trusted" />
          <FilterCheck label="Verified" icon="verified" />
          <FilterCheck label="Basic" icon="basic" />
        </FilterGroup>
        <FilterGroup title="Open capacity">
          <label className="directory-select">
            <span>Start window</span>
            <select defaultValue="">
              <option value="" disabled>Select start window</option>
              <option>Next 30 days</option>
              <option>August</option>
            </select>
          </label>
          <label className="directory-select">
            <span>Available quantity</span>
            <select defaultValue="">
              <option value="" disabled>Select quantity</option>
              <option>300-500 units</option>
              <option>500+ units</option>
            </select>
          </label>
          <div className="directory-capacity-presets">
            <button className="directory-chip" type="button">Next 30 days</button>
            <button className="directory-chip" type="button">300-500 units</button>
          </div>
          <p>Use quick presets, or open the dropdowns for exact windows and quantities.</p>
        </FilterGroup>
      </section>

      <section className="directory-results" aria-label="Factory search results">
        <header className="directory-hero">
          <div>
            <p className="eyebrow">FACTORY DIRECTORY</p>
            <h1>SEARCH VETTED FACTORIES</h1>
          </div>
          <label className="directory-search">
            <SearchIcon />
            <input placeholder="Search cut & sew, denim, Portugal..." />
          </label>
        </header>
        <div className="directory-summary">
          <div>
            <strong>36 factories</strong>
            <span>matching cut & sew, low MOQ, Trusted or Verified standard</span>
          </div>
          <div className="directory-summary-actions">
            <button className="filter-button sort-button" type="button">Sort: Best fit</button>
            <button className="filter-button sort-button" type="button" onClick={() => goTo("factoryMarketplace")}>Marketplace cards</button>
          </div>
        </div>
        <div className="directory-card-list">
          {directoryFactories.map((factory) => (
            <DirectoryFactoryCard factory={factory} key={factory.name} onQuote={() => goTo("describe")} />
          ))}
        </div>
      </section>
    </div>
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

function FilterCheck({ checked = false, label, icon }) {
  return (
    <label className="directory-check">
      <input type="checkbox" defaultChecked={checked} />
      {icon && <img src={`/assets/prototype-icons/${icon}.svg`} alt="" />}
      <span>{label}</span>
    </label>
  );
}

function DirectoryFactoryCard({ factory, onQuote }) {
  return (
    <article className={factory.featured ? "directory-factory-card featured" : "directory-factory-card"}>
      <div className="directory-factory-intro">
        <div className="factory-avatar">{factory.initials}</div>
        <div>
          <div className="factory-name-row">
            <h2>{factory.name}</h2>
            <img className="trust-icon" src={`/assets/prototype-icons/${factory.trust}.svg`} alt={`${factory.trust} factory`} />
          </div>
          <p>{factory.location}</p>
          <strong>{factory.specialty}</strong>
        </div>
      </div>
      <div className="directory-factory-metrics">
        <Metric label="match" value={factory.match} className={matchTierClass(factory.match)} />
        <Metric label="rating" value={factory.rating} />
        <span>{factory.orders}</span>
      </div>
      <div className="directory-factory-actions">
        <button className="secondary-btn" type="button">Save</button>
        <button className="primary-btn" type="button" onClick={onQuote}>Request quote</button>
      </div>
      <div className="tag-row compact-tags directory-tags">
        {factory.tags.map((tag) => (
          <span className="tag" key={tag}>{tag}</span>
        ))}
      </div>
      <div className="tag-row compact-tags directory-capacity-tags">
        {factory.capacity.map((tag) => (
          <span className="tag blue-tag" key={tag}>{tag}</span>
        ))}
      </div>
      <div className="directory-insight-box">
        <strong>Insights about this factory</strong>
        {factory.insight.map((line) => (
          <p key={line}>• {line}</p>
        ))}
      </div>
    </article>
  );
}

function FactoryMarketplaceScreen({ goTo }) {
  return (
    <div className="marketplace-shell">
      <aside className="marketplace-filter-panel" aria-label="Marketplace filters">
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
        <FilterGroup title="Specializes in">
          <FilterCheck checked label="Small-batch production" />
          <FilterCheck label="Fit sample support" />
          <FilterCheck label="Wash development" />
          <FilterCheck label="Yarn sourcing" />
          <FilterCheck label="Embroidery / print" />
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
        <FilterGroup title="MOQ range">
          <div className="moq-chart" aria-hidden="true">
            {[18, 34, 47, 28, 58, 44, 36, 24, 31].map((height, index) => (
              <span style={{ height }} key={index} />
            ))}
            <i className="moq-track" />
            <b className="moq-handle min" />
            <b className="moq-handle max" />
          </div>
          <div className="moq-values">
            <span>150</span>
            <span>500+</span>
          </div>
        </FilterGroup>
        <FilterGroup title="Location">
          <div className="directory-chip-grid">
            {["China", "Portugal", "Korea", "Europe", "India", "Turkey", "USA"].map((label) => (
              <button className="directory-chip" type="button" key={label}>{label}</button>
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
        <FilterGroup title="Lead time">
          <div className="directory-chip-grid">
            {["Under 30 days", "30-45 days", "45+ days"].map((label) => (
              <button className={label === "Under 30 days" ? "directory-chip selected" : "directory-chip"} type="button" key={label}>{label}</button>
            ))}
          </div>
        </FilterGroup>
        <FilterGroup title="Club Standard">
          <FilterCheck checked label="Trusted" icon="trusted" />
          <FilterCheck label="Verified" icon="verified" />
          <FilterCheck label="Basic" icon="basic" />
        </FilterGroup>
        <FilterGroup title="Open capacity">
          <label className="directory-select">
            <span>Start window</span>
            <select defaultValue="">
              <option value="" disabled>Select start window</option>
              <option>Next 30 days</option>
              <option>August</option>
            </select>
          </label>
          <label className="directory-select">
            <span>Available quantity</span>
            <select defaultValue="">
              <option value="" disabled>Select quantity</option>
              <option>300-500 units</option>
              <option>500+ units</option>
            </select>
          </label>
          <div className="directory-capacity-presets">
            <button className="directory-chip" type="button">Next 30 days</button>
            <button className="directory-chip" type="button">300-500 units</button>
          </div>
          <p>Use quick presets, or open the dropdowns for exact windows and quantities.</p>
        </FilterGroup>
      </aside>

      <section className="marketplace-results" aria-label="Factory marketplace results">
        <header className="marketplace-header">
          <div>
            <p className="eyebrow">FACTORY DIRECTORY</p>
              <h1>Browse factories</h1>
          </div>
          <label className="directory-search marketplace-search">
            <SearchIcon />
            <input placeholder="Search shirts, cardigans, denim wash, baby rompers..." />
          </label>
        </header>
        <div className="marketplace-summary">
          <div>
            <strong>36 factories</strong>
            <span>showing larger samples, exact garment tags, specialties, and verified capability notes</span>
          </div>
          <div className="directory-summary-actions">
            <button className="filter-button sort-button" type="button">Sort: Best fit</button>
          </div>
        </div>
        <div className="marketplace-card-list">
          {marketplaceFactories.map((factory) => (
            <MarketplaceFactoryCard factory={factory} key={factory.name} onQuote={() => goTo("describe")} />
          ))}
        </div>
      </section>
    </div>
  );
}

function MarketplaceFactoryCard({ factory, onQuote }) {
  const [sampleScroll, setSampleScroll] = useState({ left: false, right: true });
  const updateSampleScroll = (element) => {
    if (!element) return;
    const remaining = element.scrollWidth - element.clientWidth - element.scrollLeft;
    setSampleScroll({
      left: element.scrollLeft > 4,
      right: remaining > 4
    });
  };

  return (
    <article className={factory.featured ? "marketplace-factory-card featured" : "marketplace-factory-card"}>
      <div className="marketplace-factory-top">
        <div className="marketplace-factory-title">
          <div className="factory-avatar">{factory.initials}</div>
          <div>
            <div className="factory-name-row">
              <h2>{factory.name}</h2>
              <img className="trust-icon" src={`/assets/prototype-icons/${factory.trust}.svg`} alt={`${factory.trust} factory`} />
            </div>
            <p>{factory.location}</p>
          </div>
        </div>
        <div className="marketplace-factory-metrics">
          <Metric label="match" value={factory.match} className={matchTierClass(factory.match)} />
          <Metric label="rating" value={factory.rating} />
          <span>{factory.orders}</span>
        </div>
        <div className="marketplace-factory-actions">
          <button className="secondary-btn" type="button">Save</button>
          <button className="secondary-btn" type="button">Message</button>
          <button className="primary-btn" type="button" onClick={onQuote}>Request quote</button>
        </div>
      </div>

      <div className="marketplace-factory-body">
        <div className="marketplace-spec-panel">
          <div className="marketplace-stat-grid">
            {factory.stats.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="marketplace-note-list">
            <p>{factory.notes[0]}</p>
          </div>
        </div>

        <div className="marketplace-samples-shell">
          <button
            className={sampleScroll.left ? "marketplace-samples-prev visible" : "marketplace-samples-prev"}
            type="button"
            aria-label="Scroll sample images back"
            onClick={(event) => {
              const scroller = event.currentTarget.nextElementSibling;
              scroller?.scrollBy({ left: -240, behavior: "smooth" });
              window.setTimeout(() => updateSampleScroll(scroller), 260);
            }}
          >
            <img src="/assets/prototype-icons/dropdown.svg" alt="" />
          </button>
          <div
            className="marketplace-samples"
            aria-label={`${factory.name} sample products`}
            onScroll={(event) => updateSampleScroll(event.currentTarget)}
          >
            {factory.products.map((product) => (
              <figure className={product.factory ? "marketplace-sample factory-media" : "marketplace-sample"} key={product.name}>
                <img src={product.image} alt={`${factory.name} ${product.name}`} />
                <figcaption>
                  <strong>{product.name}</strong>
                </figcaption>
              </figure>
            ))}
          </div>
          <button
            className={sampleScroll.right ? "marketplace-samples-next visible" : "marketplace-samples-next"}
            type="button"
            aria-label="Scroll sample images"
            onClick={(event) => {
              const scroller = event.currentTarget.previousElementSibling;
              scroller?.scrollBy({ left: 240, behavior: "smooth" });
              window.setTimeout(() => updateSampleScroll(scroller), 260);
            }}
          >
            <img src="/assets/prototype-icons/dropdown.svg" alt="" />
          </button>
        </div>
      </div>

      <div className="marketplace-tag-section">
        <div>
          <span className="marketplace-tag-label">Makes</span>
          <div className="tag-row compact-tags">
            {factory.categories.map((tag) => (
              <span className="tag garment-tag" key={tag}>{tag}</span>
            ))}
          </div>
        </div>
        <div>
          <span className="marketplace-tag-label">Specializes in</span>
          <div className="tag-row compact-tags">
            {factory.capabilities.map((tag) => (
              <span className="tag blue-tag" key={tag}>{tag}</span>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function SavedFactoriesScreen({ goTo }) {
  const savedFactories = marketplaceFactories.slice(0, 4);

  return (
    <div className="rfqs-shell saved-shell">
      <header className="rfqs-header saved-header">
        <div>
          <h1>Saved factories</h1>
          <p>Factories Maison Rue saved for current quotes, future sourcing, and production follow-up.</p>
        </div>
        <button className="secondary-btn" type="button" onClick={() => goTo("factoryMarketplace")}>Browse factories</button>
      </header>

      <section className="rfqs-controls saved-controls" aria-label="Saved factory filters">
        <label className="rfqs-search">
          <span>Search saved factories</span>
          <div>
            <SearchIcon />
            <input placeholder="Factory name, category, location..." />
          </div>
        </label>
        <label className="rfqs-sort">
          <span>Sort By</span>
          <select defaultValue="recent">
            <option value="recent">Recently saved</option>
            <option value="fit">Best fit</option>
            <option value="rating">Highest rating</option>
          </select>
        </label>
      </section>

      <section className="saved-card-grid" aria-label="Saved factories">
        {savedFactories.map((factory) => (
          <SavedFactoryCard factory={factory} goTo={goTo} key={factory.name} />
        ))}
      </section>
    </div>
  );
}

function SavedFactoryCard({ factory, goTo }) {
  const previews = factory.products || [];
  const [sampleScroll, setSampleScroll] = useState({ left: false, right: true });
  const updateSampleScroll = (element) => {
    if (!element) return;
    const remaining = element.scrollWidth - element.clientWidth - element.scrollLeft;
    setSampleScroll({
      left: element.scrollLeft > 4,
      right: remaining > 4
    });
  };

  return (
    <article className="saved-factory-card">
      <header className="saved-factory-card-top">
        <div className="marketplace-factory-title saved-factory-identity">
          <div className="factory-avatar">{factory.initials}</div>
          <div>
            <div className="factory-name-row">
              <h2>{factory.name}</h2>
              <img className="trust-icon" src={`/assets/prototype-icons/${factory.trust}.svg`} alt={`${factory.trust} factory`} />
            </div>
            <p>{factory.location}</p>
          </div>
        </div>
        <div className="saved-factory-meta">
          <Metric label="match" value={factory.match} className={matchTierClass(factory.match)} />
          <Metric label="rating" value={factory.rating} />
          <span className="saved-factory-orders">{factory.orders}</span>
        </div>
        <div className="saved-factory-actions">
          <button className="secondary-btn" type="button">Message</button>
          <button className="primary-btn" type="button" onClick={() => goTo("describe")}>Request quote</button>
        </div>
      </header>

      <div className="saved-factory-card-body">
        <aside className="marketplace-spec-panel saved-factory-profile-copy">
          <div className="saved-factory-stat-grid">
            {factory.stats.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p>{factory.notes?.[0]}</p>
          <div className="saved-factory-tag-section">
            <span className="marketplace-tag-label">Makes</span>
            <div className="tag-row compact-tags">
              {factory.categories.slice(0, 4).map((tag) => (
                <span className="tag garment-tag" key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        </aside>
        {previews.length > 0 && (
          <div className="saved-factory-samples-shell">
            <button
              className={sampleScroll.left ? "marketplace-samples-prev visible" : "marketplace-samples-prev"}
              type="button"
              aria-label="Scroll saved sample images back"
              onClick={(event) => {
                const scroller = event.currentTarget.nextElementSibling;
                scroller?.scrollBy({ left: -220, behavior: "smooth" });
                window.setTimeout(() => updateSampleScroll(scroller), 260);
              }}
            >
              <img src="/assets/prototype-icons/dropdown.svg" alt="" />
            </button>
            <div
              className="saved-factory-samples"
              aria-label={`${factory.name} saved sample products`}
              onScroll={(event) => updateSampleScroll(event.currentTarget)}
            >
              {previews.map((preview) => (
                <figure className={preview.factory ? "saved-factory-visual factory-media" : "saved-factory-visual"} key={preview.name}>
                  <img src={preview.image} alt={`${factory.name} ${preview.name}`} />
                  <figcaption>{preview.name}</figcaption>
                </figure>
              ))}
            </div>
            <button
              className={sampleScroll.right ? "marketplace-samples-next visible" : "marketplace-samples-next"}
              type="button"
              aria-label="Scroll saved sample images"
              onClick={(event) => {
                const scroller = event.currentTarget.previousElementSibling;
                scroller?.scrollBy({ left: 220, behavior: "smooth" });
                window.setTimeout(() => updateSampleScroll(scroller), 260);
              }}
            >
              <img src="/assets/prototype-icons/dropdown.svg" alt="" />
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function RfqsScreen({ goTo }) {
  const [activeTab, setActiveTab] = useState("active");
  const [rfqTabs, setRfqTabs] = useState([
    { key: "active", label: "Active quotes (4)", locked: true },
    { key: "drafts", label: "Drafts (2)", locked: true },
    { key: "closed", label: "Closed (6)", locked: true }
  ]);
  const [isAddingTab, setIsAddingTab] = useState(false);
  const [newTabName, setNewTabName] = useState("");
  const [manageTabsOpen, setManageTabsOpen] = useState(false);
  const [draftTabs, setDraftTabs] = useState(rfqTabs);
  const rfqDataByTab = {
    active: activeRfqs,
    drafts: draftRfqs,
    closed: closedRfqs
  };
  const activeRfqsForTab = rfqDataByTab[activeTab] || activeRfqs;
  const customTabs = rfqTabs.filter((tab) => !tab.locked).map((tab) => tab.label);

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
    <div className="rfqs-shell">
      <header className="rfqs-header">
        <div>
          <h1>Quotes</h1>
          <p>Track live factory quote requests, compare responses, and move selected quotes toward contract terms.</p>
        </div>
        <button className="primary-btn" type="button" onClick={() => goTo("describe")}>Request new quote</button>
      </header>

      <section className="rfqs-controls" aria-label="Quote filters">
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
            <option value="quotes">Most Quotes</option>
          </select>
        </label>
      </section>

      <nav className="rfqs-tabs projects-tabs" aria-label="Quote status">
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
        <button className="project-tab-add project-tab-manage" type="button" onClick={openManageTabs}>
          Manage tabs
        </button>
      </nav>

      {manageTabsOpen && createPortal(
        <div className="brand-profile-modal-layer">
          <button className="brand-profile-modal-scrim" type="button" aria-label="Close tab manager" onClick={() => setManageTabsOpen(false)} />
          <section className="brand-profile-modal project-tabs-modal" role="dialog" aria-modal="true" aria-labelledby="rfq-tabs-title">
            <button className="brand-profile-modal-close" type="button" aria-label="Close" onClick={() => setManageTabsOpen(false)}>×</button>
            <header className="brand-profile-modal-header">
              <h1 id="rfq-tabs-title">Manage tabs</h1>
              <p>Create quote tabs for styles, seasons, collections, or any request grouping your team uses.</p>
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

      <section className="rfq-list" aria-label={`${activeTab} quotes`}>
        {activeRfqsForTab.map((rfq) => (
          <RfqCard rfq={rfq} goTo={goTo} customTabs={customTabs} key={rfq.title} />
        ))}
      </section>
    </div>
  );
}

function RfqCard({ rfq, goTo, customTabs = [] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const [quotesReceived, invitedCount, messageCount] = rfq.metrics;
  const quoteDue = rfq.date.split("Quote due ")[1] || "TBD";
  const [primaryImage] = rfq.images || [];
  const facts = [
    ["Quotes received", quotesReceived[0]],
    ["Invited", invitedCount[0]],
    ["Messages", messageCount[0]],
    ["Quote due", quoteDue]
  ];

  useEffect(() => {
    if (!menuOpen) return undefined;

    function closeOnOutsideClick(event) {
      if (menuRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [menuOpen]);

  return (
    <article className={rfq.featured ? "rfq-card featured" : "rfq-card"}>
      <header className="rfq-card-top">
        <div className="rfq-title-row">
          <div className="rfq-main">
            <h2>{rfq.title}</h2>
            <p className="rfq-date">{rfq.date}</p>
          </div>
        </div>
        <div className="rfq-card-actions">
          <span className={`tag rfq-status ${rfq.statusTone}`}>{rfq.status}</span>
          <button className="primary-btn" type="button" onClick={() => goTo("quotes")}>View quote</button>
          <div className="project-overflow" ref={menuRef}>
            <button
              className="rfq-more"
              type="button"
              aria-label={`More options for ${rfq.title}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              ...
            </button>
            {menuOpen && (
              <div className="project-overflow-menu rfq-overflow-menu" role="menu">
                <div className="project-overflow-submenu">
                  <button type="button" role="menuitem">Add to</button>
                  {customTabs.length > 0 && (
                    <div className="project-overflow-submenu-panel">
                      {customTabs.map((tab) => (
                        <button type="button" role="menuitem" key={tab} onClick={() => setMenuOpen(false)}>
                          {tab}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button type="button" role="menuitem" onClick={() => goTo("review")}>Edit quote</button>
                <button type="button" role="menuitem" onClick={() => goTo("describe")}>Duplicate quote</button>
                <button type="button" role="menuitem" onClick={() => goTo("invite")}>Invite more factories</button>
                <button type="button" role="menuitem" onClick={() => setMenuOpen(false)}>Archive quote</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="rfq-card-body">
        <aside className="rfq-brief">
          <div className="rfq-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className="rfq-description">{rfq.description}</p>
          <div className="rfq-tag-section">
            <span className="marketplace-tag-label">Request tags</span>
            <div className="tag-row compact-tags rfq-tags">
              {rfq.tags.map((tag) => (
                <span className="tag" key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        </aside>

        <div className="rfq-visuals" aria-label={`${rfq.title} reference images`}>
          {primaryImage && (
            <figure className="rfq-visual-main">
              <img src={primaryImage.src} alt={`${rfq.title} ${primaryImage.label}`} />
              <figcaption>{primaryImage.label}</figcaption>
            </figure>
          )}
        </div>
      </div>
    </article>
  );
}

function ProjectsScreen({ goTo, setSelectedReorderProject }) {
  const [activeTab, setActiveTab] = useState("active");
  const [projectTabs, setProjectTabs] = useState([
    { key: "active", label: "Active orders (4)", locked: true },
    { key: "closed", label: "Closed (6)", locked: true },
    { key: "custom-Spring 27", label: "Spring 27", locked: false }
  ]);
  const [isAddingTab, setIsAddingTab] = useState(false);
  const [newTabName, setNewTabName] = useState("");
  const [manageTabsOpen, setManageTabsOpen] = useState(false);
  const [draftTabs, setDraftTabs] = useState(projectTabs);
  const customTabs = projectTabs.filter((tab) => !tab.locked).map((tab) => tab.label);

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
    <div className="rfqs-shell projects-shell">
      <header className="rfqs-header projects-header">
        <div>
          <h1>Production orders</h1>
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
            <option value="factory">Factory</option>
          </select>
        </label>
      </section>

      <nav className="rfqs-tabs projects-tabs" aria-label="Project status">
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
        <button className="project-tab-add project-tab-manage" type="button" onClick={openManageTabs}>
          Manage tabs
        </button>
      </nav>

      {manageTabsOpen && createPortal(
        <div className="brand-profile-modal-layer">
          <button className="brand-profile-modal-scrim" type="button" aria-label="Close tab manager" onClick={() => setManageTabsOpen(false)} />
          <section className="brand-profile-modal project-tabs-modal" role="dialog" aria-modal="true" aria-labelledby="project-tabs-title">
            <button className="brand-profile-modal-close" type="button" aria-label="Close" onClick={() => setManageTabsOpen(false)}>×</button>
            <header className="brand-profile-modal-header">
              <h1 id="project-tabs-title">Manage tabs</h1>
              <p>Create tabs for collections, seasons, factories, or any order grouping your team uses.</p>
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

      <section className="projects-list" aria-label={activeTab === "closed" ? "Closed orders" : "Active orders"}>
        {activeProjects.map((project) => (
          <ProjectListCard
            project={project}
            goTo={goTo}
            customTabs={customTabs}
            setSelectedReorderProject={setSelectedReorderProject}
            key={project.title}
          />
        ))}
      </section>
    </div>
  );
}

function ProjectListCard({ project, goTo, actionLabel = "View details", customTabs = [], setSelectedReorderProject = null }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const projectFacts = [
    ["Current step", project.currentStep],
    ["Next due", project.nextDue]
  ];

  useEffect(() => {
    if (!menuOpen) return undefined;

    function closeOnOutsideClick(event) {
      if (menuRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [menuOpen]);

  return (
    <article className={project.featured ? "brand-project-card featured" : "brand-project-card"}>
      <header className="project-card-top">
        <div className="project-main">
          <h2>{project.title}</h2>
          <p className="project-meta">{project.factory} · {project.location} · {project.started}</p>
        </div>
        <div className="project-actions">
          <span className={`project-status ${project.statusTone}`}>{project.status}</span>
          <button className="secondary-btn" type="button">Message</button>
          <button className="primary-btn" type="button" onClick={() => goTo("projectDetail")}>{actionLabel}</button>
          <div className="project-overflow" ref={menuRef}>
            <button className="rfq-more" type="button" aria-label="More order actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>...</button>
            {menuOpen && (
              <div className="project-overflow-menu" role="menu">
                <div className="project-overflow-submenu">
                  <button type="button" role="menuitem">Add to</button>
                  <div className="project-overflow-submenu-panel">
                    {customTabs.map((tab) => (
                      <button type="button" role="menuitem" key={tab} onClick={() => setMenuOpen(false)}>
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSelectedReorderProject?.(project);
                    setMenuOpen(false);
                    goTo("contract");
                  }}
                >
                  Reorder style
                </button>
                <button type="button" role="menuitem" onClick={() => setMenuOpen(false)}>Archive order</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="project-card-body">
        <aside className="project-card-brief">
          <div className="project-facts">
            {projectFacts.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className="project-description">{project.description}</p>
          <div className="project-status-row">
            <span><strong>Current status:</strong> {project.statusDetail}</span>
          </div>
          <ProjectProgress progress={project.progress} />
        </aside>

        <div className="project-visuals" aria-label={`${project.title} production reference`}>
          {project.image && (
            <figure>
              <img src={project.image.src} alt={`${project.title} ${project.image.label}`} />
              <figcaption>{project.image.label}</figcaption>
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
            <small>{progress === 1 && index === 0 ? "Need funding" : step}</small>
          </div>
        );
      })}
    </div>
  );
}

function ProjectDetailScreen({ goTo, goToFundingMilestone }) {
  const [activeDetailTab, setActiveDetailTab] = useState("overview");
  const [approveFundMilestone, setApproveFundMilestone] = useState(null);
  const [paidMilestones, setPaidMilestones] = useState([]);
  const [approvalMilestone, setApprovalMilestone] = useState(null);
  const [approvedMilestones, setApprovedMilestones] = useState([]);
  const detailTabs = [
    ["overview", "Overview"],
    ["files", "Files"],
    ["contract", "Contract details"]
  ];

  return (
    <div className="project-detail-shell">
      <button className="project-back-link" type="button" onClick={() => goTo("projects")}>‹ Back to production orders</button>
      <header className="project-detail-header">
        <h1>Organic cotton woven shirt production</h1>
        <p>Atelier Minho · Porto, Portugal · Started Jul 19</p>
      </header>

      <div className="project-detail-layout">
        <div className="project-detail-main">
          <section className="project-summary-strip" aria-label="Project summary">
            <Metric label="project total" value="$5,780" />
            <Metric label="project funds" value="$120" />
            <Metric label="remaining" value="$5,660" />
            <Metric label="next payment" value="$1,656" className="highlight" />
          </section>

          <nav className="rfqs-tabs project-detail-tabs" aria-label="Project detail sections">
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
            <section className="milestone-timeline-card">
              <h2>Production timeline</h2>
              <div className="milestone-timeline-list">
                {projectDetailMilestones.map((milestone, index) => (
                  <ProjectMilestoneItem
                    milestone={milestone}
                    index={index}
                    isPaid={paidMilestones.includes(milestone.title)}
                    isApproved={approvedMilestones.includes(milestone.title)}
                    onApproveFund={setApproveFundMilestone}
                    onFundMilestone={goToFundingMilestone}
                    onApprove={setApprovalMilestone}
                    key={milestone.title}
                  />
                ))}
              </div>
              <button className="secondary-btn manage-milestones" type="button">Manage milestones</button>
            </section>
          )}
          {activeDetailTab === "files" && <ProjectFilesPanel />}
          {activeDetailTab === "contract" && <ProjectContractDetailsPanel goTo={goTo} />}
        </div>

        <aside className="project-detail-side">
          <section className="project-factory-panel">
            <div className="project-factory-row">
              <div className="factory-avatar">AM</div>
              <div>
                <strong>Atelier Minho</strong>
                <span>Porto, Portugal</span>
              </div>
            </div>
            <button className="secondary-btn" type="button">Message</button>
          </section>
          <section className="project-activity-panel">
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
      {approveFundMilestone && createPortal((
        <ApproveFundModal
          milestone={approveFundMilestone}
          onClose={() => setApproveFundMilestone(null)}
          onApprove={() => {
            setPaidMilestones((current) => current.includes(approveFundMilestone.title) ? current : [...current, approveFundMilestone.title]);
            setApproveFundMilestone(null);
          }}
        />
      ), document.body)}
      {approvalMilestone && createPortal((
        <ApproveMilestoneModal
          milestone={approvalMilestone}
          onClose={() => setApprovalMilestone(null)}
          onApprove={() => {
            setApprovedMilestones((current) => current.includes(approvalMilestone.title) ? current : [...current, approvalMilestone.title]);
            setApprovalMilestone(null);
          }}
        />
      ), document.body)}
    </div>
  );
}

function ProjectFilesPanel() {
  const files = [
    ["Tech pack v3.pdf", "Brand spec · updated Jul 18"],
    ["Measurement chart.xlsx", "Sizing and tolerance sheet"],
    ["Reference photos.zip", "Design references · 12 files"],
    ["Approved quote.pdf", "Atelier Minho quote reference"]
  ];

  return (
    <section className="milestone-timeline-card project-detail-tab-panel">
      <h2>Files</h2>
      <div className="project-detail-file-list">
        {files.map(([name, meta]) => (
          <button className="project-detail-file-row" type="button" key={name}>
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

function ProjectContractDetailsPanel({ goTo }) {
  const workDetails = [
    ["Contract title", "Organic cotton woven shirt sample + bulk production"],
    ["Scope of work", "Produce organic cotton woven shirts based on the attached tech pack. Quote covers 300 units across 3 colors, fit sample and PP sample before bulk, and a 28-day bulk lead after PP approval."],
    ["Approvals, revisions, and delivery", "Fit sample + PP sample before bulk; 3 colors at 100 units per color; one included fit sample revision; QC photos before final balance; delivery address confirmed before bulk; extra revision fees quoted separately."]
  ];
  const acceptedQuote = [
    ["Factory", "Atelier Minho · Porto, Portugal"],
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
    <section className="milestone-timeline-card project-detail-tab-panel project-contract-readonly-panel">
      <div className="project-contract-panel-header">
        <div>
          <h2>Contract details</h2>
        </div>
        <button className="secondary-btn compact-btn" type="button" onClick={() => goTo("contract")}>Edit</button>
      </div>
      <div className="project-contract-section">
        <h3>Work details</h3>
        <div className="project-contract-detail-grid single">
          {workDetails.map(([label, value]) => (
            <div className="project-contract-detail-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="project-contract-section">
        <h3>Accepted quote</h3>
        <div className="project-contract-detail-grid">
          {acceptedQuote.map(([label, value]) => (
            <div className="project-contract-detail-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="project-contract-section">
        <h3>Payment and release terms</h3>
        <div className="project-contract-detail-grid">
          {paymentTerms.map(([label, value]) => (
            <div className="project-contract-detail-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="project-contract-section">
        <h3>Attachments</h3>
        <div className="project-contract-attachment-row">
          {attachments.map((file) => (
            <span key={file}>{file}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProjectMilestoneItem({ milestone, index, isPaid = false, isApproved = false, onApproveFund, onFundMilestone, onApprove }) {
  const handleAction = () => {
    if (milestone.action === "Approve fund") onApproveFund?.(milestone);
    if (milestone.action === "Fund milestone") onFundMilestone?.(milestone);
    if (milestone.action === "Approve") onApprove?.(milestone);
  };

  return (
    <article className="project-milestone-item">
      <span className={index === 0 ? "milestone-number current" : "milestone-number"}>{index + 1}</span>
      <div className="milestone-body">
        <div className="milestone-title-line">
          <div>
            <h3>{milestone.title}</h3>
            <p>{milestone.meta}</p>
          </div>
          <div className="milestone-amount-cell">
            {milestone.amount && <strong>{milestone.amount}</strong>}
          </div>
        </div>
        <p className="milestone-description">{milestone.description}</p>
        {milestone.update && <ProjectUpdateCard />}
      </div>
      <button className="milestone-comment" type="button" aria-label={`Add update for ${milestone.title}`}>
        <img src="/assets/prototype-icons/add-update.svg" alt="" />
      </button>
      {(isPaid || isApproved) && (
        <span className={isApproved ? "milestone-paid-status approved" : "milestone-paid-status"}>
          {isApproved ? "Approved" : "Paid"}
        </span>
      )}
      {milestone.action && !isPaid && !isApproved && (
        <button className={milestone.tone === "primary" ? "primary-btn milestone-action" : "secondary-btn milestone-action"} type="button" onClick={handleAction}>
          {milestone.action}
        </button>
      )}
    </article>
  );
}

function ApproveMilestoneModal({ milestone, onClose, onApprove }) {
  return (
    <div className="approve-fund-modal-layer" role="presentation">
      <button className="approve-fund-modal-scrim" type="button" aria-label="Close approval" onClick={onClose} />
      <section className="approve-fund-modal approve-step-modal" role="dialog" aria-modal="true" aria-labelledby="approve-step-title">
        <button className="settings-drawer-close" type="button" aria-label="Close approval" onClick={onClose}>
          <img src="/assets/prototype-icons/close.svg" alt="" />
        </button>
        <header>
          <p>Approve step</p>
          <h2 id="approve-step-title">Approve {milestone.title.toLowerCase()}</h2>
          <span>This marks the production step as approved and lets Atelier Minho continue to the next step.</span>
        </header>
        <div className="approve-fund-summary single">
          <div>
            <span>Step</span>
            <strong>{milestone.title}</strong>
          </div>
        </div>
        <label className="approve-fund-note">
          <span>Approval note</span>
          <textarea rows={3} placeholder="Optional note for Atelier Minho..." />
        </label>
        <footer>
          <button className="secondary-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-btn" type="button" onClick={onApprove}>Approve step</button>
        </footer>
      </section>
    </div>
  );
}

function ApproveFundModal({ milestone, onClose, onApprove }) {
  return (
    <div className="approve-fund-modal-layer" role="presentation">
      <button className="approve-fund-modal-scrim" type="button" aria-label="Close approve fund" onClick={onClose} />
      <section className="approve-fund-modal" role="dialog" aria-modal="true" aria-labelledby="approve-fund-title">
        <button className="settings-drawer-close" type="button" aria-label="Close approve fund" onClick={onClose}>
          <img src="/assets/prototype-icons/close.svg" alt="" />
        </button>
        <header>
          <p>Approve fund</p>
          <h2 id="approve-fund-title">Release {milestone.amount} for {milestone.title.toLowerCase()}</h2>
          <span>Funds will move from project funds to Atelier Minho after approval.</span>
        </header>
        <div className="approve-fund-summary">
          <div>
            <span>Milestone</span>
            <strong>{milestone.title}</strong>
          </div>
          <div>
            <span>Amount</span>
            <strong>{milestone.amount}</strong>
          </div>
          <div>
            <span>Review item</span>
            <strong>Fit sample photos and uploaded files</strong>
          </div>
        </div>
        <label className="approve-fund-note">
          <span>Approval note</span>
          <textarea rows={3} placeholder="Optional note for Atelier Minho..." />
        </label>
        <footer>
          <button className="secondary-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-btn" type="button" onClick={onApprove}>Approve and release fund</button>
        </footer>
      </section>
    </div>
  );
}

function ProjectUpdateCard() {
  return (
    <div className="project-update-card">
      <div className="project-update-header">
        <strong>Atelier Minho</strong>
        <span>Today, 9:48 PM</span>
        <button type="button">View all updates (7)</button>
      </div>
      <p>Fit sample is ready for review. Uploaded front, side, and detail photos for approval.</p>
      <div className="sample-file-row">
        {["Front photo", "Detail photo", "Back photo"].map((label, index) => (
          <div className="sample-file" key={label}>
            <img src={samplePhotos[index]} alt="" />
            <span>{label}</span>
          </div>
        ))}
        <button type="button">+3 files</button>
      </div>
    </div>
  );
}

function DescribeScreen({ onContinue }) {
  return (
    <div className="main-grid single">
      <Card title="Describe what you need made" className="large-card">
        <label className="field-label" htmlFor="request">
          Product request
        </label>
        <textarea
          id="request"
          defaultValue="300 women's woven shirts in organic cotton poplin. Need a fit sample and PP sample before bulk approval. Looking for low-MOQ factory with strong woven shirt experience."
        />
        <div className="describe-actions">
          <button className="secondary-btn" type="button" onClick={onContinue}>Skip AI</button>
          <button className="primary-btn" type="button" onClick={onContinue}>Generate request brief</button>
        </div>
      </Card>
    </div>
  );
}

function ReviewScreen() {
  return (
    <div className="stack review-brief-stack">
      <Card title="Organic cotton woven shirt production">
        <section className="brief-panel">
          <div>
            <h3>Project brief</h3>
            <p>
              Maison Rue needs a cut-and-sew factory for 300 women's organic cotton woven shirts.
              The brand has a tech pack and wants factories to quote the sample path and small
              production run clearly before contract terms.
            </p>
          </div>
          <button className="secondary-btn compact-btn" type="button">Edit</button>
        </section>
        <h3 className="section-title">Quote requirements</h3>
        <div className="brief-grid">
          <Field label="Product category *" value="Womenswear / woven shirting" />
          <Field label="Quantity + color split *" value="300 units total · 3 colors, 100 each" />
          <Field label="Material / quality *" value="Organic cotton poplin, mid-weight" />
          <Field label="Target timeline *" value="Sample in August, bulk by late September" />
          <Field label="Sample requirement *" value="Fit sample + PP sample before bulk" />
          <Field label="Target unit price" value="Ideal $18-$24 per unit" />
          <Field label="Factory region preference" value="China, Portugal, Korea" />
          <Field label="Certifications" value="GOTS preferred" />
          <Field label="Quote deadline" value="Jul 24, 2026 · 5 business days after publish" className="brief-grid-full" />
        </div>
        <section className="brief-sourcing-block">
          <h3>Factory sourcing responsibility</h3>
          <div className="brief-sourcing-section">
            <div className="brief-sourcing-grid">
            <label className="field-label" htmlFor="review-sourcing-support">
              Sourcing support needed
              <select id="review-sourcing-support" defaultValue="partial">
                <option value="full">Factory should source all materials and components</option>
                <option value="partial">Factory should source some materials or components</option>
                <option value="brand-provided">Brand will provide all materials and components</option>
                <option value="unsure">Not sure yet</option>
              </select>
            </label>
            <label className="field-label" htmlFor="review-sourcing-details">
              Details
              <textarea
                id="review-sourcing-details"
                defaultValue="Factory should source organic cotton poplin and button trims from brand-approved direction. Brand will provide labels, packaging, and final color standards."
              />
            </label>
            </div>
          </div>
        </section>
      </Card>
      <Card title="Additional details">
        <div className="note-field">
          Optional: packaging, QC expectations, shipping notes, or anything factories should know
          before quoting.
        </div>
      </Card>
      <Card title="Attachments">
        <button className="upload-zone" type="button">
          + Add tech pack, sketches, sample references, or color breakdown
        </button>
      </Card>
      <Card title="Questions factories should answer">
        <div className="question-box">
          <ol>
            <li>Can you quote fit sample and PP sample separately?</li>
            <li>Can you support 3 colors at 100 units each?</li>
            <li>Which materials or components can you source, and what do you need the brand to provide?</li>
          </ol>
        </div>
      </Card>
    </div>
  );
}

function InviteScreen({ selectedFactories, setSelectedFactories }) {
  const toggle = (name) => {
    setSelectedFactories((items) =>
      items.includes(name) ? items.filter((item) => item !== name) : [...items, name]
    );
  };

  return (
    <div className="stack">
      <div className="invite-tabs">
        <button className="active" type="button">Search</button>
        <button type="button">Selected ({selectedFactories.length})</button>
        <button type="button">Saved (4)</button>
      </div>
      <div className="invite-toolbar">
        <label className="search-field">
          <SearchIcon />
          <input placeholder="Search factories" />
        </label>
        <label className="toggle-row">
          <input type="checkbox" />
          <span className="toggle" />
          Available now
        </label>
        <label className="toggle-row">
          <input type="checkbox" defaultChecked />
          <span className="toggle" />
          Open to all factories
        </label>
        <button className="filter-button" type="button">≡ Filter</button>
      </div>
      <div className="filter-strip">
        <span>Filters preselected from your request</span>
        <div>
          {["Cut & sew", "MOQ ≤ 500", "GOTS preferred", "China / Portugal / Korea"].map((filter) => (
            <button className="filter-chip" key={filter} type="button">{filter}</button>
          ))}
          <button className="clear-filters" type="button">Clear filters</button>
        </div>
      </div>
      <Card className="invite-results">
        <div className="factory-list">
          {factories.map((factory) => (
            <InviteFactoryCard
              factory={factory}
              isSelected={selectedFactories.includes(factory.name)}
              key={factory.name}
              onToggle={() => toggle(factory.name)}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function InviteFactoryCard({ factory, isSelected, onToggle }) {
  const [sampleScroll, setSampleScroll] = useState({ left: false, right: true });
  const updateSampleScroll = (element) => {
    if (!element) return;
    const remaining = element.scrollWidth - element.clientWidth - element.scrollLeft;
    setSampleScroll({
      left: element.scrollLeft > 4,
      right: remaining > 4
    });
  };

  return (
    <button
      className={isSelected ? "factory-card selected" : "factory-card"}
      type="button"
      aria-pressed={isSelected}
      onClick={onToggle}
    >
      <span className={isSelected ? "check-box checked" : "check-box"} />
      <div className="invite-factory-content">
        <div className="invite-factory-top">
          <div className="marketplace-factory-title">
            <div className="factory-avatar">{factory.initials}</div>
            <div>
              <div className="factory-name-row">
                <h3>{factory.name}</h3>
                <img className="trust-icon" src={`/assets/prototype-icons/${factory.trust}.svg`} alt={`${factory.trust} factory`} />
              </div>
              <p>{factory.location}</p>
            </div>
          </div>
          <div className="factory-card-metrics">
            <Metric label="match" value={factory.fit} className={matchTierClass(factory.fit)} />
            <Metric label="rating" value={factory.name === "Atelier Minho" ? "4.9" : factory.name === "Hanshu Studio" ? "4.8" : "4.7"} />
            <span className="orders-count">{factory.name === "Atelier Minho" ? "12" : factory.name === "Hanshu Studio" ? "8" : "19"} Club orders</span>
          </div>
          <div className="factory-actions">
            <span className="save-pill">Message</span>
            <strong>{isSelected ? "Selected" : "Invite"}</strong>
          </div>
        </div>

        <div className="invite-factory-body">
          <div className="marketplace-spec-panel invite-spec-panel">
            <div className="marketplace-stat-grid invite-stat-grid">
              {factory.stats.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="marketplace-note-list invite-note-list">
              <p>{factory.note}</p>
            </div>
          </div>
          <div className="marketplace-samples-shell invite-samples-shell">
            <button
              className={sampleScroll.left ? "marketplace-samples-prev visible" : "marketplace-samples-prev"}
              type="button"
              aria-label="Scroll sample images back"
              onClick={(event) => {
                event.stopPropagation();
                const scroller = event.currentTarget.nextElementSibling;
                scroller?.scrollBy({ left: -240, behavior: "smooth" });
                window.setTimeout(() => updateSampleScroll(scroller), 260);
              }}
            >
              <img src="/assets/prototype-icons/dropdown.svg" alt="" />
            </button>
            <div
              className="marketplace-samples invite-samples"
              aria-label={`${factory.name} sample products`}
              onScroll={(event) => updateSampleScroll(event.currentTarget)}
            >
              {factory.products.map((product) => (
                <figure className="marketplace-sample invite-sample" key={product.name}>
                  <img src={product.image} alt={`${factory.name} ${product.name}`} />
                  <figcaption>
                    <strong>{product.name}</strong>
                  </figcaption>
                </figure>
              ))}
            </div>
            <button
              className={sampleScroll.right ? "marketplace-samples-next visible" : "marketplace-samples-next"}
              type="button"
              aria-label="Scroll sample images"
              onClick={(event) => {
                event.stopPropagation();
                const scroller = event.currentTarget.previousElementSibling;
                scroller?.scrollBy({ left: 240, behavior: "smooth" });
                window.setTimeout(() => updateSampleScroll(scroller), 260);
              }}
            >
              <img src="/assets/prototype-icons/dropdown.svg" alt="" />
            </button>
          </div>
        </div>
      </div>
    </button>
  );
}

function InviteSuccessScreen({ goTo, selectedFactories }) {
  const factoryCount = selectedFactories.length;

  return (
    <div className="stack">
      <section className="success-card invite-success-card">
        <span className="success-mark">✓</span>
        <div className="success-copy">
          <h2>Your quote request is live</h2>
          <p>
            We sent the brief to {factoryCount} selected factories. They can review the request,
            ask questions, and submit quotes before the deadline.
          </p>
        </div>
        <section className="success-next-panel">
          <h3>What happens next</h3>
          <ul className="success-next-list">
            <li>Factories review your brief, attachments, and sourcing responsibilities.</li>
            <li>You will see responses, questions, and quote status updates on the quotes page.</li>
            <li>When enough quotes are ready, compare pricing, timing, and sample plans before choosing one.</li>
          </ul>
        </section>
        <div className="success-actions">
          <button className="primary-btn" type="button" onClick={() => goTo("quotes")}>
            Review quotes
          </button>
          <button className="secondary-btn" type="button" onClick={() => goTo("home")}>
            Go to dashboard
          </button>
        </div>
      </section>
    </div>
  );
}

function isBlueTag(tag) {
  return tag.startsWith("Open ") || tag.includes("units") || tag === "Best price" || tag === "split colorways";
}

function matchTierClass(value) {
  const score = Number.parseInt(value, 10);
  if (score >= 90) return "metric-blue";
  if (score >= 75) return "metric-green";
  if (score >= 60) return "metric-amber";
  return "";
}

function quoteFitClass(type) {
  if (type === "Strong fit") return "quote-fit strong-fit";
  if (type === "Good fit") return "quote-fit good-fit";
  return "quote-fit tradeoff-fit";
}

function parseQuoteCurrency(value) {
  return Number.parseFloat(String(value).replace(/[^0-9.]/g, "")) || 0;
}

function parseQuoteUnits(value) {
  return Number.parseInt(String(value).replace(/[^0-9]/g, ""), 10) || 0;
}

function formatQuoteCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function getQuoteComparisonDetails(factory) {
  const sampleSubtotal = factory.name === "Ningbo Woven Co" ? 220 : 260;
  const productionSubtotal = parseQuoteCurrency(factory.price) * parseQuoteUnits(factory.quoteQuantity);
  return {
    productionSubtotal: formatQuoteCurrency(productionSubtotal),
    sampleSubtotal: formatQuoteCurrency(sampleSubtotal),
    total: formatQuoteCurrency(productionSubtotal + sampleSubtotal),
    paymentTerms: factory.name === "Ningbo Woven Co" ? "40% deposit · 60% before shipment" : "30% deposit · 70% before shipment",
    samplePlan: factory.name === "Ningbo Woven Co" ? "Fit + PP · 24 days" : "Fit + PP · 21 days",
    shipping: factory.name === "Atelier Minho" ? "FOB quoted · freight not included" : "EXW quoted · freight not included",
    capacityWindow: factory.name === "Ningbo Woven Co" ? "Sep 4-28 · 500 units reserved" : "Aug 12-30 · 420 units reserved"
  };
}

function QuotesScreen({ selectedQuote, setSelectedQuote, selectedQuotesForCompare, setSelectedQuotesForCompare, quoteCompareOpen, setQuoteCompareOpen, setSelectedReorderProject, goTo }) {
  const selectedQuoteFactories = factories.filter((factory) => selectedQuotesForCompare.includes(factory.name));

  function toggleCompareQuote(factoryName) {
    setSelectedQuotesForCompare((current) =>
      current.includes(factoryName)
        ? current.filter((name) => name !== factoryName)
        : [...current, factoryName]
    );
  }

  return (
    <div className="stack quote-review-stack">
      <div className="invite-tabs">
        <button className="active" type="button">All quotes (3)</button>
        <button type="button">Messages (2)</button>
      </div>
      <div className="quote-compare-topbar">
        <div>
          <strong>Compare quotes</strong>
          <span>Select two or more quotes to review side by side.</span>
        </div>
        <div className="quote-compare-topbar-actions">
          <span>{selectedQuotesForCompare.length} quotes selected</span>
          <button className="secondary-btn compact-btn" type="button" disabled={selectedQuotesForCompare.length < 2} onClick={() => setQuoteCompareOpen(true)}>
            Compare quotes
          </button>
        </div>
      </div>
      <div className="quote-list">
        {factories.map((factory) => (
          <button
            key={factory.name}
            type="button"
            className={selectedQuote === factory.name ? "factory-card quote-card selected" : "factory-card quote-card"}
            onClick={() => setSelectedQuote(factory.name)}
          >
            <span
              className={selectedQuotesForCompare.includes(factory.name) ? "check-box checked quote-compare-check" : "check-box quote-compare-check"}
              aria-hidden="true"
              onClick={(event) => {
                event.stopPropagation();
                toggleCompareQuote(factory.name);
              }}
            />
            <div className="quote-factory-content">
              <div className="quote-factory-top">
                <div className="marketplace-factory-title">
                  <div className="factory-avatar">{factory.initials}</div>
                  <div>
                    <div className="factory-name-row">
                      <h3>{factory.name}</h3>
                      <img className="trust-icon" src={`/assets/prototype-icons/${factory.trust}.svg`} alt={`${factory.trust} factory`} />
                    </div>
                    <p>{factory.location}</p>
                  </div>
                </div>
                <div className="factory-actions quote-actions">
                  <span
                    className="save-pill"
                    onClick={(event) => {
                      event.stopPropagation();
                      goTo("messages");
                    }}
                  >
                    Message
                  </span>
                  <span
                    className="save-pill"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedQuote(factory.name);
                      goTo("quoteDetail");
                    }}
                  >
                    Review quote
                  </span>
                  <strong
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedQuote(factory.name);
                      setSelectedReorderProject(null);
                      goTo("contract");
                    }}
                  >
                    Choose quote
                  </strong>
                </div>
              </div>

              <div className="quote-factory-body">
                <div className="marketplace-spec-panel quote-spec-panel">
                  <div className="marketplace-stat-grid quote-stat-grid">
                    <div>
                      <span>Unit price</span>
                      <strong>{factory.price}</strong>
                    </div>
                    <div>
                      <span>Quantity</span>
                      <strong>{factory.quoteQuantity}</strong>
                    </div>
                    <div>
                      <span>Bulk lead</span>
                      <strong>{factory.lead}</strong>
                    </div>
                  </div>
                  <div className="marketplace-note-list quote-note-list">
                    <div className="quote-fit-row">
                      <span className={quoteFitClass(factory.fitType)}>{factory.fitType}</span>
                      <p>{factory.fitSummary}</p>
                    </div>
                    <div className="factory-note-box">
                      <strong>Notes from factory</strong>
                      <span>{factory.factoryNote}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
      {quoteCompareOpen && createPortal(
        <div className="brand-profile-modal-layer quote-compare-modal-layer">
          <button className="brand-profile-modal-scrim" type="button" aria-label="Close quote comparison" onClick={() => setQuoteCompareOpen(false)} />
          <section className="brand-profile-modal quote-compare-modal" role="dialog" aria-modal="true" aria-labelledby="quote-compare-title">
            <button className="brand-profile-modal-close" type="button" aria-label="Close" onClick={() => setQuoteCompareOpen(false)}>×</button>
            <header className="brand-profile-modal-header">
              <h1 id="quote-compare-title">Compare quotes</h1>
              <p>Review selected factory quotes side by side before choosing one.</p>
            </header>
            <div className="quote-compare-table-wrap">
              <table className="quote-compare-table">
                <thead>
                  <tr>
                    <th>Factory</th>
                    <th>Unit price</th>
                    <th>Quantity</th>
                    <th>Bulk lead</th>
                    <th>Production subtotal</th>
                    <th>Sample subtotal</th>
                    <th>Payment terms</th>
                    <th>Sample plan</th>
                    <th>Shipping</th>
                    <th>Capacity window</th>
                    <th>Quote total</th>
                    <th>Fit</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedQuoteFactories.map((factory) => {
                    const details = getQuoteComparisonDetails(factory);
                    return (
                      <tr key={factory.name}>
                        <td>
                          <strong>{factory.name}</strong>
                          <span>{factory.location}</span>
                        </td>
                        <td>{factory.price}</td>
                        <td>{factory.quoteQuantity}</td>
                        <td>{factory.lead}</td>
                        <td>{details.productionSubtotal}</td>
                        <td>{details.sampleSubtotal}</td>
                        <td>{details.paymentTerms}</td>
                        <td>{details.samplePlan}</td>
                        <td>{details.shipping}</td>
                        <td>{details.capacityWindow}</td>
                        <td>{details.total}</td>
                        <td><span className={quoteFitClass(factory.fitType)}>{factory.fitType}</span></td>
                        <td>{factory.factoryNote}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <footer className="brand-profile-modal-actions">
              <button className="secondary-btn" type="button" onClick={() => setQuoteCompareOpen(false)}>Close</button>
            </footer>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}

function QuoteDetailScreen({ selectedQuote, goTo, setSelectedReorderProject }) {
  const factory = factories.find((item) => item.name === selectedQuote) || factories[0];
  return (
    <div className="quote-detail-layout">
      <button className="text-link quote-back-link" type="button" onClick={() => goTo("quotes")}>‹ Back to factory quotes</button>
      <header className="quote-detail-header">
        <h1>{factory.name} quotation</h1>
        <p>Review the full factory quote before messaging, asking a follow-up question, or choosing this quote for contract terms.</p>
      </header>
      <div className="quote-detail-grid">
        <Card className="quote-detail-card">
          <section className="quote-detail-summary">
            <div className="quote-detail-summary-top">
              <div className="quote-detail-summary-main">
                <div className="factory-avatar">{factory.initials}</div>
                <div className="factory-main">
                  <div className="factory-name-row">
                    <h3>{factory.name}</h3>
                    <img className="trust-icon" src={`/assets/prototype-icons/${factory.trust}.svg`} alt={`${factory.trust} factory`} />
                  </div>
                  <p>{factory.location}</p>
                </div>
              </div>
              <div className="factory-actions quote-actions">
                <span className="save-pill">Message</span>
                <strong
                  onClick={() => {
                    setSelectedReorderProject?.(null);
                    goTo("contract");
                  }}
                >
                  Choose quote
                </strong>
              </div>
            </div>

            <div className="quote-detail-stat-grid">
              {[
                ["Unit price", factory.price],
                ["Quantity", factory.quoteQuantity],
                ["Bulk lead", factory.lead]
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>

            <div className="quote-detail-fit-row">
              <span className={quoteFitClass(factory.fitType)}>{factory.fitType}</span>
              <p>{factory.fitSummary}</p>
            </div>
          </section>

          <section className="quote-detail-section">
            <h3>Quote overview</h3>
            <DetailPairs
              rows={[
                ["Product", "Women’s woven shirting, lightweight outerwear"],
                ["Color breakdown", "3 colors · 100 units per color"],
                ["Bulk lead time", `${factory.lead} after PP approval`],
                ["Capacity window", "Aug 12-30 · 420 units reserved"],
                ["Payment terms", "30% deposit · 70% before shipment"],
                ["Shipping / incoterms", "EXW quoted · freight not included"]
              ]}
            />
          </section>

          <section className="quote-detail-section quote-sourcing-section">
            <h3>Material sourcing responsibility</h3>
            <DetailPairs
              rows={[
                ["Brand provides separately", "Labels, packaging, final color standards, and special branded trims."],
                ["Factory includes", "Main production materials and standard components from approved direction, included in unit price."]
              ]}
            />
          </section>

          <section className="price-breakdown">
            <h3>Price breakdown</h3>
            <DetailRows
              rows={[
                ["Production subtotal", `${factory.quoteQuantity} × ${factory.price}`, "$5,520"],
                ["Sample subtotal", "Fit + PP samples", "$260"],
                ["Shipping", "TBD by brand", "Not included"]
              ]}
            />
            <div className="quote-total">
              <strong>Quote total shown to brand</strong>
              <span>$5,780</span>
            </div>
          </section>

          <section className="quote-detail-section">
            <h3>Sample plan</h3>
            <p className="muted">Separate stages make it clear what the brand pays before bulk production.</p>
            <div className="sample-table">
              <span>Stage</span><span>Cost</span><span>Timing</span><span>Includes</span>
              <strong>Fit sample</strong><strong>$95</strong><strong>10 days</strong><strong>1 revision round</strong>
              <strong>PP sample</strong><strong>$165</strong><strong>11 days</strong><strong>Pre-production approval</strong>
              <strong>Extra revision</strong><strong>$65 each</strong><strong>Adds 5-7 days</strong><strong>Shipping not included</strong>
            </div>
          </section>

          <section className="quote-note-panel">
            <h3>Factory notes and open clarification</h3>
            <p>Can quote fit and PP separately and support 3 colors at 100 units each. Final cost depends on confirmed GSM, button trim, certification path, and final size spec.</p>
          </section>
        </Card>

        <Card title="Original request" className="original-request-card">
          <DetailRows
            rows={[
              ["Quantity", "300 units · 3 colors"],
              ["Target price", "$18-$24 / unit"],
              ["Sample ask", "Fit + PP before bulk"],
              ["Target date", "Bulk by late September"]
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

function DetailPairs({ rows }) {
  return (
    <div className="detail-pairs">
      {rows.map((row) => (
        <div className="detail-pair" key={row.join("-")}>
          <strong>{row[0]}</strong>
          <span>{row[1]}</span>
        </div>
      ))}
    </div>
  );
}

function DetailRows({ rows }) {
  return (
    <div className="detail-rows">
      {rows.map((row) => (
        <React.Fragment key={row.join("-")}>
          <strong>{row[0]}</strong>
          <span>{row[1]}</span>
          {row[2] && <b>{row[2]}</b>}
        </React.Fragment>
      ))}
    </div>
  );
}

function ContractScreen({ selectedQuote, reorderProject = null }) {
  const isReorder = Boolean(reorderProject);
  const deliveryTerms = [
    ["DDP", "Factory delivers to final destination, including duties"],
    ["CIF", "Factory covers cost, insurance, and freight to port"],
    ["FOB", "Factory delivers to export port; buyer handles freight"]
  ];
  const [deliveryTerm, setDeliveryTerm] = useState("DDP");
  const reorderStyleName = reorderProject?.title?.replace(/\s+production$/i, "") || "";
  const contractTitle = isReorder
    ? `${reorderStyleName} reorder with ${reorderProject.factory}`
    : "Organic cotton woven shirt sample + bulk production";
  const scopeCopy = isReorder
    ? `Repeat the previous ${reorderStyleName.toLowerCase()} order with ${reorderProject.factory}. Use the last approved style as the starting point, then confirm quantity, color breakdown, materials, trims, labels, packing, and any construction changes before funding.`
    : "Produce the woven shirt styles described in the attached tech pack, including approved fabric, trims, measurements, construction details, color standards, labels, and packing requirements.";
  const approvalCopy = isReorder
    ? "Brand and factory should confirm whether new fit or PP samples are needed for this reorder. Any changes to revisions, QC photos, delivery handoff, pricing, or timeline should be confirmed in writing before funding."
    : "Brand must approve samples before bulk starts. Factory will share QC photos before final balance release. Included revisions, extra revision fees, delivery handoff, and any change requests should be confirmed in writing before funding.";

  return (
    <div className="stack contract-stack">
      <Card title="Confirm final terms" className="final-terms-card">
        <div className="final-terms-grid">
          <AcceptedQuoteField label="Unit price" value="$18.40" />
          <AcceptedQuoteField label="Quantity" value="300 units" />
          <AcceptedQuoteField label="Samples" value="Fit + PP · $260" />
          <AcceptedQuoteField label="Bulk lead" value="28 days" />
          <AcceptedQuoteField label="Capacity" value="Aug 12-30" />
          <AcceptedQuoteField label="Terms" value="30/70" />
        </div>
        <section className="confirmed-trade-term">
          <div>
            <label htmlFor="contract-delivery-term">Delivery term from quote</label>
            <select id="contract-delivery-term" value={deliveryTerm} onChange={(event) => setDeliveryTerm(event.target.value)}>
              {deliveryTerms.map(([term, description]) => (
                <option value={term} key={term}>{term} ({description})</option>
              ))}
            </select>
          </div>
        </section>
      </Card>
      <Card title="Work details" className="work-details-card">
        <Field
          label="Contract title"
          value={contractTitle}
        />
        <section className="contract-section">
          <h3>Scope of work</h3>
          <div className="contract-textarea">
            {scopeCopy}
          </div>
        </section>
        <section className="contract-section">
          <h3>Approvals, revisions, and delivery</h3>
          <div className="contract-textarea">
            {approvalCopy}
          </div>
        </section>
        <section className="contract-section">
          <div className="contract-section-header">
            <h3>Attachments</h3>
            <button className="secondary-btn compact-btn" type="button">Attach file</button>
          </div>
          <div className="attachment-tray">
            {["Tech pack v3.pdf", "Measurement chart", "Reference photo", "Color breakdown"].map((file) => (
              <span className="attachment-chip" key={file}>
                {file}
                <CloseIconButton label={`Remove ${file}`} />
              </span>
            ))}
          </div>
        </section>
      </Card>
    </div>
  );
}

function PaymentScreen() {
  return (
    <div className="stack payment-terms-stack">
      <Card title="Delivery term" className="payment-terms-card">
        <section className="payment-section">
          <div className="payment-section-heading">
            <p>Who handles freight, duties, and delivery to the final destination?</p>
          </div>
          <div className="trade-term-grid">
            {[
              ["DDP", "Factory delivers to the final destination, including duties.", "Preferred"],
              ["CIF", "Factory covers cost, insurance, and freight to port."],
              ["FOB", "Factory delivers to export port; buyer handles freight."]
            ].map(([term, description, badge]) => (
              <label className={`trade-term-card ${badge ? "selected" : ""}`} key={term}>
                <input type="radio" name="price-term" defaultChecked={Boolean(badge)} />
                <span>
                  <strong>{term}</strong>
                  {badge && <em>{badge}</em>}
                </span>
                <p>{description}</p>
              </label>
            ))}
          </div>
        </section>
        <section className="payment-note">
          <h3>Payment comes later</h3>
          <p>
            Next, define milestone releases. Then the brand pays by card through TSC checkout so
            funds can be held before release.
          </p>
        </section>
      </Card>
    </div>
  );
}

function MilestonesScreen({ milestoneTypes, setMilestoneTypes }) {
  const productionSteps = [
    {
      name: "Fit sample",
      type: "Paid release",
      description: "Fit sample + one included revision round",
      amount: "$120",
      due: "Aug 16, 2026",
      nameLabel: "Name of the step"
    },
    {
      name: "Lab dip / color standard",
      type: "Approval only",
      description: "Brand approves lab dip before bulk materials are ordered",
      amount: "Hidden for approval only step",
      due: "Aug 16, 2026",
      nameLabel: "Name of the step"
    },
    {
      name: "Bulk deposit",
      type: "Paid release",
      description: "30% deposit reserves production window and starts bulk purchasing",
      amount: "$1,656",
      due: "After sample approval",
      nameLabel: "Step name"
    },
    {
      name: "Final payment & shipment",
      type: "Paid release",
      description: "Final balance releases after QC and shipment details are confirmed",
      amount: "$3,744",
      due: "Before shipment",
      nameLabel: "Step name"
    }
  ];

  return (
    <div className="stack">
      <Card title="Production schedule">
        <p className="muted production-schedule-helper">
          Select a step type for every production checkpoint. Use the helper text under the
          dropdown while deciding how that step should work.
        </p>
        <div className="step-type-guide">
          <div className="selected">
            <strong>Paid release</strong>
            <span>Shows amount + due date</span>
          </div>
          <div>
            <strong>Approval only</strong>
            <span>No amount, brand signs off</span>
          </div>
          <div>
            <strong>Update only</strong>
            <span>Factory progress updates only</span>
          </div>
        </div>
        <div className="milestone-form">
          {productionSteps.map((milestone, i) => {
            const type = milestoneTypes[milestone.name] || milestone.type;
            return (
              <div className="milestone-edit" key={milestone.name}>
                <div className="milestone-title-row">
                  <h3>Step {i + 1}</h3>
                  <div className="milestone-controls">
                    <select
                      className={`step-type-select ${type.toLowerCase().replaceAll(" ", "-")}`}
                      value={type}
                      onChange={(event) =>
                        setMilestoneTypes((current) => ({
                          ...current,
                          [milestone.name]: event.target.value
                        }))
                      }
                    >
                      <option>Paid release</option>
                      <option>Approval only</option>
                      <option>Update only</option>
                    </select>
                    <button className="trash-btn" type="button" aria-label={`Remove step ${i + 1}`}>
                      <img src="/assets/prototype-icons/trash.svg" alt="" />
                    </button>
                  </div>
                </div>
                <div className="production-step-grid">
                  <Field label={milestone.nameLabel} value={milestone.name} />
                  <Field label="Description" value={milestone.description} />
                  <Field label="Amount" value={type === "Paid release" ? milestone.amount : "No payment"} muted={type !== "Paid release"} />
                  <Field label={type === "Update only" ? "Update timing" : "Due date"} value={milestone.due} />
                </div>
              </div>
            );
          })}
          <button className="add-step-btn" type="button">+ Add production step</button>
        </div>
      </Card>
    </div>
  );
}

function FundScreen({ fundingMilestone, goTo, setFundingMilestone }) {
  return (
    <div className="stack">
      <Card title="Select billing method">
        <div className="billing-method selected">
          <span className="radio-mark" aria-hidden="true" />
          <div>
            <strong>Visa ending in 4242</strong>
            <span>Default billing method</span>
          </div>
        </div>
        <button className="billing-add-btn" type="button">+ Add a new billing method</button>
        <label className="discount-code-field">
          <span>Discount code</span>
          <div>
            <input type="text" placeholder="Enter code" />
            <button className="secondary-btn compact-btn" type="button">Apply</button>
          </div>
          <small>$50 discounts can be applied to eligible orders.</small>
        </label>
        <section className="before-funding">
          <h3>Before funding</h3>
          <label>
            <input type="checkbox" defaultChecked />
            <span>I understand funds are only released after I approve the payment.</span>
          </label>
          <label>
            <input type="checkbox" />
            <span>TSC may hold funds until the payment is approved or disputed.</span>
          </label>
        </section>
      </Card>
    </div>
  );
}

function SuccessScreen({ goTo }) {
  const goToDashboard = () => {
    window.history.replaceState(null, "", `${window.location.pathname}?screen=home`);
    goTo("home");
  };

  return (
    <div className="stack">
      <section className="success-card">
        <span className="success-mark">✓</span>
        <div className="success-copy">
          <h2>Payment received</h2>
          <p>
            $124.14 was charged to Visa ending in 4242. Atelier Minho has been notified that the
            fit sample is ready to begin.
          </p>
        </div>
        <section className="success-next-panel">
          <h3>What happens next</h3>
          <p>
            Atelier Minho prepares the fit sample and uploads photos when it is ready. You can
            message the factory or review files from the project workspace.
          </p>
        </section>
        <div className="success-actions">
          <button className="primary-btn" type="button" onClick={goToDashboard}>
            Go to dashboard
          </button>
          <button className="secondary-btn" type="button">
            Message factory
          </button>
        </div>
      </section>
    </div>
  );
}

function Card({ title, children, className = "", tone = "" }) {
  return (
    <section className={`card ${className} ${tone}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

function Field({ label, value, muted = false, className = "" }) {
  return (
    <div className={`${muted ? "field muted-field" : "field"} ${className}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ label, value, className = "" }) {
  return (
    <div className={`metric ${className}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function AcceptedQuoteField({ label, value }) {
  return (
    <label className="accepted-quote-field">
      <span>{label}</span>
      <input defaultValue={value} />
    </label>
  );
}

function BottomBar({ canBack, onBack, onNext, primaryLabel, centerText = "", centerAction = null, secondaryLabel = "" }) {
  return (
    <footer className={canBack ? "bottom-bar has-back" : "bottom-bar no-back"}>
      {canBack && (
        <button className="secondary-btn" type="button" onClick={onBack}>
          Back
        </button>
      )}
      {(centerText || centerAction) && (
        <div className="bottom-meta-group">
          {centerText && <span className="bottom-meta">{centerText}</span>}
          {centerAction && (
            <button className="secondary-btn compact-btn" type="button" disabled={centerAction.disabled} onClick={centerAction.onClick}>
              {centerAction.label}
            </button>
          )}
        </div>
      )}
      <div className="bottom-actions">
        {secondaryLabel && <button className="secondary-btn" type="button">{secondaryLabel}</button>}
        {primaryLabel && (
          <button className="primary-btn" type="button" onClick={onNext}>
            {primaryLabel}
          </button>
        )}
      </div>
    </footer>
  );
}

function Toast({ message, onDone }) {
  React.useEffect(() => {
    const timeout = window.setTimeout(onDone, 2200);
    return () => window.clearTimeout(timeout);
  }, [onDone]);
  return <div className="toast">{message}</div>;
}

createRoot(document.getElementById("root")).render(<App />);
