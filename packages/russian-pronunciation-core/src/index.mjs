/**
 * Portable Russian stress/pronunciation core. This is deliberately not a
 * stress dictionary: a multisyllabic word without verified stress stays
 * unverified instead of being guessed.
 */
const ACUTE='\u0301';
const VOWELS='аеёиоуыэюя';
const LETTERS=Object.freeze({а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'});
const ONSETS=new Set(['бл','бр','вл','вр','гл','гр','др','кл','кр','пл','пр','тр','фл','фр','хл','хр','сл','см','сн','сп','ст','ск','св','зл','зн','зв','шл','шн','шт','стр','спр','скр','скл','встр']);
const fail=message=>{throw new TypeError(message);};
const plain=value=>{if(typeof value!=='string'||value.length>300||/[<>\u0000-\u001f\u007f]/u.test(value))fail('Expected safe bounded text');return value;};
const normalized=value=>plain(value).toLowerCase().normalize('NFD').replace(/[\u0300\u0301]/g,'').normalize('NFC').replace(/ё/g,'е');

function inspect(value){
  const source=plain(value).toLowerCase().normalize('NFC');let bare='',accent=[],vowels=[],yo=[];
  if(!/^[а-яё\u0300\u0301-]+$/u.test(source))return null;
  for(const char of source){
    if(char==='\u0300'||char===ACUTE){if(!bare||!VOWELS.includes(bare.at(-1)))return null;accent.push(bare.length-1);continue;}
    if(char==='-')return null;
    if(VOWELS.includes(char))vowels.push(bare.length);if(char==='ё')yo.push(bare.length);bare+=char;
  }
  if(!vowels.length||accent.length>1||yo.length>1)return null;
  const stress=accent.length?accent[0]:yo.length?yo[0]:vowels.length===1?vowels[0]:-1;
  if(yo.length&&stress!==yo[0])return null;
  return {bare,vowels,stress};
}

function syllables(info){
  const cuts=[0],word=info.bare;
  for(let i=0;i<info.vowels.length-1;i++){
    const end=info.vowels[i+1],cluster=word.slice(info.vowels[i]+1,end);let cut=end;
    if(cluster){cut=end-1;if('йьъ'.includes(word[cut]))cut=end;for(let n=2;n<=cluster.length;n++)if(ONSETS.has(cluster.slice(-n)))cut=end-n;}
    cuts.push(cut);
  }
  cuts.push(word.length);
  return cuts.slice(0,-1).map((start,index)=>({start,end:cuts[index+1],text:[...word.slice(start,cuts[index+1])].map(char=>LETTERS[char]).join(''),stressed:info.stress>=start&&info.stress<cuts[index+1]}));
}

function safeMetadata(value,metadata){
  if(!metadata||typeof metadata!=='object'||typeof metadata.stressedForm!=='string'||/uncertain|unverified|not\s+(?:yet\s+)?verified|unknown/i.test(String(metadata.pronunciationNote||'')))return null;
  if(normalized(metadata.stressedForm)!==normalized(value))return null;
  const candidate=inspect(metadata.stressedForm);return candidate?.stress>=0?candidate:null;
}

/**
 * Return an app-ready display object. `verified` must refer to this exact
 * occurrence, not a dictionary lemma; otherwise it is ignored.
 */
export function describeRussianPronunciation(value,verified=undefined){
  const original=plain(value).trim(),own=inspect(original),metadata=typeof verified==='string'?{stressedForm:verified}:verified;
  const checked=safeMetadata(original,metadata),chosen=checked&&( !own||own.stress<0||own.stress===checked.stress)?checked:own;
  if(!chosen||chosen.stress<0)return Object.freeze({form:original,stressStatus:'unverified',pronunciation:null});
  const form=chosen.bare[chosen.stress]==='ё'?chosen.bare:chosen.bare.slice(0,chosen.stress+1)+ACUTE+chosen.bare.slice(chosen.stress+1);
  const parts=syllables(chosen);let pronunciation=parts.map(part=>part.stressed?part.text.toUpperCase():part.text).join('-');
  if(metadata&&typeof metadata.pronunciation==='string'){
    const cached=metadata.pronunciation.split('-');
    if(cached.length===parts.length&&cached.every((part,index)=>part.length<=40&&(parts[index].stressed?/^[A-Z]+(?:'[A-Z]+)*$/:/^[a-z]+(?:'[a-z]+)*$/).test(part)))pronunciation=metadata.pronunciation;
  }
  return Object.freeze({form,stressStatus:checked?'verified':'self-evident',pronunciation});
}

/** Validate checked AI/server annotations before caching or presenting them. */
export function validatePronunciationAnnotation({text,stressedForm,pronunciation,pronunciationNote}={}){
  const original=plain(text),marked=plain(stressedForm),note=pronunciationNote===undefined?'':plain(pronunciationNote);
  if(normalized(original)!==normalized(marked))fail('Stressed form must preserve the exact word letters');
  const info=inspect(marked);if(!info)fail('Stressed form is malformed');
  if(info.vowels.length>1&&info.stress<0&&!note)fail('Multisyllabic form needs stress or an uncertainty note');
  if(typeof pronunciation!=='string'||!/^[A-Za-z]+(?:-[A-Za-z]+)*$/.test(pronunciation))fail('Pronunciation must be hyphenated Latin syllables');
  const parts=syllables(info),provided=pronunciation.split('-');
  if(provided.length!==parts.length||provided.some((part,index)=>parts[index].stressed?!/^[A-Z]+(?:'[A-Z]+)*$/.test(part):!/^[a-z]+(?:'[a-z]+)*$/.test(part)))fail('Pronunciation stress must match the Russian stress');
  return Object.freeze({text:original,stressedForm:marked,pronunciation,pronunciationNote:note||undefined});
}
