"""Machine-local configuration; no account credentials belong in this project."""
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ANKI_BASE = Path(os.environ.get('ANKI_BASE', str(Path(os.environ.get('APPDATA',str(Path.home()/'AppData'/'Roaming')))/'Anki2'))).expanduser().resolve()
PROFILE_NAME = os.environ.get('ANKI_PROFILE', 'User 1')
if Path(PROFILE_NAME).name != PROFILE_NAME or PROFILE_NAME in ('.','..'):
    raise ValueError('ANKI_PROFILE must be a single profile name')
PROFILE = ANKI_BASE / PROFILE_NAME
COLLECTION = PROFILE / 'collection.anki2'
MODEL = os.environ.get('ANKI_NOTE_TYPE', 'Russian Core 5000')
DECK = os.environ.get('ANKI_DECK', 'Russian Core 5000')

def require_anki_closed():
    if os.name == 'nt':
        processes = subprocess.check_output(['tasklist','/FI','IMAGENAME eq anki.exe','/FO','CSV','/NH'],text=True)
        if 'anki.exe' in processes.lower():raise RuntimeError('Close Anki before modifying or syncing the collection.')

def require_existing_collection():
    if not COLLECTION.is_file():raise FileNotFoundError('Check ANKI_BASE and ANKI_PROFILE: '+str(COLLECTION))
