'use strict';
const {valueOf,evaluateSeven}=require('./rules');
const accounts=require('./account-store');
function serialized(room,viewer){const results=room.phase==='results',inGame=room.phase!=='lobby'&&!results;
 return {code:room.code,mode:room.mode,phase:room.phase,round:room.round,hostId:room.hostId,meId:viewer.id,currentId:room.currentId,turnDeadline:room.turnDeadline,
 players:room.players.map(p=>{const visible=results||p.id===viewer.id;return {id:p.id,name:p.name,connected:!!p.socketId,chips:p.chips,wins:p.wins,games:p.games,inRound:p.inRound,stood:p.stood,folded:p.folded,
 hand:p.inRound?(visible?p.hand:p.hand.map(()=>({hidden:true}))):[],total:p.inRound&&room.mode==='21'&&visible?valueOf(p.hand).total:null,
 result:results?p.result:null,pokerRank:results&&room.mode==='holdem'&&p.inRound&&!p.folded?evaluateSeven([...p.hand,...room.board]).label:null};}),
 board:room.board,activity:room.activity,chat:room.chat,connectedCount:room.players.filter(p=>p.socketId).length,
 // No deck, unrevealed board, opponent ranks or other players' card data are sent before the results phase.
 notice:room.notice||'',persistentAccounts:accounts.isPersistent(),
 };
}
module.exports={serialized};
