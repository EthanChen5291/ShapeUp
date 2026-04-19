#!/usr/bin/env python3
"""
edit_hair_ply.py — Modify hair PLY strand geometry from measurement deltas.

Usage:
  python edit_hair_ply.py \
    --ply public/hair/hair_modified.ply \
    --out public/hair/hair_modified.ply \
    --json public/hair/hair_measurements.json \
    --deltas '{"backLength": 0.05, "sideWidth": 0.02}'

Coordinate convention (Y-up, Z-forward):
  +Y = up (crown)   –Z = back of head   ±X = sides
All delta values are in scene_units (same as the JSON).
"""

import argparse
import json
import sys
from datetime import datetime, timezone

import numpy as np
from plyfile import PlyData, PlyElement


# ── Strand tracing ───────────────────────────────────────────────────────────

def trace_strands(positions: np.ndarray, edges: np.ndarray) -> list[list[int]]:
    """Return list of strand vertex-index chains, root (degree-1 end) first."""
    n = len(positions)
    adj: list[list[int]] = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(int(b))
        adj[b].append(int(a))

    visited = np.zeros(n, dtype=bool)
    strands: list[list[int]] = []

    for start in range(n):
        if visited[start] or len(adj[start]) != 1:
            continue
        chain: list[int] = []
        cur, prev = start, -1
        while cur != -1:
            visited[cur] = True
            chain.append(cur)
            nxt = next((nb for nb in adj[cur] if nb != prev and not visited[nb]), -1)
            prev, cur = cur, nxt
        if len(chain) >= 2:
            strands.append(chain)
    return strands


# ── Strand classification ────────────────────────────────────────────────────

def strand_weights(positions: np.ndarray, chain: list[int]) -> dict[str, float]:
    """
    Return weights [0,1] for each region based on the strand's growth direction.
    A strand can partially belong to multiple regions.
    """
    root = positions[chain[0]]
    tip = positions[chain[-1]]
    direction = tip - root
    norm = float(np.linalg.norm(direction))
    if norm < 1e-8:
        return {"top": 0.0, "back": 0.0, "side": 0.0}
    d = direction / norm

    # d[1] > 0 → growing up (top/crown)
    # d[2] < 0 → growing toward back
    # |d[0]| large → growing sideways
    return {
        "top":  float(max(0.0,  d[1])),
        "back": float(max(0.0, -d[2])),
        "side": float(abs(d[0])),
    }


# ── Geometry modification ────────────────────────────────────────────────────

def elongate_strand(positions: np.ndarray, chain: list[int], delta: float, d: np.ndarray):
    """
    Push each vertex along unit vector `d` by delta * t,
    where t=0 at root and t=1 at tip (linear taper so root stays fixed).
    """
    n = len(chain)
    for i, idx in enumerate(chain):
        t = i / max(n - 1, 1)
        positions[idx] += d * (delta * t)


def apply_deltas(positions: np.ndarray, strands: list[list[int]], deltas: dict):
    """Dispatch measurement deltas to the appropriate strand subsets."""
    for chain in strands:
        root = positions[chain[0]]
        tip = positions[chain[-1]]
        direction = tip - root
        norm = float(np.linalg.norm(direction))
        if norm < 1e-8:
            continue
        d = direction / norm
        w = strand_weights(positions, chain)

        if "backLength" in deltas and w["back"] > 0.15:
            elongate_strand(positions, chain, deltas["backLength"] * w["back"], d)

        if "crownHeight" in deltas and w["top"] > 0.15:
            elongate_strand(positions, chain, deltas["crownHeight"] * w["top"], d)

        if "sideWidth" in deltas and w["side"] > 0.3:
            elongate_strand(positions, chain, deltas["sideWidth"] * w["side"], d)


# ── JSON measurements ────────────────────────────────────────────────────────

def recompute_measurements(positions: np.ndarray, strands: list[list[int]], measurements: dict) -> dict:
    """Update bbox + estimated fields from the (possibly modified) strand geometry."""
    tips = np.array([positions[chain[-1]] for chain in strands])
    roots = np.array([positions[chain[0]] for chain in strands])

    # Bbox over all vertices
    all_pts = positions
    bbox = {
        "minX": float(all_pts[:, 0].min()), "maxX": float(all_pts[:, 0].max()),
        "minY": float(all_pts[:, 1].min()), "maxY": float(all_pts[:, 1].max()),
        "minZ": float(all_pts[:, 2].min()), "maxZ": float(all_pts[:, 2].max()),
    }
    bbox["width"]  = bbox["maxX"] - bbox["minX"]
    bbox["height"] = bbox["maxY"] - bbox["minY"]
    bbox["depth"]  = bbox["maxZ"] - bbox["minZ"]

    # Estimated values from bbox proportions
    baseline = measurements.get("baseline", {})
    measurements["estimated"]["crownHeight"] = round(float(bbox["height"]), 4)
    measurements["estimated"]["sideWidth"]   = round(float(bbox["width"] / 2), 4)
    measurements["estimated"]["backLength"]  = round(float(bbox["depth"]), 4)
    measurements["bbox"] = bbox

    # Recompute scale params relative to baseline
    cp = measurements.get("currentParams", {})
    def safe_ratio(num: float, denom: float) -> float:
        return round(num / denom, 4) if denom > 1e-8 else 1.0

    cp["topLength"]  = safe_ratio(measurements["estimated"]["crownHeight"], baseline.get("crownHeight", 0.3))
    cp["sideLength"] = safe_ratio(measurements["estimated"]["sideWidth"],   baseline.get("sideWidth",   0.2))
    cp["backLength"] = safe_ratio(measurements["estimated"]["backLength"],  baseline.get("backLength",  0.25))
    measurements["currentParams"] = cp

    measurements["revision"]  = measurements.get("revision", 1) + 1
    measurements["timestamp"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return measurements


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ply",    required=True, help="Input PLY path")
    parser.add_argument("--out",    required=True, help="Output PLY path (may equal --ply)")
    parser.add_argument("--json",   required=True, help="hair_measurements.json path")
    parser.add_argument("--deltas", required=True, help='JSON string, e.g. {"backLength": 0.05}')
    args = parser.parse_args()

    deltas: dict = json.loads(args.deltas)

    # Load PLY
    ply = PlyData.read(args.ply)
    verts = ply["vertex"]
    positions = np.stack([
        verts["x"].astype(np.float64),
        verts["y"].astype(np.float64),
        verts["z"].astype(np.float64),
    ], axis=1).copy()

    edges_el = ply["edge"]
    edges = np.stack([
        edges_el["vertex1"].astype(np.int32),
        edges_el["vertex2"].astype(np.int32),
    ], axis=1)

    # Trace strands and apply deltas
    strands = trace_strands(positions, edges)
    apply_deltas(positions, strands, deltas)

    # Write modified PLY
    new_verts = np.array(
        list(zip(positions[:, 0], positions[:, 1], positions[:, 2])),
        dtype=[("x", "f8"), ("y", "f8"), ("z", "f8")],
    )
    PlyData([PlyElement.describe(new_verts, "vertex"), ply["edge"]], text=False).write(args.out)

    # Update JSON
    with open(args.json, "r") as f:
        measurements = json.load(f)

    measurements = recompute_measurements(positions, strands, measurements)

    with open(args.json, "w") as f:
        json.dump(measurements, f, indent=2)

    # Print updated measurements to stdout for the API route to consume
    print(json.dumps(measurements))


if __name__ == "__main__":
    main()
