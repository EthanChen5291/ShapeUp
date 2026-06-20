"""
Modal deployment for FaceLift head reconstruction (brubru6707/facelift).

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
modal.com → your workspace → Settings → Members → Invite member.

Memory snapshot
---------------
On first deploy the container downloads ~7 GB of weights into the Volume and
Modal snapshots CPU RAM + GPU VRAM. Subsequent cold starts restore from the
snapshot in ~10–15 s. The snapshot materialises after ~3–5 cold boots.

Weights location
----------------
The repo's inference.py downloads HF weights to {FACELIFT_DIR}/checkpoints/.
We mount the weights Volume there so downloads survive across deploys.

Synchronous design
------------------
POST /process_image accepts a multipart image, runs FaceLift inference
(~15–20 s on L40S), and returns JSON with base64-encoded PLY.
The Next.js route.ts decodes, converts PLY → splat, and uploads both to S3.
An asyncio.Lock serialises GPU access within a container; Modal auto-scales
to additional containers for concurrent users.
"""

import modal

APP_NAME     = "shapeup-facelift"
FACELIFT_DIR = "/facelift"
WEIGHTS_DIR  = f"{FACELIFT_DIR}/checkpoints"   # Volume mounted here so weights persist

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
        "build-essential", "cmake", "ninja-build", "clang",
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
        "onnxruntime",          # required by rembg
        "numpy==1.26.4",
        "matplotlib==3.7.5",
        "scikit-learn==1.3.2",
        "einops==0.8.0",
        "jaxtyping==0.2.19",
        "pytorch-msssim==1.0.0",
        "easydict==1.13",
        "pyyaml==6.0.2",
        "wandb==0.19.1",
        "termcolor==2.4.0",
        "plyfile==1.0.3",
        "tqdm",
        "rich",
        "videoio==0.3.0",
        "ffmpeg-python==0.2.0",
        "fastapi",
        "uvicorn[standard]",
        "python-multipart",
    )
    .run_commands(
        "pip install facenet-pytorch --no-deps",
        "pip install ninja wheel",
        # Clone the optimised fork with its diff-gaussian-rasterization submodule
        f"git clone --recurse-submodules https://github.com/brubru6707/facelift {FACELIFT_DIR}",
        # Build CUDA extension from the bundled submodule (matches what Oscar does)
        # Targets: A100 (8.0), A10G (8.6), L40S (8.9)
        f"TORCH_CUDA_ARCH_LIST='8.0;8.6;8.9' pip install --no-build-isolation {FACELIFT_DIR}/diff-gaussian-rasterization",
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
    gpu="L40S",
    scaledown_window=0,
    # Hard cap on concurrent GPUs — bounds peak demo spend regardless of load.
    # The app-side monthly GPU-seconds guard (convex/gpuUsage.ts) bounds total.
    max_containers=2,
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
            get_model_paths,
            initialize_face_detector,
            initialize_mvdiffusion_pipeline,
            initialize_gslrm_model,
            setup_camera_parameters,
        )
        self.device = torch.device("cuda:0")

        # get_model_paths() downloads HF weights into FACELIFT_DIR/checkpoints/
        # on first run; subsequent runs find them already on the Volume.
        mvdiffusion_path, gslrm_ckpt_path, gslrm_cfg_path = get_model_paths()

        self.face_detector = initialize_face_detector(self.device)
        self.mv_pipeline, self.generator, self.color_prompt_embeddings = (
            initialize_mvdiffusion_pipeline(mvdiffusion_path, self.device)
        )
        self.gslrm_model = initialize_gslrm_model(gslrm_ckpt_path, gslrm_cfg_path, self.device)
        self.camera_intrinsics, self.camera_extrinsics = setup_camera_parameters(self.device)
        self.generator.manual_seed(4)
        print("[facelift] Models on GPU — snapshotting.")

    @modal.asgi_app()
    def serve(self):
        import asyncio
        import base64
        import os
        import shutil
        import sys
        import time
        import uuid
        from io import BytesIO

        from fastapi import FastAPI, File, Header, HTTPException, UploadFile
        from PIL import Image, UnidentifiedImageError

        sys.path.insert(0, FACELIFT_DIR)
        from inference import process_single_image

        api   = FastAPI()
        _lock = asyncio.Lock()
        shared_secret = os.environ.get("FACELIFT_SHARED_SECRET")
        max_image_bytes = 6 * 1024 * 1024
        max_pixels = 12_000_000

        @api.post("/process_image")
        async def process_image(
            image: UploadFile = File(...),
            x_shapeup_facelift_secret: str | None = Header(default=None),
        ):
            if shared_secret and x_shapeup_facelift_secret != shared_secret:
                raise HTTPException(401, "Unauthorized")

            job_id     = str(uuid.uuid4())
            input_dir  = "/tmp/facelift_inputs"
            output_root = "/tmp/facelift_outputs"
            os.makedirs(input_dir, exist_ok=True)
            os.makedirs(output_root, exist_ok=True)

            # Name the image after the job so concurrent jobs never share a path.
            # inference.py derives output_dir/<image_name>/gaussians.ply from
            # the filename stem, so we get output_dir/<job_id>/gaussians.ply.
            img_filename = f"{job_id}.png"
            img_path     = os.path.join(input_dir, img_filename)
            output_dir   = os.path.join(output_root, job_id)

            raw = await image.read()
            if len(raw) > max_image_bytes:
                raise HTTPException(413, "Image is too large")
            try:
                with Image.open(BytesIO(raw)) as img:
                    img.verify()
                    width, height = img.size
            except UnidentifiedImageError as exc:
                raise HTTPException(400, "Invalid image") from exc
            if width * height > max_pixels:
                raise HTTPException(413, "Image has too many pixels")

            with open(img_path, "wb") as f:
                f.write(raw)

            try:
                async with _lock:
                    loop = asyncio.get_event_loop()
                    gpu_start = time.perf_counter()
                    await loop.run_in_executor(None, lambda: process_single_image(
                        image_file=img_filename,
                        input_dir=input_dir,
                        output_dir=output_root,
                        auto_crop=True,
                        unclip_pipeline=self.mv_pipeline,
                        generator=self.generator,
                        color_prompt_embedding=self.color_prompt_embeddings,
                        gs_lrm_model=self.gslrm_model,
                        demo_fxfycxcy=self.camera_intrinsics,
                        demo_c2w=self.camera_extrinsics,
                        guidance_scale_2D=3.0,
                        step_2D=50,
                        face_detector=self.face_detector,
                    ))
                    elapsed_s = round(time.perf_counter() - gpu_start, 3)

                ply_path = os.path.join(output_dir, "gaussians.ply")
                if not os.path.exists(ply_path):
                    raise HTTPException(500, "FaceLift produced no gaussians.ply")

                with open(ply_path, "rb") as f:
                    ply_b64 = base64.b64encode(f.read()).decode()

                return {"ply_b64": ply_b64, "video_b64": None, "elapsed_s": elapsed_s}
            finally:
                try:
                    os.remove(img_path)
                except OSError:
                    pass
                shutil.rmtree(output_dir, ignore_errors=True)

        return api
