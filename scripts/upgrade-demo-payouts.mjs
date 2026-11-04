/** Disposable LOCAL demos + Stripe TEST mode only. Explicit --complete required.
 * Creates verified replacement accounts, pays out old fake funds, then seeds
 * replacement fake funds. Never uses live keys or a remote database.
 */
import {loadEnv} from 'vite';
import {createClient} from '@supabase/supabase-js';
import Stripe from 'stripe';
import {DEMO_LOGINS} from '../src/shared/demo-logins.mjs';
import {beginConnectUpgrade,connectUpgrade,finishConnectUpgrade} from '../api/_stripe-connect-upgrade.js';
import {MANAGED_CONTROLLER,managedByTsc} from '../api/_stripe-payouts.js';
import {saveConnectAccount} from '../api/_stripe.js';
const env={...loadEnv('development',process.cwd(),''),...process.env};
const url=env.VITE_SUPABASE_URL;
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname))throw Error('Local database only');
if(!env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))throw Error('Stripe test key required');
if(!process.argv.includes('--complete'))throw Error('Explicit --complete required');
const stripe=new Stripe(env.STRIPE_SECRET_KEY);
const db=createClient(url,env.SUPABASE_SERVICE_ROLE_KEY);
function checked({data,error}){if(error)throw Error(error.message);return data;}
// Stripe settles platform charges in the platform's currency. Use that
// balance transaction's currency for its transfer, allowing Stripe to convert
// to the factory's own settlement currency.
async function seedFunds(id, currency, funds) {
 const charge=await stripe.charges.create({amount:funds,currency,source:'tok_bypassPending',description:'Local demo upgrade test funds'},
  {idempotencyKey:`demo-upgrade-charge-${id}`});
 const settlement=typeof charge.balance_transaction==='string'
  ? await stripe.balanceTransactions.retrieve(charge.balance_transaction) : charge.balance_transaction;
 if(!settlement)throw Error('Charge settlement is not available yet; rerun later');
 await stripe.transfers.create({amount:settlement.net,currency:settlement.currency,destination:id,source_transaction:charge.id},
  {idempotencyKey:`demo-upgrade-funds-v2-${id}`});
}
const emails=new Set(Object.values(DEMO_LOGINS).filter(x=>/factory|trading/i.test(x.role)).map(x=>x.email));
const users=[];
for(let page=1;;page++){const b=checked(await db.auth.admin.listUsers({page,perPage:1000}));users.push(...b.users);if(b.users.length<1000)break;}
const demoUsers=users.filter(x=>emails.has(x.email));
if(!demoUsers.length)throw Error('No demo users in this database');
const members=checked(await db.from('org_members').select('org_id,user_id').in('user_id',demoUsers.map(x=>x.id)));
const orgs=checked(await db.from('orgs').select('id,name,type,factory_profiles(country_code)').in('id',[...new Set(members.map(x=>x.org_id))]));
for(const org of orgs.filter(x=>x.type!=='brand')){
 let row=checked(await db.from('stripe_connect_accounts').select('*').eq('org_id',org.id).maybeSingle());
 if(!row){
  const country=org.factory_profiles?.country_code;
  if(!['PT','GB','US'].includes(country)){console.log(`${org.name}: ${country||'no country'}, bank-transfer flow retained`);continue;}
  const created=await stripe.accounts.create({country,controller:MANAGED_CONTROLLER,
    capabilities:{transfers:{requested:true},card_payments:{requested:true}},business_profile:{name:org.name},
    metadata:{org_id:org.id},settings:{payouts:{schedule:{interval:'manual'}}}},
    {idempotencyKey:`local-demo-managed-${org.id}`});
  await saveConnectAccount(db,org.id,created);
  row={stripe_account_id:created.id};
 }
 const old=await stripe.accounts.retrieve(row.stripe_account_id);
 if(old.livemode)throw Error('Refusing live account');
 if(managedByTsc(old)&&old.details_submitted&&old.payouts_enabled&&old.capabilities?.transfers==='active'){
  const completed=await connectUpgrade(db,org.id);
  if(completed?.completed_at) {
   const payouts=await stripe.payouts.list({limit:100},{stripeAccount:completed.old_account_id});
   const paid=payouts.data.find(p=>p.created>=Math.floor(Date.parse(completed.started_at)/1000));
   await seedFunds(old.id,paid?.currency||old.default_currency,paid?.amount||10000);
  }
  console.log(`${org.name}: TSC-managed, verification and test funding complete`);continue;
 }
 if(!['PT','GB','US'].includes(old.country))throw Error(`Missing test fixture for ${old.country}`);
 const email=demoUsers.find(u=>members.some(m=>m.org_id===org.id&&m.user_id===u.id))?.email;
 const migration=managedByTsc(old)?{new_account_id:old.id}:await beginConnectUpgrade({stripe,db,org,current:old,email});
 const id=migration.new_account_id;
 const f=old.country==='PT'?{currency:'eur',bank:{account_number:'PT50000201231234567890154'},city:'Lisboa',postal:'1000-001',phone:'+351212345678'}:
 old.country==='GB'?{currency:'gbp',bank:{account_number:'00012345',routing_number:'108800'},city:'London',postal:'SW1A 1AA',phone:'+447400123456'}:
 {currency:'usd',bank:{account_number:'000123456789',routing_number:'110000000'},city:'New York',postal:'10001',phone:'+12025550123'};
 const current=await stripe.accounts.retrieve(id);
 if(!current.details_submitted)await stripe.accounts.update(id,{
  business_type:'individual',business_profile:{mcc:'5137',url:'https://accessible.stripe.com',product_description:'Test apparel factory'},
  individual:{first_name:'Demo',last_name:'Factory',email,phone:f.phone,dob:{day:1,month:1,year:1901},
   address:{line1:'address_full_match',city:f.city,postal_code:f.postal,country:old.country,...(old.country==='US'?{state:'NY'}:{})},
   ...(old.country==='US'?{ssn_last_4:'0000'}:{id_number:'000000000'})},
  tos_acceptance:{date:Math.floor(Date.now()/1000),ip:'127.0.0.1'},
  external_account:{object:'bank_account',country:old.country,currency:f.currency,...f.bank,account_holder_name:'Demo Factory',account_holder_type:'individual'},
 });
 const initial=await stripe.balance.retrieve({},{stripeAccount:old.id});
 for(const b of (managedByTsc(old)?[]:initial.available.filter(x=>x.amount>0))){
  await stripe.payouts.create({amount:b.amount,currency:b.currency},{stripeAccount:old.id,idempotencyKey:`demo-upgrade-withdraw-${id}-${b.currency}-${b.amount}`});
  console.log(`${org.name}: settling ${b.amount} ${b.currency} test funds`);
 }
 let finished=false;
 for(let attempt=0;attempt<60;attempt++){
  const candidate=await stripe.accounts.retrieve(id);
  const ready=managedByTsc(old)
    ? candidate.payouts_enabled&&candidate.capabilities?.transfers==='active'
    : await finishConnectUpgrade({stripe,db,orgId:org.id,upgrade:await connectUpgrade(db,org.id)});
  if(ready){finished=true;break;}
  if(attempt%5===0)console.log(`${org.name}: waiting for test verification and settlement`);
  await new Promise(r=>setTimeout(r,3000));
 }
 if(!finished)throw Error(`${org.name}: not ready; safe to rerun after settlement`);
 const replacement=await stripe.accounts.retrieve(id);await saveConnectAccount(db,org.id,replacement);
 const funds=initial.available.find(x=>x.currency===f.currency)?.amount||10000;
 await seedFunds(id,f.currency,funds);
 console.log(`${org.name}: upgraded, verified, ${old.country}, test funds seeded`);
}
