"""
Image-model-based hair removal (baldifier).
Replaces the SegFormer + Telea inpainting pipeline with a single image-editing
call, which produces far more photorealistic results.
"""

import os
import io
import torch
from PIL import Image
from google import genai
from google.genai import types

PROMPT = """Remove all scalp hair from this person so they appear completely bald.

Render the scalp as smooth, natural skin — matching the exact skin tone, \
texture, and lighting of the face. Preserve the natural skull contour \
implied by the existing hairline and head shape.

Do NOT change anything else. Keep identical:
- facial features, expression, and proportions
- skin tone and texture on the face
- eyebrows and any facial hair (beard, stubble, mustache)
- ears, neck, shoulders
- pose, camera angle, framing
- lighting direction, shadows, and color grading
- background

Output must be photorealistic. No stylization, no hats, no head coverings, \
no added hair. Match the original photo's resolution and quality."""


def inpaint_hair(image_path: str, output_path: str, device: torch.device | None = None) -> str:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    client = genai.Client(api_key=api_key)

    with open(image_path, "rb") as f:
        image_bytes = f.read()

    mime_type = "image/png" if image_path.lower().endswith(".png") else "image/jpeg"

    response = client.models.generate_content(
        model="gemini-2.5-flash-image",
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            PROMPT,
        ],
        config=types.GenerateContentConfig(
            response_modalities=["image", "text"],
        ),
    )

    for part in response.candidates[0].content.parts:
        if part.inline_data is not None:
            img = Image.open(io.BytesIO(part.inline_data.data))
            img.save(output_path)
            return output_path

    raise RuntimeError("image model returned no image")


if __name__ == "__main__":
    import sys
    from pathlib import Path

    if len(sys.argv) < 2:
        print("Usage: python hair_inpaint.py <image> [output_dir]")
        sys.exit(1)

    src = Path(sys.argv[1])
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else src.parent / "baldified"
    out_dir.mkdir(parents=True, exist_ok=True)
    dst = out_dir / f"{src.stem}_bald{src.suffix}"

    print(f"Input:  {src}")
    print(f"Output: {dst}")
    inpaint_hair(str(src), str(dst))
    print("Done.")
