import React from 'react';
import {createRoot} from 'react-dom/client';
import './src/prototype/styles.css';
import './src/app/admin/admin-login.css';
import AdminAccessDenied from './src/app/admin/AdminAccessDenied.jsx';
createRoot(document.getElementById('root')).render(<main className="admin-login-page"><section className="admin-login-story"><div className="admin-login-logo"><img src="/assets/logo.svg" alt="The Sourcing Club"/></div><div className="admin-login-story-copy"><h1>Keep the marketplace moving.</h1></div></section><section className="admin-login-workspace"><div className="admin-login-card"><h2>Staff sign-in</h2><p>Use your authorized staff account to continue to the admin workspace.</p><AdminAccessDenied onUseAnotherAccount={()=>window.location.assign("/admin-login.html")}/></div></section></main>);
