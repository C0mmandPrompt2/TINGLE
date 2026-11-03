'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
let hub;function expressStub(){const a=()=>{};a.disable=()=>a;a.use=()=>a;a.get=()=>a;return a;}expressStub.static=()=>()=>{};
class FakeServer{constructor(){this.sockets={sockets:new Map()};hub=this;}on(name,handler){if(name==='connection')this.accept=handler;}to(id){return {emit:(name,data)=>this.sockets.sockets.get(id)?.messages.push({name,data})};}emit(name,data){for(const s of this.sockets.sockets.values())s.messages.push({name,data});}}
const original=Module._load;Module._load=(req,parent,isMain)=>{if(req==='express')return expressStub;if(req==='socket.io')return {Server:FakeServer};return original(req,parent,isMain);};
const app=require('../server');Module._load=original;let seq=0;
function connect(){const s={id:'socket-'+(++seq),data:{},handshake:{address:'127.0.0.1'},callbacks:{},messages:[],on(name,fn){this.callbacks[name]=fn;},join(){},leave(){},emit(name,data){this.messages.push({name,data});},disconnect(){hub.sockets.sockets.delete(this.id);this.callbacks.disconnect?.();}};hub.sockets.sockets.set(s.id,s);hub.accept(s);return s;}
function run(s,name,data={}){return new Promise(resolve=>s.callbacks[name](data,resolve));}
const state=s=>s.messages.filter(m=>m.name==='room:state').at(-1)?.data;
const delay=n=>new Promise(resolve=>setTimeout(resolve,n));
test('Private Blackjack room keeps cards hidden, supports chat and automated dealer',async()=>{
 const alice=connect(),bob=connect();let a=await run(alice,'auth:register',{username:'Alice'+Date.now().toString().slice(-6),password:'big-pass-a'}),b=await run(bob,'auth:register',{username:'Bob'+Date.now().toString().slice(-6),password:'big-pass-b'});
 assert.ok(a.ok&&b.ok);const made=await run(alice,'room:create',{mode:'21'});assert.ok(made.ok);assert.equal((await run(bob,'room:join',{code:made.code})).ok,true);
 assert.equal((await run(alice,'room:start')).ok,true);const s=state(alice);assert.equal(s.dealer[1].hidden,true);assert.equal(s.players[1].hand[0].hidden,true);assert.equal(state(bob).players[0].hand[0].hidden,true);
 const room=app.rooms.get(made.code);let steps=0;while(room.phase==='playing'&&steps++<6){const player=room.currentId===alice.data.userId?alice:bob;assert.equal((await run(player,'room:action',{type:'stand'})).ok,true);}
 await delay(100);assert.equal(room.phase,'results');assert.ok(state(alice).dealer.every(c=>!c.hidden));assert.equal(state(bob).players[0].hand[0].hidden,undefined);
 assert.ok((await run(alice,'room:chat',{message:'GG!'})).ok);assert.ok(state(bob).chat.some(m=>m.message==='GG!'));
 await run(alice,'room:leave');await run(bob,'room:leave');
});
test('Public Holdem table, server actions, automatic reveal, side pots',async()=>{
 const a=connect(),b=connect();await run(a,'auth:register',{username:'PokerA'+Date.now().toString().slice(-6),password:'poker-pass-a'});await run(b,'auth:register',{username:'PokerB'+Date.now().toString().slice(-6),password:'poker-pass-b'});
 const made=await run(a,'room:create',{mode:'holdem',visibility:'public',name:'NIGHT TABLE'});assert.equal(made.ok,true);assert.equal((await run(b,'room:join',{code:made.code})).ok,true);
 assert.ok((await run(a,'rooms:fetch')).rooms.some(x=>x.code===made.code));
 assert.ok((await run(a,'room:start')).ok);const room=app.rooms.get(made.code);
 assert.equal(state(a).players[1].hand[0].hidden,true);assert.equal(state(b).players[0].hand[0].hidden,true);
 let turns=0;
 while(room.phase!=='results'&&turns++<30){if(room.phase==='transition'||room.phase==='settling'){await delay(500);continue;}const s=room.players.find(x=>x.id===room.currentId),sock=s?.id===a.data.userId?a:b;if(!s){await delay(100);continue;}const diff=room.currentBet-s.streetBet;const result=await run(sock,'room:action',{type:diff>0?'call':'check'});assert.equal(result.ok,true,result.error);}
 await delay(100);assert.equal(room.phase,'results');assert.equal(room.board.length,5);assert.equal(state(a).players[1].hand[0].hidden,undefined);
 assert.ok((await run(a,'leaderboard:fetch')).rows.length>=2);
 // Side-pot algorithm: contributions of 20/100/100 yield a total of 220 and all points distributed.
 const side={players:[{id:'a',contributed:20,inRound:true,folded:false,hand:[{rank:'A',suit:'♥'},{rank:'K',suit:'♥'}]},{id:'b',contributed:100,inRound:true,folded:false,hand:[{rank:'2',suit:'♠'},{rank:'3',suit:'♣'}]},{id:'c',contributed:100,inRound:true,folded:true,hand:[{rank:'5',suit:'♠'},{rank:'6',suit:'♣'}]}],board:[{rank:'10',suit:'♥'},{rank:'J',suit:'♥'},{rank:'Q',suit:'♥'},{rank:'5',suit:'♣'},{rank:'7',suit:'♦'}]};
 const calculated=app.pokerPayouts(side);assert.equal([...calculated.paymap.values()].reduce((x,y)=>x+y,0),220);assert.ok(calculated.paymap.get('a')>=60);
});
