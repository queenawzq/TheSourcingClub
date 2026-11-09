import React from "react";

export default function AdminAccessDenied({ onUseAnotherAccount }) {
  return <div className="admin-login-access-denied">
    <img className="admin-login-denied-icon" src="/assets/prototype-icons/warning.svg" alt="" />
    <h3>This account does not have staff access</h3>
    <p>Ask an existing administrator to add this email to the platform staff list.</p>
    <button className="primary-btn" type="button" onClick={onUseAnotherAccount}>Use another account</button>
  </div>;
}
