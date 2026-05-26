
---
title: Face App
emoji: 💻
colorFrom: pink
colorTo: gray
sdk: docker
pinned: true
license: unknown
short_description: face swap application
---

Check out the configuration reference at https://huggingface.co/docs/hub/spaces-config-reference

## Model Cache

Model files are downloaded from `MODEL_REPO` through `huggingface_hub` and stored
in the hub-managed cache at `LOCAL_MODEL_DIR`.

- `inswapper_128.onnx`
- `GPEN-BFR-512.onnx`
- `Hyperswap_1b_256.onnx`

Default paths:

- `MODEL_REPO=asadujjaman-emon/face-app-models`
- `LOCAL_MODEL_DIR=models`
