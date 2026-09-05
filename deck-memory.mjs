import fs from 'node:fs';
import path from 'node:path';
const defaults={instructions:'',memoryEnabled:true};
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
function save(file,value){fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);}
const words=text=>new Set((text.toLocaleLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu)||[]).filter(w=>w.length>2));
export class DeckMemory {
 constructor(root){
  this.settingsFile=path.join(root,'deck-settings.json');this.memoryFile=path.join(root,'deck-memory.json');this.automaticFile=path.join(root,'deck-automatic-memory.json');
  this.settings={...defaults,...read(this.settingsFile,{})};this.entries=read(this.memoryFile,[]);this.generation=0;
  this.automatic=read(this.automaticFile,{facts:[],guidance:[]});
 }
 info(){return {instructions:this.settings.instructions,memoryEnabled:this.settings.memoryEnabled,automaticMemory:this.automatic.facts,selfInstructions:this.automatic.guidance,exchanges:this.entries.length,maxExchanges:1000};}
 update(input){
  if(Object.keys(input).some(k=>!['instructions','memoryEnabled'].includes(k))||typeof input.instructions!=='string'||input.instructions.length>4000||typeof input.memoryEnabled!=='boolean')throw Error('Only your instructions and automatic-memory toggle can be edited');
  if(input.memoryEnabled!==this.settings.memoryEnabled||input.instructions!==this.settings.instructions)this.generation++;
  // Preserve old manual notes on disk for recovery, but never feed them to Luna.
  this.settings={...this.settings,instructions:input.instructions,memoryEnabled:input.memoryEnabled};
  save(this.settingsFile,this.settings);return this.info();
 }
 clear(kind='all'){
  if(!['all','facts','guidance'].includes(kind))throw Error('Invalid memory section');
  if(kind!=='guidance'){this.entries=[];this.automatic.facts=[];save(this.memoryFile,this.entries);}
  if(kind!=='facts')this.automatic.guidance=[];
  this.generation++;save(this.automaticFile,this.automatic);return this.info();
 }
 applyAutomatic(updates,evidenceMessages,generation,created=Date.now()){
  if(!this.settings.memoryEnabled||generation!==this.generation||!updates)return {facts:0,guidance:0};
  const validKey=k=>typeof k==='string'&&/^[a-z0-9_-]{1,48}$/.test(k);
  const sources=evidenceMessages.filter(s=>typeof s==='string');
  const changed={facts:0,guidance:0};
  for(const [field,key,limit] of [['facts','memory',24],['guidance','selfInstructions',12]]){
   for(const item of (Array.isArray(updates[key])?updates[key]:[]).slice(0,4)){
    if(!item||!validKey(item.key)||typeof item.text!=='string'||!item.text.trim()||item.text.length>400||typeof item.evidence!=='string'||item.evidence.length<4||!sources.some(s=>s.includes(item.evidence)))continue;
    const previous=this.automatic[field].find(e=>e.key===item.key);
    if(previous&&previous.updatedAt>created)continue;
    this.automatic[field]=this.automatic[field].filter(e=>e.key!==item.key);
    this.automatic[field].push({key:item.key,text:item.text.trim(),evidence:item.evidence.slice(0,500),updatedAt:created});changed[field]++;
   }
   const removals=key==='memory'?updates.forgetMemoryKeys:updates.forgetSelfInstructionKeys;
   for(const item of (Array.isArray(removals)?removals:[]).slice(0,4)){
    if(!item||!validKey(item.key)||typeof item.evidence!=='string'||item.evidence.length<4||!sources.some(s=>s.includes(item.evidence)))continue;
    const removed=this.automatic[field].find(e=>e.key===item.key&&e.updatedAt<=created);
    if(field==='facts'&&removed){
     // Do not keep replaying the source chat after a requested fact is forgotten.
     this.entries=this.entries.filter(e=>!e.question.includes(removed.evidence));save(this.memoryFile,this.entries);
    }
    this.automatic[field]=this.automatic[field].filter(e=>e.key!==item.key||e.updatedAt>created);
   }
   this.automatic[field]=this.automatic[field].slice(-limit);
  }
  save(this.automaticFile,this.automatic);return changed;
 }
 record(context,question,answer,generation){
  if(!this.settings.memoryEnabled||generation!==this.generation)return;
  this.entries.push({word:context.word.slice(0,200),question:question.slice(0,3000),answer:answer.slice(0,5000),time:Date.now()});
  this.entries=this.entries.slice(-1000);save(this.memoryFile,this.entries);
 }
 select(context,question){
  if(!this.settings.memoryEnabled)return [];
  const query=words(context.word+' '+question);
  const ranked=this.entries.map((entry,i)=>({i,score:[...words(entry.word+' '+entry.question+' '+entry.answer)].filter(w=>query.has(w)).length+(entry.word===context.word?10:0)}));
  const ids=new Set(ranked.slice(-4).map(x=>x.i));
  ranked.filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.i-a.i).slice(0,4).forEach(x=>ids.add(x.i));
  const result=[];let size=0;
  for(const i of [...ids].sort((a,b)=>b-a)){
   const entry=this.entries[i];const n=JSON.stringify(entry).length;
   if(size+n>22000)continue;result.unshift(entry);size+=n;
  }
  return result;
 }
}
