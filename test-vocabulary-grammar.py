"""Isolated export integration: no live collection, sync, or provider calls."""
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
import vocabulary

names=['Word','Translation']+[name for i in range(1,5) for name in (f'Sentence {i}',f'Sentence {i} Translation',f'Audio Sentence {i}')]
fields=['читать','read','Я читаю книгу.','I read a book.','']+['']*9
class DB:
    def all(self,query,*args):
        if 'id,mod,csum' in query:return [(1,1,1)]
        if 'revlog' in query:return [(1,'\x1f'.join(fields),1000,3)]
        return [(1,'\x1f'.join(fields))]
    def scalar(self,*args):return 1
class Models:
    def by_name(self,name):return {'id':1,'flds':[{'name':n} for n in names]}
class Media:
    def __init__(self,path):self.path=path
    def dir(self):return str(self.path)
class Collection:
    db=DB();models=Models()
    def __init__(self,path):self.media=Media(path)

with tempfile.TemporaryDirectory(prefix='anki-grammar-test-') as folder:
    path=Path(folder)
    with patch.object(vocabulary,'ROOT',path),patch.object(vocabulary,'INDEX',path/'index.json'):
        col=Collection(path)
        index=vocabulary.build_index(col)
        details=index['dictionary'][0]['verbDetails']
        assert details['forms']['present']['1sg']=='читаю'
        assert details['conjugation']=='I'
        # Native Anki can reuse the exported cache without pymorphy3 installed.
        with patch.dict('sys.modules',{'pymorphy3':None}):
            second=vocabulary.build_index(col)
            assert second['dictionary'][0]['verbDetails']==details
        result=vocabulary.export_vocabulary(col)
        assert result['reviewedWords']==1
        exported=(path/'_ru-vocab-examples.js').read_text(encoding='utf-8')
        assert '"verbDetails"' in exported and 'читаю' in exported
print('PASS: verb details exported offline, cached across native syncs, review counts preserved.')
