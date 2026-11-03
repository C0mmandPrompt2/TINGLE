'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const store=require('../account-store');
test('accounts start at 2000 chips and passwords are checked',async()=>{const a=await store.register('PixelFox','super-safe-pass');assert.equal(a.chips,2000);await assert.rejects(store.login('PixelFox','wrong-pass'),/Invalid username or password/);assert.equal((await store.login('pixelfox','super-safe-pass')).id,a.id);await assert.rejects(store.register('PIXELFOX','different-password'),/taken/);});
test('non-wagering round points add to a global leaderboard',async()=>{const b=await store.register('Rook','another-pass-123'),a=await store.getUser((await store.login('PixelFox','super-safe-pass')).id);await store.recordGames([a.id,b.id]);await store.reward([b.id],150);assert.equal((await store.getUser(b.id)).chips,2150);assert.equal((await store.getUser(a.id)).chips,2000);assert.equal((await store.leaderboard())[0].username,'Rook');});
