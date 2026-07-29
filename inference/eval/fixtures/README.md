# Eval fixtures

Drop images here to give `run_eval.py` a fixed set to score against:

- `sources/` — face images the identity is taken from, one clear face each
- `targets/` — images to swap into

Aim for a spread that covers the cases the pipeline gets wrong: a face in
glasses, a hand or hair crossing the face, a face filling the frame, a small
face in a wide shot, strongly coloured lighting, and a group photo.

Images are not committed by default — they are usually someone's likeness.
Keep a shared set outside the repo and point `--sources` / `--targets` at it,
or add images here locally.
