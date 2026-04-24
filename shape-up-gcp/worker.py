import os
import json
import subprocess
import shutil
import logging
from pathlib import Path
from google.cloud import pubsub_v1, storage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

PROJECT_ID = "shape-up-gcp"
SUBSCRIPTION_ID = "worker-subscription"
BUCKET_NAME = "shape-up-data-bucket"
BASE_DIR = Path("/app/HairStep-Upgrade")
WORK_DIR = Path("/tmp/shapeup-jobs")

storage_client = storage.Client()


def run(cmd: list[str], cwd: Path = BASE_DIR):
    log.info("Running: %s", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True)


def process(job_id: str, input_blob: str):
    job_dir = WORK_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    input_path = job_dir / "input.png"
    output_path = job_dir / "output.ply"

    try:
        # Download input image
        bucket = storage_client.bucket(BUCKET_NAME)
        bucket.blob(input_blob).download_to_filename(str(input_path))
        log.info("[%s] Downloaded input", job_id)

        # Run HairStep-Upgrade pipeline
        run([
            "python", "inference.py",
            "--img", str(input_path),
            "--output", str(output_path),
        ])
        log.info("[%s] Pipeline complete", job_id)

        # Upload result
        out_blob = bucket.blob(f"outputs/{job_id}.ply")
        out_blob.upload_from_filename(str(output_path))
        log.info("[%s] Uploaded output", job_id)

        # Delete input PNG now that the PLY is saved
        bucket.blob(input_blob).delete()
        log.info("[%s] Deleted input PNG", job_id)

    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


def callback(message: pubsub_v1.subscriber.message.Message):
    try:
        payload = json.loads(message.data.decode("utf-8"))
        job_id = payload["job_id"]
        input_blob = payload["input_blob"]
        log.info("[%s] Received job", job_id)
        process(job_id, input_blob)
        message.ack()
        log.info("[%s] Done", job_id)
    except Exception as exc:
        log.exception("Job failed: %s", exc)
        message.nack()


if __name__ == "__main__":
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    subscriber = pubsub_v1.SubscriberClient()
    sub_path = subscriber.subscription_path(PROJECT_ID, SUBSCRIPTION_ID)
    future = subscriber.subscribe(sub_path, callback=callback)
    log.info("Worker listening on %s", sub_path)
    try:
        future.result()
    except KeyboardInterrupt:
        future.cancel()
