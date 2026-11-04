import test from 'node:test';
import assert from 'node:assert/strict';
import { closeCallWindowsForSignOut, openCallWindow, currentCallWindow, callWindowChannel } from '../src/app/message/call-window.js';
test('logout closes a detached call and notifies a popup even after the opener lost its handle', () => {
  const originalChannel=globalThis.BroadcastChannel;
  const originalWindow=globalThis.window;
  const peers=new Set();
  class Channel {
    constructor(){peers.add(this);}
    postMessage(data){for(const peer of peers)if(peer!==this)peer.onmessage?.({data});}
    close(){peers.delete(this);}
  }
  globalThis.BroadcastChannel=Channel;
  let closed=0, left=0;
  globalThis.window={open:()=>({close:()=>closed++,closed:false})};
  const popup=callWindowChannel('call',{onLeave:()=>left++});
  try {
    openCallWindow({id:'call',thread_id:'thread'});
    closeCallWindowsForSignOut();
    assert.equal(closed,1);
    assert.equal(currentCallWindow(),null);
    assert.ok(left>0);
    left=0;
    closeCallWindowsForSignOut();
    assert.equal(left,1);
  } finally {
    popup.close();
    globalThis.BroadcastChannel=originalChannel;
    globalThis.window=originalWindow;
  }
});
