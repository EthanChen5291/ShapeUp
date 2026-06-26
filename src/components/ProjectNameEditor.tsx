'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';

function PencilGlyph() {
  // Lucide "pencil" — purple-ish, sits in the toggle button.
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/**
 * Inline, editable project name. A purple pencil toggles edit mode; the pencil
 * dips then shoots up off the button while "OK" rises up to replace it (and the
 * reverse on save). The native caret blinks in the input to signal "type here".
 */
export default function ProjectNameEditor({
  projectId,
  name,
  compact = false,
}: {
  projectId: Id<'projects'>;
  name?: string;
  compact?: boolean;
}) {
  const rename = useMutation(api.projects.rename);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name ?? '');
  // `touched` keeps the swap animation from firing on first paint; `flip` re-keys
  // the glyphs so the keyframes replay on every toggle.
  const [touched, setTouched] = useState(false);
  const [flip, setFlip] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Mirrors `editing` synchronously so commit/cancel stay idempotent even when
  // Enter (or a Save click) and the input's blur both try to close the editor.
  const editingRef = useRef(false);

  // Keep the draft synced to the latest saved name while we're not editing.
  useEffect(() => {
    if (!editing && name != null) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      el?.focus();
      el?.select();
    }
  }, [editing]);

  const display = (name ?? '').trim() || 'Untitled cut';

  const beginEdit = () => {
    editingRef.current = true;
    setDraft((name ?? '').trim());
    setTouched(true);
    setFlip(f => f + 1);
    setEditing(true);
  };

  const commit = async () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setTouched(true);
    setFlip(f => f + 1);
    setEditing(false);
    const next = draft.trim();
    if (next && next !== (name ?? '').trim()) {
      try {
        await rename({ projectId, name: next });
      } catch (e) {
        console.error('[ProjectNameEditor] rename failed:', e);
      }
    }
  };

  const cancel = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setTouched(true);
    setFlip(f => f + 1);
    setDraft((name ?? '').trim());
    setEditing(false);
  };

  return (
    <div className={`pne-root ${compact ? 'pne-compact' : ''}`}>
      {editing ? (
        <span className="pne-field">
          {/* invisible sizer auto-grows the field to the text width */}
          <span className="pne-sizer" aria-hidden>
            {draft || display}
          </span>
          <input
            ref={inputRef}
            className="pne-input"
            value={draft}
            maxLength={60}
            aria-label="Project name"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            onBlur={() => void commit()}
          />
        </span>
      ) : (
        <button type="button" className="pne-name" onClick={beginEdit} title="Rename project">
          {display}
        </button>
      )}

      <button
        type="button"
        className={`pne-toggle ${editing ? 'pne-toggle--on' : ''}`}
        // Keep the input focused so a Save click commits directly instead of
        // bouncing through the input's blur handler first.
        onMouseDown={e => { if (editing) e.preventDefault(); }}
        onClick={() => (editing ? void commit() : beginEdit())}
        aria-label={editing ? 'Save name' : 'Rename project'}
      >
        <span className="pne-toggle-hit">
          <span
            key={`p-${flip}`}
            className={`pne-glyph pne-pencil ${touched ? (editing ? 'pne-exit' : 'pne-enter') : ''}`}
          >
            <PencilGlyph />
          </span>
          <span
            key={`o-${flip}`}
            className={`pne-glyph pne-ok ${touched ? (editing ? 'pne-enter' : 'pne-exit') : 'pne-hidden'}`}
          >
            OK
          </span>
        </span>
      </button>
    </div>
  );
}
