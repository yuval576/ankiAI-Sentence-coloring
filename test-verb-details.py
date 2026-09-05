"""Run with the task Python; no Anki, network, or provider access."""
import json
import unittest

import pymorphy3
from verb_details import build_verb_details, EXCLUDE, PERSONS


class VerbDetailsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.morph = pymorphy3.MorphAnalyzer()

    def details(self, word):
        return build_verb_details(word, self.morph)

    def test_requested_paradigms(self):
        expected = {
            'читать': ('I', 'читаю', 'читал', 'читай'),
            'говорить': ('II', 'говорю', 'говорил', 'говори'),
            'хотеть': ('mixed', 'хочу', 'хотел', 'хоти'),
            'бежать': ('mixed', 'бегу', 'бежал', 'беги'),
            'дать': ('special', 'дам', 'дал', 'дай'),
            'есть': ('special', 'ем', 'ел', 'ешь'),
            'быть': ('special', 'буду', 'был', 'будь'),
            'идти': ('I', 'иду', 'шёл', 'иди'),
            'сделать': ('I', 'сделаю', 'сделал', 'сделай'),
            'учиться': ('II', 'учусь', 'учился', 'учись'),
        }
        for word, (group, first, past, imperative) in expected.items():
            with self.subTest(word=word):
                d = self.details(word)
                self.assertEqual(d['conjugation'], group)
                table = 'future' if word in {'дать', 'сделать', 'быть'} else 'present'
                self.assertEqual(d['forms'][table]['1sg'], first)
                self.assertEqual(d['forms']['past']['m'], past)
                self.assertEqual(d['forms']['imperative']['sg'], imperative)
                self.assertEqual(set(d['forms']['future']), set(PERSONS))
                self.assertEqual(len(d['forms']['past']), 4)
                self.assertLess(len(json.dumps(d, ensure_ascii=False).encode()), 4096)
                self.assertEqual(json.loads(json.dumps(d)), d)

    def test_complete_tables(self):
        d = self.details('читать')['forms']
        self.assertEqual(list(d['present'].values()), 'читаю читаешь читает читаем читаете читают'.split())
        self.assertEqual(list(d['past'].values()), 'читал читала читало читали'.split())
        self.assertEqual(list(d['future'].values()), ['буду читать', 'будешь читать', 'будет читать', 'будем читать', 'будете читать', 'будут читать'])
        self.assertEqual(d['imperative'], {'sg': 'читай', 'pl': 'читайте'})
        self.assertIsNone(self.details('сделать')['forms']['present'])
        self.assertEqual(self.details('быть')['forms']['future']['1sg'], 'буду')

    def test_reflexive_and_stress(self):
        d = self.details('УЧИ́ТЬСЯ')
        self.assertEqual(d['lemma'], 'учиться')
        self.assertTrue(d['reflexive'])
        self.assertEqual(d['forms']['future']['1sg'], 'буду учиться')
        for table in d['forms'].values():
            self.assertTrue(all(v.endswith(('ся', 'сь')) for v in table.values() if v))
        self.assertIn('no stress accents', d['stress'])
        self.assertEqual(self.details('идти')['forms']['present']['2sg'], 'идёшь')

    def test_ambiguity(self):
        d = self.details('есть')
        self.assertEqual(d['lemma'], 'есть')
        self.assertTrue(d['ambiguous'])
        self.assertTrue(any(r['lemma'] == 'быть' for r in d['readings']))
        d = self.details('бежать')
        self.assertTrue(d['ambiguous'])
        self.assertEqual(d['aspect'], 'imperfective')
        self.assertEqual(d['forms']['future']['1sg'], 'буду бежать')
        self.assertEqual(self.details('говорю')['lemma'], 'говорить')

    def test_defective_and_filtered_forms(self):
        p = next(p for p in self.morph.parse('победить') if p.tag.POS == 'INFN')
        usable = [f for f in p.lexeme if {'1per', 'sing', 'futr'}.issubset(f.tag.grammemes)
                  and not EXCLUDE.intersection(f.tag.grammemes)]
        self.assertFalse(usable, 'Dictionary changed: review defective test fixture')
        d = self.details('победить')
        self.assertIsNone(d['forms']['future']['1sg'])
        self.assertIn('future.1sg', d['missing'])
        self.assertIsNone(self.details('быть')['forms']['present']['1sg'])
        self.assertEqual(self.details('быть')['forms']['present']['3pl'], 'есть')
        self.assertEqual(self.details('хотеть')['forms']['present']['1pl'], 'хотим')

    def test_regularity_is_not_binary(self):
        self.assertEqual(self.details('идти')['regularity']['stem_behavior'], 'suppletive')
        self.assertEqual(self.details('писать')['conjugation'], 'I')
        self.assertEqual(self.details('любить')['regularity']['stem_behavior'], 'alternation_observed')
        self.assertEqual(self.details('говорить')['regularity']['personal_endings'], 'regular')
        self.assertIn('not fully assessed', self.details('писать')['regularity']['scope'])

    def test_simple_forms_are_attested_in_selected_aspect(self):
        for word in 'читать говорить хотеть бежать дать есть быть идти сделать учиться победить'.split():
            d = self.details(word)
            aspect = 'impf' if d['aspect'] == 'imperfective' else 'perf'
            p = next(p for p in self.morph.parse(word)
                     if p.tag.POS == 'INFN' and p.tag.aspect == aspect)
            forms = [f for f in p.lexeme if f.tag.POS == 'VERB'
                     and f.tag.aspect == aspect and not EXCLUDE.intersection(f.tag.grammemes)]
            for table, slots in d['forms'].items():
                if slots is None or (table == 'future' and d['future_kind'] == 'compound'):
                    continue
                for key, value in slots.items():
                    if value is None:
                        continue
                    tags = ({'pres' if table == 'present' else 'futr', 'indc'} | PERSONS[key]
                            if table in {'present', 'future'} else
                            {'past', 'indc'} | {'m': {'masc', 'sing'}, 'f': {'femn', 'sing'},
                                                'n': {'neut', 'sing'}, 'pl': {'plur'}}[key]
                            if table == 'past' else
                            {'impr', 'excl', 'sing' if key == 'sg' else 'plur'})
                    self.assertTrue(any(f.word == value and tags.issubset(f.tag.grammemes)
                                        for f in forms), (word, table, key, value))

    def test_nonverbs_unknown_and_invalid(self):
        for word in ['врач', '', 'читать книгу', 'абракадабрить', None, 123]:
            self.assertIsNone(self.details(word))
        self.assertIsNone(build_verb_details('читать', None))


if __name__ == '__main__':
    unittest.main()
