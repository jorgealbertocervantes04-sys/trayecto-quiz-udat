import { cp, mkdir, rm } from 'node:fs/promises';
const to = new URL('../dist/', import.meta.url);
await rm(to, { recursive:true, force:true });
await mkdir(to, { recursive:true });
await cp(new URL('../public/', import.meta.url),to,{recursive:true});
console.log('Sitio preparado en dist/ y función en api/game.js');
