'use strict';
const crypto=require('node:crypto');
const users=new Map();const byName=new Map();
let pool=null;let databaseReady=false;
if(process.env.DATABASE_URL){const {Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:10000});}
async function init(){if(!pool)return;await pool.query(`CREATE TABLE IF NOT EXISTS nightjack_users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
 salt TEXT NOT NULL, password_hash TEXT NOT NULL,
 chips INTEGER NOT NULL DEFAULT 2000, wins INTEGER NOT NULL DEFAULT 0,
 games INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);databaseReady=true;}
function safeUser(u){return {id:u.id,username:u.username,chips:Number(u.chips),wins:Number(u.wins),games:Number(u.games)};}
function passwordHash(password,salt){return crypto.scryptSync(password,salt,64).toString('hex');}
function cleanUsername(n){return typeof n==='string'?n.trim().replace(/[\x00-\x1f<>]/g,'').slice(0,18):'';}
function validUsername(n){return /^[A-Za-z0-9_\-]{3,18}$/.test(n);}
function validatePassword(p){return typeof p==='string'&&p.length>=8&&p.length<=128;}
async function register(rawName,password){const username=cleanUsername(rawName);if(!validUsername(username))throw Error('Use 3–18 letters, numbers, _ or - for your username.');if(!validatePassword(password))throw Error('Use a password of 8–128 characters.');const username_key=username.toLowerCase(),salt=crypto.randomBytes(16).toString('hex'),id=crypto.randomUUID(),hash=passwordHash(password,salt);
 if(pool){try{const {rows}=await pool.query('INSERT INTO nightjack_users (id,username,username_key,salt,password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *',[id,username,username_key,salt,hash]);return safeUser(rows[0]);}catch(err){if(err.code==='23505')throw Error('That username is taken.');throw err;}}
 if(byName.has(username_key))throw Error('That username is taken.');const u={id,username,username_key,salt,password_hash:hash,chips:2000,wins:0,games:0};users.set(id,u);byName.set(username_key,id);return safeUser(u);
}
async function login(name,password){if(typeof name!=='string'||typeof password!=='string')throw Error('Invalid login.');const key=name.trim().toLowerCase();const u=pool?(await pool.query('SELECT * FROM nightjack_users WHERE username_key=$1',[key])).rows[0]:users.get(byName.get(key));if(!u)throw Error('Invalid username or password.');const hash=passwordHash(password,u.salt);if(!crypto.timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(u.password_hash,'hex')))throw Error('Invalid username or password.');return safeUser(u);}
async function getUser(id){const u=pool?(await pool.query('SELECT * FROM nightjack_users WHERE id=$1',[id])).rows[0]:users.get(id);return u?safeUser(u):null;}
async function reward(ids,points){if(!ids.length)return;if(pool){await pool.query('UPDATE nightjack_users SET chips=chips+$1,wins=wins+1 WHERE id=ANY($2::text[])',[points,ids]);return;}
 for(const id of ids){const u=users.get(id);if(u){u.chips+=points;u.wins++;}}
}
async function recordGames(ids){if(!ids.length)return;if(pool){await pool.query('UPDATE nightjack_users SET games=games+1 WHERE id=ANY($1::text[])',[ids]);return;}for(const id of ids){const u=users.get(id);if(u)u.games++;}}
async function leaderboard(){let rows;if(pool){rows=(await pool.query('SELECT id,username,chips,wins,games FROM nightjack_users ORDER BY chips DESC, wins DESC, username ASC LIMIT 50')).rows;}else{rows=[...users.values()].sort((a,b)=>b.chips-a.chips||b.wins-a.wins||a.username.localeCompare(b.username)).slice(0,50);}return rows.map(safeUser);}
module.exports={init,register,login,getUser,reward,recordGames,leaderboard,isPersistent:()=>databaseReady};
