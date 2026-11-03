import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {POST,GET,normalizeQuestions,roomCode} from '../api/game.js';

const Q={prompt:'¿Qué semirremolque usarías para esta carga?',cargo:'Tarimas con mercancía general',emoji:'📦',options:['cortinado','autotanque','plataforma','tolva'],answer:0,explanation:'El cortinado permite cargar y proteger la mercancía paletizada.'};
function req(op,body,options={}){return new Request('https://curso.vercel.app/api/game?op='+op,{method:'POST',headers:{'Content-Type':'application/json',...options},body:JSON.stringify(body)});}
function get(op,code,extra=''){return new Request(`https://curso.vercel.app/api/game?op=${op}&code=${code}${extra}`);}
function mockAppsScript(){
 class Range{
  constructor(sh,r,c,n=1,w=1){Object.assign(this,{sh,r,c,n,w});}
  getValues(){return Array.from({length:this.n},(_,i)=>Array.from({length:this.w},(_,j)=>this.sh.rows[this.r+i-1]?.[this.c+j-1]??''));}
  setValues(rows){for(let i=0;i<rows.length;i++){const idx=this.r+i-1;this.sh.rows[idx]??=[];for(let j=0;j<rows[i].length;j++)this.sh.rows[idx][this.c+j-1]=rows[i][j];}return this;}
  setValue(v){this.setValues([[v]]);return this;}
  setFontWeight(){return this;} setBackground(){return this;}setFontColor(){return this;}
 }
 class Sheet{
  constructor(name){this.name=name;this.rows=[];}
  getLastRow(){return this.rows.length;}
  getLastColumn(){return Math.max(1,...this.rows.map(r=>r.length));}
  getRange(r,c,n=1,w=1){return new Range(this,r,c,n,w);}
  appendRow(v){this.rows.push([...v]);}
  setFrozenRows(){}autoResizeColumns(){}
 }
 const tabs=new Map(),props=new Map(),cache=new Map();
 const book={getId:()=> 'sheet_test_id',getSheetByName:name=>tabs.get(name),insertSheet:name=>{let s=new Sheet(name);tabs.set(name,s);return s;}};
 const properties={getProperty:key=>props.get(key)||null,setProperty:(key,value)=>{props.set(key,value);}};
 const context=vm.createContext({
  SpreadsheetApp:{getActiveSpreadsheet:()=>book,openById:id=>id==='sheet_test_id'?book:null},
  PropertiesService:{getScriptProperties:()=>properties},
  CacheService:{getScriptCache:()=>({get:key=>cache.get(key)||null,put:(key,val)=>cache.set(key,val),remove:key=>cache.delete(key)})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  Utilities:{getUuid:()=>crypto.randomUUID()},
  ContentService:{MimeType:{JSON:'application/json'},createTextOutput:s=>({raw:s,setMimeType(){return this;}})},
  Date,JSON,console:{log(){},error(){}},Logger:{log(){}},crypto:globalThis.crypto
 });
 vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
 context.configurar();
 const backend=async (_url,opts={})=>{
  const body=JSON.parse(opts.body);
  const ret=context.doPost({postData:{contents:JSON.stringify(body)}});
  return new Response(ret.raw,{headers:{'Content-Type':'application/json'}});
 };
 return {backend,tabs,properties,context};
}

test('preguntas, códigos aleatorios y protección de origen',async()=>{
 assert.equal(normalizeQuestions([Q]).length,1);
 assert.throws(()=>normalizeQuestions([{...Q,options:['cortinado','cortinado','plataforma','tolva']}]),/cuatro/);
 assert.throws(()=>normalizeQuestions(Array.from({length:31},()=>Q)),/1 a 30/);
 const values=new Set(Array.from({length:100},roomCode));assert.ok(values.size>97);
 const response=await POST(req('create',{questions:[Q],duration:25},{origin:'https://evil.example'}));assert.equal(response.status,403);
});

test('Google Sheets: flujo simulado de 30 participantes, tiempo, doble respuesta y CSV',async()=>{
 const {backend,tabs,properties}=mockAppsScript();
 process.env.GOOGLE_SCRIPT_URL='https://script.google.com/macros/s/test/exec';
 process.env.GOOGLE_SCRIPT_SECRET=properties.getProperty('APP_SECRET');
 const real=globalThis.fetch;globalThis.fetch=backend;
 try{
  let response=await POST(req('create',{questions:[Q,Q],duration:25}));assert.equal(response.status,200);
  const host=await response.json();assert.equal(host.ok,true);
  assert.equal((await GET(get('health',''))).status,200);
  const all=await Promise.all(Array.from({length:30},(_,i)=>POST(req('join',{code:host.code,name:'Participante '+(i+1)}))));
  const participants=await Promise.all(all.map(x=>x.json()));
  assert.ok(participants.every(p=>p.ok),JSON.stringify(participants.filter(x=>!x.ok)));
  assert.equal(new Set(participants.map(p=>p.id)).size,30);
  let state=await (await GET(get('state',host.code))).json();
  assert.equal(state.phase,'lobby');assert.equal(state.players.length,30);
  assert.equal(state.question,null);
  assert.equal(state.players.every(p=>!('hash' in p)),true);
  const start=await (await POST(req('action',{code:host.code,token:host.token,action:'start'}))).json();assert.ok(start.ok);
  state=await (await GET(get('state',host.code))).json();assert.equal(state.phase,'question');
  assert.equal('correct' in state,false);assert.equal('answer' in state.question,false);
  const correct=participants[0];
  const allAnswers=await Promise.all(participants.map((p,i)=>POST(req('answer',{code:host.code,token:p.token,choice:i%4}))));
  const results=await Promise.all(allAnswers.map(r=>r.json()));
  assert.ok(results.every(r=>r.ok),JSON.stringify(results.filter(x=>!x.ok)));
  assert.equal(tabs.get('Respuestas').rows.length,31);
  const duplicate=await (await POST(req('answer',{code:host.code,token:correct.token,choice:3}))).json();
  assert.equal(duplicate.duplicate,true);assert.equal(duplicate.choice,0);
  assert.equal(tabs.get('Respuestas').rows.length,31);
  state=await (await GET(get('state',host.code))).json();
  assert.equal(state.answered,30);assert.ok(state.players.every(p=>p.answered));
  assert.equal(state.leaderboard.every(p=>p.score===0),true); // hide points before reveal
  assert.equal((await POST(req('action',{code:host.code,token:participants[0].token,action:'reveal'}))).status,403);
  const reveal=await (await POST(req('action',{code:host.code,token:host.token,action:'reveal'}))).json();assert.ok(reveal.ok);
  state=await (await GET(get('state',host.code))).json();
  assert.equal(state.phase,'reveal');assert.equal(state.correct,0);
  assert.deepEqual([...state.distribution],[8,8,7,7]);
  assert.ok(state.leaderboard[0].score>=500);
  const csv=await POST(req('export',{code:host.code,token:host.token}));
  assert.equal(csv.status,200);
  const csvLines=(await csv.text()).split('\r\n').filter(Boolean);assert.equal(csvLines.length,31);
  const next=await (await POST(req('action',{code:host.code,token:host.token,action:'next'}))).json();assert.equal(next.index,1);
  state=await (await GET(get('state',host.code))).json();assert.equal(state.index,1);
  assert.equal(state.phase,'question');assert.equal(state.players.every(p=>p.answered===false),true);
  assert.ok(state.leaderboard[0].score>0); // previous round persists
  const row=tabs.get('Salas').rows.find(x=>x[0]===host.code);
  row[5]=new Date(Date.now()-1000).toISOString(); // deadline elapsed
  // cache for state needs explicit invalidation; action/answer must respect physical deadline
  const late=await (await POST(req('answer',{code:host.code,token:participants[0].token,choice:1}))).json();
  assert.equal(late.ok,false);
  const end=await (await POST(req('action',{code:host.code,token:host.token,action:'next'}))).json();
  assert.equal(end.phase,'finished');
  assert.equal(tabs.get('Participantes').rows.length,31);
 }finally{globalThis.fetch=real;delete process.env.GOOGLE_SCRIPT_URL;delete process.env.GOOGLE_SCRIPT_SECRET;}
});
