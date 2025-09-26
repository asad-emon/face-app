---
title: face-app
emoji: 💻
colorFrom: pink
colorTo: gray
sdk: docker
docker:
  build:
    context: ./api   # subfolder containing Dockerfile
build_args:
  HF_TOKEN: $HUGGINGFACE_TOKEN
pinned: false
license: mit
short_description: api for face app
---