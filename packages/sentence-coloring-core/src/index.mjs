/** Portable sentence-coloring core. It deliberately does not call an AI provider. */
export const DEFAULT_PALETTE=Object.freeze(['#c0392b','#2471a3','#1e8449','#9a7d0a','#7d3c98','#117864','#b03a2e','#566573']);

const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new TypeError(message);};
const text=value=>{if(typeof value!=='string'||value.length>200000)fail('Expected bounded text');return value;};
const integer=(value,limit)=>Number.isInteger(value)&&value>=0&&value<limit;
const escapeHtml=value=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

/** Split a sentence into word-like segments with offsets into the original text. */
export function tokenizeWords(value,locale=undefined){
  const input=text(value);
  if(typeof Intl?.Segmenter!=='function')fail('Intl.Segmenter is required');
  return [...new Intl.Segmenter(locale,{granularity:'word'}).segment(input)]
    .filter(segment=>segment.isWordLike)
    .map(segment=>Object.freeze({text:segment.segment,start:segment.index,end:segment.index+segment.segment.length}));
}

function validateTokenRanges(value,tokens,label){
  const input=text(value);
  if(!Array.isArray(tokens)||tokens.length>10000)fail(label+' tokens must be a bounded array');
  let previous=0;
  return tokens.map((token,index)=>{
    if(!object(token)||Object.keys(token).some(key=>key!=='text'&&key!=='start'&&key!=='end')||typeof token.text!=='string'||!Number.isInteger(token.start)||!Number.isInteger(token.end)||token.start<previous||token.end<=token.start||token.end>input.length||input.slice(token.start,token.end)!==token.text)fail('Invalid '+label+' token at '+index);
    previous=token.end;return Object.freeze({text:token.text,start:token.start,end:token.end});
  });
}

/** JSON schema for an LLM or alignment service. Validate every response below. */
export function alignmentSchema(){return {type:'object',additionalProperties:false,required:['groups'],properties:{groups:{type:'array',items:{type:'object',additionalProperties:false,required:['source','target'],properties:{source:{type:'array',items:{type:'integer'}},target:{type:'array',items:{type:'integer'}}}}}}};}

/** Provider-neutral task data. Run a model through your server, not an app client with a secret. */
export function buildAlignmentTask({source,target,sourceLocale,targetLocale}={}){
  const sourceText=text(source),targetText=text(target),sourceTokens=tokenizeWords(sourceText,sourceLocale),targetTokens=tokenizeWords(targetText,targetLocale);
  return Object.freeze({schema:alignmentSchema(),source:sourceText,target:targetText,sourceTokens,targetTokens,
    prompt:'Align the sentences by meaning. Return only JSON matching the schema. Each group maps one minimal corresponding word or short phrase. Do not reuse tokens, invent mappings, or align by position. Leave unmatched words out.',
    input:{source:sourceTokens.map((token,index)=>[index,token.text]),target:targetTokens.map((token,index)=>[index,token.text])}});
}

/** Validate untrusted provider output and return an immutable canonical mapping. */
export function validateAlignment(value,{sourceTokens,targetTokens,minCoverage=0}={}){
  if(!Array.isArray(sourceTokens)||!Array.isArray(targetTokens))fail('Token arrays are required');
  if(!Number.isFinite(minCoverage)||minCoverage<0||minCoverage>1)fail('Invalid coverage threshold');
  if(!object(value)||Object.keys(value).length!==1||!own(value,'groups')||!Array.isArray(value.groups)||value.groups.length>10000)fail('Invalid alignment response');
  const used={source:new Set(),target:new Set()};
  const groups=value.groups.map((group,groupIndex)=>{
    if(!object(group)||Object.keys(group).some(key=>key!=='source'&&key!=='target')||!Array.isArray(group.source)||!Array.isArray(group.target)||!group.source.length||!group.target.length)fail('Invalid alignment group '+groupIndex);
    const result={};
    for(const side of ['source','target']){
      const limit=side==='source'?sourceTokens.length:targetTokens.length,indices=group[side];
      if(indices.length>64||indices.some(index=>!integer(index,limit)||used[side].has(index)))fail('Invalid or reused '+side+' token in group '+groupIndex);
      indices.forEach(index=>used[side].add(index));result[side]=Object.freeze([...indices]);
    }
    return Object.freeze(result);
  });
  if((sourceTokens.length&&used.source.size/sourceTokens.length<minCoverage)||(targetTokens.length&&used.target.size/targetTokens.length<minCoverage))fail('Alignment does not meet the requested coverage');
  return Object.freeze({groups:Object.freeze(groups),coverage:Object.freeze({source:used.source.size/Math.max(1,sourceTokens.length),target:used.target.size/Math.max(1,targetTokens.length)})});
}

function palette(value){
  const colors=value===undefined?DEFAULT_PALETTE:value;
  if(!Array.isArray(colors)||!colors.length||colors.length>64||colors.some(color=>typeof color!=='string'||!/^#[0-9a-f]{6}$/iu.test(color)))fail('Palette must contain hex colors');
  return colors;
}

function renderSide(input,tokens,alignment,side,colors){
  const colorList=palette(colors),byToken=new Map();
  alignment.groups.forEach((group,groupIndex)=>group[side].forEach(index=>byToken.set(index,groupIndex)));
  let cursor=0,html='';
  for(const [index,token] of tokens.entries()){
    html+=escapeHtml(input.slice(cursor,token.start));const group=byToken.get(index);
    html+=group===undefined?escapeHtml(token.text):'<span class="sentence-alignment" data-alignment="'+group+'" style="color:'+colorList[group%colorList.length]+'">'+escapeHtml(token.text)+'</span>';
    cursor=token.end;
  }
  return html+escapeHtml(input.slice(cursor));
}

/** Validate both sentences together, then render matching safely escaped color spans. */
export function renderBilingualAlignment({source,target,sourceTokens,targetTokens,alignment,palette:colors}={}){
  const sourceText=text(source),targetText=text(target),left=validateTokenRanges(sourceText,sourceTokens,'source'),right=validateTokenRanges(targetText,targetTokens,'target');
  const verified=validateAlignment(alignment,{sourceTokens:left,targetTokens:right});
  return Object.freeze({alignment:verified,sourceHtml:renderSide(sourceText,left,verified,'source',colors),targetHtml:renderSide(targetText,right,verified,'target',colors)});
}
