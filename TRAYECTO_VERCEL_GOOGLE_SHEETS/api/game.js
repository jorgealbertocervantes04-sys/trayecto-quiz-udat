/** TRAYECTO × UDAT — Vercel serverless API proxying Google Apps Script / Google Sheets. */
import {createHash, randomBytes, randomUUID} from 'node:crypto';

const MAX_QUESTIONS=30;
const TYPES=new Set(['cortinado','caja_seca','refrigerada','autotanque','portacontenedor','plataforma','cama_baja','tolva','gondola']);
function sha(token){return createHash('sha256').update(token).digest('hex');}
function token(){return randomBytes(32).toString('base64url');}
function roomCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from(randomBytes(6),n=>alphabet[n%alphabet.length]).join('');}
function error(message,status=400){return {ok:false,error:message,status};}
function normalizeQuestions(value){
 if(!Array.isArray(value)||value.length<1||value.length>MAX_QUESTIONS)throw Error('Selecciona de 1 a 30 preguntas.');
 return value.map((q,i)=>{
  if(typeof q!=='object'||q===null)throw Error(`Pregunta ${i+1} inválida.`);
  const prompt=String(q.prompt||'').trim(),cargo=String(q.cargo||'').trim(),emoji=String(q.emoji||'📦').slice(0,20);
  const explanation=String(q.explanation||'').trim(),options=q.options;
  if(prompt.length<10||prompt.length>240||cargo.length<3||cargo.length>220||explanation.length<8||explanation.length>900)
   throw Error(`Revisa el enunciado, carga y explicación de la pregunta ${i+1}.`);
  if(!Array.isArray(options)||options.length!==4||!options.every(x=>typeof x==='string'&&TYPES.has(x))||new Set(options).size!==4)
   throw Error(`La pregunta ${i+1} debe tener cuatro semirremolques distintos.`);
  if(!Number.isInteger(q.answer)||q.answer<0||q.answer>3)throw Error(`La pregunta ${i+1} no tiene una respuesta válida.`);
  return {prompt,cargo,emoji,options,answer:q.answer,explanation};
 });
}
function backendSettings(){
 const url=process.env.GOOGLE_SCRIPT_URL,secret=process.env.GOOGLE_SCRIPT_SECRET;
 if(!url||!secret)throw Error('Faltan GOOGLE_SCRIPT_URL y GOOGLE_SCRIPT_SECRET en Vercel. Consulta el README.');
 const u=new URL(url);
 if(u.protocol!=='https:'||u.hostname!=='script.google.com'||!u.pathname.endsWith('/exec'))
  throw Error('GOOGLE_SCRIPT_URL debe ser la URL HTTPS /exec publicada desde Apps Script.');
 if(secret.length<32)throw Error('GOOGLE_SCRIPT_SECRET debe tener al menos 32 caracteres.');
 return {url:u.toString(),secret};
}
async function remote(op,payload={}){
 const {url,secret}=backendSettings();
 let response;
 try{
  response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({secret,op,payload}),redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(19000)});
 }catch(e){console.error('Apps Script network:',e.message);return error('Google Sheets no respondió. Intenta de nuevo en unos segundos.',503);}
 if(!response.ok){console.error('Apps Script HTTP:',response.status);return error('El servicio de Google Sheets no está disponible. Revisa el despliegue de Apps Script.',503);}
 let data;try{data=await response.json();}catch{
  console.error('Apps Script did not return JSON');return error('Apps Script no devolvió JSON. Verifica el acceso «Cualquier persona» y la URL /exec.',503);
 }
 if(!data||typeof data.ok!=='boolean')return error('Respuesta inesperada de Google Sheets.',502);
 return data;
}
async function perform(op,body){
 if(op==='health'){
  if(!process.env.GOOGLE_SCRIPT_URL||!process.env.GOOGLE_SCRIPT_SECRET)return {ok:true,database:'Google Sheets',configured:false};
  const r=await remote('health');return r.ok?{ok:true,database:'Google Sheets',configured:Boolean(r.configured)}:r;
 }
 if(op==='create'){
  const questions=normalizeQuestions(body.questions),duration=Number(body.duration);
  if(!Number.isInteger(duration)||duration<10||duration>90)return error('El tiempo debe estar entre 10 y 90 segundos.');
  for(let i=0;i<6;i++){
   const code=roomCode(),secret=token();
   const result=await remote('create',{code,hostHash:sha(secret),questions,duration});
   if(result.ok)return {ok:true,code,token:secret};
   if(result.status===409)continue;
   return result;
  }
  return error('No se pudo generar una sala única. Intenta de nuevo.',503);
 }
 const code=String(body.code||'').trim().toUpperCase();
 if(!/^[A-Z2-9]{6}$/.test(code))return error('El código debe tener seis caracteres.');
 if(op==='state')return remote('state',{code}); // Public/cachable state: never contains secrets or unrevealed answers.
 if(op==='join'){
  const name=String(body.name||'').trim().replace(/\s+/g,' ');
  if(name.length<1||name.length>32||/^[=+@-]/.test(name))return error('Escribe un nombre válido de hasta 32 caracteres.');
  const secret=token(),playerId=randomUUID();
  const res=await remote('join',{code,name,tokenHash:sha(secret),playerId});
  return res.ok?{ok:true,code,token:secret,name:res.name,id:res.id}:res;
 }
 const credential=String(body.token||'');
 if(credential.length<30||credential.length>150)return error('Sesión inválida. Vuelve a ingresar.',403);
 if(op==='answer'){
  if(!Number.isInteger(body.choice)||body.choice<0||body.choice>3)return error('Respuesta inválida.');
  return remote('answer',{code,tokenHash:sha(credential),choice:body.choice,receivedAt:new Date().toISOString()});
 }
 if(op==='action'){
  if(!['start','reveal','next'].includes(body.action))return error('Acción inválida.');
  return remote('action',{code,hostHash:sha(credential),action:body.action});
 }
 if(op==='export'){
  const res=await remote('export',{code,hostHash:sha(credential)});
  return res.ok?{ok:true,export:true,code,rows:res.rows}:res;
 }
 return error('Operación desconocida.',404);
}
function reply(data,status=200,cache='no-store, max-age=0'){
 return Response.json(data,{status,headers:{'Cache-Control':cache,'X-Content-Type-Options':'nosniff'}});
}
function csvCell(s){let v=String(s??'');if(/^[\s]*[=+@\-\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
function csvResponse(rows,code){
 const lines=[['Posición','Nombre','Puntos','Aciertos','Sala'],...(rows||[]).map((p,i)=>[i+1,p.name,p.score,p.correct,code])];
 const csv='\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
 return new Response(csv,{status:200,headers:{'Content-Type':'text/csv; charset=utf-8','Cache-Control':'no-store','Content-Disposition':`attachment; filename="TRAYECTO_resultados_${code}.csv"`}});
}
const roomAttempts=new Map();
function flood(ip){const now=Date.now();let v=roomAttempts.get(ip)||{at:now,count:0};if(now-v.at>60000)v={at:now,count:0};v.count++;roomAttempts.set(ip,v);if(roomAttempts.size>1000)roomAttempts.clear();return v.count>15;}
export async function POST(request){
 try{
  const url=new URL(request.url),op=url.searchParams.get('op');
  const origin=request.headers.get('origin');
  if(origin&&new URL(origin).origin!==url.origin)return reply(error('Origen no autorizado.',403),403);
  const size=Number(request.headers.get('content-length')||0);
  if(size>150000)return reply(error('Solicitud demasiado grande.',413),413);
  const raw=await request.text();if(raw.length>150000)return reply(error('Solicitud demasiado grande.',413),413);
  const body=JSON.parse(raw||'{}');
  if(op==='create'&&flood(request.headers.get('x-forwarded-for')?.split(',')[0]||'unknown'))return reply(error('Demasiadas salas creadas.',429),429);
  if(op==='state')return reply(error('Usa GET para sincronizar el juego.',405),405);
  const r=await perform(op,body);
  if(r.export)return csvResponse(r.rows,r.code);
  return reply(r,r.status||200);
 }catch(e){console.error('Quiz POST:',e.message);return reply(error(e instanceof SyntaxError?'Formato JSON inválido.':'No se pudo procesar la solicitud.',500),500);}
}
export async function GET(request){
 try{
  const u=new URL(request.url),op=u.searchParams.get('op');
  if(op==='health'){
   const res=await perform('health',{});return reply(res,res.status||200);
  }
  if(op!=='state')return reply(error('Operación desconocida.',404),404);
  const code=String(u.searchParams.get('code')||'').toUpperCase();
  const res=await perform('state',{code});
  if(!res.ok)return reply(res,res.status||400);
  // No identifying secret, name/score only; Vercel CDN collapses shared polling.
  return reply(res,200,u.searchParams.get('fresh')==='1'?'no-store, max-age=0':'public, s-maxage=4, stale-while-revalidate=3');
 }catch(e){console.error('Quiz GET:',e.message);return reply(error('No se pudo sincronizar.',503),503);}
}
export {normalizeQuestions,roomCode,perform};
