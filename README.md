# Anki AI Sentence Coloring

Permanent, matching Russian/English sentence colors, an offline vocabulary library, and an optional contextual AI tutor for desktop Anki and AnkiMobile.

This is a **Windows-first personal prototype**, not an official Anki or OpenAI product. It currently expects Russian Core 5000-compatible fields. The repository contains source code only—not a deck, recordings, account credentials, chat history, or generated study data.

## Features

- Match Russian words or short phrases to their English counterparts and save the color spans directly into note fields. Saved colors display automatically, offline, after Anki sync.
- Process the whole deck with upcoming cards first. Resume from atomic checkpoints without paying for the same completed work again. Auth/usage errors stop workers; repeated timeouts trip a circuit breaker.
- Full-page vocabulary library with genuine latest Again/Hard/Good/Easy ratings, translations, and matching examples across the deck. Looking up an unstudied word does not count it as learned.
- Click a Russian word, see the selected form and dictionary/base form, and move Back/Forward through selections. Stored morphological mappings handle conjugated verbs and declined nouns; ambiguous forms are not perfect contextual analyses.
- Hover for the saved sentence translation or a dictionary meaning. On phones, tap to open the entry. Unavailable meanings are labeled rather than invented.
- Listen to existing deck recordings inside vocabulary. No automatic playback, generated speech, or external audio service.
- Hover a Russian sentence word for its base-form dictionary meaning, separately from the sentence-specific translation. Click to open the vocabulary entry.
- Expand Word details for cached verb paradigms, aspect and qualified regularity notes. Forms come from the offline pymorphy3 dictionary, not AI. Stress is not marked; ambiguous readings and unavailable forms are flagged. I/II endings do not imply an entirely regular stem.
- Ask Luna about a selected word or exact example without leaving vocabulary. Vocabulary chats are separate from review-card threads.
- Three personalization sections: your instructions, automatically selected chat memory, and the tutor's own lower-priority teaching guidance.

Desktop add-ons do **not** run on iOS. This project instead syncs card HTML/CSS/JavaScript and vocabulary/media files. Offline lookup, recordings and permanent colors do not require the PC. New AI replies require the PC helper to remain awake and reachable.

## Before installing

1. Back up your collection and media using Anki. First try this in a disposable profile.
2. Install Node.js 20+, Python 3.12, and a matching desktop Anki version. The Python requirements below were tested against Anki 26.8.1; do not blindly mix incompatible collection libraries.
3. For the optional tutor/color generator, install a compatible Codex CLI and sign in to **your own** ChatGPT account. Never copy another person's authentication files. The adapter uses `codex exec`, disables tools, and requests structured text only. Model availability and subscription limits depend on your account. The prototype defaults to `gpt-5.6-luna`; configure `ANKI_TUTOR_MODEL` if needed. There is no automatic API-key/billing fallback.
4. For iPhone chat, download `cloudflared.exe` from the [official Cloudflare repository](https://github.com/cloudflare/cloudflared/releases) and put it beside `launcher.mjs`. The binary is not included here. Quick Tunnel addresses change when the helper restarts and must be synced again.

See [Codex non-interactive documentation](https://developers.openai.com/codex/noninteractive) for the underlying CLI workflow.

## Configuration and setup

Run PowerShell in this repository:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# Optional: defaults are %APPDATA%\Anki2 and profile "User 1".
$env:ANKI_PROFILE = 'User 1'
# $env:ANKI_BASE = 'D:\Anki2'
# $env:ANKI_CODEX_PATH = 'C:\path\to\codex.exe'
# $env:ANKI_TUTOR_MODEL = 'your-supported-model'
```

Close desktop Anki before installing or syncing with these scripts. `install-card-panel.py` validates the expected fields and creates a backup before changing templates. It does not change ratings or review history.

```powershell
.\.venv\Scripts\python.exe install-card-panel.py
.\.venv\Scripts\python.exe deploy-ui.py
.\.venv\Scripts\python.exe install-addon.py
node launcher.mjs
```

Keep the helper terminal running. In another terminal, run the following with Anki still closed:

```powershell
.\.venv\Scripts\python.exe sync-anki.py
```

Then open [the local pairing dashboard](http://127.0.0.1:8766/), reopen Anki, and pair each device once. On iPhone, fully sync media and reopen a card. The pairing dashboard is local-only; do not publish codes or tokens. The collection must already be signed into AnkiWeb. The sync script refuses to choose a destructive full upload/download automatically.

`ANKI_NOTE_TYPE` and `ANKI_DECK` may change the selected model/deck, but the required field layout remains Russian Core 5000-specific. Custom fields and decks need adaptation. Environment overrides must also be available to Anki when its sync hook runs. This is not a one-click installer for arbitrary decks.

## Generate permanent colors

```powershell
.\run-coloring.ps1 -DryRun
.\run-coloring.ps1 -Workers 4
.\run-coloring.ps1 -Status
# .\run-coloring.ps1 -Stop
# Resume an already exported queue if Anki is busy/locked:
# .\run-coloring.ps1 -Workers 8 -UseExistingQueue
```

The launcher takes a read-only collection snapshot, then runs workers hidden in the background. RAM is not the only concurrency limit: more workers can trigger service restrictions. Generation uses your account allowance and can take hours for a large deck.

Anki can hold a lock that prevents even the read-only snapshot. `-UseExistingQueue` resumes the existing validated queue without accessing the collection. It retains the priorities and sentences from the previous export; export again after deck edits when Anki is idle or closed.

**Prepared is not the same as synced.** Workers save alignment cache entries. The installed PC pre-sync hook converts them into permanent note HTML and refreshes vocabulary during normal Anki sync. Alternatively, close Anki and run `sync-anki.py`. Finally sync the iPhone. The scripts preserve scheduling/review history and back up changed notes.

Check `batch-colors-report.json` or `run-coloring.ps1 -Status` for current state. There is no automatic restart after access/usage errors. Once the cause is resolved, resume explicitly; use `-Resume` to clear an explicit stop request and `-RetryFailed` only after reviewing exhausted pairs. Invalid mappings are retained as failures for review, not silently accepted. A dead-owner lock can be recovered with `node process-batch-colors.mjs --recover-lock`.

## Development checks

```powershell
npm test
.\.venv\Scripts\python.exe test-coloring-export.py
.\.venv\Scripts\python.exe test-vocabulary-colors.py
.\.venv\Scripts\python.exe test-verb-details.py
.\.venv\Scripts\python.exe test-vocabulary-grammar.py
```

These use synthetic fixtures and fake providers. `test-automatic-memory.mjs --live` is explicitly opt-in and uses account allowance. Native iPhone/desktop rendering and audible playback still need testing on each installation; automated DOM/data checks are not a substitute for that.

## Privacy and limitations

- Do not commit runtime JSON, Anki collections/media, backups, logs, pairing configuration, authentication, or personal memory. `.gitignore` excludes known generated/private paths.
- Selected card text and chat messages go to the configured AI service when you ask for help or generate alignments. The helper stores deck chat memory locally when enabled.
- Never expose the helper without authentication. The included tunnel makes an HTTPS endpoint reachable; application pairing remains mandatory. Keep dependencies current and review the source before deployment.
- Translations can be non-literal. Articles, auxiliaries, idioms and many-to-one phrases cannot always have independent one-to-one colors. Morphological dictionary matching and AI alignments can be wrong.
- This project does not configure FSRS or install third-party add-ons for you. Use Anki's own scheduler settings and review any separate add-on independently.
