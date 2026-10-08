/**
 * The brand's own profile, on Queena's designed `BrandProfileScreen`, with the
 * brand's real records behind it: what onboarding saved (the profile, its
 * tags and files), its team, and its own requests and orders. "View details"
 * opens the designed completion page (`BrandProfileCompletionPage`) on the
 * same data, and each Edit opens the designed dialog, saving through
 * brand-profile-save.js and factory-profile-files.js.
 *
 * Everything is the brand reading and writing its own rows, so no new access
 * rule is involved.
 */
import React, { useCallback, useEffect, useState } from "react";
import { BrandProfileCompletionPage, BrandProfileScreen } from "../../prototype/main.jsx";
import { useRouter } from "../../lib/router.jsx";
import { inviteMember, revokeInvitation } from "../../lib/domain/org.js";
import { brandCompletionView, brandProfileEditForm, brandProfileEditOptions, brandProfileView } from "./brand-profile-view.js";
import { BRAND_EDITORS, saveBrandProfileSection } from "./brand-profile-save.js";
import {
  DOCUMENT_ACCEPT,
  FILE_EDITORS,
  addProfileFile,
  editProfileFile,
  removeProfileFile,
  uploadRegistration,
  viewDocument,
} from "./factory-profile-files.js";
import { documentStatus } from "./factory-profile-view.js";
import { loadOwnBrandProfile } from "./load-profile.js";
import "./profile.css";

/** The page's data, and a reload that keeps the page up while it fetches. */
function useBrandProfile(org) {
  const [state, setState] = useState({ parts: null, error: null });

  const reload = useCallback(async () => {
    const parts = await loadOwnBrandProfile(org);
    setState({ parts, error: null });
    return parts;
  }, [org.id, org.name, org.role]);

  useEffect(() => {
    let cancelled = false;
    setState({ parts: null, error: null });
    loadOwnBrandProfile(org).then(
      (parts) => !cancelled && setState({ parts, error: null }),
      (error) => !cancelled && setState({ parts: null, error }),
    );
    return () => { cancelled = true; };
  }, [org.id, org.name, org.role]);

  return { ...state, reload };
}

function Waiting({ error }) {
  return (
    <main className="factory-profile-page brand-profile-page">
      {error
        ? <p className="live-profile-error" role="alert">Couldn't load your profile: {error.message}</p>
        : <p className="live-profile-loading">Loading your profile…</p>}
    </main>
  );
}

/** "duplicate key" from the one-pending-invitation-per-address index, said plainly. */
async function invite(org, email) {
  try {
    await inviteMember(org.id, email);
  } catch (error) {
    if (/duplicate|already exists|unique/i.test(error.message ?? "")) throw new Error(`${email.trim()} has already been invited.`);
    throw error;
  }
}

/**
 * The file dialogs' and the stakeholders dialog's live props. Each action
 * saves at once and then reloads the page, so the dialog and the profile
 * behind it show the result.
 */
function dialogParts(org, parts, reload) {
  const after = (work) => async (...args) => {
    await work(...args);
    await reload();
  };
  const media = (editor, assets, existing, extra) => ({
    assets,
    accept: FILE_EDITORS[editor].types.join(","),
    onAdd: after((file, details) => addProfileFile(org, editor, file, details, existing)),
    onEdit: after((asset, file, details) => editProfileFile(org, editor, asset.doc, file, details)),
    onDelete: after((asset) => removeProfileFile(asset.doc)),
    ...extra,
  });
  const logo = parts.logos[0];
  const registration = parts.registrationDoc;
  const verified = parts.profile?.verification_status === "verified";
  const registrationStatus = registration ? documentStatus(registration.status, true) : null;

  return {
    stakeholders: {
      members: parts.members.map((member) => ({
        key: member.user_profiles?.id ?? member.user_profiles?.email,
        name: member.user_profiles?.full_name || member.user_profiles?.email || "Member",
        email: member.user_profiles?.email ?? "",
        role: member.role === "owner" ? "Owner" : "Member",
      })),
      invitations: parts.invitations,
      // Only owners may invite or withdraw an invitation (RLS).
      canInvite: parts.isOwner,
      onInvite: after((email) => invite(org, email)),
      onRevoke: parts.isOwner ? after((invitation) => revokeInvitation(invitation.id)) : null,
    },
    files: {
      banner: media(
        "banner",
        logo ? [{ title: logo.title || "Profile image", meta: logo.caption || "Current brand profile image", editTitle: logo.title ?? "", editCaption: logo.caption ?? "", src: parts.logoUrl, doc: logo }] : [],
        parts.logos,
        { addLabel: logo ? "+ Replace image" : "+ Add image" },
      ),
      assets: media(
        "assets",
        parts.assets.map((asset) => ({
          title: asset.title,
          meta: asset.caption,
          editTitle: asset.doc.title ?? asset.title,
          editCaption: asset.caption,
          src: asset.src,
          doc: asset.doc,
        })),
        [],
      ),
      verification: {
        accept: DOCUMENT_ACCEPT,
        registration: registration
          ? { fileName: registration.file_name, status: verified ? "Verified" : registrationStatus === "Uploaded" ? "In review" : registrationStatus, onView: () => viewDocument(registration) }
          : verified ? { fileName: "", status: "Verified by TSC", onView: null } : null,
        // A verified registration stays as it is; a new file would send the
        // brand back to review.
        canUpload: !verified && (!registration || registrationStatus === "Rejected"),
        onUpload: after((file) => uploadRegistration(org, file)),
      },
    },
  };
}

/**
 * `page`: "profile" (the default) or "completion". `editor`, on the profile,
 * opens that dialog on arrival (the completion page's buttons link to
 * /profile/edit/<editor>).
 */
export default function LiveBrandProfile({ org, page = "profile", editor = null }) {
  const { navigate } = useRouter();
  const { parts, error, reload } = useBrandProfile(org);

  if (!parts) return <Waiting error={error} />;

  if (page === "completion") {
    const view = brandCompletionView(parts);
    // The prototype mounts this page inside its "profile-completion-shell",
    // which is what sets its margins.
    return (
      <main className="profile-completion-shell">
      <BrandProfileCompletionPage
        onBack={() => navigate("/profile")}
        live={{
          ...view,
          checks: view.checks.map((check) => ({
            ...check,
            // A button only where the dialog that fixes it is live.
            action: check.action && BRAND_EDITORS.includes(check.action.editor)
              ? { label: check.action.label, onClick: () => navigate(`/profile/edit/${check.action.editor}`) }
              : null,
          })),
        }}
      />
      </main>
    );
  }

  return (
    <main className="factory-profile-page brand-profile-page">
      <BrandProfileScreen
        // A fresh page per dialog link, so following one from the completion
        // page opens it even if the profile was already showing.
        key={editor ?? "profile"}
        onViewCompletion={() => navigate("/profile/completion")}
        live={{
          ...brandProfileView(parts),
          editors: BRAND_EDITORS,
          initialEditor: BRAND_EDITORS.includes(editor) ? editor : null,
          // Leave a dialog's own address once it closes, so a refresh shows
          // the profile rather than reopening it.
          onEditorClosed: () => editor && navigate("/profile", { replace: true }),
          dialog: {
            form: brandProfileEditForm(parts),
            options: brandProfileEditOptions(parts.terms),
            onSave: async (section, form) => {
              await saveBrandProfileSection(org, section, form, parts);
              await reload();
            },
            ...dialogParts(org, parts, reload),
          },
        }}
      />
    </main>
  );
}
