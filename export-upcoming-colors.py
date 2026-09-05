"""Whole-deck read-only snapshot export: due, new, future, then inactive cards.

Without a limit, includes cached pairs for complete progress accounting; workers
skip them. A positional limit keeps the old upcoming/uncached-only invocation.
"""
import argparse
import hashlib
import json
import os
import sqlite3
import tempfile
import time
from datetime import datetime, timezone
from contextlib import closing
from pathlib import Path
from anki.collection import Collection
from persist_colors import ROOT, cache_key, load_cache, soup, tokenize, validate

from project_config import COLLECTION,DECK
DEFAULT_COLLECTION = COLLECTION


def atomic_json(path, value):
    path = Path(path)
    fd, name = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(value, out, ensure_ascii=False, indent=2)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def snapshot(source, destination, timeout=20):
    """Include committed WAL pages without opening Anki on the live database."""
    deadline = time.monotonic() + timeout

    def progress(*_):
        if time.monotonic() >= deadline:
            raise TimeoutError('Collection snapshot timed out; retry when Anki is idle.')

    with closing(sqlite3.connect(Path(source).resolve().as_uri() + '?mode=ro', uri=True,
                                 timeout=min(timeout, 1))) as src:
        src.execute('PRAGMA query_only=ON')
        with closing(sqlite3.connect(destination)) as dst:
            src.backup(dst, pages=256, progress=progress, sleep=0.05)


def archive_queue(path):
    """Preserve exact bytes (including a reviewed queue's pinned SHA) before export."""
    if not path.exists():
        return None
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    folder = path.parent / 'color-queue-backups'
    folder.mkdir(exist_ok=True)
    archive = folder / (path.stem + '.' + digest + '.json')
    if archive.exists():
        if archive.read_bytes() != raw:
            raise RuntimeError('Queue archive mismatch; refusing overwrite')
    else:
        # Exact-byte archival, atomically installed before the queue replacement.
        fd, name = tempfile.mkstemp(prefix='queue-', suffix='.tmp', dir=folder)
        try:
            with os.fdopen(fd, 'wb') as out:
                out.write(raw)
                out.flush()
                os.fsync(out.fileno())
            os.replace(name, archive)
        finally:
            if os.path.exists(name):
                os.unlink(name)
    return str(archive)


def export_pairs(col, deck, cache=None, limit=None):
    cache = cache or {}
    query = 'deck:' + json.dumps(deck, ensure_ascii=False)
    buckets = [('due', query + ' is:due'),
               ('new', query + ' is:new -is:suspended -is:buried'),
               ('future', query + ' -is:new -is:suspended -is:buried'),
               ('inactive', query)]
    seen_notes, by_key, result = set(), {}, []
    total_pairs = 0
    for priority, search in buckets:
        for cid in col.find_cards(search, order='c.due, c.id'):
            card = col.get_card(cid)
            if card.nid in seen_notes:
                continue
            seen_notes.add(card.nid)
            note = col.get_note(card.nid)
            if 'Word' not in note:
                continue
            word = soup(note['Word']).get_text().strip()
            for i in range(1, 5):
                rf, ef = f'Sentence {i}', f'Sentence {i} Translation'
                if rf not in note or ef not in note:
                    continue
                ru, en = tokenize(soup(note[rf]).get_text()), tokenize(soup(note[ef]).get_text())
                if not ru or not en:
                    continue
                total_pairs += 1
                key = cache_key(ru, en, word)
                if key in by_key:
                    by_key[key]['occurrences'] += 1
                    continue
                cached = cache.get(key)
                if limit is not None and isinstance(cached, dict) and validate(cached.get('groups'), ru, en):
                    continue
                item = {'nid':card.nid, 'pair':i, 'word':word, 'ru':[x[0] for x in ru],
                        'en':[x[0] for x in en], 'key':key, 'priority':priority, 'occurrences':1}
                by_key[key] = item
                result.append(item)
    selected = result if limit is None else result[:limit]
    return selected, {'notes':len(seen_notes), 'totalPairSlots':total_pairs,
                      'uniquePairsExported':len(selected), 'wholeDeck':limit is None,
                      'priorities':{p:sum(x['priority'] == p for x in selected) for p, _ in buckets}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('limit', nargs='?', type=int)
    parser.add_argument('--collection', type=Path, default=DEFAULT_COLLECTION)
    parser.add_argument('--deck', default=DECK)
    parser.add_argument('--output', type=Path, default=ROOT / 'upcoming-colors.json')
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error('limit must be positive; omit for the whole deck')
    with tempfile.TemporaryDirectory(prefix='anki-color-export-') as scratch:
        copy = Path(scratch) / 'collection.anki2'
        snapshot(args.collection, copy)
        col = Collection(str(copy))
        try:
            pairs, report = export_pairs(col, args.deck, load_cache(), args.limit)
        finally:
            col.close()
    report.update(exportedAt=datetime.now(timezone.utc).isoformat(),
                  source=str(args.collection.resolve()), deck=args.deck)
    report['previousQueueArchive'] = archive_queue(args.output)
    atomic_json(args.output, pairs)
    atomic_json(args.output.with_suffix('.export-report.json'), report)
    print(json.dumps(report))


if __name__ == '__main__':
    main()
