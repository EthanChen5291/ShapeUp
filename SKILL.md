---
name: unchopped-design
description: Unchopped design system — editorial barbershop aesthetic. Black & white first, Comic Sans + Caveat fonts, brutalist card borders, bold typographic contrast. Use when building or styling any Unchopped UI.
license: Complete terms in LICENSE.txt
---

This skill defines the Unchopped design system. All frontend work should adhere to this aesthetic: **Editorial Barbershop** — the tension between playful Comic Sans handwriting and stark, high-contrast black & white print design.

## Project Context

**App**: Unchopped — AI-powered barber appointment tool. Preview haircuts in 3D before the scissors come out.
**Audience**: Barbershop clients who want to stop second-guessing their cut.
**Tone**: Confident and a little cheeky. Not luxury-sterile, not childish — think a well-run barbershop that has personality.

## Design Direction

**Aesthetic**: Vintage Boxing Poster meets Barbershop. Every element is either BIG AND BLACK or clean white. Bebas Neue dominates — ultra condensed, all-caps, zero decoration. This is what makes it unforgettable: the scale contrast between massive condensed headlines and quiet body text. Think Muhammad Ali fight poster, not a barbershop spa menu.

**What to avoid**:
- Comic Sans, Comic Neue, Caveat, Bebas Neue — gone entirely
- Green color schemes (old botanical era — do not reintroduce)
- Warm cream/parchment backgrounds (#fdfbf6, #faf6ec) as primary surfaces
- Soft muted text that disappears into the background
- Purple gradient AI slop
- Rounded, friendly, SaaS-looking cards

## Color System

Black & white first. No accent colors unless strictly necessary for status/feedback.

```
--bw-ink:    #0d0d0d   /* near-black — primary text, borders, buttons */
--bw-mid:    #3a3a3a   /* secondary text */
--bw-sub:    #666666   /* labels, caps, muted */
--bw-faint:  #aaaaaa   /* dividers, dots, tertiary */
--bw-bg:     #ffffff   /* primary surface */
--bw-lift:   #f8f8f8   /* input fills, secondary surfaces */
--bw-line:   rgba(0,0,0,0.10)  /* borders, rules */
```

## Typography

Two fonts, no others:
- **Oswald Bold** (`var(--font-display)`, weight 700) — ALL headlines, navigation, buttons, wordmark, brand moments. Condensed but readable — can handle uppercase AND proper mixed case. Tracking: 0.01–0.02em. Size range: min 18px, max unlimited.
- **Barlow** (`var(--font-body)`, weights 400 + 600) — ALL body text, labels, form fields, secondary copy. Clean, neutral, invisible. Lets Oswald do the heavy lifting.

Rules:
- Headlines: Oswald 700, 0.02em letter-spacing, near-black, massive size, `text-transform: uppercase`
- Buttons: Oswald 700, `text-transform: uppercase`, 0.04–0.06em tracking
- Labels/caps: Barlow 600, 0.08–0.14em letter-spacing, `text-transform: uppercase`, `--bw-sub`
- Body/secondary: Barlow 400, `--bw-mid`, 16–18px
- Never use Comic Sans, Comic Neue, Caveat, Bebas Neue, Inter, Roboto, system-ui

## Cards & Components

**Card pattern** — brutalist offset shadow:
```css
background: #fff;
border: 2px solid #0d0d0d;
border-radius: 4–8px;         /* minimal rounding */
box-shadow: 6px 6px 0 0 #0d0d0d;
```
Top accent: 5px solid #0d0d0d bar at card top. No tape, no polaroid warmth.

**Buttons**:
- Primary: solid `#0d0d0d` fill, white text, 2px border, 3px offset shadow
- Secondary/ghost: white fill, 2px `#0d0d0d` border, `#0d0d0d` text
- No rounded pill shapes for action buttons — use `border-radius: 8px`

**Inputs**:
- Background: `#f8f8f8`
- Border: 2px solid `#0d0d0d`
- Focus: `box-shadow: 3px 3px 0 0 #0d0d0d`

**Badges/pills**:
- Outline style: 2px border `#0d0d0d`, transparent fill, black text
- Live pulse dot: black, not green

## Motion

Keep existing animations — they work:
- `ucVineDraw` / `ucStrikeDraw` / `ucScribbleDraw` — SVG path draw-ons for headline decoration
- `flipDigit` — countdown digit flips
- `fadeUp` with staggered delays — page load reveals
- `ucLivePulse` — live status dot

Draw-on strokes: always `#0d0d0d`. Scribble underlines: `#0d0d0d`.

## Backgrounds & Texture

- Primary surface: pure white `#ffffff`
- Texture: subtle paper grain via SVG feTurbulence at `opacity: 0.5`, `mix-blend-mode: multiply`
- Decorative corners: diagonal barber-stripe pattern, `#0d0d0d` at `opacity: 0.08`
- No colorful gradient blobs. No watercolor washes.

## What Not To Do

- No `#5fa454` / `#86c47a` / `#e0eede` green anywhere
- No `#fdfbf6` cream or warm beige backgrounds
- No `#9c9085` muted gray text — minimum readable text is `#666`
- No tape decorations, polaroid frames, or botanical watercolor elements
- No blue shadow on buttons (`rgba(31,74,138,...)`)
