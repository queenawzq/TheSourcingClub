// In-memory case transitions for the local mockup. No payment or backend calls.
export function responseDeadline(days = 2, now = new Date()) {
  const due = new Date(now);
  let remaining = days;
  while (remaining > 0) {
    due.setDate(due.getDate() + 1);
    if (![0, 6].includes(due.getDay())) remaining--;
  }
  return due.toISOString();
}
const addEvent = (record, title, detail) => [...record.events, {title, detail, at:'Just now'}];
export function requestResponse(record, recipients, dueAt, message) {
  return {...record, status:'Awaiting response', pendingResponders:recipients, responseDueAt:dueAt,
    events:addEvent(record,'TSC requested a response',`${recipients.join(' and ')} · Reply by ${new Date(dueAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}: ${message}`)};
}
export function receiveResponse(record, person, message, files = []) {
  const waiting = record.pendingResponders ?? [];
  const pendingResponders = waiting.filter(name => name !== person);
  // A supplementary note from the opener does not satisfy the other party's request.
  const status = record.status === 'Resolved' ? 'Resolved'
    : record.proposals?.some(p => p.status === 'Pending') ? 'Awaiting solution response'
    : record.status === 'Awaiting completion' ? 'Awaiting completion'
    : pendingResponders.length ? 'Awaiting response'
    : record.resolution ? 'Awaiting completion' : 'Ready for TSC review';
  return {...record, status, pendingResponders,
    responseDueAt:pendingResponders.length ? record.responseDueAt : null,
    files:[...record.files,...files], events:addEvent(record,`${person} responded`,message)};
}
export function recordResolution(record, outcome, details, amount) {
  return {...record,status:'Awaiting completion',resolution:outcome,decision:details,decisionAmount:amount,
    proposals:record.proposals?.map(p=>p.status==='Pending'?{...p,status:'Closed by TSC'}:p),
    pendingResponders:[],responseDueAt:null,
    events:addEvent(record,'TSC recorded the resolution',`${outcome}: ${details}`)};
}
export function completeResolution(record, note) {
  if (!record.resolution) throw new Error('Record a resolution before confirming completion.');
  return {...record,status:'Resolved',pendingResponders:[],responseDueAt:null,completionNote:note,
    events:addEvent(record,'TSC confirmed completion',note)};
}

// Shared solution proposals. Acceptance records an agreement; completion remains a separate step.
export function proposeSolution(record, by, to, terms) {
  if (record.status === 'Resolved' || record.resolution) throw new Error('This case already has a recorded resolution.');
  if (!by || !to || by === to) throw new Error('A proposal must be addressed to the other party.');
  const previous = record.proposals ?? [];
  const pending = previous.find(p => p.status === 'Pending');
  if (pending && pending.to !== by) throw new Error('Wait for the other party to respond to your proposal.');
  if (!terms.outcome || !terms.details?.trim()) throw new Error('Select a solution and describe the proposed actions.');
  if (terms.amount && (!/^\d+(\.\d{1,2})?$/.test(String(terms.amount)) || Number(terms.amount) <= 0 || Number(terms.amount) > 5735)) throw new Error('Enter an amount between $0.01 and $5,735.00.');
  const proposal = {id:`SOL-${previous.length+1}`,by,to,outcome:terms.outcome,details:terms.details.trim(),amount:terms.amount || '',dueDate:terms.dueDate || '',status:'Pending'};
  return {...record,status:'Awaiting solution response',pendingResponders:[],responseDueAt:null,
    proposals:[...previous.map(p => p.status === 'Pending' ? {...p,status:'Superseded'} : p),proposal],
    events:addEvent(record,`${by} ${pending ? 'sent a counterproposal' : 'proposed a solution'}`,`${proposal.outcome}: ${proposal.details}${proposal.amount ? ` · Amount: $${proposal.amount}` : ''}${proposal.dueDate ? ` · Complete by ${proposal.dueDate}` : ''}`)};
}
export function answerSolution(record, person, id, answer, reason = '') {
  if (record.status === 'Resolved' || record.resolution) throw new Error('This case already has a recorded resolution.');
  const proposal = record.proposals?.find(p => p.id === id);
  if (!proposal || proposal.status !== 'Pending') throw new Error('This proposal is no longer awaiting a response.');
  if (proposal.to !== person) throw new Error('Only the other party can respond to this proposal.');
  if (!['Accepted','Declined'].includes(answer)) throw new Error('Select an answer.');
  if (answer === 'Declined' && !reason.trim()) throw new Error('Explain why this solution does not work for you.');
  const accepted = answer === 'Accepted';
  return {...record,status:accepted ? 'Awaiting completion' : 'Ready for TSC review',pendingResponders:[],responseDueAt:null,
    proposals:record.proposals.map(p => p.id === id ? {...p,status:answer,responseBy:person,responseNote:reason.trim()} : p),
    ...(accepted ? {resolution:proposal.outcome,decision:proposal.details,decisionAmount:proposal.amount,agreedDueDate:proposal.dueDate,agreement:{proposalId:id,proposedBy:proposal.by,acceptedBy:person}} : {}),
    events:addEvent(record,`${person} ${accepted ? 'accepted' : 'declined'} ${proposal.by}’s solution`,accepted ? `${proposal.outcome} · Both parties agreed; completion still needs to be confirmed.` : reason.trim())};
}
