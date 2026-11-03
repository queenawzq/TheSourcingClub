import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeReadiness, finishConnectUpgrade, beginConnectUpgrade } from '../api/_stripe-connect-upgrade.js';
import { MANAGED_CONTROLLER } from '../api/_stripe-payouts.js';
const upgrade = { old_account_id: 'acct_old', new_account_id: 'acct_new' };
function mock({ amount=0, pending=0, reserved=0, payouts=[], verified=true }={}) {
  return {
    accounts: { retrieve: async () => ({ id:'acct_new', country:'PT', controller:MANAGED_CONTROLLER,
      details_submitted:verified, payouts_enabled:verified, capabilities:{transfers:verified?'active':'pending'}, requirements:{currently_due:[]} }) },
    balance: { retrieve:async () => ({available:[{amount}], pending:[{amount:pending}], connect_reserved:[{amount:reserved}]}) },
    payouts: { list:async function* () { yield* payouts; } },
  };
}
test('old balances, pending funds, negative balances and reserves block cutover',async()=>{
  for(const input of [{amount:100},{pending:100},{amount:-100},{reserved:100}]) {
    const ready=await upgradeReadiness(mock(input),upgrade);
    assert.equal(ready.unsettled,true);
    assert.equal(await finishConnectUpgrade({stripe:mock(input),upgrade,db:{rpc:()=>assert.fail('must not switch')},orgId:'org'}),false);
  }
});
test('checks payouts beyond the first page and blocks pending and in-transit payouts',async()=>{
  for(const status of ['pending','in_transit']) {
    const payouts=[...Array.from({length:101},()=>({status:'paid'})),{status}];
    assert.equal((await upgradeReadiness(mock({payouts}),upgrade)).unsettled,true);
  }
});
test('incomplete verification never switches even with a zero old balance',async()=>{
  assert.equal(await finishConnectUpgrade({stripe:mock({verified:false}),upgrade,db:{rpc:()=>assert.fail()},orgId:'org'}),false);
});
test('verified replacement and settled old account switch using the service RPC',async()=>{
  const calls=[];
  assert.equal(await finishConnectUpgrade({stripe:mock(),upgrade,orgId:'org',db:{rpc:async(...args)=>{calls.push(args);return{error:null};}}}),true);
  assert.equal(calls[0][0],'finish_connect_upgrade');
  assert.equal(calls[0][1].replacement,'acct_new');
});
test('completed upgrades do not query or mutate Stripe',async()=>{
  assert.equal(await upgradeReadiness({}, {...upgrade,completed_at:'now'}),null);
});
test('already-managed accounts never create a replacement',async()=>{
  assert.equal(await beginConnectUpgrade({current:{controller:MANAGED_CONTROLLER}}),null);
});

test('creation failure resumes earnings releases and retains the retry operation', async () => {
  const calls=[];
  const db={rpc:async(...args)=>{calls.push(args);return {error:null};},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{old_account_id:'acct_old',started_at:'attempt'}})})})})};
  const stripe={accounts:{create:async()=>{throw Error('connection lost');}}};
  await assert.rejects(beginConnectUpgrade({stripe,db,org:{id:'org'},current:{id:'acct_old',country:'PT'}}),/connection lost/);
  assert.deepEqual(calls[1],['record_connect_upgrade_creation',{target_org:'org',attempt:'attempt',replacement:null}]);
});
