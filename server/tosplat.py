"""Convert a Gaussian Splatting .ply file to a .splat file."""
import sys
import numpy as np
from plyfile import PlyData

ATTRS = [
    "x", "y", "z",
    "nx", "ny", "nz",
    "f_dc_0", "f_dc_1", "f_dc_2",
    *[f"f_rest_{i}" for i in range(45)],
    "opacity",
    "scale_0", "scale_1", "scale_2",
    "rot_0", "rot_1", "rot_2", "rot_3",
]

def sigmoid(x):
    return 1 / (1 + np.exp(-x))

def ply_to_splat(src, dst):
    data = PlyData.read(src)["vertex"]
    n = len(data)

    pos    = np.stack([data["x"], data["y"], data["z"]], axis=1).astype(np.float32)
    scale  = np.exp(np.stack([data["scale_0"], data["scale_1"], data["scale_2"]], axis=1)).astype(np.float32)
    rot    = np.stack([data["rot_0"], data["rot_1"], data["rot_2"], data["rot_3"]], axis=1).astype(np.float32)
    rot   /= np.linalg.norm(rot, axis=1, keepdims=True)
    alpha  = (sigmoid(np.array(data["opacity"])) * 255).astype(np.uint8)

    SH_C0 = 0.28209479177387814
    r = np.clip((0.5 + SH_C0 * data["f_dc_0"]) * 255, 0, 255).astype(np.uint8)
    g = np.clip((0.5 + SH_C0 * data["f_dc_1"]) * 255, 0, 255).astype(np.uint8)
    b = np.clip((0.5 + SH_C0 * data["f_dc_2"]) * 255, 0, 255).astype(np.uint8)

    # sort back-to-front by z
    order = np.argsort(pos[:, 2])[::-1]

    out = np.zeros(n, dtype=[
        ("pos",   np.float32, (3,)),
        ("scale", np.float32, (3,)),
        ("rgba",  np.uint8,   (4,)),
        ("rot",   np.uint8,   (4,)),
    ])
    out["pos"]   = pos[order]
    out["scale"] = scale[order]
    out["rgba"]  = np.stack([r, g, b, alpha], axis=1)[order]
    rot_q        = rot[order]
    out["rot"]   = ((rot_q * 128 + 128).clip(0, 255)).astype(np.uint8)

    out.tobytes()
    with open(dst, "wb") as f:
        f.write(out.tobytes())
    print(f"Wrote {n} splats → {dst}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python tosplat.py input.ply output.splat")
        sys.exit(1)
    ply_to_splat(sys.argv[1], sys.argv[2])
