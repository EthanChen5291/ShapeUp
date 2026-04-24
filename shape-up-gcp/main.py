import os
import json
import uuid
from fastapi import FastAPI, UploadFile, File, HTTPException
from google.cloud import pubsub_v1, storage

app = FastAPI()
publisher = pubsub_v1.PublisherClient()
storage_client = storage.Client()

PROJECT_ID = "shape-up-gcp"
TOPIC_ID = os.environ.get("TOPIC_ID", "shapeup-jobs")
BUCKET_NAME = os.environ.get("BUCKET_NAME", "shape-up-data-bucket")


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".png"):
        raise HTTPException(status_code=400, detail="Only .png files are accepted")

    job_id = str(uuid.uuid4())
    blob_name = f"inputs/{job_id}.png"

    bucket = storage_client.bucket(BUCKET_NAME)
    blob = bucket.blob(blob_name)
    blob.upload_from_file(file.file, content_type="image/png")

    topic_path = publisher.topic_path(PROJECT_ID, TOPIC_ID)
    message = json.dumps({"job_id": job_id, "input_blob": blob_name}).encode("utf-8")
    future = publisher.publish(topic_path, message)
    future.result()

    return {"job_id": job_id, "status": "queued"}


@app.get("/result/{job_id}")
async def get_result(job_id: str):
    bucket = storage_client.bucket(BUCKET_NAME)
    blob = bucket.blob(f"outputs/{job_id}.ply")
    if not blob.exists():
        return {"job_id": job_id, "status": "processing"}

    url = blob.generate_signed_url(expiration=3600, method="GET", version="v4")
    return {"job_id": job_id, "status": "complete", "download_url": url}


@app.get("/health")
def health():
    return {"status": "ok"}
