import assert from 'node:assert/strict';
import {responseDeadline,requestResponse,receiveResponse,recordResolution,completeResolution} from '../dispute-preview-state.mjs';
const initial={status:'Awaiting response',pendingResponders:['Factory'],events:[],files:[]};
assert.equal(receiveResponse(initial,'Brand','Extra details').status,'Awaiting response');
assert.equal(receiveResponse(initial,'Factory','Our response').status,'Ready for TSC review');
const deadline=responseDeadline(2,new Date(2026,10,27,12)); // Friday → Tuesday
assert.equal(new Date(deadline).getDay(),2);
let record=requestResponse(initial,['Brand','Factory'],deadline,'Please supply photos.');
assert.equal(record.status,'Awaiting response');
record=receiveResponse(record,'Brand','Here are our photos');
assert.equal(record.status,'Awaiting response');
assert.deepEqual(record.pendingResponders,['Factory']);
record=receiveResponse(record,'Factory','Here is our evidence');
assert.equal(record.status,'Ready for TSC review');
assert.equal(record.responseDueAt,null);
record=recordResolution(record,'Rework or replacement','Replace affected collars by Friday.','65');
assert.equal(record.status,'Awaiting completion');
assert.equal(receiveResponse(record,'Factory','Work is complete').status,'Awaiting completion');
record=requestResponse(record,['Brand'],deadline,'Confirm the replacement was received.');
assert.equal(record.status,'Awaiting response');
record=receiveResponse(record,'Brand','Received and checked');
assert.equal(record.status,'Awaiting completion');
record=completeResolution(record,'Brand confirmed receipt and quality.');
assert.equal(record.status,'Resolved');
assert.equal(record.events.at(-1).title,'TSC confirmed completion');
assert.throws(()=>completeResolution(initial,'Done'),/Record a resolution/);
assert.equal(initial.events.length,0); // Transitions do not mutate the previous record.
console.log('Dispute preview lifecycle checks pass.');
