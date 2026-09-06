/**
 * Who else is in this organisation.
 *
 * This screen exists because `listMyInvitations()` and `acceptInvitation()`
 * have been in the domain layer since Phase 1 and nothing has ever called
 * either. Brand onboarding can send an invitation; there has been no way
 * anywhere to see one or accept it. That is the third time in this project
 * that working code has sat with nothing wired to it — the same shape as
 * setInvitations() in Phase 2 and factory_payout_accounts in Phase 3.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth.jsx";
import { acceptInvitation, inviteMember, listMembers, listMyInvitations } from "../../lib/domain/org.js";
import { useRouter } from "../../lib/router.jsx";
import "./team.css";

const ROLE_NOTE = {
  owner: "Can award quotes, approve payments and invite others.",
  member: "Can do everything except award work and move money.",
};

export default function Team({ org }) {
  const { navigate } = useRouter();
  const { user, refreshOrgs } = useAuth();
  const [members, setMembers] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);

  const load = useCallback(async () => {
    const [team, mine] = await Promise.all([
      listMembers(org.id),
      listMyInvitations().catch(() => []),
    ]);
    setMembers(team);
    setInvitations(mine);
  }, [org.id]);

  useEffect(() => { load().catch(setError); }, [load]);

  const isOwner = org.role === "owner";

  async function invite() {
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await inviteMember(org.id, email, role);
      setSent(email.trim().toLowerCase());
      setEmail("");
      await load();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (error && !members) {
    return (
      <div className="rfq-page">
        <h1>Your team</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }
  if (!members) return <div className="rfq-page"><div className="spinner" aria-hidden="true" /></div>;

  return (
    <div className="rfq-page">
      <button type="button" className="quiet-btn" onClick={() => navigate("/")}>← Back</button>

      <header className="rfq-page-head">
        <div>
          <h1>Your team</h1>
          <p>Everyone here acts as {org.name}, and what they do is recorded against their own name.</p>
        </div>
      </header>

      {error ? <p className="ob-error">{error.message}</p> : null}

      {invitations.length ? (
        <section className="detail-card team-invites">
          <h2>You have been invited</h2>
          <p className="ob-hint">
            Accepting adds you to that organisation. You can belong to more than one, and switch
            between them.
          </p>
          <ul className="team-list">
            {invitations.map((invitation) => (
              <li key={invitation.id} data-testid="pending-invitation">
                <div>
                  <strong>{invitation.orgs?.name}</strong>
                  <span className="team-sub">{invitation.orgs?.type} · as {invitation.role}</span>
                </div>
                <button
                  type="button"
                  className="primary-btn"
                  data-testid="accept-invitation"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await acceptInvitation(invitation.id);
                      await refreshOrgs();
                      await load();
                    } catch (failure) {
                      setError(failure);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Accept
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="detail-card">
        <h2>In {org.name} ({members.length})</h2>
        <ul className="team-list">
          {members.map((member) => (
            <li key={member.user_profiles?.id ?? member.created_at} data-testid="team-member">
              <div>
                <strong>
                  {member.user_profiles?.full_name ?? member.user_profiles?.email ?? "Someone"}
                  {member.user_profiles?.id === user?.id ? " (you)" : ""}
                </strong>
                <span className="team-sub">
                  {member.user_profiles?.email} · {member.role}
                </span>
                <span className="team-sub">{ROLE_NOTE[member.role]}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="detail-card">
        <h2>Invite someone</h2>
        {isOwner ? (
          <>
            <p className="ob-hint">
              They get an invitation the next time they sign in. Nothing is sent by email yet, so
              tell them to expect it.
            </p>
            <label className="ob-label" htmlFor="invite-email">Their email address</label>
            <input id="invite-email" data-field="invite_email" type="email" value={email}
                   placeholder="them@theircompany.com"
                   onChange={(event) => setEmail(event.target.value)} />

            <label className="ob-label" htmlFor="invite-role">What they can do</label>
            <select id="invite-role" data-field="invite_role" value={role}
                    onChange={(event) => setRole(event.target.value)}>
              <option value="member">Member — {ROLE_NOTE.member}</option>
              <option value="owner">Owner — {ROLE_NOTE.owner}</option>
            </select>

            <div className="order-actions">
              <button type="button" className="primary-btn" data-testid="send-invite"
                      disabled={busy || !email.includes("@")} onClick={invite}>
                {busy ? "Inviting…" : "Send invitation"}
              </button>
              {sent ? <span className="ob-hint">Invited {sent}.</span> : null}
            </div>
          </>
        ) : (
          <p className="ob-hint">Only an owner can invite people to this organisation.</p>
        )}
      </section>
    </div>
  );
}
