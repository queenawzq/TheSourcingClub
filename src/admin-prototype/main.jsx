import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PrototypeSideNav, ProfileChipSection, ProfileDetailPair } from "../shared/ProfileShell.jsx";
import { useActions, useAdminMetrics, useAdminQuotes, useAdminRfqs, useAdminUsers, useVerificationQueue, useViewer } from "../lib/data/DataProvider.jsx";
import "../prototype/styles.css";
import "../factory-prototype/styles.css";
import "../shared/profile-shell.css";
import "./styles.css";

const adminNav = [
  { label: "Overview", icon: "home" },
  { label: "RFQs", icon: "rfq" },
  { label: "Quotes", icon: "projects" },
  { label: "Users", icon: "connections" },
  { label: "Verification", icon: "verification" },
  { label: "Settings", icon: "settings" }
];

export const initialProfiles = [
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
      ["Registration document", "Verified", 98, "Registration document uploaded and marked verified by a reviewer."],
      ["Website and domain", "Verified", 91, "Domain history and business contact details are consistent."],
      ["Certification evidence", "Review", 82, "GOTS certificate is valid; scope should be confirmed manually."],
      ["Production evidence", "Verified", 94, "Uploaded samples and facility video support stated capabilities."],
      ["Duplicate company signal", "Clear", 100, "No other company on the platform shares this legal name or website domain."]
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
      ["Duplicate company signal", "Clear", 100, "No other company on the platform shares this legal name or website domain."]
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
      ["Duplicate company signal", "Clear", 100, "No other company on the platform shares this legal name or website domain."]
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
      ["Duplicate company signal", "Clear", 100, "No other company on the platform shares this legal name or website domain."]
    ]
  }
];

const initialUsers = [
  { id: "user-ari", initials: "AC", name: "Ari Chen", email: "ari@maisonrue.com", type: "Brand", company: "Maison Rue", joined: "Jul 18, 2026", lastActive: "12 min ago", status: "Active" },
  { id: "user-maya", initials: "MR", name: "Maya Reynolds", email: "maya@maisonrue.com", type: "Brand", company: "Maison Rue", joined: "Jul 18, 2026", lastActive: "Yesterday", status: "Active" },
  { id: "user-sofia", initials: "SC", name: "Sofia Costa", email: "sofia@atelierminho.pt", type: "Factory", company: "Atelier Minho", joined: "Aug 2, 2026", lastActive: "34 min ago", status: "Active" },
  { id: "user-rui", initials: "RM", name: "Rui Mendes", email: "rui@atelierminho.pt", type: "Factory", company: "Atelier Minho", joined: "Aug 4, 2026", lastActive: "3 days ago", status: "Disabled" },
  { id: "user-lin", initials: "LW", name: "Lin Wei", email: "lin@pacificsourcepartners.com", type: "Trading company", company: "Pacific Source Partners", joined: "Aug 6, 2026", lastActive: "8 min ago", status: "Active" },
  { id: "user-grace", initials: "GW", name: "Grace Wong", email: "grace@pacificsourcepartners.com", type: "Trading company", company: "Pacific Source Partners", joined: "Aug 6, 2026", lastActive: "2 hours ago", status: "Active" },
  { id: "user-leo", initials: "LP", name: "Leo Park", email: "leo@seoulknitworks.kr", type: "Factory", company: "Seoul Knit Works", joined: "Aug 8, 2026", lastActive: "Yesterday", status: "Active" },
  { id: "user-tsc", initials: "TS", name: "TSC Operations", email: "operations@thesourcingclub.com", type: "Admin", company: "The Sourcing Club", joined: "Jun 3, 2026", lastActive: "Now", status: "Active", protected: true }
];

export { initialUsers };

export const rfqs = [
  ["RFQ-1048", "Organic cotton woven shirt", "Maison Rue", "Aug 12", "6 vendors", "Open", "info"],
  ["RFQ-1047", "Premium knit resort capsule", "Élan Studio", "Aug 12", "4 vendors", "Quotes received", "success"],
  ["RFQ-1046", "Washed denim overshirt", "Northline", "Aug 11", "8 vendors", "Quotes received", "success"],
  ["RFQ-1045", "Recycled nylon activewear set", "Form Athletics", "Aug 11", "3 vendors", "Needs review", "warning"],
  ["RFQ-1044", "Linen co-ord collection", "Serein", "Aug 10", "5 vendors", "Closed", "neutral"]
];

export const quotes = [
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

function MetricCard({ label, value, note, tone, href = null, linkLabel = "" }) {
  return (
    <section className={`factory-metric-card admin-metric-card ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
      {/* Live only: where to act on the figure. */}
      {href && <a className="admin-metric-link" href={href}>{linkLabel}</a>}
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
    <article className={`admin-verification-row${profile.confidence != null ? " has-confidence" : ""}`}>
      <div className="admin-entity-identity">
        <span>{profile.initials}</span>
        <div>
          <strong>{profile.name}</strong>
          <small>{profile.entityType} · {profile.location}</small>
          <small className="admin-entity-submitted">Submitted {profile.submitted}</small>
        </div>
      </div>
      {profile.confidence != null
        ? <div className="admin-row-stat"><span>{profile.confidenceLabel ?? "Confidence"}</span><strong>{profile.confidence}%</strong></div>
        : <div className="admin-row-stat"><span>Assigned</span><strong>{profile.owner || "Unassigned"}</strong></div>}
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

function RfqActivityCards({ rfqRows, quoteRows, onOpenRfq }) {
  const recentRfqs = rfqRows.slice(0, 4);
  return (
    <div className="home-rfq-list admin-rfq-card-list">
      {recentRfqs.map((rfq) => {
        const quote = quoteRows.find((item) => item[3] === rfq[0]);
        const quoteCount = quoteRows.filter((item) => item[3] === rfq[0]).length;
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

function Overview({ profiles, rfqRows, quoteRows, metrics, onReview, onNavigate, onOpenRfq }) {
  const pending = profiles.filter((profile) => !["Approved", "Declined"].includes(profile.status));
  return (
    <main className="factory-dashboard-page admin-page">
      <div className="factory-dashboard-shell admin-shell">
        <header className="factory-dashboard-header admin-header">
          <div><span className="admin-eyebrow">Operations workspace</span><h1>Admin overview</h1><p>Monitor marketplace activity and review the profiles waiting for a decision.</p></div>
          <button className="activity-icon-btn" type="button" aria-label="Open notifications"><img src="/assets/prototype-icons/notification.svg" alt="" /><b>5</b></button>
        </header>

        <div className="factory-dashboard-metrics admin-metrics">
          <MetricCard label="Profiles awaiting review" value={metrics.profilesAwaitingReview ?? pending.length} note={`${metrics.profilesSubmittedToday ?? 0} submitted today`} tone="blue" />
          <MetricCard label="RFQs submitted today" value={metrics.rfqsSubmittedToday ?? 0} note={`${rfqRows.length} in the marketplace`} tone="green" />
          <MetricCard label="Quotes submitted today" value={metrics.quotesSubmittedToday ?? 0} note={`${quoteRows.length} in the marketplace`} tone="amber" />
          {/* Live only: messages held for review. Nobody can be notified of
              them either, so this card is their only prompt. The design has
              no moderation, so the prototype's mock passes nothing and keeps
              its four cards. */}
          {metrics.messagesHeld != null && (
            <MetricCard label="Messages held for review" value={metrics.messagesHeld} note="Contact details, waiting on a decision" tone="red" href={metrics.messagesHref} linkLabel="Open messages" />
          )}
          {/* Where the design puts "low-confidence checks". There is no
              confidence score, and platform staff have no org and so cannot be
              notified of anything — a payment sits at 'sent' until a human
              opens the queue, and this count is the only prompt that exists. */}
          <MetricCard label="Payments awaiting confirmation" value={metrics.paymentsAwaitingConfirmation ?? 0} note="Nothing else will chase these" tone="red" href={metrics.paymentsHref} linkLabel="Open payments" />
        </div>

        <section className="admin-overview-grid">
          <Panel title="Verification queue" subtitle="Profiles prioritized by review state and how long each has been waiting." action="View all" onAction={() => onNavigate("Verification")}>
            {pending.map((profile) => <VerificationRow profile={profile} onReview={onReview} key={profile.id} />)}
          </Panel>
        </section>

        <Panel title="Recent RFQs and quotes" subtitle="Review each request together with its latest vendor response." action="View all RFQs" onAction={() => onNavigate("RFQs")}>
          <RfqActivityCards rfqRows={rfqRows} quoteRows={quoteRows} onOpenRfq={onOpenRfq} />
        </Panel>
      </div>
    </main>
  );
}

function QueuePage({ kind, profiles, rfqRows, quoteRows, onReview, onOpenRfq, onOpenQuote }) {
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
  const rfqTabCounts = Object.fromEntries(rfqTabs.map((tab) => [tab, rfqRows.filter((rfq) => matchesRfqTab(rfq, tab)).length]));
  const filteredRfqs = rfqRows.filter((rfq) => matchesRfqTab(rfq, rfqTab) && (!normalizedSearch || rfq.slice(0, 3).join(" ").toLowerCase().includes(normalizedSearch)));
  const matchesQuoteTab = (quote, tab) => tab === "All"
    || quote[6] === tab
    || (tab === "Needs attention" && ["Needs clarification", "Revision requested"].includes(quote[6]))
    || (tab === "Closed" && quote[6] === "Declined");
  const quoteTabCounts = Object.fromEntries(quoteTabs.map((tab) => [tab, quoteRows.filter((quote) => matchesQuoteTab(quote, tab)).length]));
  const filteredQuotes = quoteRows.filter((quote) => matchesQuoteTab(quote, quoteTab) && (!normalizedSearch || quote.slice(0, 4).join(" ").toLowerCase().includes(normalizedSearch)));
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
    Verification: ["Verification queue", "Prioritize profile decisions using the evidence each company has actually submitted."]
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

/**
 * How much of the evidence we asked for has arrived.
 *
 * Named for what it measures. It was drawn as "overall confidence", which
 * reads as a judgement about whether the company is real — and a reviewer who
 * believes a registry was checked approves things they should not. Nothing
 * here contacts a registry, a sanctions list or a certifier, and nothing reads
 * a file's contents, so a forged document that is present scores the same as a
 * genuine one. It is a triage number, never a verdict.
 */
function ConfidenceCard({ score }) {
  const tone = score >= 90 ? "success" : score >= 80 ? "warning" : "danger";
  return (
    <section className="factory-profile-card admin-confidence-card">
      <div><span>Evidence completeness</span><strong>{score}%</strong><StatusPill tone={tone}>{score >= 90 ? "Evidence complete" : score >= 80 ? "Minor gaps" : "Evidence missing"}</StatusPill></div>
      <div className="admin-confidence-scale"><span style={{ width: `${score}%` }} /></div>
      <p>The share of the checks below that pass: what this company submitted, and whether it is internally consistent. Nothing is checked against a company registry, sanctions list or certification body, so this is not a verification and it cannot tell you a document is genuine. The decision is yours.</p>
    </section>
  );
}

/** Column name → the words the onboarding form used. */
const SUBMISSION_LABELS = {
  legal_name: "Registered name", website_url: "Website", location: "Location",
  hq_location: "Headquarters", country_code: "Country", nearest_port: "Nearest port",
  founded_year: "Year founded", employee_count: "Team size", intro: "About",
  moq: "Minimum order quantity", typical_lead_days: "Bulk lead time (days)",
  sample_lead_days: "Sample lead time (days)", equipment_notes: "Key machines or equipment",
  vendor_kind: "Company type", business_email: "Business email",
  brand_category: "Brand category", annual_revenue_band: "Annual revenue",
  pieces_per_year_band: "Pieces per year", order_size_band: "Order size per style",
  collections_per_year: "Collections per year", reorder_cadence: "Reorder cadence",
  sourcing_stage: "Sourcing stage", languages_supported: "Languages supported",
  typical_order_value_band: "Typical order value",
  partner_factory_count: "Active partner factories",
  supported_incoterms: "Supported Incoterms", typical_payment_terms: "Typical payment terms",
  registration_date: "Registration date", registered_capital: "Registered capital",
};

/**
 * Bookkeeping, not answers. Shown elsewhere on the screen or meaningless to a
 * reviewer, so they are kept out of the submitted-fields grid.
 */
const SUBMISSION_SKIP = new Set([
  "org_id", "created_at", "updated_at", "verification_status",
  "published_at", "onboarding_completed_at",
]);

/** A column nobody has labelled still has to appear. */
const humanise = (key) => SUBMISSION_LABELS[key]
  ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const showValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

const centsRange = (profile) => {
  const min = profile.target_price_min_cents;
  const max = profile.target_price_max_cents;
  if (min == null && max == null) return null;
  const money = (c) => `$${(c / 100).toFixed(2)}`;
  if (min != null && max != null) return `${money(min)} – ${money(max)}`;
  return money(min ?? max);
};

/**
 * Everything the company submitted.
 *
 * It renders whatever the backend returns rather than a hand-picked list of
 * fields. The previous version picked six, looked up eight keys that were
 * never among them — year founded, team size, MOQ, lead time, business type,
 * target FOB, annual volume — and drew an em dash for every one, beside four
 * literals ("10–14 days", "7,200 units", "$15,000–$40,000", "North America")
 * that were markup rather than data. A reviewer reading that modal was
 * reading a fabricated capacity figure and a row of dashes where the answers
 * should have been.
 *
 * Unknown columns are shown with a humanised name, so a field added to
 * onboarding appears here without anyone remembering to come back.
 */
function FullSubmissionModal({ profile, submission, documents, onDocumentUrl, onClose }) {
  const files = documents ?? [];
  const data = submission ?? {};
  const submitted = data.profile ?? {};
  const selections = data.selections ?? {};
  const capacity = data.capacity ?? null;
  const certifications = data.certifications ?? [];
  const references = data.references ?? [];
  const members = data.members ?? [];
  const invitations = data.invitations ?? [];
  const terms = data.terms ?? null;

  const priceRange = centsRange(submitted);
  const fields = Object.entries(submitted)
    .filter(([key]) => !SUBMISSION_SKIP.has(key) && !key.startsWith("target_price_"))
    .map(([key, value]) => [humanise(key), showValue(value)])
    .filter(([, value]) => value !== null);
  if (priceRange) fields.push(["Target price range", priceRange]);

  const fileGroups = [
    ["Business registration", files.filter((f) => f.kind === "business_registration")],
    ["Certificates", files.filter((f) => f.kind === "certificate")],
    ["Logo", files.filter((f) => f.kind === "logo")],
    ["Product and production images", files.filter((f) => ["product_image", "brand_direction"].includes(f.kind))],
    ["Factory walkthrough", files.filter((f) => f.kind === "walkthrough")],
  ].filter(([, group]) => group.length);

  return (
    <div className="approve-fund-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="approve-fund-modal admin-review-modal admin-full-submission-modal" role="dialog" aria-modal="true" aria-labelledby="full-submission-title">
        <button className="settings-drawer-close" type="button" aria-label="Close" onClick={onClose}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
        <header><div><span>Submitted profile</span><h2 id="full-submission-title">Full onboarding submission</h2></div></header>
        <div className="admin-submission-sections">

          <section className="admin-submission-section">
            <h3>Account</h3>
            <div className="admin-submission-grid">
              <ProfileDetailPair label="Account name" value={profile.name} />
              <ProfileDetailPair label="Company type" value={profile.entityType} />
              {members.map((member) => (
                <ProfileDetailPair
                  key={member.email}
                  label={member.role === "owner" ? "Owner" : "Member"}
                  value={[member.name, member.email].filter(Boolean).join(" · ")}
                />
              ))}
              {invitations.map((invite) => (
                <ProfileDetailPair key={invite.email} label="Invited" value={`${invite.email} · ${invite.status}`} />
              ))}
            </div>
          </section>

          {fields.length ? (
            <section className="admin-submission-section">
              <h3>Submitted details</h3>
              <div className="admin-submission-grid">
                {fields.map(([label, value]) => <ProfileDetailPair label={label} value={value} key={label} />)}
              </div>
            </section>
          ) : null}

          {Object.keys(selections).length ? (
            <section className="admin-submission-section">
              <h3>Selections</h3>
              {/* Grouped by the question that was asked. One undifferentiated
                  chip row cannot tell a certification they hold from a product
                  category they make. */}
              {Object.entries(selections).map(([kind, labels]) => (
                <ProfileChipSection key={kind} label={kind} items={labels} />
              ))}
            </section>
          ) : null}

          {capacity && (capacity.monthlyUnits != null || capacity.lineHours != null) ? (
            <section className="admin-submission-section">
              <h3>Declared capacity</h3>
              <div className="admin-submission-grid">
                <ProfileDetailPair label="Reference category" value={capacity.category ?? "Not given"} />
                <ProfileDetailPair label="Answered in" value={capacity.inputMode === "hours" ? "Line hours" : "Units"} />
                {capacity.lineHours != null && <ProfileDetailPair label="Line hours per month" value={String(capacity.lineHours)} />}
                {capacity.monthlyUnits != null && <ProfileDetailPair label="Units per month" value={String(capacity.monthlyUnits)} />}
              </div>
            </section>
          ) : null}

          {certifications.length ? (
            <section className="admin-submission-section">
              <h3>Certifications claimed</h3>
              <div className="admin-submission-grid">
                {certifications.map((cert) => (
                  <ProfileDetailPair
                    key={cert.label}
                    label={cert.label}
                    value={[cert.status, cert.documentId ? "document attached" : "no document",
                            cert.expiresAt ? `expires ${cert.expiresAt}` : null].filter(Boolean).join(" · ")}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {references.length ? (
            <section className="admin-submission-section">
              <h3>Client references</h3>
              <div className="admin-submission-grid">
                {references.map((reference) => (
                  <ProfileDetailPair
                    key={reference.id ?? reference.title}
                    label={reference.title}
                    value={[reference.counterparty, reference.period, reference.outcome].filter(Boolean).join(" · ") || "No detail given"}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="admin-submission-section">
            <h3>Uploaded files</h3>
            {fileGroups.length
              ? fileGroups.map(([label, group]) => (
                  <div className="admin-submission-files" key={label}>
                    <span>{label}</span>
                    {group.map((file) => <DocumentRow key={file.id ?? file.file_name} document={file} onDocumentUrl={onDocumentUrl} />)}
                  </div>
                ))
              : <p className="admin-submission-empty">Nothing uploaded</p>}
          </section>

          <section className="admin-submission-section">
            <h3>Declaration</h3>
            <div className="admin-submission-grid">
              {terms
                ? <>
                    <ProfileDetailPair label="Signed" value={terms.signature} />
                    <ProfileDetailPair label="Terms version" value={terms.version} />
                    <ProfileDetailPair label="Accepted" value={terms.acceptedAt ? String(terms.acceptedAt).slice(0, 10) : "—"} />
                  </>
                : <ProfileDetailPair label="Signed" value="No terms acceptance on file" />}
            </div>
          </section>

        </div>
      </section>
    </div>
  );
}

/**
 * Which uploaded files stand behind a given check.
 *
 * Keyed on the check's label because that is what the check carries. A check
 * with no file behind it — a domain comparison, a duplicate scan — returns
 * nothing, and the viewer says so rather than drawing something.
 */
const CHECK_DOCUMENT_KINDS = {
  "Business registration": ["business_registration"],
  "Certification evidence": ["certificate"],
  "Production evidence": ["walkthrough", "product_image"],
  "Brand evidence": ["brand_direction", "product_image", "logo"],
};

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Opens a submitted file.
 *
 * The link is minted when it is asked for, not when the list renders: a
 * private file's signed URL lives five minutes, so one handed out at render
 * time is usually dead by the time anyone clicks it.
 */
function DocumentLink({ document, onDocumentUrl, children }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);

  if (!onDocumentUrl) return <span className="admin-document-static">{children}</span>;

  return (
    <button
      type="button"
      className="admin-document-open"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setFailed(null);
        try {
          const url = await onDocumentUrl(document);
          window.open(url, "_blank", "noopener,noreferrer");
        } catch (error) {
          setFailed(error.message || "That file could not be opened");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Opening…" : failed ?? children}
    </button>
  );
}

function DocumentRow({ document, onDocumentUrl }) {
  const meta = [document.mime_type, formatBytes(document.size_bytes)].filter(Boolean).join(" · ");
  return (
    <div className="admin-evidence-file-row">
      <img src="/assets/prototype-icons/rfq.svg" alt="" />
      <div>
        <strong>{document.file_name}</strong>
        <span>{meta || document.kind}</span>
      </div>
      <DocumentLink document={document} onDocumentUrl={onDocumentUrl}>Open</DocumentLink>
    </div>
  );
}

function EvidencePreview({ document, onDocumentUrl }) {
  const [preview, setPreview] = useState({ url: null, error: null });

  useEffect(() => {
    if (!document || !onDocumentUrl) return undefined;
    let cancelled = false;
    setPreview({ url: null, error: null });
    onDocumentUrl(document).then(
      (url) => { if (!cancelled) setPreview({ url, error: null }); },
      (error) => { if (!cancelled) setPreview({ url: null, error: error.message || "The file could not be loaded." }); },
    );
    return () => { cancelled = true; };
  }, [document, onDocumentUrl]);

  const type = document?.mime_type?.toLowerCase() ?? "";
  const isPdf = type === "application/pdf" || /\.pdf$/i.test(document?.file_name ?? "");
  const isImage = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"].includes(type);

  return (
    <div className="admin-document-viewer" aria-label={document ? `${document.file_name} preview` : "No document"}>
      <div className="admin-document-toolbar">
        <span>{document ? document.file_name : "No document"}</span>
        {preview.url && <a className="admin-document-open" href={preview.url} target="_blank" rel="noopener noreferrer">Open in a new tab</a>}
      </div>
      {preview.url && isPdf ? (
        <iframe className="admin-document-preview" src={preview.url} title={`${document.file_name} preview`} />
      ) : preview.url && isImage ? (
        <div className="admin-document-image-wrap"><img src={preview.url} alt={document.file_name} /></div>
      ) : (
        <div className="admin-document-preview-message" role="status">
          {!document ? "No file was submitted for this check."
            : preview.error ? preview.error
            : !onDocumentUrl ? "Preview is unavailable in the sample workspace."
            : !preview.url ? "Loading file preview…"
            : "This file type cannot be previewed here. Open it in a new tab to view it."}
        </div>
      )}
    </div>
  );
}

/**
 * One check, and the file it rests on.
 *
 * This used to draw a GOTS certificate for Atelier Minho — certificate number,
 * issuer, validity dates and all — for whichever company was on screen. Under
 * mock data that was set dressing; wired to the marketplace it put an invented
 * document in front of a reviewer deciding whether a real company may trade,
 * which is the same failure as an invented score and a worse one, because it
 * looks like evidence. The viewer now embeds the actual upload or says plainly
 * that there is not one.
 */
function EvidenceDetailModal({ profile, check, documents, onDocumentUrl, onClose }) {
  if (!check) return null;
  const [label, result, confidence, detail] = check;
  const tone = result === "Verified" || result === "Clear" ? "success" : result === "Missing" || result === "Rejected" ? "danger" : "warning";
  const kinds = CHECK_DOCUMENT_KINDS[label] ?? [];
  const files = (documents ?? []).filter((item) => kinds.includes(item.kind));
  const primary = files[0] ?? null;

  return (
    <div className="approve-fund-modal-layer admin-evidence-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="approve-fund-modal admin-review-modal admin-evidence-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-detail-title">
        <button className="settings-drawer-close" type="button" aria-label="Close" onClick={onClose}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
        <header><div><span>Submitted evidence</span><h2 id="evidence-detail-title">{label}</h2></div></header>
        <div className="admin-evidence-layout">
          <aside className="admin-evidence-summary">
            {files.length
              ? files.map((file) => <DocumentRow key={file.id ?? file.file_name} document={file} onDocumentUrl={onDocumentUrl} />)
              : <div className="admin-evidence-file-row"><div><strong>No file</strong><span>This check does not rest on an upload</span></div></div>}
            <div className="admin-evidence-meta-grid">
              <ProfileDetailPair label="Company" value={profile.name} />
              <ProfileDetailPair label="Received" value={profile.submitted} />
              <ProfileDetailPair label="Evidence" value={`${confidence}% complete`} />
              <ProfileDetailPair label="Review status" value={result} />
            </div>
            <div className="admin-evidence-note"><span>Check summary</span><p>{detail}</p><StatusPill tone={tone}>{result}</StatusPill></div>
          </aside>

          <EvidencePreview document={primary} onDocumentUrl={onDocumentUrl} />
        </div>
      </section>
    </div>
  );
}

/**
 * What an AI model suggests a reviewer look at. Live only: the prototype's
 * adapter has no `reviewAssist`, so nothing here is drawn there. Not in the
 * design; built from the design's panel and check rows.
 *
 * Text, never a score (CLAUDE.md, Admin operations). Each suggestion shows
 * the evidence it rests on, quoted from the submission, and the server drops
 * any whose evidence is not there. It runs when staff ask, never by itself,
 * and the caption says what the model did and did not read.
 */
function AiSuggestionsPanel({ orgId }) {
  const actions = useActions();
  const [state, setState] = useState({ status: "idle", result: null, message: "" });
  const [input, setInput] = useState(null);
  const [inputOpen, setInputOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setState({ status: "idle", result: null, message: "" });
    setInput(null);
    setInputOpen(false);
    actions.latestReviewAssists?.(orgId)
      .then((saved) => {
        if (live && saved?.check) {
          setState({ status: "done", result: { ...saved.check.output, model: saved.check.model, createdAt: saved.check.createdAt }, message: "" });
        }
      })
      .catch(() => {});
    return () => { live = false; };
  }, [orgId]);

  const ask = async () => {
    setState((current) => ({ ...current, status: "asking", message: "" }));
    try {
      const result = await actions.reviewAssist("check", orgId);
      if (!result.available) {
        setState((current) => ({ ...current, status: current.result ? "done" : "idle", message: result.reason }));
        return;
      }
      if (result.input) setInput(result.input);
      setState({ status: "done", result, message: "" });
    } catch (error) {
      setState((current) => ({ ...current, status: current.result ? "done" : "idle", message: error.message }));
    }
  };

  const toggleInput = async () => {
    if (!inputOpen && !input) {
      try { setInput(await actions.reviewAssistInput(orgId)); } catch (error) { setState((current) => ({ ...current, message: error.message })); return; }
    }
    setInputOpen(!inputOpen);
  };

  const { result } = state;
  const asked = result?.createdAt ? new Date(result.createdAt).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <Panel
      title="AI suggestions"
      subtitle="Suggestions from an AI model. It read the profile text, the certificate records and the list of files; it did not open the files or contact any registry. No score and no decision: the decision is yours."
      className="admin-assist-panel"
    >
      {state.message && <p className="admin-error" role="alert">{state.message}</p>}
      {result && (
        <>
          <p className="admin-assist-meta">Asked {asked}{result.model ? ` · ${result.model}` : ""}{result.dropped ? ` · ${result.dropped} suggestion${result.dropped === 1 ? "" : "s"} left out: their evidence was not in the submission` : ""}</p>
          {result.findings?.length ? (
            <div className="admin-check-list">
              {result.findings.map((finding, index) => (
                <article className="admin-check-row admin-assist-row" key={`${finding.topic}-${index}`}>
                  <div className="admin-check-copy">
                    <strong>{finding.topic}</strong>
                    <p>{finding.observation}</p>
                    <span>Seen: “{finding.evidence}”</span>
                    {finding.ask && <p className="admin-assist-ask">Could ask: {finding.ask}</p>}
                  </div>
                  <StatusPill tone="info">Suggestion</StatusPill>
                </article>
              ))}
            </div>
          ) : <p className="admin-assist-meta">Nothing stood out to the AI. That is not a check passed: review the evidence as usual.</p>}
          {result.checked?.length ? <p className="admin-assist-meta">Looked at: {result.checked.join(", ")}</p> : null}
        </>
      )}
      <div className="admin-assist-actions">
        <button className="secondary-btn" type="button" onClick={ask} disabled={state.status === "asking"}>
          {state.status === "asking" ? "Asking…" : result ? "Ask again" : "Ask AI for suggestions"}
        </button>
        <button className="admin-assist-link" type="button" onClick={toggleInput} aria-expanded={inputOpen}>{inputOpen ? "Hide what the AI reads" : "What the AI reads"}</button>
      </div>
      {inputOpen && input && <pre className="admin-assist-input">{JSON.stringify(input, null, 2)}</pre>}
    </Panel>
  );
}

function VerificationDetail({ profile, submission, documents, onDocumentUrl, onBack, onDecision, onSuggestRequest }) {
  const [requestOpen, setRequestOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  // Both modals had a textarea whose value was dropped on the floor: the
  // decision fired with the status alone. Live, that is not cosmetic — the
  // database refuses "Needs information" with no note, because a factory told
  // only "Needs information" has nothing to act on.
  const [requestNote, setRequestNote] = useState("");
  const [requestSuggestionLoading, setRequestSuggestionLoading] = useState(false);
  const [requestSuggestionError, setRequestSuggestionError] = useState("");
  // Live only: why the note came from the checks rather than the model.
  const [requestSuggestionNotice, setRequestSuggestionNotice] = useState("");
  const [declineNote, setDeclineNote] = useState("");
  const [fullProfileOpen, setFullProfileOpen] = useState(false);
  const [selectedCheck, setSelectedCheck] = useState(null);
  // Live only: reviewAssist draws the AI suggestions panel below.
  const actions = useActions();
  const eligibility = submission?.trustEligibility ?? null;
  const isVendor = profile?.entityType === "Factory" || profile?.entityType === "Trading company";
  const hasWalkthrough = eligibility?.hasWalkthrough ?? (documents ?? []).some(
    (document) => document.kind === "walkthrough" && document.status !== "rejected" && Number(document.size_bytes) > 0,
  );
  const eligibleTrusted = Boolean(eligibility?.eligibleTrusted);
  const suggestedTier = eligibleTrusted ? "trusted" : hasWalkthrough ? "verified" : "basic";
  const [approvalTier, setApprovalTier] = useState("basic");
  useEffect(() => {
    setApprovalTier(suggestedTier);
  }, [profile?.id, suggestedTier]);
  if (!profile) return null;
  const requestGaps = (profile.checks ?? [])
    .filter(([, result]) => !["Verified", "Clear"].includes(result))
    .map(([label, result, , detail]) => ({ label, result, detail }));
  const suggestRequest = async () => {
    setRequestSuggestionLoading(true);
    setRequestSuggestionError("");
    setRequestSuggestionNotice("");
    try {
      const result = await onSuggestRequest?.({
        companyName: profile.name,
        entityType: profile.entityType,
        gaps: requestGaps,
      });
      if (result?.message) {
        setRequestNote(result.message);
        setRequestSuggestionNotice(result.notice || "");
      } else setRequestSuggestionError(result?.error || "The suggestion could not be generated. You can still write the message manually.");
    } catch (error) {
      setRequestSuggestionError(error.message || "The suggestion could not be generated. You can still write the message manually.");
    } finally {
      setRequestSuggestionLoading(false);
    }
  };
  const members = submission?.members ?? [];
  const submitter = members.find((member) => member.role === "owner") ?? members[0] ?? null;
  const submitterName = submitter?.name || "Not provided";
  const submitterEmail = submitter?.email || "Not provided";
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
            {profile.checks?.length ? (
            <Panel title="Verification checks" subtitle="Each check reads what this company submitted and what TSC already holds. None of them contacts an outside registry or certifier.">
              <div className="admin-check-list">
                {profile.checks.map(([label, result, confidence, detail]) => {
                  const tone = result === "Verified" || result === "Clear" ? "success" : result === "Missing" || result === "Rejected" ? "danger" : "warning";
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
                      <div className="admin-check-copy"><strong>{label}</strong><p>{detail}</p><span>Source: submitted evidence</span></div>
                      <div className="admin-check-result">
                        <div className="admin-check-confidence"><strong>{confidence}%</strong><span>complete</span></div>
                        <StatusPill tone={tone}>{result}</StatusPill>
                      </div>
                    </article>
                  );
                })}
              </div>
            </Panel>
            ) : null}
            {actions.reviewAssist && <AiSuggestionsPanel orgId={profile.id} />}
          </div>
          <aside className="admin-review-side">
            {profile.confidence != null && <ConfidenceCard score={profile.confidence} />}
            <section className="factory-profile-card admin-review-meta">
              <h2>Review details</h2>
              {submission && <ProfileDetailPair label="Submitted by" value={submitterName} />}
              {submission && <ProfileDetailPair label="Account email" value={submitterEmail} />}
              {profile.completion != null && <ProfileDetailPair label="Profile completeness" value={`${profile.completion}%`} />}
              <ProfileDetailPair label="Evidence received" value={profile.evidence} />
              <ProfileDetailPair label="Risk level" value={profile.risk || "Not set"} />
            </section>
            <section className="factory-profile-card admin-decision-card">
              <span>Final decision</span>
              <h2>Complete this review</h2>
              <p>Review the evidence and confidence signals before making a marketplace decision.</p>
              {isVendor && (
                <fieldset className="admin-tier-picker">
                  <legend>Assign marketplace badge</legend>
                  {[
                    {
                      key: "basic",
                      label: "Basic",
                      enabled: true,
                      detail: "Approved profile. No walkthrough required.",
                    },
                    {
                      key: "verified",
                      label: "Verified",
                      enabled: hasWalkthrough,
                      detail: hasWalkthrough
                        ? "Production walkthrough received."
                        : "Requires a production walkthrough.",
                    },
                    {
                      key: "trusted",
                      label: "Trusted",
                      enabled: eligibleTrusted,
                      detail: eligibility
                        ? `${eligibility.completedOrders} completed · ${eligibility.onTimeOrders} on time · ${eligibility.qualityHistoryOrders} with visible quality history`
                        : "Requires completed on-time Club orders and visible quality history.",
                    },
                  ].map((tier) => (
                    <label className={`admin-tier-option${approvalTier === tier.key ? " selected" : ""}${tier.enabled ? "" : " disabled"}`} key={tier.key}>
                      <input
                        type="radio"
                        name="approval-tier"
                        value={tier.key}
                        checked={approvalTier === tier.key}
                        disabled={!tier.enabled}
                        onChange={() => setApprovalTier(tier.key)}
                      />
                      <img src={`/assets/prototype-icons/${tier.key}.svg`} alt="" />
                      <span><strong>{tier.label}</strong><small>{tier.detail}</small></span>
                    </label>
                  ))}
                </fieldset>
              )}
              <button className="primary-btn" type="button" onClick={() => onDecision(profile.id, "Approved", null, isVendor ? approvalTier : null)}>
                {isVendor ? `Approve as ${approvalTier[0].toUpperCase()}${approvalTier.slice(1)}` : "Approve profile"}
              </button>
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
            <header><div><span>Profile review</span><h2 id="request-info-title">Request more information</h2></div></header>
            <div className="admin-request-message-heading">
              <div><strong>Message to applicant</strong><span>This exact message will be included in the email and in-app notification.</span></div>
              <button className="secondary-btn admin-ai-suggest-button" type="button" disabled={requestSuggestionLoading || !onSuggestRequest} onClick={suggestRequest}>
                {requestSuggestionLoading ? "Drafting…" : "Suggest with AI"}
              </button>
            </div>
            <label className="factory-onboarding-field admin-request-message"><span className="sr-only">Message to applicant</span><textarea value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Explain which document or information is missing and what the applicant should upload..." /></label>
            {requestSuggestionError && <p className="admin-request-ai-error" role="alert">{requestSuggestionError}</p>}
            {requestSuggestionNotice && <p className="admin-assist-meta" role="status">{requestSuggestionNotice}</p>}
            <footer><button className="secondary-btn" type="button" onClick={() => setRequestOpen(false)}>Cancel</button><button className="primary-btn" type="button" disabled={!requestNote.trim()} onClick={() => { setRequestOpen(false); onDecision(profile.id, "Needs information", requestNote.trim()); setRequestNote(""); }}>Send request</button></footer>
          </section>
        </div>
      )}
      {fullProfileOpen && <FullSubmissionModal profile={profile} submission={submission} documents={documents} onDocumentUrl={onDocumentUrl} onClose={() => setFullProfileOpen(false)} />}
      {selectedCheck && <EvidenceDetailModal profile={profile} check={selectedCheck} documents={documents} onDocumentUrl={onDocumentUrl} onClose={() => setSelectedCheck(null)} />}
      {declineOpen && (
        <div className="approve-fund-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDeclineOpen(false)}>
          <section className="approve-fund-modal admin-review-modal small" role="dialog" aria-modal="true" aria-labelledby="decline-title">
            <button className="settings-drawer-close" type="button" aria-label="Close" onClick={() => setDeclineOpen(false)}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
            <header><div><span>Final decision</span><h2 id="decline-title">Decline this profile?</h2><p>The applicant will be notified and can contact support if they believe this is an error.</p></div></header>
            <label className="factory-onboarding-field"><span>Reason</span><textarea value={declineNote} onChange={(event) => setDeclineNote(event.target.value)} placeholder="Explain why this profile cannot be approved..." /></label>
            <footer><button className="secondary-btn" type="button" onClick={() => setDeclineOpen(false)}>Cancel</button><button className="primary-btn danger-action" type="button" onClick={() => { setDeclineOpen(false); onDecision(profile.id, "Declined", declineNote.trim() || null); setDeclineNote(""); }}>Decline profile</button></footer>
          </section>
        </div>
      )}
    </main>
  );
}

// Live mounts pass `quoteRows` (the workspace's own quote list) and `detail`
// ({ brief, quotes: { [quoteRef]: {...} } }, read from the records). The
// prototype passes neither and keeps its constants.
function AdminRfqDetail({ rfq, onBack, backLabel, onOpenQuote, quoteRows = quotes, detail = null }) {
  if (!rfq) return null;
  const rfqQuotes = quoteRows.filter((item) => item[3] === rfq[0]);
  const details = detail ? detail.brief : rfqDetails[rfq[0]] || {};
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
                      <ProfileDetailPair label="Bulk lead" value={detail ? detail.quotes[quote[0]]?.lead : `${[28, 31, 26][index % 3]} days`} />
                      <ProfileDetailPair label="Sample cost" value={detail ? detail.quotes[quote[0]]?.sampleCost : ["$260", "$310", "$240"][index % 3]} />
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

// Live mounts pass `detail` (as AdminRfqDetail) and `backLabel` ("Quotes"
// when it was opened from the quote list). The prototype passes neither.
function AdminQuoteDetail({ quote, rfq, onBack, detail = null, backLabel = null }) {
  if (!quote || !rfq) return null;
  const details = detail ? detail.brief : rfqDetails[rfq[0]] || {};
  const siblingQuotes = quotes.filter((item) => item[3] === rfq[0]);
  const quoteIndex = Math.max(0, siblingQuotes.findIndex((item) => item[0] === quote[0]));
  const quantity = Number.parseInt(details.quantity, 10) || 300;
  const total = Number.parseFloat(quote[4].replace(/[$,]/g, "")) || 0;
  const live = detail ? detail.quotes[quote[0]] ?? {} : null;
  const unitPrice = live ? live.unitPrice : `$${(total / quantity).toFixed(2)}`;
  const lead = live ? live.lead : `${[28, 31, 26][quoteIndex % 3]} days`;
  const sampleCost = live ? live.sampleCost : ["$260", "$310", "$240"][quoteIndex % 3];
  const paymentTerms = live ? live.paymentTerms : ["30% deposit · 70% before shipment", "40% deposit · 60% before shipment", "30% deposit · 70% net 7"][quoteIndex % 3];
  const shipping = live ? live.shipping : ["EXW · freight not included", "FOB · export handling included", "FOB · freight quoted separately"][quoteIndex % 3];
  return (
    <main className="factory-profile-page brand-profile-page admin-page admin-review-page admin-quote-detail-page">
      <div className="admin-review-shell">
        <button className="admin-back-link" type="button" onClick={onBack}>‹ Back to {backLabel === "Quotes" ? "quotes" : `${rfq[0]} quotes`}</button>
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
                <ProfileDetailPair label="Quantity" value={live ? live.quantity : details.quantity} />
                <ProfileDetailPair label="Bulk lead time" value={lead} />
                <ProfileDetailPair label="Sample plan" value={live ? live.samples : details.samples} />
                <ProfileDetailPair label="Sample cost" value={sampleCost} />
              </div>
            </Panel>
            <Panel title="Commercial terms" subtitle="Terms included in this vendor submission.">
              <div className="admin-rfq-requirement-list">
                <ProfileDetailPair label="Payment terms" value={paymentTerms} />
                <ProfileDetailPair label="Shipping / incoterms" value={shipping} />
                <ProfileDetailPair label="Materials included" value={live ? live.materials : details.materials} />
                <ProfileDetailPair label="Vendor note" value={live ? live.note : `Capacity is reserved for the requested delivery window. Final pricing is subject to approved samples, confirmed specifications, and color standards.`} />
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

function UsersPage({ users, onToggleStatus }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [userType, setUserType] = useState("All user types");
  const [status, setStatus] = useState("All statuses");
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredUsers = users.filter((user) => {
    const matchesSearch = !normalizedSearch || `${user.name} ${user.email} ${user.company}`.toLowerCase().includes(normalizedSearch);
    const matchesType = userType === "All user types" || user.type === userType;
    const matchesStatus = status === "All statuses" || user.status === status;
    return matchesSearch && matchesType && matchesStatus;
  });
  const activeCount = users.filter((user) => user.status === "Active").length;

  return (
    <main className="rfqs-page admin-page admin-queue-page admin-users-page">
      <header className="rfqs-header admin-list-header">
        <div><p className="admin-eyebrow">Admin</p><h1>User management</h1><p>Find marketplace users, review their account type, and control access.</p></div>
      </header>

      <div className="admin-user-metrics" aria-label="User account summary">
        <div><span>Total users</span><strong>{users.length}</strong></div>
        <div><span>Active</span><strong>{activeCount}</strong></div>
        <div><span>Disabled</span><strong>{users.length - activeCount}</strong></div>
      </div>

      <div className="admin-filter-bar admin-users-filter-bar">
        <label className="admin-search">
          <SearchIcon />
          <span className="admin-visually-hidden">Search users</span>
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search name, email, or company" />
        </label>
        <label className="rfqs-sort admin-profile-type-filter">
          <span>User type</span>
          <select value={userType} onChange={(event) => setUserType(event.target.value)}>
            <option>All user types</option><option>Brand</option><option>Factory</option><option>Trading company</option><option>Admin</option>
          </select>
        </label>
        <label className="rfqs-sort admin-profile-type-filter admin-user-status-filter">
          <span>Account status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option>All statuses</option><option>Active</option><option>Disabled</option>
          </select>
        </label>
      </div>

      <section className="factory-dashboard-panel admin-panel admin-users-panel">
        <header><div><h2>{filteredUsers.length} user{filteredUsers.length === 1 ? "" : "s"}</h2><p>Access changes take effect immediately and can be reversed at any time.</p></div></header>
        {filteredUsers.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table admin-users-table">
              <thead><tr><th>User</th><th>User type</th><th>Company</th><th>Last active</th><th>Status</th><th>Access</th></tr></thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr className={user.status === "Disabled" ? "is-disabled" : ""} key={user.id}>
                    <td><div className="admin-user-identity"><span>{user.initials}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></div></td>
                    <td><StatusPill tone={user.type === "Admin" ? "violet" : "info"}>{user.type}</StatusPill></td>
                    <td>{user.company}</td><td>{user.lastActive}</td>
                    <td><StatusPill tone={user.status === "Active" ? "success" : "neutral"}>{user.status}</StatusPill></td>
                    <td>
                      {user.protected ? <span className="admin-current-account">Current account</span> : (
                        <button className={`secondary-btn admin-user-access-button ${user.status === "Active" ? "disable" : "enable"}`} type="button" aria-label={`${user.status === "Active" ? "Disable" : "Enable"} ${user.name}`} onClick={() => onToggleStatus(user.id)}>
                          {user.status === "Active" ? "Disable" : "Enable"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="admin-empty-state"><strong>No users found</strong><p>Try a different search term or filter.</p></div>}
      </section>
    </main>
  );
}

// The emails staff can send themselves from Settings. Keys match
// api/send-test-email.js; `localized` ones have a Chinese version.
const TEST_EMAILS = [
  { key: "onboarding-brand", label: "Onboarding received · Brand" },
  { key: "onboarding-factory", label: "Onboarding received · Factory" },
  { key: "onboarding-trading-company", label: "Onboarding received · Trading company" },
  { key: "review-approved", label: "Review decision · Approved", localized: true },
  { key: "review-needs-information", label: "Review decision · Needs information", localized: true },
  { key: "review-declined", label: "Review decision · Declined", localized: true },
  { key: "notification", label: "Notification · New quote", localized: true },
];

function TestEmailPanel({ email, intro }) {
  const actions = useActions();
  const [template, setTemplate] = useState(TEST_EMAILS[0].key);
  const [locale, setLocale] = useState("en");
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const localized = TEST_EMAILS.find((option) => option.key === template)?.localized;

  const send = async (event) => {
    event.preventDefault();
    setStatus({ state: "sending", message: "" });
    try {
      const result = await actions.sendTestEmail(template, localized ? locale : "en");
      setStatus({ state: "sent", message: `Sent to ${result?.to ?? email}.` });
    } catch (error) {
      setStatus({ state: "error", message: error.message });
    }
  };

  return (
    <Panel
      title="Test emails"
      subtitle={`${intro ?? "Send yourself any email the marketplace sends, filled with sample data."} It goes only to ${email}.`}
      className="admin-settings-card"
    >
      <form className="admin-threshold-form" onSubmit={send}>
        <label className="admin-threshold-field">
          <span>Email</span>
          <select value={template} onChange={(event) => { setTemplate(event.target.value); setStatus({ state: "idle", message: "" }); }}>
            {TEST_EMAILS.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}
          </select>
        </label>
        {localized && (
          <label className="admin-threshold-field">
            <span>Language</span>
            <select value={locale} onChange={(event) => setLocale(event.target.value)}>
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          </label>
        )}
        {status.message && <p className={status.state === "error" ? "admin-error" : "admin-test-email-status"} role={status.state === "error" ? "alert" : "status"}>{status.message}</p>}
        <div className="admin-settings-actions">
          <button className="primary-btn" type="submit" disabled={status.state === "sending"}>{status.state === "sending" ? "Sending…" : "Send test email"}</button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * Clearing what test runs leave behind. Live, on test builds only: the
 * prototype's adapter and a production build have no `testData`, so nothing
 * is drawn; the route also refuses the production project. Not in the
 * design; built from the settings card and the design's table.
 *
 * Staff always see the list first, and the database deletes only what it
 * still recognises as test data (purge_test_data).
 */
function TestDataPanelIfLive() {
  const actions = useActions();
  return actions.testData ? <TestDataPanel /> : null;
}

function TestDataPanel() {
  const actions = useActions();
  const [state, setState] = useState({ status: "idle", preview: null, message: "" });
  const [confirming, setConfirming] = useState(false);

  const find = async () => {
    setState({ status: "finding", preview: null, message: "" });
    try {
      setState({ status: "found", preview: await actions.testData.preview(), message: "" });
    } catch (error) {
      setState({ status: "error", preview: null, message: error.message });
    }
  };

  const companies = state.preview?.companies ?? [];
  const users = state.preview?.users ?? [];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const purge = async () => {
    setConfirming(false);
    setState((current) => ({ ...current, status: "deleting", message: "" }));
    try {
      const result = await actions.testData.purge(companies.map((company) => company.id), users.map((user) => user.id));
      const kept = result.keptUsers?.length ? `; kept ${plural(result.keptUsers.length, "user", "users")} other records still point to` : "";
      const skipped = result.skipped ? `; skipped ${plural(result.skipped, "company", "companies")} that no longer match` : "";
      setState({
        status: "done",
        preview: null,
        message: `Deleted ${plural(result.companies, "company", "companies")}, ${plural(result.orders, "order", "orders")}, ${plural(result.users, "user", "users")} and ${plural(result.files ?? 0, "file", "files")}${kept}${skipped}.`,
      });
    } catch (error) {
      setState((current) => ({ ...current, status: "found", message: error.message }));
    }
  };

  return (
    <Panel
      title="Test data"
      subtitle="Companies and users left behind by test runs. Nothing is deleted until you have seen the list and confirmed. Not available on the live marketplace."
      className="admin-settings-card"
    >
      <div className="admin-testdata">
        {state.message && <p className={state.status === "error" || state.status === "found" ? "admin-error" : "admin-test-email-status"} role={state.status === "done" ? "status" : "alert"}>{state.message}</p>}
        {state.preview && (
          <>
            <p className="admin-assist-meta">{state.preview.rule}</p>
            {companies.length ? (
              <div className="admin-table-wrap admin-testdata-table">
                <table className="admin-table">
                  <thead><tr><th>Company</th><th>Members</th><th>Requests</th><th>Quotes</th><th>Orders</th><th>Files</th></tr></thead>
                  <tbody>
                    {companies.map((company) => (
                      <tr key={company.id}>
                        <td><strong>{company.name}</strong><br /><small>{company.type} · {new Date(company.createdAt).toLocaleDateString("en", { month: "short", day: "numeric" })}</small></td>
                        <td>{company.members.length ? company.members.join(", ") : "None"}</td>
                        <td>{company.requests}</td><td>{company.quotes}</td><td>{company.orders}</td><td>{company.files}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="admin-assist-meta">No test companies.</p>}
            <p className="admin-assist-meta">{users.length ? `${plural(users.length, "test user", "test users")}: ${users.slice(0, 12).map((user) => user.email).join(", ")}${users.length > 12 ? `, and ${users.length - 12} more` : ""}.` : "No test users."}</p>
          </>
        )}
        <div className="admin-settings-actions">
          {state.preview && (companies.length || users.length) ? (
            <button className="primary-btn danger-action" type="button" onClick={() => setConfirming(true)} disabled={state.status === "deleting"}>
              {state.status === "deleting" ? "Deleting…" : `Delete ${plural(companies.length, "company", "companies")} and ${plural(users.length, "user", "users")}`}
            </button>
          ) : null}
          <button className="secondary-btn" type="button" onClick={find} disabled={state.status === "finding" || state.status === "deleting"}>{state.status === "finding" ? "Looking…" : state.preview ? "Look again" : "Find test data"}</button>
        </div>
      </div>
      {confirming && createPortal(
        <div className="approve-fund-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setConfirming(false)}>
          <section className="approve-fund-modal admin-review-modal small" role="dialog" aria-modal="true" aria-labelledby="test-data-title">
            <button className="settings-drawer-close" type="button" aria-label="Close" onClick={() => setConfirming(false)}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
            <header><div><span>Test data</span><h2 id="test-data-title">Delete {plural(companies.length, "company", "companies")} and {plural(users.length, "user", "users")}?</h2><p>This cannot be undone</p></div></header>
            <footer><button className="secondary-btn" type="button" onClick={() => setConfirming(false)}>Cancel</button><button className="primary-btn danger-action" type="button" onClick={purge}>Delete test data</button></footer>
          </section>
        </div>,
        document.body,
      )}
    </Panel>
  );
}

// Test sites have no scheduled jobs, so staff run the daily one by hand.
function DailyJobsPanel() {
  const actions = useActions();
  const [status, setStatus] = useState({ state: "idle", message: "" });

  const run = async () => {
    setStatus({ state: "running", message: "" });
    try {
      const { reminders = {}, emails = {} } = await actions.runDailyJobs();
      const count = (n, one, many) => `${n ?? 0} ${(n ?? 0) === 1 ? one : many}`;
      const sent = emails.configured === false ? "emails wait until sending is set up" : `${count(emails.sent, "email", "emails")} sent`;
      setStatus({
        state: "done",
        message: `${count(reminders.capacity_reminders, "capacity reminder", "capacity reminders")}, ${count(reminders.due_soon, "step due soon", "steps due soon")}; ${sent}.`,
      });
    } catch (error) {
      setStatus({ state: "error", message: error.message });
    }
  };

  return (
    <Panel
      title="Daily jobs"
      subtitle="Every morning the marketplace reminds factories whose capacity is a month old and whoever acts on a step due within three days, then sends the emails waiting. Run it now to see what it would send today; nothing is sent twice."
      className="admin-settings-card"
    >
      <div className="admin-threshold-form">
        {status.message && <p className={status.state === "error" ? "admin-error" : "admin-test-email-status"} role={status.state === "error" ? "alert" : "status"}>{status.message}</p>}
        <div className="admin-settings-actions">
          <button className="primary-btn" type="button" onClick={run} disabled={status.state === "running"}>{status.state === "running" ? "Running…" : "Run daily jobs now"}</button>
        </div>
      </div>
    </Panel>
  );
}

function SettingsPage({ user, account, onSignOut, testEmailsIntro }) {
  const initialThresholds = { autoClear: "95", manualMin: "80", manualMax: "94", moreInformation: "80", authority: "TSC operations" };
  const email = user?.email ?? account?.email ?? "operations@thesourcingclub.com";
  const name = account?.name ?? user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? "TSC Operations";
  const accountInitials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "TS";
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
      <header className="rfqs-header"><div><p className="admin-eyebrow">Admin</p><h1>Admin settings</h1><p>Manage the verification rules used across the marketplace.</p></div></header>
      <Panel
        title="Admin account"
        subtitle="The account currently signed in to this operations workspace."
        className="admin-settings-card admin-account-card"
      >
        <div className="admin-account-summary">
          <div className="admin-account-identity">
            <span aria-hidden="true">{accountInitials}</span>
            <div><strong>{name}</strong><small>{email}</small></div>
          </div>
          <button className="secondary-btn" type="button" onClick={onSignOut}>Log out</button>
        </div>
      </Panel>
      <Panel
        title="Review thresholds"
        subtitle={isEditing ? "Update the evidence ranges and decision ownership." : "Guidance for reviewers, shown beside each profile. No profile is ever approved automatically."}
        action={isEditing ? null : "Edit"}
        onAction={startEditing}
        className={isEditing ? "admin-settings-card is-editing" : "admin-settings-card"}
      >
        {isEditing ? (
          <form className="admin-threshold-form" onSubmit={saveThresholds}>
            <label className="admin-threshold-field">
              <span>Ready to approve above</span>
              <div className="admin-number-input"><input type="number" min="0" max="100" required value={draft.autoClear} onChange={(event) => updateDraft("autoClear", event.target.value)} /><span>% complete</span></div>
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
            <ProfileDetailPair label="Ready to approve above" value={`${thresholds.autoClear}% complete`} />
            <ProfileDetailPair label="Manual review range" value={`${thresholds.manualMin}-${thresholds.manualMax}% complete`} />
            <ProfileDetailPair label="More information threshold" value={`Below ${thresholds.moreInformation}%`} />
            <ProfileDetailPair label="Final decision authority" value={thresholds.authority} />
          </div>
        )}
      </Panel>
      <TestEmailPanel email={email} intro={testEmailsIntro} />
      <DailyJobsPanel />
      <TestDataPanelIfLive />
    </main>
  );
}

function App({ testEmailsIntro } = {}) {
  // Everything below reads through the data seam. admin-prototype.html serves
  // the constants in this file; admin.html serves the marketplace. The
  // components in between never learn which.
  const { data: queue, loading: queueLoading, error: queueError, reload: reloadQueue } = useVerificationQueue();
  const { data: rfqRows, loading: rfqsLoading, error: rfqsError } = useAdminRfqs();
  const { data: quoteRows, loading: quotesLoading, error: quotesError } = useAdminQuotes();
  const { data: metricRow, reload: reloadMetrics } = useAdminMetrics();
  const { data: userRows, loading: usersLoading, error: usersError, reload: reloadUsers } = useAdminUsers();
  const actions = useActions();
  const viewer = useViewer();

  const profiles = queue ?? [];
  const rfqList = rfqRows ?? [];
  const quoteList = quoteRows ?? [];
  const users = userRows ?? [];
  const currentAdmin = users.find((user) => user.protected) ?? null;
  const metrics = metricRow ?? {};
  const loading = queueLoading || rfqsLoading || quotesLoading || usersLoading;
  const loadError = queueError || rfqsError || quotesError || usersError;

  const query = new URLSearchParams(window.location.search);
  const requested = query.get("screen") || "overview";
  const requestedProfile = profiles.find((profile) => profile.id === query.get("profile")) || profiles[0];
  const requestedRfq = rfqList.find((rfq) => rfq[0] === query.get("rfq")) || rfqList[0];
  const requestedQuote = quoteList.find((quote) => quote[0] === query.get("quote")) || quoteList.find((quote) => quote[3] === requestedRfq?.[0]) || quoteList[0];
  const screenLabel = { overview: "Overview", rfqs: "RFQs", quotes: "Quotes", users: "Users", brands: "Verification", vendors: "Verification", verification: "Verification", review: "Review", "rfq-detail": "RFQ detail", "quote-detail": "Quote detail", settings: "Settings" }[requested] || "Overview";
  const [screen, setScreen] = useState(screenLabel);
  const [selectedProfile, setSelectedProfile] = useState(requestedProfile);
  const [selectedRfq, setSelectedRfq] = useState(requestedRfq);
  const [selectedQuote, setSelectedQuote] = useState(requestedQuote);
  const [reviewBack, setReviewBack] = useState("Verification");
  const [rfqBack, setRfqBack] = useState(requested === "rfq-detail" ? "RFQs" : "Overview");
  // Where a quote was opened from: the quote list, or its request's page.
  const [quoteBack, setQuoteBack] = useState(requested === "quote-detail" ? "Quotes" : "RFQ detail");
  // Live only: the open request's brief and quote figures, read from the
  // records when it opens. The mock has no `rfqDetail` and keeps its constants.
  const [rfqDetail, setRfqDetail] = useState(null);
  const [collapsed, setCollapsed] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [toast, setToast] = useState("");
  // The files the company under review uploaded. Fetched per company rather
  // than carried on every queue row, because only the review screen opens
  // them and the list is only read once someone is looking at that company.
  const [reviewDocuments, setReviewDocuments] = useState([]);
  const [reviewSubmission, setReviewSubmission] = useState(null);

  // Against the mock every list is populated on the first render, so these
  // seeds are no-ops. Against the network the first render has nothing, and a
  // deep link would otherwise land on a blank detail screen. They seed from
  // the link, not the first row: the URL still names the company (or request,
  // or quote) the link was for until something is selected.
  useEffect(() => {
    if (!selectedProfile && profiles.length) setSelectedProfile(requestedProfile);
  }, [profiles, selectedProfile]);

  useEffect(() => {
    if (!selectedProfile?.id || !actions.orgDocuments) {
      setReviewDocuments([]);
      setReviewSubmission(null);
      return undefined;
    }
    let cancelled = false;
    // Never show the previous company's account contact while the next
    // submission is loading.
    setReviewSubmission(null);
    Promise.resolve(actions.orgDocuments(selectedProfile.id))
      .then((rows) => { if (!cancelled) setReviewDocuments(rows ?? []); })
      // Neither fetch may take the review screen down with it: the decision
      // buttons still work, and the modal says what it could not load.
      .catch(() => { if (!cancelled) setReviewDocuments([]); });

    Promise.resolve(actions.orgSubmission?.(selectedProfile.id))
      .then((row) => { if (!cancelled) setReviewSubmission(row ?? null); })
      .catch(() => { if (!cancelled) setReviewSubmission(null); });

    return () => { cancelled = true; };
  }, [selectedProfile?.id, actions]);
  useEffect(() => {
    if (!selectedRfq && rfqList.length) setSelectedRfq(requestedRfq);
  }, [rfqList, selectedRfq]);
  useEffect(() => {
    if (!selectedQuote && quoteList.length) setSelectedQuote(requestedQuote);
  }, [quoteList, selectedQuote]);

  const detailRow = screen === "Quote detail" ? selectedQuote : screen === "RFQ detail" ? selectedRfq : null;
  const detailKey = screen === "Quote detail" ? selectedQuote?.[3] : selectedRfq?.[0];
  useEffect(() => {
    if (!detailRow || !actions.rfqDetail) return undefined;
    let cancelled = false;
    setRfqDetail((current) => (current?.key === detailKey ? current : null));
    Promise.resolve(actions.rfqDetail(detailRow))
      .then((detail) => { if (!cancelled) setRfqDetail({ key: detailKey, ...detail }); })
      .catch((error) => { if (!cancelled) setRfqDetail({ key: detailKey, error }); });
    return () => { cancelled = true; };
  }, [detailKey, Boolean(detailRow), actions]);
  // Never the previous request's figures under this one's title, and never
  // the prototype's constants while the real ones load: live, a detail that
  // is not here yet says so in every field.
  const loadedDetail = rfqDetail?.key === detailKey ? rfqDetail : null;
  const placeholder = (text) => ({
    brief: Object.fromEntries(["category", "quantity", "targetPrice", "delivery", "materials", "samples", "requirements"].map((key) => [key, text])),
    quotes: {},
  });
  const shownDetail = !actions.rfqDetail ? null
    : !loadedDetail ? placeholder("Loading…")
    : loadedDetail.error ? placeholder("Could not load")
    : loadedDetail;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const sync = () => setCollapsed(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const slug = { Overview: "overview", RFQs: "rfqs", Quotes: "quotes", Users: "users", Verification: "verification", Settings: "settings" }[screen];
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
    const matchingRfq = rfqList.find((rfq) => rfq[0] === quote[3]);
    if (matchingRfq) setSelectedRfq(matchingRfq);
    setSelectedQuote(quote);
    setQuoteBack(screen === "Quotes" ? "Quotes" : "RFQ detail");
    setScreen("Quote detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const decide = async (id, status, note = null, tier = null) => {
    const tone = status === "Approved" ? "success" : status === "Declined" ? "neutral" : "danger";
    let result;
    try {
      result = await actions.decideReview?.(id, status, note, tier);
    } catch (error) {
      setToast(error.message || "That decision could not be recorded");
      window.setTimeout(() => setToast(""), 4000);
      return;
    }
    // The mock action mutates its own array; the live one has written to the
    // database. Either way the queue is re-read rather than patched locally,
    // so what is on screen is what the decision actually produced.
    setSelectedProfile((current) => current?.id === id ? { ...current, status, tone } : current);
    reloadQueue();
    reloadMetrics();
    // What happened to the decision, and what happened to the email, are two
    // separate facts: the decision is recorded either way, so the toast says
    // so plainly rather than letting a mail failure read as a lost decision.
    const decisionEmail = result?.decisionEmail;
    const outcome = status === "Approved" ? `Profile approved${tier ? ` as ${tier[0].toUpperCase()}${tier.slice(1)}` : ""}`
      : status === "Declined" ? "Profile declined"
      : "Information request sent";
    setToast(
      !decisionEmail ? outcome
        : decisionEmail.error ? `${outcome}; email is queued for retry`
        : decisionEmail.alreadySent ? `${outcome}; email was already sent`
        : `${outcome} and email sent`
    );
    window.setTimeout(() => setToast(""), 2400);
  };
  const toggleUserStatus = async (id) => {
    const user = users.find((item) => item.id === id);
    if (!user || user.protected) return;
    const nextStatus = user.status === "Active" ? "Disabled" : "Active";
    try {
      await actions.toggleUserAccess?.(id, nextStatus === "Disabled");
      reloadUsers();
      setToast(`${user.name} ${nextStatus === "Active" ? "enabled" : "disabled"}`);
    } catch (error) {
      setToast(error.message || "That account could not be updated");
    }
    window.setTimeout(() => setToast(""), 2400);
  };
  const navigate = (label) => { setScreen(label); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const active = screen === "Review" ? reviewBack
    : screen === "Quote detail" && quoteBack === "Quotes" ? "Quotes"
    : ["RFQ detail", "Quote detail"].includes(screen) ? (rfqBack === "Overview" ? "Overview" : "RFQs")
    : screen;

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
      {loadError
        ? <main className="admin-page"><div className="admin-empty-state admin-load-error"><strong>The workspace could not load</strong><p>{loadError.message}</p></div></main>
        : loading
          ? <main className="admin-page"><div className="admin-empty-state"><strong>Loading the marketplace…</strong></div></main>
          : <>
      {screen === "Overview" && <Overview profiles={profiles} rfqRows={rfqList} quoteRows={quoteList} metrics={metrics} onReview={openReview} onNavigate={navigate} onOpenRfq={openRfq} />}
      {["RFQs", "Quotes", "Verification"].includes(screen) && <QueuePage kind={screen} profiles={profiles} rfqRows={rfqList} quoteRows={quoteList} onReview={openReview} onOpenRfq={openRfq} onOpenQuote={openQuote} />}
      {screen === "Users" && <UsersPage users={users} onToggleStatus={toggleUserStatus} />}
      {screen === "Review" && <VerificationDetail profile={selectedProfile} submission={reviewSubmission} documents={reviewDocuments} onDocumentUrl={actions.documentUrl} onBack={() => navigate(reviewBack)} onDecision={decide} onSuggestRequest={actions.suggestReviewRequest} />}
      {screen === "RFQ detail" && <AdminRfqDetail rfq={selectedRfq} backLabel={rfqBack} onBack={() => navigate(rfqBack)} onOpenQuote={openQuote} quoteRows={quoteList} detail={shownDetail} />}
      {screen === "Quote detail" && <AdminQuoteDetail quote={selectedQuote} rfq={selectedRfq} onBack={() => navigate(quoteBack)} detail={shownDetail} backLabel={quoteBack} />}
      {screen === "Settings" && <SettingsPage user={viewer.user} account={currentAdmin} onSignOut={actions.signOut} testEmailsIntro={testEmailsIntro} />}
            </>}
      {toast && <div className="app-toast admin-toast" role="status">{toast}</div>}
    </div>
  );
}

export default App;
