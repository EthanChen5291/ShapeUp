"""
FaceLift head reconstruction server (OSCAR box).

Synchronous design — matches server/modal_facelift.py and what the Next.js
route (src/app/api/facelift/route.ts) expects:

    POST /process_image  (multipart "image")
        → runs inference inline (~15-20 s on GPU)
        → { "ply_b64": <base64 gaussians.ply>,
            "video_b64": <base64 turntable.mp4 | null>,
            "elapsed_s": <float> }

The route decodes the PLY, converts PLY → splat, and uploads both (+ video) to
S3. There is no job-poll/download protocol: the caller blocks on this one
request, so OSCAR and Modal are drop-in interchangeable behind
resolveFaceliftUpstreams() in src/lib/facelift.ts.

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

   Then point OSCAR_FACELIFT_URL (.env / Vercel) at the ngrok URL.
"""

import base64
import os
import shutil
import sys
import threading
import time
import uuid
from io import BytesIO
from pathlib import Path

from flask import Flask, jsonify, request
from PIL import Image, UnidentifiedImageError

FACELIFT_DIR = os.environ.get("FACELIFT_DIR", str(Path.home() / "FaceLift"))
RESULTS_DIR  = "/tmp/facelift_results"
UPLOADS_DIR  = "/tmp/facelift_uploads"
FACELIFT_SHARED_SECRET = os.environ.get("FACELIFT_SHARED_SECRET")
MAX_UPLOAD_BYTES = 6 * 1024 * 1024
MAX_PIXELS = 12_000_000

os.makedirs(RESULTS_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

sys.path.insert(0, FACELIFT_DIR)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

_models      = None
_models_lock = threading.Lock()
# Serialises GPU access: one inference at a time per process (Flask is threaded).
_gpu_lock    = threading.Lock()


def require_shared_secret():
    if FACELIFT_SHARED_SECRET and request.headers.get("X-ShapeUp-Facelift-Secret") != FACELIFT_SHARED_SECRET:
        return jsonify({"error": "Unauthorized"}), 401
    return None


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


def run_facelift(job_id: str, image_path: str) -> tuple[str, str | None]:
    """Run inference synchronously. Returns (ply_path, video_path|None)."""
    output_dir = os.path.join(RESULTS_DIR, job_id)
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
    stem       = Path(image_path).stem
    out_subdir = os.path.join(output_dir, stem)
    ply_path   = os.path.join(out_subdir, "gaussians.ply")
    video_path = os.path.join(out_subdir, "turntable.mp4")

    if not os.path.exists(ply_path):
        raise RuntimeError("FaceLift produced no gaussians.ply")

    return ply_path, video_path if os.path.exists(video_path) else None


@app.route("/process_image", methods=["POST"])
def process_image():
    auth_error = require_shared_secret()
    if auth_error:
        return auth_error

    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400
    img_file = request.files["image"]
    if img_file.mimetype not in {"image/png", "image/jpeg", "image/webp"}:
        return jsonify({"error": "Unsupported image type"}), 400

    raw = img_file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        return jsonify({"error": "Image is too large"}), 413
    try:
        with Image.open(BytesIO(raw)) as img:
            img.verify()
            width, height = img.size
    except UnidentifiedImageError:
        return jsonify({"error": "Invalid image"}), 400
    if width * height > MAX_PIXELS:
        return jsonify({"error": "Image has too many pixels"}), 413

    job_id   = str(uuid.uuid4())
    img_path = os.path.join(UPLOADS_DIR, f"{job_id}.png")
    with open(img_path, "wb") as f:
        f.write(raw)

    output_dir = os.path.join(RESULTS_DIR, job_id)
    try:
        with _gpu_lock:
            gpu_start = time.perf_counter()
            ply_path, video_path = run_facelift(job_id, img_path)
            elapsed_s = round(time.perf_counter() - gpu_start, 3)

        with open(ply_path, "rb") as f:
            ply_b64 = base64.b64encode(f.read()).decode()
        video_b64 = None
        if video_path:
            with open(video_path, "rb") as f:
                video_b64 = base64.b64encode(f.read()).decode()

        return jsonify({"ply_b64": ply_b64, "video_b64": video_b64, "elapsed_s": elapsed_s})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"{type(e).__name__}: {e}"}), 500
    finally:
        try:
            os.remove(img_path)
        except OSError:
            pass
        shutil.rmtree(output_dir, ignore_errors=True)


if __name__ == "__main__":
    print("[facelift_server] Pre-loading models…")
    load_models()
    print("[facelift_server] Models ready. Listening on :5002")
    app.run(host="0.0.0.0", port=5002, threaded=True)
