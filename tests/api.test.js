import test from "node:test";
import assert from "node:assert/strict";
import {GET,POST} from "../api/game.js";

test("salud indica configuración pendiente sin secretos",async()=>{
 const backup={url:process.env.GOOGLE_SCRIPT_URL,secret:process.env.GOOGLE_SCRIPT_SECRET};
 delete process.env.GOOGLE_SCRIPT_URL;delete process.env.GOOGLE_SCRIPT_SECRET;
 try{
  const response=await GET(new Request("https://example.vercel.app/api/game?op=health"));
  const payload=await response.json();
  assert.equal(response.status,200);assert.equal(payload.configured,false);
 }finally{
  if(backup.url===undefined)delete process.env.GOOGLE_SCRIPT_URL;else process.env.GOOGLE_SCRIPT_URL=backup.url;
  if(backup.secret===undefined)delete process.env.GOOGLE_SCRIPT_SECRET;else process.env.GOOGLE_SCRIPT_SECRET=backup.secret;
 }
});

test("rechaza códigos de sala inválidos",async()=>{
 const response=await GET(new Request("https://example.vercel.app/api/game?op=state&code=bad"));
 const payload=await response.json();
 assert.equal(response.status,400);
 assert.equal(payload.ok,false);
});

test("bloquea peticiones con Origin ajeno",async()=>{
 const response=await POST(new Request("https://example.vercel.app/api/game?op=join",{
  method:"POST",headers:{"Content-Type":"application/json",Origin:"https://otraweb.com"},
  body:JSON.stringify({code:"ABC234",name:"Prueba"})}));
 assert.equal(response.status,403);
});

test("rechaza respuestas sin sesión válida",async()=>{
 const response=await POST(new Request("https://example.vercel.app/api/game?op=answer",{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({code:"ABC234",choice:0})}));
 assert.equal(response.status,403);
});

test("pide configuración privada al crear sala",async()=>{
 const response=await POST(new Request("https://example.vercel.app/api/game?op=create",{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({duration:20,questions:[{prompt:"¿Qué semirremolque usas para este material?",cargo:"Cajas empacadas",emoji:"📦",options:["cortinado","caja_seca","tolva","plataforma"],answer:0,explanation:"Es apropiado para la carga general protegida."}]})}));
 const p=await response.json();
 assert.equal(p.ok,false);
 assert.match(p.error,/Configura GOOGLE_SCRIPT_URL/);
});
