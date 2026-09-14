# Sentence Coloring Core

A dependency-free ESM package for the reusable portion of the Anki project:
tokenize bilingual sentences, validate untrusted AI token alignments, and render
matching safely escaped color spans.

It contains no Anki integration, language model, authentication, decks, user
content, or network service.

## App flow

1. Call `buildAlignmentTask()` to get text and indexed tokens.
2. Send `task.input` and `task.schema` to a model through **your server**. Do
   not put an API key or user session credential in an app client.
3. Send its JSON through `renderBilingualAlignment()`. Invalid, duplicated, or
   out-of-range mappings throw instead of being displayed.
4. Insert the returned HTML only into a trusted rendering path. It escapes every
   supplied sentence token and generates the only markup itself.

```js
import {buildAlignmentTask, renderBilingualAlignment} from './src/index.mjs';
const task=buildAlignmentTask({source:'Ты уже ходил к врачу?',target:'Have you already been to the doctor?',sourceLocale:'ru',targetLocale:'en'});
const alignment={groups:[{source:[0],target:[0]},{source:[1],target:[2]},{source:[2],target:[3]},{source:[3],target:[4]},{source:[4],target:[6]}]};
const colored=renderBilingualAlignment({...task,alignment});
```

Run the tests with `node --test packages/sentence-coloring-core/test/core.test.mjs`.
