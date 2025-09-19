
FROM python:3.10-slim

# Install system dependencies for insightface build
RUN apt-get update && apt-get install -y \
    wget \
    unzip \
    build-essential \
    python3-dev \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Set up a new user named "user" with user ID 1000
RUN useradd -m -u 1000 user

# Switch to the "user" user
USER user

# Set home to the user's home directory
ENV HOME=/home/user \
	PATH=/home/user/.local/bin:$PATH

# Set the working directory to the user's home directory
WORKDIR $HOME/app

# Try and run pip command after setting the user with `USER user` to avoid permission issues with Python
RUN pip install --no-cache-dir --upgrade pip

# Copy the current directory contents into the container at $HOME/app setting the owner to the user
COPY --chown=user . $HOME/app

# Install Dependencies
RUN pip install --no-cache-dir huggingface_hub insightface matplotlib

RUN pip install --no-cache-dir -r requirements.txt

# Run the application from main entry
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 7860"]
