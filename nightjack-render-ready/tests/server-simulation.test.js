'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const originalLoad=Module._load;
function express(){return {disable(){},use(){},get(){}};}
express.static=()=>()=>{};
let fakeIo;
class FakeServer {
 constructor(){this.sockets={sockets:new Map()};fakeIo=this;}
 on(name,fn){if(name==='connection')this.connection=fn;}
 to(socketId){return {emit:(event,payload)=>{
  const sock=this.sockets.sockets.get(socketId);
  if(sock){sock.received.push({event,payload});if(event==='room:state')sock.latest=payload;}
 }};}
}
Module._load=function(request,parent,isMain){
 if(request==='express')return express;
 if(request==='socket.io')return {Server:FakeServer};
 return originalLoad.call(this,request,parent,isMain);
};
const {rooms}=require('../server');
Module._load=originalLoad;
let socketNumber=0;
class MockSocket{
 constructor(){this.id='fake-socket-'+(++socketNumber);this.data={};this.handlers={};this.received=[];fakeIo.sockets.sockets.set(this.id,this);fakeIo.connection(this);}
 on(name,fn){this.handlers[name]=fn;}
 join(){}leave(){}
 disconnect(){this.handlers.disconnect?.();fakeIo.sockets.sockets.delete(this.id);}
 request(name,data={}){return new Promise(resolve=>this.handlers[name](data,resolve));}
}
test('room creation, joining, host authority, private dealer card, turns and results',async()=>{
 const a=new MockSocket(),b=new MockSocket();
 const created=await a.request('room:create',{name:'Alex'});
 assert.equal(created.ok,true);assert.match(created.code,/^[A-HJ-NP-Z2-9]{6}$/);
 assert.equal(a.latest.players.length,1);
 const joined=await b.request('room:join',{name:'Taylor',code:created.code});
 assert.equal(joined.ok,true);assert.equal(a.latest.players.length,2);
 assert.equal((await b.request('room:start')).ok,false);
 assert.equal((await a.request('room:start')).ok,true);
 const room=rooms.get(created.code);
 assert.equal(room.round,1);
 assert.equal(room.players.filter(p=>p.inRound).length,2);
 if(room.phase==='playing'){
   assert.deepEqual(a.latest.dealer.hand[1],{hidden:true});
   assert.equal(a.latest.dealer.total,null);
   for(let i=0;i<7 && room.phase==='playing';i++){
    const current=room.currentId===created.playerId?a:b;
    assert.equal((await current.request('room:action',{type:'stand'})).ok,true);
   }
 }
 assert.equal(room.phase,'results');
 assert.equal(room.currentId,null);
 assert.equal(room.players.filter(p=>p.inRound).length,2);
 assert.equal(room.players.every(p=>p.result!==null),true);
 assert.equal(a.latest.dealer.hand.length>=2,true);
 assert.equal(a.latest.dealer.total!==null,true);
 assert.equal((await b.request('room:action',{type:'hit'})).ok,false);
 assert.equal((await a.request('room:start')).ok,true);
 assert.equal(room.round,2);
 await a.request('room:leave');await b.request('room:leave');
});
test('chat moderation, reconnection identity, player limits and host handoff',async()=>{
 const a=new MockSocket(),b=new MockSocket();
 const owner=await a.request('room:create',{name:'Owner'});
 const joined=await b.request('room:join',{name:'Guest',code:owner.code});
 assert.equal((await b.request('room:chat',{message:'Hello friends!'})).ok,true);
 assert.equal((await b.request('room:chat',{message:'Spam immediately'})).ok,false);
 assert.equal(a.latest.chat.length,1);
 b.disconnect();
 const c=new MockSocket();
 assert.equal((await c.request('room:resume',{code:owner.code,playerId:joined.playerId,token:'wrong'})).ok,false);
 assert.equal((await c.request('room:resume',joined)).ok,true);
 assert.equal(c.latest.meId,joined.playerId);
 a.disconnect();
 assert.equal(c.latest.hostId,joined.playerId);
 const extras=[];
 for(let i=0;i<4;i++){
  const sock=new MockSocket();const answer=await sock.request('room:join',{name:'Friend'+i,code:owner.code});
  assert.equal(answer.ok,true);extras.push(sock);
 }
 const denied=new MockSocket();
 assert.equal((await denied.request('room:join',{name:'Extra',code:owner.code})).ok,false);
 for(const p of [c,...extras])await p.request('room:leave');
});
