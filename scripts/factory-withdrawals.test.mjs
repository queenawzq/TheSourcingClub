import test from 'node:test';
import assert from 'node:assert/strict';
import { PayoutFailure } from '../api/_payout-provider.js';
import { processWithdrawal } from '../api/_factory-withdrawals.js';

function fixture(provider) {
  const calls = [];
  const w = { id: 'request_fake', org_id: 'factory_fake', provider, status:'requested',amount_cents:100,
    currency:'USD',stripe_method_id:'ba_selected',account_id:'selected_account',details_changed_at:'2026-11-01T00:00:00Z',cny_confirmed:false };
  let state = 'confirmed';
  const db = {
    from(table) {
      const q = { select(){return q;}, eq(){return q;}, in(){return q;},
        update(patch){calls.push(['update',table,patch]); if(table==='factory_withdrawals') Object.assign(w,patch); return q;},
        async single(){return { data: table==='factory_withdrawals' ? w : table==='factory_payout_accounts' ? {wise_currency:'USD'} : table==='stripe_connect_accounts' ? {stripe_account_id:'acct_factory'} : {state,stripe_charge_id:'ch_fake',amount_cents:100} };},
        then(resolve) {resolve({data:table==='factory_withdrawal_items' ? [{payment_id:'payment_fake'}] : table==='order_payments' ? [{state}] : []});},
      };return q;
    },
    async rpc(name,args) {
      calls.push([name,args]);
      if(name==='claim_provider_payout') return {data:{payout_id:'payout_fake',key:'stable_provider_key',paypal_email:'selected@example.com',amount_cents:100,currency:'USD',order_number:'TEST-1',wise_recipient_id:'recipient_fake'}};
      if(name==='finish_provider_payout' && args.outcome==='paid') state='released';
      return {data:true};
    },
  };
  const stripe = {charges:{retrieve:async()=>({amount_refunded:0})},payouts:{create:async()=>assert.fail('PayPal/Wise choice must never create a Stripe payout')},transfers:{create:async()=>assert.fail('PayPal/Wise choice must never transfer to Stripe')}};
  return {db,stripe,calls,withdrawalId:w.id,w,setState(value){state=value;}};
}

test('PayPal sends to selected email via the claimed request, never Stripe',async()=>{
 const f=fixture('paypal');let paid;
 const paypal={pay:async args=>{paid=args;return {batchId:'batch_fake'};},status:async()=>({state:'paid',raw:'SUCCESS'})};
 assert.equal((await processWithdrawal({...f,paypal})).status,'paid');
 assert.equal(paid.email,'selected@example.com');assert.equal(paid.amountCents,100);assert.equal(paid.key,'stable_provider_key');
 assert.equal(f.calls.find(c=>c[0]==='claim_provider_payout')[1].which,'paypal');
 // Persisted completion stops another provider call even with a new HTTP retry.
 assert.equal((await processWithdrawal({...f,paypal:{pay:()=>assert.fail('already paid')}})).status,'paid');
});
test('PayPal timeout stays on PayPal, never falls back or reports completed',async()=>{
 const f=fixture('paypal');
 await assert.rejects(processWithdrawal({...f,paypal:{pay:async()=>{throw new PayoutFailure('timeout','timeout',{unsure:true});}}}),/timeout/);
 assert.notEqual(f.w.status,'paid');
});
test('Wise shortage does not use Stripe or mark money paid',async()=>{
 const f=fixture('wise');
 await assert.rejects(processWithdrawal({...f,wise:{balance:async()=>({cents:0})}}),/Wise cannot fund/);
 assert.notEqual(f.w.status,'paid');
});
test('provider unavailability fails closed to the persisted provider',async()=>{
 for(const provider of ['wise','paypal']) {const f=fixture(provider);await assert.rejects(processWithdrawal(f),/unavailable/);assert.notEqual(f.w.status,'paid');}
});
test('refunds stop provider payouts',async()=>{
 const f=fixture('paypal');f.stripe.charges.retrieve=async()=>({amount_refunded:1});
 await assert.rejects(processWithdrawal({...f,paypal:{pay:()=>assert.fail('refunded funds')}}),/needs review/);
});

function bankFixture() {
 const f=fixture('stripe'); f.setState('released');
 f.stripe.accounts={retrieveExternalAccount:async(account,id)=>{assert.equal(account,'acct_factory');assert.equal(id,'ba_selected');return {object:'bank_account',currency:'usd'};},update:async()=>{}};
 f.stripe.balance={retrieve:async()=>({available:[{amount:100,currency:'usd'}]})};
 f.stripe.payouts={list:async function*(){},create:async(body)=>{assert.equal(body.destination,'ba_selected');assert.equal(body.metadata.factory_withdrawal_id,'request_fake');return {id:'po_fake',status:'paid',amount:100,currency:'usd',destination:'ba_selected'};}};
 // A production request id is UUID-validated by the database and withdrawal helper.
 f.w.id='b1f9fd8c-76bd-43a7-ad48-502ebed382b3';f.withdrawalId=f.w.id;
 return f;
}
test('Stripe withdrawal uses the request destination after transfers finish',async()=>{
 const f=bankFixture();f.stripe.payouts.create=async body=>{assert.equal(body.destination,'ba_selected');assert.equal(body.amount,100);assert.equal(body.metadata.factory_withdrawal_id,f.w.id);return {id:'po_fake',status:'paid',amount:100,currency:'usd',destination:'ba_selected'};};
 assert.equal((await processWithdrawal(f)).status,'paid');assert.equal(f.w.stripe_payout_id,'po_fake');
});
test('Stripe lost response is reconciled by persistent metadata, never paid twice',async()=>{
 const f=bankFixture();f.stripe.payouts.list=async function*(){yield {id:'po_existing',status:'paid',amount:100,currency:'usd',destination:'ba_selected',metadata:{factory_withdrawal_id:f.w.id}};};
 f.stripe.payouts.create=()=>assert.fail('existing payout must be reused');
 assert.equal((await processWithdrawal(f)).status,'paid');assert.equal(f.w.stripe_payout_id,'po_existing');
});
test('Stripe clearing waits on the selected bank request instead of another provider',async()=>{
 const f=bankFixture();f.stripe.balance.retrieve=async()=>({available:[]});f.stripe.payouts.create=()=>assert.fail('funds unavailable');
 assert.equal((await processWithdrawal(f)).status,'processing');assert.notEqual(f.w.status,'paid');
});

test('Wise funds only the selected Wise recipient and records provider completion',async()=>{
 const f=fixture('wise');let funded=false,created;
 const wise={transferUrl:()=> 'https://example.com/local-mock',balance:async()=>({cents:1000}),quote:async()=>({id:'quote_fake',feeCents:1,arrivesCents:99,arrivesCurrency:'USD'}),
 createTransfer:async args=>{created=args;return {id:'transfer_fake',status:'incoming_payment_waiting'};},
 status:async()=>funded ? {state:'paid',raw:'outgoing_payment_sent'} : {raw:'incoming_payment_waiting'},
 fund:async()=>{funded=true;return {funded:true};}};
 assert.equal((await processWithdrawal({...f,wise})).status,'paid');
 assert.equal(created.recipientId,'recipient_fake');assert.equal(created.key,'stable_provider_key');assert.equal(funded,true);
 assert.equal(f.calls.find(c=>c[0]==='claim_provider_payout')[1].which,'wise');
});
