import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import fs from 'node:fs';
import os from 'node:os';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
function codexExecutable() {
  if(process.env.ANKI_CODEX_PATH&&fs.existsSync(process.env.ANKI_CODEX_PATH))return process.env.ANKI_CODEX_PATH;
  const extensions=path.join(os.homedir(),'.vscode','extensions');
  try {
    const candidates=fs.readdirSync(extensions).filter(n=>n.startsWith('openai.chatgpt-')&&n.endsWith('-win32-x64')).sort().reverse();
    for(const n of candidates){const exe=path.join(extensions,n,'bin','windows-x86_64','codex.exe');if(fs.existsSync(exe))return exe;}
  }catch{}
  return process.platform==='win32'?'codex.exe':'codex';
}
const disabled = ['apps','plugins','remote_plugin','hooks','shell_tool','unified_exec',
  'multi_agent','multi_agent_v2','computer_use','browser_use','browser_use_external',
  'in_app_browser','code_mode_host','code_mode','view_image','image_generation',
  'goals','memories','skill_search','workspace_dependencies','tool_suggest','sleep_tool'];

export function askTutor(prompt, {signal, onText = () => {}, schema = false, effort = 'max'} = {}) {
  if(!['medium','max'].includes(effort))throw Error('Unsupported tutor reasoning setting');
  if(![false,true,'batch','chat'].includes(schema))throw Error('Unsupported output schema');
  const args = ['exec','--ignore-user-config','--ignore-rules','--ephemeral','--json',
    '--skip-git-repo-check','--sandbox','read-only','--cd',ROOT,
    '--model',process.env.ANKI_TUTOR_MODEL||'gpt-5.6-luna',
    '-c',`model_reasoning_effort=${JSON.stringify(effort)}`,
    '-c','approval_policy="never"',
    '-c','forced_login_method="chatgpt"',
    '-c','web_search="disabled"',
    '-c','project_doc_max_bytes=0',
    '-c',`model_instructions_file=${JSON.stringify(path.join(ROOT,'tutor-instructions.md').replaceAll('\\','/'))}`,
    ...disabled.flatMap(name => ['--disable',name]),
    ...(schema ? ['--output-schema',path.join(ROOT,schema==='batch'?'alignment-batch-schema.json':schema==='chat'?'chat-memory-schema.json':'alignment-schema.json')] : []), '-'];
  return new Promise((resolve,reject) => {
    const child = spawn(codexExecutable(),args,{cwd:ROOT,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let buffer = '', answer = '', stderr = '', failure = '', usage;
    const decoder = new StringDecoder('utf8');
    const timer = setTimeout(() => { failure = 'The tutor took too long. Please try a shorter question.'; child.kill(); },180000);
    const abort = () => { failure = 'Request cancelled'; child.kill(); };
    signal?.addEventListener('abort',abort,{once:true});
    child.on('error',reject);
    child.stderr.on('data',d => { stderr = (stderr+d.toString()).slice(-4000); });
    child.stdout.on('data',d => {
      buffer += decoder.write(d);
      let i;
      while ((i=buffer.indexOf('\n')) !== -1) {
        const line=buffer.slice(0,i); buffer=buffer.slice(i+1);
        let event; try { event=JSON.parse(line); } catch { continue; }
        if (event.type==='item.completed' && event.item?.type==='agent_message') {
          answer=event.item.text; onText(answer);
        }
        if (event.type==='turn.failed' || event.type==='error') failure=event.error?.message || event.message || 'Tutor failed';
        if (event.type==='turn.completed') usage=event.usage;
        // This service must never run local or external tools for a chat request.
        if (event.type==='item.started' && ['command_execution','mcp_tool_call','web_search','file_change'].includes(event.item?.type)) {
          failure='A non-chat action was requested; the request was stopped.'; child.kill();
        }
      }
    });
    child.on('close',code => {
      clearTimeout(timer); signal?.removeEventListener('abort',abort);
      if (code!==0 || failure || !answer) reject(new Error(failure || stderr || 'The tutor returned no answer.'));
      else resolve({answer,usage});
    });
    child.stdin.end(prompt);
  });
}

if (process.argv.includes('--test')) {
  try { console.log(JSON.stringify(await askTutor('Explain briefly why "быть" appears as "был" in "Ты был вчера в кино?".'),null,2)); }
  catch (error) { console.error(error.message); process.exitCode=1; }
}
