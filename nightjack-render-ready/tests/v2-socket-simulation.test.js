'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
let instance;function expressStub(){const a=(_req,_res)=>{};a.disable=()=>a;a.use=()=>a;a.get=()=>a;return a;}expressStub.static=()=>()=>{};
class ServerStub{constructor(){this.sockets={sockets:new Map()};instance=this;}on(name,fn){if(name==='connection')this.accept=fn;}to(id){return {emit:(name,payload)=>this.sockets.sockets.get(id)?.received.push({name,payload})};}emit(name,payload){for(const s of this.sockets.sockets.values())s.received.push({name,payload});}}
const originalLoad=Module._load;Module._load=function(request,parent,isMain){if(request==='express')return expressStub;if(request==='socket.io')return {Server:ServerStub};return originalLoad.call(this,request,parent,isMain);};
const serverModule=require('../server');Module._load=originalLoad;
let nextId=0;function connect(){const socket={id:'socket-'+(++nextId),data:{},events:{},received:[],handshake:{address:'127.0.0.1'},on(name,fn){this.events[name]=fn;},join(){},leave(){},disconnect(){instance.sockets.sockets.delete(this.id);this.events.disconnect?.();}};instance.sockets.sockets.set(socket.id,socket);instance.accept(socket);return socket;}
async function call(socket,name,payload={}){return new Promise(resolve=>{socket.events[name](payload,resolve);});}
function state(socket){return socket.received.filter(x=>x.name==='room:state').at(-1)?.payload;}
test('two live socket sessions play private PvP 21, then Holdem board and leaderboard',async()=>{
 const a=connect(),b=connect();let response=await call(a,'auth:register',{username:'FirstP',password:'secure-pass-aa'});assert.equal(response.ok,true);assert.equal(response.user.chips,2000);
 response=await call(b,'auth:register',{username:'SecondP',password:'secure-pass-bb'});assert.equal(response.ok,true);
 const made=await call(a,'room:create',{mode:'21'});assert.equal(made.ok,true);assert.equal((await call(b,'room:join',{code:made.code})).ok,true);
 assert.equal((await call(a,'room:start')).ok,true);assert.equal(state(a).mode,'21');assert.equal(state(a).players[1].hand[0].hidden,true);assert.equal(state(b).players[0].hand[0].hidden,true);
 const room=serverModule.rooms.get(made.code);let safety=0;while(room.phase==='playing'&&safety++<12){const current=room.currentId===a.data.userId?a:b;const actor=room.players.find(p=>p.id===room.currentId);assert.ok(actor);assert.equal((await call(current,'room:action',{type:'stand'})).ok,true);}
 await new Promise(resolve=>setTimeout(resolve,80));assert.equal(room.phase,'results');assert.equal(state(a).players[1].hand[0].hidden,undefined);assert.equal(state(b).players[0].hand[0].hidden,undefined);
 await call(a,'room:leave');await call(b,'room:leave');const hold=await call(a,'room:create',{mode:'holdem'});assert.equal(hold.ok,true);await call(b,'room:join',{code:hold.code});await call(a,'room:start');assert.equal(state(b).players[0].hand[0].hidden,true);
 for(const expected of ['flop','turn','river']){assert.equal((await call(a,'room:advance')).ok,true);assert.equal(state(a).phase,expected);}
 assert.equal(state(a).board.length,5);assert.equal((await call(a,'room:advance')).ok,true);await new Promise(resolve=>setTimeout(resolve,80));assert.equal(state(a).phase,'results');assert.ok(state(a).players.every(p=>p.hand[0].rank));
 const leaderboard=await call(a,'leaderboard:fetch');assert.equal(leaderboard.ok,true);assert.equal(leaderboard.rows.length>=2,true);assert.ok(leaderboard.rows[0].chips>=2000);
});
