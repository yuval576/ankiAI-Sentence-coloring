import assert from 'node:assert/strict';
import test from 'node:test';
import {describeRussianPronunciation,validatePronunciationAnnotation} from '../src/index.mjs';

test('shows only explicit, self-evident, or occurrence-verified stress',()=>{
  assert.deepEqual(describeRussianPronunciation('слу́чая'),{form:'слу́чая',stressStatus:'self-evident',pronunciation:'SLU-cha-ya'});
  assert.deepEqual(describeRussianPronunciation('случая'),{form:'случая',stressStatus:'unverified',pronunciation:null});
  assert.deepEqual(describeRussianPronunciation('случая',{stressedForm:'слу́чая',pronunciation:'SLOO-cha-ya'}),{form:'слу́чая',stressStatus:'verified',pronunciation:'SLOO-cha-ya'});
  assert.deepEqual(describeRussianPronunciation('ёлка'),{form:'ёлка',stressStatus:'self-evident',pronunciation:'YOL-ka'});
});

test('rejects unsafe or inaccurate annotations',()=>{
  assert.throws(()=>validatePronunciationAnnotation({text:'случая',stressedForm:'случа́й',pronunciation:'slu-CHAY'}),/preserve/);
  assert.throws(()=>validatePronunciationAnnotation({text:'случая',stressedForm:'слу́чая',pronunciation:'slu-cha-ya'}),/stress/);
  assert.throws(()=>describeRussianPronunciation('<img>'),/safe/);
});
