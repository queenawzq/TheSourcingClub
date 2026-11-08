import { callerClient, serviceClient, stripeFrom, jsonBody, reply } from './_stripe.js';
import { paypalFrom } from './_paypal.js';
import { wiseFrom } from './_wise.js';
import { processWithdrawal } from './_factory-withdrawals.js';
import { withdrawalFunding } from './_withdrawal-funding.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') return reply(response,405,{error:'method not allowed'});
  const caller=callerClient(request);
  if (!caller) return reply(response,401,{error:'Sign in as platform staff.'});
  const staff=await caller.rpc('is_platform_admin');
  if (staff.error || staff.data!==true) return reply(response,403,{error:'Only platform staff can review withdrawals.'});
  const db=serviceClient();
  if (!db) return reply(response,503,{error:'Withdrawal review is unavailable.'});
  const {action,requestId,feeAllowanceCents,confirmed}=jsonBody(request);
  try {
    if (action==='list') {
      const rows=await db.from('factory_withdrawals').select('id,org_id,provider,account_id,stripe_method_id,amount_cents,currency,status,created_at,approved_at,approval_grandfathered,orgs(name),factory_withdrawal_approvals(fee_allowance_cents)')
        .neq('status','paid').order('created_at');
      if (rows.error) throw new Error('Could not load withdrawal requests.');
      const ids=(rows.data??[]).map(w=>w.account_id).filter(Boolean);
      const accounts=ids.length ? await db.from('factory_payout_accounts').select('id,method,bank_name,account_number_last4,paypal_email').in('id',ids) : {data:[]};
      if (accounts.error) throw new Error('Could not load withdrawal destinations.');
      return reply(response,200,{requests:rows.data.map(w=>({...w,destination:accounts.data.find(a=>a.id===w.account_id)??null}))});
    }
    const read=await db.from('factory_withdrawals').select('*').eq('id',requestId).maybeSingle();
    if (read.error || !read.data) return reply(response,404,{error:'Withdrawal not found.'});
    const w=read.data;
    const stripe=stripeFrom();
    let paypal,wise;
    try{paypal=paypalFrom();}catch{}
    try{wise=wiseFrom();}catch{}
    if(action==='preview' || action==='approve') {
      if(w.approved_at || w.approval_grandfathered) {
        if(action==='approve') return reply(response,409,{error:'Already approved. Use Check status to continue the existing withdrawal.'});
      }
      const funding=await withdrawalFunding({db,withdrawal:w,stripe,paypal,wise,feeAllowanceCents});
      if(action==='preview') return reply(response,200,funding);
      if(confirmed!==true) return reply(response,422,{error:'Confirm the destination and funding before sending.'});
      if(!funding.ready) return reply(response,422,{error:`Please fund ${w.provider==='paypal'?'PayPal':w.provider==='wise'?'Wise':'Stripe'} before doing the transfer.`,...funding});
      const auth=await caller.auth.getUser();
      if(auth.error || !auth.data?.user) return reply(response,401,{error:'Sign in again before approving.'});
      const approved=await db.rpc('approve_factory_withdrawal',{target:w.id,approver:auth.data.user.id,
        available_cents:funding.availableCents,balance_as_of:funding.balanceAsOf,fee_allowance:funding.feeAllowanceCents});
      if(approved.error) return reply(response,422,{error:approved.error.message});
      return reply(response,200,await processWithdrawal({db,stripe,paypal,wise,withdrawalId:w.id}));
    }
    if(action==='resume') return reply(response,200,await processWithdrawal({db,stripe,paypal,wise,withdrawalId:w.id}));
    return reply(response,400,{error:'Unknown review action.'});
  } catch(failure) {
    return reply(response,502,{error:failure.kind ? failure.message : failure.type ? 'The provider balance could not be checked. Nothing was approved or sent.' : failure.message});
  }
}
