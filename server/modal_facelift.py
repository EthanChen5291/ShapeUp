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
        "boto3",                # upload PLY/splat straight to S3 from the GPU container
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


def ply_to_splat(ply_bytes: bytes) -> bytes:
    """Convert a Gaussian-splat PLY (binary little-endian float props) into the
    32-byte-per-splat .splat the web viewer expects.

    Byte-identical to the TypeScript plyToSplat() that previously ran in the
    Next.js route: per splat = [pos xyz f32][scale=exp(s) xyz f32][rgba u8]
    [quat normalized*128+128 u8], sorted by alpha (sigmoid(opacity)) descending.
    """
    import re

    import numpy as np

    SH_C0 = 0.28209479177387814
    end = b"end_header\n"
    header_end = ply_bytes.find(end)
    if header_end == -1:
        raise ValueError("Invalid PLY: no end_header")
    data_offset = header_end + len(end)
    header = ply_bytes[:header_end].decode("ascii", "replace")

    vmatch = re.search(r"element vertex (\d+)", header)
    if not vmatch:
        raise ValueError("No vertex count in PLY")
    vcount = int(vmatch.group(1))

    ply_type_to_np = {
        "float": "<f4", "float32": "<f4", "double": "<f8", "float64": "<f8",
        "char": "i1", "int8": "i1", "uchar": "u1", "uint8": "u1",
        "short": "<i2", "int16": "<i2", "ushort": "<u2", "uint16": "<u2",
        "int": "<i4", "int32": "<i4", "uint": "<u4", "uint32": "<u4",
    }
    props = re.findall(r"^property (\S+) (\S+)$", header, re.MULTILINE)
    if not props:
        raise ValueError("No properties in PLY")
    dtype = np.dtype([(name, ply_type_to_np.get(t, "<f4")) for t, name in props])
    data = np.frombuffer(ply_bytes, dtype=dtype, count=vcount, offset=data_offset)

    # Compute in float64 like JS, but round-trip through float32 at each store
    # point (JS held these in Float32Arrays). This makes the output byte-for-byte
    # identical to the old TypeScript plyToSplat() — verified against it.
    def col(name: str) -> "np.ndarray":
        return data[name].astype(np.float64)

    def f32(v: "np.ndarray") -> "np.ndarray":
        return v.astype(np.float32).astype(np.float64)

    x, y, z = col("x"), col("y"), col("z")
    r = f32(np.clip(0.5 + SH_C0 * col("f_dc_0"), 0.0, 1.0))
    g = f32(np.clip(0.5 + SH_C0 * col("f_dc_1"), 0.0, 1.0))
    b = f32(np.clip(0.5 + SH_C0 * col("f_dc_2"), 0.0, 1.0))
    a = f32(1.0 / (1.0 + np.exp(-col("opacity"))))
    sx = f32(np.exp(col("scale_0")))
    sy = f32(np.exp(col("scale_1")))
    sz = f32(np.exp(col("scale_2")))

    quat = np.stack([col("rot_0"), col("rot_1"), col("rot_2"), col("rot_3")], axis=0)
    qlen = np.maximum(1e-8, np.sqrt((quat * quat).sum(axis=0)))
    quat = f32(quat / qlen)

    # Stable sort by (float32) alpha desc — matches JS Array.sort tie behaviour.
    order = np.argsort(-a, kind="stable")

    def u8(v: "np.ndarray") -> "np.ndarray":
        # JS Math.round == floor(x + 0.5); exact for the non-negative values here.
        return np.clip(np.floor(v + 0.5), 0, 255).astype(np.uint8)

    out_dt = np.dtype([
        ("pos", "<f4", 3),
        ("scale", "<f4", 3),
        ("rgba", "u1", 4),
        ("quat", "u1", 4),
    ])  # 32 bytes
    out = np.empty(vcount, out_dt)
    out["pos"][:, 0], out["pos"][:, 1], out["pos"][:, 2] = x[order], y[order], z[order]
    out["scale"][:, 0], out["scale"][:, 1], out["scale"][:, 2] = sx[order], sy[order], sz[order]
    out["rgba"][:, 0] = u8(r[order] * 255)
    out["rgba"][:, 1] = u8(g[order] * 255)
    out["rgba"][:, 2] = u8(b[order] * 255)
    out["rgba"][:, 3] = u8(a[order] * 255)
    out["quat"][:, 0] = u8(quat[0][order] * 128 + 128)
    out["quat"][:, 1] = u8(quat[1][order] * 128 + 128)
    out["quat"][:, 2] = u8(quat[2][order] * 128 + 128)
    out["quat"][:, 3] = u8(quat[3][order] * 128 + 128)
    return out.tobytes()


@app.cls(
    gpu="L40S",
    # Scale to zero as fast as the client allows (must be > 0). Effectively "no warm
    # window" — fine while traffic is ~zero; bump this up once requests start clustering.
    scaledown_window=5,
    # Hard cap on concurrent GPUs — bounds peak demo spend regardless of load.
    # The app-side monthly GPU-seconds guard (convex/gpuUsage.ts) bounds total.
    max_containers=2,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
    volumes={WEIGHTS_DIR: weights_volume},
    # AWS creds + bucket for uploading results straight to S3 from the container.
    # Secret must contain AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION /
    # AWS_S3_BUCKET_NAME (create with `modal secret create shapeup-aws-s3 ...`).
    secrets=[modal.Secret.from_name("shapeup-aws-s3")],
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
        vram_gb = torch.cuda.memory_allocated(self.device) / 1024**3
        print(
            f"[facelift] Models on GPU (VRAM allocated {vram_gb:.2f} GB) — snapshotting.",
            flush=True,
        )

    @modal.asgi_app()
    def serve(self):
        import asyncio
        import os
        import shutil
        import sys
        import time
        import uuid
        from io import BytesIO

        from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
        from PIL import Image, UnidentifiedImageError

        sys.path.insert(0, FACELIFT_DIR)
        from inference import process_single_image

        import boto3

        api   = FastAPI()
        _lock = asyncio.Lock()
        shared_secret = os.environ.get("FACELIFT_SHARED_SECRET")
        max_image_bytes = 6 * 1024 * 1024
        max_pixels = 12_000_000
        s3 = boto3.client("s3")  # creds + region come from the attached AWS secret
        bucket = os.environ["AWS_S3_BUCKET_NAME"]

        @api.post("/process_image")
        async def process_image(
            image: UploadFile = File(...),
            # The web viewer only consumes the .splat. The raw ~40 MB .ply is
            # uploaded to S3 only when the caller asks for it (need_ply=true),
            # e.g. the hair-subtraction flow that diffs two Gaussian clouds.
            # Skipping it removes the dominant chunk of the S3 upload time.
            need_ply: bool = Form(default=False),
            x_shapeup_facelift_secret: str | None = Header(default=None),
        ):
            if shared_secret and x_shapeup_facelift_secret != shared_secret:
                print("[facelift] 401 — bad or missing shared secret", flush=True)
                raise HTTPException(401, "Unauthorized")

            req_start  = time.perf_counter()
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
            print(
                f"[facelift] {job_id} received — {len(raw) / 1024:.0f} KB upload",
                flush=True,
            )
            if len(raw) > max_image_bytes:
                print(f"[facelift] {job_id} 413 — upload too large ({len(raw)} B)", flush=True)
                raise HTTPException(413, "Image is too large")
            try:
                with Image.open(BytesIO(raw)) as img:
                    img.verify()
                    width, height = img.size
            except UnidentifiedImageError as exc:
                print(f"[facelift] {job_id} 400 — unidentifiable image", flush=True)
                raise HTTPException(400, "Invalid image") from exc
            if width * height > max_pixels:
                print(
                    f"[facelift] {job_id} 413 — too many pixels ({width}x{height})",
                    flush=True,
                )
                raise HTTPException(413, "Image has too many pixels")

            print(f"[facelift] {job_id} accepted — {width}x{height} px", flush=True)

            with open(img_path, "wb") as f:
                f.write(raw)

            try:
                queue_wait = time.perf_counter() - req_start
                async with _lock:
                    print(
                        f"[facelift] {job_id} GPU acquired (waited {queue_wait:.2f}s) — "
                        f"running inference",
                        flush=True,
                    )
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
                print(f"[facelift] {job_id} inference done in {elapsed_s}s", flush=True)

                ply_path = os.path.join(output_dir, "gaussians.ply")
                if not os.path.exists(ply_path):
                    print(
                        f"[facelift] {job_id} 500 — no gaussians.ply at {ply_path}",
                        flush=True,
                    )
                    raise HTTPException(500, "FaceLift produced no gaussians.ply")

                with open(ply_path, "rb") as f:
                    ply_bytes = f.read()

                # Convert + upload here so the GPU container — not the Next.js route —
                # does the heavy lifting, and only tiny S3 keys travel back over HTTP.
                convert_start = time.perf_counter()
                splat_bytes = ply_to_splat(ply_bytes)
                convert_s = round(time.perf_counter() - convert_start, 3)

                upload_start = time.perf_counter()
                splat_key = f"facelifts/{job_id}/output.splat"
                s3.put_object(Bucket=bucket, Key=splat_key, Body=splat_bytes,
                              ContentType="application/octet-stream")
                # The 40 MB+ .ply dominates upload time; only ship it when asked.
                ply_key = None
                if need_ply:
                    ply_key = f"facelifts/{job_id}/output.ply"
                    s3.put_object(Bucket=bucket, Key=ply_key, Body=ply_bytes,
                                  ContentType="application/octet-stream")
                upload_s = round(time.perf_counter() - upload_start, 3)

                total_s = round(time.perf_counter() - req_start, 3)
                ply_size_note = f"ply {len(ply_bytes) / 1024:.0f}KB " if need_ply else "ply skipped "
                print(
                    f"[facelift] {job_id} OK — {len(splat_bytes) // 32} splats, "
                    f"{ply_size_note}splat {len(splat_bytes) / 1024:.0f}KB, "
                    f"gpu {elapsed_s}s convert {convert_s}s upload {upload_s}s total {total_s}s",
                    flush=True,
                )
                return {
                    "job_id":         job_id,
                    "ply_s3_key":     ply_key,
                    "splat_s3_key":   splat_key,
                    "gaussian_count": len(splat_bytes) // 32,
                    "elapsed_s":      elapsed_s,
                    "queue_wait_s":   round(queue_wait, 3),
                    "convert_s":      convert_s,
                    "upload_s":       upload_s,
                    "total_s":        total_s,
                }
            except HTTPException:
                raise
            except Exception:
                import traceback
                print(
                    f"[facelift] {job_id} 500 — inference raised:\n{traceback.format_exc()}",
                    flush=True,
                )
                raise HTTPException(500, "FaceLift inference failed")
            finally:
                try:
                    os.remove(img_path)
                except OSError:
                    pass
                shutil.rmtree(output_dir, ignore_errors=True)

        return api
