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
 {...base,payment_id:'preview-6',order_number:'TSC-000532',factory_name:'Atelier Minho',state:'failed',failed_at:base.confirmed_at,release_requested_at:null},
 {...base,payment_id:'preview-9',order_number:'TSC-000535',factory_name:'Shaoxing Prints',payout_account_id:'preview-wise-2',payout_holder:'Shaoxing Prints Co Ltd',payout_bank:'ICBC',payout_country:'CN',payout_swift:'ICBKCNBJ',payout_has_number:true,payout_last4:'2468',wise_recipient_type:'chinese_local',wise_currency:'CNY'},
 {...base,payment_id:'preview-10',order_number:'TSC-000536',factory_name:'Guangzhou Leather',payout_method:'paypal',paypal_email:'gz-pay@example.com'},
 {...base,payment_id:'preview-11',order_number:'TSC-000537',factory_name:'Hangzhou Test Knit',state:'sent',sent_at:base.confirmed_at,release_requested_at:null,brand_reference:'WIRE-2207'},
 {...base,payment_id:'preview-12',order_number:'TSC-000538',factory_name:'Ningbo Loomworks',state:'released',failure_reason:'Refunded in Stripe'},
 {...base,payment_id:'preview-13',order_number:'TSC-000539',factory_name:'Atelier Minho',order_status:'cancelled',release_requested_at:null,refund_failed_at:base.confirmed_at,refund_failure:'Paid by bank transfer, not through Stripe: refund it to the brand by bank.'}
];
// Payouts underway with Wise and PayPal.
const attempts = new Map([
 ['preview-9',{payment_id:'preview-9',status:'processing',stage:'sent',provider_status:'outgoing_payment_sent',provider_ref:'50001',created_at:base.confirmed_at,updated_at:base.confirmed_at}],
 ['preview-10',{payment_id:'preview-10',status:'processing',stage:'sent',provider_status:'PENDING',paid_to:'gz-pay@example.com',created_at:base.confirmed_at,updated_at:base.confirmed_at}],
 ['preview-8',{payment_id:'preview-8',status:'failed',stage:'done',provider_status:'RETURNED',paid_to:'pay@example.com',staff_sentence:'PayPal returned this payment. Check the address with the factory, then pay again.',created_at:base.confirmed_at,updated_at:base.confirmed_at}]
]);

function Preview() { const narrow = useNarrow(); return <AdminWorkspaceShell preview><PayoutNumberProvider value={async () => ({ account_number: "DEMO 0000 0000 1234", changed_at: "2026-11-07T12:20:00Z" })}><div><PaymentsBoard rows={rows} busyId="preview-1" decide={()=>{}} load={()=>{}} narrow={narrow} attempts={attempts} wise={{balanceCents:500000,currency:'USD',appUrl:'https://wise.com'}} paypal={{appUrl:'https://www.paypal.com'}}/></div></PayoutNumberProvider></AdminWorkspaceShell>; }
createRoot(document.getElementById("root")).render(<Preview/>);
