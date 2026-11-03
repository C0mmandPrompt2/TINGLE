'use strict';
// NIGHT JACK account data. Reuses the existing Supabase-hosted nightjack_users table.
const crypto = require('node:crypto');
const users = new Map(), names = new Map(), emails = new Map(), claims = new Map(), settlements = new Set(), sessions = new Map();
let pool = null, ready = false;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 10000 });
}
const QUESTS = [
  {id:'first-win',title:'FIRST VICTORY',description:'Win your first hand.',target:1,field:'wins',reward:100},
  {id:'first-game',title:'GETTING STARTED',description:'Complete one hand.',target:1,field:'games',reward:50},
  {id:'collector',title:'CARD COLLECTOR',description:'Play 10 hands.',target:10,field:'games',reward:150},
  {id:'streak',title:'LUCKY STREAK',description:'Win three hands in a row.',target:3,field:'best_streak',reward:250},
  {id:'poker',title:'POKER APPRENTICE',description:'Win five Hold’em hands.',target:5,field:'poker_wins',reward:200},
  {id:'blackjack',title:'BLACKJACK BEGINNER',description:'Win five Twenty-One hands.',target:5,field:'blackjack_wins',reward:200},
  {id:'big-hand',title:'BIG HAND',description:'Win a hand with 500+ arcade points in play.',target:500,field:'best_pot',reward:150},
  {id:'night-owl',title:'NIGHT OWL',description:'Complete 20 hands.',target:20,field:'games',reward:300}
];
function hash(password,salt){return crypto.scryptSync(password,salt,64).toString('hex');}
function tokenHash(token){return crypto.createHash('sha256').update(token).digest('hex');}
function isValidName(n){return typeof n==='string' && /^[a-zA-Z0-9_-]{3,18}$/.test(n);}
function isValidPassword(p){return typeof p==='string'&&p.length>=8&&p.length<=128;}
function safe(u){if(!u)return null;return {id:u.id,username:u.username,email:u.email||null,chips:Number(u.chips),wins:Number(u.wins),games:Number(u.games),poker_wins:Number(u.poker_wins||0),blackjack_wins:Number(u.blackjack_wins||0),best_streak:Number(u.best_streak||0),best_pot:Number(u.best_pot||0),last_bonus_at:u.last_bonus_at||null};}
function clone(u){return {...u};}
async function init(){if(!pool)return;
 await pool.query(`CREATE TABLE IF NOT EXISTS nightjack_users (
   id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
   salt TEXT NOT NULL, password_hash TEXT NOT NULL,
   chips INTEGER NOT NULL DEFAULT 2000 CHECK(chips>=0), wins INTEGER NOT NULL DEFAULT 0,
   games INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await pool.query(`ALTER TABLE nightjack_users
   ADD COLUMN IF NOT EXISTS email TEXT, ADD COLUMN IF NOT EXISTS recovery_hash TEXT,
   ADD COLUMN IF NOT EXISTS poker_wins INTEGER NOT NULL DEFAULT 0,
   ADD COLUMN IF NOT EXISTS blackjack_wins INTEGER NOT NULL DEFAULT 0,
   ADD COLUMN IF NOT EXISTS win_streak INTEGER NOT NULL DEFAULT 0,
   ADD COLUMN IF NOT EXISTS best_streak INTEGER NOT NULL DEFAULT 0,
   ADD COLUMN IF NOT EXISTS best_pot INTEGER NOT NULL DEFAULT 0,
   ADD COLUMN IF NOT EXISTS last_bonus_at TIMESTAMPTZ`);
 await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS nightjack_users_email_unique ON nightjack_users (LOWER(email)) WHERE email IS NOT NULL');
 await pool.query(`CREATE TABLE IF NOT EXISTS nightjack_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES nightjack_users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS nightjack_claims (user_id TEXT NOT NULL REFERENCES nightjack_users(id) ON DELETE CASCADE,quest_id TEXT NOT NULL,claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,quest_id))`);
 await pool.query(`CREATE TABLE IF NOT EXISTS nightjack_settled (round_id TEXT PRIMARY KEY,settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 // Future cosmetics are deliberately empty. Store ownership, but render equipped skins locally only.
 await pool.query(`CREATE TABLE IF NOT EXISTS nightjack_cosmetics (
   id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',
   rarity TEXT NOT NULL DEFAULT 'COMMON',chip_price INTEGER NOT NULL DEFAULT 0 CHECK(chip_price>=0),
   image_path TEXT,enabled BOOLEAN NOT NULL DEFAULT FALSE)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS nightjack_player_cosmetics (
   user_id TEXT NOT NULL REFERENCES nightjack_users(id) ON DELETE CASCADE,
   cosmetic_id TEXT NOT NULL REFERENCES nightjack_cosmetics(id) ON DELETE CASCADE,
   equipped BOOLEAN NOT NULL DEFAULT FALSE,obtained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   PRIMARY KEY(user_id,cosmetic_id))`);
 ready=true;
}
async function register(rawName,password,rawEmail=''){
 const username=String(rawName||'').trim(), email=String(rawEmail||'').trim().toLowerCase()||null;
 if(!isValidName(username))throw Error('Username: 3–18 letters, numbers, _ or -.');
 if(!isValidPassword(password))throw Error('Password must have 8–128 characters.');
 if(email&&(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.length>180))throw Error('Enter a valid email address.');
 const username_key=username.toLowerCase(),id=crypto.randomUUID(),salt=crypto.randomBytes(16).toString('hex');
 const recoveryCode=crypto.randomBytes(15).toString('hex').toUpperCase(),recovery_hash=tokenHash(recoveryCode),password_hash=hash(password,salt);
 if(pool){try{const r=await pool.query(`INSERT INTO nightjack_users(id,username,username_key,salt,password_hash,email,recovery_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,username,username_key,salt,password_hash,email,recovery_hash]);return {...safe(r.rows[0]),recoveryCode};}
 catch(e){if(e.code==='23505')throw Error('That username or email is already used.');throw e;}}
 if(names.has(username_key)||(email&&emails.has(email)))throw Error('That username or email is already used.');
 const u={id,username,username_key,email,salt,password_hash,recovery_hash,chips:2000,wins:0,games:0,poker_wins:0,blackjack_wins:0,win_streak:0,best_streak:0,best_pot:0,last_bonus_at:null};
 users.set(id,u);names.set(username_key,id);if(email)emails.set(email,id);return {...safe(u),recoveryCode};
}
async function getRecordByLogin(name){const key=String(name||'').trim().toLowerCase();if(!key)return null;if(pool){return (await pool.query('SELECT * FROM nightjack_users WHERE username_key=$1 OR LOWER(email)=$1 LIMIT 1',[key])).rows[0]||null;}return users.get(names.get(key)||emails.get(key))||null;}
async function login(name,password){if(typeof password!=='string')throw Error('Invalid login.');const u=await getRecordByLogin(name);if(!u)throw Error('Incorrect username or password.');const hashed=Buffer.from(hash(password,u.salt),'hex'),actual=Buffer.from(u.password_hash,'hex');if(hashed.length!==actual.length||!crypto.timingSafeEqual(hashed,actual))throw Error('Incorrect username or password.');return safe(u);}
async function resetPassword(name,recoveryCode,newPassword){if(!isValidPassword(newPassword))throw Error('Password must have 8–128 characters.');if(typeof recoveryCode!=='string')throw Error('Invalid recovery code.');const u=await getRecordByLogin(name);const got=tokenHash(recoveryCode.trim().toUpperCase());if(!u?.recovery_hash||!crypto.timingSafeEqual(Buffer.from(got,'hex'),Buffer.from(u.recovery_hash,'hex')))throw Error('Incorrect account or recovery code.');const salt=crypto.randomBytes(16).toString('hex'),pw=hash(newPassword,salt);if(pool)await pool.query('UPDATE nightjack_users SET salt=$1,password_hash=$2 WHERE id=$3',[salt,pw,u.id]);else Object.assign(u,{salt,password_hash:pw});return true;}
async function getUser(id){if(!id)return null;const u=pool?(await pool.query('SELECT * FROM nightjack_users WHERE id=$1',[id])).rows[0]:users.get(id);return safe(u);}
async function createSession(id){const token=crypto.randomBytes(32).toString('base64url'),key=tokenHash(token),exp=Date.now()+30*86400000;if(pool)await pool.query('INSERT INTO nightjack_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[key,id,new Date(exp)]);else sessions.set(key,{id,exp});return token;}
async function getSessionUser(token){if(typeof token!=='string'||token.length>120)return null;const key=tokenHash(token);if(pool){const r=await pool.query('SELECT user_id FROM nightjack_sessions WHERE token_hash=$1 AND expires_at>NOW()',[key]);return getUser(r.rows[0]?.user_id);}const s=sessions.get(key);return s&&s.exp>Date.now()?getUser(s.id):null;}
async function revokeSession(token){if(typeof token!=='string')return;const key=tokenHash(token);if(pool)await pool.query('DELETE FROM nightjack_sessions WHERE token_hash=$1',[key]);else sessions.delete(key);}
function checkEntries(entries){if(!Array.isArray(entries)||!entries.length||entries.length>6)throw Error('Invalid round settlement.');const seen=new Set();for(const e of entries){if(!e.id||seen.has(e.id)||!Number.isSafeInteger(e.delta)||Math.abs(e.delta)>10000000)throw Error('Invalid round result.');seen.add(e.id);}}
async function settleRound(roundId,mode,entries,pot=0){checkEntries(entries);if(typeof roundId!=='string'||roundId.length>120)throw Error('Bad round id.');if(!['21','holdem'].includes(mode))throw Error('Bad mode.');if(pool){const c=await pool.connect();try{await c.query('BEGIN');const newRow=await c.query('INSERT INTO nightjack_settled(round_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING round_id',[roundId]);if(!newRow.rowCount){await c.query('ROLLBACK');return false;}
   for(const e of entries){const won=!!e.won;const r=await c.query(`UPDATE nightjack_users SET chips=chips+$2,games=games+1,wins=wins+$3,
      poker_wins=poker_wins+$4,blackjack_wins=blackjack_wins+$5,
      win_streak=CASE WHEN $3=1 THEN win_streak+1 ELSE 0 END,
      best_streak=GREATEST(best_streak,CASE WHEN $3=1 THEN win_streak+1 ELSE 0 END),
      best_pot=GREATEST(best_pot,CASE WHEN $3=1 THEN $6 ELSE 0 END)
      WHERE id=$1 AND chips+$2>=0 RETURNING id`,[e.id,e.delta,Number(won),Number(won&&mode==='holdem'),Number(won&&mode==='21'),Math.max(0,pot)]);
     if(r.rowCount!==1)throw Error('Account balance changed; could not settle this hand.');}
   await c.query('COMMIT');return true;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 if(settlements.has(roundId))return false;for(const e of entries){const u=users.get(e.id);if(!u||u.chips+e.delta<0)throw Error('Cannot settle this hand safely.');}
 for(const e of entries){const u=users.get(e.id);u.chips+=e.delta;u.games++;u.win_streak=e.won?u.win_streak+1:0;u.best_streak=Math.max(u.best_streak,u.win_streak);if(e.won){u.wins++;if(mode==='21')u.blackjack_wins++;else u.poker_wins++;u.best_pot=Math.max(u.best_pot,pot);}}
 settlements.add(roundId);return true;
}
async function questsFor(id){const u=await getUser(id);if(!u)throw Error('Sign in again.');let owned=[];if(pool)owned=(await pool.query('SELECT quest_id FROM nightjack_claims WHERE user_id=$1',[id])).rows.map(r=>r.quest_id);else owned=[...(claims.get(id)||new Set())];const set=new Set(owned);return QUESTS.map(q=>({id:q.id,title:q.title,description:q.description,reward:q.reward,target:q.target,progress:Math.min(q.target,Number(u[q.field]||0)),ready:Number(u[q.field]||0)>=q.target&&!set.has(q.id),claimed:set.has(q.id)}));}
async function claimQuest(id,questId){const q=QUESTS.find(x=>x.id===questId);if(!q)throw Error('Unknown quest.');if(pool){const c=await pool.connect();try{await c.query('BEGIN');const row=(await c.query('SELECT * FROM nightjack_users WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row||Number(row[q.field]||0)<q.target)throw Error('Quest not completed yet.');const insert=await c.query('INSERT INTO nightjack_claims(user_id,quest_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING quest_id',[id,q.id]);if(!insert.rowCount)throw Error('Reward already claimed.');await c.query('UPDATE nightjack_users SET chips=chips+$2 WHERE id=$1',[id,q.reward]);await c.query('COMMIT');return {reward:q.reward,user:await getUser(id)};}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 const u=users.get(id),set=claims.get(id)||new Set();if(!u||Number(u[q.field]||0)<q.target)throw Error('Quest not completed yet.');if(set.has(q.id))throw Error('Reward already claimed.');set.add(q.id);claims.set(id,set);u.chips+=q.reward;return {reward:q.reward,user:safe(u)};
}
async function dailyBonus(id){if(pool){const r=await pool.query(`UPDATE nightjack_users SET chips=chips+500,last_bonus_at=NOW()
 WHERE id=$1 AND (last_bonus_at IS NULL OR last_bonus_at < NOW()-INTERVAL '24 hours') RETURNING *`,[id]);if(!r.rowCount)throw Error('Daily bonus is not ready yet.');return safe(r.rows[0]);}
 const u=users.get(id);if(!u)throw Error('Account not found.');if(u.last_bonus_at&&Date.now()-new Date(u.last_bonus_at).getTime()<86400000)throw Error('Daily bonus is not ready yet.');u.chips+=500;u.last_bonus_at=new Date().toISOString();return safe(u);
}
async function leaderboard(){const list=pool?(await pool.query('SELECT * FROM nightjack_users ORDER BY chips DESC,wins DESC,username ASC LIMIT 50')).rows:[...users.values()].sort((a,b)=>b.chips-a.chips||b.wins-a.wins||a.username.localeCompare(b.username)).slice(0,50);return list.map(safe);}
module.exports={init,register,login,getUser,resetPassword,createSession,getSessionUser,revokeSession,settleRound,questsFor,claimQuest,dailyBonus,leaderboard,isPersistent:()=>ready,QUESTS};
