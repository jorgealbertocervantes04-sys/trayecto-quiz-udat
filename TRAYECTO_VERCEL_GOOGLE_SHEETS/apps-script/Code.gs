/**
 * TRAYECTO Quiz + UDAT. Google Sheets as sole durable storage.
 * Paste into Extensions > Apps Script of the Google spreadsheet, run configurar(),
 * deploy as Web app (Execute as me; Anyone), then configure Vercel env vars.
 * NEVER place the APP_SECRET into a public Vercel/JS file or repository.
 */
const TQ_TABS={rooms:'Salas',players:'Participantes',answers:'Respuestas'};
const TQ_HEADERS={
 Salas:['codigo','hash_instructor','segundos','fase','indice','limite_utc','preguntas_json','creada_utc','actualizada_utc'],
 Participantes:['id','codigo','nombre','hash_sesion','ingreso_utc'],
 Respuestas:['id_respuesta','codigo','id_participante','indice_pregunta','opcion','momento_utc','puntos','acierto']
};
const TQ_CAPACITY=150;

/** Run ONCE in your bound spreadsheet. Logs secret and spreadsheet ID for Vercel setup. */
function configurar(){
 const book=SpreadsheetApp.getActiveSpreadsheet();
 if(!book)throw new Error('Ejecuta configurar desde Extensiones > Apps Script de la hoja.');
 const properties=PropertiesService.getScriptProperties();
 properties.setProperty('SHEET_ID',book.getId());
 if(!properties.getProperty('APP_SECRET'))properties.setProperty('APP_SECRET',Utilities.getUuid()+Utilities.getUuid());
 Object.keys(TQ_HEADERS).forEach(name=>{
   let sh=book.getSheetByName(name);
   if(!sh)sh=book.insertSheet(name);
   const headers=TQ_HEADERS[name];
   const old=sh.getRange(1,1,1,headers.length).getValues()[0];
   if(old.some((v,i)=>v && v!==headers[i]))throw new Error('La hoja '+name+' tiene encabezados distintos. No se sobrescribirán datos.');
   sh.getRange(1,1,1,headers.length).setValues([headers]);
   sh.setFrozenRows(1);
   sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#093b88').setFontColor('#ffffff');
   sh.autoResizeColumns(1,Math.min(headers.length,5));
 });
 Logger.log('CONFIGURACIÓN PARA VERCEL');
 Logger.log('GOOGLE_SCRIPT_SECRET = '+properties.getProperty('APP_SECRET'));
 Logger.log('ID de Google Sheets = '+book.getId());
 Logger.log('Mantén el secreto en Vercel, NO en archivos públicos.');
}
function tqBook(){
 const id=PropertiesService.getScriptProperties().getProperty('SHEET_ID');
 if(!id)throw new Error('Antes debes ejecutar configurar().');
 return SpreadsheetApp.openById(id);
}
function tqError(message,status){return {ok:false,error:String(message),status:status||400};}
function tqRows(sheet){let r=sheet.getLastRow();return r<2?[]:sheet.getRange(2,1,r-1,sheet.getLastColumn()).getValues();}
function tqRoom(book,code){
 const rows=tqRows(book.getSheetByName(TQ_TABS.rooms));
 const index=rows.findIndex(row=>String(row[0])===code);
 return index<0?null:{row:index+2,code:String(rows[index][0]),hash:String(rows[index][1]),duration:Number(rows[index][2]),phase:String(rows[index][3]),index:Number(rows[index][4]),deadline:String(rows[index][5]||''),questions:JSON.parse(String(rows[index][6]||'[]'))};
}
function tqPlayers(book,code){return tqRows(book.getSheetByName(TQ_TABS.players)).filter(r=>String(r[1])===code).map(r=>({id:String(r[0]),name:String(r[2]),hash:String(r[3])}));}
function tqAnswers(book,code){return tqRows(book.getSheetByName(TQ_TABS.answers)).filter(r=>String(r[1])===code).map(r=>({id:String(r[0]),playerId:String(r[2]),index:Number(r[3]),choice:Number(r[4]),at:String(r[5]),score:Number(r[6]),correct:Number(r[7])===1}));}
function tqEffective(room){return room.phase==='question'&&Date.now()>=Date.parse(room.deadline)?'reveal':room.phase;}
function tqCacheKey(code){return 'tq-snapshot-'+code;}
function tqInvalidate(code){try{CacheService.getScriptCache().remove(tqCacheKey(code));}catch(e){}}
function tqPublic(book,room){
 const phase=tqEffective(room),players=tqPlayers(book,room.code),all=tqAnswers(book,room.code),question=room.index>=0?room.questions[room.index]:null;
 const included=phase==='question'?room.index-1:room.index;
 const current=all.filter(a=>a.index===room.index);
 const leaderboard=players.map(p=>{
   const results=all.filter(a=>a.playerId===p.id&&a.index<=included);
   return {id:p.id,name:p.name,score:results.reduce((n,a)=>n+a.score,0),correct:results.filter(a=>a.correct).length};
 }).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
 const summary=players.map(p=>{
   const a=current.find(x=>x.playerId===p.id);
   const ranked=leaderboard.find(x=>x.id===p.id);
   return {id:p.id,name:p.name,score:ranked.score,answered:Boolean(a),
     ...(phase==='reveal'||phase==='finished'?{lastCorrect:a?a.correct:false,lastEarned:a?a.score:0,lastChoice:a?a.choice:null}:{})};
 });
 const visible=phase==='lobby'?null:question?{
   prompt:question.prompt,cargo:question.cargo,emoji:question.emoji,options:question.options
 }:null;
 const result={ok:true,code:room.code,phase,index:room.index,total:room.questions.length,duration:room.duration,
   deadline:room.deadline||null,participants:players.length,answered:current.length,players:summary,leaderboard,
   question:visible,server_now:new Date().toISOString()};
 if(phase==='reveal'||phase==='finished'){
   result.correct=question?question.answer:null;
   result.explanation=question?question.explanation:'';
   result.distribution=[0,0,0,0];
   current.forEach(a=>{if(a.choice>=0&&a.choice<4)result.distribution[a.choice]++;});
 }
 return result;
}
function tqCheckHash(hash){return typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash);}
function tqText(s){return String(s||'').replace(/\s+/g,' ').trim();}
function tqSafeCell(s){const v=String(s);return /^[=+@-]/.test(v)?"'"+v:v;}
function tqWithLock(action){
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))return tqError('La sala está recibiendo muchas respuestas. Intenta de nuevo.',503);
 try{return action();}finally{lock.releaseLock();}
}
function tqDispatch(op,body){
 if(op==='health')return {ok:true,database:'Google Sheets',configured:Boolean(PropertiesService.getScriptProperties().getProperty('SHEET_ID'))};
 const book=tqBook();
 if(op==='create')return tqWithLock(()=>{
   const code=String(body.code||'');
   if(!/^[A-Z2-9]{6}$/.test(code)||!tqCheckHash(body.hostHash))return tqError('Datos de creación inválidos.');
   const duration=Number(body.duration),questions=body.questions;
   if(!Number.isInteger(duration)||duration<10||duration>90||!Array.isArray(questions)||questions.length<1||questions.length>30)return tqError('Configuración de preguntas inválida.');
   if(tqRoom(book,code))return tqError('Código duplicado.',409);
   const now=new Date().toISOString();
   book.getSheetByName(TQ_TABS.rooms).appendRow([code,body.hostHash,duration,'lobby',-1,'',JSON.stringify(questions),now,now]);
   tqInvalidate(code);
   return {ok:true,code};
 });
 const code=String(body.code||'').toUpperCase();
 if(!/^[A-Z2-9]{6}$/.test(code))return tqError('Código inválido.');
 if(op==='state'){
   const cache=CacheService.getScriptCache(),key=tqCacheKey(code),stored=cache.get(key);
   if(stored){try{return JSON.parse(stored)}catch(e){}}
   const room=tqRoom(book,code);if(!room)return tqError('Sala no encontrada.',404);
   const snap=tqPublic(book,room);
   try{cache.put(key,JSON.stringify(snap),4);}catch(e){}
   return snap;
 }
 return tqWithLock(()=>{
   const room=tqRoom(book,code);if(!room)return tqError('Sala no encontrada.',404);
   if(op==='join'){
     if(tqEffective(room)!=='lobby')return tqError('El juego ya comenzó. No se admiten nuevos participantes.',409);
     const name=tqText(body.name),hash=body.tokenHash,id=String(body.playerId||'');
     if(name.length<1||name.length>32||!/^[a-f0-9-]{36}$/.test(id)||!tqCheckHash(hash))return tqError('Nombre o sesión inválida.');
     const players=tqPlayers(book,code);
     if(players.length>=TQ_CAPACITY)return tqError('Sala llena (150 participantes).',409);
     if(players.some(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))return tqError('Ese nombre ya está utilizado. Añade tu apellido o un número.',409);
     book.getSheetByName(TQ_TABS.players).appendRow([id,code,tqSafeCell(name),hash,new Date().toISOString()]);
     tqInvalidate(code);return {ok:true,code,name,id};
   }
   if(op==='answer'){
     const tokenHash=body.tokenHash,choice=Number(body.choice),player=tqPlayers(book,code).find(p=>p.hash===tokenHash);
     if(!player)return tqError('Sesión de participante inválida.',403);
     if(!Number.isInteger(choice)||choice<0||choice>3)return tqError('Opción inválida.');
     const receivedAt=Date.parse(String(body.receivedAt||''));
     const deadline=Date.parse(room.deadline),started=deadline-room.duration*1000;
     if(room.phase!=='question'||room.index<0||!Number.isFinite(receivedAt)||receivedAt>deadline||receivedAt<started-5000||receivedAt>Date.now()+5000)
       return tqError('Esta pregunta ya terminó.',409);
     const answers=tqAnswers(book,code),existing=answers.find(a=>a.index===room.index&&a.playerId===player.id);
     if(existing)return {ok:true,choice:existing.choice,duplicate:true};
     const q=room.questions[room.index],duration=room.duration*1000,remaining=Math.max(0,deadline-receivedAt);
     const earned=q.answer===choice?Math.round(500+500*Math.min(1,remaining/duration)):0;
     book.getSheetByName(TQ_TABS.answers).appendRow([Utilities.getUuid(),code,player.id,room.index,choice,body.receivedAt,earned,q.answer===choice?1:0]);
     tqInvalidate(code);return {ok:true,choice,earned};
   }
   if(op==='action'){
     if(body.hostHash!==room.hash)return tqError('Acceso de instructor rechazado.',403);
     const action=body.action,phase=tqEffective(room);let index=room.index,deadline=room.deadline,newPhase=room.phase;
     if(action==='start'){
       if(phase!=='lobby')return tqError('La sala ya empezó.',409);
       if(tqPlayers(book,code).length<1)return tqError('Espera al menos un participante.',409);
       index=0;newPhase='question';deadline=new Date(Date.now()+room.duration*1000).toISOString();
     }else if(action==='reveal'){
       if(phase!=='question'&&phase!=='reveal')return tqError('No hay pregunta activa.',409);
       newPhase='reveal';
     }else if(action==='next'){
       if(phase!=='reveal')return tqError('Revela o espera el final del tiempo.',409);
       index++;
       if(index>=room.questions.length){newPhase='finished';index=room.questions.length-1;}
       else{newPhase='question';deadline=new Date(Date.now()+room.duration*1000).toISOString();}
     }else return tqError('Acción desconocida.');
     const sheet=book.getSheetByName(TQ_TABS.rooms);
     sheet.getRange(room.row,4,1,3).setValues([[newPhase,index,deadline]]);
     sheet.getRange(room.row,9).setValue(new Date().toISOString());
     tqInvalidate(code);return {ok:true,phase:newPhase,index};
   }
   if(op==='export'){
     if(body.hostHash!==room.hash)return tqError('Solo el instructor puede exportar.',403);
     const snapshot=tqPublic(book,room);
     return {ok:true,rows:snapshot.leaderboard};
   }
   return tqError('Operación no reconocida.',404);
 });
}
function doPost(e){
 let result;
 try{
   const raw=e&&e.postData&&e.postData.contents||'';
   if(raw.length>140000)result=tqError('Solicitud demasiado grande.',413);
   else{
     const body=JSON.parse(raw||'{}'),secret=PropertiesService.getScriptProperties().getProperty('APP_SECRET');
     if(!secret||String(body.secret||'')!==secret)result=tqError('Acceso no autorizado.',403);
     else result=tqDispatch(String(body.op||''),body.payload||{});
   }
 }catch(err){console.error(err.stack||err);result=tqError('Error del servidor de Google Sheets.',500);}
 return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
