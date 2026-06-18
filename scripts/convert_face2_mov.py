#!/usr/bin/env python3
"""
Convert newly-imported landing_face2 .mov files into compressed .mp4s with the
face2 speed curve baked in — identical pipeline to bake_face2_speed.py, but it
takes raw .mov inputs and writes named .mp4 outputs (instead of re-baking the
already-processed .mp4s in place).

Usage: python3 scripts/convert_face2_mov.py face2.mov face2c.mov ...
Each <name>.mov is written to <name>.mp4 in public/landing_face2/.
"""
import json, math, os, subprocess, sys

def speed_at(t):
    return 1 + 15 * math.sin(math.pi * t)

def get_video_info(path):
    data = json.loads(subprocess.run(
        ['ffprobe', '-v', 'quiet', '-of', 'json',
         '-show_entries', 'format=duration',
         '-show_entries', 'stream=r_frame_rate,nb_frames',
         '-select_streams', 'v:0', path],
        capture_output=True, text=True, check=True
    ).stdout)
    stream = data['streams'][0]
    num, den = stream['r_frame_rate'].split('/')
    fps = float(num) / float(den)
    duration = float(data['format']['duration'])
    nb_frames = int(stream.get('nb_frames', round(duration * fps)))
    return fps, duration, nb_frames

def build_frame_list(nb_frames, fps, duration, steps=200_000):
    cdf = [0.0]
    for i in range(1, steps + 1):
        t = (i - 0.5) / steps
        cdf.append(cdf[-1] + (duration / steps) / speed_at(t))
    total_out = cdf[-1]
    n_out = int(total_out * fps)

    selected = []
    for j in range(n_out):
        target = j / fps
        lo, hi = 0, steps
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if cdf[mid] <= target:
                lo = mid
            else:
                hi = mid
        span = cdf[hi] - cdf[lo]
        frac = (target - cdf[lo]) / span if span > 0 else 0
        frame = min(int(((lo + frac) / steps) * nb_frames), nb_frames - 1)
        selected.append(frame)

    return selected, total_out

def process(input_path, output_path):
    fps, duration, nb_frames = get_video_info(input_path)
    selected, out_dur = build_frame_list(nb_frames, fps, duration)
    fps_int = int(round(fps))
    print(f"  {os.path.basename(input_path)}: {duration:.2f}s → {out_dur:.2f}s  ({len(selected)} frames @ {fps_int}fps)")

    sel_expr = '+'.join(f'eq(n,{f})' for f in selected)
    subprocess.run([
        'ffmpeg', '-y', '-i', input_path,
        '-vf', f"select='{sel_expr}',setpts=N/{fps_int}/TB",
        '-vsync', '0',
        '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
        '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-an',
        output_path,
    ], check=True, capture_output=True)

root = os.path.dirname(os.path.abspath(__file__))
face2_dir = os.path.join(root, '..', 'public', 'landing_face2')

movs = sys.argv[1:]
if not movs:
    print("Usage: python3 scripts/convert_face2_mov.py <name.mov> [...]")
    sys.exit(1)

print(f"Converting {len(movs)} .mov file(s)...")
for m in movs:
    inp = os.path.join(face2_dir, m)
    out = os.path.join(face2_dir, os.path.splitext(m)[0] + '.mp4')
    process(inp, out)
    print(f"  ✓ {os.path.basename(out)}")

print("Done.")
