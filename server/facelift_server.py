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
import sys
import threading
import uuid
from pathlib import Path

from flask import Flask, jsonify, request, send_file

FACELIFT_DIR = os.environ.get("FACELIFT_DIR", str(Path.home() / "FaceLift"))
RESULTS_DIR  = "/tmp/facelift_results"
UPLOADS_DIR  = "/tmp/facelift_uploads"

os.makedirs(RESULTS_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

sys.path.insert(0, FACELIFT_DIR)

app   = Flask(__name__)
JOBS: dict[str, dict] = {}

_models      = None
_models_lock = threading.Lock()


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
        JOBS[job_id] = {"status": "running"}
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
            JOBS[job_id] = {"status": "error", "error": "FaceLift produced no gaussians.ply"}
            return

        JOBS[job_id] = {
            "status":     "success",
            "ply_path":   ply_path,
            "video_path": video_path if os.path.exists(video_path) else None,
        }
    except Exception as e:
        JOBS[job_id] = {"status": "error", "error": str(e)}


@app.route("/process_image", methods=["POST"])
def process_image():
    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400
    img_file = request.files["image"]
    job_id   = str(uuid.uuid4())
    img_path = os.path.join(UPLOADS_DIR, f"{job_id}.png")
    img_file.save(img_path)
    JOBS[job_id] = {"status": "queued"}
    threading.Thread(target=run_facelift, args=(job_id, img_path), daemon=True).start()
    return jsonify({"job_id": job_id})


@app.route("/status/<job_id>")
def status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "Unknown job"}), 404
    return jsonify({"status": job["status"], "error": job.get("error")})


@app.route("/download/<job_id>/ply")
def download_ply(job_id: str):
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
