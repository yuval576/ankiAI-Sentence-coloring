"""Personal PC integration: save cached tutor colors before normal Anki sync."""
from pathlib import Path
import importlib.util
import sys
from aqt import mw,gui_hooks
from aqt.utils import tooltip

import json
ROOT=Path(json.loads((Path(__file__).parent/'location.json').read_text(encoding='utf-8'))['root'])
if str(ROOT) not in sys.path:sys.path.insert(0,str(ROOT))
from vocabulary import export_vocabulary
spec=importlib.util.spec_from_file_location('ru_tutor_persist_colors',ROOT/'persist_colors.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def save_colors():
    if mw.col is None: return
    result=module.persist(mw.col)
    export_vocabulary(mw.col)
    if result.get('new_pairs'):
        tooltip(f"Saved {result['new_pairs']} sentence color matches into your cards.")

gui_hooks.sync_will_start.append(save_colors)

def refresh_vocabulary(*args):
    if mw.col is not None:export_vocabulary(mw.col)

gui_hooks.reviewer_did_answer_card.append(refresh_vocabulary)
gui_hooks.profile_did_open.append(refresh_vocabulary)
_vocabulary_upload_pending=False

def after_collection_sync():
    global _vocabulary_upload_pending
    if mw.col is None:return
    refresh_vocabulary()
    # Incoming iPhone ratings arrive after the pre-sync snapshot was written.
    # Upload the refreshed file once the current media transfer is finished.
    if mw.media_syncer.is_syncing():
        _vocabulary_upload_pending=True
    else:
        mw.media_syncer.start()

def after_media_sync(running):
    global _vocabulary_upload_pending
    if not running and _vocabulary_upload_pending:
        _vocabulary_upload_pending=False
        if mw.col is not None:mw.media_syncer.start()

gui_hooks.sync_did_finish.append(after_collection_sync)
gui_hooks.media_sync_did_start_or_stop.append(after_media_sync)
