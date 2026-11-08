import test from 'node:test';
import assert from 'node:assert/strict';
import { withdrawalFunding } from '../api/_withdrawal-funding.js';
import { paypalFrom } from '../api/_paypal.js';
const w={id:'request_fake',provider:'wise',currency:'USD',amount_cents:1000};
const db={rpc:async()=>({data:0})};
test('Wise insufficient funds disables approval, including reserved withdrawals',async()=>{
 const wise={balance:async()=>({cents:999,currency:'USD'})};
 assert.equal((await withdrawalFunding({db,withdrawal:w,wise})).ready,false);
 wise.balance=async()=>({cents:1000,currency:'USD'});
 assert.equal((await withdrawalFunding({db,withdrawal:w,wise})).ready,true);
 assert.equal((await withdrawalFunding({db:{rpc:async()=>({data:100})},withdrawal:w,wise})).shortByCents,100);
});
test('PayPal requires a fee allowance and enough available balance for fees',async()=>{
 const withdrawal={...w,provider:'paypal'};const paypal={balance:async()=>({cents:1050,currency:'USD',asOf:new Date().toISOString()})};
 await assert.rejects(withdrawalFunding({db,withdrawal,paypal}),/fee allowance/);
 const short=await withdrawalFunding({db,withdrawal,paypal,feeAllowanceCents:100});
 assert.equal(short.ready,false);assert.equal(short.requiredCents,1100);assert.equal(short.shortByCents,50);
 assert.equal((await withdrawalFunding({db,withdrawal,paypal,feeAllowanceCents:50})).ready,true);
});
test('unknown balances and failed reservation checks never enable approval',async()=>{
 await assert.rejects(withdrawalFunding({db,withdrawal:w,wise:{balance:async()=>({cents:NaN,currency:'USD'})}}),/verify/);
 await assert.rejects(withdrawalFunding({db:{rpc:async()=>({error:{}})},withdrawal:w,wise:{balance:async()=>({cents:2000,currency:'USD'})}}),/reserved/);
});
function client(answer,status=200){
 return paypalFrom({PAYPAL_API_BASE:'https://api-m.sandbox.paypal.com',PAYPAL_CLIENT_ID:'fake',PAYPAL_CLIENT_SECRET:'fake'},async url=>({
 status:url.includes('oauth2')?200:status,text:async()=>JSON.stringify(url.includes('oauth2')?{access_token:'fake'}:answer),
 }));
}
test('PayPal uses available balance, never total or withheld funds',async()=>{
 const asOf=new Date().toISOString();const paypal=client({last_refresh_time:asOf,balances:[{currency:'USD',total_balance:{value:'999.00'},available_balance:{currency_code:'USD',value:'12.34'}}]});
 assert.deepEqual(await paypal.balance('USD'),{cents:1234,currency:'USD',asOf});
});
test('PayPal permissions, missing available balance, and stale reports fail closed',async()=>{
 await assert.rejects(client({},403).balance('USD'),/permission/);
 await assert.rejects(client({last_refresh_time:new Date().toISOString(),balances:[{currency:'USD',total_balance:{value:'100.00'}}]}).balance('USD'),/usable available/);
 await assert.rejects(client({last_refresh_time:'2020-01-01T00:00:00Z',balances:[]}).balance('USD'),/too old/);
});
