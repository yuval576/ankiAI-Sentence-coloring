import assert from 'node:assert/strict';
import test from 'node:test';
import {buildAlignmentTask,renderBilingualAlignment,tokenizeWords,validateAlignment} from '../src/index.mjs';

test('creates explicit token input and renders matching colors',()=>{
  const task=buildAlignmentTask({source:'Ты уже ходил к врачу?',target:'Have you already been to the doctor?',sourceLocale:'ru',targetLocale:'en'});
  assert.deepEqual(task.input.source.map(row=>row[1]),['Ты','уже','ходил','к','врачу']);
  const result=renderBilingualAlignment({...task,alignment:{groups:[{source:[0],target:[0]},{source:[1],target:[2]},{source:[2],target:[3]},{source:[3],target:[4]},{source:[4],target:[6]}]}});
  assert.match(result.sourceHtml,/data-alignment="3"/);assert.match(result.targetHtml,/data-alignment="3"/);assert.equal(result.alignment.coverage.source,1);
});

test('rejects duplicate, out-of-range and unsafe mappings',()=>{
  const sourceTokens=tokenizeWords('кот спит','ru'),targetTokens=tokenizeWords('the cat sleeps','en');
  assert.throws(()=>validateAlignment({groups:[{source:[0],target:[1]},{source:[0],target:[2]}]},{sourceTokens,targetTokens}),/reused/);
  assert.throws(()=>validateAlignment({groups:[{source:[9],target:[1]}]},{sourceTokens,targetTokens}),/Invalid/);
  assert.throws(()=>renderBilingualAlignment({source:'<img>',target:'safe',sourceTokens:[{text:'<img>',start:0,end:5}],targetTokens:[{text:'safe',start:0,end:4}],alignment:{groups:[{source:[0],target:[0]}]},palette:['javascript:alert(1)']}),/Palette/);
});
