# ShapeUp — Project Story

## Inspiration

Every haircut starts with the same broken conversation: you sit in the chair, gesture vaguely at your own head, say "a little off the sides, but keep the length on top," and hope the barber's mental model of *you* matches yours. It almost never does. The feedback loop is ~20 minutes long, irreversible, and runs on natural language — the worst possible medium for describing 3D geometry.

We wanted to collapse that loop. What if you could *see* the haircut before the scissors touched your hair — on a model of **your actual head**, not a generic mannequin — and iterate on it the way you'd iterate on a design in Figma?

That's **ShapeUp**: scan your head with your phone, get a faithful 3D avatar, then reshape the hair with natural-language prompts like *"shorter on the sides, messier on top, faded at the neck."*

## What it does

1. **Scan.** An iOS capture app uses the TrueDepth / LiDAR sensor to produce a point cloud of the user's head.
2. **Fit.** We register that point cloud against the **FLAME** parametric head model, solving for shape, pose, and expression coefficients.
3. **Classify.** A lightweight CNN tags the user's current hair along axes of length, texture, volume, and silhouette.
4. **Render.** A `react-three-fiber` scene mounts the personalized head mesh and a parameterized hair mesh in the browser.
5. **Edit.** A Claude-powered prompt loop lets the user say what they want; the LLM returns structured `HairParams` deltas that drive mesh scales, materials, and presets — no full re-render, just parameter tweens.
6. **Export.** The final state is summarized into a barber-readable spec you can screenshot and bring to the shop.

## How we built it

**Stack:** Next.js 15 + TypeScript + Tailwind on the front; `react-three-fiber` / `three` for rendering; Anthropic's Claude (Haiku for the edit loop, larger models for the final summary) for the language layer; Python + PyTorch for FLAME fitting and the haircut classifier; Swift + ARKit for capture.

**Pipeline at a glance:**

```
iOS LiDAR  →  .ply point cloud
      ↓
FLAME fit (PyTorch)   →   shape β, expression ψ, pose θ
      ↓
Canonical head mesh deformed to user
      ↓
Hair classifier → initial HairParams
      ↓
Three.js scene (head + hair mesh zones)
      ↓
LLM edit loop: prompt → structured JSON → param tween
```

**The FLAME fit.** We minimize a standard landmark + point-to-plane energy:

$$
\mathcal{L}(\beta, \theta, \psi) \;=\; \lambda_{\text{lmk}} \sum_i \|\pi(v_i(\beta,\theta,\psi)) - \ell_i\|^2 \;+\; \lambda_{\text{geo}} \sum_p \big((v^*_p - p)\cdot n_p\big)^2 \;+\; \lambda_\beta \|\beta\|^2 + \lambda_\psi \|\psi\|^2
$$

where $v_i$ are FLAME vertices as a function of shape/pose/expression, $\ell_i$ are 2D landmarks from MediaPipe FaceMesh, $p$ is a LiDAR point with nearest-surface normal $n_p$, and the last two terms are Gaussian shape/expression priors that stop the optimizer from running off into implausible faces.

**The edit contract.** The LLM never emits geometry. It emits a tiny typed payload:

```ts
type LLMEditResponse = {
  preset?: HairPreset;
  top_length?: number;      // 0..1
  side_length?: number;     // 0..1
  back_length?: number;     // 0..1
  messiness?: number;       // 0..1
  taper?: number;           // 0..1
};
```

Keeping the LLM's output surface small is what makes the system robust. The model can't hallucinate a mesh; it can only nudge five numbers and pick a preset. Every edit is a param snapshot, which makes undo/redo a one-line push/pop on a stack.

## What we learned

- **Point-cloud alignment is 80% of the work.** Getting FLAME to converge on a noisy phone scan, without collapsing into the mean face, took more iteration than the entire frontend.
- **Structured output is the unlock for LLM-in-the-loop 3D.** Free-form text descriptions of geometry are a dead end. A 5-float schema with Zod validation turned Claude into a reliable controller instead of a creative writing assistant.
- **Latency shapes the UX more than fidelity does.** Early on we re-rendered the whole hair mesh on every edit (~800 ms). Switching to param tweens on a pre-loaded mesh dropped that to ~40 ms, and *that* is what made the product feel like a design tool instead of a slow chatbot.
- **FLAME is a generous abstraction.** Once you can express a head as a small vector $\beta \in \mathbb{R}^{100}$, a surprising amount of downstream work (symmetry, retopology, hair anchoring) becomes trivial.

## Challenges we ran into

- **LiDAR noise near the ears and hairline.** The sensor struggles exactly where hair lives. We ended up masking hair from the geometric fit with MediaPipe Selfie Segmentation and only fitting to visible skin, then re-attaching a parametric hair volume on top.
- **Coordinate system hell.** ARKit, FLAME, and Three.js each have different conventions for axis orientation and units. A single sign flip cost us about three hours; we eventually wrote a single conversion module and banned any ad-hoc transforms elsewhere.
- **Mesh zoning for editable hair.** To make `top_length`, `side_length`, `back_length` mean anything, we had to split the hair mesh into named groups (`Hair_Top`, `Hair_Side_*`, `Hair_Back`) and drive each one's scale independently. Authoring those groups cleanly across multiple hair presets was more of a 3D-art problem than a code problem.
- **Prompt engineering against user creativity.** Users say things like *"give me a David Beckham 2003."* Mapping cultural references onto five floats required a few-shot prompt with dozens of examples, plus a fallback where the LLM picks a preset and *then* tweaks it.
- **Hackathon scope discipline.** We had working demos of five things and a shipped version of zero by Saturday night. Cutting the VR try-on and the multi-angle video export was painful but correct.

## What's next

- Replace the preset library with a learned hair deformation model so edits can move continuously between styles instead of snapping to presets.
- Ship the "barber spec" as a printable card with measurements in inches/cm, so the natural-language round trip ends in something unambiguous.
- Port the capture flow to Android using MediaPipe's depth estimation, since LiDAR-only locks out most of the market.
