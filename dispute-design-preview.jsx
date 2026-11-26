import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PrototypeSideNav} from './src/shared/ProfileShell.jsx';
import {ActivityDrawer} from './src/prototype/main.jsx';
import {nav as factoryNav} from './src/factory-prototype/main.jsx';
import NativeOrders from './dispute-native-orders.jsx';
import {notificationEmail} from './scripts/generate-notification-email.mjs';
import {
  ORDER, PARTY_NAME, STATUS, OUTCOMES, other, initialWorld, openCase, respond, askTsc, withdraw, advance,
  requestResponse, recordResolution, completeResolution, addStaffNote, isOpen, withdrawalsPaused, waitingOn,
  waitingLine, progress, outcomeLine, outcomeLabel, completionAction, requestOutcomes, outcomeError, money, day, dayOf, moment,
} from './dispute-preview-state.mjs';
import {adminWorkspaceNav} from './src/app/admin/AdminWorkspaceShell.jsx';
import {AdminQueueTabs} from './src/admin-prototype/main.jsx';
import './src/prototype/styles.css';
import './src/factory-prototype/styles.css';
import './src/shared/profile-shell.css';
import './src/shared/terms-dialog.css';
import './src/app/order/payout.css';
import './dispute-design-preview.css';

const reasons=['Quality or workmanship','Delivery delay','Items missing or incorrect','Payment or release issue','Requirements or scope changed','Communication breakdown','Other'];
const stageOptions=['Whole order','Fit sample','PP sample','Bulk deposit','Bulk production','QC photos','Final balance'];
const brandNav=[{label:'Dashboard',icon:'home'},{label:'RFQs',icon:'rfq'},{label:'Production orders',icon:'projects'},{label:'Messages',icon:'messages'},{label:'Saved',icon:'bookmarks'},{label:'Payments',icon:'billing'},{label:'Settings',icon:'settings'}];
const disputeAdminNav=[...adminWorkspaceNav.slice(0,-1),{label:'Disputes',icon:'disputes'},...adminWorkspaceNav.slice(-1)];
const Icon=({name='rfq'})=><img className="dp-icon" src={`/assets/prototype-icons/${name}.svg`} alt=""/>;
const fileSize=n=>n>1048576?`${(n/1048576).toFixed(1)} MB`:`${Math.ceil(n/1024)} KB`;
const tone=s=>s===STATUS.resolved?'green':s===STATUS.review?'blue':s===STATUS.withdrawn?'':'amber';
const StatusBadge=({status})=><span className={`dp-badge ${tone(status)}`} data-testid="case-status">{status}</span>;
const toCents=v=>Math.round(Number(v)*100);

// Other cases in the staff queue, so the filters and the overdue tone have rows.
const sampleRows=[
  {id:'DSP-00028',order:'TSC-000498',title:'Linen blend trousers',parties:'Harbor & Pine / Guangzhou Textile Co.',reason:'Delivery delay',stage:'Bulk production',status:STATUS.review,waiting:'TSC',dueAt:Date.parse('2026-11-24T15:00:00Z'),openedAt:Date.parse('2026-11-18T15:00:00Z')},
  {id:'DSP-00027',order:'TSC-000471',title:'Merino crew knits',parties:'Northfold / Hangzhou Knitworks',reason:'Items missing or incorrect',stage:'Final balance',status:STATUS.resolved,waiting:'—',dueAt:null,openedAt:Date.parse('2026-11-09T15:00:00Z')},
];

function Modal({title,eyebrow=ORDER.number,onClose,children}){const ref=useRef();useEffect(()=>{const prev=document.activeElement;const old=document.body.style.overflow;document.body.style.overflow='hidden';ref.current.focus();function key(e){if(e.key==='Escape')onClose();if(e.key==='Tab'){const els=[...ref.current.querySelectorAll('button,input,select,textarea,a[href]')].filter(x=>!x.disabled);const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}document.addEventListener('keydown',key);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',key);prev?.focus();};},[]);return <div className="approve-fund-modal-layer dp-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="approve-fund-modal milestone-comment-modal dp-modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><header><div><span className="dp-eyebrow">{eyebrow}</span><h2>{title}</h2></div><button type="button" className="settings-drawer-close dp-dialog-close" aria-label="Close dialog" onClick={onClose}><img src="/assets/prototype-icons/close.svg" alt=""/></button></header>{children}</section></div>}

const Required=()=><span className="onboarding-required-mark" aria-hidden="true"> *</span>;
function Field({label,required,error,children,help}){return <label className={`factory-onboarding-field ${error?'has-onboarding-error':''}`}><span className="dp-label-text">{label}{required&&<Required/>}</span>{children}{help&&<small className="dp-field-help">{help}</small>}{error&&<span className="factory-onboarding-validation-message" role="alert">{error}</span>}</label>}

/** Outcome + amount or date: one control for the request, an offer and TSC's decision. */
function OutcomeFields({value,onChange,options,world,error,label='Outcome'}){
  const held=world.step.heldCents;
  return <div className="dp-form-grid"><Field label={label} required error={error&&!value.type?error:''}><select name="outcome" value={value.type} onChange={e=>onChange({...value,type:e.target.value})}><option value="">Select an outcome</option>{options.map(o=><option key={o.key} value={o.key}>{o.label}</option>)}</select></Field>
    {value.type==='refund'&&<Field label="Amount (USD)" required error={error&&value.type?error:''} help={`Up to ${money(held)} held by TSC`}><input name="amount" inputMode="decimal" type="number" min="0.01" max={held/100} step="0.01" value={value.amount??''} onChange={e=>onChange({...value,amount:e.target.value})}/></Field>}
    {value.type==='new_date'&&<Field label="New due date" required error={error&&value.type?error:''} help={`Now ${dayOf(world.step.due)}`}><input name="date" type="date" min="2026-11-27" value={value.date??''} onChange={e=>onChange({...value,date:e.target.value})}/></Field>}
    {(value.type==='payout'||value.type==='cancel')&&<div className="dp-outcome-preview"><small>Result</small><strong>{outcomeLine({type:value.type},world)}</strong></div>}
  </div>;
}
const toOutcome=v=>({type:v.type,amountCents:v.type==='refund'&&v.amount!==''&&v.amount!=null?toCents(v.amount):undefined,date:v.type==='new_date'?v.date:undefined});

function FilePicker({files,setFiles,label='Supporting evidence'}){
  return <div><div className="dp-field-title">{label} <small>Optional</small></div><label className="brand-onboarding-upload-row dp-upload"><Icon name="upload"/><strong>Choose files or drag them here</strong><small>PDF, JPG, PNG, WebP, MP4, MOV · 20 MB each · up to 8 files</small><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.mp4,.mov" onChange={e=>{const picked=[...e.target.files].map(f=>({name:f.name,size:f.size}));setFiles(x=>[...x,...picked].slice(0,8));e.target.value='';}}/></label>{files.map((f,i)=><div className="dp-file" key={i}><Icon/><div><strong>{f.name}</strong><small>{fileSize(f.size)}</small></div><button className="dp-icon-button" type="button" aria-label={`Remove ${f.name}`} onClick={()=>setFiles(x=>x.filter((_,j)=>j!==i))}><Icon name="close"/></button></div>)}</div>;
}

// ---------- Dialogs for the parties ----------
function OpenDisputeDialog({side,world,onClose,onSubmit}){
  const [reason,setReason]=useState(''),[stage,setStage]=useState(ORDER.step),[details,setDetails]=useState(''),[outcome,setOutcome]=useState({type:''}),[files,setFiles]=useState([]),[errors,setErrors]=useState({});
  function submit(e){e.preventDefault();const err={};if(!reason)err.reason='Select a reason.';if(!details.trim())err.details='Describe what happened.';const o=toOutcome(outcome);const oe=outcomeError(o,world);if(oe)err.outcome=oe;setErrors(err);if(Object.keys(err).length)return;onSubmit({reason,stage,details:details.trim(),request:o,files});}
  return <Modal title="Open a dispute" onClose={onClose}><form noValidate onSubmit={submit}><div className="dp-modal-body"><div className="dp-order-context"><Icon name="projects"/><div><strong>{ORDER.title}</strong><small>{ORDER.number} · {PARTY_NAME[other(side)]}</small></div></div>
    <div className="dp-form-grid"><Field label="Reason" required error={errors.reason}><select name="reason" value={reason} onChange={e=>setReason(e.target.value)}><option value="">Select a reason</option>{reasons.map(r=><option key={r}>{r}</option>)}</select></Field><Field label="Affected stage" required><select name="stage" value={stage} onChange={e=>setStage(e.target.value)}>{stageOptions.map(s=><option key={s}>{s}</option>)}</select></Field></div>
    <Field label="What happened?" required error={errors.details} help={`${details.length}/4,000`}><textarea name="details" maxLength={4000} rows={4} value={details} onChange={e=>setDetails(e.target.value)} placeholder="Dates, quantities and the requirement that was not met."/></Field>
    <OutcomeFields label="Requested outcome" value={outcome} onChange={setOutcome} options={requestOutcomes(side)} world={world} error={errors.outcome}/>
    <FilePicker files={files} setFiles={setFiles}/>
    <div className="dp-note dp-mini"><Icon name="verification"/><p>{PARTY_NAME[other(side)]} has 2 business days to respond. Without an agreement, TSC reviews the case.</p></div>
  </div><footer><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button type="submit" className="primary-btn">Submit dispute</button></footer></form></Modal>;
}

function SubmittedDialog({record,onClose,onView}){
  return <Modal title="Dispute submitted" onClose={onClose}><div className="dp-modal-body dp-success"><img className="brand-onboarding-success-icon" src="/assets/prototype-icons/success.svg" alt=""/><h3>{record.id}</h3><p>{waitingLine(record,record.openedBy)}</p></div><footer><button className="secondary-btn" onClick={onClose}>Close</button><button className="primary-btn" onClick={onView}>View case</button></footer></Modal>;
}

function RespondDialog({side,world,mode:initial,onClose,onSubmit}){
  const c=world.case;const [mode,setMode]=useState(initial),[note,setNote]=useState(''),[outcome,setOutcome]=useState({type:''}),[files,setFiles]=useState([]),[error,setError]=useState('');
  const canAccept=c.offer&&c.offer.by!==side;
  const acceptLabel=c.offer?.isRequest?'Accept the request':'Accept the offer';
  const offerLabel=c.offer&&c.offer.by!==side&&!c.offer.isRequest?'Make a counter-offer':'Make an offer';
  const modes=[...(canAccept?[['accept',acceptLabel]]:[]),['offer',offerLabel],['reply','Reply']];
  function submit(e){e.preventDefault();try{if(mode==='offer'){const o=toOutcome(outcome);const err=outcomeError(o,world);if(err){setError(err);return;}onSubmit({action:'offer',offer:o,note:note.trim(),files});}else if(mode==='reply'){if(!note.trim()){setError('Write a reply.');return;}onSubmit({action:'reply',note:note.trim(),files});}else onSubmit({action:'accept',note:note.trim(),files:[]});}catch(x){setError(x.message);}}
  const options=OUTCOMES.filter(o=>o.key!=='no_change'&&!(side==='factory'&&o.key==='payout'&&false));
  return <Modal title="Respond" onClose={onClose}><form noValidate onSubmit={submit}><div className="dp-modal-body">
    <div className="dp-segment" role="radiogroup" aria-label="Response">{modes.map(([k,l])=><button type="button" role="radio" aria-checked={mode===k} className={mode===k?'selected':''} key={k} onClick={()=>{setMode(k);setError('');}}>{l}</button>)}</div>
    {mode==='accept'&&<div className="dp-offer-summary"><small>{c.offer.isRequest?'Request':'Offer'} from {PARTY_NAME[c.offer.by]}</small><strong>{outcomeLine(c.offer,world)}</strong>{c.offer.note&&<p>{c.offer.note}</p>}</div>}
    {mode==='offer'&&<OutcomeFields value={outcome} onChange={v=>{setOutcome(v);setError('');}} options={options} world={world} error={error}/>}
    <Field label={mode==='reply'?'Reply':'Message'} required={mode==='reply'} error={mode==='reply'?error:''}><textarea rows={4} value={note} onChange={e=>{setNote(e.target.value);setError('');}} placeholder={mode==='accept'?'Optional':mode==='offer'?'Optional':'Your account, with dates and quantities.'}/></Field>
    {mode!=='accept'&&<FilePicker files={files} setFiles={setFiles}/>}
    {mode==='accept'&&<div className="dp-note dp-mini"><Icon name="verification"/><p>{needsStaffWords(c.offer,world)}</p></div>}
    {error&&mode==='accept'&&<p className="dp-error" role="alert">{error}</p>}
  </div><footer><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button type="submit" className="primary-btn">{mode==='accept'?acceptLabel:mode==='offer'?'Send offer':'Send reply'}</button></footer></form></Modal>;
}
const needsStaffWords=(o,world)=>['refund','payout','cancel'].includes(o.type)?`Accepting ends the case. TSC then carries out: ${outcomeLine(o,world)}.`:'Accepting ends the case.';

function AskTscDialog({onClose,onSubmit}){const [note,setNote]=useState('');return <Modal title="Ask TSC to step in" onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSubmit(note.trim());}}><div className="dp-modal-body"><p>TSC reviews the case, may ask both sides for more, and decides the outcome.</p><Field label="Message for TSC"><textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional"/></Field></div><footer><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn">Ask TSC</button></footer></form></Modal>;}
function WithdrawDialog({record,onClose,onSubmit}){return <Modal title="Withdraw the dispute" onClose={onClose}><div className="dp-modal-body"><p>{record.id} closes as Withdrawn. The order continues as before.</p></div><footer><button type="button" className="secondary-btn" onClick={onClose}>Keep the case</button><button className="primary-btn dp-danger-btn" onClick={onSubmit}>Withdraw</button></footer></Modal>;}

// ---------- Admin dialogs ----------
function RequestDialog({onClose,onSubmit}){const [to,setTo]=useState('both'),[text,setText]=useState('');return <Modal title="Request a response" eyebrow="Dispute" onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSubmit(to,text.trim());}}><div className="dp-modal-body"><Field label="Who should respond?" required><select value={to} onChange={e=>setTo(e.target.value)}><option value="both">Both sides</option><option value="factory">{ORDER.factory}</option><option value="brand">{ORDER.brand}</option></select></Field><Field label="What do you need?" required><textarea required minLength={10} rows={4} value={text} onChange={e=>setText(e.target.value)} placeholder="Close-up collar photos and the number of units affected."/></Field><p className="dp-field-help">Due in 2 business days. Shared on the case timeline.</p></div><footer><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn">Send request</button></footer></form></Modal>;}
function ResolveDialog({world,onClose,onSubmit}){const [outcome,setOutcome]=useState({type:''}),[note,setNote]=useState(''),[error,setError]=useState('');return <Modal title="Record resolution" eyebrow="Dispute" onClose={onClose}><form noValidate onSubmit={e=>{e.preventDefault();const o=toOutcome(outcome);const err=outcomeError(o,world)||(!note.trim()?'Give the reason both sides will read.':'');if(err){setError(err);return;}onSubmit(o,note.trim());}}><div className="dp-modal-body"><OutcomeFields value={outcome} onChange={v=>{setOutcome(v);setError('');}} options={OUTCOMES} world={world} error={error&&!note.trim()&&outcome.type?'':error}/><Field label="Reason (shared with both sides)" required error={error&&!note.trim()&&!outcomeError(toOutcome(outcome),world)?error:''}><textarea rows={4} value={note} onChange={e=>{setNote(e.target.value);setError('');}} placeholder="What the evidence shows and why this outcome."/></Field></div><footer><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn">Record resolution</button></footer></form></Modal>;}
function CompleteDialog({world,onClose,onSubmit}){const r=world.case.resolution;const label=completionAction(r,world);return <Modal title={label} eyebrow="Dispute" onClose={onClose}><div className="dp-modal-body"><div className="dp-offer-summary"><small>{r.by==='agreement'?'Agreed by both sides':'TSC decision'}</small><strong>{outcomeLine(r,world)}</strong></div><dl className="dp-case-summary"><div><dt>Held by TSC on {ORDER.number}</dt><dd>{money(world.step.heldCents)}</dd></div><div><dt>After this</dt><dd>{r.type==='refund'?`${money(world.step.heldCents-r.amountCents)} held`:r.type==='payout'?`${money(0)} held`:'Order cancelled'}</dd></div></dl></div><footer><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" onClick={onSubmit}>{label}</button></footer></Modal>;}

// ---------- Shared case parts ----------
function Progress({record}){const {steps,at}=progress(record);return <div className="dp-progress dp-case-progress" aria-label="Case progress">{steps.map((s,i)=><div key={s} className={i<at||(i===at&&!isOpen(record))?'done':i===at?'current':''}><span>{i<at||(i===at&&!isOpen(record))?'✓':i+1}</span><small>{s}</small></div>)}</div>;}
function Timeline({record}){return <ol className="dp-timeline" data-testid="timeline">{record.events.map((x,i)=><li key={i}><span className={`dp-dot ${x.who}`}/><div><strong>{x.title}</strong><small>{PARTY_NAME[x.who]} · {moment(x.at)}</small>{x.detail&&<p>{x.detail}</p>}{x.files?.map((f,j)=><div className="dp-file compact" key={j}><Icon/><div><strong>{f.name}</strong><small>{fileSize(f.size)}</small></div></div>)}</div></li>)}</ol>;}
function RequestSummary({record,world}){return <dl className="dp-case-summary"><div><dt>Reason</dt><dd>{record.reason}</dd></div><div className="dp-case-description"><dt>What happened</dt><dd>{record.details}</dd></div><div><dt>Affected stage</dt><dd>{record.stage}</dd></div><div><dt>Requested outcome</dt><dd>{outcomeLine({...record.request,amountCents:record.request.amountCents??(['payout','cancel'].includes(record.request.type)?ORDER.stepCents:undefined)})}</dd></div><div className="dp-case-description"><dt>Files</dt><dd>{record.files.length?record.files.map((f,i)=><div className="dp-file compact" key={i}><Icon/><div><strong>{f.name}</strong><small>{fileSize(f.size)}</small></div></div>):'None'}</dd></div></dl>;}
function OfferCard({record,world}){
  if(record.resolution) return <article className="dp-card dp-offer-card resolved" data-testid="outcome-card"><div className="dp-card-head"><h2>Outcome</h2><span className="dp-badge green">{record.resolution.by==='agreement'?'Agreed':'TSC decision'}</span></div><strong className="dp-offer-line">{outcomeLine(record.resolution,world)}</strong>{record.resolution.note&&<p>{record.resolution.note}</p>}<small>{record.status===STATUS.completion?STATUS.completion:`Completed ${moment(record.closedAt)}`}</small></article>;
  if(!record.offer||record.offer.isRequest||!isOpen(record)) return null;
  const o=record.offer;
  return <article className="dp-card dp-offer-card" data-testid="offer-card"><div className="dp-card-head"><h2>Current offer</h2><small>{PARTY_NAME[o.by]} · {moment(o.at)}</small></div><strong className="dp-offer-line">{outcomeLine(o,world)}</strong>{o.note&&<p>{o.note}</p>}</article>;
}

// ---------- The case page, brand and factory ----------
function CasePage({side,world,onBack,onAction}){
  const c=world.case;const open=isOpen(c);const mine=c.status===STATUS.response?c.turn===side:c.status===STATUS.review&&c.tscRequest?.to.includes(side);
  const opener=c.openedBy===side;const canAccept=c.offer&&c.offer.by!==side;
  const acceptLabel=c.offer?.isRequest?'Accept the request':'Accept the offer';
  const offerLabel=c.offer&&c.offer.by!==side&&!c.offer.isRequest?'Make a counter-offer':'Make an offer';
  const answering=open&&c.status!==STATUS.completion&&(mine||c.status===STATUS.review);
  const line=open?waitingLine(c,side,world.now):c.status===STATUS.withdrawn?`Withdrawn ${moment(c.closedAt)}`:`Resolved ${moment(c.closedAt)}`;
  return <div className="dp-case-page" data-testid="case-page">
    <button className="project-back-link" type="button" onClick={onBack}>‹ Back to order</button>
    <header className="dp-page-heading dp-case-heading"><div><span className="dp-eyebrow">Dispute · {ORDER.number}</span><h1>{c.id}</h1><p>{ORDER.title} · {PARTY_NAME[other(side)]} · Opened {day(c.openedAt)} by {PARTY_NAME[c.openedBy]}</p></div><StatusBadge status={c.status}/></header>
    <Progress record={c}/>
    <div className="dp-case-layout"><section className="dp-case-main">
      {c.status!==STATUS.resolved&&<article className={`dp-card dp-action-card ${mine?'yours':''}`} data-testid="action-card">
        <strong className="dp-due-line">{line}</strong>
        {answering&&<div className="dp-action-row">
          {canAccept&&<button className="primary-btn" type="button" onClick={()=>onAction('respond','accept')}>{acceptLabel}</button>}
          <button className={canAccept?'secondary-btn':'primary-btn'} type="button" onClick={()=>onAction('respond','offer')}>{offerLabel}</button>
          <button className="secondary-btn" type="button" onClick={()=>onAction('respond','reply')}>Reply</button>
        </div>}
        {open&&c.status!==STATUS.completion&&<div className="dp-link-row">{c.status===STATUS.response&&<button className="dp-text-button" type="button" onClick={()=>onAction('askTsc')}>Ask TSC to step in</button>}{opener&&<button className="dp-text-button danger" type="button" onClick={()=>onAction('withdraw')}>Withdraw</button>}</div>}
      </article>}
      <OfferCard record={c} world={world}/>
      <article className="dp-card"><h2 className="dp-card-title">Request</h2><RequestSummary record={c} world={world}/></article>
      <article className="dp-card"><h2 className="dp-card-title">Timeline</h2><Timeline record={c}/></article>
    </section>
    <aside className="dp-review-side">
      <article className="dp-card"><h3>{ORDER.step}</h3><dl className="dp-side-facts"><div><dt>Held by TSC</dt><dd>{money(world.step.heldCents)}</dd></div>{world.step.refundedCents>0&&<div><dt>Refunded</dt><dd>{money(world.step.refundedCents)}</dd></div>}<div><dt>Step</dt><dd>{open?<span className="dp-hold">On hold: dispute open</span>:world.order==='cancelled'?'Cancelled':world.step.state==='paid_out'?'Paid out':'Awaiting approval'}</dd></div><div><dt>Due</dt><dd>{dayOf(world.step.due)}</dd></div></dl></article>
      {side==='factory'&&<article className="dp-card"><h3>Withdrawals</h3><p className={withdrawalsPaused(world)?'dp-hold':''}>{withdrawalsPaused(world)?'Paused':'Available'}</p><button className="dp-text-button" type="button" onClick={()=>onAction('payments')}>View balance</button></article>}
      <article className="dp-card"><h3>Order</h3><dl className="dp-side-facts"><div><dt>Order</dt><dd>{ORDER.number}</dd></div><div><dt>Total</dt><dd>{money(ORDER.totalCents)}</dd></div><div><dt>Status</dt><dd>{world.order==='cancelled'?'Cancelled':'In production'}</dd></div></dl></article>
    </aside></div>
  </div>;
}

// ---------- The factory's balance (a mock of the payout card) ----------
function FactoryPayments({world,onViewCase}){
  const paused=withdrawalsPaused(world);const c=world.case;
  return <section className="billing-history-page dp-payments" data-testid="factory-payments"><header className="billing-history-header"><div><h1>Payments</h1></div></header>
    <section className="live-payout-method-card live-stripe-payout-card"><div className="live-payout-balance">
      <span className="payment-metric-label">Available balance (USD)</span><strong data-testid="payout-balance">{money(world.balanceCents)}</strong>
      <p className="payout-balance-line">Earnings stay in your balance until you withdraw them.{paused?' · Withdrawals paused':''}</p>
      {world.step.heldCents>0&&<p>{money(world.step.heldCents)} held by TSC for {ORDER.step}</p>}
      {paused&&<div className="dp-paused-notice" role="status" data-testid="paused-notice"><strong>Withdrawals are paused while a payment is reviewed.</strong><p>A brand opened a dispute on "{ORDER.title}", so our team is reviewing it. <button className="dp-text-button" type="button" onClick={onViewCase}>View case</button></p></div>}
    </div><div className="live-payout-card-action"><button className="primary-btn compact-btn" type="button" disabled={paused} title={paused?'Withdrawals paused':undefined}>Withdraw</button><button className="secondary-btn compact-btn" type="button">Withdrawal methods</button></div></section>
    <div className="billing-history-list">{[[`${ORDER.step} · funded`,`${ORDER.brand} - ${ORDER.number}`,world.step.state==='paid_out'?'Paid out':world.step.heldCents?'Held by TSC':world.step.state==='cancelled'?'Refunded':'Refunded',money(ORDER.stepCents)],['Bulk deposit',`${ORDER.brand} - ${ORDER.number}`,'Paid out','$1,701.00'],['PP sample',`${ORDER.brand} - ${ORDER.number}`,'Paid out','$165.00'],['Final balance','Harbor & Pine - TSC-000431','Paid out','$1,000.00']].map(r=><article className="billing-history-row" key={r[0]}><div><strong>{r[0]}</strong><span>{r[1]}</span></div><span className="billing-status">{r[2]}</span><strong>{r[3]}</strong></article>)}</div>
  </section>;
}

// ---------- Admin ----------
function AdminQueue({world,tab,setTab,onOpen,notify}){
  const c=world.case;
  const rows=[...(c?[{id:c.id,order:ORDER.number,title:ORDER.title,parties:`${ORDER.brand} / ${ORDER.factory}`,reason:c.reason,stage:c.stage,status:c.status,...(()=>{const w=waitingOn(c);return{waiting:w.side==='both'?'Both sides':w.side?PARTY_NAME[w.side]:'—',dueAt:w.dueAt};})(),openedAt:c.openedAt,live:true}]:[]),...sampleRows];
  const isClosed=r=>r.status===STATUS.resolved||r.status===STATUS.withdrawn;
  const shown=rows.filter(r=>tab==='resolved'?isClosed(r):!isClosed(r));
  const age=r=>{const d=Math.floor((world.now-r.openedAt)/86400000);return d<1?'Today':`${d} ${d===1?'day':'days'}`;};
  return <><AdminQueueTabs label="Dispute queues" tabs={[{key:'open',label:'Open',count:rows.filter(r=>!isClosed(r)).length},{key:'resolved',label:'Resolved',count:rows.filter(isClosed).length}]} active={tab} onChange={setTab}/>
    {shown.length?<div className="admin-table-wrap"><table className="admin-table dp-disputes-table" data-testid="admin-queue"><thead><tr>{['Case','Order / parties','Reason','Status','Waiting on','Due','Age',''].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{shown.map(r=>{const overdue=r.dueAt&&r.dueAt<=world.now&&!isClosed(r);return <tr key={r.id} className={r.live?'dp-live-row':''}><td><strong>{r.id}</strong></td><td><strong>{r.order}</strong><p>{r.title}</p><small>{r.parties}</small></td><td>{r.reason}<p>{r.stage}</p></td><td><StatusBadge status={r.status}/></td><td>{isClosed(r)?'—':r.waiting}</td><td className={overdue?'dp-overdue':''}>{isClosed(r)||!r.dueAt?'—':overdue?`Overdue · ${day(r.dueAt)}`:day(r.dueAt)}</td><td>{age(r)}</td><td><button className="secondary-btn compact-btn" type="button" onClick={()=>r.live?onOpen():notify('Sample row. Open the order’s own case to walk the flow.')}>Review case</button></td></tr>;})}</tbody></table></div>:<p className="projects-empty">No {tab==='resolved'?'resolved':'open'} cases.</p>}</>;
}

function AdminCase({world,onAction,onNote}){
  const c=world.case;const [tab,setTab]=useState('Case details');const [note,setNote]=useState('');const open=isOpen(c);const w=waitingOn(c);
  const overdue=w.dueAt&&w.dueAt<=world.now;
  return <><div className="dp-case-banner"><StatusBadge status={c.status}/><span>Opened by <strong>{PARTY_NAME[c.openedBy]}</strong> · {c.stage} · {day(c.openedAt)}</span>{open&&<span>Waiting on <strong>{w.side==='both'?'Both sides':PARTY_NAME[w.side]}</strong>{w.dueAt&&<> · <span className={overdue?'dp-overdue':''}>{overdue?'Overdue · ':'Due '}{day(w.dueAt)}</span></>}</span>}<span className="dp-assignee">Assigned to <strong>TSC Operations</strong></span></div>
    <Progress record={c}/>
    <div className="dp-case-layout"><section><AdminQueueTabs label="Dispute case sections" tabs={[{key:'Case details',label:'Case details'},{key:'Evidence',label:'Evidence',count:c.files.length},{key:'Timeline',label:'Timeline',count:c.events.length}]} active={tab} onChange={setTab}/>
      <article className="dp-card dp-case-content">{tab==='Case details'?<><span className="dp-eyebrow">{c.reason}</span><h2>{ORDER.title}</h2><RequestSummary record={c} world={world}/></>:tab==='Evidence'?<><h2>Evidence</h2>{c.files.length?c.files.map((f,i)=><div className="dp-file" key={i}><Icon/><div><strong>{f.name}</strong><small>{fileSize(f.size)}</small></div><span className="dp-badge">Evidence {i+1}</span></div>):<div className="dp-note">No files yet.</div>}</>:<><h2>Timeline</h2><Timeline record={c}/></>}</article>
      <OfferCard record={c} world={world}/>
      <article className="dp-card dp-staff-notes" data-testid="staff-notes"><div className="dp-card-head"><h2>Staff notes</h2><span className="dp-badge">Only TSC staff</span></div>{c.staffNotes.map((n,i)=><div className="dp-staff-note" key={i}><small>TSC Operations · {moment(n.at)}</small><p>{n.text}</p></div>)}<form className="dp-note-form" onSubmit={e=>{e.preventDefault();if(note.trim()){onNote(note.trim());setNote('');}}}><textarea rows={2} value={note} onChange={e=>setNote(e.target.value)} placeholder="Add a private note"/><button className="secondary-btn compact-btn" disabled={!note.trim()}>Add note</button></form></article>
    </section>
    <aside className="dp-review-side">
      {open&&<article className="dp-card"><h2>Actions</h2>{c.status===STATUS.completion?<button className="primary-btn" data-testid="complete-btn" onClick={()=>onAction('complete')}>{completionAction(c.resolution,world)}</button>:<><button className="secondary-btn" disabled={!open} onClick={()=>onAction('request')}>Request a response</button><button className="primary-btn" disabled={!open} onClick={()=>onAction('resolve')}>Record resolution</button></>}</article>}
      <article className="dp-card"><h3>Money</h3><dl className="dp-side-facts"><div><dt>Held on {ORDER.number}</dt><dd>{money(world.step.heldCents)}</dd></div><div><dt>{ORDER.step}</dt><dd>{open?<span className="dp-hold">On hold</span>:world.step.state==='paid_out'?'Paid out':world.order==='cancelled'?'Cancelled':'Awaiting approval'}</dd></div><div><dt>{ORDER.factory} balance</dt><dd>{money(world.balanceCents)}</dd></div><div><dt>Withdrawals</dt><dd>{withdrawalsPaused(world)?<span className="dp-hold">Paused</span>:'Available'}</dd></div></dl></article>
      <article className="dp-card"><h3>Order</h3><dl className="dp-side-facts"><div><dt>{ORDER.number}</dt><dd>{money(ORDER.totalCents)}</dd></div><div><dt>Brand</dt><dd>{ORDER.brand}</dd></div><div><dt>Factory</dt><dd>{ORDER.factory}</dd></div></dl></article>
    </aside></div></>;
}

// ---------- Emails ----------
const emailEnv={appUrl:'https://sourcing-club.com',logoUrl:'/assets/logo.png',supportEmail:'operations@contact.sourcing-club.com',companyAddress:'New York, USA'};
function emailFor(e){const isFactory=e.to==='factory';const row={kind:`dispute_${e.kind}`,title:e.title,body:e.body,category:'payments',org_type:isFactory?'factory':'brand',org_name:PARTY_NAME[e.to],recipient_name:isFactory?'Wei':'Maya',subject_type:'order',subject_id:ORDER.number,locale:'en',time_zone:'America/New_York'};const out=notificationEmail(row,emailEnv);return {...out,html:out.html.replaceAll(`/orders/${ORDER.number}`,`/orders/${ORDER.number}/dispute`)};}
const sampleEmails=[
  {to:'factory',kind:'opened',title:`${ORDER.brand} opened a dispute on ${ORDER.number}`,body:`Quality or workmanship on "${ORDER.title}". Respond by Nov 30.`},
  {to:'brand',kind:'offer',title:`${ORDER.factory} made an offer on ${ORDER.number}`,body:`Refund $850.00 to ${ORDER.brand}. Respond by Dec 1.`},
  {to:'factory',kind:'resolved',title:`${ORDER.number} dispute resolved`,body:`Refund $850.00 to ${ORDER.brand}. Withdrawals are available again.`},
];
function EmailsPage({world}){
  const byKind=k=>[...world.emails].reverse().find(e=>e.kind===k)??sampleEmails.find(e=>e.kind===k);
  const list=['opened','offer','resolved'].map(byKind);
  return <div data-testid="emails"><header className="dp-page-heading"><div><span className="dp-eyebrow">Preview</span><h1>Emails</h1><p>Built with the product’s notification email. Links open the case page.</p></div></header>
    <div className="dp-email-grid">{list.map((e,i)=>{const m=emailFor(e);return <figure key={i} className="dp-email"><figcaption><span className="dp-badge">{['Case opened','Offer made','Resolved'][i]}</span><small>To {PARTY_NAME[e.to]} · Subject: {m.subject}</small></figcaption><iframe title={m.subject} srcDoc={m.html} data-testid={`email-${e.kind}`}/></figure>;})}</div></div>;
}

// ---------- The preview ----------
function Preview(){
  const [world,setWorld]=useState(initialWorld);
  const [view,setView]=useState('brand');
  const [page,setPage]=useState({brand:'orders',factory:'orders',admin:'queue'});
  const [collapsed,setCollapsed]=useState(false),[modal,setModal]=useState(null),[toast,setToast]=useState(''),[bell,setBell]=useState(false),[queueTab,setQueueTab]=useState('open');
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(t);},[toast]);
  useEffect(()=>{window.scrollTo(0,0);},[view,page]);
  const notify=setToast;
  const isAdmin=view==='admin',isParty=view==='brand'||view==='factory';
  const current=page[view];
  const go=(p,v=view)=>{setPage(x=>({...x,[v]:p}));setModal(null);setBell(false);};
  const act=(fn)=>{try{setWorld(fn);setModal(null);return true;}catch(x){notify(x.message);return false;}};
  // Each action lets a little mock time pass, so the timeline reads like a real one.
  const run=(fn)=>{try{const next=fn(world);setWorld({...next,now:next.now+47*60000});setModal(null);return next;}catch(x){notify(x.message);return null;}};
  const paths={orders:'/orders',order:`/orders/${ORDER.number}`,case:`/orders/${ORDER.number}/dispute`,payments:'/payout',queue:'/admin.html/disputes',adminCase:`/admin.html/disputes/${world.case?.id??''}`};
  const path=view==='emails'?'Emails':(isAdmin?'':'/app.html')+paths[current];
  const unread=isParty?world.notifications[view].filter(n=>n.unread).length:0;
  const account=isAdmin?{initials:'TS',name:'TSC Operations',type:'Admin workspace'}:view==='factory'?{initials:'NL',name:ORDER.factory,type:'Factory account'}:{initials:'DB',name:ORDER.brand,type:'Brand account'};
  const navItems=isAdmin?disputeAdminNav:view==='factory'?factoryNav:brandNav;
  const active=isAdmin?'Disputes':current==='payments'?'Payments':'Production orders';
  function onNav(label){if(isAdmin){if(label==='Disputes')go('queue');else notify('This preview covers disputes.');return;}if(label==='Production orders')go('orders');else if(label==='Payments'&&view==='factory')go('payments');else notify('This preview covers disputes.');}
  function partyAction(kind,arg){if(kind==='payments')go('payments');else setModal({kind,arg});}
  function openBellItem(item){setWorld(w=>({...w,notifications:{...w.notifications,[view]:w.notifications[view].map(n=>n.id===item.id?{...n,unread:false}:n)}}));go(world.case?'case':'orders');}
  const bellItems=isParty?world.notifications[view].map(n=>({...n,time:moment(n.at)})):[];
  return <div className={`app-shell dp-app ${isAdmin?'admin-app':''} ${collapsed?'nav-collapsed':''}`}>
    {view!=='emails'&&<PrototypeSideNav account={account} active={active} collapsed={collapsed} onToggle={()=>setCollapsed(!collapsed)} navItems={navItems} onNav={onNav}/>}
    <div className={`dp-main ${view==='emails'?'dp-main-full':''}`}>
      <div className="dp-preview-bar" data-testid="preview-bar"><span><b>LOCAL PREVIEW</b> · {day(world.now)} · <code>{path}</code></span><div role="group" aria-label="Preview perspective">{[['brand','Brand'],['factory','Factory'],['admin','Admin'],['emails','Emails']].map(([v,l])=><button key={v} className={view===v?'selected':''} onClick={()=>{setView(v);setModal(null);setBell(false);}}>{l}</button>)}</div><div className="dp-preview-tools"><button type="button" data-testid="skip" onClick={()=>{setWorld(w=>advance(w,2));notify('Skipped 2 business days.');}}>Skip 2 days</button><button type="button" onClick={()=>{setWorld(initialWorld());setPage({brand:'orders',factory:'orders',admin:'queue'});setQueueTab('open');setModal(null);}}>Reset</button></div></div>
      {isParty&&<button className="activity-icon-btn dp-bell" type="button" aria-label="Open activity" data-testid="bell" onClick={()=>setBell(true)}><img src="/assets/prototype-icons/notification.svg" alt=""/>{unread>0&&<b aria-hidden="true">{unread}</b>}</button>}
      {view==='emails'?<EmailsPage world={world}/>
      :isAdmin?(current==='adminCase'&&world.case?<><button className="admin-back-link" type="button" onClick={()=>go('queue')}>‹ Back to disputes</button><header className="dp-page-heading"><div><span className="dp-eyebrow">Dispute</span><h1>{world.case.id}</h1><p>{ORDER.number} · {ORDER.title} · {ORDER.brand} / {ORDER.factory}</p></div></header><AdminCase world={world} onAction={k=>setModal({kind:k})} onNote={t=>setWorld(w=>addStaffNote(w,t))}/></>
        :<><header className="dp-page-heading"><div><span className="dp-eyebrow">Admin</span><h1>Disputes</h1></div></header><AdminQueue world={world} tab={queueTab} setTab={setQueueTab} onOpen={()=>go('adminCase')} notify={notify}/></>)
      :current==='case'&&world.case?<CasePage side={view} world={world} onBack={()=>go('order')} onAction={partyAction}/>
      :current==='payments'?<FactoryPayments world={world} onViewCase={()=>go('case')}/>
      :<NativeOrders view={view} open={current==='order'} onOpen={()=>go('order')} onBack={()=>go('orders')} world={world} onOpenDispute={()=>setModal({kind:'open'})} onViewCase={()=>go('case')} notify={notify}/>}
      {toast&&<div className="dp-toast" role="status">{toast}</div>}
    </div>
    {bell&&<ActivityDrawer items={bellItems} description="Updates on your orders and payments." emptyText="No notifications yet." onOpenItem={openBellItem} onClose={()=>setBell(false)}/>}
    {modal?.kind==='open'&&<OpenDisputeDialog side={view} world={world} onClose={()=>setModal(null)} onSubmit={form=>{const next=run(w=>openCase(w,view,form));if(next)setModal({kind:'submitted'});}}/>}
    {modal?.kind==='submitted'&&world.case&&<SubmittedDialog record={world.case} onClose={()=>setModal(null)} onView={()=>go('case')}/>}
    {modal?.kind==='respond'&&<RespondDialog side={view} world={world} mode={modal.arg} onClose={()=>setModal(null)} onSubmit={r=>{if(run(w=>respond(w,view,r)))notify(r.action==='accept'?'Accepted.':r.action==='offer'?'Offer sent.':'Reply sent.');}}/>}
    {modal?.kind==='askTsc'&&<AskTscDialog onClose={()=>setModal(null)} onSubmit={note=>run(w=>askTsc(w,view,note))}/>}
    {modal?.kind==='withdraw'&&<WithdrawDialog record={world.case} onClose={()=>setModal(null)} onSubmit={()=>run(w=>withdraw(w,view))}/>}
    {modal?.kind==='request'&&<RequestDialog onClose={()=>setModal(null)} onSubmit={(to,text)=>{if(run(w=>requestResponse(w,to,text)))notify('Request sent.');}}/>}
    {modal?.kind==='resolve'&&<ResolveDialog world={world} onClose={()=>setModal(null)} onSubmit={(o,n)=>{if(run(w=>recordResolution(w,o,n)))notify('Resolution recorded.');}}/>}
    {modal?.kind==='complete'&&<CompleteDialog world={world} onClose={()=>setModal(null)} onSubmit={()=>{if(run(w=>completeResolution(w)))notify('Done. The case is resolved.');}}/>}
  </div>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
