FROM nvidia/cuda:11.8.0-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    python3-pip git wget curl \
    libgl1-mesa-glx libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone --recursive https://github.com/brubru6707/HairStep-Upgrade.git
WORKDIR /app/HairStep-Upgrade
RUN pip3 install --no-cache-dir -r requirements.txt \
    google-cloud-pubsub \
    google-cloud-storage

COPY worker.py /app/worker.py

CMD ["python3", "/app/worker.py"]