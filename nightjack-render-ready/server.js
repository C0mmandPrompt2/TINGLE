'use strict';
const express=require('express');
const http=require('node:http');
const crypto=require('node:crypto');
const path=require('node:path');
const {Server}=require('socket.io');
const {createDeck,shuffle,valueOf,twoCard21,twentyOneWinners,holdemWinners,evaluateSeven}=require('./rules');
const accounts=require('./account-store');
const {serialized}=require('./state');
const app=express();app.disable('x-powered-by');
app.use(express.static(path.join(__dirname,'public'),{maxAge:'5m'}));
app.get('/health',(_req,res)=>res.json({ok:true,version:'2.0',persistentAccounts:accounts.isPersistent()}));
app.get('/room/:code',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const server=http.createServer(app),io=new Server(server,{maxHttpBufferSize:32768});
const rooms=new Map(),sessions=new Map();const MAX_PLAYERS=6,TURN_MS=45000;
const CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const reply=(ack,data)=>{if(typeof ack==='function')ack(data);};
function code(){let c;do{c=Array.from(crypto.randomBytes(6),v=>CHARS[v%CHARS.length]).join('');}while(rooms.has(c));return c;}
function event(room,message){room.activity.push({message,at:Date.now()});if(room.activity.length>9)room.activity.shift();}
function player(socket){const room=rooms.get(socket.data.roomCode);const p=room?.players.find(x=>x.id===socket.data.userId&&x.socketId===socket.id);return room&&p?{room,p}:null;}
function host(room){if(!room.players.some(p=>p.id===room.hostId&&p.socketId)){room.hostId=room.players.find(p=>p.socketId)?.id||null;if(room.hostId)event(room,'New room host selected');}}
function broadcast(room){room.lastActive=Date.now();for(const p of room.players){if(p.socketId)io.to(p.socketId).emit('room:state',serialized(room,p));}}
function broadcastLeaderboard(){void accounts.leaderboard().then(rows=>io.emit('leaderboard:state',{rows,persistent:accounts.isPersistent()})).catch(e=>console.error('Leaderboard:',e.message));}
function clearTurn(room){if(room.timer)clearTimeout(room.timer);room.timer=null;room.turnDeadline=null;}
function activeRound(room){return room.phase!=='lobby'&&room.phase!=='results'&&room.phase!=='settling';}
async function finish(room){if(!activeRound(room)||room.resolving)return;room.resolving=true;clearTurn(room);room.currentId=null;room.phase='settling';const ps=room.players.filter(p=>p.inRound);
 let winners=[],rankLabel='';if(room.mode==='21'){winners=twentyOneWinners(ps).winners;}else{const result=holdemWinners(ps,room.board);winners=result.winners;rankLabel=result.rank||'';}
 const points=room.mode==='21'?100:150;
 try{await accounts.recordGames(ps.map(p=>p.id));await accounts.reward(winners,points);
  for(const p of ps){const info=await accounts.getUser(p.id);if(info){p.chips=info.chips;p.wins=info.wins;p.games=info.games;}
   if(p.folded)p.result={kind:'fold',label:'Folded',points:0};
   else if(winners.includes(p.id))p.result={kind:'win',label:winners.length>1?'Shared win':'Round winner',points};
   else if(room.mode==='21'&&valueOf(p.hand).busted)p.result={kind:'bust',label:'Over 21',points:0};
   else p.result={kind:'loss',label:'Good round',points:0};
  }
  room.notice=rankLabel?`Winning hand: ${rankLabel}`:'';
 }catch(error){console.error('Finishing round:',error);room.notice='Score saving failed — this round awarded no confirmed points.';for(const p of ps)p.result={kind:'error',label:'Score unavailable',points:0};}
 room.phase='results';room.resolving=false;event(room,`Round ${room.round} complete`);broadcast(room);broadcastLeaderboard();}
function advance(room){if(room.phase!=='playing')return;clearTurn(room);room.currentId=null;
 while(++room.turnIndex<room.turnOrder.length){const p=room.players.find(x=>x.id===room.turnOrder[room.turnIndex]);if(!p||p.stood||valueOf(p.hand).total>=21)continue;
  room.currentId=p.id;room.turnDeadline=Date.now()+TURN_MS;
  const id=p.id;room.timer=setTimeout(()=>{if(room.phase==='playing'&&room.currentId===id){p.stood=true;event(room,`${p.name} auto-stood`);advance(room);}},TURN_MS);
  room.timer.unref?.();broadcast(room);return;
 }
 void finish(room);
}
function startRound(room){if(activeRound(room)||room.resolving)return false;const active=room.players.filter(p=>p.socketId);if(active.length<2)return false;
 room.round++;room.deck=shuffle(room.mode==='21'?Array.from({length:4},()=>createDeck()).flat():createDeck());room.board=[];room.notice='';room.turnOrder=active.map(p=>p.id);room.turnIndex=-1;room.currentId=null;room.resolving=false;
 for(const p of room.players){p.hand=[];p.inRound=active.includes(p);p.stood=false;p.folded=false;p.result=null;}
 for(let i=0;i<2;i++)for(const p of active)p.hand.push(room.deck.pop());
 room.phase=room.mode==='21'?'playing':'preflop';event(room,`Round ${room.round} started · ${room.mode==='21'?'Twenty-One':'Hold’em'}`);
 if(room.mode==='21'){for(const p of active)if(twoCard21(p.hand))p.stood=true;advance(room);}else broadcast(room);
 return true;
}
function connectToRoom(socket,room,p){const other=p.socketId;if(other&&other!==socket.id){const old=io.sockets.sockets.get(other);if(old){old.data.roomCode=null;old.disconnect(true);}}
 p.socketId=socket.id;p.disconnectedAt=0;socket.data.roomCode=room.code;socket.join(room.code);host(room);broadcast(room);}
function leaveRoom(socket,voluntary){const current=player(socket);if(!current)return;const {room,p}=current;p.socketId=null;p.disconnectedAt=Date.now();socket.leave(room.code);socket.data.roomCode=null;host(room);
 if(voluntary){if(activeRound(room)&&p.inRound){p.stood=true;p.folded=room.mode==='holdem';if(room.currentId===p.id)advance(room);}else room.players=room.players.filter(x=>x.id!==p.id);event(room,`${p.name} left the room`);}else event(room,`${p.name} disconnected`);
 if(!room.players.length){clearTurn(room);rooms.delete(room.code);}else broadcast(room);
}
function authSocket(socket,user){socket.data.userId=user.id;socket.data.user=user;const oldSocket=[...io.sockets.sockets.values()].find(s=>s.id!==socket.id&&s.data.userId===user.id);if(oldSocket){leaveRoom(oldSocket,false);oldSocket.data.userId=null;oldSocket.disconnect(true);}return user;}
function makeToken(userId){const token=crypto.randomBytes(32).toString('base64url');sessions.set(crypto.createHash('sha256').update(token).digest('hex'),{userId,expires:Date.now()+30*86400000});return token;}
async function authenticateToken(token){if(typeof token!=='string'||token.length>100)return null;const key=crypto.createHash('sha256').update(token).digest('hex');const session=sessions.get(key);if(!session||session.expires<Date.now())return null;return accounts.getUser(session.userId);}
function safeAsync(ack,fn){Promise.resolve().then(fn).catch(e=>{console.error('Socket operation:',e.message);reply(ack,{ok:false,error:e.message?.includes('password')||e.message?.includes('username')||e.message?.includes('taken')?e.message:'Unable to complete request. Please try again.'});});}
io.on('connection',socket=>{
 const ip=socket.handshake.address;socket.data.authTries=0;socket.data.authStarted=Date.now();
 const authLimit=()=>{if(Date.now()-socket.data.authStarted>60000){socket.data.authTries=0;socket.data.authStarted=Date.now();}return ++socket.data.authTries<=8;};
 socket.on('auth:register',(payload={},ack)=>safeAsync(ack,async()=>{if(!authLimit())return reply(ack,{ok:false,error:'Too many attempts. Try again later.'});const user=await accounts.register(payload.username,payload.password);authSocket(socket,user);const token=makeToken(user.id);reply(ack,{ok:true,user,token,persistent:accounts.isPersistent()});broadcastLeaderboard();}));
 socket.on('auth:login',(payload={},ack)=>safeAsync(ack,async()=>{if(!authLimit())return reply(ack,{ok:false,error:'Too many attempts. Try again later.'});const user=await accounts.login(payload.username,payload.password);authSocket(socket,user);reply(ack,{ok:true,user,token:makeToken(user.id),persistent:accounts.isPersistent()});}));
 socket.on('auth:resume',(payload={},ack)=>safeAsync(ack,async()=>{const user=await authenticateToken(payload.token);if(!user)return reply(ack,{ok:false,error:'Please log in again.'});authSocket(socket,user);reply(ack,{ok:true,user,persistent:accounts.isPersistent()});}));
 socket.on('auth:logout',(_payload,ack)=>{leaveRoom(socket,true);socket.data.userId=null;reply(ack,{ok:true});});
 socket.on('leaderboard:fetch',(_payload,ack)=>safeAsync(ack,async()=>reply(ack,{ok:true,rows:await accounts.leaderboard(),persistent:accounts.isPersistent()})));
 socket.on('room:create',(payload={},ack)=>safeAsync(ack,async()=>{if(!socket.data.userId)return reply(ack,{ok:false,error:'Log in to create a room.'});if(player(socket))return reply(ack,{ok:false,error:'Leave your room first.'});const mode=payload.mode==='holdem'?'holdem':'21',id=socket.data.userId,user=await accounts.getUser(id),c=code();
 const p={id,name:user.username,chips:user.chips,wins:user.wins,games:user.games,socketId:null,disconnectedAt:0,hand:[],inRound:false,stood:false,folded:false,result:null,lastChat:0};
 const room={code:c,mode,hostId:id,players:[p],phase:'lobby',round:0,deck:[],board:[],turnOrder:[],turnIndex:-1,currentId:null,turnDeadline:null,timer:null,chat:[],activity:[],lastActive:Date.now(),resolving:false,notice:''};rooms.set(c,room);connectToRoom(socket,room,p);reply(ack,{ok:true,code:c});}));
 socket.on('room:join',(payload={},ack)=>safeAsync(ack,async()=>{if(!socket.data.userId)return reply(ack,{ok:false,error:'Log in to join.'});if(player(socket))return reply(ack,{ok:false,error:'Leave your room first.'});const c=String(payload.code||'').trim().toUpperCase(),room=rooms.get(c);if(!room)return reply(ack,{ok:false,error:'Room not found. Check the code.'});if(activeRound(room)||room.resolving)return reply(ack,{ok:false,error:'A round is underway. Join after it finishes.'});if(room.players.some(p=>p.id===socket.data.userId)){const p=room.players.find(p=>p.id===socket.data.userId);connectToRoom(socket,room,p);return reply(ack,{ok:true,code:c});}
 room.players=room.players.filter(p=>p.socketId||Date.now()-p.disconnectedAt<120000);if(room.players.length>=MAX_PLAYERS)return reply(ack,{ok:false,error:'Room full (maximum six players).'});
 const user=await accounts.getUser(socket.data.userId),p={id:user.id,name:user.username,chips:user.chips,wins:user.wins,games:user.games,socketId:null,disconnectedAt:0,hand:[],inRound:false,stood:false,folded:false,result:null,lastChat:0};room.players.push(p);connectToRoom(socket,room,p);event(room,`${p.name} joined`);broadcast(room);reply(ack,{ok:true,code:c});}));
 socket.on('room:resume',(payload={},ack)=>{const room=rooms.get(String(payload.code||'').toUpperCase()),p=room?.players.find(p=>p.id===socket.data.userId);if(!room||!p)return reply(ack,{ok:false,error:'That room session has ended.'});connectToRoom(socket,room,p);reply(ack,{ok:true,code:room.code});});
 socket.on('room:start',(_payload,ack)=>{const x=player(socket);if(!x)return reply(ack,{ok:false,error:'Not in a room.'});if(x.room.hostId!==x.p.id)return reply(ack,{ok:false,error:'Only the host can start.'});if(!startRound(x.room))return reply(ack,{ok:false,error:'Need at least two connected players and a finished round.'});reply(ack,{ok:true});});
 socket.on('room:action',(payload={},ack)=>{const x=player(socket);if(!x)return reply(ack,{ok:false,error:'Not in a room.'});const {room,p}=x;if(room.mode==='21'){if(room.phase!=='playing'||room.currentId!==p.id||p.stood)return reply(ack,{ok:false,error:'Not your turn.'});if(payload.type==='hit'){p.hand.push(room.deck.pop());if(valueOf(p.hand).total>=21){p.stood=true;advance(room);}else broadcast(room);}
 else if(payload.type==='stand'){p.stood=true;advance(room);}else return reply(ack,{ok:false,error:'Unknown move.'});reply(ack,{ok:true});return;}
 if(payload.type==='fold'&&['preflop','flop','turn','river'].includes(room.phase)&&p.inRound&&!p.folded){p.folded=true;event(room,`${p.name} folded`);broadcast(room);reply(ack,{ok:true});return;}
 return reply(ack,{ok:false,error:'That move is not available.'});});
 socket.on('room:advance',(_payload,ack)=>{const x=player(socket);if(!x)return reply(ack,{ok:false,error:'Not in a room.'});const {room,p}=x;if(room.mode!=='holdem'||room.hostId!==p.id)return reply(ack,{ok:false,error:'Only the Hold’em host can reveal the next cards.'});
 if(room.phase==='preflop'){room.board.push(room.deck.pop(),room.deck.pop(),room.deck.pop());room.phase='flop';}else if(room.phase==='flop'){room.board.push(room.deck.pop());room.phase='turn';}else if(room.phase==='turn'){room.board.push(room.deck.pop());room.phase='river';}else if(room.phase==='river'){reply(ack,{ok:true});void finish(room);return;}else return reply(ack,{ok:false,error:'No cards to reveal right now.'});
 event(room,`${room.phase.toUpperCase()} revealed`);broadcast(room);reply(ack,{ok:true});});
 socket.on('room:chat',(payload={},ack)=>{const x=player(socket);if(!x)return reply(ack,{ok:false,error:'Not in a room.'});const {room,p}=x;if(typeof payload.message!=='string')return reply(ack,{ok:false,error:'Invalid message.'});const msg=payload.message.trim().replace(/[\x00-\x1f\x7f]/g,'').slice(0,130);if(!msg)return reply(ack,{ok:false,error:'Message is empty.'});if(Date.now()-p.lastChat<1200)return reply(ack,{ok:false,error:'Slow down a little.'});p.lastChat=Date.now();room.chat.push({sender:p.name,message:msg,at:Date.now()});if(room.chat.length>35)room.chat.shift();broadcast(room);reply(ack,{ok:true});});
 socket.on('room:leave',(_payload,ack)=>{leaveRoom(socket,true);reply(ack,{ok:true});});socket.on('disconnect',()=>leaveRoom(socket,false));
});
setInterval(()=>{const now=Date.now();for(const [code,room] of rooms){if(room.phase==='lobby'||room.phase==='results'){room.players=room.players.filter(p=>p.socketId||now-p.disconnectedAt<120000);host(room);}if(!room.players.some(p=>p.socketId)&&now-room.lastActive>600000){clearTurn(room);rooms.delete(code);}}for(const [token,session] of sessions)if(session.expires<now)sessions.delete(token);},60000).unref();
const port=Number(process.env.PORT)||3000;
if(require.main===module){accounts.init().then(()=>server.listen(port,'0.0.0.0',()=>console.log(`Nightjack game hub listening on ${port}; persistent accounts: ${accounts.isPersistent()}`))).catch(error=>{console.error('Database initialization failed:',error);process.exit(1);});}
module.exports={app,server,io,rooms,serialized};
