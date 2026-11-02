'use strict';
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
function createDeck() {
  return SUITS.flatMap(suit => RANKS.map(rank => ({ suit, rank })));
}
function shuffle(deck, random = Math.random) {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function valueOf(hand) {
  let sum = 0, aces = 0;
  for (const {rank} of hand) {
    if (rank === 'A') { sum += 11; aces++; }
    else if (['J','Q','K'].includes(rank)) sum += 10;
    else sum += Number(rank);
  }
  while (sum > 21 && aces) {sum -= 10; aces--;}
  return { total: sum, soft: aces > 0, busted: sum > 21 };
}
function isBlackjack(hand) {return hand.length === 2 && valueOf(hand).total === 21;}
function decide(hand, dealer) {
  const p = valueOf(hand), d = valueOf(dealer);
  if (p.busted) return {label:'Bust', kind:'loss', points:0};
  if (isBlackjack(hand) && !isBlackjack(dealer)) return {label:'Blackjack!',kind:'blackjack',points:3};
  if (isBlackjack(dealer) && !isBlackjack(hand)) return {label:'Dealer blackjack',kind:'loss',points:0};
  if (isBlackjack(dealer) && isBlackjack(hand)) return {label:'Push',kind:'push',points:1};
  if (d.busted || p.total > d.total) return {label:'You win!',kind:'win',points:2};
  if (p.total === d.total) return {label:'Push',kind:'push',points:1};
  return {label:'Dealer wins',kind:'loss',points:0};
}
module.exports = {createDeck, shuffle, valueOf, isBlackjack, decide};
