"""All collections are synthetic temp fixtures; verifies a live WAL writer too."""
import importlib.util
import sqlite3
import tempfile
from pathlib import Path
from contextlib import closing
from anki.collection import Collection

spec = importlib.util.spec_from_file_location('exporter', Path(__file__).with_name('export-upcoming-colors.py'))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)

with tempfile.TemporaryDirectory(prefix='anki-color-export-test-') as scratch:
    root = Path(scratch)
    source, copy = root / 'collection.anki2', root / 'snapshot.anki2'
    col = Collection(str(source))
    model = col.models.new('Color test')
    for name in ['Word', 'Sentence 1', 'Sentence 1 Translation']:
        col.models.add_field(model, col.models.new_field(name))
    template = col.models.new_template('Forward')
    template['qfmt'], template['afmt'] = '{{Word}}', '{{Sentence 1}}'
    col.models.add_template(model, template)
    col.models.add(model)
    did = col.decks.id('Color test')
    for label, queue, due in [('future', 2, col.sched.today+5), ('new', 0, 1),
                              ('inactive', -1, 0), ('due', 2, col.sched.today-1)]:
        note = col.new_note(model)
        note['Word'], note['Sentence 1'], note['Sentence 1 Translation'] = label, 'Тест слова', 'Test word'
        col.add_note(note, did)
        card = note.cards()[0]
        card.queue, card.type, card.due = queue, (0 if queue == 0 else 2), due
        col.update_card(card)
    # Duplicate meaning pair in another note must produce one provider task.
    note = col.new_note(model)
    note['Word'], note['Sentence 1'], note['Sentence 1 Translation'] = 'due', 'Тест слова', 'Test word'
    col.add_note(note, did)
    col.close()
    before = source.read_bytes()
    exporter.snapshot(source, copy)
    assert source.read_bytes() == before
    copied = Collection(str(copy))
    try:
        items, report = exporter.export_pairs(copied, 'Color test')
        assert [x['priority'] for x in items] == ['due', 'new', 'future', 'inactive'], items
        assert report['totalPairSlots'] == 5 and len(items) == 4
        assert items[0]['occurrences'] == 2
        cached = {items[0]['key']: {'groups': [{'ru': [0], 'en': [0]}]}}
        limited, _ = exporter.export_pairs(copied, 'Color test', cached, 1)
        assert len(limited) == 1 and limited[0]['priority'] == 'new'
    finally:
        copied.close()

    # Independent open SQLite WAL writer: committed data copied, uncommitted data excluded.
    wal_source = root / 'wal.db'
    with closing(sqlite3.connect(wal_source)) as writer:
        writer.execute('PRAGMA journal_mode=WAL')
        writer.execute('CREATE TABLE data (value TEXT)')
        writer.execute("INSERT INTO data VALUES ('committed')")
        writer.commit()
        writer.execute("INSERT INTO data VALUES ('uncommitted')")
        exporter.snapshot(wal_source, root / 'wal-copy.db')
        with closing(sqlite3.connect(root / 'wal-copy.db')) as reader:
            assert reader.execute('SELECT value FROM data').fetchall() == [('committed',)]
        writer.rollback()
    exporter.atomic_json(root / 'queue.json', items)
    original = (root / 'queue.json').read_bytes()
    archive = exporter.archive_queue(root / 'queue.json')
    exporter.atomic_json(root / 'queue.json', [])
    assert Path(archive).read_bytes() == original
    assert not list(root.glob('*.tmp'))
print('PASS: synthetic whole-deck priorities, future/inactive inclusion, dedupe, cache skip, unchanged source, WAL snapshot, atomic export. No live collection accessed.')
