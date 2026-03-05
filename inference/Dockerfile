FROM python:3.10-slim

RUN apt-get update && apt-get install -y \
    wget \
    unzip \
    build-essential \
    python3-dev \
    libglib2.0-0 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user
USER user

ARG MODEL_REPO=asadujjaman-emon/face-app-models
ARG LOCAL_MODEL_DIR=models
ARG ENABLE_GPEN=1

ENV HOME=/home/user \
    MODEL_REPO=$MODEL_REPO \
    LOCAL_MODEL_DIR=$LOCAL_MODEL_DIR \
    ENABLE_GPEN=$ENABLE_GPEN \
    INSIGHTFACE_HOME=/home/user/.insightface \
    PATH=/home/user/.local/bin:$PATH

WORKDIR $HOME

RUN pip install --no-cache-dir --upgrade pip

COPY --chown=user ./requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=user ./ ./

RUN python preload_models.py

EXPOSE 7860

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port 7860"]
