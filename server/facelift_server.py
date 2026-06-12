"""
FaceLift head reconstruction server.

Setup:
1. Clone FaceLift and set up its conda env:
       git clone https://github.com/weijielyu/FaceLift ~/FaceLift
       cd ~/FaceLift
       bash setup_env.sh
       conda activate facelift

2. Model weights auto-download from wlyu/OpenFaceLift on first run (~7-9 GB).

3. Install Flask into the facelift conda env:
       pip install flask

4. Set FACELIFT_DIR if FaceLift is not at ~/FaceLift:
       export FACELIFT_DIR=/path/to/FaceLift

5. Run (within the facelift conda env):
       python facelift_server.py

6. Expose via ngrok:
       ngrok http 5002

   Then update FACELIFT_URL in server/main.py and .env.local to the ngrok URL.
"""

import os
import re
import shutil
import sys
import threading
import time
import uuid
from pathlib import Path

from flask import Flask, jsonify, request, send_file

FACELIFT_DIR = os.environ.get("FACELIFT_DIR", str(Path.home() / "FaceLift"))
RESULTS_DIR  = "/tmp/facelift_results"
UPLOADS_DIR  = "/tmp/facelift_uploads"
FACELIFT_SHARED_SECRET = os.environ.get("FACELIFT_SHARED_SECRET")
MAX_UPLOAD_BYTES = 6 * 1024 * 1024
JOB_TTL_SECONDS = int(os.environ.get("FACELIFT_JOB_TTL_SECONDS", "3600"))
JOB_ID_RE = re.compile(r"^[a-f0-9-]{36}$")

os.makedirs(RESULTS_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

sys.path.insert(0, FACELIFT_DIR)

app   = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
JOBS: dict[str, dict] = {}

_models      = None
_models_lock = threading.Lock()
_jobs_lock = threading.Lock()


def require_shared_secret():
    if FACELIFT_SHARED_SECRET and request.headers.get("X-ShapeUp-Facelift-Secret") != FACELIFT_SHARED_SECRET:
        return jsonify({"error": "Unauthorized"}), 401
    return None


def cleanup_old_jobs() -> None:
    cutoff = time.time() - JOB_TTL_SECONDS
    with _jobs_lock:
        expired = [
            job_id for job_id, job in JOBS.items()
            if job.get("created_at", time.time()) < cutoff and job.get("status") != "running"
        ]
        for job_id in expired:
            JOBS.pop(job_id, None)
            shutil.rmtree(os.path.join(RESULTS_DIR, job_id), ignore_errors=True)


def load_models():
    global _models
    with _models_lock:
        if _models is not None:
            return _models
        import torch
        from inference import (
            initialize_face_detector,
            initialize_gslrm_model,
            initialize_mvdiffusion_pipeline,
            setup_camera_parameters,
        )
        device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
        _models = {
            "device":        device,
            "mv_pipeline":   initialize_mvdiffusion_pipeline(device),
            "gslrm_model":   initialize_gslrm_model(device),
            "face_detector": initialize_face_detector(device),
            "camera_params": setup_camera_parameters(device),
        }
        return _models


def run_facelift(job_id: str, image_path: str) -> None:
    try:
        with _jobs_lock:
            JOBS[job_id] = {**JOBS.get(job_id, {}), "status": "running"}
        output_dir   = os.path.join(RESULTS_DIR, job_id)
        os.makedirs(output_dir, exist_ok=True)

        models = load_models()

        from inference import process_single_image

        process_single_image(
            image_path=image_path,
            output_dir=output_dir,
            pipeline=models["mv_pipeline"],
            gslrm_model=models["gslrm_model"],
            face_detector=models["face_detector"],
            camera_params=models["camera_params"],
            auto_crop=True,
            seed=4,
            guidance_scale_2D=3.0,
            step_2D=50,
        )

        # FaceLift writes: output_dir/<image_stem>/gaussians.ply + turntable.mp4
        stem        = Path(image_path).stem
        out_subdir  = os.path.join(output_dir, stem)
        ply_path    = os.path.join(out_subdir, "gaussians.ply")
        video_path  = os.path.join(out_subdir, "turntable.mp4")

        if not os.path.exists(ply_path):
            with _jobs_lock:
                JOBS[job_id] = {**JOBS.get(job_id, {}), "status": "error", "error": "FaceLift produced no gaussians.ply"}
            return

        with _jobs_lock:
            JOBS[job_id] = {
                **JOBS.get(job_id, {}),
                "status":     "success",
                "ply_path":   ply_path,
                "video_path": video_path if os.path.exists(video_path) else None,
            }
    except Exception as e:
        import traceback
        with _jobs_lock:
            JOBS[job_id] = {**JOBS.get(job_id, {}), "status": "error", "error": f"{type(e).__name__}: {e}\n{traceback.format_exc()}"}
    finally:
        try:
            os.remove(image_path)
        except OSError:
            pass


@app.route("/process_image", methods=["POST"])
def process_image():
    auth_error = require_shared_secret()
    if auth_error:
        return auth_error
    cleanup_old_jobs()
    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400
    img_file = request.files["image"]
    if img_file.mimetype not in {"image/png", "image/jpeg", "image/webp"}:
        return jsonify({"error": "Unsupported image type"}), 400
    job_id   = str(uuid.uuid4())
    img_path = os.path.join(UPLOADS_DIR, f"{job_id}.png")
    img_file.save(img_path)
    with _jobs_lock:
        JOBS[job_id] = {"status": "queued", "created_at": time.time()}
    threading.Thread(target=run_facelift, args=(job_id, img_path), daemon=True).start()
    return jsonify({"job_id": job_id})


@app.route("/status/<job_id>")
def status(job_id: str):
    auth_error = require_shared_secret()
    if auth_error:
        return auth_error
    cleanup_old_jobs()
    if not JOB_ID_RE.match(job_id):
        return jsonify({"error": "Invalid job_id"}), 400
    with _jobs_lock:
        job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "Unknown job"}), 404
    return jsonify({"status": job["status"], "error": job.get("error")})


@app.route("/download/<job_id>/ply")
def download_ply(job_id: str):
    auth_error = require_shared_secret()
    if auth_error:
        return auth_error
    if not JOB_ID_RE.match(job_id):
        return jsonify({"error": "Invalid job_id"}), 400
    with _jobs_lock:
        job = JOBS.get(job_id)
    if not job or job["status"] != "success":
        return jsonify({"error": "Job not complete"}), 404
    return send_file(
        job["ply_path"],
        mimetype="application/octet-stream",
        as_attachment=True,
        download_name="gaussians.ply",
    )


@app.route("/download/<job_id>/video")
def download_video(job_id: str):
    auth_error = require_shared_secret()
    if auth_error:
        return auth_error
    if not JOB_ID_RE.match(job_id):
        return jsonify({"error": "Invalid job_id"}), 400
    with _jobs_lock:
        job = JOBS.get(job_id)
    if not job or job["status"] != "success":
        return jsonify({"error": "Job not complete"}), 404
    if not job.get("video_path"):
        return jsonify({"error": "No video output"}), 404
    return send_file(job["video_path"], mimetype="video/mp4")


if __name__ == "__main__":
    print("[facelift_server] Pre-loading models…")
    load_models()
    print("[facelift_server] Models ready. Listening on :5002")
    app.run(host="0.0.0.0", port=5002, threaded=True)
