"""Install synchronized tutor UI into Russian Core 5000 using Anki's API."""
from pathlib import Path
import hashlib
import re
import sys
from anki.collection import Collection

sys.stdout.reconfigure(encoding='utf-8')
from project_config import ROOT,COLLECTION,MODEL,require_anki_closed,require_existing_collection
require_anki_closed();require_existing_collection()
live=COLLECTION
col=Collection(str(live))
try:
    def fingerprint(table):
        return hashlib.sha256(repr(col.db.all('select * from '+table+' order by id')).encode()).hexdigest()
    before={t:fingerprint(t) for t in ('cards','revlog','notes')}
    model=col.models.by_name(MODEL)
    if not model:raise RuntimeError('Configured note type was not found')
    required={'Index','Word','Translation'}|{f'Sentence {i}'+suffix for i in range(1,5) for suffix in ('',' Translation')}
    if not required.issubset({f['name'] for f in model['flds']}):raise RuntimeError('This prototype requires Russian Core 5000-compatible fields')
    backup=ROOT/'ui-backups';backup.mkdir(exist_ok=True)
    col.create_backup(backup_folder=str(backup),force=True,wait_for_completion=True)
    for template in model['tmpls']:
        for side in ('qfmt','afmt'):
            value=template[side]
            if 'id="ru-tutor"' in value:
                continue
            for i in range(1,5):
                value=value.replace('{{Sentence '+str(i)+'}}',f'<span class="ru-sentence-source" data-pair="{i}">'+ '{{Sentence '+str(i)+'}}'+'</span>')
                value=value.replace('{{Sentence '+str(i)+' Translation}}',f'<span class="ru-sentence-english" data-pair="{i}">'+ '{{Sentence '+str(i)+' Translation}}'+'</span>')
            if side=='afmt':
                value=value.replace('{{Translation}}','<span class="ru-headword">{{Translation}}</span>')
            phase='question' if side=='qfmt' else 'answer'
            context='''<div class="ru-tutor-context" hidden>
<span data-index>{{Index}}</span><span data-word>{{Word}}</span><span data-translation>{{Translation}}</span>
<div data-russian>{{Sentence 1}}\n{{Sentence 2}}\n{{Sentence 3}}\n{{Sentence 4}}</div>
<div data-english>{{Sentence 1 Translation}}\n{{Sentence 2 Translation}}\n{{Sentence 3 Translation}}\n{{Sentence 4 Translation}}</div>
</div>'''
            value+='\n<link rel="stylesheet" href="_ru-tutor.css">\n<div id="ru-tutor" data-phase="'+phase+'">'+context+'</div>\n<script src="_ru-tutor-config.js"></script>\n<script src="_ru-tutor.js"></script>\n'
            template[side]=value
    col.models.update_dict(model)
    for table,digest in before.items():
        assert fingerprint(table)==digest, table+' unexpectedly changed'
    assert col.db.scalar('pragma integrity_check')=='ok'
    print('Installed tutor panel on both sides of both card types; notes, schedules and history unchanged.')
    # Browser fixture with media references, generated from Anki's real renderer.
    card=col.get_card(col.db.scalar('select id from cards order by id limit 1'))
    for side,markup in [('question',card.question()),('answer',card.answer())]:
        markup=re.sub(r'\[anki:play:[^\]]+\]','<span aria-label="Play audio">▶</span>',markup)
        markup=markup.replace('src="_ru-tutor.js"','src="card-client.js"').replace('href="_ru-tutor.css"','href="card-style.css"').replace('src="_ru-tutor-config.js"','src="card-config.js"')
        page='<!doctype html><html class="mobile"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body class="card">'+markup+'</body></html>'
        (Path(__file__).parent/('preview-'+side+'.html')).write_text(page,encoding='utf-8')
finally:
    col.close()
