# Deferred Audio Ingestion and Transcription

**Status:** Preserved for future implementation; excluded from the current
runtime and release.

## Historical product intent

The earlier product concept allowed a VC user to record or upload Founder
conversations and then confirm the company and Deal before the resulting
transcript entered VSee or XTrace.

The expected inputs were:

- microphone recording from the product;
- uploaded audio files;
- calls as long as approximately two hours;
- primarily English speech with occasional Chinese.

The earlier desktop concept targeted Apple Silicon and explored local
transcription with a public Whisper model, including `small.en` for
English-first material. Because the product later moved from a local macOS app
to a hosted Web App, that local execution design is retained only as historical
context and cannot be assumed to work in the hosted Worker.

## Future Web workflow

1. Obtain explicit recording/upload consent.
2. Record through `MediaRecorder` or upload an allowed audio file.
3. Store the original audio in private object storage.
4. Queue an asynchronous transcription job.
5. Produce a timestamped transcript with language metadata and, when reliable,
   speaker segments.
6. Show the complete transcript and extracted company/Deal preview.
7. Require human confirmation of company name, Deal ownership, and status.
8. Only after confirmation, create the immutable Source Revision, canonical
   evidence, and XTrace memory.

## Evidence requirements

- Transcript claims retain audio timestamps.
- Model-derived text is labeled as transcription, not a byte-exact source
  quotation.
- Low-confidence spans and mixed-language uncertainty remain visible.
- Audio and transcript revisions retain an immutable relationship.
- No raw recording or transcript may modify a Deal before human confirmation.

## Privacy and lifecycle requirements

- recording consent;
- workspace-scoped private access;
- explicit retention and deletion policy;
- clear disclosure before third-party model processing;
- encrypted transport and private object storage;
- rate, duration, and file-size limits;
- failed-job retry without duplicate Deal or XTrace writes;
- no use of the private `Fetter Family Cafe.m4a` research recording as a
  committed fixture.

## Deferred decisions

- hosted transcription provider versus a separately deployed Whisper Worker;
- multilingual model and language-detection policy;
- diarization quality threshold;
- browser codec/container allowlist;
- transcript correction/version-history UX;
- maximum retention period for raw recordings.

Until these decisions are approved and implemented, audio remains absent from
the upload `accept` list and is rejected by the server.
