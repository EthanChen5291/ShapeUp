"""
Modal deployment for FaceLift head reconstruction.

Usage
-----
First-time setup (once per machine):
    pip install modal
    modal setup          # authenticates via browser

Dev (hot-reload, ephemeral URL):
    modal serve server/modal_facelift.py

Production deploy (stable URL):
    modal deploy server/modal_facelift.py

After deploying, copy the printed web-endpoint URL into FACELIFT_URL in .env.local.
No ngrok needed — Modal handles HTTPS.

Adding a teammate
-----------------
modal.com → your workspace (chen-ethan529) → Settings → Members → Invite member.
They'll get their own API token scoped to this workspace and can run
`modal setup` on their machine to authenticate.

Memory snapshot
---------------
On first deploy, the container downloads ~7 GB of weights to the Volume, loads
them onto the GPU, and Modal snapshots both CPU RAM and GPU VRAM
(enable_gpu_snapshot alpha). Subsequent cold starts restore from the snapshot
in ~10–15 s instead of re-reading from disk (~1–3 min).
The snapshot materialises after ~3–5 cold boots — don't benchmark timing on
the first run.

Synchronous design
------------------
POST /process_image accepts a multipart image, runs FaceLift inference
(~15–20 s on A10G), and returns JSON with base64-encoded PLY and turntable
video. The Next.js route.ts decodes, converts PLY → splat, and uploads both
to S3 — no polling required.

An asyncio.Lock serialises GPU access within a container. Modal auto-scales
to additional containers for concurrent users.
"""

import modal

APP_NAME     = "shapeup-facelift"
FACELIFT_DIR = "/facelift"
WEIGHTS_DIR  = "/weights"

weights_volume = modal.Volume.from_name("facelift-weights", create_if_missing=True)

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04",
        add_python="3.10",
    )
    .apt_install([
        "git", "wget", "ffmpeg",
        "libgl1-mesa-glx", "libglib2.0-0",
        "libsm6", "libxext6", "libxrender-dev",
        "build-essential", "cmake", "ninja-build",
    ])
    .pip_install("packaging==24.2", "typing-extensions==4.14.0")
    .pip_install(
        "torch==2.4.0",
        "torchvision==0.19.0",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
    .pip_install(
        "transformers==4.44.2",
        "diffusers[torch]==0.30.3",
        "huggingface-hub==0.35.3",
        "xformers==0.0.27.post2",
        "accelerate==0.33.0",
        "Pillow==10.4.0",
        "opencv-python==4.10.0.84",
        "scikit-image==0.21.0",
        "lpips==0.1.4",
        "rembg",
        "numpy==1.26.4",
        "matplotlib==3.7.5",
        "scikit-learn==1.3.2",
        "einops==0.8.0",
        "jaxtyping==0.2.19",
        "pytorch-msssim==1.0.0",
        "easydict==1.13",
        "pyyaml==6.0.2",
        "termcolor==2.4.0",
        "plyfile==1.0.3",
        "tqdm",
        "videoio==0.3.0",
        "ffmpeg-python==0.2.0",
        "fastapi",
        "uvicorn[standard]",
        "python-multipart",
    )
    .run_commands(
        "pip install facenet-pytorch --no-deps",
        "pip install ninja",  # speeds up CUDA extension compilation
        f"git clone https://github.com/weijielyu/FaceLift {FACELIFT_DIR}",
        # build for A10G (8.6), A100 (8.0), L40S (8.9) — avoids recompiling per GPU
        "TORCH_CUDA_ARCH_LIST='8.0;8.6;8.9' pip install git+https://github.com/graphdeco-inria/diff-gaussian-rasterization",
    )
    .env({
        "FACELIFT_DIR":       FACELIFT_DIR,
        "HF_HOME":            WEIGHTS_DIR,
        "HF_HUB_CACHE":       WEIGHTS_DIR,
        "TRANSFORMERS_CACHE": WEIGHTS_DIR,
    })
)

app = modal.App(APP_NAME, image=image)


@app.cls(
    gpu="A10G",
    scaledown_window=30,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
    volumes={WEIGHTS_DIR: weights_volume},
    timeout=900,
)
class FaceLiftServer:
    @modal.enter(snap=True)
    def load_models(self) -> None:
        import sys
        import torch
        sys.path.insert(0, FACELIFT_DIR)
        from inference import (
            initialize_face_detector,
            initialize_gslrm_model,
            initialize_mvdiffusion_pipeline,
            setup_camera_parameters,
        )
        self.device        = torch.device("cuda:0")
        self.mv_pipeline   = initialize_mvdiffusion_pipeline(self.device)
        self.gslrm_model   = initialize_gslrm_model(self.device)
        self.face_detector = initialize_face_detector(self.device)
        self.camera_params = setup_camera_parameters(self.device)
        print("[facelift] Models on GPU — snapshotting.")

    @modal.asgi_app()
    def serve(self):
        import asyncio
        import base64
        import os
        import sys
        import uuid
        from pathlib import Path

        from fastapi import FastAPI, File, HTTPException, UploadFile

        sys.path.insert(0, FACELIFT_DIR)
        from inference import process_single_image

        api   = FastAPI()
        _lock = asyncio.Lock()

        @api.post("/process_image")
        async def process_image(image: UploadFile = File(...)):
            job_id   = str(uuid.uuid4())
            img_dir  = "/tmp/facelift_uploads"
            os.makedirs(img_dir, exist_ok=True)
            img_path = f"{img_dir}/{job_id}.png"
            with open(img_path, "wb") as f:
                f.write(await image.read())

            async with _lock:
                loop = asyncio.get_event_loop()
                output_dir = f"/tmp/facelift/{job_id}"
                os.makedirs(output_dir, exist_ok=True)

                await loop.run_in_executor(None, lambda: process_single_image(
                    image_path=img_path,
                    output_dir=output_dir,
                    pipeline=self.mv_pipeline,
                    gslrm_model=self.gslrm_model,
                    face_detector=self.face_detector,
                    camera_params=self.camera_params,
                    auto_crop=True,
                    seed=4,
                    guidance_scale_2D=3.0,
                    step_2D=50,
                ))

            stem      = Path(img_path).stem
            out_dir   = os.path.join(output_dir, stem)
            ply_path  = os.path.join(out_dir, "gaussians.ply")

            if not os.path.exists(ply_path):
                raise HTTPException(500, "FaceLift produced no gaussians.ply")

            with open(ply_path, "rb") as f:
                ply_b64 = base64.b64encode(f.read()).decode()

            video_b64  = None
            video_path = os.path.join(out_dir, "turntable.mp4")
            if os.path.exists(video_path):
                with open(video_path, "rb") as f:
                    video_b64 = base64.b64encode(f.read()).decode()

            return {"ply_b64": ply_b64, "video_b64": video_b64}

        return api
