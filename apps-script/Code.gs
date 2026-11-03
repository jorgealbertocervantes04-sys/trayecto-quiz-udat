/** TRAYECTO Quiz × UDAT Formación — Google Sheets / Apps Script.
 * En la hoja: Extensiones > Apps Script, pegar este archivo y ejecutar configurar().
 * Publicar implementación WEB: Ejecutar como Yo; acceso Cualquier persona.
 * Guardar secreto SOLO como variable de entorno de Vercel.
 */
const HEADERS={
 Salas:["codigo","hash_instructor","segundos","fase","indice","limite_utc","preguntas_json","creada_utc","actualizada_utc"],
 Participantes:["id","codigo","nombre","hash_sesion","ingreso_utc"],
 Respuestas:["id_respuesta","codigo","id_participante","indice_pregunta","opcion","momento_utc","puntos","acierto"]
};
const CAPACITY=150;
function configurar(){
 const book=SpreadsheetApp.getActiveSpreadsheet();
 if(!book)throw Error("Ejecuta configurar desde la hoja de Google Sheets.");
 const props=PropertiesService.getScriptProperties();
 props.setProperty("SHEET_ID",book.getId());
 if(!props.getProperty("APP_SECRET"))props.setProperty("APP_SECRET",Utilities.getUuid()+Utilities.getUuid());
 for(const [name,headers] of Object.entries(HEADERS)){
  let sheet=book.getSheetByName(name);
  if(!sheet)sheet=book.insertSheet(name);
  const old=sheet.getRange(1,1,1,headers.length).getValues()[0];
  if(old.some((v,i)=>v&&v!==headers[i]))throw Error("Encabezados diferentes en "+name);
  sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight("bold").setBackground("#093b88").setFontColor("white");
  sheet.setFrozenRows(1);
 }
 Logger.log("GOOGLE_SCRIPT_SECRET = "+props.getProperty("APP_SECRET"));
 Logger.log("Copia el secreto SOLO en Vercel, nunca en GitHub.");
}
function book(){
 const id=PropertiesService.getScriptProperties().getProperty("SHEET_ID");
 if(!id)throw Error("Primero ejecuta configurar().");
 return SpreadsheetApp.openById(id);
}
const fail=(error,status=400)=>({ok:false,error,status});
const readRows=sh=>sh.getLastRow()<2?[]:sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();
function room(db,code){
 const a=readRows(db.getSheetByName("Salas")),i=a.findIndex(x=>String(x[0])===code);
 if(i<0)return null;
 const r=a[i];return {row:i+2,code,hash:String(r[1]),duration:Number(r[2]),phase:String(r[3]),index:Number(r[4]),deadline:String(r[5]||""),questions:JSON.parse(String(r[6]||"[]"))};
}
const players=(db,code)=>readRows(db.getSheetByName("Participantes")).filter(r=>String(r[1])===code).map(r=>({id:String(r[0]),name:String(r[2]),hash:String(r[3])}));
const answers=(db,code)=>readRows(db.getSheetByName("Respuestas")).filter(r=>String(r[1])===code).map(r=>({id:String(r[0]),pid:String(r[2]),index:Number(r[3]),choice:Number(r[4]),time:String(r[5]),score:Number(r[6]),correct:Number(r[7])===1}));
const effective=r=>r.phase==="question"&&Date.now()>=Date.parse(r.deadline)?"reveal":r.phase;
const cacheKey=code=>"tq_"+code;
function bust(code){try{CacheService.getScriptCache().remove(cacheKey(code))}catch(e){}}
function snapshot(db,r){
 const phase=effective(r),ps=players(db,r.code),as=answers(db,r.code),q=r.index>=0?r.questions[r.index]:null;
 const included=phase==="question"?r.index-1:r.index,nowAnswers=as.filter(a=>a.index===r.index);
 const ranks=ps.map(p=>{
  const rounds=as.filter(a=>a.pid===p.id&&a.index<=included);
  return {id:p.id,name:p.name,score:rounds.reduce((sum,a)=>sum+a.score,0),correct:rounds.filter(a=>a.correct).length};
 }).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
 const list=ps.map(p=>{
  const a=nowAnswers.find(x=>x.pid===p.id),rank=ranks.find(x=>x.id===p.id);
  return {id:p.id,name:p.name,score:rank?rank.score:0,answered:!!a,
   ...((phase==="reveal"||phase==="finished")?{lastCorrect:a?a.correct:false,lastEarned:a?a.score:0,lastChoice:a?a.choice:null}:{})};
 });
 const data={ok:true,code:r.code,phase,index:r.index,total:r.questions.length,duration:r.duration,
  deadline:r.deadline||null,participants:ps.length,answered:nowAnswers.length,players:list,leaderboard:ranks,
  question:q?{prompt:q.prompt,cargo:q.cargo,emoji:q.emoji,options:q.options}:null,server_now:new Date().toISOString()};
 if(phase==="reveal"||phase==="finished"){
  data.correct=q?q.answer:null;data.explanation=q?q.explanation:"";
  data.distribution=[0,0,0,0];nowAnswers.forEach(a=>{if(a.choice>=0&&a.choice<=3)data.distribution[a.choice]++});
 }
 return data;
}
function withLock(fn){
 const l=LockService.getScriptLock();
 if(!l.tryLock(20000))return fail("Muchos participantes respondiendo. Intenta de nuevo.",503);
 try{return fn()}finally{l.releaseLock()}
}
const validHash=s=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s);
function dispatch(op,p){
 if(op==="health")return {ok:true,configured:!!PropertiesService.getScriptProperties().getProperty("SHEET_ID")};
 const db=book();
 if(op==="create")return withLock(()=>{
  const code=String(p.code||""),duration=Number(p.duration),qs=p.questions;
  if(!/^[A-Z2-9]{6}$/.test(code)||!validHash(p.hostHash)||!Number.isInteger(duration)||duration<10||duration>90||!Array.isArray(qs)||qs.length<1||qs.length>30)return fail("Configuración de sala inválida.");
  if(room(db,code))return fail("Código duplicado.",409);
  const now=new Date().toISOString();db.getSheetByName("Salas").appendRow([code,p.hostHash,duration,"lobby",-1,"",JSON.stringify(qs),now,now]);bust(code);
  return {ok:true,code};
 });
 const code=String(p.code||"").toUpperCase();
 if(!/^[A-Z2-9]{6}$/.test(code))return fail("Código de sala inválido.");
 if(op==="state"){
  const cache=CacheService.getScriptCache(),cached=cache.get(cacheKey(code));
  if(cached){try{return JSON.parse(cached)}catch(e){}}
  const r=room(db,code);if(!r)return fail("No existe la sala.",404);
  const data=snapshot(db,r);try{cache.put(cacheKey(code),JSON.stringify(data),3)}catch(e){}
  return data;
 }
 return withLock(()=>{
  const r=room(db,code);if(!r)return fail("No existe la sala.",404);
  if(op==="join"){
   if(effective(r)!=="lobby")return fail("El concurso ya inició.",409);
   const name=String(p.name||"").replace(/\s+/g," ").trim(),id=String(p.playerId||"");
   if(!name||name.length>32||!validHash(p.tokenHash)||!/^[a-f0-9-]{36}$/.test(id)||/^[=+@-]/.test(name))return fail("Datos de ingreso inválidos.");
   const ps=players(db,code);
   if(ps.length>=CAPACITY)return fail("Sala llena (150 participantes).",409);
   if(ps.some(x=>x.name.toLowerCase()===name.toLowerCase()))return fail("Nombre repetido. Agrega un apellido o número.",409);
   db.getSheetByName("Participantes").appendRow([id,code,name,p.tokenHash,new Date().toISOString()]);
   bust(code);return {ok:true,id,name,code};
  }
  if(op==="answer"){
   const me=players(db,code).find(x=>x.hash===p.tokenHash);
   if(!me)return fail("Sesión inválida.",403);
   const choice=Number(p.choice),received=Date.parse(String(p.receivedAt||"")),end=Date.parse(r.deadline);
   if(!Number.isInteger(choice)||choice<0||choice>3)return fail("Opción no válida.");
   if(r.phase!=="question"||r.index<0||!Number.isFinite(received)||received>end||received<end-r.duration*1000-5000||received>Date.now()+5000)return fail("Terminó el tiempo.",409);
   const old=answers(db,code).find(a=>a.pid===me.id&&a.index===r.index);
   if(old)return {ok:true,choice:old.choice,duplicate:true};
   const q=r.questions[r.index],remaining=Math.max(0,end-received);
   const earned=q.answer===choice?Math.round(500+500*Math.min(1,remaining/(r.duration*1000))):0;
   db.getSheetByName("Respuestas").appendRow([Utilities.getUuid(),code,me.id,r.index,choice,p.receivedAt,earned,choice===q.answer?1:0]);
   bust(code);return {ok:true,choice};
  }
  if(op==="action"){
   if(r.hash!==p.hostHash)return fail("Instructor no autorizado.",403);
   const phase=effective(r),action=p.action;let nextPhase=r.phase,i=r.index,deadline=r.deadline;
   if(action==="start"){
    if(phase!=="lobby")return fail("El juego ya comenzó.",409);
    if(players(db,code).length===0)return fail("Espera al menos un participante.",409);
    i=0;nextPhase="question";deadline=new Date(Date.now()+r.duration*1000).toISOString();
   }else if(action==="reveal"){
    if(phase!=="question"&&phase!=="reveal")return fail("No hay pregunta activa.",409);
    nextPhase="reveal";
   }else if(action==="next"){
    if(phase!=="reveal")return fail("Primero revela o espera el tiempo.",409);
    i+=1;
    if(i>=r.questions.length){i=r.questions.length-1;nextPhase="finished";}
    else{nextPhase="question";deadline=new Date(Date.now()+r.duration*1000).toISOString();}
   }else return fail("Acción desconocida.");
   const sh=db.getSheetByName("Salas");
   sh.getRange(r.row,4,1,3).setValues([[nextPhase,i,deadline]]);
   sh.getRange(r.row,9).setValue(new Date().toISOString());
   bust(code);return {ok:true,phase:nextPhase,index:i};
  }
  if(op==="export"){
   if(r.hash!==p.hostHash)return fail("Instructor no autorizado.",403);
   return {ok:true,rows:snapshot(db,r).leaderboard};
  }
  return fail("Operación no permitida.",404);
 });
}
function doPost(e){
 let out;
 try{
  const txt=String(e&&e.postData&&e.postData.contents||"");
  if(txt.length>150000)out=fail("Petición muy grande.",413);
  else{
   const body=JSON.parse(txt||"{}"),secret=PropertiesService.getScriptProperties().getProperty("APP_SECRET");
   out=!secret||String(body.secret||"")!==secret?fail("Acceso no autorizado.",403):dispatch(String(body.op||""),body.payload||{});
  }
 }catch(ex){console.error(ex.stack||ex);out=fail("Error de Google Sheets.",500);}
 return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
