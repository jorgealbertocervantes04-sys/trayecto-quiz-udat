/** API Vercel para TRAYECTO Quiz / Google Sheets. No almacena datos en memoria. */
import {createHash,randomBytes,randomUUID} from "node:crypto";
const TYPES = new Set(["cortinado","caja_seca","refrigerada","autotanque","portacontenedor","plataforma","cama_baja","tolva","gondola"]);
const digest=s=>createHash("sha256").update(s).digest("hex");
const newToken=()=>randomBytes(32).toString("base64url");
const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode=()=>Array.from(randomBytes(6),n=>alphabet[n%alphabet.length]).join("");
const err=(error,status=400)=>({ok:false,error,status});
function questions(list){
 if(!Array.isArray(list)||list.length<1||list.length>30)throw Error("Selecciona entre 1 y 30 preguntas.");
 return list.map((q,i)=>{
  if(!q||typeof q!=="object")throw Error("Pregunta inválida: "+(i+1));
  const prompt=String(q.prompt||"").trim(),cargo=String(q.cargo||"").trim(),
   emoji=String(q.emoji||"📦").slice(0,20),explanation=String(q.explanation||"").trim();
  if(prompt.length<8||prompt.length>240||cargo.length<3||cargo.length>220||explanation.length<8||explanation.length>900)throw Error("Verifica el texto de la pregunta "+(i+1));
  if(!Array.isArray(q.options)||q.options.length!==4||new Set(q.options).size!==4||q.options.some(x=>!TYPES.has(x)))throw Error("Revisa las cuatro opciones de la pregunta "+(i+1));
  if(!Number.isInteger(q.answer)||q.answer<0||q.answer>3)throw Error("Respuesta correcta no válida.");
  return {prompt,cargo,emoji,explanation,options:q.options,answer:q.answer};
 });
}
async function google(op,payload={}){
 const url=process.env.GOOGLE_SCRIPT_URL,secret=process.env.GOOGLE_SCRIPT_SECRET;
 if(!url||!secret) return err("Configura GOOGLE_SCRIPT_URL y GOOGLE_SCRIPT_SECRET en Vercel.",503);
 let u;try{u=new URL(url);}catch{return err("GOOGLE_SCRIPT_URL no es una URL válida.",503);}
 if(u.protocol!=="https:"||u.hostname!=="script.google.com"||!u.pathname.endsWith("/exec")||secret.length<32)return err("Revisa la configuración privada de Apps Script.",503);
 try{
  const res=await fetch(u.toString(),{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({secret,op,payload}),redirect:"follow",cache:"no-store",signal:AbortSignal.timeout(20000)});
  if(!res.ok)return err("Apps Script respondió con HTTP "+res.status,503);
  const data=await res.json();return data&&typeof data.ok==="boolean"?data:err("Apps Script devolvió datos inesperados.",502);
 }catch(e){console.error("Apps Script:",e.message);return err("No se pudo comunicar con Google Sheets.",503);}
}
async function perform(op,p){
 if(op==="health"){
  if(!process.env.GOOGLE_SCRIPT_URL||!process.env.GOOGLE_SCRIPT_SECRET)return {ok:true,configured:false,database:"Google Sheets"};
  const x=await google("health");return x.ok?{ok:true,configured:!!x.configured,database:"Google Sheets"}:x;
 }
 if(op==="create"){
  const qs=questions(p.questions),duration=Number(p.duration);
  if(!Number.isInteger(duration)||duration<10||duration>90)return err("Duración inválida.");
  for(let i=0;i<5;i++){const code=newCode(),token=newToken();const result=await google("create",{code,hostHash:digest(token),duration,questions:qs});
   if(result.ok)return {ok:true,code,token};
   if(result.status!==409)return result;
  }
  return err("No se pudo generar un código de sala único.",503);
 }
 const code=String(p.code||"").toUpperCase().trim();
 if(!/^[A-Z2-9]{6}$/.test(code))return err("Código de sala inválido.");
 if(op==="state")return google("state",{code});
 if(op==="join"){
  const name=String(p.name||"").replace(/\s+/g," ").trim();
  if(!name||name.length>32||/^[=+@-]/.test(name))return err("Escribe un nombre válido, máximo 32 caracteres.");
  const token=newToken(),playerId=randomUUID();
  const x=await google("join",{code,name,playerId,tokenHash:digest(token)});
  return x.ok?{ok:true,code,token,id:playerId,name:x.name||name}:x;
 }
 const token=String(p.token||"");
 if(token.length<30||token.length>150)return err("Sesión inválida.",403);
 if(op==="action"){
  if(!["start","reveal","next"].includes(p.action))return err("Acción no permitida.");
  return google("action",{code,hostHash:digest(token),action:p.action});
 }
 if(op==="answer"){
  if(!Number.isInteger(p.choice)||p.choice<0||p.choice>3)return err("Respuesta inválida.");
  return google("answer",{code,tokenHash:digest(token),choice:p.choice,receivedAt:new Date().toISOString()});
 }
 if(op==="export")return google("export",{code,hostHash:digest(token)});
 return err("Operación desconocida.",404);
}
const reply=(o,cache="no-store")=>Response.json(o,{status:o.status||200,headers:{"Cache-Control":cache,"X-Content-Type-Options":"nosniff"}});
function csvCell(s){let v=String(s??"");if(/^[\s]*[=+@\-\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
function exportCsv(rows,code){
 const header=["Posición","Nombre","Puntos","Aciertos","Sala"];
 const data=[header,...rows.map((r,i)=>[i+1,r.name,r.score,r.correct,code])];
 return new Response("\uFEFF"+data.map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n",
  {headers:{"Content-Type":"text/csv; charset=utf-8","Cache-Control":"no-store","Content-Disposition":'attachment; filename="TRAYECTO_resultados_'+code+'.csv"'}});
}
export async function GET(request){
 try{const u=new URL(request.url),op=u.searchParams.get("op")||"";
  if(!["health","state"].includes(op))return reply(err("Operación GET no permitida.",405));
  const x=await perform(op,{code:u.searchParams.get("code")||""});
  return reply(x,op==="state"&&x.ok&&u.searchParams.get("fresh")!=="1"?"public, s-maxage=3, stale-while-revalidate=2":"no-store");
 }catch(e){console.error(e);return reply(err("Error al consultar la sala.",503));}
}
export async function POST(request){
 try{const u=new URL(request.url),op=u.searchParams.get("op")||"";
  const origin=request.headers.get("origin");if(origin&&origin!==u.origin)return reply(err("Origen no autorizado.",403));
  const raw=await request.text();if(raw.length>150000)return reply(err("Solicitud demasiado grande.",413));
  const body=JSON.parse(raw||"{}");
  const x=await perform(op,body);
  if(op==="export"&&x.ok)return exportCsv(x.rows||[],String(body.code||""));
  return reply(x);
 }catch(e){console.error(e);return reply(err(e instanceof SyntaxError?"JSON inválido.":"No se pudo procesar la solicitud.",500));}
}
