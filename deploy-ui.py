"""Back up and install reviewed local UI assets; never alter review records."""
from pathlib import Path
from datetime import datetime
import hashlib,json,os,shutil,subprocess,re
from anki.collection import Collection
from vocabulary import export_vocabulary

ROOT=Path(__file__).parent
from project_config import PROFILE,MODEL,require_existing_collection
require_existing_collection()
running=subprocess.check_output(['tasklist','/FI','IMAGENAME eq anki.exe','/FO','CSV','/NH'],text=True)
if 'anki.exe' in running.lower():raise SystemExit('Close Anki before installing.')
backup=ROOT/'ui-backups'/datetime.now().strftime('%Y%m%d-%H%M%S')
backup.mkdir(parents=True)
for name in ('deck-settings.json','deck-memory.json','deck-automatic-memory.json'):
    if (ROOT/name).exists():shutil.copy2(ROOT/name,backup/name)
col=Collection(str(PROFILE/'collection.anki2'))
try:
    col.create_backup(backup_folder=str(backup),force=True,wait_for_completion=True)
    def digest(table):
        return hashlib.sha256(repr(col.db.all('select * from '+table+' order by id')).encode()).hexdigest()
    before={t:digest(t) for t in ('notes','cards','revlog')}
    model=col.models.by_name(MODEL)
    assert model and all('id="ru-tutor"' in t[s] for t in model['tmpls'] for s in ('qfmt','afmt'))
    media=Path(col.media.dir())
    assets={}
    for src,dst in [('card-client.js','_ru-tutor.js'),('card-style.css','_ru-tutor.css')]:
        if (media/dst).exists():shutil.copy2(media/dst,backup/dst)
        shutil.copy2(ROOT/src,media/dst)
        assert (ROOT/src).read_bytes()==(media/dst).read_bytes()
        version=hashlib.sha256((ROOT/src).read_bytes()).hexdigest()[:12]
        extension=Path(dst).suffix
        versioned=f'_ru-tutor-{version}{extension}'
        shutil.copy2(ROOT/src,media/versioned)
        assets[extension]=versioned
    for template in model['tmpls']:
        for side in ('qfmt','afmt'):
            for extension,filename in assets.items():
                pattern=r'_ru-tutor(?:-[a-f0-9]{12})?'+re.escape(extension)+r'(?=["\'])'
                template[side],count=re.subn(pattern,filename,template[side])
                assert count==1,(template['name'],side,extension,count)
    col.models.update_dict(model)
    vocab=export_vocabulary(col)
    os.utime(media,None)
    assert all(digest(t)==d for t,d in before.items())
    assert col.db.scalar('pragma integrity_check')=='ok'
    report={'installed':'Client v7 vocabulary chat, audio, word lookup/history and translation tooltips','assets':assets,'vocabulary':vocab,'backup':str(backup),'notes_schedules_history':'unchanged'}
    (ROOT/'ui-install-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))
finally:col.close()
