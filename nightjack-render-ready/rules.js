'use strict';
const SUITS=['♠','♥','♦','♣'];
const RANKS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
function createDeck(){return SUITS.flatMap(suit=>RANKS.map(rank=>({suit,rank})));}
function shuffle(deck, random=Math.random){const a=[...deck];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function valueOf(hand){let total=0,aces=0;for(const {rank} of hand){if(rank==='A'){total+=11;aces++;}else if('JQK'.includes(rank)&&rank.length===1){total+=10;}else total+=Number(rank);}while(total>21&&aces){total-=10;aces--;}return {total,busted:total>21,soft:aces>0};}
function twoCard21(hand){return hand.length===2&&valueOf(hand).total===21;}
function twentyOneWinners(players){const live=players.filter(p=>!valueOf(p.hand).busted);if(!live.length)return {winners:[],top:0};const top=Math.max(...live.map(p=>valueOf(p.hand).total));return {top,winners:live.filter(p=>valueOf(p.hand).total===top).map(p=>p.id)};}
const HIGH={A:14,K:13,Q:12,J:11};
function rankValue(c){return HIGH[c.rank]||Number(c.rank);}
function evaluateFive(cards){const vals=cards.map(rankValue).sort((a,b)=>b-a);const count=new Map();for(const v of vals)count.set(v,(count.get(v)||0)+1);const flush=cards.every(c=>c.suit===cards[0].suit);
 const unique=[...new Set(vals)];if(unique.includes(14))unique.push(1);
 let highStraight=0;for(let i=0;i<=unique.length-5;i++){if(unique[i]-unique[i+4]===4){highStraight=unique[i];break;}}
 if(flush&&highStraight)return {rank:[8,highStraight],label:highStraight===14?'Royal flush':'Straight flush'};
 const groups=[...count.entries()].map(([v,n])=>({v,n})).sort((a,b)=>b.n-a.n||b.v-a.v);
 if(groups[0].n===4)return {rank:[7,groups[0].v,groups[1].v],label:'Four of a kind'};
 if(groups[0].n===3&&groups[1].n===2)return {rank:[6,groups[0].v,groups[1].v],label:'Full house'};
 if(flush)return {rank:[5,...vals],label:'Flush'};
 if(highStraight)return {rank:[4,highStraight],label:'Straight'};
 if(groups[0].n===3)return {rank:[3,groups[0].v,...groups.slice(1).map(g=>g.v).sort((a,b)=>b-a)],label:'Three of a kind'};
 if(groups[0].n===2&&groups[1].n===2){const hi=Math.max(groups[0].v,groups[1].v),lo=Math.min(groups[0].v,groups[1].v);return {rank:[2,hi,lo,groups[2].v],label:'Two pair'};}
 if(groups[0].n===2)return {rank:[1,groups[0].v,...groups.slice(1).map(g=>g.v).sort((a,b)=>b-a)],label:'One pair'};
 return {rank:[0,...vals],label:'High card'};
}
function compareRanks(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return Math.sign(d);}return 0;}
function evaluateSeven(cards){if(!Array.isArray(cards)||cards.length<5||cards.length>7)throw new Error('5–7 cards required');let best=null;for(let a=0;a<cards.length-4;a++)for(let b=a+1;b<cards.length-3;b++)for(let c=b+1;c<cards.length-2;c++)for(let d=c+1;d<cards.length-1;d++)for(let e=d+1;e<cards.length;e++){const r=evaluateFive([cards[a],cards[b],cards[c],cards[d],cards[e]]);if(!best||compareRanks(r.rank,best.rank)>0)best=r;}return best;}
function holdemWinners(players,board){const active=players.filter(p=>!p.folded);if(!active.length)return {winners:[],rank:null};const ranked=active.map(p=>({id:p.id,...evaluateSeven([...p.hand,...board])}));let top=ranked[0];for(const r of ranked)if(compareRanks(r.rank,top.rank)>0)top=r;return {winners:ranked.filter(r=>compareRanks(r.rank,top.rank)===0).map(r=>r.id),rank:top.label,handRank:top.rank};}
module.exports={createDeck,shuffle,valueOf,twoCard21,twentyOneWinners,evaluateFive,evaluateSeven,compareRanks,holdemWinners};
