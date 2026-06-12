'use client';

// ============================================================
// BarberOrderReceipt — the printed Barber's Order
// A thermal-receipt that feeds out of the toolbox, line by line.
// Click the paper and it lerps to the centre of the screen for
// presenting; click away to send it back.
// Save-as-image draws the receipt onto a canvas (no deps).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { BarberOrder } from '@/lib/barberOrder';

interface BarberOrderReceiptProps {
  order: BarberOrder;
  ticketNo: string;
  text: string;
}

interface PresentGeometry {
  dx: number;     // offset from screen centre back to the sidebar position
  dy: number;
  scale: number;  // how much the receipt grows when presented
  width: number;  // natural paper width, kept identical so text scales crisply
}

function cssFont(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

function wrapText(ctx: CanvasRenderingContext2D, textValue: string, maxWidth: number): string[] {
  const words = textValue.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (ctx.measureText(probe).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawReceiptPng(order: BarberOrder, ticketNo: string): Promise<Blob | null> {
  const W = 680;
  const PAD = 44;
  const INNER = W - PAD * 2;
  const scale = 2;

  const serif = cssFont('--font-fraunces', 'Georgia, serif');
  const sans = cssFont('--font-dmsans', 'system-ui, sans-serif');
  const mono = cssFont('--font-jetbrains', 'ui-monospace, monospace');

  const ink = '#2a201a';
  const smoke = '#8a7a6a';
  const tomato = '#d94e3a';
  const cream = '#fff8ea';
  const butter = '#ffe7b0';

  // Generously tall scratch canvas; cropped after layout.
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = 2600 * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.scale(scale, scale);

  ctx.fillStyle = cream;
  ctx.fillRect(0, 0, W, 2600);

  let y = 64;

  const dashedRule = (yy: number) => {
    ctx.save();
    ctx.strokeStyle = 'rgba(42,32,26,0.28)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(PAD, yy);
    ctx.lineTo(W - PAD, yy);
    ctx.stroke();
    ctx.restore();
  };

  // ── Header ──
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.font = `900 34px ${serif}`;
  ctx.fillText('SHAPE UP', W / 2, y);
  y += 26;
  ctx.font = `600 13px ${sans}`;
  ctx.fillStyle = smoke;
  ctx.fillText('— ✂  T H E  B A R B E R ’ S  O R D E R  ✂ —', W / 2, y);
  y += 24;
  ctx.font = `12px ${mono}`;
  ctx.fillText(`ticket ${ticketNo}  ·  ${new Date().toLocaleDateString()}`, W / 2, y);
  y += 28;
  dashedRule(y);
  y += 44;

  // ── Style name ──
  ctx.fillStyle = ink;
  ctx.font = `italic 600 30px ${serif}`;
  for (const line of wrapText(ctx, order.styleName, INNER)) {
    ctx.fillText(line, W / 2, y);
    y += 36;
  }
  y += 2;

  // ── Hair read ──
  ctx.font = `600 12px ${mono}`;
  ctx.fillStyle = tomato;
  ctx.fillText(`${order.hairRead.pattern.toUpperCase()}  ·  ${order.hairRead.density.toUpperCase()} DENSITY`, W / 2, y);
  y += 22;
  ctx.font = `italic 14px ${serif}`;
  ctx.fillStyle = smoke;
  for (const line of wrapText(ctx, order.hairRead.note, INNER)) {
    ctx.fillText(line, W / 2, y);
    y += 19;
  }
  y += 16;
  dashedRule(y);
  y += 36;

  // ── Zones ──
  ctx.textAlign = 'left';
  for (const z of order.zones) {
    ctx.font = `700 12px ${mono}`;
    ctx.fillStyle = ink;
    ctx.fillText(z.label, PAD, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = tomato;
    ctx.fillText(z.spec, W - PAD, y);
    ctx.textAlign = 'left';
    y += 22;

    ctx.font = `15px ${serif}`;
    ctx.fillStyle = ink;
    for (const line of wrapText(ctx, z.move, INNER)) {
      ctx.fillText(line, PAD, y);
      y += 21;
    }

    ctx.font = `11px ${mono}`;
    ctx.fillStyle = smoke;
    ctx.fillText(`⟶ ${z.technique}`, PAD, y + 2);

    // confidence meter
    const pct = Math.round(z.confidence * 100);
    const meterW = 110;
    const meterX = W - PAD - meterW - 40;
    ctx.fillStyle = 'rgba(42,32,26,0.12)';
    ctx.fillRect(meterX, y - 6, meterW, 7);
    ctx.fillStyle = pct >= 85 ? tomato : pct >= 70 ? '#c78a4c' : smoke;
    ctx.fillRect(meterX, y - 6, meterW * z.confidence, 7);
    ctx.textAlign = 'right';
    ctx.fillStyle = ink;
    ctx.fillText(`${pct}%`, W - PAD, y + 2);
    ctx.textAlign = 'left';
    y += 32;
  }

  dashedRule(y);
  y += 36;

  // ── Ask-for box ──
  ctx.font = `700 11px ${mono}`;
  ctx.fillStyle = smoke;
  ctx.fillText('SAY THIS IN THE CHAIR', PAD, y);
  y += 14;
  ctx.font = `italic 500 17px ${serif}`;
  const quoteLines = wrapText(ctx, `“${order.askFor}”`, INNER - 36);
  const boxH = quoteLines.length * 24 + 30;
  ctx.fillStyle = butter;
  ctx.beginPath();
  ctx.roundRect(PAD, y, INNER, boxH, 10);
  ctx.fill();
  ctx.fillStyle = ink;
  let qy = y + 32;
  for (const line of quoteLines) {
    ctx.fillText(line, PAD + 18, qy);
    qy += 24;
  }
  y += boxH + 30;

  ctx.font = `12px ${mono}`;
  ctx.fillStyle = smoke;
  ctx.fillText(`MAINTENANCE — ${order.maintenance}`, PAD, y);
  y += 34;

  // ── Barcode (deterministic from ticket) ──
  let bx = PAD;
  for (let i = 0; bx < W - PAD - 6; i++) {
    const seed = ticketNo.charCodeAt(i % ticketNo.length) * (i + 3);
    const w = 1.5 + (seed % 4);
    if (seed % 3 !== 0) {
      ctx.fillStyle = ink;
      ctx.fillRect(bx, y, w, 38);
    }
    bx += w + 2;
  }
  y += 56;
  ctx.textAlign = 'center';
  ctx.font = `italic 13px ${serif}`;
  ctx.fillStyle = smoke;
  ctx.fillText('no charge for thinking twice ✂ shapeup', W / 2, y);
  y += 40;

  // crop to content
  const out = document.createElement('canvas');
  out.width = W * scale;
  out.height = y * scale;
  const octx = out.getContext('2d');
  if (!octx) return Promise.resolve(null);
  octx.drawImage(canvas, 0, 0);
  return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
}

// ── The paper itself — rendered in the sidebar and in present mode ──
function ReceiptPaper({
  order,
  ticketNo,
  instant = false,
  onClick,
  ariaLabel,
}: {
  order: BarberOrder;
  ticketNo: string;
  instant?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  return (
    <div
      className={`receipt ${instant ? 'receipt-instant' : 'receipt-print receipt-clickable'}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {/* Header */}
      <div className="receipt-row text-center" style={{ '--ri': 0 } as React.CSSProperties}>
        <div className="font-display text-[19px] leading-none" style={{ fontWeight: 900, letterSpacing: '0.02em' }}>SHAPE UP</div>
        <div className="font-sans text-[8.5px] uppercase tracking-[0.3em] text-[var(--smoke)] mt-1.5">— ✂ the barber&rsquo;s order ✂ —</div>
        <div className="font-mono text-[9px] text-[var(--smoke)] mt-1">ticket {ticketNo} · {new Date().toLocaleDateString()}</div>
      </div>

      <div className="receipt-rule receipt-row" style={{ '--ri': 1 } as React.CSSProperties} />

      {/* The cut + hair read */}
      <div className="receipt-row text-center" style={{ '--ri': 2 } as React.CSSProperties}>
        <div className="font-display italic text-[20px] leading-tight text-[var(--ink)]" style={{ fontWeight: 600 }}>{order.styleName}</div>
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--tomato)] mt-1.5" style={{ fontWeight: 700 }}>
          {order.hairRead.pattern} · {order.hairRead.density} density
        </div>
        <p className="font-serif italic text-[11px] text-[var(--smoke)] mt-1 leading-snug">{order.hairRead.note}</p>
      </div>

      <div className="receipt-rule receipt-row" style={{ '--ri': 3 } as React.CSSProperties} />

      {/* Zones */}
      {order.zones.map((z, i) => (
        <div key={z.zone} className="receipt-row receipt-zone" style={{ '--ri': 4 + i } as React.CSSProperties}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink)]" style={{ fontWeight: 700 }}>{z.label}</span>
            <span className="font-mono text-[9.5px] text-[var(--tomato)] text-right" style={{ fontWeight: 700 }}>{z.spec}</span>
          </div>
          <p className="font-serif text-[12.5px] leading-snug text-[var(--ink)] mt-1">{z.move}</p>
          <div className="flex items-center justify-between gap-3 mt-1.5">
            <span className="font-mono text-[9px] text-[var(--smoke)] truncate">⟶ {z.technique}</span>
            <span className="conf-meter" title={`confidence ${Math.round(z.confidence * 100)}%`}>
              <span className="conf-track">
                <span
                  className="conf-fill"
                  style={{ width: `${Math.round(z.confidence * 100)}%`, animationDelay: instant ? '0ms' : `${(4 + i) * 130 + 500}ms` }}
                />
              </span>
              <span className="font-mono text-[9px] text-[var(--ink)]" style={{ fontWeight: 600 }}>{Math.round(z.confidence * 100)}%</span>
            </span>
          </div>
        </div>
      ))}

      {/* Tear line + ask-for */}
      <div className="receipt-tear receipt-row" style={{ '--ri': 9 } as React.CSSProperties}><span>✂</span></div>

      <div className="receipt-row" style={{ '--ri': 10 } as React.CSSProperties}>
        <div className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-[var(--smoke)] mb-1.5" style={{ fontWeight: 700 }}>say this in the chair</div>
        <div className="receipt-askfor">
          <p className="font-serif italic text-[13px] leading-snug text-[var(--ink)]" style={{ fontWeight: 500 }}>&ldquo;{order.askFor}&rdquo;</p>
        </div>
        <div className="font-mono text-[9px] text-[var(--smoke)] mt-2.5">MAINTENANCE — {order.maintenance}</div>
      </div>

      {/* Barcode footer */}
      <div className="receipt-row mt-3" style={{ '--ri': 11 } as React.CSSProperties}>
        <div className="receipt-barcode" aria-hidden />
        <div className="text-center font-serif italic text-[10px] text-[var(--smoke)] mt-2">no charge for thinking twice ✂</div>
      </div>
    </div>
  );
}

export default function BarberOrderReceipt({ order, ticketNo, text }: BarberOrderReceiptProps) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const paperHomeRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [entered, setEntered] = useState(false);
  const [geo, setGeo] = useState<PresentGeometry | null>(null);

  const openPresent = () => {
    const el = paperHomeRef.current;
    if (!el || presenting) return;
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setGeo({
      dx: rect.left + rect.width / 2 - vw / 2,
      dy: rect.top + rect.height / 2 - vh / 2,
      scale: Math.min(1.7, (vw * 0.88) / rect.width, (vh * 0.88) / rect.height),
      width: rect.width,
    });
    setPresenting(true);
    setEntered(false);
    // double rAF so the start transform paints before the transition runs
    requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
  };

  const closePresent = () => {
    setEntered(false);
    closeTimerRef.current = setTimeout(() => setPresenting(false), 560);
  };

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePresent(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting]);

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

  const handleSave = async () => {
    const blob = await drawReceiptPng(order, ticketNo);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shapeup-order-${ticketNo.replace(/[^a-z0-9]/gi, '')}.png`;
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const actionButtons = (
    <div className="flex gap-2">
      <button
        onClick={handleSave}
        aria-label="Save barber order as image"
        className="btn btn-tomato btn-snap flex-1"
        style={{ padding: '9px 12px', fontSize: 12 }}
      >
        {saved ? 'Saved ✓' : '↓ Save as image'}
      </button>
      <button
        onClick={handleCopy}
        aria-label="Copy barber order to clipboard"
        className="btn btn-cream btn-snap flex-1"
        style={{ padding: '9px 12px', fontSize: 12 }}
      >
        {copied ? 'Copied ✓' : '⧉ Copy order'}
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div ref={paperHomeRef} style={{ visibility: presenting ? 'hidden' : undefined }} key={ticketNo}>
        <ReceiptPaper
          order={order}
          ticketNo={ticketNo}
          onClick={openPresent}
          ariaLabel="Present the order full screen"
        />
      </div>

      {actionButtons}

      {/* Present mode — the receipt lerps from the sidebar to centre stage */}
      {presenting && geo && (
        <div
          className={`present-backdrop ${entered ? 'is-open' : ''}`}
          onClick={closePresent}
          role="dialog"
          aria-modal="true"
          aria-label="Barber order, presented"
        >
          <div
            className="present-wrap"
            style={{
              width: geo.width,
              transform: entered
                ? 'translate(-50%, -50%) scale(' + geo.scale + ')'
                : `translate(calc(-50% + ${geo.dx}px), calc(-50% + ${geo.dy}px)) scale(1)`,
            }}
          >
            <ReceiptPaper order={order} ticketNo={ticketNo} instant onClick={closePresent} ariaLabel="Put the order back" />
            <div onClick={(e) => e.stopPropagation()}>{actionButtons}</div>
          </div>
          <span className={`present-hint ${entered ? 'is-open' : ''}`}>click anywhere to put it back</span>
        </div>
      )}
    </div>
  );
}
