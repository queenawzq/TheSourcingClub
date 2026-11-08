import React, { useState } from "react";
import { PrototypeSideNav } from "../../shared/ProfileShell.jsx";
import "../../prototype/styles.css";
import "../../factory-prototype/styles.css";
import "../../shared/profile-shell.css";
import "../../admin-prototype/styles.css";

export const adminWorkspaceNav = [
  { label: "Overview", icon: "home" },
  { label: "RFQs", icon: "rfq" },
  { label: "Quotes", icon: "projects" },
  { label: "Payments", icon: "billing" },
  { label: "Users", icon: "connections" },
  { label: "Verification", icon: "verification" },
  { label: "Settings", icon: "settings" },
];

export default function AdminWorkspaceShell({ children, onSignOut, preview = false, extraNav = [] }) {
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(max-width: 760px)").matches));
  const navigate = (label) => {
    if (label === "Payments") return;
    const elsewhere = extraNav.find((item) => item.label === label);
    if (elsewhere) { window.location.href = elsewhere.href; return; }
    const page = preview ? "/admin-prototype.html" : "/admin.html";
    window.location.assign(`${page}?screen=${encodeURIComponent(label.toLowerCase())}`);
  };
  return <div className={collapsed ? "app-shell nav-collapsed admin-app payments-workspace" : "app-shell admin-app payments-workspace"}>
    <PrototypeSideNav account={{ initials: "TS", name: "TSC Operations", type: "Admin workspace" }} active="Payments" ariaLabel="Admin workspace" collapsed={collapsed} navItems={[...adminWorkspaceNav, ...extraNav]} onNav={navigate} onProfile={() => navigate("Settings")} onToggle={() => setCollapsed(value => !value)} onSignOut={onSignOut} />
    {!collapsed && <button className="mobile-nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setCollapsed(true)} />}
    {children}
  </div>;
}
