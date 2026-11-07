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

export default function AdminWorkspaceShell({ children, onSignOut, preview = false }) {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = (label) => {
    if (label === "Payments") return;
    const page = preview ? "/admin-prototype.html" : "/admin.html";
    window.location.assign(`${page}?screen=${encodeURIComponent(label.toLowerCase())}`);
  };
  return <div className={collapsed ? "app-shell nav-collapsed admin-app payments-workspace" : "app-shell admin-app payments-workspace"}>
    <PrototypeSideNav account={{ initials: "TS", name: "TSC Operations", type: "Admin workspace" }} active="Payments" ariaLabel="Admin workspace" collapsed={collapsed} navItems={adminWorkspaceNav} onNav={navigate} onProfile={() => navigate("Settings")} onToggle={() => setCollapsed(value => !value)} onSignOut={onSignOut} />
    {children}
  </div>;
}
