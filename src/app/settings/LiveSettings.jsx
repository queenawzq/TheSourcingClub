/**
 * Settings, on Queena's designed screen.
 *
 * `SettingsScreen` is imported from src/prototype/main.jsx and mounted here.
 * This file is the seam: it supplies the real team and turns the invite panel
 * and the remove control into the calls that back them.
 *
 * The design's other sections — password, payment method, notification
 * preferences — are drawn against nothing and are left exactly as drawn.
 * Wiring them would mean inventing tables; removing them would mean editing
 * the design. Neither is this file's job.
 */
import React, { useCallback, useEffect, useState } from "react";
import { SettingsScreen } from "../../prototype/main.jsx";
import { inviteMember, listMembers } from "../../lib/domain/org.js";

export default function LiveSettings({ org, isFactory }) {
  const [members, setMembers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      setMembers(await listMembers(org.id));
    } catch (failure) {
      setError(failure);
    }
  }, [org.id]);

  useEffect(() => { reload(); }, [reload]);

  async function invite(email) {
    setBusy(true);
    setError(null);
    try {
      await inviteMember(org.id, email);
      await reload();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The designed team rows.
   *
   * `permissions` is an empty list on purpose. The design offers per-member
   * permission toggles and the schema has two roles, owner and member — there
   * is nothing to map them onto, and a toggle that silently does nothing is
   * worse than one that is off.
   */
  const team = (members ?? []).map((member) => ({
    name: member.user_profiles?.full_name ?? member.user_profiles?.email ?? "Member",
    email: member.user_profiles?.email ?? "",
    role: member.role === "owner" ? "Owner" : "Member",
    permissions: [],
  }));

  if (!members) return null;

  return (
    <SettingsScreen
      accountType={isFactory ? "factory" : "brand"}
      team={team}
      onInvite={invite}
      busy={busy}
      error={error}
    />
  );
}
