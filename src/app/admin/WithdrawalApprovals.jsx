import React, { useCallback, useEffect, useState } from 'react';
import { adminWithdrawal } from '../../lib/domain/stripe.js';
import { formatMoney } from '../../lib/money.js';

const providerName = provider => ({paypal:'PayPal',wise:'Wise',stripe:'Stripe'}[provider] ?? provider);
const money = amount => formatMoney(Number(amount), 'USD');

function ApprovalRow({ request, onChanged }) {
  const [fee,setFee]=useState('');
  const [funding,setFunding]=useState(null);
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  const [notice,setNotice]=useState(null);
  const name=providerName(request.provider);
  const approved=Boolean(request.approved_at || request.approval_grandfathered);
  const destination=request.destination;
  const label=destination?.method==='paypal' ? destination.paypal_email
    : destination ? `${destination.bank_name || 'Bank account'} ····${destination.account_number_last4 || ''}` : 'Linked Stripe bank account';
  const validFee=request.provider!=='paypal' || /^\d+(?:\.\d{1,2})?$/.test(fee);
  const feeCents=request.provider==='paypal' && validFee ? Math.round(Number(fee)*100) : 0;
  const ready=funding?.ready===true && validFee;

  async function run(action) {
    setBusy(true);setError(null);setNotice(null);
    try {
      const result=await adminWithdrawal(action,{requestId:request.id,feeAllowanceCents:feeCents,confirmed});
      if(action==='preview') {setFunding(result);setConfirmed(false);}
      else {setNotice(result.status==='paid'?'Withdrawal completed.':result.message || 'Approved. The selected provider is processing this withdrawal.');await onChanged();}
    } catch(failure) {setError(failure.message);setFunding(null);setConfirmed(false);}
    finally {setBusy(false);}
  }
  return <tr>
    <td><strong>{request.orgs?.name || 'Factory'}</strong><span className="admin-sub">{approved?'Approved · processing':'Awaiting approval'}</span></td>
    <td><strong>{name}</strong><span className="admin-sub">{label}</span></td>
    <td>{money(request.amount_cents)}</td>
    <td className="admin-withdrawal-review">
      {approved ? <button className="quiet-btn" type="button" disabled={busy} onClick={()=>run('resume')}>{busy?'Checking…':'Check status'}</button> : <>
        {request.provider==='paypal' ? <label className="admin-sub">Total PayPal fee allowance (USD)
          <input aria-label={`PayPal fee allowance for ${request.orgs?.name || 'factory'}`} type="number" min="0" step="0.01" value={fee} disabled={busy}
            onChange={event=>{setFee(event.target.value);setFunding(null);setConfirmed(false);}} />
          <span>Allow for all PayPal payout fees for this request.</span>
        </label> : null}
        <button className="quiet-btn" type="button" disabled={busy || !validFee} onClick={()=>run('preview')}>{busy?'Checking…':funding?'Check funding again':'Check funding'}</button>
        {funding ? <div className="admin-sub" role="status">
          <span>{name} available: {money(funding.availableCents)}. Required: {money(funding.requiredCents)}.</span>
          {funding.reservedCents>0 ? <span> Reserved for other approvals: {money(funding.reservedCents)}.</span> : null}
          {request.provider==='paypal' ? <span> PayPal balance reported {new Date(funding.balanceAsOf).toLocaleString()}. Reports can lag by up to three hours.</span> : null}
        </div> : null}
        {!ready ? <p className="admin-error" role="status">{funding ? `Please fund ${name} before doing the transfer. Short by ${money(funding.shortByCents)}.` : 'Check available funding before approving.'}</p> : null}
        <label className="admin-check"><input type="checkbox" checked={confirmed} disabled={busy || !ready}
          onChange={event=>setConfirmed(event.target.checked)} /><span>I checked the destination and confirm sufficient funds{request.provider==='paypal'?' including PayPal fees':''}. Approve and send will send real money on the live site.</span></label>
        <button className="admin-approve" type="button" disabled={busy || !ready || !confirmed} onClick={()=>run('approve')}>{busy?'Checking and sending…':'Approve and send'}</button>
      </>}
      {error ? <p className="admin-error" role="alert">{error}</p> : null}
      {notice ? <p className="admin-sub" role="status">{notice}</p> : null}
    </td>
  </tr>;
}

export default function WithdrawalApprovals({ onChanged }) {
  const [requests,setRequests]=useState(null);
  const [error,setError]=useState(null);
  const load=useCallback(async()=>{
    try {setRequests((await adminWithdrawal('list')).requests);setError(null);}
    catch(failure){setError(failure.message);}
  },[]);
  useEffect(()=>{load();const timer=setInterval(load,30000);return()=>clearInterval(timer);},[load]);
  const reload=async()=>{await load();await onChanged?.();};
  return <section className="admin-withdrawal-approvals" aria-label="Withdrawal approvals">
    <h2>Withdrawal approvals</h2>
    {import.meta.env.DEV && import.meta.env.VITE_PAYOUT_DEMO==='1' ? <p className="admin-sub" role="status">Local mock payment providers · no real money moves.</p> : null}
    <p className="admin-sub">Factories requested these destinations. Check funding, then approve sending. Requests never send automatically before approval.</p>
    {error ? <p className="admin-error" role="alert">{error}</p> : null}
    {requests?.length ? <>
      <p className="admin-sub">{['paypal','wise','stripe'].map(provider=>{
        const rows=requests.filter(r=>r.provider===provider && !r.approved_at && !r.approval_grandfathered);
        return `${providerName(provider)} awaiting approval: ${money(rows.reduce((sum,r)=>sum+Number(r.amount_cents),0))}${provider==='paypal'?' plus fees':''}`;
      }).join(' · ')}</p>
      <div className="admin-scroll"><table><thead><tr><th>Factory</th><th>Destination</th><th>Requested</th><th>Funding and approval</th></tr></thead>
        <tbody>{requests.map(request=><ApprovalRow key={request.id} request={request} onChanged={reload}/>)}</tbody></table></div>
    </> : <p className="admin-sub">{requests?'No withdrawal requests awaiting approval.':'Loading withdrawal requests…'}</p>}
  </section>;
}
