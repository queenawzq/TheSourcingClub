import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const samplePhotos = [
  "https://www.figma.com/api/mcp/asset/0946693b-696e-46c6-ba0a-5657572676ed",
  "https://www.figma.com/api/mcp/asset/14256e3c-62c6-4b41-abc6-3ed953eda03a",
  "https://www.figma.com/api/mcp/asset/0946693b-696e-46c6-ba0a-5657572676ed"
];

const steps = [
  { title: "Describe request", meta: "Draft product need" },
  { title: "Review brief", meta: "Quote-ready basics" },
  { title: "Invite factories", meta: "Choose who can quote" },
  { title: "Review quotes", meta: "Compare responses" },
  { title: "Contract terms", meta: "Scope and revisions" },
  { title: "Payment terms", meta: "Fixed price setup" },
  { title: "Production steps", meta: "Payment + approvals" },
  { title: "Fund first payment", meta: "Start sample work" }
];

const screenOrder = [
  "describe",
  "review",
  "invite",
  "quotes",
  "quoteDetail",
  "contract",
  "payment",
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
  describe: { step: 0, title: "Describe what you need made.", cta: "Generate brief" },
  review: { step: 1, title: "Review your quote brief.", cta: "Invite factories" },
  invite: { step: 2, title: "Invite factories to quote.", cta: "Invite factories" },
  quotes: { step: 3, title: "Review factory quotes.", cta: "Review quote" },
  quoteDetail: { step: 3, title: "Review Atelier Minho quote.", cta: "Use this quote" },
  contract: { step: 4, title: "Set contract terms.", cta: "Continue to payment" },
  payment: { step: 5, title: "Choose payment terms.", cta: "Add production steps" },
  milestones: {
    step: 6,
    title: "Add production steps",
    description:
      "Create the full production schedule: paid steps, approval steps, and update-only checkpoints that match how this order will move.",
    cta: "Continue to funding"
  },
  fund: {
    step: 7,
    title: "Fund first payment",
    description:
      "The brand funds the sample payment now. Bulk production stays locked until sample approval.",
    cta: "Fund payment & start"
  },
  success: {
    step: 7,
    title: "First payment funded",
    description:
      "Your sample payment is funded. The factory can start work, and funds are only released after you approve the sample.",
    cta: "Go to dashboard"
  }
};

const factories = [
  {
    name: "Atelier Minho",
    location: "Porto, Portugal",
    trust: "trusted",
    fit: "94%",
    fitType: "Strong fit",
    fitSummary: "Premium shirting fit, low-MOQ sampling, and available August capacity.",
    factoryNote: "Premium finish support and tighter sample review. No open questions after tech pack upload.",
    price: "$18.40",
    quoteQuantity: "300 units",
    lead: "28 days",
    note: "Best match for organic cotton woven shirts with sample-first production.",
    tags: ["Cut & sew", "Middle $18-$40", "MOQ 150", "22-28 days lead", "Open Aug 12-30", "420 units"]
  },
  {
    name: "Hanshu Studio",
    location: "Seoul, Korea",
    trust: "verified",
    fit: "87%",
    fitType: "Good fit",
    fitSummary: "Higher unit cost, but strongest finish quality and responsive team.",
    factoryNote: "Premium finish support and tighter sample review. No open questions after tech pack upload.",
    price: "$21.10",
    quoteQuantity: "300 units",
    lead: "32 days",
    note: "Strong construction and finishing, slightly higher sample cost.",
    tags: ["Cut & sew", "Middle $18-$40", "MOQ 150", "22-28 days lead", "Open Aug 12-30", "420 units"]
  },
  {
    name: "Ningbo Woven Co",
    location: "Ningbo, China",
    trust: "basic",
    fit: "78%",
    fitType: "Tradeoff",
    fitSummary: "Best price, but quoted at a revised 500-unit production run.",
    factoryNote: "Can split colorways after deposit. Brand should accept 500 units or request a revised 300-unit quote.",
    price: "$16.90",
    quoteQuantity: "500 units",
    lead: "35 days",
    note: "Competitive bulk pricing, needs closer sample approval before production.",
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
    status: "Question open",
    statusTone: "warning",
    metrics: [
      ["4", "quotes"],
      ["9", "invited"],
      ["1", "message"]
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
    progress: 3
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
    progress: 1
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
    progress: 1
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

function App() {
  const initialScreen = new URLSearchParams(window.location.search).get("view") === "marketplace" ? "factoryMarketplace" : "projects";
  const [screen, setScreen] = useState(initialScreen);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [selectedFactories, setSelectedFactories] = useState(["Atelier Minho", "Hanshu Studio"]);
  const [selectedQuote, setSelectedQuote] = useState("Atelier Minho");
  const [milestoneTypes, setMilestoneTypes] = useState(
    Object.fromEntries(milestones.map((milestone) => [milestone.name, milestone.type]))
  );
  const [toast, setToast] = useState("");
  const [transitionKey, setTransitionKey] = useState(0);

  const index = screenOrder.indexOf(screen);
  const meta = screenMeta[screen];
  const isStandalone = screen === "home" || screen === "profile" || screen === "factorySearch" || screen === "factoryMarketplace" || screen === "rfqs" || screen === "projects" || screen === "projectDetail";
  const isWideFlow = screen === "invite" || screen === "quotes" || screen === "quoteDetail";

  const goTo = (next) => {
    setScreen(next);
    setTransitionKey((value) => value + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const next = () => {
    if (screen === "invite") setToast("RFQ sent to 2 selected factories");
    if (screen === "quoteDetail") setSelectedQuote("Atelier Minho");
    if (screen === "fund") setToast("Sample payment funded");
    goTo(screenOrder[Math.min(index + 1, screenOrder.length - 1)]);
  };

  const back = () => goTo(screenOrder[Math.max(index - 1, 0)]);

  const content = useMemo(() => {
    const props = {
      selectedFactories,
      setSelectedFactories,
      selectedQuote,
      setSelectedQuote,
      milestoneTypes,
      setMilestoneTypes,
      goTo
    };

    switch (screen) {
      case "home":
        return <HomeScreen goTo={goTo} />;
      case "profile":
        return <BrandProfileScreen />;
      case "factorySearch":
        return <FactorySearchScreen goTo={goTo} />;
      case "factoryMarketplace":
        return <FactoryMarketplaceScreen goTo={goTo} />;
      case "rfqs":
        return <RfqsScreen goTo={goTo} />;
      case "projects":
        return <ProjectsScreen goTo={goTo} />;
      case "projectDetail":
        return <ProjectDetailScreen goTo={goTo} />;
      case "describe":
        return <DescribeScreen />;
      case "review":
        return <ReviewScreen />;
      case "invite":
        return <InviteScreen {...props} />;
      case "quotes":
        return <QuotesScreen {...props} />;
      case "quoteDetail":
        return <QuoteDetailScreen selectedQuote={selectedQuote} goTo={goTo} />;
      case "contract":
        return <ContractScreen selectedQuote={selectedQuote} />;
      case "payment":
        return <PaymentScreen />;
      case "milestones":
        return <MilestonesScreen milestoneTypes={milestoneTypes} setMilestoneTypes={setMilestoneTypes} />;
      case "fund":
        return <FundScreen />;
      case "success":
        return <SuccessScreen goTo={goTo} />;
      default:
        return null;
    }
  }, [screen, selectedFactories, selectedQuote, milestoneTypes]);

  return (
    <div className={sidebarCollapsed ? "app-shell nav-collapsed" : "app-shell"}>
      <SideNav
        active={screen === "home" ? "Dashboard" : screen === "factorySearch" || screen === "factoryMarketplace" ? "Explore" : screen === "profile" ? "" : screen === "projects" ? "Projects" : screen === "rfqs" ? "RFQs" : "RFQs"}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onNav={(label) => {
          if (label === "Dashboard") goTo("home");
          if (label === "RFQs") goTo("rfqs");
          if (label === "Projects") goTo("projects");
          if (label === "Explore") goTo("factoryMarketplace");
        }}
        onProfile={() => goTo("profile")}
      />
      <main className={screen === "factorySearch" || screen === "factoryMarketplace" ? "directory-page" : screen === "rfqs" || screen === "projects" || screen === "projectDetail" ? "rfqs-page" : isStandalone ? "home-page" : isWideFlow ? "flow-page wide-flow" : "flow-page"}>
        {!isStandalone && <JourneyRail current={meta.step} />}
        <section className="flow-content">
          {!isStandalone && screen !== "quoteDetail" && (
            <header className="flow-header">
              <p className="eyebrow">FACTORY QUOTE REQUEST</p>
              <h1>{meta.title}</h1>
              <p>
                {meta.description ||
                  "Organic cotton woven shirts, 300 units, fit sample and PP sample before bulk approval."}
              </p>
            </header>
          )}
          <div className="screen-transition" key={transitionKey}>
            {content}
          </div>
        </section>
        {!isStandalone && <RightRail screen={screen} selectedQuote={selectedQuote} />}
      </main>
      {!isStandalone && (
        <BottomBar
          canBack={index > 0}
          onBack={back}
          onNext={screen === "success" ? () => goTo("describe") : next}
          primaryLabel={screen === "quotes" ? "" : meta.cta}
          centerText={screen === "invite" ? `${selectedFactories.length} factories selected · 5 recommended` : ""}
          secondaryLabel={screen === "invite" ? "Save draft" : ""}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast("")} />}
    </div>
  );
}

function SideNav({ active, collapsed, onToggle, onNav, onProfile }) {
  const nav = [
    { label: "Dashboard", icon: "home" },
    { label: "RFQs", icon: "rfq" },
    { label: "Projects", icon: "projects" },
    { label: "Explore", icon: "explore" },
    { label: "Connections", icon: "connections" },
    { label: "Messages", icon: "messages" },
    { label: "Bookmarks", icon: "bookmarks" },
    { label: "Settings", icon: "settings" },
    { label: "Notifications", icon: "notification" }
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
            {(index === 3 || index === 7) && <span className="nav-divider" />}
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

function JourneyRail({ current }) {
  return (
    <aside className="journey-rail">
      <p>QUOTE TO CONTRACT</p>
      {steps.map((step, i) => (
        <div className="journey-step" key={step.title}>
          {i < steps.length - 1 && <span className={i < current ? "rail-line complete" : "rail-line"} />}
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

function RightRail({ screen, selectedQuote }) {
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
          <p>
            For an initial quote, the must-haves are product type, quantity, color breakdown,
            material quality, sample stage, timeline, and quote questions. Packaging and shipping
            can be clarified later.
          </p>
        </Card>
      </aside>
    );
  }

  if (screen === "fund") {
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
            <span>Estimated total</span>
            <strong>$124.14</strong>
          </div>
          <button className="primary-btn fund-side-btn" type="button">Fund payment & start</button>
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

  const isQuoteArea = ["quotes", "quoteDetail", "contract", "payment", "milestones"].includes(screen);
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
          <h2>Accepted quote</h2>
          <div className="accepted-quote-rows">
            <Metric label="Unit price" value="$18.40" />
            <Metric label="Quantity" value="300 units" />
            <Metric label="Samples" value="Fit + PP · $260" />
            <Metric label="Bulk lead" value="28 days" />
            <Metric label="Capacity" value="Aug 12-30" />
            <Metric label="Terms" value="30/70" />
          </div>
          <div className="accepted-reminder">
            <h3>TSC reminder</h3>
            <p>Confirm sample scope, revisions, QC, and delivery terms before funding.</p>
          </div>
        </section>
        {screen === "milestones" && (
          <Card title="What should production steps cover?" tone="soft">
            <p>
              For factories, production steps usually map to sample, bulk deposit, QC approval, and final
              shipment. Keep revisions and acceptance criteria explicit.
            </p>
          </Card>
        )}
      </aside>
    );
  }

  return (
    <aside className="right-rail">
      <Card title="Request summary">
        <Metric label="Product" value="Organic woven shirt" />
        <Metric label="Quantity" value="300 units" />
        <Metric label="Samples" value="Fit + PP" />
        <Metric label="Target" value="$18-$24" />
      </Card>
      <Card title="TSC reminder" tone="soft">
        <p>
          Keep sample scope, revisions, approvals, QC, and delivery terms clear before funding.
        </p>
      </Card>
    </aside>
  );
}

function HomeScreen({ goTo }) {
  return (
    <div className="home-stack">
      <header className="home-header">
        <h1>Hi Maison Rue</h1>
        <span />
      </header>
      <section className="card soft home-verification">
        <div>
          <h2>Your profile is being verified</h2>
          <p>You can browse and favorite factories now. A few things still need your attention.</p>
        </div>
        <button className="primary-btn" type="button">View checklist</button>
      </section>
      <section className="card home-search-card">
        <label className="search-field home-search-field">
          <SearchIcon />
          <input placeholder="Ask anything about sourcing, factories, or your projects..." />
          <b aria-hidden="true">✦</b>
        </label>
        <p className="home-section-label">SUGGESTED ACTIONS</p>
        <div className="home-suggestion-row">
          <button className="pill" type="button">Find a denim factory with MOQ under 500</button>
          <button className="pill" type="button">Show me factories with GOTS certification</button>
          <button className="pill" type="button">What do I still need for verification?</button>
          <button className="pill" type="button" onClick={() => goTo("describe")}>Help me start a new project</button>
        </div>
      </section>
      <section className="home-attention">
        <h2>Needs your attention</h2>
        <div className="home-action-card">
          <span className="attention-icon alert">!</span>
          <strong>Verification: 2 items need attention</strong>
          <button className="secondary-btn compact-btn" type="button">View checklist</button>
        </div>
        <div className="home-action-card">
          <span className="attention-icon check">✓</span>
          <strong>Finish your first project draft</strong>
          <button className="secondary-btn compact-btn" type="button" onClick={() => goTo("describe")}>Continue</button>
        </div>
      </section>
    </div>
  );
}

function BrandProfileScreen() {
  const info = [
    ["Category", "Streetwear"],
    ["Year Founded", "2012"],
    ["Website", "www.atelierlabel.com"],
    ["Company Size", "2-10"],
    ["Business Type", "Own Brand"],
    ["Brands Working With", "Aritzia"],
    ["Preferred Language", "English"]
  ];

  return (
    <div className="brand-profile">
      <header className="profile-header">
        <div>
          <div className="profile-title-row">
            <h1>Maison Rue</h1>
            <span className="verified-pill">
              <img src="/assets/prototype-icons/verified-partner.svg" alt="" />
              Verified Partner
            </span>
          </div>
          <p className="profile-location">
            <img src="/assets/prototype-icons/location.svg" alt="" />
            New York, NY
          </p>
        </div>
        <button className="primary-btn" type="button">Edit Profile</button>
      </header>
      <div className="profile-grid">
        <main className="profile-main">
          <section className="card profile-info-card">
            {info.map(([label, value]) => (
              <div className="profile-field" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </section>
          <Card title="Company Overview">
            <p className="profile-body-copy">
              Maison Rue is a premium sustainable fashion brand specializing in high-quality
              denim and activewear. Founded in 2018 in Porto, we bridge traditional Portuguese
              craftsmanship and modern eco-conscious production methods. Our focus is creating
              timeless, durable pieces while maintaining strict environmental and ethical labor
              standards across our supply chain.
            </p>
          </Card>
          <section className="profile-section">
            <h2>Designs</h2>
            <div className="sample-photo-grid">
              <img src="/assets/moodboard-soft-concrete.jpg" alt="Denim sample reference" />
              <img src="/assets/moodboard-warm-clay.jpg" alt="Footwear sample reference" />
            </div>
          </section>
          <section className="profile-section">
            <div className="profile-section-header">
              <h2>Past Projects</h2>
              <button className="text-link" type="button">View all projects</button>
            </div>
            <div className="past-project-grid">
              <ProjectCard
                title="Shanghai Minho Factory"
                dates="01/2026 - 6/2026"
                body="Activewear development and large-batch production."
                quote="Maison Rue provides incredibly clear tech packs and maintains a very efficient feedback loop. A pleasure to work with."
              />
              <ProjectCard
                title="GW Denim Mill"
                dates="07/2025 - 12/2025"
                body="Sustainable denim development and small-batch production."
                quote="Maison Rue was a good team to work with. Great communications and always give clear direction made it easier for our factory to keep track of production."
              />
            </div>
          </section>
        </main>
        <aside className="profile-side">
          <Card title="Company Revenue">
            <strong className="profile-revenue">$1M-5M</strong>
            <p className="helper">Annual Revenue</p>
          </Card>
          <Card title="Production Focus">
            <div className="tag-row compact-tags profile-tags">
              {["Denim", "Eco-Activewear", "GOTS Certified", "Knitwear", "Outerwear"].map((tag) => (
                <span className={tag === "GOTS Certified" ? "tag blue-tag" : "tag"} key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          </Card>
          <Card title="Certifications Required">
            <div className="cert-list">
              <CertificationCard title="GOTS" detail="Global Organic Textile Standard" icon="cert-gots" />
              <CertificationCard title="GRS" detail="Global Recycled Standard" icon="cert-grs" />
              <CertificationCard title="OEKO-TEX" detail="Standard 100" icon="cert-oeko" />
            </div>
          </Card>
        </aside>
      </div>
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
            <h1>BROWSE FACTORIES BY WHAT THEY MAKE</h1>
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
          <Metric label="response" value={factory.response} />
          <span>{factory.orders}</span>
        </div>
        <div className="marketplace-factory-actions">
          <button className="secondary-btn" type="button">Save</button>
          <button className="secondary-btn" type="button">Contact</button>
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

function RfqsScreen({ goTo }) {
  return (
    <div className="rfqs-shell">
      <header className="rfqs-header">
        <div>
          <h1>RFQs</h1>
          <p>Track live factory quote requests, compare responses, and move selected quotes toward contract terms.</p>
        </div>
        <button className="primary-btn" type="button" onClick={() => goTo("describe")}>Post new RFQ</button>
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
            <option value="quotes">Most Quotes</option>
          </select>
        </label>
      </section>

      <nav className="rfqs-tabs" aria-label="RFQ status">
        <button className="active" type="button">Active RFQs (4)</button>
        <button type="button">Drafts (2)</button>
        <button type="button">Invited (2)</button>
        <button type="button">Closed (6)</button>
      </nav>

      <section className="rfq-list" aria-label="Active RFQs">
        {activeRfqs.map((rfq) => (
          <RfqCard rfq={rfq} goTo={goTo} key={rfq.title} />
        ))}
      </section>
    </div>
  );
}

function RfqCard({ rfq, goTo }) {
  return (
    <article className={rfq.featured ? "rfq-card featured" : "rfq-card"}>
      <div className="rfq-thumbnail" aria-hidden="true" />
      <div className="rfq-main">
        <h2>{rfq.title}</h2>
        <p className="rfq-date">{rfq.date}</p>
        <p className="rfq-description">{rfq.description}</p>
        <div className="tag-row compact-tags rfq-tags">
          {rfq.tags.map((tag) => (
            <span className="tag" key={tag}>{tag}</span>
          ))}
        </div>
        <div className="tag-row compact-tags rfq-status-row">
          <span className={`tag rfq-status ${rfq.statusTone}`}>{rfq.status}</span>
        </div>
      </div>
      <div className="rfq-metrics">
        {rfq.metrics.map(([value, label]) => (
          <Metric label={label} value={value} key={label} />
        ))}
      </div>
      <button className="rfq-more" type="button" aria-label={`More options for ${rfq.title}`}>...</button>
      <div className="rfq-actions">
        <button className="primary-btn" type="button" onClick={() => goTo("quotes")}>View RFQ</button>
      </div>
    </article>
  );
}

function ProjectsScreen({ goTo }) {
  return (
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
            <option value="factory">Factory</option>
          </select>
        </label>
      </section>

      <nav className="rfqs-tabs projects-tabs" aria-label="Project status">
        <button className="active" type="button">Active projects (4)</button>
        <button type="button">Closed (6)</button>
      </nav>

      <section className="projects-list" aria-label="Active projects">
        {activeProjects.map((project) => (
          <ProjectListCard project={project} goTo={goTo} key={project.title} />
        ))}
      </section>
    </div>
  );
}

function ProjectListCard({ project, goTo }) {
  return (
    <article className={project.featured ? "brand-project-card featured" : "brand-project-card"}>
      <div className="project-thumbnail" aria-hidden="true" />
      <div className="project-main">
        <h2>{project.title}</h2>
        <p className="project-meta">{project.factory} · {project.location} · {project.started}</p>
        <p className="project-description">{project.description}</p>
        <div className="project-status-row">
          <span className={`project-status ${project.statusTone}`}>{project.status}</span>
          <span>{project.statusDetail}</span>
        </div>
        <ProjectProgress progress={project.progress} />
      </div>
      <div className="project-facts">
        <div>
          <span>CURRENT STEP</span>
          <strong>{project.currentStep}</strong>
        </div>
        <div>
          <span>NEXT DUE</span>
          <strong>{project.nextDue}</strong>
        </div>
      </div>
      <div className="project-actions">
        <button className="secondary-btn" type="button">Message</button>
        <button className="primary-btn" type="button" onClick={() => goTo("projectDetail")}>View project</button>
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

function ProjectDetailScreen({ goTo }) {
  return (
    <div className="project-detail-shell">
      <button className="project-back-link" type="button" onClick={() => goTo("projects")}>&lt; Back to projects</button>
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
            <button className="active" type="button">Overview</button>
            <button type="button">Messages (2)</button>
            <button type="button">Files</button>
            <button type="button">Contract details</button>
          </nav>

          <section className="milestone-timeline-card">
            <h2>Production timeline</h2>
            <div className="milestone-timeline-list">
              {projectDetailMilestones.map((milestone, index) => (
                <ProjectMilestoneItem milestone={milestone} index={index} key={milestone.title} />
              ))}
            </div>
            <button className="secondary-btn manage-milestones" type="button">Manage milestones</button>
          </section>
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
    </div>
  );
}

function ProjectMilestoneItem({ milestone, index }) {
  return (
    <article className="project-milestone-item">
      <span className={index === 0 ? "milestone-number current" : "milestone-number"}>{index + 1}</span>
      <div className="milestone-body">
        <div className="milestone-title-line">
          <div>
            <h3>{milestone.title}</h3>
            <p>{milestone.meta}</p>
          </div>
          {milestone.amount && <strong>{milestone.amount}</strong>}
        </div>
        <p className="milestone-description">{milestone.description}</p>
        {milestone.update && <ProjectUpdateCard />}
      </div>
      <button className="milestone-comment" type="button" aria-label={`Add update for ${milestone.title}`}>
        <img src="/assets/prototype-icons/add-update.svg" alt="" />
      </button>
      {milestone.action && (
        <button className={milestone.tone === "primary" ? "primary-btn milestone-action" : "secondary-btn milestone-action"} type="button">
          {milestone.action}
        </button>
      )}
    </article>
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

function DescribeScreen() {
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
        <div className="ai-note">
          <strong>TSC can turn this into a quote-ready brief.</strong>
          <span>We will structure product details, sample needs, target price, and production timing.</span>
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
        </div>
        <div className="single-field">
          <Field label="Quote deadline" value="Jul 24, 2026 · 5 business days after publish" />
        </div>
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
            <li>What fabric GSM or trim details do you need before final sample cost?</li>
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
            <button
              className={selectedFactories.includes(factory.name) ? "factory-card selected" : "factory-card"}
              key={factory.name}
              type="button"
              onClick={() => toggle(factory.name)}
            >
              <span className={selectedFactories.includes(factory.name) ? "check-box checked" : "check-box"}>
              </span>
              <div className="factory-avatar">AM</div>
              <div className="factory-main">
                <div className="factory-name-row">
                  <h3>{factory.name}</h3>
                  <img className="trust-icon" src={`/assets/prototype-icons/${factory.trust}.svg`} alt={`${factory.trust} factory`} />
                </div>
                <p>{factory.location}</p>
                <span>{factory.note}</span>
                <div className="tag-row compact-tags">
                  {factory.tags.slice(0, 6).map((tag) => (
                    <span className={isBlueTag(tag) ? "tag blue-tag" : "tag"} key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
              <div className="factory-card-metrics">
                <Metric label="match" value={factory.fit} className={matchTierClass(factory.fit)} />
                <Metric label="rating" value={factory.name === "Atelier Minho" ? "4.9" : factory.name === "Hanshu Studio" ? "4.8" : "4.7"} />
                <span className="orders-count">{factory.name === "Atelier Minho" ? "12" : factory.name === "Hanshu Studio" ? "8" : "19"} Club orders</span>
              </div>
              <div className="factory-actions">
                <span className="save-pill">Save</span>
                <strong>{selectedFactories.includes(factory.name) ? "Selected" : "Invite"}</strong>
              </div>
            </button>
          ))}
        </div>
      </Card>
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

function QuotesScreen({ selectedQuote, setSelectedQuote, goTo }) {
  return (
    <div className="stack quote-review-stack">
      <div className="invite-tabs">
        <button className="active" type="button">All quotes (3)</button>
        <button type="button">Messages (2)</button>
      </div>
      <div className="quote-toolbar">
        <label className="search-field">
          <SearchIcon />
          <input placeholder="Search factories" />
        </label>
        <button className="filter-button sort-button" type="button">Sort: Best fit</button>
        <button className="filter-button" type="button">≡ Filter</button>
      </div>
      <div className="quote-list">
        {factories.map((factory) => (
          <button
            key={factory.name}
            type="button"
            className={selectedQuote === factory.name ? "factory-card quote-card selected" : "factory-card quote-card"}
            onClick={() => setSelectedQuote(factory.name)}
          >
            <div className="factory-avatar">AM</div>
            <div className="factory-main">
              <div className="factory-name-row">
                <h3>{factory.name}</h3>
                <img className="trust-icon" src={`/assets/prototype-icons/${factory.trust}.svg`} alt={`${factory.trust} factory`} />
              </div>
              <p>{factory.location}</p>
              <span>{factory.note}</span>
              <div className="tag-row compact-tags">
                {factory.tags.slice(0, 4).map((tag) => (
                  <span className="tag" key={tag}>{tag}</span>
                ))}
              </div>
            </div>
            <Metric label="unit price" value={factory.price} />
            <Metric label="quantity" value={factory.quoteQuantity} />
            <Metric label="bulk lead" value={factory.lead} />
            <div className="factory-actions quote-actions">
              <span className="save-pill">Message</span>
              <strong onClick={() => goTo("quoteDetail")}>Review</strong>
            </div>
            <div className="quote-fit-row">
              <span className={quoteFitClass(factory.fitType)}>{factory.fitType}</span>
              <p>{factory.fitSummary}</p>
            </div>
            <div className="factory-note-box">
              <strong>Notes from factory</strong>
              <span>{factory.factoryNote}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function QuoteDetailScreen({ selectedQuote, goTo }) {
  const factory = factories.find((item) => item.name === selectedQuote) || factories[0];
  return (
    <div className="quote-detail-layout">
      <button className="text-link quote-back-link" type="button" onClick={() => goTo("quotes")}>&lt; Back to factory quotes</button>
      <header className="quote-detail-header">
        <h1>{factory.name} quotation</h1>
        <p>Review the full factory quote before messaging, asking a follow-up question, or choosing this quote for contract terms.</p>
      </header>
      <div className="quote-detail-grid">
        <Card className="quote-detail-card">
          <section className="quote-detail-summary">
            <div className="factory-avatar">AM</div>
            <div className="factory-main">
              <div className="factory-name-row">
                <h3>{factory.name}</h3>
                <img className="trust-icon" src={`/assets/prototype-icons/${factory.trust}.svg`} alt={`${factory.trust} factory`} />
              </div>
              <p>{factory.location}</p>
              <span>{factory.note}</span>
              <div className="tag-row compact-tags">
                {["Cut & sew", "GOTS", "Pattern support"].map((tag) => (
                  <span className="tag" key={tag}>{tag}</span>
                ))}
              </div>
            </div>
            <Metric label="unit price" value={factory.price} />
            <Metric label="quantity" value={factory.quoteQuantity} />
            <Metric label="bulk lead" value={factory.lead} />
            <div className="factory-actions quote-actions">
              <span className="save-pill">Message</span>
              <strong onClick={() => goTo("contract")}>Choose quote</strong>
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
            <p>Can quote fit and PP separately. Needs confirmed fabric GSM, button trim, and final size spec before final sample cost.</p>
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

function ContractScreen({ selectedQuote }) {
  return (
    <div className="stack contract-stack">
      <Card title="Work details">
        <Field
          label="Contract title"
          value="Organic cotton woven shirt sample + bulk production"
        />
        <section className="contract-section">
          <h3>Scope of work</h3>
          <div className="contract-textarea">
            Produce organic cotton woven shirts based on the attached tech pack. Quote covers 300
            units across 3 colors, fit sample and PP sample before bulk, and a 28-day bulk lead
            after PP approval.
          </div>
        </section>
        <section className="contract-section">
          <h3>Approvals, revisions, and delivery</h3>
          <div className="contract-textarea">
            Fit sample + PP sample before bulk; 3 colors at 100 units per color; one included fit
            sample revision; QC photos before final balance; delivery address confirmed before bulk;
            extra revision fees quoted separately.
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
    <div className="stack">
      <Card title="Contract terms">
        <p className="muted">
          TSC project funds hold money until the approved step is released.
        </p>
        <div className="field single-field payment-amount-field">
          <span>Contract amount</span>
          <strong>$5,520 estimated production value</strong>
        </div>
        <section className="payment-section">
          <h3>Payment schedule</h3>
          <div className="payment-options">
            <label className="payment-choice selected">
              <input type="radio" name="payment" defaultChecked />
              <span className="radio-mark" aria-hidden="true" />
              <span className="payment-copy">
                <strong>
                  Pay by production steps <span className="recommended-pill">Recommended</span>
                </strong>
                <span>Only fund the first step today. Fund later steps after approvals.</span>
              </span>
            </label>
            <label className="payment-choice">
              <input type="radio" name="payment" />
              <span className="radio-mark" aria-hidden="true" />
              <span className="payment-copy">
                <strong>Pay full contract</strong>
                <span>Fund the full estimated contract today.</span>
              </span>
            </label>
          </div>
        </section>
        <section className="payment-note">
          <h3>Production terms are estimates</h3>
          <p>Bulk deposit and final balance can adjust after sample approval and confirmed size breakdown.</p>
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
        <p className="muted">
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

function FundScreen() {
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
          <button className="primary-btn" type="button" onClick={() => goTo("describe")}>
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

function Field({ label, value, muted = false }) {
  return (
    <div className={muted ? "field muted-field" : "field"}>
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

function BottomBar({ canBack, onBack, onNext, primaryLabel, centerText = "", secondaryLabel = "" }) {
  return (
    <footer className={canBack ? "bottom-bar has-back" : "bottom-bar no-back"}>
      {canBack && (
        <button className="secondary-btn" type="button" onClick={onBack}>
          Back
        </button>
      )}
      {centerText && <span className="bottom-meta">{centerText}</span>}
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
