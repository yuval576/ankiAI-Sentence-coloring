/** All provider calls are fakes; all writes are isolated in task temp folders. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runPipeline,keyFor,atomicJSON,acquireLock,recoverLock,status,validGroups} from './process-batch-colors.mjs';

const sample = i => ({word:'word'+i,ru:['слово'],en:['word'],nid:i,pair:1});
const answer = {answer:JSON.stringify({groups:[{ru:[0],en:[0]}]})};
const get = (root,name) => JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const put = (root,name,value) => atomicJSON(path.join(root,name),value);
const roots=[];
function fixture(n=5) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'anki-pipeline-test-'));roots.push(root);
  put(root,'upcoming-colors.json',Array.from({length:n},(_,i)=>sample(i)));
  return root;
}
async function run(root,extra={}) {return runPipeline({root,provider:async()=>answer,log:()=>{},...extra});}

if(process.argv[2]==='--crash-child') {
  await run(process.argv[3],{workers:1,provider:async()=>{process.exit(55);}});
} else {
  try {
    let root=fixture();
    const before=fs.readdirSync(root);
    let result=await run(root,{dryRun:true,provider:()=>{throw Error('MUST NOT CALL');}});
    assert.equal(result.remaining,5);assert.deepEqual(fs.readdirSync(root),before);
    const first=sample(0),cache={[keyFor(first)]:JSON.parse(answer.answer)};
    put(root,'alignment-cache.json',cache);
    put(root,'upcoming-colors.json',[first,first,...Array.from({length:4},(_,i)=>sample(i+1))]);
    let calls=0,active=0,maxActive=0;
    result=await run(root,{workers:4,provider:async()=>{
      calls++;active++;maxActive=Math.max(active,maxActive);
      await new Promise(r=>setTimeout(r,5));active--;return answer;
    }});
    assert.equal(result.status,'completed');assert.equal(calls,4);assert.equal(maxActive,4);
    assert.equal(result.remaining,0);assert.equal(result.saved,4);assert.ok(result.finishedAt);
    assert.equal(result.active,0);assert.equal(fs.existsSync(path.join(root,'coloring.lock')),false);
    result=await run(root,{provider:()=>{throw Error('Already cached');}});assert.equal(result.attempted,0);
    assert.equal(Object.keys(get(root,'batch-alignment-cache.json')).length,4);

    root=fixture();result=await run(root,{limit:2});
    assert.equal(result.stopReason,'pair-limit');assert.equal(result.remaining,3);
    result=await run(root);assert.equal(result.saved,3);assert.equal(result.status,'completed');

    for(const error of ['403 Forbidden','429 rate limit','401 authentication failed','usage limit exceeded']) {
      root=fixture(10);calls=0;
      result=await run(root,{workers:4,provider:async()=>{calls++;throw Error(error);}});
      assert.equal(result.stopReason,'service-access-or-quota');assert.ok(calls<=4);
      assert.equal(result.saved,0);assert.equal(result.active,0);
    }

    root=fixture(10);calls=0;
    result=await run(root,{workers:1,provider:async()=>{calls++;throw Error('The tutor took too long.');}});
    assert.equal(calls,3);assert.equal(result.stopReason,'consecutive-timeouts');
    assert.equal(get(root,'coloring-checkpoint.json').pairs[keyFor(sample(0))].attempts,2);
    result=await run(root);assert.equal(result.remaining,1);assert.equal(result.exhausted,1);
    result=await run(root,{retryFailed:true});assert.equal(result.status,'completed');

    root=fixture(10);let aborted=0;
    result=await run(root,{workers:4,requestTimeoutMs:10,provider:async(_,{signal})=>{
      signal.addEventListener('abort',()=>aborted++,{once:true});return new Promise(()=>{});
    }});
    assert.equal(result.stopReason,'consecutive-timeouts');assert.ok(aborted>=3);assert.equal(result.active,0);

    root=fixture(2);calls=0;
    result=await run(root,{provider:async()=>{calls++;return {answer:'{"groups":[{"ru":[9],"en":[0]}]}'};}});
    assert.equal(result.stopReason,'pairs-need-review');assert.equal(calls,2);
    result=await run(root,{provider:()=>{throw Error('Must not retry invalid pairs');}});
    assert.equal(result.attempted,0);assert.equal(result.remaining,2);
    assert.equal(validGroups([{ru:[0],en:[0]},{ru:[0],en:[0]}],sample(0)),false);

    root=fixture(1);const lock=acquireLock(root);
    await assert.rejects(run(root),/lock exists/);assert.throws(()=>recoverLock(root),/alive/);
    assert.equal(status(root).ownerAlive,true);lock.release();
    const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--crash-child',root],{windowsHide:true,timeout:10000});
    assert.equal(child.status,55);assert.equal(status(root).effectiveStatus,'interrupted');
    assert.equal(get(root,'coloring-checkpoint.json').pairs[keyFor(sample(0))].attempts,1);
    recoverLock(root);result=await run(root);assert.equal(result.status,'completed');

    root=fixture(3);put(root,'coloring.stop',{requestedAt:new Date().toISOString()});
    result=await run(root,{provider:()=>{throw Error('Must not call while stopped');}});
    assert.equal(result.stopReason,'stop-file');assert.equal(result.attempted,0);

    root=fixture(3);calls=0;
    result=await run(root,{workers:1,heartbeatMs:5,provider:async(_,{signal})=>{
      calls++;put(root,'coloring.stop',{});
      return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('Request cancelled')),{once:true}));
    }});
    assert.equal(result.stopReason,'stop-file');assert.equal(calls,1);

    root=fixture(2);
    result=await run(root,{workers:1,provider:async()=>{
      const file=path.join(root,'batch-alignment-cache.json');
      const existing=fs.existsSync(file)?get(root,'batch-alignment-cache.json'):{};
      existing.external={groups:[{ru:[0],en:[0]}]};put(root,'batch-alignment-cache.json',existing);
      return answer;
    }});
    assert.ok(get(root,'batch-alignment-cache.json').external);
    assert.ok(!fs.readdirSync(root).some(f=>f.endsWith('.tmp')));
    console.log('PASS: dry-run, dedupe/cache skip, 4 workers, resume, atomic checkpoints, auth/quota stop, timeout circuit, bounded attempts, validation, locks/crash recovery, graceful stop, merge preservation. No real provider calls.');
  } finally {
    // Only explicit mkdtemp fixtures, never project or user data.
    for(const root of roots) {
      assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'anki-pipeline-test-'));
      fs.rmSync(root,{recursive:true,force:true});
    }
  }
}
