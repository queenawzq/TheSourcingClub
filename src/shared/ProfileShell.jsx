import React from "react";

export function PrototypeSideNav({
  account,
  active,
  ariaLabel,
  collapsed,
  navItems,
  onNav,
  onProfile,
  onToggle
}) {
  return (
    <aside className={collapsed ? "side-nav collapsed" : "side-nav"}>
      <button className="collapse-toggle" type="button" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        <img src={`/assets/prototype-icons/${collapsed ? "expand" : "collapse"}.svg`} alt="" />
      </button>
      {!collapsed && <img src="/assets/logo.svg" alt="The Sourcing Club" className="side-logo" />}
      <button className={collapsed ? "account-card collapsed-account" : "account-card"} type="button" aria-label={ariaLabel} onClick={onProfile}>
        <span>{account.initials}</span>
        <div>
          <strong>{account.name}</strong>
          <small>{account.type}</small>
        </div>
      </button>
      <nav>
        {navItems.map((item, index) => (
          <React.Fragment key={item.label}>
            {(index === 3 || index === 6) && <span className="nav-divider" />}
            <button
              className={item.label === active ? "active" : ""}
              type="button"
              onClick={() => onNav?.(item.label)}
              aria-label={item.ariaLabel || item.label}
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

export function ProfileOwnerBar({
  ariaLabel,
  editLabel = "Edit profile",
  isOwnerView,
  onEdit,
  onPublic,
  ownerText,
  previewText = "Public preview",
  profileLabel,
  publicLabel = "View as public"
}) {
  return (
    <section className="factory-profile-owner-bar">
      <div>
        <span>{profileLabel}</span>
        <strong>{isOwnerView ? ownerText : previewText}</strong>
      </div>
      <div className="factory-profile-view-toggle" role="tablist" aria-label={ariaLabel}>
        <button
          className={isOwnerView ? "active" : ""}
          type="button"
          onClick={onEdit}
          role="tab"
          aria-selected={isOwnerView}
        >
          {editLabel}
        </button>
        <button
          className={!isOwnerView ? "active" : ""}
          type="button"
          onClick={onPublic}
          role="tab"
          aria-selected={!isOwnerView}
        >
          {publicLabel}
        </button>
      </div>
    </section>
  );
}

export function ProfilePerformanceCard({ eyebrow, primary, primaryLabel, metrics }) {
  return (
    <section className="factory-profile-card factory-profile-performance">
      <div>
        <span>{eyebrow}</span>
        <strong>{primary}</strong>
        <p>{primaryLabel}</p>
      </div>
      <div className="factory-profile-score-grid">
        {metrics.map((metric) => (
          <ProfileMetric label={metric.label} value={metric.value} key={metric.label} />
        ))}
      </div>
    </section>
  );
}

export function ProfileMetric({ label, value, className = "" }) {
  return (
    <div className={className ? `metric ${className}` : "metric"}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function ProjectCardActions({
  actionLabel,
  actionsClassName = "project-actions",
  children,
  onAction,
  status,
  statusClassName = "",
  statusTone
}) {
  const statusClasses = ["project-status", "production-order-status", "shared-card-status", statusTone, statusClassName].filter(Boolean).join(" ");
  const actionClasses = ["shared-card-actions", actionsClassName].filter(Boolean).join(" ");

  return (
    <div className={actionClasses}>
      <span className={statusClasses}>{status}</span>
      <button className="primary-btn" type="button" onClick={onAction}>{actionLabel}</button>
      {children}
    </div>
  );
}

export function ProfileCardHeader({ title, editable = false, actionLabel = "Edit", onEdit }) {
  return (
    <div className="factory-profile-card-header">
      <h2>{title}</h2>
      {editable && <button className="factory-profile-edit-button" type="button" onClick={onEdit}>{actionLabel}</button>}
    </div>
  );
}

export function ProfileChipSection({ label, items }) {
  return (
    <div className="factory-profile-chip-section">
      <span>{label}</span>
      <div className="tag-row compact-tags">
        {items.map((item) => <span className="tag garment-tag" key={item}>{item}</span>)}
      </div>
    </div>
  );
}

export function ProfileDetailPair({ label, value }) {
  return (
    <div className="factory-detail-pair">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ProfileCompletionSummaryRow({ label, value }) {
  return (
    <div className="profile-completion-summary-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
