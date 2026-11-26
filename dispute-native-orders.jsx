import React, {useState} from 'react';
import {ProjectsScreen, ProjectDetailScreen} from './src/prototype/main.jsx';
import {FactoryProjectsPage, FactoryProjectProgressDetail} from './src/factory-prototype/main.jsx';
import {DataProvider} from './src/lib/data/DataProvider.jsx';
import {ORDER, STATUS, isOpen, stepOnHold, money, dayOf, outcomeLine, waitingLine} from './dispute-preview-state.mjs';

// The production order, drawn by the real brand and factory screens. Only the
// dispute's parts change with the preview's state: the card's case line, the
// order page banner, the menu item, and the disputed step.
const stages=['Fit sample','PP sample','Bulk deposit','Bulk production','QC photos','Final balance'];
const base={id:'preview-order',title:ORDER.title,orderNumber:ORDER.number,factory:ORDER.factory,brand:ORDER.brand,initials:'DB',location:'Ningbo, China',started:'Started Nov 4',createdAt:'2026-11-04',state:'in_progress',status:'In production',statusTone:'ready',currentStep:ORDER.step,description:'300 organic cotton poplin shirts in white and blue. Fit and pre-production samples approved. Production is underway ahead of the agreed shipping date.',progress:4,steps:stages.map((label,i)=>({label,done:i<3,current:i===3}))};
const contract={workDetails:[['Style',ORDER.title],['Quantity','300 pieces'],['Colours','White and blue']],acceptedQuote:[['Unit price','$17.30'],['Production subtotal','$5,190.00'],['Samples','$260.00'],['Shipping','$285.00'],['Order total',money(ORDER.totalCents)]],paymentTerms:[['Payment split','30% deposit · 70% before shipment'],['Shipping / incoterms','DAP · London, UK'],['Target ship date','Dec 8, 2026']],attachments:[]};

/** The disputed step, in the order page's own words. */
function disputedStep(world, factory) {
  const s=world.step, hold=stepOnHold(world);
  const due=`due ${dayOf(s.due)}`;
  const refunded=s.refundedCents?`${money(s.refundedCents)} refunded`:null;
  const base={id:'preview-3',title:ORDER.step,amount:money(ORDER.stepCents),active:true,current:true,canRemind:false,showUpdateAction:false,canComment:false,stepKind:'approval_and_payment',description:'The main batch is being sewn. Collar finishing and button attachment are underway.'};
  if(s.state==='paid_out') return {...base,meta:['Approved','Paid out',refunded].filter(Boolean).join(' · '),active:false,current:false};
  if(s.state==='refunded') return {...base,meta:'Refunded'};
  if(s.state==='cancelled') return {...base,meta:'Cancelled',active:false,current:false};
  const meta=['Funded: held by TSC',refunded,hold?'On hold: dispute open':due].filter(Boolean).join(' · ');
  const onHold=hold?{dueStatus:'On hold',dueTone:'danger'}:{};
  if(factory) return {...base,...onHold,meta};
  return {...base,...onHold,meta,action:'Approve',kind:'approve',tone:'primary',...(hold?{actionDisabled:true,actionDisabledReason:'On hold: dispute open'}:{})};
}

function milestonesFor(world, factory) {
  const done=(title,i,meta,amount)=>({id:`preview-${i}`,title,meta,amount,description:'Approved and recorded in the order history.',active:false,current:false,canRemind:false,showUpdateAction:false,canComment:false,stepKind:'approval_and_payment'});
  const later=(title,i,meta,amount)=>({id:`preview-${i}`,title,meta,amount,description:'Starts after the preceding step is complete.',active:false,current:false,canRemind:false,showUpdateAction:false,canComment:false,stepKind:'progress_only'});
  const cancelled=world.order==='cancelled';
  return [
    done('Fit sample',0,'Approved · Nov 8 · Paid out','$95.00'),
    done('PP sample',1,'Approved · Nov 13 · Paid out','$165.00'),
    done('Bulk deposit',2,'Paid out · Nov 14','$1,701.00'),
    disputedStep(world,factory),
    later('QC photos',4,cancelled?'Cancelled':'Upcoming · Dec 5',null),
    later('Final balance',5,cancelled?'Cancelled':'Not due · After QC approval','$2,074.00'),
  ];
}

/** The case line on the order card and the order page: status word in sync with the case page. */
export function CaseNotice({record,viewer,now,onView}) {
  if(!record) return null;
  const open=isOpen(record);
  const head=open?'Dispute opened':record.status===STATUS.withdrawn?'Dispute withdrawn':'Dispute resolved';
  const line=open?[record.status,waitingLine(record,viewer,now)].filter(Boolean).join(' · ')
    :record.status===STATUS.withdrawn?STATUS.withdrawn:`${STATUS.resolved} · ${outcomeLine(record.resolution)}`;
  return <div className={`dp-order-case ${open?'':'closed'}`} data-testid="case-notice"><img className="dp-icon" src={`/assets/prototype-icons/${open?'circle-warning':'success'}.svg`} alt=""/><div><strong>{head} · {record.id}</strong><p>{line}</p></div><button className="text-link" type="button" onClick={onView}>View case</button></div>;
}

export default function NativeOrders({view,open,onOpen,onBack,world,onOpenDispute,onViewCase,notify}) {
  const [tabs,setTabs]=useState([{key:'active',label:'Active orders',locked:true},{key:'closed',label:'Closed',locked:true},{key:'attention',label:'Needs attention',locked:false}]);
  const [membership,setMembership]=useState(new Map());
  const store={tabs,membership,archived:new Set(),save:async next=>{setTabs(next);return true;},toggle:(key,id)=>setMembership(old=>{const next=new Map(old),ids=new Set(next.get(key));ids.has(id)?ids.delete(id):ids.add(id);next.set(key,ids);return next;})};
  const factory=view==='factory';
  const record=world.case;
  const caseOpen=isOpen(record);
  const cancelled=world.order==='cancelled';
  // One open case per order: the item stays, disabled, while one is open.
  const extra=(_,close)=><><button type="button" role="menuitem" onClick={()=>{close();notify('The order conversation would open here.');}}>Contact {factory?'brand':'factory'}</button><button type="button" role="menuitem" className="dp-dispute-action" disabled={caseOpen||cancelled} title={caseOpen?'A dispute is open':undefined} onClick={()=>{close();onOpenDispute();}}>{caseOpen?'A dispute is open':'Open a dispute'}</button></>;
  const notice=<CaseNotice record={record} viewer={view} now={world.now} onView={onViewCase}/>;
  const project={...base,status:cancelled?'Cancelled':'In production',statusTone:cancelled?'neutral':'ready',nextDue:cancelled?'—':`${dayOf(world.step.due)}, 2026`,nextDueOn:world.step.due};
  const held=world.step.heldCents;
  const order={...project,subtitle:`${factory?'Demo Brand · London, UK':'Ningbo Loomworks · Ningbo, China'} · ${ORDER.number} · Started Nov 4`,total:money(ORDER.totalCents),paid:'$3,661.00',remaining:'$2,074.00',nextPayment:'$2,074.00',heldByTsc:money(held)};
  const activity=[...(record?[`Dispute ${isOpen(record)?'opened':record.status.toLowerCase()} · ${record.id} · ${record.status}`]:[]),'Production update added · Nov 24','Bulk production funded · Nov 20','Bulk deposit paid · Nov 14','PP sample approved · Nov 13'];
  const common={order,milestones:milestonesFor(world,factory),counterparty:{initials:factory?'DB':'NL',name:factory?ORDER.brand:ORDER.factory,location:factory?'London, UK':'Ningbo, China'},activity,files:[],contract,banner:record?notice:null,renderOrderMenu:extra,onMessage:()=>notify('The order conversation would open here.'),onApprove:()=>notify('Approve opens the existing approval dialog.')};
  if(open) return <div className="dp-native-order">{factory?<FactoryProjectProgressDetail {...common} language="en" onBack={onBack}/>:<ProjectDetailScreen {...common} goTo={onBack} onAction={()=>notify('Approve opens the existing approval dialog.')}/>}</div>;
  const listProps={renderOrderMenu:extra,renderOrderNotice:()=>record?notice:null};
  const adapter={orders:()=>[project]};
  return <div className="dp-native-order">{factory?<FactoryProjectsPage {...listProps} language="en" onViewProject={onOpen} live={{projects:[{...project,factory:'Demo Brand',location:'London, UK'}],loading:false,reload:()=>{},tabStore:store,cancelStore:null}}/>:<DataProvider adapter={adapter}><div className="rfqs-page brand-projects-page"><ProjectsScreen {...listProps} live goTo={()=>{}} onViewOrder={onOpen} onReorder={()=>notify('Reorder starts a new request using this style.')} tabStore={store} cancelStore={null}/></div></DataProvider>}</div>;
}
