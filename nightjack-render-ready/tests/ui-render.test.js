'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function frontend(){
 const events={};const app={innerHTML:'',addEventListener(){}};
 const toast={textContent:'',classList:{add(){},remove(){}}};
 const socket={connected:true,on(name,cb){events[name]=cb;},timeout(){return this;},emit(){}};
 const saved={};
 const context={
  document:{getElementById(id){if(id==='app')return app;if(id==='toast')return toast;return null;},activeElement:null},
  io:()=>socket,
  sessionStorage:{getItem:k=>saved[k]??null,setItem:(k,v)=>saved[k]=v,removeItem:k=>delete saved[k]},
  location:{pathname:'/',origin:'https://example.com'},history:{replaceState(){}},
  setTimeout(){return 1},clearTimeout(){},setInterval(){return 1},Date,
  navigator:{clipboard:{writeText(){return Promise.resolve();}}},window:{},
 };
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8'),context);
 return {events,app};
}
test('home renders visual create and join controls',()=>{
 const {events,app}=frontend();events.connect();
 assert.match(app.innerHTML,/CREATE PRIVATE TABLE/);
 assert.match(app.innerHTML,/6-CHARACTER INVITE CODE/);
 assert.match(app.innerHTML,/No wagers, purchases or prizes/);
});
test('room renders table, controls, hidden dealer card and escapes chat',()=>{
 const {events,app}=frontend();events.connect();
 events['room:state']({
  code:'ABCD23',phase:'playing',round:1,hostId:'one',meId:'one',currentId:'one',turnDeadline:Date.now()+30000,
  players:[
   {id:'one',name:'Alex',connected:true,score:0,wins:0,losses:0,pushes:0,inRound:true,stood:false,hand:[{rank:'A',suit:'♠'},{rank:'8',suit:'♥'}],total:19,blackjack:false},
   {id:'two',name:'Taylor',connected:true,score:0,wins:0,losses:0,pushes:0,inRound:true,stood:false,hand:[{rank:'5',suit:'♣'},{rank:'8',suit:'♦'}],total:13,blackjack:false}
  ],dealer:{hand:[{rank:'9',suit:'♠'},{hidden:true}],total:null},
  chat:[{id:'a',sender:'Visitor',message:'<script>alert(1)</script>',at:Date.now()}],activity:[]
 });
 assert.match(app.innerHTML,/YOUR TURN/);
 assert.match(app.innerHTML,/data-action="hit"/);
 assert.match(app.innerHTML,/data-action="stand"/);
 assert.match(app.innerHTML,/Face-down card/);
 assert.match(app.innerHTML,/&lt;script&gt;/);
 assert.doesNotMatch(app.innerHTML,/<script>alert/);
});
