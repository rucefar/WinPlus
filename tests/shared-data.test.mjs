import test from 'node:test';
import assert from 'node:assert/strict';
import {merge,sharedPart,validateShared} from '../shared-data.mjs';

const seed=()=>({cells:{'mc-0-0':'目標'},fields:{},mindmap:[{id:'root',text:'團隊',parentId:null}],ninety90:[{id:1,name:'小王',address:'台北',stage:0}]});
test('only the intended scope is shared',()=>{
  const data=sharedPart({...seed(),notebook:{notes:['private']},reviewData:{secret:true},hundredState:{secret:true}});
  assert.deepEqual(Object.keys(data).sort(),['cells','fields','mindmap','ninety90']);
});
test('simultaneous changes to different records and fields merge',()=>{
  const base=seed(),a=structuredClone(base),b=structuredClone(base);
  a.ninety90[0].name='王先生';b.ninety90[0].address='台中';b.cells['mc-0-1']='新目標';
  const next=merge(base,a,b);
  assert.equal(next.ninety90[0].name,'王先生');assert.equal(next.ninety90[0].address,'台中');assert.equal(next.cells['mc-0-1'],'新目標');
});
test('simultaneous customer additions survive',()=>{
  const base=seed(),a=structuredClone(base),b=structuredClone(base);
  a.ninety90.push({id:2,name:'A'});b.ninety90.push({id:3,name:'B'});
  assert.equal(merge(base,a,b).ninety90.length,3);
});
test('deletions and cleared cells propagate',()=>{
  const base=seed(),a=structuredClone(base);a.ninety90=[];a.cells={};
  assert.deepEqual(merge(base,a,base),a);
});
test('conflicting edits and edit-versus-delete reject instead of overwriting',()=>{
  const base=seed(),a=structuredClone(base),b=structuredClone(base);
  a.ninety90[0].name='A';b.ninety90[0].name='B';
  assert.throws(()=>merge(base,a,b),{code:'sync-conflict'});
  b.ninety90=[];assert.throws(()=>merge(base,a,b),{code:'sync-conflict'});
});
test('acknowledgement preserves edits made during an in-flight write',()=>{
  const base=seed(),submitted=structuredClone(base),newer=structuredClone(base);
  submitted.cells['mc-0-0']='first';newer.cells['mc-0-0']='second';
  // A new edit to the same field after submission is rebased against submitted state.
  assert.equal(merge(submitted,newer,submitted).cells['mc-0-0'],'second');
});
test('concurrent reparent creates no unnoticed cycle',()=>{
  const data=seed();data.mindmap.push({id:'a',text:'A',parentId:'b'},{id:'b',text:'B',parentId:'a'});
  assert.throws(()=>validateShared(data),/組織結構/);
});
test('unsafe identifiers and duplicate records are rejected',()=>{
  const data=seed();data.mindmap[0].id='\" onclick=\"';assert.throws(()=>validateShared(data));
  const duplicate=seed();duplicate.ninety90.push(duplicate.ninety90[0]);assert.throws(()=>validateShared(duplicate),/重複/);
});
