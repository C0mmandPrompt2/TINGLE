'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {serialized}=require('../state');const c=(rank,suit='♣')=>({rank,suit});
const user={id:'one',name:'Ada',chips:2000,wins:0,games:0,socketId:'s1',hand:[c('K'),c('9')],inRound:true,stood:false,folded:false,result:null};
const rival={id:'two',name:'Bex',chips:2000,wins:0,games:0,socketId:'s2',hand:[c('A','♥'),c('Q','♥')],inRound:true,stood:false,folded:false,result:null};
function room(mode='21',phase='playing'){return {code:'ABCDEF',mode,phase,round:1,hostId:'one',currentId:'one',turnDeadline:null,players:[structuredClone(user),structuredClone(rival)],board:[],activity:[],chat:[],notice:''};}
test('PvP Twenty-One only shows the viewer their own cards and total',()=>{const game=room();const a=serialized(game,game.players[0]);assert.deepEqual(a.players[0].hand,user.hand);assert.deepEqual(a.players[1].hand,[{hidden:true},{hidden:true}]);assert.equal(a.players[1].total,null);assert.equal(JSON.stringify(a).includes('♥'),false);assert.equal(JSON.stringify(a).includes('Q'),false);});
test('holdem keeps private hole cards and only sends revealed board',()=>{const game=room('holdem','flop');game.board=[c('2'),c('3'),c('4')];const a=serialized(game,game.players[0]);assert.equal(a.players[1].hand[0].hidden,true);assert.equal(a.board.length,3);assert.equal(JSON.stringify(a).includes('♥'),false);});
test('reveal all hands when the round ends',()=>{const game=room('21','results');const a=serialized(game,game.players[0]);assert.deepEqual(a.players[1].hand,rival.hand);assert.equal(a.players[1].total,21);});
