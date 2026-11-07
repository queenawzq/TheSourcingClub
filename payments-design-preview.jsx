import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/prototype/styles.css';
import AdminWorkspaceShell from './src/app/admin/AdminWorkspaceShell.jsx';
import { PaymentsBoard, useNarrow, PayoutNumberProvider } from './src/app/admin/AdminPayments.jsx';
const base = {currency:'USD', amount_cents:6500, fee_cents:455, charged_cents:6955, brand_name:'Demo Brand', milestone_title:'Fit sample', order_status:'active', payment_method_label:'Visa ····4242', confirmed_at:'2026-11-07T12:20:00Z', release_requested_at:'2026-11-07T12:20:00Z', state:'confirmed', payout_method:'bank', contact_email:'factory@example.com'};
const rows = [
 {...base,payment_id:'preview-1',order_number:'TSC-000524',factory_name:'Ningbo Loomworks',payout_account_id:'preview-bank',payout_holder:'Ningbo Loomworks Co Ltd',payout_bank:'Ningbo Test Bank',payout_country:'CN',payout_swift:'BKCHCNBJ',payout_has_number:true,payout_last4:'1234',payout_changed_recently:true,payout_changed_at:'2026-11-07T12:20:00Z'},
 {...base,payment_id:'preview-2',order_number:'TSC-000526',factory_name:'Kowloon Sourcing Partners',payout_method:'payoneer',payoneer_email:'payouts@example.com'},
 {...base,payment_id:'preview-3',order_number:'TSC-000529',factory_name:'Hangzhou Test Knit'},
 {...base,payment_id:'preview-7',order_number:'TSC-000533',factory_name:'Suzhou Silk Works',payout_account_id:'preview-wise',payout_holder:'Suzhou Silk Works Co Ltd',payout_bank:'Bank of China',payout_country:'CN',payout_swift:'BKCHCNBJ',payout_has_number:true,payout_last4:'5678',wise_recipient_type:'chinese_local',wise_currency:'CNY'},
 {...base,payment_id:'preview-8',order_number:'TSC-000534',factory_name:'Dongguan Denim',payout_method:'paypal',paypal_email:'pay@example.com'},
 {...base,payment_id:'preview-4',order_number:'TSC-000530',factory_name:'Atelier Minho',release_requested_at:null},
 {...base,payment_id:'preview-5',order_number:'TSC-000531',factory_name:'Ningbo Loomworks',state:'processing',processing_at:base.confirmed_at,release_requested_at:null},
 {...base,payment_id:'preview-6',order_number:'TSC-000532',factory_name:'Atelier Minho',state:'failed',failed_at:base.confirmed_at,release_requested_at:null}
];
function Preview() { const narrow = useNarrow(); return <AdminWorkspaceShell preview><PayoutNumberProvider value={async () => ({ account_number: "DEMO 0000 0000 1234", changed_at: "2026-11-07T12:20:00Z" })}><div><PaymentsBoard rows={rows} busyId="preview-1" decide={()=>{}} load={()=>{}} narrow={narrow}/></div></PayoutNumberProvider></AdminWorkspaceShell>; }
createRoot(document.getElementById("root")).render(<Preview/>);
