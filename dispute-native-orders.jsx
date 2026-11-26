import React, {useEffect, useRef, useState} from 'react';
import {ProjectsScreen, ProjectDetailScreen} from './src/prototype/main.jsx';
import {FactoryProjectsPage, FactoryProjectProgressDetail} from './src/factory-prototype/main.jsx';
import {DataProvider} from './src/lib/data/DataProvider.jsx';
import {ORDER, STATUS, isOpen, stepOnHold, money, dayOf, outcomeLine, waitingLine, windowLine} from './dispute-preview-state.mjs';

// The production order, drawn by the real brand and factory screens. Only the
// dispute's parts change with the preview's state: the card's case line, the
// order page banner, the menu item, and the disputed step. Step lines use the
// order page's own words (LiveOrderDetail statusLine / paymentStateLine).
const stages=['Fit sample','PP sample','Bulk deposit','Bulk production','QC photos','Final balance'];
const base={id:'preview-order',title:ORDER.title,orderNumber:ORDER.number,factory:ORDER.factory,brand:ORDER.brand,initials:'FS',location:ORDER.factoryCity,started:'Started Nov 4',createdAt:'2026-11-04',state:'in_progress',status:'In production',statusTone:'ready',currentStep:ORDER.step,description:'300 organic cotton poplin shirts in white and pale blue. Fit and pre-production samples approved. Bulk production is underway for the agreed Dec 8 ship date.',progress:4,steps:stages.map((label,i)=>({label,done:i<3,current:i===3}))};
const contract={workDetails:[['Style',ORDER.title],['Quantity','300 pieces'],['Colours','White and pale blue']],acceptedQuote:[['Unit price','$17.30'],['Production subtotal','$5,190.00'],['Samples','$260.00'],['Shipping','$285.00'],['Order total',money(ORDER.totalCents)]],paymentTerms:[['Payment split','30% deposit · 70% before shipment'],['Shipping / incoterms','DAP · London, UK'],['Target ship date','Dec 8, 2026']],attachments:[]};

/** The disputed step, in the order page's own words. */
function disputedStep(world, factory) {
  const s=world.step, hold=stepOnHold(world), caseOpen=isOpen(world.case);
  const refunded=s.refundedCents?`${money(s.refundedCents)} refunded`:null;
  const due=s.state==='rework'?`Rework due ${dayOf(s.due)}`:`due ${dayOf(s.due)}`;
  const base={id:'preview-3',title:ORDER.step,amount:money(ORDER.stepCents),releaseAmount:money(s.heldCents),active:true,current:true,canRemind:false,showUpdateAction:false,canComment:true,stepKind:'approval_and_payment',description:'The main batch of 300 shirts is being sewn. Collar finishing and button attachment are underway.'};
  if(s.state==='approved'||s.state==='paid_out') return {...base,meta:factory?['Done','Added to your balance',refunded].filter(Boolean).join(' · '):['Done','Approved: added to the factory\'s balance',refunded].filter(Boolean).join(' · '),active:false,current:false};
  if(s.state==='refunded') return {...base,meta:'Refunded',active:false,current:false};
  if(s.state==='cancelled') return {...base,meta:'Cancelled · Refunded',active:false,current:false};
  const onHold=hold?{dueStatus:'Dispute opened',dueTone:'danger'}:{};
  if(factory){
    const word=hold?'On hold: dispute open':'Awaiting approval';
    return {...base,...onHold,meta:(s.state==='rework'?[due,word,refunded]:[word,refunded,due]).filter(Boolean).join(' · ')};
  }
  const lead=s.state==='rework'?[due,'Funded']:['Ready for your approval','Funded'];
  const meta=[...lead,refunded,hold?'On hold: dispute open':s.state==='rework'?null:due].filter(Boolean).join(' · ');
  // The step's own "Initiate dispute": while no case is open on the order (LiveOrderDetail canDispute).
  const canDispute=!caseOpen&&world.order==='active';
  return {...base,...onHold,meta,canDispute,action:'Approve',kind:'approve',tone:'primary',...(hold?{actionDisabled:true,actionDisabledReason:'On hold: dispute open'}:{})};
}

function milestonesFor(world, factory) {
  const done=(title,i,amount,paymentOnly=false)=>({id:`preview-${i}`,title,amount,meta:factory?'Done · Added to your balance':`Done · ${paymentOnly?'Funded':'Approved'}: added to the factory's balance`,description:paymentOnly?'The deposit that started bulk production.':'Approved and recorded in the order history.',active:false,current:false,canRemind:false,showUpdateAction:false,canComment:true,stepKind:paymentOnly?'payment_only':'approval_and_payment'});
  const later=(title,i,meta,amount,kind)=>({id:`preview-${i}`,title,meta,amount,description:'Starts after the step before it is complete.',active:false,current:false,canRemind:false,showUpdateAction:false,canComment:false,stepKind:kind});
  const cancelled=world.order==='cancelled';
  return [
    done('Fit sample',0,'$95.00'),
    done('PP sample',1,'$165.00'),
    done('Bulk deposit',2,'$1,701.00',true),
    disputedStep(world,factory),
    later('QC photos',4,cancelled?'Cancelled':'Upcoming',null,'progress_only'),
    later('Final balance',5,cancelled?'Cancelled':'Not due','$2,074.00','payment_only'),
  ];
}

/** The case line on the order card and the order page: status word in sync with the case page. */
export function CaseNotice({record,viewer,now,onView}) {
  if(!record) return null;
  const open=isOpen(record);
  const head=open?'Dispute opened':record.status===STATUS.withdrawn?'Dispute withdrawn':'Dispute resolved';
  const line=open?[record.status,waitingLine(record,viewer,now),windowLine(record)].filter(Boolean).join(' · ')
    :record.status===STATUS.withdrawn?STATUS.withdrawn:`${STATUS.resolved} · ${outcomeLine(record.resolution)}`;
  return <div className={`dp-order-case ${open?'':'closed'}`} data-testid="case-notice"><img className="dp-icon" src={`/assets/prototype-icons/${open?'circle-warning':'success'}.svg`} alt=""/><div><strong>{head} · {record.id}</strong><p>{line}</p></div><button className="text-link" type="button" onClick={onView}>View case</button></div>;
}

export default function NativeOrders({view,open,onOpen,onBack,world,onOpenDispute,onViewCase,onApproveStep,notify}) {
  const [tabs,setTabs]=useState([{key:'active',label:'Active orders',locked:true},{key:'closed',label:'Closed',locked:true},{key:'attention',label:'Needs attention',locked:false}]);
  const [membership,setMembership]=useState(new Map());
  const store={tabs,membership,archived:new Set(),save:async next=>{setTabs(next);return true;},toggle:(key,id)=>setMembership(old=>{const next=new Map(old),ids=new Set(next.get(key));ids.has(id)?ids.delete(id):ids.add(id);next.set(key,ids);return next;})};
  const factory=view==='factory';
  const record=world.case;
  const caseOpen=isOpen(record);
  const cancelled=world.order==='cancelled';
  const ref=useRef(null);
  // The step menu's "Initiate dispute" opens the same Open a dispute dialog
  // with the step filled in. ProjectDetailScreen has no slot for it (it opens
  // its own step dialog), so the preview takes the click before React does.
  useEffect(()=>{
    const el=ref.current;if(!el)return undefined;
    function take(e){const item=e.target.closest?.('.milestone-dispute-action');if(!item)return;e.stopPropagation();e.preventDefault();
      const stage=item.closest('[data-testid="milestone-row"]')?.querySelector('h3')?.textContent??ORDER.step;
      document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      onOpenDispute({reason:'',stage,details:'',outcome:{type:''},files:[]});}
    el.addEventListener('click',take);return()=>el.removeEventListener('click',take);
  },[onOpenDispute]);
  // One open case per order: the item stays, disabled, while one is open.
  const extra=(_,close)=><><button type="button" role="menuitem" onClick={()=>{close();notify('The order conversation would open here.');}}>Contact {factory?'brand':'factory'}</button><button type="button" role="menuitem" className="dp-dispute-action" disabled={caseOpen||cancelled} title={caseOpen?'A dispute is open':undefined} onClick={()=>{close();onOpenDispute();}}>{caseOpen?'A dispute is open':'Open a dispute'}</button></>;
  const notice=<CaseNotice record={record} viewer={view} now={world.now} onView={onViewCase}/>;
  const due=world.step.state==='rework'?world.step.due:ORDER.stepDue;
  const project={...base,status:cancelled?'Cancelled':'In production',statusTone:cancelled?'neutral':'ready',nextDue:cancelled?'—':`${dayOf(due)}, 2026`,nextDueOn:due};
  const order={...project,subtitle:`${factory?`${ORDER.brand} · ${ORDER.brandCity}`:`${ORDER.factory} · ${ORDER.factoryCity}`} · ${ORDER.number} · Started Nov 4`,total:money(ORDER.totalCents),paid:'$3,661.00',remaining:'$2,074.00',nextPayment:'$2,074.00'};
  const activity=[...(record?[`Dispute ${isOpen(record)?'opened':record.status.toLowerCase()} · ${record.id} · ${record.status}`]:[]),'Production update added · Nov 24','Bulk production funded · Nov 20','Bulk deposit paid · Nov 14','PP sample approved · Nov 13'];
  const common={order,milestones:milestonesFor(world,factory),counterparty:{initials:factory?'FS':'NL',name:factory?ORDER.brand:ORDER.factory,location:factory?ORDER.brandCity:ORDER.factoryCity},activity,files:[],contract,banner:record?notice:null,renderOrderMenu:extra,onMessage:()=>notify('The order conversation would open here.'),onApprove:async()=>onApproveStep(),onPostComment:async()=>{notify('Comment posted.');return true;},onInitiateDispute:async()=>true};
  if(open) return <div className="dp-native-order" ref={ref}>{factory?<FactoryProjectProgressDetail {...common} language="en" onBack={onBack}/>:<ProjectDetailScreen {...common} goTo={onBack} onAction={(kind)=>kind==='open'&&notify('The step page opens here.')}/>}</div>;
  const listProps={renderOrderMenu:extra,renderOrderNotice:()=>record?notice:null};
  const adapter={orders:()=>[project]};
  return <div className="dp-native-order" ref={ref}>{factory?<FactoryProjectsPage {...listProps} language="en" onViewProject={onOpen} live={{projects:[{...project,factory:ORDER.brand,location:ORDER.brandCity,initials:'FS'}],loading:false,reload:()=>{},tabStore:store,cancelStore:null}}/>:<DataProvider adapter={adapter}><div className="rfqs-page brand-projects-page"><ProjectsScreen {...listProps} live goTo={()=>{}} onViewOrder={onOpen} onReorder={()=>notify('Reorder starts a new request using this style.')} tabStore={store} cancelStore={null}/></div></DataProvider>}</div>;
}
