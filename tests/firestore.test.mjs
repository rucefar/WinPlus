import test,{before,after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,collection,query,where,getDocs,writeBatch,serverTimestamp,onSnapshot} from 'firebase/firestore';
import assert from 'node:assert/strict';
let env,owner,member,stranger;
const identity=email=>({email,email_verified:true,firebase:{sign_in_provider:'google.com'}});
const state={cells:{},fields:{},mindmap:[],ninety90:[]};
before(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-winplus',firestore:{host:'127.0.0.1',port:8085,rules:await readFile('firestore.rules','utf8')}});
  owner=env.authenticatedContext('owner',identity('owner@gmail.com')).firestore();
  member=env.authenticatedContext('member',identity('Member@gmail.com')).firestore();
  stranger=env.authenticatedContext('stranger',identity('stranger@gmail.com')).firestore();
});
after(async()=>{await env.cleanup();});
test('owner creates workspace and content atomically; only members can discover it',async()=>{
  const batch=writeBatch(owner);
  batch.set(doc(owner,'workspaces/team'),{name:'團隊',ownerUid:'owner',ownerEmail:'owner@gmail.com',memberEmails:['owner@gmail.com'],createdAt:serverTimestamp()});
  batch.set(doc(owner,'workspaces/team/content/state'),{data:state,updatedBy:'owner',updatedAt:serverTimestamp()});
  await assertSucceeds(batch.commit());
  await assertFails(getDoc(doc(stranger,'workspaces/team')));
  await assertFails(getDoc(doc(stranger,'workspaces/team/content/state')));
  await assertSucceeds(updateDoc(doc(owner,'workspaces/team'),{invitedEmails:['member@gmail.com']}));
  const invitations=await assertSucceeds(getDocs(query(collection(member,'workspaces'),where('invitedEmails','array-contains','member@gmail.com'))));
  assert.equal(invitations.size,1);
  await assertFails(getDoc(doc(member,'workspaces/team/content/state')));
  await assertFails(getDocs(collection(member,'workspaces/team/tasks')));
  await assertFails(updateDoc(doc(stranger,'workspaces/team'),{memberEmails:['owner@gmail.com','stranger@gmail.com'],invitedEmails:[]}));
  await assertFails(updateDoc(doc(member,'workspaces/team'),{memberEmails:['owner@gmail.com','member@gmail.com','stranger@gmail.com'],invitedEmails:[]}));
  await assertSucceeds(updateDoc(doc(member,'workspaces/team'),{memberEmails:['owner@gmail.com','member@gmail.com'],invitedEmails:[]}));
  const list=await assertSucceeds(getDocs(query(collection(member,'workspaces'),where('memberEmails','array-contains','member@gmail.com'))));
  assert.equal(list.size,1);
  await assertFails(getDocs(collection(member,'workspaces')));
});
test('invited Google account can edit; cannot invite another account or take ownership',async()=>{
  await assertSucceeds(setDoc(doc(member,'workspaces/team/content/state'),{data:{...state,cells:{'mc-0-0':'shared'}},updatedBy:'member',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(member,'workspaces/team'),{memberEmails:['owner@gmail.com','member@gmail.com','stranger@gmail.com']}));
  await assertFails(updateDoc(doc(member,'workspaces/team'),{ownerUid:'member'}));
  await assertFails(updateDoc(doc(owner,'workspaces/team'),{ownerUid:'member'}));
  await assertFails(updateDoc(doc(owner,'workspaces/team'),{memberEmails:['member@gmail.com']}));
});
test('private records cannot be read by collaborators; shared content excludes private scopes',async()=>{
  await assertSucceeds(setDoc(doc(owner,'users/owner'),{notebook:{notes:['private']}}));
  await assertFails(getDoc(doc(member,'users/owner')));
  await assertFails(setDoc(doc(member,'workspaces/team/content/state'),{data:{...state,notebook:{notes:['private']}},updatedBy:'member',updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(member,'workspaces/team/content/state'),{data:state,updatedBy:'owner',updatedAt:serverTimestamp()}));
});
test('unverified, anonymous and non-Google accounts cannot access shared workspaces',async()=>{
  const unverified=env.authenticatedContext('unverified',{...identity('member@gmail.com'),email_verified:false}).firestore();
  const password=env.authenticatedContext('password',{...identity('member@gmail.com'),firebase:{sign_in_provider:'password'}}).firestore();
  for(const db of [unverified,password,env.unauthenticatedContext().firestore()])await assertFails(getDoc(doc(db,'workspaces/team/content/state')));
});
test('owner receives collaborator updates live',async()=>{
  const received=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{stop();reject(new Error('listener timeout'));},5000);
    const stop=onSnapshot(doc(owner,'workspaces/team/content/state'),snapshot=>{
      if(snapshot.data()?.data.cells.live==='updated'){clearTimeout(timeout);stop();resolve();}
    },reject);
  });
  await setDoc(doc(member,'workspaces/team/content/state'),{data:{...state,cells:{live:'updated'}},updatedBy:'member',updatedAt:serverTimestamp()});
  await received;
});
test('team task assignment, publisher identity and member editing are enforced',async()=>{
  const data={title:'聯絡客戶',category:'action',priority:'red',assigneeEmail:'member@gmail.com',done:false,createdBy:'owner',creatorEmail:'owner@gmail.com',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:'owner'};
  await assertSucceeds(setDoc(doc(owner,'workspaces/team/tasks/task1'),data));
  await assertFails(getDoc(doc(stranger,'workspaces/team/tasks/task1')));
  await assertFails(setDoc(doc(owner,'workspaces/team/tasks/outsider'),{...data,assigneeEmail:'stranger@gmail.com'}));
  await assertFails(setDoc(doc(member,'workspaces/team/tasks/spoofed'),{...data,updatedBy:'member'}));
  await assertSucceeds(updateDoc(doc(member,'workspaces/team/tasks/task1'),{done:true,updatedBy:'member',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(member,'workspaces/team/tasks/task1'),{creatorEmail:'member@gmail.com',updatedBy:'member',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(member,'workspaces/team/tasks/task1'),{createdBy:'member',updatedBy:'member',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(owner,'workspaces/team/tasks/task1'),{assigneeEmail:'stranger@gmail.com',updatedBy:'owner',updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(doc(owner,'workspaces/team/tasks/task1'),{assigneeEmail:'owner@gmail.com',updatedBy:'owner',updatedAt:serverTimestamp()}));
});
test('revoked members immediately lose read and write access',async()=>{
  await assertSucceeds(updateDoc(doc(owner,'workspaces/team'),{memberEmails:['owner@gmail.com']}));
  await assertFails(getDoc(doc(member,'workspaces/team/content/state')));
  await assertFails(getDoc(doc(member,'workspaces/team/tasks/task1')));
  await assertFails(updateDoc(doc(member,'workspaces/team/tasks/task1'),{done:false,updatedBy:'member',updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(member,'workspaces/team/content/state'),{data:state,updatedBy:'member',updatedAt:serverTimestamp()}));
  await assertSucceeds(getDoc(doc(owner,'workspaces/team/content/state')));
});

test('invitee can decline and owner can cancel pending invitations',async()=>{
 const data={name:'邀請測試',ownerUid:'owner',ownerEmail:'owner@gmail.com',memberEmails:['owner@gmail.com'],createdAt:serverTimestamp()};
 await setDoc(doc(owner,'workspaces/pending'),data);
 await updateDoc(doc(owner,'workspaces/pending'),{invitedEmails:['member@gmail.com']});
 await assertSucceeds(updateDoc(doc(member,'workspaces/pending'),{invitedEmails:[]}));
 await assertFails(getDoc(doc(member,'workspaces/pending')));
 await updateDoc(doc(owner,'workspaces/pending'),{invitedEmails:['member@gmail.com']});
 await updateDoc(doc(owner,'workspaces/pending'),{invitedEmails:[]});
 await assertFails(updateDoc(doc(member,'workspaces/pending'),{memberEmails:['owner@gmail.com','member@gmail.com'],invitedEmails:[]}));
});
