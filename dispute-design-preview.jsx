import React, {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PrototypeSideNav} from './src/shared/ProfileShell.jsx';
import {ActivityDrawer} from './src/prototype/main.jsx';
import {nav as factoryNav} from './src/factory-prototype/main.jsx';
import PaymentHelp from './src/app/order/PaymentHelp.jsx';
import NativeOrders from './dispute-native-orders.jsx';
import {notificationEmail} from './scripts/generate-notification-email.mjs';
import {
  ORDER, STAFF, PARTY_NAME, STATUS, OUTCOMES, WINDOW_DAYS, other, initialWorld, tick, openCase, respond, withdraw, advance,
  requestResponse, recordResolution, completeResolution, addStaffNote, releaseOtherPayments, approveStep, isOpen, canAnswer, withdrawalsPaused,
  stepOnHold, waitingOn, waitingLine, windowLine, handlingLine, progress, queueRow, outcomeLine, completionAction, requestOutcomes, outcomeError,
  money, day, dayOf, moment, dueBy,
} from './dispute-preview-state.mjs';
import {STEPS, worldAt, toOutcome, toCaseForm} from './dispute-preview-steps.mjs';
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
const tone=s=>s===STATUS.resolved?'green':s===STATUS.completion?'blue':s===STATUS.withdrawn?'':'amber';
const StatusBadge=({status})=><span className={`dp-badge ${tone(status)}`} data-testid="case-status">{status}</span>;
/** Who an event is from, as the reader sees it: staff by name only inside the admin workspace. */
const whoName=(who,viewer)=>who==='staff'?(viewer==='admin'?STAFF:'Our team'):who==='system'?'Automatic':PARTY_NAME[who];
const sideName=side=>side==='both'?'Both sides':side==='staff'?'Staff':side?PARTY_NAME[side]:'—';

// Other cases in the staff queue, so the filters and the overdue tone have rows.
const sampleRows=[
  {id:'DSP-00028',order:'TSC-000498',title:'Linen blend trousers',parties:'Harbor & Pine / Guangzhou Textile Co.',reason:'Delivery delay',stage:'Bulk production',status:STATUS.open,waiting:'Staff',assignee:'Daniel Okafor',dueAt:Date.parse('2026-11-25T04:59:00Z'),openedAt:Date.parse('2026-11-16T15:00:00Z')},
  {id:'DSP-00027',order:'TSC-000471',title:'Merino crew knits',parties:'Northfold / Hangzhou Knitworks',reason:'Items missing or incorrect',stage:'Final balance',status:STATUS.resolved,waiting:'—',assignee:STAFF,dueAt:null,openedAt:Date.parse('2026-11-09T15:00:00Z')},
];

function Modal({title,eyebrow=ORDER.number,onClose,children}){const ref=useRef();useEffect(()=>{const prev=document.activeElement;const old=document.body.style.overflow;document.body.style.overflow='hidden';ref.current.focus();function key(e){if(e.key==='Escape')onClose();if(e.key==='Tab'){const els=[...ref.current.querySelectorAll('button,input,select,textarea,a[href]')].filter(x=>!x.disabled);const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}document.addEventListener('keydown',key);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',key);prev?.focus?.();};},[]);return <div className="approve-fund-modal-layer dp-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="approve-fund-modal milestone-comment-modal dp-modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><header><div><span className="dp-eyebrow">{eyebrow}</span><h2>{title}</h2></div><button type="button" className="settings-drawer-close dp-dialog-close" aria-label="Close dialog" onClick={onClose}><img src="/assets/prototype-icons/close.svg" alt=""/></button></header>{children}</section></div>}

const Required=()=><span className="onboarding-required-mark" aria-hidden="true"> *</span>;
function Field({label,required,error,children,help}){return <label className={`factory-onboarding-field ${error?'has-onboarding-error':''}`}><span className="dp-label-text">{label}{required&&<Required/>}</span>{children}{help&&<small className="dp-field-help">{help}</small>}{error&&<span className="factory-onboarding-validation-message" role="alert">{error}</span>}</label>}

/** Outcome + amount or date: one control for the request, an offer and the staff decision. */
function OutcomeFields({value,onChange,options,world,error,label='Outcome'}){
  const held=world.step.heldCents;
  return <div className="dp-form-grid"><Field label={label} required error={error&&!value.type?error:''}><select name="outcome" value={value.type} onChange={e=>onChange({...value,type:e.target.value})}><option value="">Select an outcome</option>{options.map(o=><option key={o.key} value={o.key}>{o.label}</option>)}</select></Field>
    {value.type==='refund'&&<Field label="Amount (USD)" required error={error&&value.type?error:''} help={`Up to ${money(held)} funded on this step`}><input name="amount" inputMode="decimal" type="number" min="0.01" max={held/100} step="0.01" value={value.amount??''} onChange={e=>onChange({...value,amount:e.target.value})}/></Field>}
    {value.type==='rework'&&<Field label="Rework due by" required error={error&&value.type?error:''} help={`Now ${dayOf(world.step.due)}. The step reopens and is approved as usual.`}><input name="date" type="date" min="2026-11-27" value={value.date??''} onChange={e=>onChange({...value,date:e.target.value})}/></Field>}
    {(value.type==='payout'||value.type==='cancel')&&<div className="dp-outcome-preview"><small>Result</small><strong>{outcomeLine({type:value.type},world)}</strong></div>}
  </div>;
}

function FilePicker({files,setFiles,label='Supporting evidence'}){
  return <div><div className="dp-field-title">{label} <small>Optional</small></div><label className="brand-onboarding-upload-row dp-upload"><Icon name="upload"/><strong>Choose files or drag them here</strong><small>PDF, JPG, PNG, WebP, MP4, MOV · 20 MB each · up to 8 files</small><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.mp4,.mov" onChange={e=>{const picked=[...e.target.files].map(f=>({name:f.name,size:f.size}));setFiles(x=>[...x,...picked].slice(0,8));e.target.value='';}}/></label>{files.map((f,i)=><div className="dp-file" key={i}><Icon/><div><strong>{f.name}</strong><small>{fileSize(f.size)}</small></div><button className="dp-icon-button" type="button" aria-label={`Remove ${f.name}`} onClick={()=>setFiles(x=>x.filter((_,j)=>j!==i))}><Icon name="close"/></button></div>)}</div>;
}

// ---------- Dialogs for the parties ----------
const blankCase={reason:'',stage:'',details:'',outcome:{type:''},files:[]};
function OpenDisputeDialog({side,world,initial=blankCase,onClose,onSubmit}){
  const [reason,setReason]=useState(initial.reason),[stage,setStage]=useState(initial.stage),[details,setDetails]=useState(initial.details),[outcome,setOutcome]=useState(initial.outcome),[files,setFiles]=useState(initial.files),[errors,setErrors]=useState({});
  function submit(e){e.preventDefault();const err={};if(!reason)err.reason='Select a reason.';if(!stage)err.stage='Select a stage.';if(!details.trim())err.details='Describe what happened.';const o=toOutcome(outcome);const oe=outcomeError(o,world);if(oe)err.outcome=oe;setErrors(err);if(Object.keys(err).length)return;onSubmit(toCaseForm({reason,stage,details:details.trim(),outcome,files}));}
  return <Modal title="Open a dispute" onClose={onClose}><form noValidate onSubmit={submit}><div className="dp-modal-body"><div className="dp-order-context"><Icon name="projects"/><div><strong>{ORDER.title}</strong><small>{ORDER.number} · {PARTY_NAME[other(side)]}</small></div></div>
    <div className="dp-form-grid"><Field label="Reason" required error={errors.reason}><select name="reason" value={reason} onChange={e=>setReason(e.target.value)}><option value="">Select a reason</option>{reasons.map(r=><option key={r}>{r}</option>)}</select></Field><Field label="Affected stage" required error={errors.stage}><select name="stage" value={stage} onChange={e=>setStage(e.target.value)}><option value="">Select a stage</option>{stageOptions.map(s=><option key={s}>{s}</option>)}</select></Field></div>
    <Field label="What happened?" required error={errors.details} help={`${details.length}/4,000`}><textarea name="details" maxLength={4000} rows={4} value={details} onChange={e=>setDetails(e.target.value)} placeholder="Dates, quantities and the requirement that was not met."/></Field>
    <OutcomeFields label="Requested outcome" value={outcome} onChange={setOutcome} options={requestOutcomes(side)} world={world} error={errors.outcome}/>
    <FilePicker files={files} setFiles={setFiles}/>
    <div className="dp-note dp-mini"><Icon name="verification"/><p>Our team handles the case from the moment you submit. {PARTY_NAME[other(side)]} has 2 business days to respond. If it is not settled by {day(dueBy(world.now,WINDOW_DAYS))}, our team decides.</p></div>
  </div><footer><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button type="submit" className="primary-btn">Submit dispute</button></footer></form></Modal>;
}

function SubmittedDialog({record,onClose,onView}){
  return <Modal title="Dispute submitted" onClose={onClose}><div className="dp-modal-body dp-success"><img className="brand-onboarding-success-icon" src="/assets/prototype-icons/success.svg" alt=""/><h3>{record.id}</h3><p>{handlingLine(record)}<br/>{waitingLine(record,record.openedBy)}<br/>{windowLine(record)}</p></div><footer><button className="secondary-btn" onClick={onClose}>Close</button><button className="primary-btn" onClick={onView}>View case</button></footer></Modal>;
}

function RespondDialog({side,world,mode:initialMode,initial={},onClose,onSubmit}){
  const c=world.case;const [mode,setMode]=useState(initialMode),[note,setNote]=useState(initial.note??''),[outcome,setOutcome]=useState(initial.outcome??{type:''}),[files,setFiles]=useState(initial.files??[]),[error,setError]=useState('');
  const canAccept=c.offer&&c.offer.by!==side;
  const acceptLabel=c.offer?.isRequest?'Accept the request':'Accept the offer';
  const offerLabel=c.offer&&c.offer.by!==side&&!c.offer.isRequest?'Make a counter-offer':'Make an offer';
  const modes=[...(canAccept?[['accept',acceptLabel]]:[]),['offer',offerLabel],['reply','Reply']];
  function submit(e){e.preventDefault();if(mode==='offer'){const o=toOutcome(outcome);const err=outcomeError(o,world);if(err){setError(err);return;}onSubmit({action:'offer',offer:o,note:note.trim(),files});}else if(mode==='reply'){if(!note.trim()){setError('Write a reply.');return;}onSubmit({action:'reply',note:note.trim(),files});}else onSubmit({action:'accept',note:note.trim(),files:[]});}
  const options=OUTCOMES.filter(o=>o.key!=='no_change');
  return <Modal title="Respond" onClose={onClose}><form noValidate onSubmit={submit}><div className="dp-modal-body">
    <div className="dp-segment" role="radiogroup" aria-label="Response">{modes.map(([k,l])=><button type="button" role="radio" aria-checked={mode===k} className={mode===k?'selected':''} key={k} onClick={()=>{setMode(k);setError('');}}>{l}</button>)}</div>
    {mode==='accept'&&<div className="dp-offer-summary"><small>{c.offer.isRequest?'Request':'Offer'} from {PARTY_NAME[c.offer.by]}</small><strong>{outcomeLine(c.offer,world)}</strong>{c.offer.note&&<p>{c.offer.note}</p>}</div>}
    {mode==='offer'&&<OutcomeFields value={outcome} onChange={v=>{setOutcome(v);setError('');}} options={options} world={world} error={error}/>}
    <Field label={mode==='reply'?'Reply':'Message'} required={mode==='reply'} error={mode==='reply'?error:''}><textarea rows={4} value={note} onChange={e=>{setNote(e.target.value);setError('');}} placeholder={mode==='reply'?'Your account, with dates and quantities.':'Optional'}/></Field>
    {mode!=='accept'&&<FilePicker files={files} setFiles={setFiles}/>}
    {mode==='accept'?<div className="dp-note dp-mini"><Icon name="verification"/><p>{needsStaffWords(c.offer,world)}</p></div>:c.turn===side&&!c.deciding&&<p className="dp-field-help">{PARTY_NAME[other(side)]} then has 2 business days to answer. {windowLine(c)}.</p>}
    {error&&mode==='accept'&&<p className="dp-error" role="alert">{error}</p>}
  </div><footer><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button type="submit" className="primary-btn">{mode==='accept'?acceptLabel:mode==='offer'?'Send offer':'Send reply'}</button></footer></form></Modal>;
}
const needsStaffWords=(o,world)=>['refund','payout','cancel'].includes(o.type)?`Accepting ends the case. Our team then carries out: ${outcomeLine(o,world)}.`:o.type==='rework'?`Accepting ends the case. ${ORDER.step} reopens, due ${dayOf(o.date)}, and is approved as usual when the rework arrives.`:'Accepting ends the case.';

function WithdrawDialog({record,onClose,onSubmit}){return <Modal title="Withdraw the dispute" onClose={onClose}><div className="dp-modal-body"><p>{record.id} closes as Withdrawn. The order continues as before.</p></div><footer><button type="button" className="secondary-btn" onClick={onClose}>Keep the case</button><button className="primary-btn dp-danger-btn" onClick={onSubmit}>Withdraw</button></footer></Modal>;}

// ---------- Admin dialogs ----------
function RequestDialog({initial={},onClose,onSubmit}){const [to,setTo]=useState(initial.to??'both'),[text,setText]=useState(initial.text??'');return <Modal title="Request a response" eyebrow="Dispute" onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSubmit(to,text.trim());}}><div className="dp-modal-body"><Field label="Who should respond?" required><select value={to} onChange={e=>setTo(e.target.value)}><option value="both">Both sides</option><option value="factory">{ORDER.factory}</option><option value="brand">{ORDER.brand}</option></select></Field><Field label="What do you need?" required><textarea required minLength={10} rows={4} value={text} onChange={e=>setText(e.target.value)} placeholder="Close-up collar photos and the number of units affected."/></Field><p className="dp-field-help">Due in 2 business days. Shared on the case timeline.</p></div><footer><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn">Send request</button></footer></form></Modal>;}
function ResolveDialog({world,initial={},onClose,onSubmit}){const [outcome,setOutcome]=useState(initial.outcome??{type:''}),[note,setNote]=useState(initial.note??''),[error,setError]=useState('');return <Modal title="Record resolution" eyebrow="Dispute" onClose={onClose}><form noValidate onSubmit={e=>{e.preventDefault();const o=toOutcome(outcome);const err=outcomeError(o,world)||(!note.trim()?'Give the reason both sides will read.':'');if(err){setError(err);return;}onSubmit(o,note.trim());}}><div className="dp-modal-body"><OutcomeFields value={outcome} onChange={v=>{setOutcome(v);setError('');}} options={OUTCOMES} world={world} error={error&&!note.trim()&&outcome.type?'':error}/><Field label="Reason (shared with both sides)" required error={error&&!note.trim()&&!outcomeError(toOutcome(outcome),world)?error:''}><textarea rows={4} value={note} onChange={e=>{setNote(e.target.value);setError('');}} placeholder="What the evidence shows and why this outcome."/></Field></div><footer><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn">Record resolution</button></footer></form></Modal>;}
function CompleteDialog({world,onClose,onSubmit}){const r=world.case.resolution;const label=completionAction(r,world);return <Modal title={label} eyebrow="Dispute" onClose={onClose}><div className="dp-modal-body"><div className="dp-offer-summary"><small>{r.by==='agreement'?'Agreed by both sides':'Staff decision'}</small><strong>{outcomeLine(r,world)}</strong></div><dl className="dp-case-summary"><div><dt>Funded: held until approval</dt><dd>{money(world.step.heldCents)}</dd></div><div><dt>After this</dt><dd>{r.type==='refund'?`${money(world.step.heldCents-r.amountCents)} held until approval`:r.type==='payout'?`${money(0)} held until approval`:'Order cancelled'}</dd></div></dl></div><footer><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" onClick={onSubmit}>{label}</button></footer></Modal>;}
function ReleaseDialog({world,initial={},onClose,onSubmit}){const [note,setNote]=useState(initial.note??'');return <Modal title="Release other payments" eyebrow="Dispute" onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSubmit(note.trim());}}><div className="dp-modal-body"><p>{ORDER.factory} can withdraw its balance again. {money(world.step.heldCents)} funded on {ORDER.step} stays on hold until the case closes.</p><dl className="dp-case-summary"><div><dt>{ORDER.factory} balance</dt><dd>{money(world.balanceCents)}</dd></div><div><dt>Stays on hold</dt><dd>{money(world.step.heldCents)}</dd></div></dl><Field label="Note for staff"><textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional. Only staff see this."/></Field></div><footer><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn">Release other payments</button></footer></form></Modal>;}

// ---------- Shared case parts ----------
function Progress({record}){const {steps,at}=progress(record);return <div className="dp-progress dp-case-progress" aria-label="Case progress">{steps.map((s,i)=><div key={s} className={i<at||(i===at&&!isOpen(record))?'done':i===at?'current':''}><span>{i<at||(i===at&&!isOpen(record))?'✓':i+1}</span><small>{s}</small></div>)}</div>;}
function Timeline({record,viewer}){const events=record.events.filter(x=>viewer==='admin'||!x.staffOnly);return <ol className="dp-timeline" data-testid="timeline">{events.map((x,i)=><li key={i} className={x.staffOnly?'staff-only':''}><span className={`dp-dot ${x.who}`}/><div><strong>{x.title}{x.staffOnly&&<span className="dp-badge dp-staff-badge">Staff only</span>}</strong><small>{whoName(x.who,viewer)} · {moment(x.at)}</small>{x.detail&&<p>{x.detail}</p>}{x.files?.map((f,j)=><div className="dp-file compact" key={j}><Icon/><div><strong>{f.name}</strong><small>{fileSize(f.size)}</small></div></div>)}</div></li>)}</ol>;}
function RequestSummary({record}){return <dl className="dp-case-summary"><div><dt>Reason</dt><dd>{record.reason}</dd></div><div className="dp-case-description"><dt>What happened</dt><dd>{record.details}</dd></div><div><dt>Affected stage</dt><dd>{record.stage}</dd></div><div><dt>Requested outcome</dt><dd>{outcomeLine({...record.request,amountCents:record.request.amountCents??(['payout','cancel'].includes(record.request.type)?ORDER.stepCents:undefined)})}</dd></div><div className="dp-case-description"><dt>Files</dt><dd>{record.events[0].files.length?record.events[0].files.map((f,i)=><div className="dp-file compact" key={i}><Icon/><div><strong>{f.name}</strong><small>{fileSize(f.size)}</small></div></div>):'None'}</dd></div></dl>;}
function OfferCard({record,world,viewer}){
  if(record.resolution) return <article className="dp-card dp-offer-card resolved" data-testid="outcome-card"><div className="dp-card-head"><h2>Outcome</h2><span className="dp-badge green">{record.resolution.by==='agreement'?'Agreed':viewer==='admin'?'Staff decision':'Decided by our team'}</span></div><strong className="dp-offer-line">{outcomeLine(record.resolution,world)}</strong>{record.resolution.note&&<p>{record.resolution.note}</p>}<small>{record.status===STATUS.completion?STATUS.completion:`Resolved ${moment(record.closedAt)}`}</small></article>;
  if(!record.offer||record.offer.isRequest||!isOpen(record)) return null;
  const o=record.offer;
  return <article className="dp-card dp-offer-card" data-testid="offer-card"><div className="dp-card-head"><h2>Current offer</h2><small>{PARTY_NAME[o.by]} · {moment(o.at)}</small></div><strong className="dp-offer-line">{outcomeLine(o,world)}</strong>{o.note&&<p>{o.note}</p>}</article>;
}
/** The disputed step, in the order page's words. */
const stepWord=(world)=>stepOnHold(world)?<span className="dp-hold">On hold: dispute open</span>:world.order==='cancelled'?'Cancelled':world.step.state==='approved'?'Approved':world.step.state==='paid_out'?'Paid out':world.step.state==='refunded'?'Refunded':world.step.state==='rework'?`Rework due ${dayOf(world.step.due)}`:'Awaiting approval';

// ---------- The case page, brand and factory ----------
function CasePage({side,world,onBack,onAction}){
  const c=world.case;const open=isOpen(c);const mine=waitingOn(c).side===side||waitingOn(c).side==='both';
  const opener=c.openedBy===side;const canAccept=c.offer&&c.offer.by!==side;
  const acceptLabel=c.offer?.isRequest?'Accept the request':'Accept the offer';
  const offerLabel=c.offer&&c.offer.by!==side&&!c.offer.isRequest?'Make a counter-offer':'Make an offer';
  const answering=canAnswer(c,side);
  const line=open?waitingLine(c,side,world.now):c.status===STATUS.withdrawn?`Withdrawn ${moment(c.closedAt)}`:`Resolved ${moment(c.closedAt)}`;
  return <div className="dp-case-page" data-testid="case-page">
    <button className="project-back-link" type="button" onClick={onBack}>‹ Back to order</button>
    <header className="dp-page-heading dp-case-heading"><div><span className="dp-eyebrow">Dispute · {ORDER.number}</span><h1>{c.id}</h1><p>{ORDER.title} · {PARTY_NAME[other(side)]} · Opened {day(c.openedAt)} by {PARTY_NAME[c.openedBy]}</p><p className="dp-handling" data-testid="handling-line"><Icon name="verification"/>{handlingLine(c)}</p></div><StatusBadge status={c.status}/></header>
    <Progress record={c}/>
    <div className="dp-case-layout"><section className="dp-case-main">
      {c.status!==STATUS.resolved&&<article className={`dp-card dp-action-card ${mine?'yours':''}`} data-testid="action-card">
        <strong className="dp-due-line">{line}</strong>
        {windowLine(c)&&<p className="dp-window-line" data-testid="window-line">{windowLine(c)}</p>}
        {c.staffRequest?.to.includes(side)&&<p className="dp-window-line">{c.staffRequest.message}</p>}
        {answering&&<div className="dp-action-row">
          {canAccept&&<button className="primary-btn" type="button" onClick={()=>onAction('respond','accept')}>{acceptLabel}</button>}
          <button className={canAccept?'secondary-btn':'primary-btn'} type="button" onClick={()=>onAction('respond','offer')}>{offerLabel}</button>
          <button className="secondary-btn" type="button" onClick={()=>onAction('respond','reply')}>Reply</button>
        </div>}
        {open&&c.status!==STATUS.completion&&opener&&<div className="dp-link-row"><button className="dp-text-button danger" type="button" onClick={()=>onAction('withdraw')}>Withdraw</button></div>}
      </article>}
      <OfferCard record={c} world={world} viewer={side}/>
      <article className="dp-card"><h2 className="dp-card-title">Request</h2><RequestSummary record={c}/></article>
      <article className="dp-card"><h2 className="dp-card-title">Timeline</h2><Timeline record={c} viewer={side}/></article>
    </section>
    <aside className="dp-review-side">
      <article className="dp-card"><h3>{ORDER.step}</h3><dl className="dp-side-facts"><div><dt>Funded: held until approval</dt><dd>{money(world.step.heldCents)}</dd></div>{world.step.refundedCents>0&&<div><dt>Refunded</dt><dd>{money(world.step.refundedCents)}</dd></div>}<div><dt>Step</dt><dd>{stepWord(world)}</dd></div><div><dt>Due</dt><dd>{dayOf(world.step.due)}</dd></div></dl></article>
      {side==='factory'&&<article className="dp-card"><h3>Withdrawals</h3><p className={withdrawalsPaused(world)?'dp-hold':''}>{withdrawalsPaused(world)?'Paused':'Available'}</p><button className="dp-text-button" type="button" onClick={()=>onAction('payments')}>View balance</button></article>}
      <article className="dp-card"><h3>Order</h3><dl className="dp-side-facts"><div><dt>Order</dt><dd>{ORDER.number}</dd></div><div><dt>Total</dt><dd>{money(ORDER.totalCents)}</dd></div><div><dt>Status</dt><dd>{world.order==='cancelled'?'Cancelled':'In production'}</dd></div></dl></article>
    </aside></div>
  </div>;
}

// ---------- The factory's Payments page: production's markup (PayoutDetails + StripePayoutCard) ----------
const ROW_DATE=d=>new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
function factoryRows(world){
  const s=world.step;const onHold=stepOnHold(world);const order=`${ORDER.brand} · ${ORDER.number}`;
  const bulk=s.state==='approved'||s.state==='paid_out'?{status:'Added to your balance',amount:ORDER.stepCents-s.refundedCents,available:true}
    :s.state==='refunded'||s.state==='cancelled'?null
    :{status:onHold?'On hold':'Awaiting approval',amount:s.heldCents,available:false};
  return [
    ...(bulk?[{id:'bulk',date:'2026-11-20',title:ORDER.step,meta:order,...bulk}]:[]),
    ...(s.refundedCents>0?[{id:'bulk-refund',date:'2026-11-27',title:ORDER.step,meta:order,status:'Refunded',amount:-s.refundedCents,available:true}]:[]),
    {id:'deposit',date:'2026-11-14',title:'Bulk deposit',meta:order,status:'Added to your balance',amount:170100,available:true},
    {id:'pp',date:'2026-11-13',title:'PP sample',meta:order,status:'Added to your balance',amount:16500,available:true},
    {id:'fit',date:'2026-11-08',title:'Fit sample',meta:order,status:'Added to your balance',amount:9500,available:true},
    {id:'hp-final',date:'2026-11-03',title:'Final balance',meta:'Harbor & Pine · TSC-000431',status:'Added to your balance',amount:100000,available:true},
    {id:'wd-1',date:'2026-11-02',title:'Bank transfer',meta:'Bank of China ···· 4821 · Nov 4, 2026',status:'Completed',amount:-325000,available:true,type:'withdrawal'},
    {id:'hp-dep',date:'2026-10-28',title:'Bulk deposit',meta:'Harbor & Pine · TSC-000431',status:'Added to your balance',amount:325000,available:true},
  ];
}
function FactoryPayments({world,notify}){
  const paused=withdrawalsPaused(world);const onHoldCents=stepOnHold(world)?world.step.heldCents:0;
  const [tx,setTx]=useState('all');
  const rows=factoryRows(world).map(r=>({type:'earning',...r})).filter(r=>tx==='all'||r.type===tx);
  const awaiting=['held','rework'].includes(world.step.state)&&!stepOnHold(world)?world.step.heldCents:0;
  const summary=[
    ['Total earnings',world.balanceCents+325000+world.step.heldCents,'Your earnings from funded payments for the selected client, or all clients. Includes payments awaiting approval and withdrawals being processed.'],
    ['Awaiting approval',awaiting,'Funds waiting for the brand to approve the milestone. Once approved, they move toward your available balance.'],
    ['Pending',onHoldCents,'Payments still processing and money on hold.'],
    ['Paid out',325000,'Money that has been paid out to you'],
  ];
  return <section className="billing-history-page live-payments-page dp-payments" data-testid="factory-payments">
    <header className="billing-history-header"><div><h1>Payments</h1></div></header>
    <div className="billing-controls"><div className="settings-access-tabs billing-tabs" role="tablist" aria-label="Payment activity type">{[['earnings','Earnings'],['billing','Billing'],['credits','Credits']].map(([k,l])=><button key={k} className={k==='earnings'?'active':''} type="button" role="tab" aria-selected={k==='earnings'} onClick={()=>k!=='earnings'&&notify('This preview covers disputes.')}>{l}</button>)}</div></div>
    <section className="live-payout-method-card live-stripe-payout-card" data-testid="stripe-payout-card">
      <div className="live-payout-balance">
        <span className="payment-metric-label">Available balance (USD) <PaymentHelp label="Available balance">Money you can withdraw to your bank now. This is your overall balance across all clients.</PaymentHelp></span>
        <strong data-testid="payout-balance">{money(world.balanceCents)}</strong>
        <p className="payout-balance-line" data-testid="payout-balance-line">Earnings stay in your balance until you withdraw them.{paused?' · Withdrawals paused':''}</p>
        {onHoldCents>0?<p data-testid="payout-on-hold">{`${money(onHoldCents)} on hold`}</p>:null}
      </div>
      <div className="live-payout-card-action">
        <button className="primary-btn compact-btn" type="button" data-testid="withdraw-balance" disabled={paused} title={paused?'Withdrawals paused':undefined} onClick={()=>notify('The Withdraw dialog opens here.')}>Withdraw</button>
        <button className="secondary-btn compact-btn" type="button" onClick={()=>notify('Withdrawal methods opens here.')}>Withdrawal methods</button>
      </div>
      <div className="payout-withdrawal-status-row"/>
    </section>
    <label className="payments-client-filter"><span>Filter by client</span><select aria-label="Filter by client" defaultValue="All clients"><option>All clients</option><option>{ORDER.brand}</option><option>Harbor &amp; Pine</option></select></label>
    <div className="project-summary-strip billing-payment-strip factory-earnings-summary" aria-label="Earnings summary">{summary.map(([label,cents,help],i)=><div className={`metric${i===0?' highlight':''}`} key={label}><strong><span className="payment-currency-value">{money(cents)}</span></strong><span className="payment-metric-label">{label} <PaymentHelp label={label}>{help}</PaymentHelp></span></div>)}</div>
    <section className="payout-transactions-section" aria-labelledby="transactions-heading">
      <div className="payout-transactions-header"><div><h2 id="transactions-heading">Transactions</h2><p>Earnings added to your balance and withdrawals sent to your payout account.</p></div>
        <div className="payout-transaction-filters" role="group" aria-label="Filter transactions">{[['all','All'],['earning','Earnings'],['withdrawal','Withdrawals']].map(([k,l])=><button key={k} type="button" className={tx===k?'active':''} aria-pressed={tx===k} onClick={()=>setTx(k)}>{l}</button>)}</div></div>
      <div className="payout-transaction-table"><div className="payout-transaction-labels" aria-hidden="true"><span>Date</span><span>Type / details</span><span>Status</span><span>Amount</span></div>
        {rows.map(row=><article className="payout-transaction-row" key={row.id} data-testid={`tx-${row.id}`}><time>{ROW_DATE(row.date)}</time><div className="payout-transaction-details"><span className={`payout-transaction-type ${row.type}`}>{row.type==='earning'?'Earning':'Withdrawal'}</span><div><strong>{row.title}</strong><span>{row.meta}</span></div></div><span className={`billing-status payout-status-${row.status.toLowerCase().replaceAll(' ','-')}`}>{row.status}</span><strong className={row.amount<0?'payout-amount-negative':row.available?'payout-amount-positive':'payout-amount-pending'}>{row.amount<0?'−':row.available?'+':''}{money(Math.abs(row.amount))}</strong></article>)}
      </div>
    </section>
  </section>;
}

// ---------- Admin ----------
function AdminQueue({world,tab,setTab,onOpen,notify}){
  const c=world.case;
  const rows=[...(c?[(r=>({...r,waiting:sideName(r.waiting),live:true}))(queueRow(c))]:[]),...sampleRows];
  const isClosed=r=>r.status===STATUS.resolved||r.status===STATUS.withdrawn;
  const shown=rows.filter(r=>tab==='resolved'?isClosed(r):!isClosed(r));
  const age=r=>{const d=Math.floor((world.now-r.openedAt)/86400000);return d<1?'Today':`${d} ${d===1?'day':'days'}`;};
  return <><AdminQueueTabs label="Dispute queues" tabs={[{key:'open',label:'Open',count:rows.filter(r=>!isClosed(r)).length},{key:'resolved',label:'Resolved',count:rows.filter(isClosed).length}]} active={tab} onChange={setTab}/>
    {shown.length?<div className="admin-table-wrap"><table className="admin-table dp-disputes-table" data-testid="admin-queue"><thead><tr>{['Case','Order / parties','Reason','Status','Waiting on','Due','Assigned to','Age',''].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{shown.map(r=>{const overdue=r.dueAt&&r.dueAt<world.now&&!isClosed(r);return <tr key={r.id} className={r.live?'dp-live-row':''}><td><strong>{r.id}</strong></td><td><strong>{r.order}</strong><p>{r.title}</p><small>{r.parties}</small></td><td>{r.reason}<p>{r.stage}</p></td><td><StatusBadge status={r.status}/></td><td>{isClosed(r)?'—':r.waiting}</td><td className={overdue?'dp-overdue':''}>{isClosed(r)||!r.dueAt?'—':overdue?`Overdue · ${day(r.dueAt)}`:day(r.dueAt)}</td><td>{r.assignee}</td><td>{age(r)}</td><td><button className="secondary-btn compact-btn" type="button" onClick={()=>r.live?onOpen():notify('Sample row. Open the order’s own case to walk the flow.')}>Review case</button></td></tr>;})}</tbody></table></div>:<p className="projects-empty">No {tab==='resolved'?'resolved':'open'} cases.</p>}</>;
}

function AdminCase({world,tab,setTab,onAction,onNote}){
  const c=world.case;const [note,setNote]=useState('');const open=isOpen(c);const w=waitingOn(c);
  const overdue=w.dueAt&&w.dueAt<world.now;
  const visible=c.events;
  return <><div className="dp-case-banner"><StatusBadge status={c.status}/><span>Opened by <strong>{PARTY_NAME[c.openedBy]}</strong> · {c.stage} · {day(c.openedAt)}</span>{open&&<span>Waiting on <strong>{sideName(w.side)}</strong>{w.dueAt&&<> · <span className={overdue?'dp-overdue':''}>{overdue?'Overdue · ':'Due '}{day(w.dueAt)}</span></>}</span>}{windowLine(c)&&<span>{windowLine(c)}</span>}<span className="dp-assignee">Assigned to <strong>{STAFF}</strong></span></div>
    <Progress record={c}/>
    <div className="dp-case-layout"><section><AdminQueueTabs label="Dispute case sections" tabs={[{key:'Case details',label:'Case details'},{key:'Evidence',label:'Evidence',count:c.files.length},{key:'Timeline',label:'Timeline',count:visible.length}]} active={tab} onChange={setTab}/>
      <article className="dp-card dp-case-content">{tab==='Case details'?<><span className="dp-eyebrow">{c.reason}</span><h2>{ORDER.title}</h2><RequestSummary record={c}/></>:tab==='Evidence'?<><h2>Evidence</h2>{c.files.length?c.files.map((f,i)=><div className="dp-file" key={i}><Icon/><div><strong>{f.name}</strong><small>{fileSize(f.size)}</small></div><span className="dp-badge">Evidence {i+1}</span></div>):<div className="dp-note">No files yet.</div>}</>:<><h2>Timeline</h2><Timeline record={c} viewer="admin"/></>}</article>
      <OfferCard record={c} world={world} viewer="admin"/>
      <article className="dp-card dp-staff-notes" data-testid="staff-notes"><div className="dp-card-head"><h2>Staff notes</h2><span className="dp-badge">Only staff</span></div>{c.staffNotes.map((n,i)=><div className="dp-staff-note" key={i}><small>{STAFF} · {moment(n.at)}</small><p>{n.text}</p></div>)}<form className="dp-note-form" onSubmit={e=>{e.preventDefault();if(note.trim()){onNote(note.trim());setNote('');}}}><textarea rows={2} value={note} onChange={e=>setNote(e.target.value)} placeholder="Add a private note"/><button className="secondary-btn compact-btn" disabled={!note.trim()}>Add note</button></form></article>
    </section>
    <aside className="dp-review-side">
      {open&&<article className="dp-card" data-testid="admin-actions"><h2>Actions</h2>{c.status===STATUS.completion?<button className="primary-btn" data-testid="complete-btn" onClick={()=>onAction('complete')}>{completionAction(c.resolution,world)}</button>:<><button className="secondary-btn" onClick={()=>onAction('request')}>Request a response</button><button className="primary-btn" onClick={()=>onAction('resolve')}>Record resolution</button></>}{!c.otherReleased&&withdrawalsPaused(world)&&<button className="secondary-btn" data-testid="release-btn" onClick={()=>onAction('release')}>Release other payments</button>}</article>}
      <article className="dp-card"><h3>Money</h3><dl className="dp-side-facts"><div><dt>Funded: held until approval</dt><dd>{money(world.step.heldCents)}</dd></div><div><dt>{ORDER.step}</dt><dd>{stepOnHold(world)?<span className="dp-hold">On hold</span>:stepWord(world)}</dd></div><div><dt>{ORDER.factory} balance</dt><dd>{money(world.balanceCents)}</dd></div><div><dt>Withdrawals</dt><dd data-testid="admin-withdrawals">{withdrawalsPaused(world)?<span className="dp-hold">Paused</span>:c.otherReleased&&open?'Released · step on hold':'Available'}</dd></div></dl></article>
      <article className="dp-card"><h3>Order</h3><dl className="dp-side-facts"><div><dt>{ORDER.number}</dt><dd>{money(ORDER.totalCents)}</dd></div><div><dt>Brand</dt><dd>{ORDER.brand}</dd></div><div><dt>Factory</dt><dd>{ORDER.factory}</dd></div></dl></article>
    </aside></div></>;
}

// ---------- Emails ----------
const emailEnv={appUrl:'https://sourcing-club.com',logoUrl:'/assets/logo.png',supportEmail:'operations@contact.sourcing-club.com',companyAddress:'New York, USA'};
const EMAIL_KINDS=[['opened','Case opened'],['offer','Offer made'],['deciding','Our team is deciding'],['request','Response requested'],['withdrawn','Withdrawn'],['resolved','Resolved']];
function emailFor(e){
  const isFactory=e.to==='factory';const company=PARTY_NAME[e.to];
  const row={kind:`dispute_${e.kind}`,title:e.title,body:e.body,category:'payments',org_type:isFactory?'factory':'brand',org_name:company,recipient_name:isFactory?'Wei':'Maya',subject_type:'order',subject_id:ORDER.number,locale:'en',time_zone:'America/New_York'};
  const out=notificationEmail(row,emailEnv);
  // Dispute emails ignore the email settings, so the footer says what is true: the always-sent line.
  const why=`You’re receiving this because ${company} has “Payment and approval requests” emails turned on. Anyone with Settings access can turn them off in Settings → Notifications.`;
  const esc=s=>s.replaceAll('&','&amp;').replaceAll('“','&ldquo;').replaceAll('”','&rdquo;');
  let html=out.html.replaceAll(`/orders/${ORDER.number}`,`/orders/${ORDER.number}/dispute`);
  for(const v of [why,esc(why),why.replaceAll('’','&rsquo;'),why.replaceAll('’','&#8217;')]) html=html.replace(v,`Sent to everyone at ${company}.`);
  return {...out,html};
}
const sampleEmails={
  opened:{to:'factory',kind:'opened',title:`${ORDER.brand} opened a dispute on ${ORDER.number}`,body:`Quality or workmanship on "${ORDER.title}". Our team is handling this case (${STAFF}). Respond by Nov 30. If it is not settled by Dec 3, our team decides.`},
  offer:{to:'brand',kind:'offer',title:`${ORDER.factory} made an offer on ${ORDER.number}`,body:`Refund $850.00 to ${ORDER.brand}. Respond by Dec 1.`},
  deciding:{to:'factory',kind:'deciding',title:`${ORDER.number} dispute: our team is deciding`,body:`No agreement by Dec 3. Our team will decide the outcome and may ask you for more. You can still settle with ${ORDER.brand} until then.`},
  request:{to:'factory',kind:'request',title:`Our team asked for your response on ${ORDER.number}`,body:'Please send the revised production plan and the earliest date you can ship all 300 shirts. Respond by Dec 8.'},
  withdrawn:{to:'brand',kind:'withdrawn',title:`${ORDER.factory} withdrew the dispute on ${ORDER.number}`,body:'The order continues as before.'},
  resolved:{to:'factory',kind:'resolved',title:`${ORDER.number} dispute resolved`,body:`Refund $850.00 to ${ORDER.brand}. You can withdraw your balance again.`},
};
function EmailsPage({world}){
  const byKind=k=>[...world.emails].reverse().find(e=>e.kind===k)??sampleEmails[k];
  return <div data-testid="emails"><header className="dp-page-heading"><div><span className="dp-eyebrow">Preview</span><h1>Emails</h1><p>Built with the product’s notification email. Links open the case page. Sent whatever the company’s email settings.</p></div></header>
    <div className="dp-email-grid">{EMAIL_KINDS.map(([k,label])=>{const e=byKind(k);const m=emailFor(e);return <figure key={k} className="dp-email"><figcaption><span className="dp-badge">{label}</span><small>To {PARTY_NAME[e.to]} · Subject: {m.subject}</small></figcaption><iframe title={m.subject} srcDoc={m.html} data-testid={`email-${k}`}/></figure>;})}</div></div>;
}

// ---------- The walkthrough (preview-only chrome) ----------
function Walkthrough({index,offScript,onGo,onClose}){
  const listRef=useRef();
  useEffect(()=>{listRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({block:'nearest'});},[index]);
  const groups=[];STEPS.forEach((s,i)=>{if(!groups.length||groups.at(-1).path!==s.path)groups.push({path:s.path,items:[]});groups.at(-1).items.push(i);});
  const cur=index==null?null:STEPS[index];
  return <aside className="dp-player" aria-label="Walkthrough" data-testid="player">
    <header><div><b>WALKTHROUGH</b><small>Preview only · not product UI</small></div><button type="button" className="dp-player-x" aria-label="Hide walkthrough" onClick={onClose}>×</button></header>
    <div className="dp-player-now">{cur?<><span>Step {index+1} of {STEPS.length}</span><p data-testid="player-caption">{cur.caption}</p>{offScript&&<small>You are clicking around from this step. Pick any step to go back.</small>}</>:<p>Pick a step, or use ← →.</p>}
      <div className="dp-player-nav"><button type="button" disabled={index===0} onClick={()=>onGo(index==null?0:index-1)}>‹ Previous</button><button type="button" className="primary" disabled={index===STEPS.length-1} onClick={()=>onGo(index==null?0:index+1)}>Next ›</button></div></div>
    <ol ref={listRef}>{groups.map(g=><li key={g.path}><h4>{g.path}</h4><ol>{g.items.map(i=><li key={i}><button type="button" aria-current={i===index?'step':undefined} onClick={()=>onGo(i)}><span>{i+1}</span>{STEPS[i].caption}</button></li>)}</ol></li>)}</ol>
  </aside>;
}

// ---------- The preview ----------
const readPlayerOpen=()=>{try{const q=new URLSearchParams(location.search).get('player');if(q)return q!=='closed';return localStorage.getItem('dpPlayer')!=='closed';}catch{return true;}};
function Preview(){
  const [world,setWorld]=useState(initialWorld);
  const [view,setView]=useState('brand');
  const [page,setPage]=useState({brand:'orders',factory:'orders',admin:'queue'});
  const [collapsed,setCollapsed]=useState(false),[modal,setModal]=useState(null),[toast,setToast]=useState(''),[bell,setBell]=useState(false),[queueTab,setQueueTab]=useState('open'),[adminTab,setAdminTab]=useState('Case details');
  const [stepIndex,setStepIndex]=useState(null),[stepWorld,setStepWorld]=useState(null),[playerOpen,setPlayerOpen]=useState(readPlayerOpen),[stepMenuAt,setStepMenuAt]=useState(0),[orderKey,setOrderKey]=useState(0);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(t);},[toast]);
  useEffect(()=>{window.scrollTo(0,0);},[view,page]);
  useEffect(()=>{try{localStorage.setItem('dpPlayer',playerOpen?'open':'closed');}catch{}},[playerOpen]);
  const notify=setToast;
  const isAdmin=view==='admin',isParty=view==='brand'||view==='factory';
  const current=page[view];
  const go=(p,v=view)=>{setPage(x=>({...x,[v]:p}));setModal(null);setBell(false);};
  // Every action lets a little mock time pass, so the timeline reads like a real one.
  const run=(fn)=>{try{const next=tick(fn(world));setWorld(next);setModal(null);return next;}catch(x){notify(x.message);return null;}};

  const goStep=useCallback((i)=>{
    const s=STEPS[Math.max(0,Math.min(STEPS.length-1,i))];const idx=STEPS.indexOf(s);
    const w=worldAt(idx);
    setWorld(w);setStepWorld(w);setStepIndex(idx);setOrderKey(k=>k+1);
    setView(s.view);if(s.view!=='emails')setPage(x=>({...x,[s.view]:s.page}));
    setQueueTab('open');setAdminTab(s.adminTab??'Case details');setBell(Boolean(s.bell));setToast('');
    setModal(s.modal?{...s.modal}:null);
    if(s.stepMenu)setStepMenuAt(n=>n+1);
    try{const u=new URL(location.href);u.searchParams.set('step',String(idx+1));history.replaceState(null,'',u);}catch{}
  },[]);
  useEffect(()=>{const n=Number(new URLSearchParams(location.search).get('step'));if(n>=1&&n<=STEPS.length)goStep(n-1);},[goStep]);
  useEffect(()=>{function key(e){if(!playerOpen&&stepIndex==null)return;if(e.target.closest?.('input,select,textarea,[contenteditable]'))return;if(e.key==='ArrowRight'){e.preventDefault();goStep(stepIndex==null?0:stepIndex+1);}if(e.key==='ArrowLeft'&&stepIndex>0){e.preventDefault();goStep(stepIndex-1);}}document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[playerOpen,stepIndex,goStep]);
  // A step on a step's own menu: open the order page's real menu for Bulk production.
  useEffect(()=>{if(!stepMenuAt)return;const t=setTimeout(()=>{const b=document.querySelector(`button[aria-label="More actions for ${ORDER.step}"]`);b?.scrollIntoView({block:'center'});b?.click();},120);return()=>clearTimeout(t);},[stepMenuAt]);

  const offScript=stepIndex!=null&&(world!==stepWorld||(STEPS[stepIndex].view!==view));
  const paths={orders:'/orders',order:`/orders/${ORDER.number}`,case:`/orders/${ORDER.number}/dispute`,payments:'/payout',queue:'/admin.html/disputes',adminCase:`/admin.html/disputes/${world.case?.id??''}`};
  const path=view==='emails'?'Emails':(isAdmin?'':'/app.html')+paths[current];
  const unread=isParty?world.notifications[view].filter(n=>n.unread).length:0;
  const account=isAdmin?{initials:'TS',name:'TSC Operations',type:'Admin workspace'}:view==='factory'?{initials:'NL',name:ORDER.factory,type:'Factory account'}:{initials:'FS',name:ORDER.brand,type:'Brand account'};
  const navItems=isAdmin?disputeAdminNav:view==='factory'?factoryNav:brandNav;
  const active=isAdmin?'Disputes':current==='payments'?'Payments':'Production orders';
  function onNav(label){if(isAdmin){if(label==='Disputes')go('queue');else notify('This preview covers disputes.');return;}if(label==='Production orders')go('orders');else if(label==='Payments'&&view==='factory')go('payments');else notify('This preview covers disputes.');}
  function partyAction(kind,arg){if(kind==='payments')go('payments');else setModal({kind,arg});}
  function openBellItem(item){setWorld(w=>({...w,notifications:{...w.notifications,[view]:w.notifications[view].map(n=>n.id===item.id?{...n,unread:false}:n)}}));go(world.case?'case':item.type==='Payments'?'payments':'orders');}
  const bellItems=isParty?world.notifications[view].map(n=>({...n,time:moment(n.at)})):[];
  const switchView=v=>{setView(v);setModal(null);setBell(false);};
  return <div className={`app-shell dp-app ${isAdmin?'admin-app':''} ${collapsed?'nav-collapsed':''} ${playerOpen?'with-player':''} ${bell?'with-drawer':''}`}>
    {view!=='emails'&&<PrototypeSideNav account={account} active={active} collapsed={collapsed} onToggle={()=>setCollapsed(!collapsed)} navItems={navItems} onNav={onNav}/>}
    <div className={`dp-main ${view==='emails'?'dp-main-full':''}`}>
      <div className="dp-preview-bar" data-testid="preview-bar"><span><b>LOCAL PREVIEW</b> · {day(world.now)} · <code>{path}</code></span><div role="group" aria-label="Preview perspective">{[['brand','Brand'],['factory','Factory'],['admin','Admin'],['emails','Emails']].map(([v,l])=><button key={v} className={view===v?'selected':''} onClick={()=>switchView(v)}>{l}</button>)}</div><div className="dp-preview-tools"><button type="button" data-testid="skip" onClick={()=>{setWorld(w=>advance(w,1));notify('Moved to the next business day, 9:00 AM.');}}>Next business day</button><button type="button" onClick={()=>{setWorld(initialWorld());setPage({brand:'orders',factory:'orders',admin:'queue'});setQueueTab('open');setModal(null);setStepIndex(null);}}>Reset</button>{!playerOpen&&<button type="button" data-testid="player-open" onClick={()=>setPlayerOpen(true)}>Walkthrough{stepIndex!=null?` ${stepIndex+1}/${STEPS.length}`:''}</button>}</div></div>
      {isParty&&<button className="activity-icon-btn dp-bell" type="button" aria-label="Open activity" data-testid="bell" onClick={()=>setBell(true)}><img src="/assets/prototype-icons/notification.svg" alt=""/>{unread>0&&<b aria-hidden="true">{unread}</b>}</button>}
      {view==='emails'?<EmailsPage world={world}/>
      :isAdmin?(current==='adminCase'&&world.case?<><button className="admin-back-link" type="button" onClick={()=>go('queue')}>‹ Back to disputes</button><header className="dp-page-heading"><div><span className="dp-eyebrow">Dispute</span><h1>{world.case.id}</h1><p>{ORDER.number} · {ORDER.title} · {ORDER.brand} / {ORDER.factory}</p></div></header><AdminCase world={world} tab={adminTab} setTab={setAdminTab} onAction={k=>setModal({kind:k})} onNote={t=>setWorld(w=>addStaffNote(w,t))}/></>
        :<><header className="dp-page-heading"><div><span className="dp-eyebrow">Admin</span><h1>Disputes</h1></div></header><AdminQueue world={world} tab={queueTab} setTab={setQueueTab} onOpen={()=>go('adminCase')} notify={notify}/></>)
      :current==='case'&&world.case?<CasePage side={view} world={world} onBack={()=>go('order')} onAction={partyAction}/>
      :current==='payments'?<FactoryPayments world={world} notify={notify}/>
      :<NativeOrders key={orderKey} view={view} open={current==='order'} onOpen={()=>go('order')} onBack={()=>go('orders')} world={world} onOpenDispute={(initial)=>setModal({kind:'open',initial})} onViewCase={()=>go('case')} onApproveStep={()=>Boolean(run(approveStep))&&(notify('Approved.'),true)} notify={notify}/>}
      {toast&&<div className="dp-toast" role="status">{toast}</div>}
    </div>
    {playerOpen&&<Walkthrough index={stepIndex} offScript={offScript} onGo={goStep} onClose={()=>setPlayerOpen(false)}/>}
    {bell&&<ActivityDrawer items={bellItems} description="Updates on your orders and payments." emptyText="No notifications yet." onOpenItem={openBellItem} onClose={()=>setBell(false)}/>}
    {modal?.kind==='open'&&<OpenDisputeDialog key={`open-${stepIndex}`} side={view} world={world} initial={modal.initial} onClose={()=>setModal(null)} onSubmit={form=>{const next=run(w=>openCase(w,view,form));if(next)setModal({kind:'submitted'});}}/>}
    {modal?.kind==='submitted'&&world.case&&<SubmittedDialog record={world.case} onClose={()=>setModal(null)} onView={()=>go('case')}/>}
    {modal?.kind==='respond'&&<RespondDialog key={`respond-${stepIndex}`} side={view} world={world} mode={modal.arg} initial={modal.initial} onClose={()=>setModal(null)} onSubmit={r=>{if(run(w=>respond(w,view,r)))notify(r.action==='accept'?'Accepted.':r.action==='offer'?'Offer sent.':'Reply sent.');}}/>}
    {modal?.kind==='withdraw'&&<WithdrawDialog record={world.case} onClose={()=>setModal(null)} onSubmit={()=>run(w=>withdraw(w,view))}/>}
    {modal?.kind==='request'&&<RequestDialog initial={modal.initial} onClose={()=>setModal(null)} onSubmit={(to,text)=>{if(run(w=>requestResponse(w,to,text)))notify('Request sent.');}}/>}
    {modal?.kind==='resolve'&&<ResolveDialog world={world} initial={modal.initial} onClose={()=>setModal(null)} onSubmit={(o,n)=>{if(run(w=>recordResolution(w,o,n)))notify('Resolution recorded.');}}/>}
    {modal?.kind==='complete'&&<CompleteDialog world={world} onClose={()=>setModal(null)} onSubmit={()=>{if(run(w=>completeResolution(w)))notify('Done. The case is resolved.');}}/>}
    {modal?.kind==='release'&&<ReleaseDialog world={world} initial={modal.initial} onClose={()=>setModal(null)} onSubmit={note=>{if(run(w=>releaseOtherPayments(w,note)))notify('Other payments released.');}}/>}
  </div>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
