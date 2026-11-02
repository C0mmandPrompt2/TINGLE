'use strict';
const express = require('express');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const {Server} = require('socket.io');
const {createDeck, shuffle, valueOf, isBlackjack, decide} = require('./rules');

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), {maxAge: '1h'}));
app.get('/health', (_req,res) => res.json({ok:true, service:'nightjack'}));
app.get('/room/:code', (_req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
const server = http.createServer(app);
const io = new Server(server, {maxHttpBufferSize: 64 * 1024});
const rooms = new Map();
const MAX_PLAYERS = 6;
const TURN_MS = 45000;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const safeReply = (ack, payload) => {if (typeof ack === 'function') ack(payload);};
const makeCode = () => {
  let code;
  do {code = Array.from(crypto.randomBytes(6), b => ROOM_CODE_CHARS[b % ROOM_CODE_CHARS.length]).join('');}
  while (rooms.has(code));
  return code;
};
function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[\x00-\x1F\x7F<>]/g, '').replace(/\s+/g,' ').slice(0,18);
}
function addEvent(room, message) {
  room.activity.push({id:crypto.randomUUID(),message,at:Date.now()});
  if(room.activity.length > 12) room.activity.shift();
}
function addChat(room, sender, message, system=false) {
  room.chat.push({id:crypto.randomUUID(),sender,message,system,at:Date.now()});
  if(room.chat.length > 55) room.chat.shift();
}
function currentPlayer(room) {return room.players.find(p=>p.id===room.currentId);}
function stateFor(room, viewer) {
  const revealed = room.phase === 'results';
  return {
    code:room.code,phase:room.phase,round:room.round,hostId:room.hostId,
    meId:viewer.id, currentId:room.currentId, turnDeadline:room.turnDeadline,
    players:room.players.map(p=>({
      id:p.id,name:p.name,connected:!!p.socketId,score:p.score,
      wins:p.wins,losses:p.losses,pushes:p.pushes,
      inRound:!!p.inRound,stood:!!p.stood,
      hand:p.inRound?p.hand:[],total:p.inRound?valueOf(p.hand).total:null,
      blackjack:p.inRound&&isBlackjack(p.hand),result:p.result||null
    })),
    dealer:room.phase==='playing' ? {hand:[room.dealer[0],{hidden:true}],total:null}
       :room.phase==='results'?{hand:room.dealer,total:valueOf(room.dealer).total}
       :{hand:[],total:null},
    chat:room.chat,activity:room.activity
  };
}
function sendState(room) {
  room.lastActive=Date.now();
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('room:state',stateFor(room,p));
  }
}
function hostFallback(room) {
  const old = room.hostId;
  if (!room.players.some(p=>p.id===room.hostId && p.socketId)) {
    room.hostId = room.players.find(p=>p.socketId)?.id ?? null;
    if(room.hostId && old !== room.hostId) addEvent(room,`${room.players.find(p=>p.id===room.hostId).name} is now the host`);
  }
}
function playerFromSocket(socket) {
  const room=rooms.get(socket.data.roomCode);
  const p=room?.players.find(x=>x.id===socket.data.playerId && x.socketId===socket.id);
  return room && p ? {room,p} : null;
}
function removeInactive(room) {
  if (room.phase==='playing') return;
  const cutoff=Date.now()-2*60*1000;
  room.players=room.players.filter(p=>p.socketId||p.disconnectedAt>cutoff);
  hostFallback(room);
}
function clearTurn(room) {if(room.turnTimer) clearTimeout(room.turnTimer);room.turnTimer=null;room.turnDeadline=null;}
function finishRound(room) {
  if(room.phase!=='playing') return;
  clearTurn(room);room.currentId=null;
  const playing=room.players.filter(p=>p.inRound);
  const anyNeedsDealer=playing.some(p=>!valueOf(p.hand).busted&&!isBlackjack(p.hand));
  if(!isBlackjack(room.dealer)&&anyNeedsDealer) {
    while(valueOf(room.dealer).total<17) room.dealer.push(room.deck.pop());
  }
  room.phase='results';
  for(const p of playing) {
    p.result=decide(p.hand,room.dealer);
    p.score+=p.result.points;
    if(p.result.kind==='win'||p.result.kind==='blackjack')p.wins++;
    else if(p.result.kind==='loss')p.losses++;
    else p.pushes++;
  }
  addEvent(room,`Round ${room.round} finished`);
  sendState(room);
}
function advanceTurn(room) {
  if(room.phase!=='playing')return;
  clearTurn(room);
  room.currentId=null;
  while(++room.turnIndex<room.turnOrder.length) {
    const p=room.players.find(x=>x.id===room.turnOrder[room.turnIndex]);
    if(!p||p.stood||isBlackjack(p.hand)||valueOf(p.hand).busted)continue;
    room.currentId=p.id;
    room.turnDeadline=Date.now()+TURN_MS;
    const expectedId=p.id;
    room.turnTimer=setTimeout(()=>{
      if(room.phase==='playing'&&room.currentId===expectedId){
        p.stood=true;
        addEvent(room,`${p.name} stood (turn timer)`);
        advanceTurn(room);
      }
    },TURN_MS);
    room.turnTimer.unref?.();
    sendState(room);return;
  }
  finishRound(room);
}
function startRound(room) {
  if(room.phase==='playing')return false;
  removeInactive(room);
  const active=room.players.filter(p=>p.socketId);
  if(active.length<2)return false;
  room.round++;
  room.deck=shuffle(Array.from({length:4},()=>createDeck()).flat());
  room.dealer=[];
  room.turnOrder=active.map(p=>p.id);
  room.turnIndex=-1;
  room.currentId=null;
  room.phase='playing';
  for(const p of room.players){p.hand=[];p.stood=false;p.result=null;p.inRound=active.includes(p);}
  for(let i=0;i<2;i++){
    for(const p of active) p.hand.push(room.deck.pop());
    room.dealer.push(room.deck.pop());
  }
  addEvent(room,`Round ${room.round} begins — cards are dealt`);
  if(isBlackjack(room.dealer)){finishRound(room);return true;}
  advanceTurn(room);
  return true;
}
function authenticate(room,p,socket) {
  if(p.socketId&&p.socketId!==socket.id)io.sockets.sockets.get(p.socketId)?.disconnect(true);
  p.socketId=socket.id;p.disconnectedAt=null;
  socket.data.roomCode=room.code;socket.data.playerId=p.id;
  socket.join(room.code);
  if(!room.hostId)room.hostId=p.id;
}
function makePlayer(name) {return {
  id:crypto.randomUUID(),token:crypto.randomBytes(24).toString('hex'),name,
  socketId:null,disconnectedAt:null,score:0,wins:0,losses:0,pushes:0,
  hand:[],stood:false,inRound:false,result:null,lastChat:0
};}
function leaveSocket(socket, voluntary=false) {
  const identity=playerFromSocket(socket);
  if(!identity)return;
  const {room,p}=identity;
  p.socketId=null;p.disconnectedAt=Date.now();
  socket.leave(room.code);
  socket.data.roomCode=null;socket.data.playerId=null;
  if(voluntary) {
    if(room.phase==='playing'&&p.inRound){p.stood=true;if(room.currentId===p.id)advanceTurn(room);}
    else room.players=room.players.filter(x=>x!==p);
    addEvent(room,`${p.name} left the table`);
  } else addEvent(room,`${p.name} disconnected`);
  hostFallback(room);
  sendState(room);
  if(voluntary&&room.players.length===0){clearTurn(room);rooms.delete(room.code);}
}
io.on('connection',socket=>{
  socket.on('room:create',({name}={},ack)=>{
    if(socket.data.playerId)return safeReply(ack,{ok:false,error:'Leave your current room first.'});
    name=cleanName(name);
    if(name.length<2)return safeReply(ack,{ok:false,error:'Enter a name with at least 2 characters.'});
    const code=makeCode();
    const p=makePlayer(name);
    const room={code,players:[p],hostId:p.id,phase:'lobby',round:0,
      deck:[],dealer:[],turnOrder:[],turnIndex:-1,currentId:null,turnDeadline:null,
      turnTimer:null,chat:[],activity:[],lastActive:Date.now()};
    rooms.set(code,room);authenticate(room,p,socket);
    addEvent(room,`${name} created the table`);
    safeReply(ack,{ok:true,code,playerId:p.id,token:p.token});sendState(room);
  });
  socket.on('room:join',({name,code}={},ack)=>{
    if(socket.data.playerId)return safeReply(ack,{ok:false,error:'Leave your current room first.'});
    name=cleanName(name);code=String(code||'').trim().toUpperCase();
    if(name.length<2)return safeReply(ack,{ok:false,error:'Enter a name with at least 2 characters.'});
    const room=rooms.get(code);
    if(!room)return safeReply(ack,{ok:false,error:'That room code does not exist. Check the code and try again.'});
    removeInactive(room);
    if(room.phase==='playing')return safeReply(ack,{ok:false,error:'A round is in progress. Join after the round ends.'});
    if(room.players.length>=MAX_PLAYERS)return safeReply(ack,{ok:false,error:'This room is full (6 players maximum).'});
    const p=makePlayer(name);room.players.push(p);authenticate(room,p,socket);
    addEvent(room,`${name} joined the table`);
    safeReply(ack,{ok:true,code,playerId:p.id,token:p.token});sendState(room);
  });
  socket.on('room:resume',({code,playerId,token}={},ack)=>{
    const room=rooms.get(String(code||'').toUpperCase());
    const p=room?.players.find(x=>x.id===playerId && x.token===token);
    if(!room||!p)return safeReply(ack,{ok:false,error:'Your room session has expired. Please join again.'});
    if(socket.data.playerId&&socket.data.playerId!==p.id)return safeReply(ack,{ok:false,error:'Already in another room.'});
    authenticate(room,p,socket);
    addEvent(room,`${p.name} reconnected`);
    safeReply(ack,{ok:true,code:room.code,playerId:p.id,token:p.token});sendState(room);
  });
  socket.on('room:start',(_payload,ack)=>{
    const identity=playerFromSocket(socket);
    if(!identity)return safeReply(ack,{ok:false,error:'Not in a room.'});
    const {room,p}=identity;
    if(room.hostId!==p.id)return safeReply(ack,{ok:false,error:'Only the host can start a round.'});
    if(room.phase==='playing')return safeReply(ack,{ok:false,error:'A round is already running.'});
    if(!startRound(room))return safeReply(ack,{ok:false,error:'At least two connected players are needed.'});
    safeReply(ack,{ok:true});
  });
  socket.on('room:action',({type}={},ack)=>{
    const identity=playerFromSocket(socket);
    if(!identity)return safeReply(ack,{ok:false,error:'Not in a room.'});
    const {room,p}=identity;
    if(room.phase!=='playing'||room.currentId!==p.id||p.stood)return safeReply(ack,{ok:false,error:'It is not your turn.'});
    if(type==='hit') {
      p.hand.push(room.deck.pop());
      addEvent(room,`${p.name} took a card`);
      if(valueOf(p.hand).total>=21){p.stood=true;advanceTurn(room);}else sendState(room);
    } else if(type==='stand') {
      p.stood=true;addEvent(room,`${p.name} stood`);advanceTurn(room);
    } else return safeReply(ack,{ok:false,error:'Unknown action.'});
    safeReply(ack,{ok:true});
  });
  socket.on('room:chat',({message}={},ack)=>{
    const identity=playerFromSocket(socket);
    if(!identity)return safeReply(ack,{ok:false,error:'Not in a room.'});
    const {room,p}=identity;
    if(typeof message!=='string')return safeReply(ack,{ok:false,error:'Invalid message.'});
    message=message.trim().replace(/[\x00-\x1F\x7F]/g,'').slice(0,160);
    if(!message)return safeReply(ack,{ok:false,error:'Message is empty.'});
    if(Date.now()-p.lastChat<1100)return safeReply(ack,{ok:false,error:'Please slow down a little.'});
    p.lastChat=Date.now();addChat(room,p.name,message);safeReply(ack,{ok:true});sendState(room);
  });
  socket.on('room:leave',(_payload,ack)=>{leaveSocket(socket,true);safeReply(ack,{ok:true});});
  socket.on('disconnect',()=>leaveSocket(socket,false));
});
setInterval(()=>{
  const now=Date.now();
  for(const [code,room] of rooms){
    removeInactive(room);
    if(!room.players.some(p=>p.socketId)&&now-room.lastActive>10*60*1000){clearTurn(room);rooms.delete(code);}
  }
},60000).unref();
const port=Number(process.env.PORT)||3000;
if(require.main===module)server.listen(port,'0.0.0.0',()=>console.log(`Nightjack listening on ${port}`));
module.exports={app,server,io,rooms};
