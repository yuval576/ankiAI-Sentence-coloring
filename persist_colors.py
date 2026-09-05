"""Persist validated cached bilingual alignments in Anki note HTML via Anki's API.

No model calls, collection SQL writes, scheduling changes, or schema changes.
Used by the PC sync hook and by the task's sync script.
"""
from pathlib import Path
import hashlib
import json
import re
import unicodedata
from bs4 import BeautifulSoup, NavigableString

ROOT=Path(__file__).resolve().parent
CACHE=ROOT/'alignment-cache.json'
BATCH_CACHE=ROOT/'batch-alignment-cache.json'
REPORT=ROOT/'permanent-colors-report.json'
BACKUPS=ROOT/'color-backups'
from project_config import MODEL,COLLECTION,require_anki_closed,require_existing_collection

def load_cache():
    result={}
    for file in (BATCH_CACHE,CACHE,ROOT/'alignment-overrides.json'):
        if file.exists():result.update(json.loads(file.read_text(encoding='utf-8')))
    return result

def soup(value):
    return BeautifulSoup(value,'html.parser')

def tokenize(value):
    # Same Unicode categories and internal hyphens/apostrophes as the card JS.
    def word(c): return unicodedata.category(c)[0] in 'LMN'
    result=[]
    i=0
    while i<len(value):
        if not word(value[i]): i+=1; continue
        start=i; i+=1
        while i<len(value):
            if word(value[i]): i+=1
            elif value[i] in "-’'" and i+1<len(value) and word(value[i+1]): i+=2
            else: break
        result.append((value[start:i],start,i))
    return result

def cache_key(ru,en,word):
    data={'ru':[t[0] for t in ru],'en':[t[0] for t in en],'word':word}
    return hashlib.sha256(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def validate(groups,ru,en):
    if not isinstance(groups,list) or not groups or len(groups)>100: return False
    seen={'ru':set(),'en':set()}
    for group in groups:
        if not isinstance(group,dict): return False
        for side,ts in [('ru',ru),('en',en)]:
            indices=group.get(side)
            if not isinstance(indices,list) or not indices: return False
            for i in indices:
                if type(i) is not int or i<0 or i>=len(ts) or i in seen[side]: return False
                seen[side].add(i)
    return True

def paint(doc,ts,mapping,other,key,content_id):
    offset=0;painted=set()
    for node in list(doc.strings):
        start=offset; offset+=len(str(node))
        matches=[(i,t) for i,t in enumerate(ts) if i in mapping and t[1]>=start and t[2]<=offset]
        if not matches: continue
        cursor=0
        for i,(_,a,b) in matches:
            a-=start; b-=start
            node.insert_before(NavigableString(str(node)[cursor:a]))
            color,gid,opposite=mapping[i]
            span=doc.new_tag('span')
            span['class']=['ru-aligned','ru-permanent',f'ru-color-{color}']
            span['data-group']=gid
            span['data-alignment']=key
            span['data-alignment-content']=content_id
            span['title']=' '.join(other[j][0] for j in opposite)
            span.string=str(node)[a:b]
            node.insert_before(span); cursor=b;painted.add(i)
        node.insert_before(NavigableString(str(node)[cursor:])); node.extract()
    return painted==set(mapping)

def prepare_pair(ru_html,en_html,word,gid_prefix,cache):
    # Never split Anki's text-based audio/control references with HTML spans.
    if re.search(r'\[(?:sound:|anki:play:)',ru_html+en_html,re.I):return None,'invalid'
    ru=soup(ru_html); en=soup(en_html)
    ru_text=ru.get_text(); en_text=en.get_text()
    rt=tokenize(ru_text); et=tokenize(en_text)
    if not rt or not et: return None,'empty'
    key=cache_key(rt,et,word)
    data=cache.get(key)
    content_id=hashlib.sha256(json.dumps(data,sort_keys=True,separators=(',',':')).encode()).hexdigest() if isinstance(data,dict) else None
    existing=ru.select('.ru-permanent')+en.select('.ru-permanent')
    if existing and all(s.get('data-alignment')==key for s in existing) and (data is None or all(s.get('data-alignment-content')==content_id for s in existing)): return None,'saved'
    if not isinstance(data,dict): return None,'pending'
    groups=data.get('groups')
    if not validate(groups,rt,et): return None,'invalid'
    for doc in (ru,en):
        for span in doc.select('.ru-permanent'): span.unwrap()
    targets=set(); offset=0
    for node in ru.strings:
        if any('ru-target' in parent.get('class',[]) for parent in node.parents):
            targets.update(i for i,t in enumerate(rt) if t[1]>=offset and t[2]<=offset+len(node))
        offset+=len(node)
    rm={}; em={}; next_color=1
    for i,g in enumerate(groups):
        if any(j in targets for j in g['ru']): color=0
        else: color=1+(next_color-1)%11; next_color+=1
        gid=f'{gid_prefix}-{i}'
        for j in g['ru']: rm[j]=(color,gid,g['en'])
        for j in g['en']: em[j]=(color,gid,g['ru'])
    if not paint(ru,rt,rm,et,key,content_id) or not paint(en,et,em,rt,key,content_id):return None,'invalid'
    assert ru.get_text()==ru_text and en.get_text()==en_text
    return (str(ru),str(en)),'new'

def install_styles(col,model):
    original=json.dumps(model,sort_keys=True)
    marker='/* PERMANENT RUSSIAN COLORS v1 */'
    if marker not in model['css']:
        palette=(ROOT/'card-style.css').read_text(encoding='utf-8')
        start=palette.index('.ru-aligned {')
        palette=palette[start:palette.index('@media(max-width:600px)',start)]
        model['css']+='\n'+marker+'\n'+palette+'''\n
.ru-sentence-source[data-ru-phase="question"] .ru-permanent,
.ru-sentence-english[data-ru-phase="question"] .ru-permanent {color:inherit !important;border-bottom:0;}
'''
    for template in model['tmpls']:
        for side in ('qfmt','afmt'):
            phase='question' if side=='qfmt' else 'answer'
            for cls in ('ru-sentence-source','ru-sentence-english'):
                pattern=r'(<span class="'+cls+r'" data-pair="\d+")(?! data-ru-phase)'
                template[side]=re.sub(pattern,r'\1 data-ru-phase="'+phase+'"',template[side])
    if '/* Hide answer tooltips on questions */' not in model['css']:
        model['css']+='''\n/* Hide answer tooltips on questions */
.ru-sentence-source[data-ru-phase="question"] .ru-permanent,
.ru-sentence-english[data-ru-phase="question"] .ru-permanent {pointer-events:none;}
'''
    if json.dumps(model,sort_keys=True)!=original:
        col.models.update_dict(model)
        return True
    return False

def persist(col,force=False):
    cache=load_cache()
    if not cache:return {'saved_pairs':0}
    digest=hashlib.sha256(json.dumps(cache,sort_keys=True).encode()).hexdigest()
    model=col.models.by_name(MODEL)
    if model is None: return {'saved_pairs':0,'reason':'Different profile/deck'}
    report={'cache_entries':len(cache),'new_pairs':0,'saved_pairs':0,'pending_pairs':0,'invalid_pairs':0,'updated_notes':0}
    before={t:hashlib.sha256(repr(col.db.all('select * from '+t+' order by id')).encode()).hexdigest() for t in ('cards','revlog')}
    changed=[]
    for nid in col.find_notes('note:"'+MODEL+'"'):
        note=col.get_note(nid); dirty=False
        word=soup(note['Word']).get_text().strip()
        for i in range(1,5):
            rf=f'Sentence {i}'; ef=rf+' Translation'
            result,status=prepare_pair(note[rf],note[ef],word,f'{nid}-{i}',cache)
            if status=='new':
                note[rf],note[ef]=result; dirty=True; report['new_pairs']+=1; report['saved_pairs']+=1
            elif status=='saved': report['saved_pairs']+=1
            elif status=='pending': report['pending_pairs']+=1
            elif status=='invalid': report['invalid_pairs']+=1
        if dirty: changed.append(note)
    # Backup is made before either note or template mutation, not after.
    if changed or '/* PERMANENT RUSSIAN COLORS v1 */' not in model['css']:
        BACKUPS.mkdir(exist_ok=True)
        col.create_backup(backup_folder=str(BACKUPS),force=True,wait_for_completion=True)
    report['styles_updated']=install_styles(col,model)
    if changed: col.update_notes(changed)
    report['updated_notes']=len(changed)
    for table,value in before.items():
        assert hashlib.sha256(repr(col.db.all('select * from '+table+' order by id')).encode()).hexdigest()==value,table+' changed'
    assert col.db.scalar('pragma integrity_check')=='ok'
    report['cache_digest']=digest
    REPORT.write_text(json.dumps(report,indent=2),encoding='utf-8')
    return report

if __name__=='__main__':
    from anki.collection import Collection
    require_anki_closed();require_existing_collection()
    col=Collection(str(COLLECTION))
    try: print(json.dumps(persist(col),indent=2))
    finally: col.close()
