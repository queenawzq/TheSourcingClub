import test from 'node:test';
import assert from 'node:assert/strict';
import { payoutUsdMinor, payoutUsdTotal } from '../src/lib/payout-display.mjs';
import { payoutDisplayRates } from '../api/_payout-display-rates.js';
const fx={rates:{EUR:1.1,GBP:1.3,JPY:0.007}};
test('converts native minor units to estimated USD cents without mutating money',()=>{
 const rows=[{amount:10000,currency:'EUR'},{amount:5000,currency:'USD'}];
 assert.equal(payoutUsdTotal(rows,fx),16000);
 assert.deepEqual(rows,[{amount:10000,currency:'EUR'},{amount:5000,currency:'USD'}]);
 assert.equal(payoutUsdMinor(1000,'JPY',fx),700);
 assert.equal(payoutUsdMinor(-10000,'GBP',fx),-13000);
});
test('does not guess unavailable rates or mislabel local currency as USD',()=>{
 assert.equal(payoutUsdMinor(1234,'EUR',null),null);
 assert.equal(payoutUsdTotal([{amount:500,currency:'USD'},{amount:100,currency:'EUR'}],null),null);
 assert.equal(payoutUsdMinor(1234,'USD',null),1234);
});
test('USD reference failure is isolated from balances and withdrawals',async()=>{
 assert.equal(await payoutDisplayRates(async()=>{throw Error('offline');}),null);
 assert.equal(await payoutDisplayRates(async()=>({ok:false})),null);
});
test('rejects old reference rates and converts USD-base quotes in the correct direction',async()=>{
 const expired='2020-01-01';
 assert.equal(await payoutDisplayRates(async()=>({ok:true,json:async()=>[{date:expired,base:'USD',quote:'EUR',rate:0.9}]})),null);
 const date=new Date().toISOString().slice(0,10);
 const result=await payoutDisplayRates(async()=>({ok:true,json:async()=>[{date,base:'USD',quote:'EUR',rate:0.8}]}));
 assert.equal(result.rates.EUR,1.25);
});
