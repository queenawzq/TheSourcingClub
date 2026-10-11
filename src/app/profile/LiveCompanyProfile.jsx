import React, { useEffect, useState } from "react";
import { ProfileCardHeader, ProfileDetailPair, ProfileOwnerBar } from "../../shared/ProfileShell.jsx";
import { saveBrandProfile, saveFactoryProfile } from "../../lib/domain/profile.js";
import "./live-company-profile.css";

const present = (value, fallback = "Not added yet") => {
  if (value === null || value === undefined || value === "") return fallback;
  if (Array.isArray(value)) return value.length ? value.join(" · ") : fallback;
  return String(value);
};

const sentenceCase = (value) =>
  present(value)
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());

const initialsOf = (name) =>
  present(name, "TSC")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");

function DetailCard({ title, rows, editable = false, onEdit }) {
  return (
    <section className="factory-profile-card live-profile-card">
      <ProfileCardHeader title={title} editable={editable} onEdit={onEdit} />
      <div className="factory-profile-detail-grid">
        {rows.map(([label, value]) => (
          <ProfileDetailPair label={label} value={present(value)} key={label} />
        ))}
      </div>
    </section>
  );
}

function ProfileEditDialog({ fields, onClose, onSave, saving, saveError, title, values }) {
  const [form, setForm] = useState(() => Object.fromEntries(fields.map(({ key }) => [key, values[key] ?? ""])));

  return (
    <div className="brand-profile-modal-layer" role="presentation">
      <button className="brand-profile-modal-scrim" type="button" aria-label="Close editor" onClick={onClose} />
      <section className="brand-profile-modal live-profile-editor-modal" role="dialog" aria-modal="true" aria-labelledby="live-profile-editor-title">
        <button className="brand-profile-modal-close" type="button" onClick={onClose} aria-label="Close editor">
          <img src="/assets/prototype-icons/close.svg" alt="" />
        </button>
        <header className="brand-profile-modal-header">
          <span>Profile editor</span>
          <h1 id="live-profile-editor-title">{title}</h1>
          <p>Update the information shown on your public profile.</p>
        </header>
        <div className="settings-drawer-form live-profile-editor-form">
          {fields.map(({ key, label, multiline = false, numeric = false, wide = false }) => (
            <label className={wide ? "live-profile-editor-wide" : ""} key={key}>
              <span>{label}</span>
              {multiline ? (
                <textarea
                  rows="6"
                  value={form[key]}
                  onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                />
              ) : (
                <input
                  type={numeric ? "number" : "text"}
                  min={numeric ? "0" : undefined}
                  value={form[key]}
                  onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                />
              )}
            </label>
          ))}
        </div>
        {saveError ? <p className="brand-onboarding-save-error" role="alert">{saveError}</p> : null}
        <footer className="brand-profile-modal-actions">
          <button className="secondary-btn" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="primary-btn"
            type="button"
            disabled={saving}
            onClick={() => onSave(Object.fromEntries(fields.map(({ key, numeric }) => [
              key,
              numeric ? (form[key] === "" ? null : Number(form[key])) : (form[key].trim() || null),
            ])))}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export default function LiveCompanyProfile({ org, profile, user, isFactory, onOpenSettings }) {
  const [profileMode, setProfileMode] = useState("edit");
  const [liveProfile, setLiveProfile] = useState(profile || {});
  const [activeEditor, setActiveEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const isOwnerView = profileMode === "edit";

  useEffect(() => setLiveProfile(profile || {}), [profile]);

  const companyName = liveProfile?.legal_name || org.name;
  const location = isFactory ? liveProfile?.location : liveProfile?.hq_location;
  const accountLabel = isFactory
    ? (liveProfile?.vendor_kind === "trading_company" ? "Vendor profile" : "Factory profile")
    : "Brand profile";
  const audience = isFactory ? "brands" : "vendors";

  const editors = {
    about: {
      title: "About your company",
      fields: [{ key: "intro", label: "Company introduction", multiline: true, wide: true }],
    },
    company: {
      title: "Company information",
      fields: isFactory
        ? [
            { key: "legal_name", label: "Company name" },
            { key: "location", label: "Location" },
            { key: "nearest_port", label: "Nearest port" },
            { key: "founded_year", label: "Year founded", numeric: true },
            { key: "employee_count", label: "Team size", numeric: true },
            { key: "website_url", label: "Website" },
            { key: "languages_supported", label: "Supported languages", wide: true },
          ]
        : [
            { key: "legal_name", label: "Brand name" },
            { key: "brand_category", label: "Brand category" },
            { key: "business_email", label: "Business email" },
            { key: "hq_location", label: "HQ location" },
            { key: "founded_year", label: "Year founded", numeric: true },
            { key: "website_url", label: "Website" },
            { key: "annual_revenue_band", label: "Annual revenue", wide: true },
          ],
    },
    operating: {
      title: isFactory ? "Production & commercial details" : "Sourcing volume",
      fields: isFactory
        ? [
            { key: "moq", label: "Minimum order quantity", numeric: true },
            { key: "typical_lead_days", label: "Typical lead time (days)", numeric: true },
            { key: "sample_lead_days", label: "Sample lead time (days)", numeric: true },
            { key: "typical_order_value_band", label: "Typical order value" },
            { key: "partner_factory_count", label: "Partner factories", numeric: true },
            { key: "supported_incoterms", label: "Supported Incoterms" },
            { key: "typical_payment_terms", label: "Typical payment terms", wide: true },
          ]
        : [
            { key: "pieces_per_year_band", label: "Pieces ordered per year" },
            { key: "order_size_band", label: "Typical order size" },
            { key: "collections_per_year", label: "Collections per year", numeric: true },
            { key: "reorder_cadence", label: "Reorder cadence" },
            { key: "sourcing_stage", label: "Current sourcing stage" },
            { key: "target_price_min_cents", label: "Minimum target price (cents)", numeric: true },
            { key: "target_price_max_cents", label: "Maximum target price (cents)", numeric: true },
          ],
    },
    equipment: {
      title: "Equipment & capabilities",
      fields: [{ key: "equipment_notes", label: "Equipment and capability notes", multiline: true, wide: true }],
    },
  };

  const saveSection = async (patch) => {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = isFactory
        ? await saveFactoryProfile(org.id, patch)
        : await saveBrandProfile(org.id, patch);
      setLiveProfile(saved);
      setActiveEditor(null);
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  };

  const overviewRows = isFactory
    ? [
        ["Company name", companyName],
        ["Company type", liveProfile?.vendor_kind === "trading_company" ? "Trading company" : "Factory"],
        ["Location", location],
        ["Nearest port", liveProfile?.nearest_port],
        ["Year founded", liveProfile?.founded_year],
        ["Team size", liveProfile?.employee_count],
        ["Website", liveProfile?.website_url],
        ["Supported languages", liveProfile?.languages_supported],
      ]
    : [
        ["Brand name", companyName],
        ["Brand category", liveProfile?.brand_category],
        ["Business email", liveProfile?.business_email || user?.email],
        ["HQ location", location],
        ["Year founded", liveProfile?.founded_year],
        ["Website", liveProfile?.website_url],
        ["Annual revenue", liveProfile?.annual_revenue_band],
      ];

  const operatingRows = isFactory
    ? [
        ["Minimum order quantity", liveProfile?.moq],
        ["Typical lead time", liveProfile?.typical_lead_days ? `${liveProfile.typical_lead_days} days` : null],
        ["Sample lead time", liveProfile?.sample_lead_days ? `${liveProfile.sample_lead_days} days` : null],
        ["Typical order value", liveProfile?.typical_order_value_band],
        ["Partner factories", liveProfile?.partner_factory_count],
        ["Supported Incoterms", liveProfile?.supported_incoterms],
        ["Typical payment terms", liveProfile?.typical_payment_terms],
      ]
    : [
        ["Pieces ordered per year", liveProfile?.pieces_per_year_band],
        ["Typical order size", liveProfile?.order_size_band],
        ["Collections per year", liveProfile?.collections_per_year],
        ["Reorder cadence", liveProfile?.reorder_cadence],
        ["Current sourcing stage", liveProfile?.sourcing_stage],
        [
          "Target price range",
          liveProfile?.target_price_min_cents != null || liveProfile?.target_price_max_cents != null
            ? [liveProfile?.target_price_min_cents, liveProfile?.target_price_max_cents]
                .map((amount) => amount == null ? null : `$${(amount / 100).toFixed(2)}`)
                .filter(Boolean)
                .join(" – ")
            : null,
        ],
      ];

  return (
    <main className={`factory-profile-page live-company-profile ${isOwnerView ? "is-owner-view" : "is-public-view"} ${isFactory ? "" : "brand-profile-page"}`}>
      <div className="factory-profile-shell">
        <ProfileOwnerBar
          ariaLabel={`${accountLabel} view`}
          isOwnerView={isOwnerView}
          onEdit={() => setProfileMode("edit")}
          onPublic={() => setProfileMode("public")}
          ownerText={`Edit what ${audience} see`}
          previewText={`This is the profile ${audience} see`}
          profileLabel={accountLabel}
          publicLabel="Public view"
        />

        <section className="factory-profile-hero live-profile-hero">
          <div className="factory-profile-identity">
            <div className="factory-profile-logo-wrap">
              <div className="factory-profile-logo">{initialsOf(companyName)}</div>
            </div>
            <div>
              <div className="factory-profile-title-row">
                <h1>{companyName}</h1>
                {liveProfile?.verification_status === "verified" && (
                  <span className="live-profile-verified">Verified</span>
                )}
              </div>
              <p>{present(location)} · {sentenceCase(liveProfile?.vendor_kind || liveProfile?.brand_category || accountLabel)}</p>
            </div>
          </div>
        </section>

        <div className="factory-profile-layout">
          <section className="factory-profile-main">
            <section className="factory-profile-card live-profile-card">
              <ProfileCardHeader title="About" editable={isOwnerView} onEdit={() => setActiveEditor("about")} />
              <p className="live-profile-intro">{present(liveProfile?.intro, "No company introduction has been added yet.")}</p>
            </section>
            <DetailCard title="Company information" rows={overviewRows} editable={isOwnerView} onEdit={() => setActiveEditor("company")} />
            <DetailCard title={isFactory ? "Production & commercial details" : "Sourcing volume"} rows={operatingRows} editable={isOwnerView} onEdit={() => setActiveEditor("operating")} />
            {isFactory && (liveProfile?.equipment_notes || isOwnerView) ? (
              <section className="factory-profile-card live-profile-card">
                <ProfileCardHeader title="Equipment & capabilities" editable={isOwnerView} onEdit={() => setActiveEditor("equipment")} />
                <p className="live-profile-intro">{present(liveProfile?.equipment_notes, "No equipment or capability notes have been added yet.")}</p>
              </section>
            ) : null}
          </section>

          {isOwnerView ? <aside className="factory-profile-side">
            <section className="factory-profile-card live-profile-card">
              <ProfileCardHeader title="Profile status" />
              <div className={`live-profile-status ${liveProfile?.verification_status === "verified" ? "verified" : ""}`}>
                {sentenceCase(liveProfile?.verification_status || "pending")}
              </div>
              <p className="live-profile-note">
                {liveProfile?.verification_status === "verified"
                  ? `Your account is approved and this profile is available to ${audience}.`
                  : "Your profile is awaiting review."}
              </p>
              <button className="secondary-btn live-profile-settings-button" type="button" onClick={onOpenSettings}>Account settings</button>
            </section>
          </aside> : null}
        </div>
      </div>
      {activeEditor ? (
        <ProfileEditDialog
          fields={editors[activeEditor].fields}
          onClose={() => { setActiveEditor(null); setSaveError(null); }}
          onSave={saveSection}
          saveError={saveError}
          saving={saving}
          title={editors[activeEditor].title}
          values={liveProfile}
        />
      ) : null}
    </main>
  );
}
