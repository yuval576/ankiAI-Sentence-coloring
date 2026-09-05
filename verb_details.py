"""Small, offline, JSON-safe Russian verb paradigms from pymorphy3.

Call build_verb_details(word, existing_morph_analyzer). No IO or global cache.
Slots are strings or None (no acceptable dictionary form); a None present
table means not applicable. Keys: 1sg/2sg/3sg/1pl/2pl/3pl; past m/f/n/pl;
imperative sg/pl. Stress is unavailable, including stress-only alternations.
Conjugation describes personal endings, never universal regularity. Stem
comparison is orthographic within the personal paradigm; cross-tense changes
are only asserted for explicitly recognized suppletive verbs.

References: https://github.com/no-plagiarism/pymorphy3
https://gramota.ru/poisk?mode=spravka&query=разноспрягаемые%20глаголы&simple=0
"""

import re
import unicodedata

PERSONS = {f'{p}{short}': {f'{p}per', number}
           for number, short in [('sing', 'sg'), ('plur', 'pl')]
           for p in (1, 2, 3)}
EXCLUDE = {'Hypo', 'Erro', 'Dist', 'Arch', 'Obsl', 'Infr', 'Slng', 'Abbr'}
ENDINGS = {
    'I': {'1sg': ('у', 'ю'), '2sg': ('ешь', 'ёшь'), '3sg': ('ет', 'ёт'),
          '1pl': ('ем', 'ём'), '2pl': ('ете', 'ёте'), '3pl': ('ут', 'ют')},
    'II': {'1sg': ('у', 'ю'), '2sg': ('ишь',), '3sg': ('ит',),
           '1pl': ('им',), '2pl': ('ите',), '3pl': ('ат', 'ят')},
}


def _normalize(word):
    return unicodedata.normalize('NFC', ''.join(
        c for c in unicodedata.normalize('NFD', word.strip().casefold())
        if c not in '\u0300\u0301'))


def _bare(word):
    return re.sub('(ся|сь)$', '', word)


def _dictionary_parse(p):
    # is_known only checks the surface spelling, not the parse's provenance.
    return (p.is_known and len(p.methods_stack) == 1
            and type(p.methods_stack[0][0]).__name__ == 'DictionaryAnalyzer')


def _forms(lexeme, slots, common):
    result = {}
    for key, tags in slots.items():
        matches = [p.word for p in lexeme
                   if common.union(tags).issubset(p.tag.grammemes)]
        result[key] = matches[0] if matches else None
    return result


def _classify(lemma, personal):
    base = _bare(lemma)
    # Use observed endings for prefixed relatives too, not suffix guesses.
    evidence, stems = set(), set()
    complete = all(personal.values())
    unusual = False
    for key, value in personal.items():
        if value is None:
            continue
        value = _bare(value)
        found = False
        for group, endings in ENDINGS.items():
            for ending in endings[key]:
                if value.endswith(ending):
                    found = True
                    stems.add(value[:-len(ending)])
                    if key != '1sg':
                        evidence.add(group)
                    break
        unusual |= not found
    if base in {'дать', 'есть', 'быть'} or unusual:
        conjugation = 'special'
    elif evidence == {'I', 'II'}:
        conjugation = 'mixed'
    elif len(evidence) == 1:
        conjugation = next(iter(evidence))
    else:
        conjugation = 'unknown'
    if base in {'идти', 'быть'}:
        stem = 'suppletive'
    elif conjugation in {'special', 'unknown'}:
        stem = 'not_assessed'
    elif len(stems) > 1:
        stem = 'alternation_observed'
    elif complete:
        stem = 'stable_in_personal_forms'
    else:
        stem = 'not_assessed'
    endings = ('regular' if conjugation in {'I', 'II'} and complete
               else 'mixed' if conjugation == 'mixed'
               else 'special' if conjugation == 'special' else 'not_assessed')
    label = ('Special paradigm' if conjugation == 'special' else
             'Mixed personal endings' if conjugation == 'mixed' else
             'Regular personal endings; suppletive stem' if stem == 'suppletive' else
             'Regular personal endings; stem alternation' if endings == 'regular' and stem == 'alternation_observed' else
             'Regular personal endings; stable personal stem' if endings == 'regular' else
             'Regularity not fully assessed')
    return conjugation, {'label': label, 'personal_endings': endings,
                         'stem_behavior': stem,
                         'scope': 'Personal forms only; stress and other stem changes are not fully assessed.'}


def build_verb_details(word, morph):
    """Return a plain dict, or None for nonverbs/unknown words/no analyzer.

    Exact infinitives outrank homographic finite forms (есть = eat). Among
    equally exact infinitives prefer imperfective, then dictionary score.
    Ambiguity remains explicit; alternative paradigms are not blended.
    Analytical future uses dictionary forms of быть, gated by attested
    personal slots of the verb so defective slots are never filled by guess.
    """
    if morph is None or not isinstance(word, str):
        return None
    word = _normalize(word)
    if not re.fullmatch('[а-яё]+', word):
        return None
    parses = [p for p in morph.parse(word) if _dictionary_parse(p)]
    verbs = [p for p in parses if p.tag.POS in {'INFN', 'VERB'}]
    if not verbs:
        return None
    def rank(p):
        return (p.tag.POS == 'INFN' and p.word == word,
                p.tag.POS == 'INFN', p.tag.aspect == 'impf', p.score)
    chosen = max(verbs, key=rank)
    lemma, aspect = chosen.normal_form, chosen.tag.aspect
    lexeme = [p for p in chosen.lexeme if p.tag.POS == 'VERB'
              and p.tag.aspect == aspect and not EXCLUDE.intersection(p.tag.grammemes)]
    identities = list(dict.fromkeys((p.normal_form, p.tag.POS, p.tag.aspect)
                                   for p in parses))
    # Multiple finite slots of the same lemma are not separate readings.
    readings = list(dict.fromkeys((lemma_, 'verb' if pos in {'INFN', 'VERB'} else pos, asp)
                                 for lemma_, pos, asp in identities))
    paradigms = {tuple((f.word, str(f.tag)) for f in p.lexeme) for p in verbs}
    present = (_forms(lexeme, PERSONS, {'pres', 'indc'})
               if aspect == 'impf' else None)
    simple_future = _forms(lexeme, PERSONS, {'futr', 'indc'})
    personal = present if aspect == 'impf' and lemma != 'быть' else simple_future
    if aspect == 'perf' or lemma == 'быть':
        future, future_kind = simple_future, 'simple'
    elif aspect == 'impf':
        auxiliary = next((p for p in morph.parse('быть')
                          if _dictionary_parse(p) and p.tag.POS == 'INFN'), None)
        aux_lexeme = [p for p in auxiliary.lexeme if p.tag.POS == 'VERB'
                      and not EXCLUDE.intersection(p.tag.grammemes)] if auxiliary else []
        aux = _forms(aux_lexeme, PERSONS, {'futr', 'indc'})
        future = {k: f'{aux[k]} {lemma}' if aux[k] and personal[k] else None
                  for k in PERSONS}
        future_kind = 'compound'
    else:
        future, future_kind = simple_future, 'unknown'
    conjugation, regularity = _classify(lemma, personal)
    past = _forms(lexeme, {'m': {'sing', 'masc'}, 'f': {'sing', 'femn'},
                          'n': {'sing', 'neut'}, 'pl': {'plur'}}, {'past', 'indc'})
    imperative = _forms(lexeme, {'sg': {'sing'}, 'pl': {'plur'}}, {'impr', 'excl'})
    tables = {'present': present, 'past': past, 'future': future, 'imperative': imperative}
    missing = [f'{table}.{key}' for table, slots in tables.items() if slots is not None
               for key, value in slots.items() if value is None]
    return {'version': 1, 'lemma': lemma, 'aspect': {'impf': 'imperfective', 'perf': 'perfective'}.get(aspect, 'unknown'),
            'reflexive': lemma.endswith(('ся', 'сь')), 'conjugation': conjugation,
            'regularity': regularity, 'forms': tables, 'future_kind': future_kind,
            'stress': 'Not marked: dictionary forms have no stress accents; ё is preserved.',
            'ambiguous': len(readings) > 1 or len(paradigms) > 1,
            'readings': [{'lemma': l, 'pos': p, 'aspect': a} for l, p, a in readings[:8]],
            'selection': 'Exact infinitive preferred; imperfective breaks infinitive ties.',
            'missing': missing,
            'source': 'pymorphy3 dictionary lexeme; compound future uses dictionary auxiliary',
            'limitations': 'Missing means no unmarked dictionary form, not proof of impossibility. Marked hypothetical, erroneous, colloquial and archaic forms are excluded.'}
