
---
title: face-app
emoji: 💻
colorFrom: pink
colorTo: gray
sdk: docker
docker:
  build:
    context: ./api
build_args:
  HF_TOKEN: $HUGGINGFACE_TOKEN
app_file: app/main.py
pinned: false
license: mit
short_description: api for face app
---

Check out the configuration reference at https://huggingface.co/docs/hub/spaces-config-reference