'use client';

/* ════════════════════════════════════════════════════════════════
   DASHBOARD REVAMP — surgical replacements for src/app/page.tsx
   ════════════════════════════════════════════════════════════════

   This file contains drop-in replacements + new components:

   1. ProjectCard        → replaces the existing ProjectCard
   2. AddProjectButton   → replaces the existing AddProjectButton
   3. SavedEmptyState    → replaces the "No saved projects yet!" div
   4. ExploreFloor       → replaces the sticky-note Floor 2 block
   5. LiveChecklist      → new: live selfie requirements for ScanPopup
                           (driven by LiveScanCamera.onChecksChange)

   They use only symbols already in page.tsx scope (BouncyButton,
   BarberMascot, ProjectDoc, etc). Paste each over its predecessor;
   new CSS goes at the bottom of globals.css (globals-additions.css).
   ════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';
import {
  CHECK_META, CHECK_ORDER,
  type ChecksMap, type CheckKey,
} from '@/components/LiveScanCamera';

/* These exist in page.tsx already — declared here only so this file
   typechecks standalone. Delete when pasting into page.tsx. */
declare const BouncyButton: React.FC<{ onClick?: () => void; className?: string; style?: React.CSSProperties; disabled?: boolean; children: React.ReactNode }>;
declare const BarberMascot: React.FC<{ snap?: boolean; size?: 'full' | 'sm'; isStatic?: boolean; color?: string }>;
interface ProjectDoc {
  _id: string; name: string; thumbnailUrl?: string;
  updatedAt: number; savedAt?: number;
}

/* tiny date stamp: "JUN 04 ’26" */
function stampDate(ms: number) {
  const d = new Date(ms);
  const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  return `${mon} ${String(d.getDate()).padStart(2, '0')} \u2019${String(d.getFullYear()).slice(2)}`;
}

/* ────────────────────────────────────────────────────────────────
   1. ProjectCard — the pinned polaroid
   Same props/contract as before (drawer, delete, save → FlyingCard).
   New: tape corner (gold when saved), Fraunces handwritten caption,
   mono date stamp, hover straighten+lift+sheen, KEEPER stamp slam,
   paper-crumple delete.
   ──────────────────────────────────────────────────────────────── */
export function ProjectCard({
  project,
  onClick,
  rotate = 0,
  onDelete,
  onSave,
}: { project: ProjectDoc; onClick: () => void; rotate?: number; onDelete?: () => void; onSave?: (cardRect: DOMRect) => void }) {
  const [zooming, setZooming] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [stamping, setStamping] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [arrowHovered, setArrowHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const DRAWER_H = 72;
  const EASE = 'cubic-bezier(0,0,0.2,1)';
  const DUR = '270ms';
  const isSaved = !!project.savedAt;

  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) setDrawerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [drawerOpen]);

  const handleCardClick = () => {
    if (drawerOpen) return;
    setZooming(true);
    setTimeout(onClick, 480);
  };

  const handleDelete = () => {
    setDrawerOpen(false);
    setTimeout(() => {
      setIsDeleting(true);
      setTimeout(() => { onDelete?.(); }, 420);
    }, 280);
  };

  const handleSave = () => {
    setDrawerOpen(false);
    setTimeout(() => {
      if (!isSaved) {
        setStamping(true);
        setTimeout(() => setStamping(false), 1100);
      }
      if (cardRef.current) onSave?.(cardRef.current.getBoundingClientRect());
    }, 240);
  };

  return (
    <div
      ref={cardRef}
      className={`pcard ${zooming ? 'project-zoom' : ''} ${isDeleting ? 'pcard-crumple' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        // hover: the polaroid straightens off the wall and lifts
        transform: isDeleting
          ? undefined
          : isHovered
          ? 'rotate(0deg) translateY(-5px) scale(1.015)'
          : `rotate(${rotate}deg)`,
        ['--pcard-wonk' as string]: `${rotate}deg`,
        boxShadow: isHovered
          ? '0 22px 44px -14px rgba(42,32,26,0.32)'
          : 'var(--shadow-md)',
        outline: isSaved ? '1.5px solid rgba(212,175,55,0.45)' : '1.5px solid rgba(42,32,26,0.14)',
        pointerEvents: isDeleting ? 'none' : 'auto',
      }}
    >
      {/* tape — single piece, top-left; turns gold once saved */}
      <div className={`pcard-tape ${isSaved ? 'pcard-tape-gold' : ''}`} aria-hidden />

      {/* tool tray — perforated ticket-stub edge, behind the content */}
      <div className="pcard-tray" style={{ height: DRAWER_H }}>
        <button
          className="pcard-chip pcard-chip-cherry"
          onClick={(e) => { e.stopPropagation(); handleDelete(); }}
          aria-label="Delete cut"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
          </svg>
        </button>
        <button
          className={`pcard-chip ${isSaved ? 'pcard-chip-gold' : 'pcard-chip-butter'}`}
          onClick={(e) => { e.stopPropagation(); handleSave(); }}
          aria-label={isSaved ? 'Remove from saved' : 'Save cut'}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <path d="M5 3H19V21L12 15.5L5 21Z" />
          </svg>
        </button>
        <span className="font-mono pcard-tray-label">edit · this cut</span>
      </div>

      {/* content — photo + handwritten caption, slides up to expose tray */}
      <div
        onClick={handleCardClick}
        className="pcard-content"
        style={{
          transform: drawerOpen ? `translateY(-${DRAWER_H}px)` : 'translateY(0)',
          transition: `transform ${DUR} ${EASE}`,
        }}
      >
        <div className="pcard-photo">
          {project.thumbnailUrl ? (
            <img
              src={project.thumbnailUrl}
              alt={project.name}
              className="pcard-img"
              style={{ transform: isHovered ? 'scale(1.045)' : 'scale(1)' }}
            />
          ) : (
            <div className="pcard-placeholder">
              <div style={{ width: 42, opacity: 0.22, transform: 'rotate(186deg)' }}>
                <BarberMascot isStatic color="var(--ink)" />
              </div>
            </div>
          )}
          {/* one-shot sheen sweep on hover */}
          <span key={isHovered ? 'on' : 'off'} className={isHovered ? 'pcard-sheen' : ''} aria-hidden />
        </div>

        {/* polaroid caption band */}
        <div className="pcard-caption">
          <span className="font-display pcard-name">{project.name}</span>
          <span className="font-mono pcard-date">{stampDate(project.updatedAt)}</span>
        </div>
      </div>

      {/* KEEPER stamp — slams in on save, stays as a corner mark while saved */}
      {(stamping || isSaved) && (
        <span className={`font-mono pcard-stamp ${stamping ? 'pcard-stamp-slam' : ''}`} aria-hidden>
          KEEPER
        </span>
      )}

      {/* tray toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); setDrawerOpen(o => !o); }}
        onMouseEnter={(e) => { e.stopPropagation(); setArrowHovered(true); }}
        onMouseLeave={(e) => { e.stopPropagation(); setArrowHovered(false); }}
        className="pcard-arrow"
        style={{
          bottom: drawerOpen ? DRAWER_H + 12 : 12,
          color: arrowHovered ? 'var(--tomato)' : 'var(--ink)',
          borderColor: arrowHovered ? 'rgba(217,78,58,0.7)' : isSaved ? 'rgba(212,175,55,0.55)' : 'rgba(42,32,26,0.25)',
          transform: arrowHovered ? 'scale(1.16)' : 'scale(1)',
        }}
        aria-label="Card actions"
      >
        <svg width="11" height="11" viewBox="0 0 10 10" fill="none"
          style={{ transform: drawerOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: `transform ${DUR} ${EASE}` }}>
          <path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   2. AddProjectButton — the fresh sheet
   Dashed marching-ants border on hover, plus rotates a quarter turn,
   "new cut" caption fades in. Keeps the empty-state impact anim.
   ──────────────────────────────────────────────────────────────── */
export function AddProjectButton({ onClick, isEmpty }: { onClick: () => void; isEmpty?: boolean }) {
  const [animPhase, setAnimPhase] = useState<'pre' | 'falling' | 'impact' | 'done'>('pre');
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!isEmpty) { setAnimPhase('pre'); return; }
    setAnimPhase('pre');
    const t1 = setTimeout(() => setAnimPhase('falling'), 600);
    const t2 = setTimeout(() => setAnimPhase('impact'), 1800);
    const t3 = setTimeout(() => setAnimPhase('done'), 5200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isEmpty]);

  const isImpact = animPhase === 'impact';

  return (
    <div style={{ position: 'relative', overflow: 'visible' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <BouncyButton
        onClick={onClick}
        className={`fresh-sheet ${hovered ? 'fresh-sheet-live' : ''}`}
        style={{ aspectRatio: '3/4', width: '100%' }}
      >
        {/* marching-ants dashed frame */}
        <svg className="fresh-sheet-ants" aria-hidden>
          <rect rx="15" ry="15" fill="none" stroke="rgba(42,32,26,0.32)" strokeWidth="1.5" strokeDasharray="7 6" />
        </svg>

        <span
          className="text-[var(--ink)] font-sans font-bold fresh-sheet-plus"
          style={{
            fontSize: 34, opacity: 0.72, lineHeight: 1, display: 'block',
            transform: hovered ? 'rotate(90deg) scale(1.18)' : 'rotate(0deg) scale(1)',
            animation: isImpact ? 'empty-impact-shared 3.4s linear both' : 'none',
          }}
        >
          <span style={{ display: 'block', animation: isImpact ? 'empty-plus-swell 0.45s cubic-bezier(.2,.85,.2,1) both' : 'none' }}>
            +
          </span>
        </span>

        <span className="font-display fresh-sheet-label" style={{ opacity: hovered ? 1 : 0, transform: hovered ? 'translateY(0)' : 'translateY(6px)' }}>
          new cut
        </span>
      </BouncyButton>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   3. SavedEmptyState — replaces the bare "No saved projects yet!"
   A dashed ghost polaroid with a swinging bookmark, plus a jump
   back to Home. Wire onBrowse={() => setActiveNav('home')}.
   ──────────────────────────────────────────────────────────────── */
export function SavedEmptyState({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 64, gap: 26 }}>
      <div className="saved-ghost">
        <svg className="saved-ghost-frame" aria-hidden>
          <rect rx="14" ry="14" fill="none" stroke="rgba(252,245,228,0.3)" strokeWidth="1.5" strokeDasharray="8 7" />
        </svg>
        <svg className="saved-ghost-bookmark" width="34" height="34" viewBox="0 0 24 24" fill="none"
          stroke="rgba(212,175,55,0.9)" strokeWidth="2" strokeLinejoin="round" aria-hidden>
          <path d="M5 3H19V21L12 15.5L5 21Z" />
        </svg>
        <span className="font-display saved-ghost-caption">your keepers go here</span>
      </div>
      <p style={{
        margin: 0, maxWidth: 380, textAlign: 'center',
        fontFamily: 'var(--font-dmsans)', fontSize: 14, lineHeight: 1.55,
        color: 'rgba(252,245,228,0.55)',
      }}>
        Nothing pinned yet. Tap the bookmark on any cut and it lands on this wall.
      </p>
      <BouncyButton onClick={onBrowse} className="btn btn-cream" style={{ padding: '11px 26px', fontSize: 13 }}>
        ✂ Browse my cuts
      </BouncyButton>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   4. ExploreFloor — replaces the Floor 2 sticky-note block.
   A teaser wall: six ghost polaroids idling at different phases,
   each stamped SOON, behind an honest "in development" ticket and
   a mono marquee. Drop into the Floor 2 wrapper div.
   ──────────────────────────────────────────────────────────────── */
const TEASER_TAGS = ['taper', 'crop', 'fringe', 'fade', 'flow', 'buzz'];

export function ExploreFloor() {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '0 40px', gap: 36,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* heading */}
      <div style={{ textAlign: 'center' }}>
        <h1 className="type-chonk" style={{ margin: 0, fontSize: 'clamp(3.6rem, 6vw, 5.5rem)', color: 'var(--ink)', lineHeight: 0.9 }}>
          Explore <em style={{ color: 'var(--tomato)' }}>soon</em>
        </h1>
        <p style={{
          margin: '14px auto 0', maxWidth: 420,
          fontFamily: 'var(--font-dmsans)', fontSize: 14, lineHeight: 1.55, color: 'rgba(42,32,26,0.6)',
        }}>
          A wall of looks from the neighborhood — browse by face shape, pin what works, walk in with a reference.
        </p>
      </div>

      {/* teaser wall */}
      <div className="explore-wall">
        {TEASER_TAGS.map((tag, i) => (
          <div
            key={tag}
            className="explore-ghost"
            style={{
              ['--eg-wonk' as string]: `${[-1.3, 0.9, -0.6, 1.2, -0.9, 0.7][i]}deg`,
              ['--eg-phase' as string]: `${i * -0.7}s`,
            }}
          >
            <div className="explore-ghost-photo">
              <div style={{ width: 34, opacity: 0.18, transform: 'rotate(186deg)' }}>
                <BarberMascot isStatic color="var(--ink)" />
              </div>
            </div>
            <span className="font-display explore-ghost-tag">{tag}</span>
            <span className="font-mono explore-ghost-stamp">SOON</span>
          </div>
        ))}
      </div>

      {/* honest dev ticket */}
      <div className="explore-ticket">
        <span className="inline-block w-2 h-5 barber-pole" />
        <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(42,32,26,0.7)', fontWeight: 700 }}>
          actively in development
        </span>
      </div>

      {/* mono marquee — pinned to the floor's bottom edge */}
      <div className="explore-marquee" aria-hidden>
        <div className="explore-marquee-track font-mono">
          {Array.from({ length: 2 }).map((_, r) => (
            <span key={r}>
              FRESH CUTS&nbsp;&nbsp;✂&nbsp;&nbsp;TRENDING STYLES&nbsp;&nbsp;✂&nbsp;&nbsp;BARBER PICKS&nbsp;&nbsp;✂&nbsp;&nbsp;FACE-SHAPE MATCHES&nbsp;&nbsp;✂&nbsp;&nbsp;
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   6. HomeTitle / SavedTitle — floor headers with motion.
   HomeTitle: butter highlighter swipes in behind "Cuts", plus a
   mono count ticket that pops when the number changes.
   SavedTitle: gold scribble draws itself under the word.
   Splice in place of the bare <h1 class="type-chonk"> blocks.
   ──────────────────────────────────────────────────────────────── */
export function HomeTitle({ count }: { count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
      <h1 className="type-chonk" style={{ margin: 0, fontSize: 'clamp(4.5rem, 7vw, 6.5rem)', color: 'var(--ink)', lineHeight: 0.88 }}>
        My{' '}
        <span className="hl-swipe-wrap">
          <span className="hl-swipe" aria-hidden />
          <span style={{ position: 'relative' }}>Cuts</span>
        </span>
      </h1>
      {count !== undefined && (
        <span key={count} className="font-mono count-ticket">
          № {String(count).padStart(2, '0')}
        </span>
      )}
    </div>
  );
}

export function SavedTitle({ count }: { count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
      <h1 className="type-chonk" style={{ margin: 0, fontSize: 'clamp(4.5rem, 7vw, 6.5rem)', color: '#fcf5e4', lineHeight: 0.88, position: 'relative', display: 'inline-block' }}>
        Saved
        <svg className="gold-scribble" viewBox="0 0 220 18" preserveAspectRatio="none" aria-hidden>
          <path d="M4 12 C 40 4, 72 16, 110 9 S 185 4, 216 11" fill="none"
            stroke="rgba(212,175,55,0.85)" strokeWidth="4" strokeLinecap="round"
            pathLength="1" />
        </svg>
      </h1>
      {count !== undefined && count > 0 && (
        <span key={count} className="font-mono count-ticket count-ticket-gold">
          № {String(count).padStart(2, '0')}
        </span>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   7. Grid entrance — wrap each card cell to settle in with the
   house wonk. Replace the bare <div key={p._id} ref=...> wrappers:

     <div key={p._id} ref={...} className="grid-settle"
          style={{ ['--settle-i' as string]: i }}>

   (pure CSS — no component needed; class lives in globals additions)
   ──────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────
   5. LiveChecklist — the left panel of ScanPopup during 'camera'.
   Replaces the static SELFIE_REQS LetterFade list. Each row ticks
   live as LiveScanCamera reports check states.

   Wiring in ScanPopup:
     const [liveChecks, setLiveChecks] = useState<ChecksMap | null>(null);
     <LiveScanCamera ... onChecksChange={(c) => setLiveChecks(c)} />
     {phase !== 'processing' && showRequirements && (
       <LiveChecklist checks={liveChecks} />
     )}
   ──────────────────────────────────────────────────────────────── */
export function LiveChecklist({ checks }: { checks: ChecksMap | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 330 }}>
      <p style={{
        fontFamily: 'var(--font-dmsans)', fontSize: 18, fontWeight: 600,
        color: 'rgba(255,248,234,0.5)', textTransform: 'uppercase',
        letterSpacing: '0.12em', marginBottom: 24,
      }}>
        The barber&rsquo;s checklist
      </p>
      {CHECK_ORDER.map((key: CheckKey, i: number) => {
        const state = checks?.[key] ?? 'idle';
        return (
          <div key={key} className={`lchk-row lchk-${state}`} style={{ ['--lchk-i' as string]: i }}>
            <span className="lchk-pin">
              {state === 'pass' ? (
                <svg key="ok" width="13" height="13" viewBox="0 0 14 14" fill="none" className="lchk-tick">
                  <path d="M2.5 7.5L5.6 10.5L11.5 3.5" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className="lchk-dot" />
              )}
            </span>
            <span className="lchk-label font-sans">{CHECK_META[key].label}</span>
          </div>
        );
      })}
      <p className="font-display lchk-footnote">
        the oval turns <span style={{ color: 'var(--butter)' }}>butter</span> when you&rsquo;re ready ✂
      </p>
    </div>
  );
}
