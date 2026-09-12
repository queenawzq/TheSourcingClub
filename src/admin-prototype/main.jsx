import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrototypeSideNav, ProfileChipSection, ProfileDetailPair } from "../shared/ProfileShell.jsx";
import "../prototype/styles.css";
import "../factory-prototype/styles.css";
import "../shared/profile-shell.css";
import "./styles.css";

const adminNav = [
  { label: "Overview", icon: "home" },
  { label: "RFQs", icon: "rfq" },
  { label: "Quotes", icon: "projects" },
  { label: "Verification", icon: "verification" },
  { label: "Settings", icon: "settings" }
];

const initialProfiles = [
  {
    id: "vendor-atelier",
    initials: "AM",
    name: "Atelier Minho",
    entityType: "Factory",
    location: "Porto, Portugal",
    submitted: "18 min ago",
    status: "Ready for review",
    tone: "info",
    confidence: 94,
    completion: 100,
    evidence: "8 of 8 received",
    owner: "Unassigned",
    risk: "Low",
    summary: "Woven and cut-and-sew factory specializing in premium small-batch shirts, dresses, and linen separates.",
    details: [["Year founded", "2016"], ["Team size", "120"], ["Website", "atelierminho.pt"], ["Primary market", "EU & North America"], ["Typical MOQ", "150 units / style"], ["Lead time", "22-28 days"]],
    capabilities: ["Wovens", "Cut & sew", "GOTS cotton", "Small-batch export"],
    checks: [
      ["Business identity", "Verified", 99, "Registration name and address match the submitted profile."],
      ["Registration document", "Verified", 98, "Document is legible, current, and matches public registry data."],
      ["Website and domain", "Verified", 91, "Domain history and business contact details are consistent."],
      ["Certification evidence", "Review", 82, "GOTS certificate is valid; scope should be confirmed manually."],
      ["Production evidence", "Verified", 94, "Uploaded samples and facility video support stated capabilities."],
      ["Risk screening", "Clear", 99, "No material sanctions, adverse media, or duplicate-account signals found."]
    ]
  },
  {
    id: "brand-maison",
    initials: "MR",
    name: "Maison Rue",
    entityType: "Brand",
    location: "New York, USA",
    submitted: "42 min ago",
    status: "Needs information",
    tone: "warning",
    confidence: 76,
    completion: 86,
    evidence: "6 of 8 received",
    owner: "Maya Chen",
    risk: "Medium",
    summary: "Premium womenswear brand sourcing elevated woven capsules and low-volume seasonal collections.",
    details: [["Year founded", "2021"], ["Business type", "DTC brand"], ["Website", "maisonrue.com"], ["Headquarters", "New York, USA"], ["Annual volume", "5,000-20,000 units"], ["Target FOB", "$12-$28 / unit"]],
    capabilities: ["Womenswear", "Wovens", "Premium / contemporary", "DTC"],
    checks: [
      ["Business identity", "Verified", 96, "Legal business name matches the submitted account."],
      ["Website and domain", "Verified", 93, "Domain and company email are consistent."],
      ["Business registration", "Missing", 48, "A current registration document has not been uploaded."],
      ["Brand ownership", "Review", 71, "Trademark ownership could not be confirmed automatically."],
      ["Product evidence", "Verified", 90, "Uploaded collection images align with the stated product focus."],
      ["Risk screening", "Clear", 98, "No material sanctions or adverse media signals found."]
    ]
  },
  {
    id: "vendor-seoul",
    initials: "SK",
    name: "Seoul Knit Works",
    entityType: "Factory",
    location: "Seoul, South Korea",
    submitted: "Yesterday",
    status: "Manual review",
    tone: "warning",
    confidence: 84,
    completion: 96,
    evidence: "7 of 8 received",
    owner: "Leo Park",
    risk: "Low",
    summary: "Knitwear manufacturer supporting premium sweaters, cardigans, rib knits, and development sampling.",
    details: [["Year founded", "2012"], ["Team size", "86"], ["Website", "seoulknitworks.kr"], ["Primary market", "US & South Korea"], ["Typical MOQ", "200 units / style"], ["Lead time", "32-40 days"]],
    capabilities: ["Knitwear", "Sweaters", "Sample development", "OEKO-TEX"],
    checks: [
      ["Business identity", "Verified", 98, "Registration data matches the submitted company."],
      ["Registration document", "Verified", 96, "Document appears current and authentic."],
      ["Website and domain", "Review", 78, "The public website does not show a matching street address."],
      ["Certification evidence", "Verified", 92, "OEKO-TEX certificate number and holder match."],
      ["Production evidence", "Verified", 89, "Samples support the stated knitwear capabilities."],
      ["Risk screening", "Clear", 99, "No material risk signals found."]
    ]
  },
  {
    id: "trading-pacific",
    initials: "PS",
    name: "Pacific Source Partners",
    entityType: "Trading company",
    location: "Hong Kong / Shenzhen",
    submitted: "Yesterday",
    status: "Ready for review",
    tone: "info",
    confidence: 89,
    completion: 100,
    evidence: "8 of 8 received",
    owner: "Unassigned",
    risk: "Low",
    summary: "Multi-region sourcing and production-management company for premium apparel brands.",
    details: [["Year founded", "2016"], ["Team size", "25"], ["Website", "pacificsourcepartners.com"], ["Sourcing offices", "Hong Kong / Shenzhen"], ["Partner factories", "18 active"], ["Typical order", "$15k-$100k"]],
    capabilities: ["Supplier matching", "Production management", "Quality control", "Logistics"],
    checks: [
      ["Business identity", "Verified", 98, "Registration data matches the company profile."],
      ["Registration document", "Verified", 97, "Registration is current and in good standing."],
      ["Website and domain", "Verified", 90, "Website, email domain, and office details are consistent."],
      ["Supplier network evidence", "Review", 83, "Three partner relationships are documented; sample-check one reference."],
      ["Client reference", "Verified", 88, "One reference has confirmed a completed production program."],
      ["Risk screening", "Clear", 99, "No material sanctions or adverse media signals found."]
    ]
  }
];

const rfqs = [
  ["RFQ-1048", "Organic cotton woven shirt", "Maison Rue", "Aug 12", "6 vendors", "Open", "info"],
  ["RFQ-1047", "Premium knit resort capsule", "Élan Studio", "Aug 12", "4 vendors", "Quotes received", "success"],
  ["RFQ-1046", "Washed denim overshirt", "Northline", "Aug 11", "8 vendors", "Quotes received", "success"],
  ["RFQ-1045", "Recycled nylon activewear set", "Form Athletics", "Aug 11", "3 vendors", "Needs review", "warning"],
  ["RFQ-1044", "Linen co-ord collection", "Serein", "Aug 10", "5 vendors", "Closed", "neutral"]
];

const quotes = [
  ["Q-2098", "Atelier Minho", "Maison Rue", "RFQ-1048", "$5,780", "Aug 13", "Brand reviewing", "warning"],
  ["Q-2089", "Porto Stitch Studio", "Maison Rue", "RFQ-1048", "$6,120", "Aug 13", "Submitted", "info"],
  ["Q-2082", "Lusitano Apparel", "Maison Rue", "RFQ-1048", "$5,940", "Aug 12", "Submitted", "info"],
  ["Q-2097", "Seoul Knit Works", "Élan Studio", "RFQ-1047", "$18,400", "Aug 13", "Submitted", "info"],
  ["Q-2088", "Busan Knit Lab", "Élan Studio", "RFQ-1047", "$19,250", "Aug 13", "Submitted", "info"],
  ["Q-2079", "Hangzhou Fine Knit", "Élan Studio", "RFQ-1047", "$17,980", "Aug 12", "Needs clarification", "warning"],
  ["Q-2096", "Blue Harbour Denim", "Northline", "RFQ-1046", "$12,650", "Aug 12", "Revision requested", "danger"],
  ["Q-2087", "Izmir Denim Works", "Northline", "RFQ-1046", "$13,180", "Aug 12", "Submitted", "info"],
  ["Q-2076", "Rivet & Loom", "Northline", "RFQ-1046", "$12,920", "Aug 11", "Submitted", "info"],
  ["Q-2095", "Lotus Active Manufacturing", "Form Athletics", "RFQ-1045", "$9,240", "Aug 12", "Accepted", "success"],
  ["Q-2085", "Taipei Performance Co.", "Form Athletics", "RFQ-1045", "$9,680", "Aug 12", "Submitted", "info"],
  ["Q-2074", "MotionTex Vietnam", "Form Athletics", "RFQ-1045", "$9,410", "Aug 11", "Needs clarification", "warning"],
  ["Q-2094", "Atelier Minho", "Serein", "RFQ-1044", "$7,920", "Aug 11", "Declined", "neutral"]
];

const rfqDetails = {
  "RFQ-1048": { category: "Women’s woven tops", quantity: "300 units · 3 colors", targetPrice: "$18–$24 / unit", delivery: "Late September", materials: "Organic cotton poplin, 120–140 GSM", samples: "Fit sample + PP sample", requirements: "GOTS-certified fabric, branded buttons, woven labels, and recyclable packaging." },
  "RFQ-1047": { category: "Premium knitwear", quantity: "800 units · 4 styles", targetPrice: "$19–$32 / unit", delivery: "Mid October", materials: "Cotton-cashmere blend and compact viscose", samples: "Development sample + size set", requirements: "Fully fashioned construction, custom color matching, and OEKO-TEX compliant yarns." },
  "RFQ-1046": { category: "Denim outerwear", quantity: "600 units · 2 washes", targetPrice: "$20–$28 / unit", delivery: "Early October", materials: "12 oz regenerative cotton denim", samples: "Wash trials + PP sample", requirements: "Low-impact washing, custom shanks, contrast topstitching, and recycled labels." },
  "RFQ-1045": { category: "Performance activewear", quantity: "450 sets · 3 colors", targetPrice: "$16–$23 / set", delivery: "Late October", materials: "GRS recycled nylon with elastane", samples: "Fit sample + wear-test set", requirements: "Moisture management, bonded seams, branded heat transfers, and colorfastness testing." },
  "RFQ-1044": { category: "Linen separates", quantity: "500 units · 4 styles", targetPrice: "$17–$27 / unit", delivery: "Completed", materials: "European flax linen blend", samples: "Fit sample + PP sample", requirements: "Garment wash, natural shell buttons, woven labels, and plastic-free packing." }
};

function StatusPill({ children, tone = "info" }) {
  return <span className={`project-status shared-card-status ${tone}`}>{children}</span>;
}

function SearchIcon() {
  return (
    <svg className="search-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.75" cy="8.75" r="5.25" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M12.6 12.6L16.25 16.25" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function MetricCard({ label, value, note, tone }) {
  return (
    <section className={`factory-metric-card admin-metric-card ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </section>
  );
}

function Panel({ title, subtitle, action, onAction, children, className = "" }) {
  return (
    <section className={`factory-dashboard-panel admin-panel ${className}`}>
      <header>
        <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        {action && <button className="secondary-btn compact-btn" type="button" onClick={onAction}>{action}</button>}
      </header>
      <div className="factory-dashboard-panel-list">{children}</div>
    </section>
  );
}

function VerificationRow({ profile, onReview }) {
  return (
    <article className="admin-verification-row">
      <div className="admin-entity-identity">
        <span>{profile.initials}</span>
        <div><strong>{profile.name}</strong><small>{profile.entityType} · {profile.location}</small></div>
      </div>
      <div className="admin-row-stat"><span>Confidence</span><strong>{profile.confidence}%</strong></div>
      <div className="admin-row-stat"><span>Evidence</span><strong>{profile.evidence}</strong></div>
      <StatusPill tone={profile.tone}>{profile.status}</StatusPill>
      <button className="secondary-btn compact-btn" type="button" onClick={() => onReview(profile)}>Review</button>
    </article>
  );
}

function DataTable({ columns, rows, type, onView }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>
              {row.slice(0, -2).map((cell, index) => <td key={`${row[0]}-${index}`}>{index === 0 ? <strong>{cell}</strong> : cell}</td>)}
              <td><StatusPill tone={row[row.length - 1]}>{row[row.length - 2]}</StatusPill></td>
              <td><button className="secondary-btn compact-btn" type="button" onClick={() => onView?.(row)}>{type === "rfq" ? "View RFQ" : "View quote"}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RfqActivityCards({ onOpenRfq }) {
  const recentRfqs = rfqs.slice(0, 4);
  return (
    <div className="home-rfq-list admin-rfq-card-list">
      {recentRfqs.map((rfq) => {
        const quote = quotes.find((item) => item[3] === rfq[0]);
        const quoteCount = quotes.filter((item) => item[3] === rfq[0]).length;
        return (
          <article className="home-rfq-card admin-rfq-card shared-responsive-card shared-dashboard-card" key={rfq[0]}>
            <header className="home-production-title shared-card-heading">
              <span className="admin-rfq-card-icon"><img src="/assets/prototype-icons/rfq.svg" alt="" /></span>
              <div><h3>{rfq[1]}</h3><p>{rfq[0]} · {rfq[2]} · Submitted {rfq[3]}</p></div>
            </header>
            <div className="home-rfq-side shared-card-actions">
              <StatusPill tone={rfq[6]}>{rfq[5]}</StatusPill>
              <button className="primary-btn" type="button" onClick={() => onOpenRfq(rfq)}>View RFQ</button>
            </div>
            <div className="home-production-facts home-rfq-facts shared-card-body">
              <div><span>Quotes received</span><strong>{quoteCount}</strong></div>
              <div><span>Invited</span><strong>{rfq[4].replace(" vendors", "")}</strong></div>
              <div><span>Latest quote</span><strong>{quote?.[4] || "—"}</strong></div>
            </div>
            <div className="home-rfq-description admin-rfq-quote-summary">
              <span>{quote ? `${quote[0]} from ${quote[1]} · submitted ${quote[5]}` : "No vendor responses yet"}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Overview({ profiles, onReview, onNavigate, onOpenRfq }) {
  const pending = profiles.filter((profile) => !["Approved", "Declined"].includes(profile.status));
  return (
    <main className="factory-dashboard-page admin-page">
      <div className="factory-dashboard-shell admin-shell">
        <header className="factory-dashboard-header admin-header">
          <div><span className="admin-eyebrow">Operations workspace</span><h1>Admin overview</h1><p>Monitor marketplace activity and review the profiles waiting for a decision.</p></div>
          <button className="activity-icon-btn" type="button" aria-label="Open notifications"><img src="/assets/prototype-icons/notification.svg" alt="" /><b>5</b></button>
        </header>

        <div className="factory-dashboard-metrics admin-metrics">
          <MetricCard label="Profiles awaiting review" value={pending.length} note="2 submitted today" tone="blue" />
          <MetricCard label="RFQs submitted today" value="12" note="3 need marketplace review" tone="green" />
          <MetricCard label="Quotes submitted today" value="19" note="2 revisions flagged" tone="amber" />
          <MetricCard label="Low-confidence checks" value="3" note="Below the 80% threshold" tone="red" />
        </div>

        <section className="admin-overview-grid">
          <Panel title="Verification queue" subtitle="Profiles prioritized by risk, confidence, and submission time." action="View all" onAction={() => onNavigate("Verification")}>
            {pending.map((profile) => <VerificationRow profile={profile} onReview={onReview} key={profile.id} />)}
          </Panel>
        </section>

        <Panel title="Recent RFQs and quotes" subtitle="Review each request together with its latest vendor response." action="View all RFQs" onAction={() => onNavigate("RFQs")}>
          <RfqActivityCards onOpenRfq={onOpenRfq} />
        </Panel>
      </div>
    </main>
  );
}

function QueuePage({ kind, profiles, onReview, onOpenRfq, onOpenQuote }) {
  const [verificationTab, setVerificationTab] = useState("Active");
  const [rfqTab, setRfqTab] = useState("All");
  const [quoteTab, setQuoteTab] = useState("All");
  const [profileType, setProfileType] = useState("All profile types");
  const [searchTerm, setSearchTerm] = useState("");
  const isProfiles = kind === "Verification";
  const baseProfiles = profiles;
  const verificationTabs = ["Active", "Approved", "Needs information", "Declined"];
  const rfqTabs = ["All", "Open", "With quotes", "Needs attention", "Closed"];
  const quoteTabs = ["All", "Submitted", "Brand reviewing", "Needs attention", "Accepted", "Closed"];
  const matchesVerificationTab = (profile, tab) => tab === "Active"
    ? !["Approved", "Needs information", "Declined"].includes(profile.status)
    : profile.status === tab;
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const tabCounts = Object.fromEntries(verificationTabs.map((tab) => [tab, profiles.filter((profile) => matchesVerificationTab(profile, tab)).length]));
  const matchesRfqTab = (rfq, tab) => tab === "All"
    || rfq[5] === tab
    || (tab === "With quotes" && rfq[5] === "Quotes received")
    || (tab === "Needs attention" && rfq[5] === "Needs review");
  const rfqTabCounts = Object.fromEntries(rfqTabs.map((tab) => [tab, rfqs.filter((rfq) => matchesRfqTab(rfq, tab)).length]));
  const filteredRfqs = rfqs.filter((rfq) => matchesRfqTab(rfq, rfqTab) && (!normalizedSearch || rfq.slice(0, 3).join(" ").toLowerCase().includes(normalizedSearch)));
  const matchesQuoteTab = (quote, tab) => tab === "All"
    || quote[6] === tab
    || (tab === "Needs attention" && ["Needs clarification", "Revision requested"].includes(quote[6]))
    || (tab === "Closed" && quote[6] === "Declined");
  const quoteTabCounts = Object.fromEntries(quoteTabs.map((tab) => [tab, quotes.filter((quote) => matchesQuoteTab(quote, tab)).length]));
  const filteredQuotes = quotes.filter((quote) => matchesQuoteTab(quote, quoteTab) && (!normalizedSearch || quote.slice(0, 4).join(" ").toLowerCase().includes(normalizedSearch)));
  const filteredProfiles = baseProfiles.filter((profile) => {
    const matchesType = kind !== "Verification" || profileType === "All profile types"
      || (profileType === "Brands" && profile.entityType === "Brand")
      || (profileType === "Factories" && profile.entityType === "Factory")
      || (profileType === "Trading companies" && profile.entityType === "Trading company");
    const matchesTab = kind !== "Verification" || matchesVerificationTab(profile, verificationTab);
    const matchesSearch = !normalizedSearch || `${profile.name} ${profile.entityType} ${profile.location}`.toLowerCase().includes(normalizedSearch);
    return matchesType && matchesTab && matchesSearch;
  });
  const copy = {
    RFQs: ["RFQs", "See every request submitted to the marketplace and identify items that need review."],
    Quotes: ["Quotes", "Monitor vendor responses, pricing, revisions, and brand decisions."],
    Verification: ["Verification queue", "Prioritize profile decisions using submitted evidence and backend confidence signals."]
  }[kind];

  return (
    <main className="rfqs-page admin-page admin-queue-page">
      <header className="rfqs-header admin-list-header"><div><p className="admin-eyebrow">Admin</p><h1>{copy[0]}</h1><p>{copy[1]}</p></div></header>
      <div className="admin-filter-bar">
        <label className="admin-search"><SearchIcon /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={`Search ${copy[0].toLowerCase()}`} /></label>
        {kind === "Verification" ? (
          <label className="rfqs-sort admin-profile-type-filter">
            <span>Profile type</span>
            <select value={profileType} onChange={(event) => setProfileType(event.target.value)}>
              <option>All profile types</option>
              <option>Brands</option>
              <option>Factories</option>
              <option>Trading companies</option>
            </select>
          </label>
        ) : null}
        <button className="secondary-btn" type="button">Newest first</button>
      </div>
      {kind === "Verification" && (
        <nav className="rfqs-tabs admin-verification-tabs" aria-label="Verification status">
          {verificationTabs.map((tab) => (
            <button className={verificationTab === tab ? "active" : ""} type="button" aria-current={verificationTab === tab ? "page" : undefined} onClick={() => setVerificationTab(tab)} key={tab}>
              {tab} <span>{tabCounts[tab]}</span>
            </button>
          ))}
        </nav>
      )}
      {kind === "RFQs" && (
        <nav className="rfqs-tabs admin-verification-tabs admin-rfq-tabs" aria-label="RFQ status">
          {rfqTabs.map((tab) => (
            <button className={rfqTab === tab ? "active" : ""} type="button" aria-current={rfqTab === tab ? "page" : undefined} onClick={() => setRfqTab(tab)} key={tab}>
              {tab} <span>{rfqTabCounts[tab]}</span>
            </button>
          ))}
        </nav>
      )}
      {kind === "Quotes" && (
        <nav className="rfqs-tabs admin-verification-tabs admin-quote-tabs" aria-label="Quote status">
          {quoteTabs.map((tab) => (
            <button className={quoteTab === tab ? "active" : ""} type="button" aria-current={quoteTab === tab ? "page" : undefined} onClick={() => setQuoteTab(tab)} key={tab}>
              {tab} <span>{quoteTabCounts[tab]}</span>
            </button>
          ))}
        </nav>
      )}
      {isProfiles ? (
        <Panel title={`${filteredProfiles.length} profiles`} subtitle="Select a profile to inspect all evidence and checks.">
          {filteredProfiles.length > 0
            ? filteredProfiles.map((profile) => <VerificationRow profile={profile} onReview={onReview} key={profile.id} />)
            : <div className="admin-empty-state"><strong>No profiles in this view</strong><p>Try another status or profile type.</p></div>}
        </Panel>
      ) : (
        <Panel title={kind === "RFQs" ? `${filteredRfqs.length} ${rfqTab === "All" ? "recent" : rfqTab.toLowerCase()} RFQ${filteredRfqs.length === 1 ? "" : "s"}` : `${filteredQuotes.length} ${quoteTab === "All" ? "recent" : quoteTab.toLowerCase()} quote${filteredQuotes.length === 1 ? "" : "s"}`}>
          <DataTable
            type={kind === "RFQs" ? "rfq" : "quote"}
            columns={kind === "RFQs" ? ["RFQ", "Request", "Brand", "Submitted", "Invited", "Status", ""] : ["Quote", "Vendor", "Brand", "RFQ", "Total", "Submitted", "Status", ""]}
            rows={kind === "RFQs" ? filteredRfqs : filteredQuotes}
            onView={kind === "RFQs" ? onOpenRfq : onOpenQuote}
          />
        </Panel>
      )}
    </main>
  );
}

function ConfidenceCard({ score }) {
  const tone = score >= 90 ? "success" : score >= 80 ? "warning" : "danger";
  return (
    <section className="factory-profile-card admin-confidence-card">
      <div><span>Overall confidence</span><strong>{score}%</strong><StatusPill tone={tone}>{score >= 90 ? "High confidence" : score >= 80 ? "Review recommended" : "More evidence needed"}</StatusPill></div>
      <div className="admin-confidence-scale"><span style={{ width: `${score}%` }} /></div>
      <p>Confidence summarizes automated checks and submitted evidence. The final decision always remains with TSC operations.</p>
    </section>
  );
}

function FullSubmissionModal({ profile, onClose }) {
  const details = Object.fromEntries(profile.details);
  const isBrand = profile.entityType === "Brand";
  const companyNameLabel = isBrand ? "Brand name" : profile.entityType === "Trading company" ? "Company name" : "Factory name";
  const locationLabel = isBrand ? "Headquarters" : profile.entityType === "Trading company" ? "Primary sourcing office" : "Factory location";
  const sections = [
    {
      title: "Company details",
      fields: [
        [companyNameLabel, profile.name],
        ["Company type", profile.entityType],
        ["Year founded", details["Year founded"] || "—"],
        ["Website", details.Website || "—"],
        [locationLabel, profile.location],
        [isBrand ? "Business type" : "Team size", details[isBrand ? "Business type" : "Team size"] || "—"]
      ]
    },
    {
      title: isBrand ? "Brand context and sourcing needs" : "Company context and uploaded work",
      fields: [
        ["About", profile.summary],
        [isBrand ? "Brand logo" : "Company logo", "Uploaded"],
        [isBrand ? "Reference products" : "Product catalogue", "PDF uploaded"],
        [isBrand ? "Design references" : "Production examples", "6 files uploaded"]
      ]
    },
    {
      title: isBrand ? "Product and sourcing profile" : "Capabilities and market fit",
      fields: [
        [isBrand ? "Target FOB" : "Typical MOQ", details[isBrand ? "Target FOB" : "Typical MOQ"] || "—"],
        [isBrand ? "Annual volume" : "Production lead time", details[isBrand ? "Annual volume" : "Lead time"] || "—"],
        [isBrand ? "Preferred markets" : "Typical sampling time", isBrand ? (details["Primary market"] || "North America") : "10–14 days"],
        [isBrand ? "Preferred order size" : "Monthly capacity", isBrand ? "$15,000–$40,000" : "7,200 units"]
      ],
      chips: profile.capabilities
    },
    {
      title: "Verification documents and declaration",
      fields: [
        ["Business registration", "Uploaded"],
        ["Certification evidence", profile.evidence],
        ["Authorized signatory", isBrand ? "Maya Reynolds" : "Ana Martins"],
        ["Declaration", "Signed electronically · Aug 12"]
      ]
    }
  ];
  return (
    <div className="approve-fund-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="approve-fund-modal admin-review-modal admin-full-submission-modal" role="dialog" aria-modal="true" aria-labelledby="full-submission-title">
        <button className="settings-drawer-close" type="button" aria-label="Close" onClick={onClose}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
        <header><div><span>Submitted profile</span><h2 id="full-submission-title">Full onboarding submission</h2></div></header>
        <div className="admin-submission-sections">
          {sections.map((section) => (
            <section className="admin-submission-section" key={section.title}>
              <h3>{section.title}</h3>
              <div className="admin-submission-grid">
                {section.fields.map(([label, value]) => <ProfileDetailPair label={label} value={value} key={label} />)}
              </div>
              {section.chips && <ProfileChipSection label="Selected capabilities" items={section.chips} />}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

function EvidenceDetailModal({ profile, check, onClose }) {
  if (!check) return null;
  const [label, result, confidence, detail] = check;
  const tone = result === "Verified" || result === "Clear" ? "success" : result === "Missing" ? "danger" : "warning";
  const isCertification = label === "Certification evidence";
  const fileName = isCertification ? "Atelier-Minho-GOTS-certificate.pdf" : `${label.toLowerCase().replaceAll(" ", "-")}-evidence.pdf`;
  return (
    <div className="approve-fund-modal-layer admin-evidence-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="approve-fund-modal admin-review-modal admin-evidence-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-detail-title">
        <button className="settings-drawer-close" type="button" aria-label="Close" onClick={onClose}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
        <header><div><span>Submitted evidence</span><h2 id="evidence-detail-title">{label}</h2></div></header>
        <div className="admin-evidence-layout">
          <aside className="admin-evidence-summary">
            <div className="admin-evidence-file-row"><img src="/assets/prototype-icons/rfq.svg" alt="" /><div><strong>{fileName}</strong><span>PDF · 1 page · 482 KB</span></div></div>
            <div className="admin-evidence-meta-grid">
              <ProfileDetailPair label="Uploaded by" value={profile.name} />
              <ProfileDetailPair label="Received" value={profile.submitted} />
              <ProfileDetailPair label="Automated result" value={`${confidence}% confidence`} />
              <ProfileDetailPair label="Review status" value={result} />
            </div>
            <div className="admin-evidence-note"><span>Check summary</span><p>{detail}</p><StatusPill tone={tone}>{result}</StatusPill></div>
          </aside>

          <div className="admin-document-viewer" aria-label={`${fileName} preview`}>
            <div className="admin-document-toolbar"><span>{fileName}</span><strong>Page 1 of 1</strong></div>
            <article className="admin-certificate-page">
              {isCertification ? (
                <>
                  <div className="admin-certificate-mark">GOTS</div>
                  <p>Global Organic Textile Standard</p>
                  <h3>Certificate of Compliance</h3>
                  <div className="admin-certificate-rule" />
                  <span>This certifies that</span>
                  <h4>Atelier Minho Lda.</h4>
                  <p>Porto, Portugal</p>
                  <div className="admin-certificate-fields">
                    <div><span>Certificate number</span><strong>GOTS-PT-2026-1842</strong></div>
                    <div><span>Scope</span><strong>Cutting, sewing and finishing</strong></div>
                    <div><span>Certified products</span><strong>Organic cotton woven apparel</strong></div>
                    <div><span>Valid through</span><strong>31 August 2027</strong></div>
                  </div>
                  <div className="admin-certificate-signature"><span>Authorized certification body</span><strong>Textile Standards Europe</strong></div>
                </>
              ) : (
                <>
                  <div className="admin-certificate-mark">TSC</div>
                  <p>Marketplace verification evidence</p>
                  <h3>{label}</h3>
                  <div className="admin-certificate-rule" />
                  <span>Submitted by</span>
                  <h4>{profile.name}</h4>
                  <p>{profile.location}</p>
                  <div className="admin-certificate-fields">
                    <div><span>Evidence type</span><strong>{label}</strong></div>
                    <div><span>Automated assessment</span><strong>{detail}</strong></div>
                  </div>
                </>
              )}
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}

function VerificationDetail({ profile, onBack, onDecision }) {
  const [requestOpen, setRequestOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [fullProfileOpen, setFullProfileOpen] = useState(false);
  const [selectedCheck, setSelectedCheck] = useState(null);
  if (!profile) return null;
  return (
    <main className="factory-profile-page brand-profile-page admin-page admin-review-page">
      <div className="admin-review-shell">
        <button className="admin-back-link" type="button" onClick={onBack}>‹ Back to verification queue</button>
        <header className="admin-review-header">
          <div className="admin-entity-identity large"><span>{profile.initials}</span><div><small>{profile.entityType} profile</small><h1>{profile.name}</h1><p>{profile.location} · Submitted {profile.submitted}</p></div></div>
          <StatusPill tone={profile.tone}>{profile.status}</StatusPill>
        </header>

        <div className="admin-review-layout">
          <div className="admin-review-main">
            <Panel title="Profile summary" subtitle={profile.summary} action="View full submission" onAction={() => setFullProfileOpen(true)}>
              <div className="admin-detail-grid">{profile.details.map(([label, value]) => <ProfileDetailPair label={label} value={value} key={label} />)}</div>
              <ProfileChipSection label="Capabilities and positioning" items={profile.capabilities} />
            </Panel>
            <Panel title="Verification checks" subtitle="Backend checks are shown with their evidence, result, and confidence so the final decision is explainable.">
              <div className="admin-check-list">
                {profile.checks.map(([label, result, confidence, detail]) => {
                  const tone = result === "Verified" || result === "Clear" ? "success" : result === "Missing" ? "danger" : "warning";
                  return (
                    <article
                      className="admin-check-row"
                      role="button"
                      tabIndex={0}
                      aria-label={`View evidence for ${label}`}
                      onClick={() => setSelectedCheck([label, result, confidence, detail])}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedCheck([label, result, confidence, detail]);
                        }
                      }}
                      key={label}
                    >
                      <div className="admin-check-copy"><strong>{label}</strong><p>{detail}</p><span>Source: submitted evidence + registry checks</span></div>
                      <div className="admin-check-result">
                        <div className="admin-check-confidence"><strong>{confidence}%</strong><span>confidence</span></div>
                        <StatusPill tone={tone}>{result}</StatusPill>
                      </div>
                    </article>
                  );
                })}
              </div>
            </Panel>
          </div>
          <aside className="admin-review-side">
            <ConfidenceCard score={profile.confidence} />
            <section className="factory-profile-card admin-review-meta">
              <h2>Review details</h2>
              <ProfileDetailPair label="Profile completeness" value={`${profile.completion}%`} />
              <ProfileDetailPair label="Evidence received" value={profile.evidence} />
              <ProfileDetailPair label="Risk level" value={profile.risk} />
              <ProfileDetailPair label="Assigned to" value={profile.owner} />
            </section>
            <section className="factory-profile-card admin-decision-card">
              <span>Final decision</span>
              <h2>Complete this review</h2>
              <p>Review the evidence and confidence signals before making a marketplace decision.</p>
              <button className="primary-btn" type="button" onClick={() => onDecision(profile.id, "Approved")}>Approve profile</button>
              <button className="secondary-btn" type="button" onClick={() => setRequestOpen(true)}>Request more information</button>
              <button className="admin-decline-button" type="button" onClick={() => setDeclineOpen(true)}>Decline profile</button>
            </section>
          </aside>
        </div>
      </div>
      {requestOpen && (
        <div className="approve-fund-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setRequestOpen(false)}>
          <section className="approve-fund-modal admin-review-modal" role="dialog" aria-modal="true" aria-labelledby="request-info-title">
            <button className="settings-drawer-close" type="button" aria-label="Close" onClick={() => setRequestOpen(false)}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
            <header><div><span>Profile review</span><h2 id="request-info-title">Request more information</h2><p>Tell {profile.name} what is needed to complete verification.</p></div></header>
            <div className="admin-request-options">
              {["Business registration document", "Certification scope or validity", "Facility or product evidence", "Company ownership details"].map((label) => <label key={label}><input type="checkbox" /> <span>{label}</span></label>)}
            </div>
            <label className="factory-onboarding-field"><span>Message</span><textarea placeholder="Add context or instructions for the applicant..." /></label>
            <footer><button className="secondary-btn" type="button" onClick={() => setRequestOpen(false)}>Cancel</button><button className="primary-btn" type="button" onClick={() => { setRequestOpen(false); onDecision(profile.id, "Needs information"); }}>Send request</button></footer>
          </section>
        </div>
      )}
      {fullProfileOpen && <FullSubmissionModal profile={profile} onClose={() => setFullProfileOpen(false)} />}
      {selectedCheck && <EvidenceDetailModal profile={profile} check={selectedCheck} onClose={() => setSelectedCheck(null)} />}
      {declineOpen && (
        <div className="approve-fund-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDeclineOpen(false)}>
          <section className="approve-fund-modal admin-review-modal small" role="dialog" aria-modal="true" aria-labelledby="decline-title">
            <button className="settings-drawer-close" type="button" aria-label="Close" onClick={() => setDeclineOpen(false)}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
            <header><div><span>Final decision</span><h2 id="decline-title">Decline this profile?</h2><p>The applicant will be notified and can contact support if they believe this is an error.</p></div></header>
            <label className="factory-onboarding-field"><span>Reason</span><textarea placeholder="Explain why this profile cannot be approved..." /></label>
            <footer><button className="secondary-btn" type="button" onClick={() => setDeclineOpen(false)}>Cancel</button><button className="primary-btn danger-action" type="button" onClick={() => { setDeclineOpen(false); onDecision(profile.id, "Declined"); }}>Decline profile</button></footer>
          </section>
        </div>
      )}
    </main>
  );
}

function AdminRfqDetail({ rfq, onBack, backLabel, onOpenQuote }) {
  if (!rfq) return null;
  const rfqQuotes = quotes.filter((item) => item[3] === rfq[0]);
  const details = rfqDetails[rfq[0]] || {};
  return (
    <main className="factory-profile-page brand-profile-page admin-page admin-review-page admin-rfq-detail-page">
      <div className="admin-review-shell">
        <button className="admin-back-link" type="button" onClick={onBack}>‹ Back to {backLabel === "Overview" ? "overview" : "RFQs"}</button>
        <header className="admin-review-header admin-rfq-detail-header">
          <div><span className="admin-eyebrow">{rfq[0]}</span><h1>{rfq[1]}</h1><p>{rfq[2]} · Submitted {rfq[3]}</p></div>
          <StatusPill tone={rfq[6]}>{rfq[5]}</StatusPill>
        </header>

        <div className="admin-review-layout">
          <div className="admin-review-main">
            <Panel title={`${rfqQuotes.length} vendor quote${rfqQuotes.length === 1 ? "" : "s"}`} subtitle="Compare submitted responses, then open any quote to review its full commercial details.">
              <div className="admin-quote-list">
                {rfqQuotes.map((quote, index) => (
                  <article className="admin-quote-card" key={quote[0]}>
                    <header><div><span>{quote[0]} · Submitted {quote[5]}</span><h3>{quote[1]}</h3></div><StatusPill tone={quote[7]}>{quote[6]}</StatusPill></header>
                    <div className="admin-quote-card-stats">
                      <ProfileDetailPair label="Quote total" value={quote[4]} />
                      <ProfileDetailPair label="Bulk lead" value={`${[28, 31, 26][index % 3]} days`} />
                      <ProfileDetailPair label="Sample cost" value={["$260", "$310", "$240"][index % 3]} />
                    </div>
                    <button className="secondary-btn compact-btn" type="button" onClick={() => onOpenQuote(quote)}>View quote</button>
                  </article>
                ))}
              </div>
            </Panel>

            <Panel title="Request brief" subtitle="Review the original brand request and its commercial targets.">
              <div className="admin-detail-grid">
                <ProfileDetailPair label="Brand" value={rfq[2]} />
                <ProfileDetailPair label="Product category" value={details.category} />
                <ProfileDetailPair label="Quantity" value={details.quantity} />
                <ProfileDetailPair label="Target price" value={details.targetPrice} />
                <ProfileDetailPair label="Target delivery" value={details.delivery} />
                <ProfileDetailPair label="Invited factories" value={rfq[4]} />
              </div>
            </Panel>

            <Panel title="Product and sourcing requirements" subtitle="The production information supplied to invited factories.">
              <div className="admin-rfq-requirement-list">
                <ProfileDetailPair label="Materials" value={details.materials} />
                <ProfileDetailPair label="Sample plan" value={details.samples} />
                <ProfileDetailPair label="Technical and compliance notes" value={details.requirements} />
              </div>
            </Panel>

          </div>

          <aside className="admin-review-side">
            <section className="factory-profile-card admin-review-meta">
              <h2>RFQ details</h2>
              <ProfileDetailPair label="Request ID" value={rfq[0]} />
              <ProfileDetailPair label="Current status" value={rfq[5]} />
              <ProfileDetailPair label="Quotes received" value={`${rfqQuotes.length}`} />
              <ProfileDetailPair label="Submitted" value={rfq[3]} />
            </section>
            <section className="factory-profile-card admin-decision-card admin-rfq-activity-card">
              <span>Marketplace activity</span>
              <h2>Request timeline</h2>
              <div className="admin-rfq-timeline">
                <p><strong>{rfq[3]}</strong>RFQ submitted by {rfq[2]}</p>
                <p><strong>{rfq[3]}</strong>{rfq[4]} invited to quote</p>
                {rfqQuotes[0] && <p><strong>{rfqQuotes[0][5]}</strong>{rfqQuotes.length} vendor quotes received</p>}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function AdminQuoteDetail({ quote, rfq, onBack }) {
  if (!quote || !rfq) return null;
  const details = rfqDetails[rfq[0]] || {};
  const siblingQuotes = quotes.filter((item) => item[3] === rfq[0]);
  const quoteIndex = Math.max(0, siblingQuotes.findIndex((item) => item[0] === quote[0]));
  const quantity = Number.parseInt(details.quantity, 10) || 300;
  const total = Number.parseFloat(quote[4].replace(/[$,]/g, "")) || 0;
  const unitPrice = `$${(total / quantity).toFixed(2)}`;
  const lead = `${[28, 31, 26][quoteIndex % 3]} days`;
  const sampleCost = ["$260", "$310", "$240"][quoteIndex % 3];
  const paymentTerms = ["30% deposit · 70% before shipment", "40% deposit · 60% before shipment", "30% deposit · 70% net 7"][quoteIndex % 3];
  const shipping = ["EXW · freight not included", "FOB · export handling included", "FOB · freight quoted separately"][quoteIndex % 3];
  return (
    <main className="factory-profile-page brand-profile-page admin-page admin-review-page admin-quote-detail-page">
      <div className="admin-review-shell">
        <button className="admin-back-link" type="button" onClick={onBack}>‹ Back to {rfq[0]} quotes</button>
        <header className="admin-review-header admin-rfq-detail-header">
          <div><span className="admin-eyebrow">{quote[0]}</span><h1>{quote[1]} quotation</h1><p>{rfq[1]} · Submitted {quote[5]}</p></div>
          <StatusPill tone={quote[7]}>{quote[6]}</StatusPill>
        </header>
        <div className="admin-review-layout">
          <div className="admin-review-main">
            <Panel title="Quote overview" subtitle="Full commercial response submitted by the vendor.">
              <div className="admin-detail-grid admin-quote-detail-grid">
                <ProfileDetailPair label="Quote total" value={quote[4]} />
                <ProfileDetailPair label="Unit price" value={unitPrice} />
                <ProfileDetailPair label="Quantity" value={details.quantity} />
                <ProfileDetailPair label="Bulk lead time" value={lead} />
                <ProfileDetailPair label="Sample plan" value={details.samples} />
                <ProfileDetailPair label="Sample cost" value={sampleCost} />
              </div>
            </Panel>
            <Panel title="Commercial terms" subtitle="Terms included in this vendor submission.">
              <div className="admin-rfq-requirement-list">
                <ProfileDetailPair label="Payment terms" value={paymentTerms} />
                <ProfileDetailPair label="Shipping / incoterms" value={shipping} />
                <ProfileDetailPair label="Materials included" value={details.materials} />
                <ProfileDetailPair label="Vendor note" value={`Capacity is reserved for the requested delivery window. Final pricing is subject to approved samples, confirmed specifications, and color standards.`} />
              </div>
            </Panel>
            <Panel title="Original request" subtitle={`${rfq[0]} from ${rfq[2]}`}>
              <div className="admin-detail-grid">
                <ProfileDetailPair label="Product" value={rfq[1]} />
                <ProfileDetailPair label="Target price" value={details.targetPrice} />
                <ProfileDetailPair label="Target delivery" value={details.delivery} />
              </div>
            </Panel>
          </div>
          <aside className="admin-review-side">
            <section className="factory-profile-card admin-review-meta">
              <h2>Quote details</h2>
              <ProfileDetailPair label="Vendor" value={quote[1]} />
              <ProfileDetailPair label="Brand" value={rfq[2]} />
              <ProfileDetailPair label="RFQ" value={rfq[0]} />
              <ProfileDetailPair label="Status" value={quote[6]} />
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function SettingsPage() {
  const initialThresholds = { autoClear: "95", manualMin: "80", manualMax: "94", moreInformation: "80", authority: "TSC operations" };
  const [thresholds, setThresholds] = useState(initialThresholds);
  const [draft, setDraft] = useState(initialThresholds);
  const [isEditing, setIsEditing] = useState(false);
  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const startEditing = () => { setDraft(thresholds); setIsEditing(true); };
  const cancelEditing = () => { setDraft(thresholds); setIsEditing(false); };
  const saveThresholds = (event) => {
    event.preventDefault();
    setThresholds(draft);
    setIsEditing(false);
  };

  return (
    <main className="settings-page-shell admin-page admin-settings-page">
      <header className="rfqs-header"><div><p className="admin-eyebrow">Admin</p><h1>Verification settings</h1><p>Preview the thresholds and routing rules that future backend checks will use.</p></div></header>
      <Panel
        title="Review thresholds"
        subtitle={isEditing ? "Update the confidence ranges and decision ownership." : "These controls are placeholders for the verification procedure that will be connected later."}
        action={isEditing ? null : "Edit"}
        onAction={startEditing}
        className={isEditing ? "admin-settings-card is-editing" : "admin-settings-card"}
      >
        {isEditing ? (
          <form className="admin-threshold-form" onSubmit={saveThresholds}>
            <label className="admin-threshold-field">
              <span>Auto-clear threshold</span>
              <div className="admin-number-input"><input type="number" min="0" max="100" required value={draft.autoClear} onChange={(event) => updateDraft("autoClear", event.target.value)} /><span>% confidence</span></div>
            </label>
            <label className="admin-threshold-field">
              <span>Manual review range</span>
              <div className="admin-range-input">
                <input aria-label="Manual review minimum" type="number" min="0" max="100" required value={draft.manualMin} onChange={(event) => updateDraft("manualMin", event.target.value)} />
                <span>to</span>
                <input aria-label="Manual review maximum" type="number" min="0" max="100" required value={draft.manualMax} onChange={(event) => updateDraft("manualMax", event.target.value)} />
                <span>%</span>
              </div>
            </label>
            <label className="admin-threshold-field">
              <span>More information threshold</span>
              <div className="admin-number-input"><span>Below</span><input type="number" min="0" max="100" required value={draft.moreInformation} onChange={(event) => updateDraft("moreInformation", event.target.value)} /><span>%</span></div>
            </label>
            <label className="admin-threshold-field">
              <span>Final decision authority</span>
              <select value={draft.authority} onChange={(event) => updateDraft("authority", event.target.value)}>
                <option>TSC operations</option>
                <option>Verification lead</option>
                <option>Marketplace admin</option>
              </select>
            </label>
            <div className="admin-settings-actions">
              <button className="secondary-btn" type="button" onClick={cancelEditing}>Cancel</button>
              <button className="primary-btn" type="submit">Save changes</button>
            </div>
          </form>
        ) : (
          <div className="admin-settings-grid">
            <ProfileDetailPair label="Auto-clear threshold" value={`${thresholds.autoClear}% confidence`} />
            <ProfileDetailPair label="Manual review range" value={`${thresholds.manualMin}-${thresholds.manualMax}% confidence`} />
            <ProfileDetailPair label="More information threshold" value={`Below ${thresholds.moreInformation}%`} />
            <ProfileDetailPair label="Final decision authority" value={thresholds.authority} />
          </div>
        )}
      </Panel>
    </main>
  );
}

function App() {
  const query = new URLSearchParams(window.location.search);
  const requested = query.get("screen") || "overview";
  const requestedProfile = initialProfiles.find((profile) => profile.id === query.get("profile")) || initialProfiles[0];
  const requestedRfq = rfqs.find((rfq) => rfq[0] === query.get("rfq")) || rfqs[0];
  const requestedQuote = quotes.find((quote) => quote[0] === query.get("quote")) || quotes.find((quote) => quote[3] === requestedRfq[0]) || quotes[0];
  const screenLabel = { overview: "Overview", rfqs: "RFQs", quotes: "Quotes", brands: "Verification", vendors: "Verification", verification: "Verification", review: "Review", "rfq-detail": "RFQ detail", "quote-detail": "Quote detail", settings: "Settings" }[requested] || "Overview";
  const [screen, setScreen] = useState(screenLabel);
  const [profiles, setProfiles] = useState(initialProfiles);
  const [selectedProfile, setSelectedProfile] = useState(requestedProfile);
  const [selectedRfq, setSelectedRfq] = useState(requestedRfq);
  const [selectedQuote, setSelectedQuote] = useState(requestedQuote);
  const [reviewBack, setReviewBack] = useState("Verification");
  const [rfqBack, setRfqBack] = useState(requested === "rfq-detail" ? "RFQs" : "Overview");
  const [collapsed, setCollapsed] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const sync = () => setCollapsed(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const slug = { Overview: "overview", RFQs: "rfqs", Quotes: "quotes", Verification: "verification", Settings: "settings" }[screen];
    if (screen === "Review" && selectedProfile) {
      window.history.replaceState(null, "", `${window.location.pathname}?screen=review&profile=${selectedProfile.id}`);
    } else if (screen === "RFQ detail" && selectedRfq) {
      window.history.replaceState(null, "", `${window.location.pathname}?screen=rfq-detail&rfq=${selectedRfq[0]}`);
    } else if (screen === "Quote detail" && selectedRfq && selectedQuote) {
      window.history.replaceState(null, "", `${window.location.pathname}?screen=quote-detail&rfq=${selectedRfq[0]}&quote=${selectedQuote[0]}`);
    } else if (slug) {
      window.history.replaceState(null, "", `${window.location.pathname}?screen=${slug}`);
    }
  }, [screen, selectedProfile, selectedRfq, selectedQuote]);

  const openReview = (profile) => {
    setSelectedProfile(profile);
    setReviewBack(screen === "Review" ? "Verification" : screen);
    setScreen("Review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const openRfq = (rfq) => {
    setSelectedRfq(rfq);
    setRfqBack(screen === "RFQ detail" ? "RFQs" : screen);
    setScreen("RFQ detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const openQuote = (quote) => {
    const matchingRfq = rfqs.find((rfq) => rfq[0] === quote[3]);
    if (matchingRfq) setSelectedRfq(matchingRfq);
    setSelectedQuote(quote);
    setScreen("Quote detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const decide = (id, status) => {
    const tone = status === "Approved" ? "success" : status === "Declined" ? "neutral" : "danger";
    setProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, status, tone } : profile));
    setSelectedProfile((current) => current?.id === id ? { ...current, status, tone } : current);
    setToast(status === "Approved" ? "Profile approved" : status === "Declined" ? "Profile declined" : "Information request sent");
    window.setTimeout(() => setToast(""), 2400);
  };
  const navigate = (label) => { setScreen(label); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const active = screen === "Review" ? reviewBack : ["RFQ detail", "Quote detail"].includes(screen) ? (rfqBack === "Overview" ? "Overview" : "RFQs") : screen;

  return (
    <div className={collapsed ? "app-shell nav-collapsed admin-app" : "app-shell admin-app"}>
      <PrototypeSideNav
        account={{ initials: "TS", name: "TSC Operations", type: "Admin workspace" }}
        active={active}
        ariaLabel="Admin workspace"
        collapsed={collapsed}
        navItems={adminNav}
        onNav={navigate}
        onProfile={() => navigate("Settings")}
        onToggle={() => setCollapsed((value) => !value)}
      />
      {!collapsed && <button className="mobile-nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setCollapsed(true)} />}
      {screen === "Overview" && <Overview profiles={profiles} onReview={openReview} onNavigate={navigate} onOpenRfq={openRfq} />}
      {["RFQs", "Quotes", "Verification"].includes(screen) && <QueuePage kind={screen} profiles={profiles} onReview={openReview} onOpenRfq={openRfq} onOpenQuote={openQuote} />}
      {screen === "Review" && <VerificationDetail profile={selectedProfile} onBack={() => navigate(reviewBack)} onDecision={decide} />}
      {screen === "RFQ detail" && <AdminRfqDetail rfq={selectedRfq} backLabel={rfqBack} onBack={() => navigate(rfqBack)} onOpenQuote={openQuote} />}
      {screen === "Quote detail" && <AdminQuoteDetail quote={selectedQuote} rfq={selectedRfq} onBack={() => navigate("RFQ detail")} />}
      {screen === "Settings" && <SettingsPage />}
      {toast && <div className="app-toast admin-toast" role="status">{toast}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
