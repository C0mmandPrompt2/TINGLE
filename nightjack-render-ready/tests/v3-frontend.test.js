'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('Real frontend JS renders pixel menu, playable navigation, shop, settings and multiplayer room',()=>{
 const handlers={},events={},store=new Map([['nightjack-v3-session','fake-session']]),app={innerHTML:'',addEventListener(n,fn){handlers[n]=fn;}},toast={textContent:'',classList:{add(){},remove(){}}};
 const socket={connected:true,on(n,fn){events[n]=fn;},timeout(){return this;},emit(n,p,ack){if(n==='auth:resume')ack(null,{ok:true,user:{id:'u1',username:'PixelKnight',chips:2000,wins:3,games:7},persistent:true});else if(n==='leaderboard:fetch')ack({ok:true,rows:[]});else if(n==='quests:fetch')ack({ok:true,quests:[]});else if(n==='rooms:fetch')ack({ok:true,rooms:[]});else ack?.({ok:true});}};
 const fakeStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const context={io:()=>socket,document:{getElementById:id=>id==='app'?app:toast,querySelector(){return null;},body:{classList:{toggle(){}}}},localStorage:fakeStorage,sessionStorage:fakeStorage,location:{pathname:'/',origin:'https://nightjack.example'},history:{replaceState(){}},navigator:{clipboard:{writeText:async()=>{}}},window:{},console,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,Date,Math,Number,String,JSON,FormData:class{},confirm:()=>true};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'),context,{filename:'app.js'});
 events.connect();assert.match(app.innerHTML,/menu-poster/);assert.match(app.innerHTML,/data-nav="shop"/);assert.match(app.innerHTML,/2,000/);
 const click=dataset=>handlers.click({target:{closest(){return {dataset}}}});
 click({nav:'shop'});assert.match(app.innerHTML,/COMING/);assert.match(app.innerHTML,/NIGHT MARKET/);
 click({nav:'settings'});assert.match(app.innerHTML,/CARD ANIMATIONS/);assert.match(app.innerHTML,/MUTE AUDIO/);
 click({nav:'games'});assert.match(app.innerHTML,/CHOOSE YOUR GAME/);assert.match(app.innerHTML,/data-game="21"/);
 click({game:'holdem'});assert.match(app.innerHTML,/FIND A TABLE/);assert.match(app.innerHTML,/BROWSE PUBLIC/);
 events['room:state']({code:'ABC123',name:'TEST TABLE',mode:'holdem',visibility:'private',maxPlayers:6,phase:'lobby',round:0,stage:'WAITING',hostId:'u1',meId:'u1',currentId:null,turnDeadline:null,pot:0,currentBet:0,minRaise:20,players:[{id:'u1',name:'PixelKnight',chips:2000,wins:3,games:7,inRound:false,hand:[],connected:true,status:'READY'}],connectedCount:1,dealer:[],board:[],activity:[],chat:[{sender:'PixelKnight',message:'Hello!'}],notice:''});
 assert.match(app.innerHTML,/LIVE TABLE CHAT/);assert.match(app.innerHTML,/Hello!/);assert.match(app.innerHTML,/ABC123/);
});
