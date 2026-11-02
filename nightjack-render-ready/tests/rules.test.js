'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDeck,shuffle,valueOf,isBlackjack,decide}=require('../rules');
const c=(rank,suit='♠')=>({rank,suit});
test('a standard 52-card deck has unique cards',()=>{
  const deck=createDeck();assert.equal(deck.length,52);
  assert.equal(new Set(deck.map(x=>x.rank+x.suit)).size,52);
});
test('shuffle does not mutate or change deck membership',()=>{
  const deck=createDeck(),copy=shuffle(deck,()=>0.42);
  assert.equal(deck.length,52);
  assert.notDeepEqual(copy,deck);
  assert.deepEqual(new Set(copy.map(x=>x.rank+x.suit)),new Set(deck.map(x=>x.rank+x.suit)));
});
test('aces adjust correctly and soft hands are identified',()=>{
  assert.deepEqual(valueOf([c('A'),c('6')]),{total:17,soft:true,busted:false});
  assert.equal(valueOf([c('A'),c('A'),c('9')]).total,21);
  assert.equal(valueOf([c('A'),c('A'),c('9'),c('7')]).total,18);
  assert.equal(valueOf([c('K'),c('Q'),c('2')]).busted,true);
});
test('naturals are only two-card hands',()=>{
  assert.equal(isBlackjack([c('A'),c('K')]),true);
  assert.equal(isBlackjack([c('A'),c('5'),c('5')]),false);
});
test('dealer and player natural blackjacks tie',()=>{
  assert.equal(decide([c('A'),c('K')],[c('A'),c('Q')]).kind,'push');
});
test('natural beats non-natural 21',()=>{
  assert.equal(decide([c('A'),c('K')],[c('8'),c('7'),c('6')]).kind,'blackjack');
});
test('bust, win, loss and tie outcomes',()=>{
  assert.equal(decide([c('K'),c('Q'),c('8')],[c('9'),c('8')]).kind,'loss');
  assert.equal(decide([c('K'),c('9')],[c('9'),c('8')]).kind,'win');
  assert.equal(decide([c('9'),c('6')],[c('K'),c('9')]).kind,'loss');
  assert.equal(decide([c('K'),c('8')],[c('9'),c('9')]).kind,'push');
});
