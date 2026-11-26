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
    : record.status === 'Awaiting completion' ? 'Awaiting completion'
    : pendingResponders.length ? 'Awaiting response'
    : record.resolution ? 'Awaiting completion' : 'Ready for TSC review';
  return {...record, status, pendingResponders,
    responseDueAt:pendingResponders.length ? record.responseDueAt : null,
    files:[...record.files,...files], events:addEvent(record,`${person} responded`,message)};
}
export function recordResolution(record, outcome, details, amount) {
  return {...record,status:'Awaiting completion',resolution:outcome,decision:details,decisionAmount:amount,
    pendingResponders:[],responseDueAt:null,
    events:addEvent(record,'TSC recorded the resolution',`${outcome}: ${details}`)};
}
export function completeResolution(record, note) {
  if (!record.resolution) throw new Error('Record a resolution before confirming completion.');
  return {...record,status:'Resolved',pendingResponders:[],responseDueAt:null,completionNote:note,
    events:addEvent(record,'TSC confirmed completion',note)};
}
