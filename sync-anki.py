"""Regular two-way AnkiWeb sync using the existing profile's native credentials.
Never selects a full upload/download automatically; never prints credentials.
"""
from pathlib import Path
import sys,time,os
from aqt.profiles import ProfileManager
from anki.collection import Collection
from anki.lang import set_lang
from persist_colors import persist
from vocabulary import export_vocabulary
sys.stdout.reconfigure(encoding='utf-8')
set_lang('en_US')
from project_config import ANKI_BASE,PROFILE_NAME,COLLECTION,require_anki_closed,require_existing_collection
require_anki_closed();require_existing_collection()
pm=ProfileManager(ANKI_BASE)
pm.setupMeta()
pm.load(PROFILE_NAME)
auth=pm.sync_auth()
if not auth:
    raise RuntimeError('Anki profile is not signed in; sync in the app first.')
col=Collection(str(COLLECTION))
try:
    print('Permanent card colors:',persist(col),flush=True)
    print('Vocabulary:',export_vocabulary(col),flush=True)
    # Include helper assets overwritten in-place since the previous sync.
    os.utime(col.media.dir(),None)
    result=col.sync_collection(auth,sync_media=True)
    print('Collection sync status:',result.required,flush=True)
    if result.required != result.NO_CHANGES:
        raise RuntimeError('A full-sync choice is required; no full upload or download was performed.')
    pm.set_host_number(result.host_number)
    if result.new_endpoint:
        pm.set_current_sync_url(result.new_endpoint)
    pm.save()
    deadline=time.time()+1800
    last_report=0
    while True:
        media=col.media_sync_status()
        if time.time()-last_report>15:
            print('Media sync progress:', str(media), flush=True)
            last_report=time.time()
        if not media.active:
            print('Media sync complete.',flush=True)
            break
        if time.time()>deadline:
            raise RuntimeError('Media sync is still running; finish syncing in Anki.')
        time.sleep(1)
    # The incoming collection can contain newer iPhone answers. Publish that
    # refreshed vocabulary snapshot after the initial collection/media sync.
    print('Refreshed vocabulary:',export_vocabulary(col),flush=True)
    col.sync_media(auth)
    while col.media_sync_status().active:
        if time.time()>deadline:raise RuntimeError('Vocabulary media sync is still running.')
        time.sleep(1)
    print('AnkiWeb synchronized successfully.',flush=True)
finally:
    col.close()
    pm.db.close()
