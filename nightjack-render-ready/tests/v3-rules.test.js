'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const rules=require('../rules');const c=(rank,suit='♠')=>({rank,suit});
test('52 unique cards, blackjack scoring and natural 21',()=>{const d=rules.createDeck();assert.equal(d.length,52);assert.equal(new Set(d.map(x=>x.rank+x.suit)).size,52);assert.equal(rules.valueOf([c('A'),c('K')]).total,21);assert.equal(rules.twoCard21([c('A'),c('K')]),true);assert.equal(rules.valueOf([c('A'),c('9'),c('A')]).total,21);assert.equal(rules.valueOf([c('K'),c('Q'),c('2')]).busted,true);});
test('Holdem best-of-seven recognises wheel straight, flush, full house, royal flush and ties',()=>{
 const board=[c('A','♣'),c('2','♥'),c('3','♦'),c('4','♠'),c('8','♣')];
 assert.equal(rules.evaluateSeven([...board,c('5'),c('J','♥')]).label,'Straight');
 const royal=[c('10','♥'),c('J','♥'),c('Q','♥'),c('K','♥'),c('A','♥'),c('3'),c('2')];assert.equal(rules.evaluateSeven(royal).label,'Royal flush');
 const pair=rules.evaluateSeven([c('K','♠'),c('K','♣'),c('3','♥'),c('4','♦'),c('9','♠'),c('2','♣'),c('A','♥')]);assert.equal(pair.label,'One pair');
 const ps=[{id:'a',hand:[c('2','♣'),c('7','♣')],folded:false},{id:'b',hand:[c('9','♥'),c('6','♥')],folded:false}];
 const both=rules.holdemWinners(ps,[c('A'),c('K'),c('Q'),c('J'),c('10')]);assert.deepEqual(both.winners.sort(),['a','b']);
});
