import test from 'node:test';
import assert from 'node:assert/strict';
import { payoutBankOptions } from '../api/_payout-bank-options.js';
import { addPayoutMethod } from '../api/_stripe-payouts.js';
test('uses connected-account country specs, including supported foreign banks',async()=>{
 const stripe={countrySpecs:{retrieve:async c=>{assert.equal(c,'PT');return{supported_bank_account_currencies:{eur:['PT','DE','GB'],usd:['PT','US']}};}}};
 assert.deepEqual((await payoutBankOptions(stripe,'PT')).currencies.usd,['PT','US']);
});
test('server refuses a token for an unsupported bank-country/currency combination',async()=>{
 const stripe={tokens:{retrieve:async()=>({bank_account:{country:'US',currency:'eur'}})},accounts:{retrieve:async()=>({country:'PT'}),createExternalAccount:()=>assert.fail('must not attach unsupported bank') }};
 await assert.rejects(addPayoutMethod(stripe,'acct_test',{token:'btok_example'}),/does not support/);
});
test('supported foreign USD bank keeps tokenisation and Stripe attachment',async()=>{
 let sent;
 const stripe={tokens:{retrieve:async()=>({bank_account:{country:'US',currency:'usd'}})},accounts:{retrieve:async()=>({country:'PT'}),createExternalAccount:async(...args)=>{sent=args;return{id:'ba_test'};}}};
 assert.equal((await addPayoutMethod(stripe,'acct_test',{token:'btok_example',makeDefault:true})).id,'ba_test');
 assert.equal(sent[1].external_account,'btok_example');
});
