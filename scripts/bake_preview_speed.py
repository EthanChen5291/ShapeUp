#!/usr/bin/env python3
"""
Pre-renders the preview speed curve into bear/nikki/ian videos so they play at 1x with no JS.

Default curve (asymmetric sine bell):
  t ∈ [0.00, 0.06] → 1x    (normal speed)
  t ∈ [0.06, 0.50] → ramps 1x → 10x   (smooth sine rising)
  t = 0.50          → 10x  (peak)
  t ∈ [0.50, 0.94] → ramps 10x → 1.5x (smooth sine falling)
  t ∈ [0.94, 1.00] → 1.5x (faster tail — never returns to 1x)

bear4 curve (ramp-up only, no deceleration):
  t ∈ [0.00, 0.06] → 1x
  t ∈ [0.06, 0.94] → ramps 1x → 10x  (quarter sine, monotonically increasing)
  t ∈ [0.94, 1.00] → 10x  (stays fast, no slowdown)

Reads from .mov originals, writes to .mp4 in public/.
Scaled to fill 1080×810 with top-anchored crop (head/hair preserved, bottom excess removed).
"""
import json, math, os, subprocess

def speed_at(t):
    if t < 0.06:
        return 1.0
    if t > 0.94:
        return 1.5
    u = (t - 0.06) / 0.88
    if u <= 0.5:
        # 1x → 10x
        return 1.0 + 9.0 * math.sin(math.pi * u)
    else:
        # 10x → 1.5x (asymmetric: higher floor on the way out)
        return 1.5 + 8.5 * math.sin(math.pi * (1.0 - u))

def speed_at_rampup(t):
    if t < 0.06:
        return 1.0
    if t >= 0.94:
        return 10.0
    u = (t - 0.06) / 0.88
    return 1.0 + 9.0 * math.sin(math.pi * u / 2)  # quarter sine: 1x → 10x, no slowdown

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

def build_frame_list(nb_frames, fps, duration, speed_fn, steps=200_000):
    cdf = [0.0]
    for i in range(1, steps + 1):
        t = (i - 0.5) / steps
        cdf.append(cdf[-1] + (duration / steps) / speed_fn(t))
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

# All outputs normalized to 1080×810 (4:3). Scale to fill (increase), then
# top-anchored crop so the subject's head is never cut.
OUT_W, OUT_H = 1080, 810

def process(input_path, output_path, speed_fn, crop_y=0):
    fps, duration, nb_frames = get_video_info(input_path)
    selected, out_dur = build_frame_list(nb_frames, fps, duration, speed_fn)
    fps_int = int(round(fps))
    print(f"  {os.path.basename(input_path)}: {duration:.2f}s → {out_dur:.2f}s  ({len(selected)} frames @ {fps_int}fps)")

    sel_expr = '+'.join(f'eq(n,{f})' for f in selected)
    vf = (
        f"select='{sel_expr}',"
        f"scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase,"
        f"crop={OUT_W}:{OUT_H}:(iw-{OUT_W})/2:{crop_y},"
        f"setpts=N/{fps_int}/TB"
    )
    subprocess.run([
        'ffmpeg', '-y', '-i', input_path,
        '-vf', vf,
        '-vsync', '0',
        '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
        '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-an',
        output_path,
    ], check=True, capture_output=True)

root = os.path.dirname(os.path.abspath(__file__))
public_dir = os.path.join(root, '..', 'public')

prefixes = ('bear', 'nikki', 'ian')
mov_files = sorted(
    f for f in os.listdir(public_dir)
    if f.endswith('.mov') and any(f.startswith(p) for p in prefixes)
)

RAMPUP_ONLY = {'bear4'}
CROP_Y = {'bear1': OUT_H // 2}  # bear1 is portrait; shift window down to raise subject

print(f"Baking speed curve into {len(mov_files)} preview videos...")
for v in mov_files:
    stem = os.path.splitext(v)[0]
    inp = os.path.join(public_dir, v)
    out = os.path.join(public_dir, stem + '.mp4')
    tmp = out + '.tmp.mp4'
    sfn = speed_at_rampup if stem in RAMPUP_ONLY else speed_at
    process(inp, tmp, sfn, crop_y=CROP_Y.get(stem, 0))
    os.replace(tmp, out)
    print(f"  ✓ {stem}.mp4")

print("Done.")
