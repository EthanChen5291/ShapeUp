// ============================================================
// PresetStylePanel — the FREE tab's toolbox content
// ------------------------------------------------------------
// Pick a category, then the looks lerp into a row at the top of
// the scene (PresetStyleRail) to try on over your own head. Looks
// come in your detected hair color for free; other colors are a
// paid-plan perk.
// ============================================================

'use client';

import {
  PRESET_CATEGORIES,
  getCategory,
  primaryVariant,
  HAIR_COLOR_LABEL,
  HAIR_COLOR_SWATCH,
  type HairColor,
  type PresetGender,
} from '@/data/hairPresets';

interface PresetStylePanelProps {
  isMobile?: boolean;
  category: PresetGender | null;
  onCategoryChange: (c: PresetGender | null) => void;
  userColor: HairColor;
  isPaid: boolean;
  selectedSplatUrl: string | null;
  onHoverPreset: (splatUrl: string | null) => void;
  onSelectPreset: (splatUrl: string) => void;
}

function PersonGlyph({ gender }: { gender: PresetGender }) {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="7" r="3.4" stroke="currentColor" strokeWidth="1.6" />
      {gender === 'man' ? (
        <path d="M5.5 20c0-3.6 2.9-6.2 6.5-6.2S18.5 16.4 18.5 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      ) : (
        <path d="M6 20l1.6-5.2C8.2 12.9 10 11.8 12 11.8s3.8 1.1 4.4 3L18 20M9.5 20l.7-3M14.5 20l-.7-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export default function PresetStylePanel({
  isMobile = false,
  category,
  onCategoryChange,
  userColor,
  isPaid,
  selectedSplatUrl,
  onHoverPreset,
  onSelectPreset,
}: PresetStylePanelProps) {
  const active = category ? getCategory(category) : undefined;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--biscuit-lt)', border: '1px solid rgba(42,32,26,0.1)', boxShadow: '0 30px 60px -24px rgba(0,0,0,0.45)' }}
    >
      <div className={`relative flex flex-col text-[var(--ink)] ${isMobile ? 'gap-3 px-4 pt-4 pb-4' : 'gap-5 px-5 pt-5 pb-5'}`}>
        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="inline-block w-2 h-7 barber-pole" />
          <div>
            <h2 className="font-display italic text-2xl text-[var(--ink)] leading-none" style={{ fontWeight: 500 }}>Style library</h2>
          </div>
        </div>

        {/* Step 1 — choose a category */}
        {!active && (
          <div className="flex flex-col gap-3">
            <p className="font-serif italic text-[13px] text-[var(--smoke)]">Who are we styling today?</p>
            <div className="grid grid-cols-2 gap-3">
              {PRESET_CATEGORIES.map((c) => (
                <button key={c.id} type="button" onClick={() => onCategoryChange(c.id)} className="preset-cat-card">
                  <span className="preset-cat-icon"><PersonGlyph gender={c.id} /></span>
                  <span className="preset-cat-label">{c.label}</span>
                  <span className="preset-cat-tag">{c.tagline}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — browse the looks (mirrored in the scene rail) */}
        {active && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => { onCategoryChange(null); onHoverPreset(null); }}
                className="preset-back"
                aria-label="Back to categories"
              >
                <span aria-hidden>‹</span> all styles
              </button>
              <span className="preset-color-chip" title="Detected from your scan">
                <span className="preset-orb-swatch" style={{ background: HAIR_COLOR_SWATCH[userColor] }} />
                your color · {HAIR_COLOR_LABEL[userColor]}
              </span>
            </div>

            {active.cuts.length === 0 ? (
              <div className="rounded-xl px-3 py-6 text-center font-serif italic text-[13px] text-[var(--smoke)]" style={{ background: 'rgba(42,32,26,0.04)', border: '1px dashed rgba(42,32,26,0.15)' }}>
                {active.label} looks are coming soon ✂
              </div>
            ) : (
              <>
                <p className="font-serif italic text-[12.5px] text-[var(--smoke)] leading-snug">
                  Pick a look up top to try it on — or tap one below.
                </p>

                <div className="flex flex-col gap-1.5 max-h-[42vh] overflow-y-auto cozy-scroll -mx-1 px-1">
                  {active.cuts.map((cut) => {
                    const primary = primaryVariant(cut, userColor);
                    const isSel = selectedSplatUrl === primary.splatUrl;
                    const extraColors = cut.variants.length - 1;
                    const hasUserColor = cut.variants.some((v) => v.color === userColor);
                    return (
                      <button
                        key={cut.id}
                        type="button"
                        onMouseEnter={() => onHoverPreset(primary.splatUrl)}
                        onMouseLeave={() => onHoverPreset(null)}
                        onClick={() => onSelectPreset(primary.splatUrl)}
                        className={`preset-row ${isSel ? 'preset-row-selected' : ''}`}
                      >
                        <span className="preset-row-dot" aria-hidden />
                        <span className="flex flex-col items-start leading-tight">
                          <span className="font-sans text-[13px] font-semibold text-[var(--ink)]">{cut.name}</span>
                          {cut.blurb && <span className="font-serif italic text-[11px] text-[var(--smoke)]">{cut.blurb}</span>}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5">
                          {extraColors > 0 && (
                            <span className="preset-row-colors">
                              +{extraColors} {extraColors === 1 ? 'color' : 'colors'}
                              {!isPaid && ' 🔒'}
                            </span>
                          )}
                          {!hasUserColor && !isPaid && <span className="preset-row-colors">🔒</span>}
                          {isSel && <span className="preset-row-check" aria-hidden>✓</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <p className="font-mono text-[9.5px] text-[var(--smoke)] leading-snug pt-1 border-t border-dashed border-[var(--char)]/15">
                  {isPaid
                    ? <>Every color unlocked. Switch to <span className="text-[var(--ink)] font-semibold">PRO</span> to render your own face in any look.</>
                    : <>Your color is free. <span className="text-[var(--ink)] font-semibold">Other colors</span> come with any paid plan — no tokens needed.</>}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
