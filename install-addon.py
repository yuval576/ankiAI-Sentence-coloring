"""Install the local pre-sync hook. Run explicitly with desktop Anki closed."""
import json,shutil
from datetime import datetime
from project_config import ROOT,ANKI_BASE,require_anki_closed,require_existing_collection

require_anki_closed();require_existing_collection()
target=ANKI_BASE/'addons21'/'ru_tutor_permanent_colors'
if target.exists():
    backup=ROOT/'ui-backups'/('addon-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
    shutil.copytree(target,backup)
target.mkdir(parents=True,exist_ok=True)
shutil.copy2(ROOT/'addon'/'__init__.py',target/'__init__.py')
(target/'location.json').write_text(json.dumps({'root':str(ROOT)}),encoding='utf-8')
print('Installed the local color/vocabulary sync hook. Keep this repository at its current location.')
