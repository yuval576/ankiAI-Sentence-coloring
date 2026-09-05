"""Offline vocabulary snapshot derived from actual Anki ratings, not AI guesses."""
from pathlib import Path
import json,os,hashlib,unicodedata,re,html
from datetime import datetime,timezone
from persist_colors import soup,tokenize,ROOT,MODEL
INDEX=ROOT/'vocabulary-example-index.json'
INDEX_VERSION=5

def audio_files(value):
    """Local Anki sound filenames only; never URLs or traversal paths."""
    return list(dict.fromkeys(name for name in re.findall(r'\[sound:([^\]\r\n]+)\]',value)
        if name not in ('.','..') and not re.search(r'[/\\:\x00-\x1f]',name)))

def norm(value):
    # Remove stress accents, but preserve the breve in й.
    return unicodedata.normalize('NFC',''.join(c for c in unicodedata.normalize('NFD',value.casefold()) if c not in '\u0300\u0301')).replace('ё','е')

def notes_signature(col,mid):
    return hashlib.sha256(repr(col.db.all('select id,mod,csum from notes where mid=? order by id',mid)).encode()).hexdigest()

def sentence_tokens(html,groups,lemma=None):
    """Export only text and bounded color metadata, never executable note HTML."""
    doc=soup(html);raw=doc.get_text();leading=len(raw)-len(raw.lstrip());text=raw.strip()
    ranges=[];offset=0
    for node in doc.strings:
        color=None;group=None;permanent=False
        for parent in node.parents:
            classes=parent.get('class',[])
            if 'ru-permanent' in classes:
                found=next((re.fullmatch(r'ru-color-(\d+)',c) for c in classes if re.fullmatch(r'ru-color-(\d+)',c)),None)
                if found and 0<=int(found[1])<=11:
                    color=int(found[1]);permanent=True
                    raw_group=parent.get('data-group')
                    if raw_group:group=groups.setdefault(raw_group,len(groups))
                    break
            if 'ru-target' in classes:color=0
        ranges.append((offset,offset+len(node),color,group,permanent));offset+=len(node)
    entries=[];has_saved=False
    for word,a,b in tokenize(text):
        # Browser string offsets are UTF-16, including text preceding emoji.
        entry={'a':len(text[:a].encode('utf-16-le'))//2,'b':len(text[:b].encode('utf-16-le'))//2}
        if lemma:entry['k']=lemma(word)
        for start,end,color,group,permanent in ranges:
            if start<=a+leading and b+leading<=end:
                if color is not None:entry['c']=color
                if group is not None:entry['g']=group
                has_saved=has_saved or permanent
                break
        entries.append(entry)
    return text,entries,has_saved

def build_index(col):
    # Reuse morphology when only saved color markup changes. The native Anki
    # environment need not install the optional dictionary dependency.
    previous=json.loads(INDEX.read_text(encoding='utf-8')) if INDEX.exists() else {}
    morph=None;lemmas=previous.get('lemmas',{});fallback=False
    def lemma(word):
        nonlocal morph,fallback
        word=norm(word)
        if word not in lemmas:
            if morph is None and not fallback:
                try:
                    import pymorphy3
                    morph=pymorphy3.MorphAnalyzer()
                except ImportError:fallback=True
            if morph is None:return word
            lemmas[word]=norm(morph.parse(word)[0].normal_form)
        return lemmas[word]
    model=col.models.by_name(MODEL)
    positions={f['name']:i for i,f in enumerate(model['flds'])}
    examples=[];inverted={};seen={};word_keys={};dictionary=[]
    for nid,flds in col.db.all('select id,flds from notes where mid=? order by id',model['id']):
        fields=flds.split('\x1f');word=soup(fields[positions['Word']]).get_text().strip()
        ts=tokenize(word);word_keys[str(nid)]=[lemma(t[0]) for t in ts]
        dictionary.append({'id':str(nid),'word':word,'translation':soup(fields[positions['Translation']]).get_text().strip(),'keys':sorted(set(word_keys[str(nid)]+[norm(word)])),'rating':0})
        for i in range(1,5):
            groups={}
            ru,rt,ru_saved=sentence_tokens(fields[positions[f'Sentence {i}']],groups,lemma)
            en,et,en_saved=sentence_tokens(fields[positions[f'Sentence {i} Translation']],groups)
            if not ru or not en:continue
            example={'ru':ru,'en':en,'ruTokens':rt,'enTokens':et,'colored':ru_saved and en_saved}
            audio_position=positions.get(f'Audio Sentence {i}')
            example['audio']=audio_files(fields[audio_position]) if audio_position is not None else []
            for ai,name in enumerate(example['audio']):
                decoded=html.unescape(name).replace('\xa0',' ')
                if not (Path(col.media.dir())/name).exists() and audio_files('[sound:'+decoded+']')==[decoded] and (Path(col.media.dir())/decoded).exists():example['audio'][ai]=decoded
            if (ru,en) in seen:
                eid=seen[(ru,en)]
                recordings=list(dict.fromkeys(examples[eid].get('audio',[])+example['audio']))
                if example['colored'] and not examples[eid]['colored']:examples[eid]=example
                examples[eid]['audio']=recordings
                continue
            eid=len(examples);seen[(ru,en)]=eid;examples.append(example)
            keys={lemma(t[0]) for t in tokenize(ru)}|{norm(t[0]) for t in tokenize(ru)}
            for key in keys:inverted.setdefault(key,[]).append(eid)
    for entry in dictionary:
        keys=word_keys[entry['id']]
        if len(keys)==1:entry['examples']=sorted(set(inverted.get(keys[0],[])+inverted.get(norm(entry['word']),[])))
        else:entry['examples']=[i for i,e in enumerate(examples) if norm(entry['word']) in norm(e['ru'])]
    data={'version':INDEX_VERSION,'notesSignature':notes_signature(col,model['id']),'examples':examples,'index':inverted,'wordKeys':word_keys,'lemmas':lemmas,'dictionary':dictionary,'morphologyFallback':fallback}
    INDEX.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(f'Indexed {len(examples)} unique sentence/translation pairs with inflected-word matching.',flush=True)
    return data

def export_vocabulary(col,rebuild=False):
    model=col.models.by_name(MODEL)
    if model is None:return {'reviewedWords':0}
    idx=json.loads(INDEX.read_text(encoding='utf-8')) if INDEX.exists() else {}
    if rebuild or idx.get('version')!=INDEX_VERSION or idx.get('notesSignature')!=notes_signature(col,model['id']):idx=build_index(col)
    positions={f['name']:i for i,f in enumerate(model['flds'])}
    # Latest genuine answer across either card direction. Exclude manual/reschedule entries.
    records=col.db.all('''select n.id,n.flds,r.id,r.ease from revlog r
        join cards c on c.id=r.cid join notes n on n.id=c.nid
        where n.mid=? and r.ease between 1 and 4 and r.type in (0,1,2,3)
        order by r.id desc''',model['id'])
    words=[];seen=set();counts={str(i):0 for i in range(1,5)}
    for nid,flds,last_review,rating in records:
        if nid in seen:continue
        seen.add(nid);fields=flds.split('\x1f')
        word=soup(fields[positions['Word']]).get_text().strip()
        translation=soup(fields[positions['Translation']]).get_text().strip()
        keys=idx['wordKeys'].get(str(nid),[norm(word)])
        ids=set()
        if len(keys)==1:
            ids.update(idx['index'].get(keys[0],[]));ids.update(idx['index'].get(norm(word),[]))
        else:
            phrase=norm(word)
            ids.update(i for i,e in enumerate(idx['examples']) if phrase in norm(e['ru']))
        words.append({'id':str(nid),'word':word,'translation':translation,'rating':rating,'lastReview':last_review,'examples':sorted(ids),'keys':sorted(set(keys+[norm(word)]))})
        counts[str(rating)]+=1
    example_json=json.dumps(idx['examples'],ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
    dictionary_json=json.dumps({'words':idx['dictionary'],'forms':idx['lemmas']},ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
    example_version=hashlib.sha256((example_json+dictionary_json).encode()).hexdigest()[:16]
    result={'updatedAt':datetime.now(timezone.utc).isoformat(),'examplesVersion':example_version,'totalWords':col.db.scalar('select count(*) from notes where mid=?',model['id']),
        'reviewedWords':len(words),'counts':counts,'words':words}
    media=Path(col.media.dir());file=media/'_ru-vocabulary.js'
    content='window.RuVocabulary = '+json.dumps(result,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')+';\n'
    # Keep ratings changes quick; the expensive morphological index is built separately.
    file.write_text(content,encoding='utf-8');os.utime(media,None)
    example_file=media/'_ru-vocab-examples.js'
    example_content='window.RuVocabularyExamples = '+example_json+';\nwindow.RuVocabularyExamplesVersion = '+json.dumps(example_version)+';\nwindow.RuVocabularyDictionary = '+dictionary_json+';\n'
    if not example_file.exists() or example_file.read_text(encoding='utf-8')!=example_content:
        example_file.write_text(example_content,encoding='utf-8');os.utime(media,None)
    (ROOT/'vocabulary-report.json').write_text(json.dumps({k:v for k,v in result.items() if k not in ('words','examples')},indent=2),encoding='utf-8')
    return {'reviewedWords':len(words),'counts':counts,'examplePairs':len(idx['examples'])}

if __name__=='__main__':
    from anki.collection import Collection
    from project_config import COLLECTION,require_anki_closed,require_existing_collection
    require_anki_closed();require_existing_collection()
    col=Collection(str(COLLECTION))
    try:print(export_vocabulary(col,rebuild=True))
    finally:col.close()
