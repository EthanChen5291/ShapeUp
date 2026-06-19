"""
Convert a 3DGS PLY file to the .splat binary format expected by @react-three/drei's Splat component.

.splat record layout (32 bytes each):
  [0..11]  position: 3 x float32 (x, y, z)
  [12..23] scale:    3 x float32 (exp(scale_0), exp(scale_1), exp(scale_2))
  [24..27] color:    4 x uint8  (r, g, b, opacity)
  [28..31] rotation: 4 x uint8  (rot_0..3 as (val*128+128) clamped to [0,255])

Matches the TypeScript plyToSplat in src/app/api/facelift/route.ts exactly:
  - Sorts splats by descending opacity (required for correct alpha blending)
  - Normalizes quaternions before packing
  - SH DC → linear color: channel = 0.5 + SH_C0 * f_dc_i
  - Opacity: sigmoid(raw_opacity)
"""

import struct, math, sys
from pathlib import Path

SH_C0 = 0.28209479177387814

def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x))

def float_to_u8(v):
    return max(0, min(255, int(round(v * 255))))

def rot_to_u8(v):
    return max(0, min(255, int(round(v * 128 + 128))))

def convert(src: Path, dst: Path):
    with open(src, 'rb') as f:
        header_bytes = b''
        while True:
            line = f.readline()
            header_bytes += line
            if b'end_header' in line:
                break
        header = header_bytes.decode('utf-8', errors='replace')

        props = []
        for ln in header.splitlines():
            if ln.startswith('property float '):
                props.append(ln.split()[-1])

        n_verts = int(next(
            ln.split()[-1] for ln in header.splitlines() if ln.startswith('element vertex')
        ))
        stride = len(props) * 4

        idx = {name: i for i, name in enumerate(props)}
        required = ['x','y','z','scale_0','scale_1','scale_2','f_dc_0','f_dc_1','f_dc_2','opacity','rot_0','rot_1','rot_2','rot_3']
        for r in required:
            if r not in idx:
                raise ValueError(f"Missing property: {r}")

        data = f.read(n_verts * stride)

    fmt = '<' + 'f' * len(props)

    # Parse all vertices
    splats = []
    for i in range(n_verts):
        vals = struct.unpack_from(fmt, data, i * stride)
        x  = vals[idx['x']]
        y  = vals[idx['y']]
        z  = vals[idx['z']]
        sx = math.exp(vals[idx['scale_0']])
        sy = math.exp(vals[idx['scale_1']])
        sz = math.exp(vals[idx['scale_2']])
        r  = float_to_u8(max(0.0, 0.5 + SH_C0 * vals[idx['f_dc_0']]))
        g  = float_to_u8(max(0.0, 0.5 + SH_C0 * vals[idx['f_dc_1']]))
        b  = float_to_u8(max(0.0, 0.5 + SH_C0 * vals[idx['f_dc_2']]))
        a  = sigmoid(vals[idx['opacity']])

        # Normalize quaternion (matches TypeScript)
        q0r = vals[idx['rot_0']]
        q1r = vals[idx['rot_1']]
        q2r = vals[idx['rot_2']]
        q3r = vals[idx['rot_3']]
        qlen = max(1e-8, math.sqrt(q0r*q0r + q1r*q1r + q2r*q2r + q3r*q3r))
        q0 = rot_to_u8(q0r / qlen)
        q1 = rot_to_u8(q1r / qlen)
        q2 = rot_to_u8(q2r / qlen)
        q3 = rot_to_u8(q3r / qlen)

        splats.append((x, y, z, sx, sy, sz, r, g, b, a, q0, q1, q2, q3))

    # Sort by descending opacity (matches TypeScript)
    splats.sort(key=lambda s: s[9], reverse=True)

    out = bytearray(n_verts * 32)
    for i, (x, y, z, sx, sy, sz, r, g, b, a, q0, q1, q2, q3) in enumerate(splats):
        base = i * 32
        struct.pack_into('<fff', out, base,      x, y, z)
        struct.pack_into('<fff', out, base + 12, sx, sy, sz)
        struct.pack_into('4B',  out, base + 24, r, g, b, float_to_u8(a))
        struct.pack_into('4B',  out, base + 28, q0, q1, q2, q3)

    dst.write_bytes(out)
    print(f"Wrote {n_verts} splats → {dst}  ({dst.stat().st_size / 1024 / 1024:.1f} MB)")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python ply_to_splat.py input.ply output.splat")
        sys.exit(1)
    convert(Path(sys.argv[1]), Path(sys.argv[2]))
