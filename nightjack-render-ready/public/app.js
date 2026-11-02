'use strict';
const app = document.getElementById('app');
const socket = io({reconnection:true,reconnectionDelay:500,reconnectionDelayMax:3500});
const sessionKey = 'nightjack-room-session';
let state = null;
let session = null;
let connecting = true;
let view = 'home';
let lastCardCount = 0;
let muted = sessionStorage.getItem('nightjack-muted') === '1';
let toastTimer;
let ticker;
let pending = false;
let chosenName = sessionStorage.getItem('nightjack-name') || '';
const pathnameCode = location.pathname.match(/^\/room\/([A-Z0-9]{6})\/?$/i)?.[1]?.toUpperCase() || '';
let chosenCode = pathnameCode;
try{session = JSON.parse(sessionStorage.getItem(sessionKey)||'null');}catch(_){session=null;}
if(session?.code) chosenCode=session.code;
function esc(str){return String(str ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function short(str,n=12){const s=String(str??'');return s.length>n?s.slice(0,n-1)+'…':s;}
function initials(name){return String(name||'?').split(/\s+/).map(x=>x[0]||'').join('').slice(0,2).toUpperCase();}
function avatar(p,gold=false){return `<span class="avatar ${gold?'gold':''}">${esc(initials(p.name))}</span>`;}
function showToast(message){const e=document.getElementById('toast');e.textContent=message;e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),3800);}
function emitAck(event,payload,onSuccess){
 if(!socket.connected){showToast('Connection lost. Trying to reconnect...');return;}
 if(pending)return;
 pending=true;
 socket.timeout(7000).emit(event,payload,(err,result)=>{
  pending=false;
  if(err){showToast('The server did not respond. Try again.');return;}
  if(!result?.ok){showToast(result?.error||'That did not work.');return;}
  if(onSuccess)onSuccess(result);
 });
}
function saveSession(result){
 session={code:result.code,playerId:result.playerId,token:result.token};
 sessionStorage.setItem(sessionKey,JSON.stringify(session));
 history.replaceState({},'',`/room/${result.code}`);
 view='room';
}
function clearSession(){
 session=null;state=null;view='home';lastCardCount=0;
 sessionStorage.removeItem(sessionKey);
 history.replaceState({},'', '/');
 render();
}
function tone(freq=600,duration=.05){
 if(muted)return;
 try{
  const Context=window.AudioContext||window.webkitAudioContext;
  if(!Context)return;
  const ctx=tone.ctx||(tone.ctx=new Context());
  if(ctx.state==='suspended')ctx.resume();
  const osc=ctx.createOscillator(),vol=ctx.createGain();
  osc.type='sine';osc.frequency.value=freq;
  vol.gain.setValueAtTime(.0001,ctx.currentTime);vol.gain.exponentialRampToValueAtTime(.07,ctx.currentTime+.01);vol.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+duration);
  osc.connect(vol);vol.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+duration+.02);
 }catch(_){}
}
function brand(){return `<a class="brand" href="/" data-action="navigate-home"><span class="brand-symbol">♠</span><span class="brand-word">NIGHT<span>JACK</span></span></a>`;}
function topbar(inRoom=false){return `<header class="topbar">
  ${brand()}
  <div class="top-status"><span class="dot ${socket.connected?'':'off'}"></span>${socket.connected?'CONNECTED':'RECONNECTING'}</div>
  <div class="top-actions">${inRoom?`<button class="tiny-button" data-action="invite">↗ INVITE FRIENDS</button>`:''}<button class="tiny-button" data-action="toggle-sound" title="Toggle sounds">${muted?'♪ OFF':'♫ ON'}</button></div>
  </header>`;}
function cardHTML(card,index=0){
 if(!card || card.hidden)return `<div class="playing-card back" style="animation-delay:${Math.min(index*0.08,.45)}s" aria-label="Face-down card"><div class="back-emblem">♠</div></div>`;
 const red=card.suit==='♥'||card.suit==='♦';
 return `<div class="playing-card ${red?'red':''}" style="animation-delay:${Math.min(index*.08,.4)}s" aria-label="${esc(card.rank)} of ${esc(card.suit)}">
   <div class="corner">${esc(card.rank)}<small>${esc(card.suit)}</small></div><div class="card-middle">${esc(card.suit)}</div>
   <div class="corner bottom-corner">${esc(card.rank)}<small>${esc(card.suit)}</small></div>
  </div>`;
}
function handHTML(hand){return `<div class="card-hand">${(hand||[]).map(cardHTML).join('')}</div>`;}
function home(){return `<div class="page-wrap">${topbar()}
  <main class="home-grid">
  <section class="hero">
    <div class="eyebrow">THE PRIVATE TABLE EXPERIENCE</div>
    <h1 class="hero-title">The cards are out.<br><em>Your friends are in.</em></h1>
    <p class="hero-description">Your own table. Your own crew. Create a private room, send the code, and play classic Twenty-One together — wherever your friends are.</p>
    <div class="highlights"><span>♠ &nbsp; 2–6 PLAYERS</span><span>⌁ &nbsp; REAL-TIME MULTIPLAYER</span><span>✧ &nbsp; NO SIGN-UP</span><span>♧ &nbsp; JUST FOR FUN</span></div>
    <div class="hero-art" aria-hidden="true"><div class="sample-cards">${cardHTML({rank:'A',suit:'♠'})}${cardHTML({rank:'K',suit:'♥'})}</div><div class="sample-chip"></div></div>
  </section>
  <section class="entry-panel">
    <div class="eyebrow" style="font-size:10px;margin-bottom:11px">YOUR TABLE AWAITS</div>
    <h2 class="panel-heading">Make yourself at home.</h2><p class="panel-subtitle">A great game starts with great company. Jump into a private table in seconds.</p>
    <form id="entry-form" autocomplete="off">
      <div class="input-group"><label class="field-label" for="username">YOUR DISPLAY NAME</label><input id="username" class="text-field" maxlength="18" minlength="2" placeholder="What should we call you?" required value="${esc(chosenName)}"></div>
      <button class="primary-button full" type="button" data-action="create">＋ &nbsp; CREATE PRIVATE TABLE</button>
      <div class="divider-or">OR JOIN YOUR FRIENDS</div>
      <label class="field-label" for="room-code">6-CHARACTER INVITE CODE</label>
      <div class="join-row"><input id="room-code" class="text-field code-input" maxlength="6" placeholder="ABC123" value="${esc(chosenCode)}" aria-label="Room code"><button type="button" class="outline-button" data-action="join">JOIN →</button></div>
    </form>
    <div class="fair-play">♧ &nbsp; Free social card game. <b>No wagers, purchases or prizes.</b></div>
  </section>
  </main><footer class="site-footer">NIGHTJACK © 2026 · FRIENDS. CARDS. GOOD TIMES.</footer></div>`;}
function sidePlayers(s){const sorted=[...s.players].sort((a,b)=>b.score-a.score);
 return `<aside class="side-panel"><div class="side-head"><div class="side-overline">PRIVATE ROOM</div><div class="room-code-line"><div class="room-code-value">${esc(s.code)}</div><button data-action="copy-code" class="icon-button" title="Copy room code">▣</button></div><div class="side-overline" style="margin-top:9px">${s.players.filter(p=>p.connected).length}/${s.players.length} ONLINE · UP TO 6 PLAYERS</div></div>
 <div class="side-head" style="padding:18px 18px 10px;border:0"><div class="side-overline">TABLE LEADERBOARD</div></div>
 <div class="player-list">${sorted.map(p=>`<div class="player-row ${p.id===s.meId?'me':''}">${avatar(p,p.id===s.hostId)}<div class="player-id"><div class="player-name">${esc(short(p.name,14))}${p.id===s.hostId?'<span class="small-badge">HOST</span>':''}</div><div class="player-meta">${p.connected?'● Online':'○ Offline'} · ${p.wins}W ${p.losses}L</div></div><div class="small-score">${p.score}<div style="font-size:8px;color:#a1b49f;letter-spacing:1px;text-align:center">PTS</div></div></div>`).join('')}</div>
 <div class="side-bottom"><div class="score-note">Scoring: <b style="color:#f4d58c">3</b> Blackjack · <b>2</b> Win · <b>1</b> Push<br>Points are only for fun.</div><button class="link-button" data-action="leave">↶ Leave table</button></div>
 </aside>`;}
function personState(p,s){if(!p.connected)return '<span class="seat-state disconnected">Disconnected</span>';if(s.phase==='results'&&p.result)return `<span class="seat-state">${esc(p.result.label)}</span>`;if(s.phase==='playing'&&p.id===s.currentId)return '<span class="seat-state">● PLAYING</span>';if(p.blackjack)return '<span class="seat-state">BLACKJACK</span>';if(p.stood)return '<span class="seat-state">STOOD</span>';return '<span class="seat-state">READY</span>';}
function seats(s){
 if(s.phase==='lobby'){return `<div class="player-seats">${s.players.map(p=>`<div class="seat"><div class="avatar ${p.id===s.hostId?'gold':''}" style="margin-bottom:8px">${esc(initials(p.name))}</div><div class="seat-name">${esc(short(p.name,10))}</div><span class="seat-state">${p.id===s.hostId?'HOST':p.connected?'JOINED':'OFFLINE'}</span></div>`).join('')}${Array.from({length:Math.max(0,Math.min(4,6-s.players.length))},()=>`<div class="seat empty-seat"><div class="empty-seat-icon">＋</div><div class="empty-seat-label">OPEN SEAT</div></div>`).join('')}</div>`;}
 return `<div class="player-seats">${s.players.filter(p=>p.inRound).map(p=>`<div class="seat ${p.id===s.currentId?'active':''}"><div class="seat-name">${p.id===s.meId?'✦ ':''}${esc(short(p.name,10))}</div><div class="seat-score">${p.total} ${p.blackjack?'★':''}</div>${handHTML(p.hand)}${personState(p,s)}</div>`).join('')}</div>`;
}
function timerText(s){if(!s.turnDeadline)return '';const t=Math.max(0,Math.ceil((s.turnDeadline-Date.now())/1000));return `${t}s`;}
function tableMiddle(s){
 if(s.phase==='lobby')return `<div class="table-note">YOUR TABLE IS READY<small>Invite friends with code ${esc(s.code)}</small></div>`;
 if(s.phase==='results')return `<div class="table-note">ROUND ${s.round} COMPLETE<small>See the results below the table</small></div>`;
 const p=s.players.find(p=>p.id===s.currentId);
 return `<div class="table-note">${p?.id===s.meId?'YOUR TURN':esc(p?.name||'Dealer')+'’S TURN'}<small>Hit for another card or stand to keep your hand · <span id="turn-timer">${timerText(s)}</span></small></div>`;
}
function gameControls(s){
 const me=s.players.find(p=>p.id===s.meId);const isHost=s.hostId===s.meId;const isTurn=s.phase==='playing'&&s.currentId===s.meId&&socket.connected;
 if(s.phase==='lobby')return `<div class="control-box"><div class="control-info"><strong>${isHost?'Ready to deal?':'Waiting for the host'}</strong><p>${isHost?'Your friends need to join first. At least two players are required.':'Share the room code and get comfortable. The host starts the game.'}</p></div><div class="control-buttons"><button class="primary-button" data-action="start" ${!isHost||s.players.filter(p=>p.connected).length<2?'disabled':''}>DEAL THE CARDS →</button></div></div>`;
 if(s.phase==='results'){
  const results=s.players.filter(p=>p.inRound).map(p=>`${esc(p.name)}: ${esc(p.result?.label||'—')} <b>+${p.result?.points||0}</b>`).join(' &nbsp;·&nbsp; ');
  return `<div class="control-box"><div class="control-info"><strong>Round ${s.round} results</strong><p class="round-scores">${results}</p></div><div class="control-buttons"><button class="primary-button" data-action="start" ${!isHost||s.players.filter(p=>p.connected).length<2?'disabled':''}>${isHost?'NEXT ROUND →':'WAITING FOR HOST'}</button></div></div>`;
 }
 return `<div class="control-box"><div class="control-info"><strong>${isTurn?'Your move, '+esc(short(me.name,14))+'!':'The table is playing'}</strong><p>${isTurn?'Get closer to 21 without going over.':'Watch the cards and wait for your turn.'}</p></div><div class="control-buttons"><button class="outline-button" data-action="stand" ${!isTurn?'disabled':''}>✋ &nbsp; STAND</button><button class="primary-button" data-action="hit" ${!isTurn?'disabled':''}>＋ &nbsp; HIT</button></div></div>`;
}
function tableColumn(s){
 const dealer=s.dealer||{hand:[],total:null};
 return `<main class="table-column"><div class="table-header"><div><div class="table-title">The Private Table</div><div class="table-meta">${s.phase==='lobby'?'WAITING ROOM':`ROUND ${s.round}`} · CLASSIC 21</div></div><div class="table-indicator">♠ &nbsp; ${s.players.filter(p=>p.connected).length} PLAYERS ONLINE</div></div>
 <div class="felt-table"><div class="dealer-zone"><div class="seat-label">✦ &nbsp; THE DEALER &nbsp; ✦</div><div class="dealer-total">${dealer.total==null?(s.phase==='lobby'?'THE HOUSE IS READY':'ONE CARD IS HIDDEN'):`TOTAL ${dealer.total}`}</div>${s.phase==='lobby'?handHTML([{hidden:true},{hidden:true}]):handHTML(dealer.hand)}</div><div class="table-middle">${tableMiddle(s)}</div>${seats(s)}</div>
 ${s.phase==='results'?`<div class="result-banner">✦ &nbsp; THE CARDS ARE ON THE TABLE<small>Scoring is for fun: no betting, payments or prizes</small></div>`:''}
 ${gameControls(s)}
 </main>`;
}
function chatColumn(s){const messages=s.chat.map(msg=>`<div class="chat-entry">${avatar({name:msg.sender})}<div class="chat-details"><div class="chat-name">${esc(short(msg.sender,18))}<span class="chat-time">${new Date(msg.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div><p class="chat-text">${esc(msg.message)}</p></div></div>`).join('');
 return `<aside class="side-panel chat-panel"><div class="side-head"><div class="side-overline">KEEP THE CONVERSATION GOING</div><h2 class="side-title">Table Chat <span style="color:var(--gold);font-size:16px">✦</span></h2></div>
 <div class="chat-log" id="chat-log">${messages||'<div class="chat-empty">No messages yet.<br>Say hello to your table. ♡</div>'}</div>
 <form class="chat-compose" id="chat-form"><input class="text-field" name="chat" id="chat-input" maxlength="160" autocomplete="off" placeholder="Say something nice..." aria-label="Chat message"><button class="chat-send" type="submit" title="Send message">➤</button></form>
 <div class="activity-section"><h4>TABLE ACTIVITY</h4>${s.activity.slice(-4).reverse().map(entry=>`<div class="activity-line">${esc(entry.message)}</div>`).join('')||'<div class="activity-line">Your room has been created.</div>'}</div></aside>`;
}
function room(s){return `<div class="page-wrap">${topbar(true)}<div class="room-layout">${sidePlayers(s)}${tableColumn(s)}${chatColumn(s)}</div><footer class="site-footer">YOUR PRIVATE ROOM · VIRTUAL POINTS ONLY · NO CASH PLAY</footer></div>`;}
function render(){
 if(connecting){app.innerHTML=`<div class="loading-screen"><div class="brand-symbol">♠</div><div class="brand-word">NIGHT<span>JACK</span></div><div class="loading-line"></div><p>Preparing your table...</p></div>`;return;}
 const chatBox=document.getElementById('chat-log');const atBottom=!chatBox||chatBox.scrollHeight-chatBox.scrollTop-chatBox.clientHeight<100;
 const chatInput=document.getElementById('chat-input');const wasChatFocused=document.activeElement===chatInput;const draft=chatInput?.value;
 app.innerHTML=view==='room'&&state?room(state):home();
 if(view==='room'){
  const fresh=document.getElementById('chat-log');if(fresh&&atBottom)fresh.scrollTop=fresh.scrollHeight;
  const input=document.getElementById('chat-input');if(input&&draft)input.value=draft;
  if(input&&wasChatFocused){input.focus();input.setSelectionRange(input.value.length,input.value.length);}
 }
}
function create(){const name=document.getElementById('username')?.value?.trim();if(!name||name.length<2){showToast('Please enter a name with at least 2 characters.');return;}chosenName=name;sessionStorage.setItem('nightjack-name',name);tone(700);emitAck('room:create',{name},result=>{saveSession(result);render();});}
function join(){const name=document.getElementById('username')?.value?.trim();const code=document.getElementById('room-code')?.value?.trim().toUpperCase();if(!name||name.length<2){showToast('Please enter a name with at least 2 characters.');return;}if(!/^[A-Z0-9]{6}$/.test(code||'')){showToast('Enter a valid 6-character room code.');return;}chosenName=name;chosenCode=code;sessionStorage.setItem('nightjack-name',name);tone(650);emitAck('room:join',{name,code},result=>{saveSession(result);render();});}
function copy(text){navigator.clipboard?.writeText(text).then(()=>showToast('Copied to clipboard!'),()=>showToast('Copy not available. Select the code instead.'))||showToast(text);}
function onAction(type){if(type==='hit'||type==='stand'){tone(type==='hit'?840:520);emitAck('room:action',{type});}}
function leave(){emitAck('room:leave',{},()=>clearSession());}
function start(){tone(740,.09);emitAck('room:start',{});}
function tick(){const el=document.getElementById('turn-timer');if(el&&state)el.textContent=timerText(state);}
app.addEventListener('click',event=>{
 const control=event.target.closest('[data-action]');if(!control)return;
 const action=control.dataset.action;
 if(action==='create')create();else if(action==='join')join();else if(action==='hit'||action==='stand')onAction(action);
 else if(action==='start')start();else if(action==='leave')leave();
 else if(action==='copy-code'&&state)copy(state.code);
 else if(action==='invite'&&state)copy(`${location.origin}/room/${state.code}`);
 else if(action==='navigate-home'){event.preventDefault();if(view==='room')showToast('Use Leave table to exit your room.');else{history.replaceState({},'','/');render();}}
 else if(action==='toggle-sound'){muted=!muted;sessionStorage.setItem('nightjack-muted',muted?'1':'0');render();if(!muted)tone(640);}
});
app.addEventListener('submit',event=>{
 event.preventDefault();
 if(event.target.id==='chat-form'){
  const input=document.getElementById('chat-input');const message=input?.value?.trim();
  if(!message)return;
  emitAck('room:chat',{message},()=>{if(input)input.value='';});
 }else if(event.target.id==='entry-form')join();
});
app.addEventListener('input',event=>{if(event.target.id==='room-code')event.target.value=event.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'');});
socket.on('connect',()=>{
 connecting=false;
 if(session?.code&&session?.token){
  socket.timeout(7000).emit('room:resume',session,(err,response)=>{
   if(err){showToast('The server is taking a while. Reconnecting...');render();return;}
   if(!response?.ok){clearSession();showToast(response?.error||'Your room is no longer available.');return;}
   saveSession(response);render();
  });
 }else render();
});
socket.on('room:state',s=>{
 const count=s.players.reduce((n,p)=>n+(p.hand?.length||0),0)+(s.dealer?.hand?.length||0);
 if(state&&count>lastCardCount)tone(640,.035);
 lastCardCount=count;
 state=s;view='room';connecting=false;render();
});
socket.on('disconnect',()=>{if(view==='room')showToast('Connection lost. Reconnecting...');render();});
setTimeout(()=>{if(connecting){connecting=false;render();showToast('Connecting to the server...');}},4000);
ticker=setInterval(tick,500);
