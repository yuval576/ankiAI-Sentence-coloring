# Russian Pronunciation Core

Portable ESM utilities for Russian stress and approximate English-Latin
pronunciation such as `SLU-cha-ya`.

It does not guess stress for an unmarked multisyllabic word. Supply an
occurrence-specific, independently checked `stressedForm` when your server has
one; otherwise the result says `stressStatus: 'unverified'`.

```js
import {describeRussianPronunciation} from './src/index.mjs';
describeRussianPronunciation('случая', {stressedForm:'слу́чая', pronunciation:'SLU-cha-ya'});
// {form:'слу́чая', stressStatus:'verified', pronunciation:'SLU-cha-ya'}
```

Use `validatePronunciationAnnotation()` before storing output from an AI or
other untrusted service. It rejects changed word letters, malformed accents and
Latin guides whose uppercase stress does not match the Russian form.
