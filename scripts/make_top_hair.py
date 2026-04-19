import re, sys, numpy as np
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
src  = Path(sys.argv[1]) if len(sys.argv) > 1 else repo / "public/hair/preset_a.ply"
dst  = repo / "public/hair/top_hair.ply"

pct       = float(sys.argv[2]) if len(sys.argv) > 2 else 0.95
r_shrink  = float(sys.argv[3]) if len(sys.argv) > 3 else 0.8
subdiv    = int(sys.argv[4])   if len(sys.argv) > 4 else 3   # density factor

# --- read ---
raw = src.read_bytes()
hdr_end = raw.index(b"end_header\n") + len(b"end_header\n")
hdr = raw[:hdr_end].decode()

nv = int(re.search(r"element vertex (\d+)", hdr).group(1))
ne = int(re.search(r"element edge (\d+)",   hdr).group(1))

body  = memoryview(raw)[hdr_end:]
verts = np.frombuffer(body, dtype="<f8", count=nv*3).reshape(nv,3).copy()
edges = np.frombuffer(body, dtype="<i4", offset=nv*24, count=ne*2).reshape(ne,2).copy()

# --- Y cut ---
y_thresh = np.percentile(verts[:,1], pct*100)

# --- radius shrink ---
cx, cz = np.mean(verts[:,0]), np.mean(verts[:,2])
dx, dz = verts[:,0]-cx, verts[:,2]-cz
radius = np.sqrt(dx*dx + dz*dz)

top_mask = verts[:,1] >= y_thresh
r_thresh = radius[top_mask].max() * r_shrink

mask = (verts[:,1] >= y_thresh) & (radius <= r_thresh)

# --- remap filtered verts ---
old_indices = np.where(mask)[0]
remap = {old: i for i, old in enumerate(old_indices)}
base_verts = verts[old_indices]

# --- filter edges ---
filtered_edges = [(remap[a], remap[b]) for a,b in edges if mask[a] and mask[b]]

# --- subdivide edges (THIS IS THE DENSITY BOOST) ---
new_verts = base_verts.tolist()
new_edges = []

for a, b in filtered_edges:
    p1 = base_verts[a]
    p2 = base_verts[b]

    prev_idx = a

    for i in range(1, subdiv+1):
        t = i / (subdiv+1)
        new_point = (1-t)*p1 + t*p2
        new_idx = len(new_verts)
        new_verts.append(new_point)

        new_edges.append([prev_idx, new_idx])
        prev_idx = new_idx

    new_edges.append([prev_idx, b])

new_verts = np.array(new_verts, dtype="<f8")
new_edges = np.array(new_edges, dtype="<i4")

print(f"final verts: {len(new_verts)}")
print(f"final edges: {len(new_edges)}")

# --- write ---
hdr_out = (
    "ply\n"
    "format binary_little_endian 1.0\n"
    f"element vertex {len(new_verts)}\n"
    "property float64 x\n"
    "property float64 y\n"
    "property float64 z\n"
    f"element edge {len(new_edges)}\n"
    "property int32 vertex1\n"
    "property int32 vertex2\n"
    "end_header\n"
)

dst.write_bytes(
    hdr_out.encode()
    + new_verts.tobytes()
    + new_edges.tobytes()
)

print(f"saved {dst}")