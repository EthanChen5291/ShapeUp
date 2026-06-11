# ShapeUp — Dashboard + Live Selfie Revamp

Three files:

| File | Goes where |
|---|---|
| `LiveScanCamera.tsx` | `src/components/LiveScanCamera.tsx` (new) |
| `dashboard-revamp.tsx` | components pasted into `src/app/page.tsx` (surgical) |
| `globals-additions.css` | appended to the bottom of `src/app/globals.css` |

---

## 1 · CSS (do this first)

Append all of `globals-additions.css` to the bottom of `globals.css`. No existing
rules are overridden; everything is new-class-only. Reduced-motion handling for
all new animation is included at the end.

## 2 · `src/app/page.tsx` — surgical splices

`dashboard-revamp.tsx` is organized into numbered sections. Each replaces (or
augments) one component. **Delete the `declare function` / `interface ProjectDoc`
stubs at the top when pasting** — they exist only so the file typechecks standalone.

### 2.1 ProjectCard → replace wholesale
Paste section 1 over the existing `ProjectCard` (≈ lines 2029–2259). Same props,
same drawer/FlyingCard contract. New behavior:
- single tape piece (gold once saved), Fraunces-italic name + mono date stamp
- hover: the polaroid **straightens** from its wonk, lifts, photo zooms, one sheen sweep
- save: gold **KEEPER** stamp slams in and stays while saved
- delete: paper-crumple out (replaces the old shrink)

### 2.2 AddProjectButton → replace wholesale
Paste section 2 over the existing `AddProjectButton` (≈ lines 2262–2322). Keeps the
empty-state impact animation; adds marching-ants dashed border + rotating plus +
"new cut" caption on hover.

### 2.3 Floor headers
- Floor 0: replace the bare `<h1 className="type-chonk">My Cuts</h1>` with
  `<HomeTitle count={projects?.length} />` (section 6).
- Floor 1: replace `<h1 …>Saved</h1>` with `<SavedTitle count={savedProjects?.length} />`.

### 2.4 Saved empty state
Replace the `"No saved projects yet!"` div (≈ line 5897) with:
```tsx
<SavedEmptyState onBrowse={() => setActiveNav('home')} />
```

### 2.5 Explore floor
Replace the entire sticky-note block inside the Floor 2 wrapper (≈ lines 5927–5950)
with `<ExploreFloor />` (section 4). Keep the wrapper div's `height: vpH || '100vh'`;
move its inline `display:flex…` styling off (ExploreFloor handles its own layout):
```tsx
{/* Floor 2 — Explore */}
<div style={{ height: vpH || '100vh', position: 'relative' }}>
  <ExploreFloor />
</div>
```

### 2.6 Grid entrance (optional, recommended)
On both project grids, give each card cell the settle class:
```tsx
<div key={p._id} ref={…} className="grid-settle" style={{ ['--settle-i' as string]: i }}>
```

## 3 · Live selfie flow

### 3.1 New component
Drop `LiveScanCamera.tsx` into `src/components/`. In `page.tsx`, swap the dynamic import:
```tsx
const ScanCamera = dynamic(() => import('@/components/LiveScanCamera'), { ssr: false });
```

### 3.2 Wire your capture pipeline  ← the one TODO
Your old `ScanCamera` owned the upload step that produced
`(profile, sessionId, url)`. `LiveScanCamera` owns *capture UX only* and hands you
the dataUrl through `processCapture`:
```tsx
<ScanCamera
  hairType="straight"
  onScanComplete={handleCapture}
  onDataUrlReady={(d) => setCapturedDataUrl(d)}
  onChecksChange={(c) => setLiveChecks(c)}
  processCapture={async (dataUrl) => {
    // ⟵ paste the upload half of your old ScanCamera here
    //    (the fetch that returns UserHeadProfile + sessionId + url)
    return { profile, sessionId, url };
  }}
/>
```
Until wired, it falls through and calls `onScanComplete({} as UserHeadProfile, null, dataUrl)`
so the flow still moves during dev.

### 3.3 Live checklist in the left panel
In `ScanPopup`, add state and swap the static list:
```tsx
const [liveChecks, setLiveChecks] = useState<ChecksMap | null>(null);
```
Replace the `SELFIE_REQS.map(...)` block (the "Before you shoot" list) with:
```tsx
<LiveChecklist checks={liveChecks} />
```
(`SELFIE_REQS` and its `LetterFade` rows can then be deleted.)

## 4 · How the face checks work

Detection ladder, picked at boot:
1. **MediaPipe FaceLandmarker** (CDN, GPU, ~11 fps loop) — all six checks
2. **Native `window.FaceDetector`** — all checks except "facing forward"
3. **Manual mode** — light check only; shutter is always armed

Checks: one face · centered (box center vs oval) · distance (face height
30–68% of frame) · facing forward (nose↔eye distance symmetry) · light
(mean luma 58–215 inside the face box) · still (<5.5% drift over 600 ms).
Each uses frame hysteresis (4 frames to pass, 6 to fail) so the checklist
doesn't flicker. All-pass held for 750 ms → 3-2-1 Fraunces countdown
(cancels instantly if any check drops) → flash → polaroid develop →
`processCapture`.

Privacy note: all detection runs on-device in the browser; nothing leaves
the page until your existing upload call fires.

## 5 · CSP / network
MediaPipe loads from `cdn.jsdelivr.net` (wasm + module) and the model from
`storage.googleapis.com`. If your CSP blocks those, self-host the three files and
update the three URLs at the top of the boot block — the native/manual fallbacks
mean nothing breaks if the CDN is unreachable.
