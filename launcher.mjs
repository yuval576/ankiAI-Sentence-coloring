import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ROOT} from './codex-tutor.mjs';
const profile=process.env.ANKI_PROFILE||'User 1';
if(path.basename(profile)!==profile||['.','..'].includes(profile))throw Error('Invalid ANKI_PROFILE');
const MEDIA=path.join(process.env.ANKI_BASE||path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'Anki2'),profile,'collection.media');
if(!fs.existsSync(MEDIA))throw Error('Anki media folder missing; configure ANKI_BASE and ANKI_PROFILE');
try {const r=await fetch('http://127.0.0.1:8766/health');if(r.ok){console.log('Tutor is already running.');process.exit(0);}}catch{}
const log=fs.createWriteStream(path.join(ROOT,'runtime.log'),{flags:'a'});
const record=s=>log.write(new Date().toISOString()+' '+s+'\n');
const server=spawn(process.execPath,[path.join(ROOT,'server.mjs')],{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});
server.stdout.on('data',d=>record(d.toString().replace(/PAIRING CODE[^\n]*/g,'Pairing code available on local dashboard')));
server.stderr.on('data',d=>record(d.toString()));
server.on('error',e=>record(e.message));
const tunnel=spawn(path.join(ROOT,'cloudflared.exe'),['tunnel','--url','http://127.0.0.1:8766','--no-autoupdate'],{cwd:ROOT,windowsHide:true,stdio:['ignore','ignore','pipe']});
let tail='',configured=false;
tunnel.stderr.on('data',d=>{
 const text=d.toString();record(text);tail=(tail+text).slice(-12000);
 const match=tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
 if(match&&!configured){configured=true;
  const config='window.RuTutorConfig = {\n  local: "http://127.0.0.1:8766",\n  remote: '+JSON.stringify(match[0])+'\n};\n';
  fs.writeFileSync(path.join(ROOT,'card-config.js'),config);
  fs.writeFileSync(path.join(MEDIA,'_ru-tutor-config.js'),config);
  // Anki skips rescanning unchanged directories; overwriting an existing file
  // alone does not update the directory timestamp on Windows.
  const changedAt=new Date();fs.utimesSync(MEDIA,changedAt,changedAt);
  record('Updated synchronized iPhone endpoint.');
 }
});
tunnel.on('error',e=>record(e.message));
fs.writeFileSync(path.join(ROOT,'running-processes.json'),JSON.stringify({launcher:process.pid,server:server.pid,tunnel:tunnel.pid}));
const stop=()=>{server.kill();tunnel.kill();log.end();};
process.on('SIGINT',()=>{stop();process.exit(0);});process.on('SIGTERM',()=>{stop();process.exit(0);});
server.on('exit',code=>{record('Server exited '+code);tunnel.kill();});
tunnel.on('exit',code=>{record('Tunnel exited '+code);});
