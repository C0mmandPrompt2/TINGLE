'use strict';
// NIGHT JACK v3 — real-time server-authoritative card-game rooms.
const express = require('express');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { Server } = require('socket.io');
const rules = require('./rules');
const accounts = require('./account-store');
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname,'public'),{maxAge:'0',setHeaders(res,file){if(/\.(?:js|css|html)$/.test(file))res.setHeader('Cache-Control','no-store');}}));
app.get('/health',(_req,res)=>res.json({ok:true,version:'3.0',persistentAccounts:accounts.isPersistent()}));
app.get('/room/:code',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const httpServer=http.createServer(app);
const io=new Server(httpServer,{maxHttpBufferSize:16384});
const rooms=new Map();
const MAX_ROOM=6, TURN_MS=30000, REVEAL_DELAY=320;
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ok=(ack,payload)=>{if(typeof ack==='function')ack(payload);};
const tid=()=>crypto.randomUUID();
function randomCode(){let c;do{c=Array.from(crypto.randomBytes(6),b=>ALPHABET[b%ALPHABET.length]).join('');}while(rooms.has(c));return c;}
function secureShuffle(){return rules.shuffle(rules.createDeck(),()=>crypto.randomInt(0,1000000000)/1000000000);}
function active(room){return !['lobby','results'].includes(room.phase);}
function event(room,msg){room.activity.push({text:msg,at:Date.now()});room.activity=room.activity.slice(-10);}
function seat(room,socket){const p=room?.players.find(q=>q.id===socket.data.userId&&q.socketId===socket.id);return p?{room,p}:null;}
function current(socket){return seat(rooms.get(socket.data.room),socket);}
function chooseHost(room){if(!room.players.some(p=>p.id===room.hostId&&p.socketId)){room.hostId=room.players.find(p=>p.socketId)?.id||null;}}
function publicList(){return [...rooms.values()].filter(r=>r.visibility==='public').map(r=>({code:r.code,name:r.name,mode:r.mode,status:r.phase==='lobby'?'WAITING':r.phase==='results'?'BETWEEN ROUNDS':'PLAYING',count:r.players.filter(p=>p.socketId).length,maxPlayers:r.maxPlayers}));}
function announceRooms(){io.emit('rooms:list',{rooms:publicList()});}
function hiddenCard(){return {hidden:true};}
function playerView(room,p,viewer){const shown=viewer.id===p.id||(room.phase==='results'&&(room.mode==='21'||!p.folded));return {id:p.id,name:p.name,connected:!!p.socketId,chips:p.chips,stack:p.inRound&&shown?p.stack:null,wins:p.wins,games:p.games,hand:p.inRound?(shown?p.hand:p.hand.map(hiddenCard)):[],total:p.inRound&&room.mode==='21'&&shown?rules.valueOf(p.hand).total:null,inRound:p.inRound,stood:p.stood,folded:p.folded,allIn:p.allIn,streetBet:p.streetBet,contributed:p.contributed,status:p.status,result:room.phase==='results'?p.result:null};}
function snapshot(room,viewer){return {
 code:room.code,name:room.name,mode:room.mode,visibility:room.visibility,maxPlayers:room.maxPlayers,phase:room.phase,round:room.round,hostId:room.hostId,meId:viewer.id,
 currentId:room.currentId,turnDeadline:room.turnDeadline,stage:room.stage,board:room.board,
 dealer:room.mode==='21'?(room.phase==='results'?room.dealer:room.dealer.map((c,i)=>i===0?c:hiddenCard())):[],
 pot:room.pot,currentBet:room.currentBet,minRaise:room.lastRaise||20,blind:room.blind,
 players:room.players.map(p=>playerView(room,p,viewer)),connectedCount:room.players.filter(p=>p.socketId).length,
 chat:room.chat,activity:room.activity,notice:room.notice,persistentAccounts:accounts.isPersistent()
};}
function publish(room){room.lastActive=Date.now();for(const p of room.players)if(p.socketId)io.to(p.socketId).emit('room:state',snapshot(room,p));announceRooms();}
function leaderboard(){void accounts.leaderboard().then(rows=>io.emit('leaderboard:state',{rows,persistent:accounts.isPersistent()})).catch(e=>console.error('Leaderboard:',e.message));}
function timerOff(room){if(room.timer)clearTimeout(room.timer);room.timer=null;room.turnDeadline=null;}
function delayed(room,fn,ms){const t=setTimeout(()=>{if(rooms.get(room.code)===room)fn();},ms);t.unref?.();return t;}
function blockingRoom(id,except){return [...rooms.values()].find(r=>r.code!==except&&r.players.some(p=>p.id===id&&(p.socketId||p.inRound&&active(r))));}
function attach(socket,room,p){const other=p.socketId;if(other&&other!==socket.id){const old=io.sockets.sockets.get(other);if(old){old.data.room=null;old.disconnect(true);}}
 p.socketId=socket.id;p.disconnectedAt=0;socket.data.room=room.code;socket.join(room.code);chooseHost(room);publish(room);}
function leave(socket,voluntary){const x=current(socket);if(!x)return;const {room,p}=x;p.socketId=null;p.disconnectedAt=Date.now();socket.data.room=null;socket.leave(room.code);
 if(voluntary){if(active(room)&&p.inRound){if(room.mode==='holdem')p.folded=true;else p.stood=true;p.status='LEFT';if(room.currentId===p.id)moveTurn(room);}
 else room.players=room.players.filter(q=>q.id!==p.id);event(room,`${p.name} left`);}else event(room,`${p.name} disconnected`);
 chooseHost(room);if(room.players.length===0){timerOff(room);rooms.delete(room.code);}else publish(room);}
async function auth(socket,user,token){if(!user)return null;const other=[...io.sockets.sockets.values()].find(s=>s.id!==socket.id&&s.data.userId===user.id);if(other){leave(other,false);other.data.userId=null;other.disconnect(true);}
 socket.data.userId=user.id;socket.data.username=user.username;socket.data.token=token||'';return user;}
function tryAsync(ack,fn){Promise.resolve().then(fn).catch(e=>{console.error('Action rejected:',e.message);ok(ack,{ok:false,error:e.message.length<140?e.message:'Unable to complete this request.'});});}
function newPlayer(u){return {id:u.id,name:u.username,chips:u.chips,wins:u.wins,games:u.games,socketId:null,disconnectedAt:0,hand:[],inRound:false,stood:false,folded:false,allIn:false,acted:false,streetBet:0,contributed:0,stack:u.chips,bet:0,status:'READY',result:null,lastChat:0};}
function roomPlayers(room){return room.players.filter(p=>p.inRound);}
function alive(room){return roomPlayers(room).filter(p=>!p.folded);}
function pending(room,p){return p.inRound&&!p.folded&&!p.allIn&&(!p.acted||p.streetBet<room.currentBet);}
function expire(room){if(!room.currentId)return;const p=room.players.find(p=>p.id===room.currentId);if(!p)return;if(room.mode==='21'){p.stood=true;p.status='AUTO STAND';}else if(room.currentBet===p.streetBet){p.acted=true;p.status='AUTO CHECK';}else{p.folded=true;p.status='AUTO FOLD';}moveTurn(room);}
function setTurn(room,p){timerOff(room);room.currentId=p.id;room.turnDeadline=Date.now()+TURN_MS;room.timer=delayed(room,()=>{if(room.currentId===p.id)expire(room);},TURN_MS);publish(room);}
function advance21(room){const ps=roomPlayers(room);for(let i=room.turnIndex+1;i<room.actionOrder.length;i++){
  const p=ps.find(x=>x.id===room.actionOrder[i]);if(!p||p.stood)continue;room.turnIndex=i;return setTurn(room,p);}
 void endBlackjack(room);}
function pay(p,amt){if(!Number.isSafeInteger(amt)||amt<0||amt>p.stack)throw Error('Invalid chip amount.');p.stack-=amt;p.contributed+=amt;p.streetBet+=amt;if(p.stack===0)p.allIn=true;}
function startRound(room){if(active(room)||room.phase==='settling')return false;
 const ps=room.players.filter(p=>p.socketId);if(ps.length<2||(room.mode==='21'&&ps.length!==2))return false;
 const min=room.mode==='21'?50:20;if(ps.some(p=>p.chips<min)){room.notice=`Everyone needs at least ${min} free arcade points to start. Try the daily bonus.`;publish(room);return false;}
 room.round++;room.roundId=`${room.code}:${room.round}:${tid()}`;room.deck=secureShuffle();room.board=[];room.dealer=[];room.pot=0;room.currentBet=0;room.lastRaise=20;room.currentId=null;room.turnIndex=-1;room.turnDeadline=null;room.notice='';room.stage='DEAL';room.settling=false;
 for(const p of room.players){p.inRound=ps.includes(p);p.hand=[];p.folded=false;p.stood=false;p.acted=false;p.allIn=false;p.streetBet=0;p.contributed=0;p.stack=p.chips;p.bet=0;p.status=p.inRound?'PLAYING':'SPECTATING';p.result=null;}
 if(room.mode==='21'){
  for(let i=0;i<2;i++){for(const p of ps)p.hand.push(room.deck.pop());room.dealer.push(room.deck.pop());}
  for(const p of ps){pay(p,50);p.bet=50;if(rules.twoCard21(p.hand)){p.stood=true;p.status='NATURAL 21';}}
  room.phase='playing';room.stage='YOUR MOVE';room.actionOrder=ps.map(p=>p.id);room.turnIndex=-1;
  event(room,'New Blackjack round!');publish(room);if(rules.twoCard21(room.dealer))void endBlackjack(room);else advance21(room);
 }else{
  for(let i=0;i<2;i++)for(const p of ps)p.hand.push(room.deck.pop());
  room.phase='preflop';room.stage='PREFLOP';const n=ps.length,di=room.round%n,sb=n===2?di:(di+1)%n,bb=(sb+1)%n;
  room.dealerSeat=ps[di].id;pay(ps[sb],10);pay(ps[bb],20);room.pot=30;room.currentBet=20;
  room.actionOrder=Array.from({length:n},(_,i)=>ps[(bb+1+i)%n].id);room.turnIndex=-1;
  event(room,'The cards are out. Blinds 10 / 20.');moveTurn(room);
 }
 return true;}
function moveTurn(room){if(!active(room))return;timerOff(room);room.currentId=null;
 if(room.mode==='21'){advance21(room);return;}
 if(alive(room).length<=1){void endHoldem(room);return;}
 const needs=room.actionOrder.filter(id=>room.players.some(p=>p.id===id&&pending(room,p)));
 if(!needs.length){advanceStreet(room);return;}
 const last=room.turnIndex;for(let step=1;step<=room.actionOrder.length;step++){const i=(last+step+room.actionOrder.length)%room.actionOrder.length;const p=room.players.find(p=>p.id===room.actionOrder[i]);if(p&&pending(room,p)){room.turnIndex=i;setTurn(room,p);return;}}
 advanceStreet(room);}
function advanceStreet(room){timerOff(room);room.currentId=null;room.currentBet=0;room.lastRaise=20;
 for(const p of roomPlayers(room)){p.streetBet=0;p.acted=false;}
 if(room.phase==='river'){void endHoldem(room);return;}
 const next=room.phase==='preflop'?'flop':room.phase==='flop'?'turn':'river';const number=next==='flop'?3:1;
 room.deck.pop(); // Burn a card before each community street.
 room.phase='transition';room.stage=`REVEALING ${next.toUpperCase()}`;publish(room);
 for(let i=0;i<number;i++)delayed(room,()=>{
  if(room.phase!=='transition')return;room.board.push(room.deck.pop());publish(room);
  if(i===number-1){delayed(room,()=>{
    if(room.phase!=='transition')return;room.phase=next;room.stage=next.toUpperCase();event(room,`${next.toUpperCase()} revealed`);
    const ps=roomPlayers(room),dealerIdx=ps.findIndex(p=>p.id===room.dealerSeat);
    room.actionOrder=Array.from({length:ps.length},(_,j)=>ps[(dealerIdx+j+1)%ps.length].id);room.turnIndex=-1;
    if(room.actionOrder.every(id=>{const p=ps.find(p=>p.id===id);return !p||p.folded||p.allIn;})){advanceStreet(room);return;}moveTurn(room);
  },REVEAL_DELAY);} },REVEAL_DELAY*(i+1));
}
function pokerPayouts(room){const ps=roomPlayers(room),paymap=new Map(ps.map(p=>[p.id,0]));const winners=new Set(),levels=[...new Set(ps.map(p=>p.contributed).filter(n=>n>0))].sort((a,b)=>a-b);let previous=0;
 if(!alive(room).length){for(const p of ps)paymap.set(p.id,p.contributed);return {paymap,winners,hand:'ROUND CANCELLED'};}
 if(alive(room).length===1){const winner=alive(room)[0];winners.add(winner.id);paymap.set(winner.id,ps.reduce((sum,p)=>sum+p.contributed,0));return {paymap,winners,hand:'LAST PLAYER STANDING'};}
 let label='';
 for(const level of levels){const contestants=ps.filter(p=>p.contributed>=level),pot=(level-previous)*contestants.length,eligible=contestants.filter(p=>!p.folded);previous=level;if(!pot||!eligible.length)continue;
  const best=rules.holdemWinners(eligible,room.board),ids=best.winners;
  const base=Math.floor(pot/ids.length),extra=pot%ids.length;ids.forEach((id,i)=>{paymap.set(id,paymap.get(id)+base+(i<extra?1:0));winners.add(id);});label=best.rank||label;
 }
 return {paymap,winners,hand:label};}
async function endHoldem(room){if(room.settling||room.phase==='results')return;room.settling=true;timerOff(room);room.phase='settling';room.currentId=null;
 const ps=roomPlayers(room),{paymap,winners,hand}=pokerPayouts(room);const entries=ps.map(p=>({id:p.id,delta:(paymap.get(p.id)||0)-p.contributed,won:winners.has(p.id)}));
 try{await accounts.settleRound(room.roundId,'holdem',entries,ps.reduce((s,p)=>s+p.contributed,0));for(const p of ps){const e=entries.find(x=>x.id===p.id);p.result={kind:p.folded?'fold':e.won?'win':'loss',label:p.folded?'FOLDED':e.won?'VICTORY':'ROUND COMPLETE',delta:e.delta};const u=await accounts.getUser(p.id);if(u)Object.assign(p,{chips:u.chips,wins:u.wins,games:u.games});}room.notice=hand?`Winning combination: ${hand}`:'Showdown complete.';}
 catch(e){console.error('Poker settlement:',e);room.notice='Scores could not be saved. Contact the host.';for(const p of ps)p.result={kind:'error',label:'SAVE ERROR',delta:0};}
 room.phase='results';room.settling=false;event(room,'Hand finished');publish(room);leaderboard();}
async function endBlackjack(room){if(room.settling||room.phase==='results')return;room.settling=true;timerOff(room);room.currentId=null;room.phase='settling';
 const ps=roomPlayers(room);if(ps.some(p=>!rules.valueOf(p.hand).busted)){while(rules.valueOf(room.dealer).total<17)room.dealer.push(room.deck.pop());}
 const dealer=rules.valueOf(room.dealer),dNatural=rules.twoCard21(room.dealer),entries=[];
 for(const p of ps){const hand=rules.valueOf(p.hand),natural=rules.twoCard21(p.hand);
  let delta=0,won=false,label='PUSH';if(hand.busted){delta=-p.bet;label='BUST';}
  else if(natural&&!dNatural){delta=Math.floor(p.bet*1.5);won=true;label='NATURAL 21';}
  else if(dNatural&&!natural){delta=-p.bet;label='DEALER 21';}
  else if(dealer.busted||hand.total>dealer.total){delta=p.bet;won=true;label='YOU WIN';}
  else if(hand.total<dealer.total){delta=-p.bet;label='DEALER WINS';}
  entries.push({id:p.id,delta,won,label});}
 try{await accounts.settleRound(room.roundId,'21',entries,ps.reduce((s,p)=>s+p.bet,0));for(const p of ps){const e=entries.find(x=>x.id===p.id);p.result={kind:e.won?'win':e.delta===0?'push':'loss',label:e.label,delta:e.delta};const u=await accounts.getUser(p.id);if(u)Object.assign(p,{chips:u.chips,wins:u.wins,games:u.games});}room.notice=`Dealer finished at ${dealer.total}${dealer.busted?' (bust)':''}.`;}
 catch(e){console.error('Blackjack settlement:',e);room.notice='Scores could not be saved. Contact the host.';for(const p of ps)p.result={kind:'error',label:'SAVE ERROR',delta:0};}
 room.phase='results';room.settling=false;event(room,'Dealer revealed the hand');publish(room);leaderboard();}
function action21(room,p,payload){if(room.phase!=='playing'||room.currentId!==p.id||p.stood)throw Error('It is not your turn.');
 if(payload.type==='hit'){p.hand.push(room.deck.pop());p.status='HIT';if(rules.valueOf(p.hand).total>=21){p.stood=true;p.status=rules.valueOf(p.hand).busted?'BUST':'21';}}
 else if(payload.type==='stand'){p.stood=true;p.status='STAND';}
 else if(payload.type==='double'){if(p.hand.length!==2||p.stack<p.bet)throw Error('Double is not available.');pay(p,p.bet);p.bet*=2;p.hand.push(room.deck.pop());p.stood=true;p.status='DOUBLE';}
 else throw Error('Unknown action.');
 if(p.stood){moveTurn(room);}else publish(room);}
function actionPoker(room,p,payload){if(!['preflop','flop','turn','river'].includes(room.phase)||room.currentId!==p.id||p.folded||p.allIn)throw Error('It is not your turn.');
 const need=room.currentBet-p.streetBet;const type=payload.type;
 if(type==='check'){if(need>0)throw Error('You must call or fold.');p.acted=true;p.status='CHECK';}
 else if(type==='fold'){p.folded=true;p.acted=true;p.status='FOLD';}
 else if(type==='call'){if(need<=0)throw Error('Nothing to call.');pay(p,Math.min(need,p.stack));p.acted=true;p.status=p.allIn?'ALL-IN':'CALL';}
 else if(type==='raise'||type==='bet'||type==='allin'){
  const amount=type==='allin'?p.streetBet+p.stack:Number(payload.amount);
  if(type==='allin'&&amount<=room.currentBet){if(!p.stack)throw Error('No points available to call.');pay(p,p.stack);p.acted=true;p.status='ALL-IN';room.pot=roomPlayers(room).reduce((s,x)=>s+x.contributed,0);event(room,`${p.name}: ALL-IN`);moveTurn(room);return;}
  if(!Number.isSafeInteger(amount)||amount<=room.currentBet||amount>p.streetBet+p.stack)throw Error('Invalid raise amount.');
  if(amount<room.currentBet+room.lastRaise&&amount!==p.streetBet+p.stack)throw Error(`Minimum raise is ${room.currentBet+room.lastRaise}.`);
  const oldBet=room.currentBet,raise=amount-oldBet;pay(p,amount-p.streetBet);room.currentBet=amount;
  if(raise>=room.lastRaise){room.lastRaise=raise;for(const other of roomPlayers(room))if(other!==p&&!other.folded&&!other.allIn)other.acted=false;}
  p.acted=true;p.status=p.allIn?'ALL-IN':oldBet===0?'BET':'RAISE';
 }else throw Error('Unknown action.');
 room.pot=roomPlayers(room).reduce((s,x)=>s+x.contributed,0);event(room,`${p.name}: ${p.status}`);moveTurn(room);}
function makeRoom(u,payload){const mode=payload.mode==='holdem'?'holdem':'21',vis=payload.visibility==='public'?'public':'private';const maxPlayers=mode==='21'?2:Math.max(2,Math.min(6,Number(payload.maxPlayers)||6));const name=String(payload.name||'').trim().replace(/[<>\x00-\x1f]/g,'').slice(0,24)|| (vis==='public'?'SHADOW TABLE':'PRIVATE TABLE');const code=randomCode();const room={code,name,visibility:vis,maxPlayers,mode,hostId:u.id,players:[newPlayer(u)],phase:'lobby',round:0,roundId:'',deck:[],board:[],dealer:[],stage:'WAITING',turnIndex:-1,actionOrder:[],currentId:null,turnDeadline:null,timer:null,pot:0,currentBet:0,lastRaise:20,blind:20,chat:[],activity:[],notice:'',lastActive:Date.now(),settling:false};rooms.set(code,room);return room;}
io.on('connection',socket=>{
 socket.data.attempts=0;socket.data.started=Date.now();let authPending=false;
 function authLimit(){if(Date.now()-socket.data.started>60000){socket.data.attempts=0;socket.data.started=Date.now();}return ++socket.data.attempts<=8;}
 socket.emit('rooms:list',{rooms:publicList()});
 socket.on('auth:register',(payload={},ack)=>tryAsync(ack,async()=>{if(!authLimit())throw Error('Too many attempts. Try again later.');const u=await accounts.register(payload.username,payload.password,payload.email);const token=await accounts.createSession(u.id);await auth(socket,u,token);const {recoveryCode,...profile}=u;ok(ack,{ok:true,user:profile,token,persistent:accounts.isPersistent(),recoveryCode});leaderboard();}));
 socket.on('auth:login',(payload={},ack)=>tryAsync(ack,async()=>{if(!authLimit())throw Error('Too many attempts. Try again later.');const u=await accounts.login(payload.username,payload.password);const token=await accounts.createSession(u.id);await auth(socket,u,token);ok(ack,{ok:true,user:u,token,persistent:accounts.isPersistent()});}));
 socket.on('auth:resume',(payload={},ack)=>tryAsync(ack,async()=>{const u=await accounts.getSessionUser(payload.token);if(!u)throw Error('Please log in again.');await auth(socket,u,payload.token);ok(ack,{ok:true,user:u,persistent:accounts.isPersistent()});}));
 socket.on('auth:recover',(payload={},ack)=>tryAsync(ack,async()=>{if(!authLimit())throw Error('Too many attempts.');await accounts.resetPassword(payload.username,payload.recoveryCode,payload.newPassword);ok(ack,{ok:true});}));
 socket.on('auth:logout',(_,ack)=>tryAsync(ack,async()=>{leave(socket,true);await accounts.revokeSession(socket.data.token);socket.data.userId=null;socket.data.token=null;ok(ack,{ok:true});}));
 socket.on('leaderboard:fetch',(_,ack)=>tryAsync(ack,async()=>ok(ack,{ok:true,rows:await accounts.leaderboard(),persistent:accounts.isPersistent()})));
 socket.on('quests:fetch',(_,ack)=>tryAsync(ack,async()=>{if(!socket.data.userId)throw Error('Log in first.');ok(ack,{ok:true,quests:await accounts.questsFor(socket.data.userId)});}));
 socket.on('quests:claim',(payload={},ack)=>tryAsync(ack,async()=>{if(!socket.data.userId)throw Error('Log in first.');const r=await accounts.claimQuest(socket.data.userId,payload.id);socket.emit('account:update',r.user);ok(ack,{ok:true,reward:r.reward,user:r.user,quests:await accounts.questsFor(socket.data.userId)});leaderboard();}));
 socket.on('bonus:claim',(_,ack)=>tryAsync(ack,async()=>{if(!socket.data.userId)throw Error('Log in first.');if(blockingRoom(socket.data.userId))throw Error('Finish your current round first.');const u=await accounts.dailyBonus(socket.data.userId);socket.emit('account:update',u);ok(ack,{ok:true,user:u});leaderboard();}));
 socket.on('rooms:fetch',(_,ack)=>ok(ack,{ok:true,rooms:publicList()}));
 socket.on('room:create',(payload={},ack)=>tryAsync(ack,async()=>{if(!socket.data.userId)throw Error('Log in first.');if(current(socket)||blockingRoom(socket.data.userId))throw Error('Leave your current table first.');const u=await accounts.getUser(socket.data.userId);const room=makeRoom(u,payload);attach(socket,room,room.players[0]);ok(ack,{ok:true,code:room.code});}));
 socket.on('room:join',(payload={},ack)=>tryAsync(ack,async()=>{if(!socket.data.userId)throw Error('Log in first.');if(current(socket)||blockingRoom(socket.data.userId))throw Error('Leave your current table first.');const code=String(payload.code||'').trim().toUpperCase(),room=rooms.get(code);if(!room)throw Error('Room not found. Check the code.');if(active(room))throw Error('A game is underway. Join between rounds.');const existing=room.players.find(p=>p.id===socket.data.userId);if(existing){attach(socket,room,existing);return ok(ack,{ok:true,code});}
  room.players=room.players.filter(p=>p.socketId||Date.now()-p.disconnectedAt<120000);if(room.players.length>=room.maxPlayers)throw Error('That room is full.');
  const u=await accounts.getUser(socket.data.userId),p=newPlayer(u);room.players.push(p);attach(socket,room,p);event(room,`${p.name} joined`);publish(room);ok(ack,{ok:true,code});}));
 socket.on('room:resume',(payload={},ack)=>{const code=String(payload.code||'').toUpperCase(),room=rooms.get(code),p=room?.players.find(p=>p.id===socket.data.userId);if(!room||!p)return ok(ack,{ok:false,error:'That room no longer exists.'});attach(socket,room,p);ok(ack,{ok:true,code});});
 socket.on('room:leave',(_,ack)=>{leave(socket,true);ok(ack,{ok:true});});
 socket.on('room:start',(_,ack)=>{const x=current(socket);if(!x)return ok(ack,{ok:false,error:'Not in a room.'});if(x.room.hostId!==x.p.id)return ok(ack,{ok:false,error:'Only the host starts rounds.'});ok(ack,{ok:startRound(x.room),error:'Need eligible connected players and a finished round.'});});
 socket.on('room:action',(payload={},ack)=>{const x=current(socket);if(!x)return ok(ack,{ok:false,error:'Not in a room.'});try{if(x.room.mode==='21')action21(x.room,x.p,payload);else actionPoker(x.room,x.p,payload);ok(ack,{ok:true});}catch(e){ok(ack,{ok:false,error:e.message});}});
 socket.on('room:chat',(payload={},ack)=>{const x=current(socket);if(!x)return ok(ack,{ok:false,error:'Not in a room.'});if(typeof payload.message!=='string')return ok(ack,{ok:false,error:'Invalid message.'});const msg=payload.message.trim().replace(/[\x00-\x1f\x7f]/g,'').slice(0,160);if(!msg)return ok(ack,{ok:false,error:'Write a message first.'});if(Date.now()-x.p.lastChat<1200)return ok(ack,{ok:false,error:'Please wait before sending again.'});x.p.lastChat=Date.now();x.room.chat.push({sender:x.p.name,message:msg,at:Date.now()});x.room.chat=x.room.chat.slice(-45);publish(x.room);ok(ack,{ok:true});});
 socket.on('disconnect',()=>leave(socket,false));
});
const cleanup=setInterval(()=>{const now=Date.now();for(const [code,room] of rooms){if(['lobby','results'].includes(room.phase)){room.players=room.players.filter(p=>p.socketId||now-p.disconnectedAt<120000);chooseHost(room);}if(!room.players.some(p=>p.socketId)&&now-room.lastActive>600000){timerOff(room);rooms.delete(code);}}announceRooms();},60000);cleanup.unref?.();
const port=Number(process.env.PORT)||3000;
if(require.main===module){accounts.init().then(()=>httpServer.listen(port,'0.0.0.0',()=>console.log(`NIGHT JACK v3 listening on ${port}; database: ${accounts.isPersistent()}`))).catch(e=>{console.error('Database startup error:',e);process.exit(1);});}
module.exports={app,httpServer,io,rooms,accounts,snapshot,startRound,pokerPayouts};
