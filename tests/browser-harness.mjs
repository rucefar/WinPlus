import {initializeApp} from 'firebase-web/app';
import {getFirestore,connectFirestoreEmulator,doc,collection,query,where,onSnapshot,getDoc,getDocFromServer,setDoc,runTransaction,serverTimestamp,disableNetwork,enableNetwork} from 'firebase-web/firestore';
import {installCollaboration} from '../collaboration.mjs';
const uid=new URLSearchParams(location.search).get('user');
const user={uid,email:`${uid}@gmail.com`,emailVerified:true};
const db=getFirestore(initializeApp({projectId:'demo-winplus',apiKey:'demo'}));
connectFirestoreEmulator(db,'127.0.0.1',8085,{mockUserToken:{sub:uid,email:user.email,email_verified:true,firebase:{sign_in_provider:'google.com'}}});
const testSnapshot=(...args)=>{
 if(new URLSearchParams(location.search).has('noList') && args[0].type==='query'){
  queueMicrotask(()=>args.at(-1)({code:'permission-denied',message:'simulated discovery failure'}));return ()=>{};
 }
 return onSnapshot(...args);
};
window.testCollaboration=installCollaboration({db,auth:null,api:{doc,collection,query,where,onSnapshot:testSnapshot,getDoc,getDocFromServer,setDoc,runTransaction,serverTimestamp}});
window.testOffline=()=>disableNetwork(db);window.testOnline=()=>enableNetwork(db);
await window.testCollaboration.login(user);
document.getElementById('login-overlay').style.display='none';
await window.testCollaboration.openRequestedWorkspace();
window.testReady=true;
