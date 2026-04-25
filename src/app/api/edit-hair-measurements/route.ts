import { exec } from 'child_process';
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

function getPaths(plyOverride?: string) {
  const cwd = /*turbopackIgnore: true*/ process.cwd();
  return {
    plyPath:  plyOverride ? path.join(cwd, plyOverride) : path.join(cwd, 'public/hair/hair_modified.ply'),
    jsonPath: path.join(cwd, 'public/hair/hair_measurements.json'),
    script:   path.join(cwd, 'server/edit_hair_ply.py'),
  };
}

/** GET /api/edit-hair-measurements — return current measurements JSON */
export async function GET() {
  const { jsonPath } = getPaths();
  if (!fs.existsSync(jsonPath)) {
    return NextResponse.json({ error: 'hair_measurements.json not found' }, { status: 404 });
  }
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  return NextResponse.json(JSON.parse(raw));
}

/**
 * POST /api/edit-hair-measurements
 * Body: { deltas: { backLength?: number, crownHeight?: number, sideWidth?: number } }
 *   delta values are in scene_units (positive = longer/wider)
 *
 * Optionally pass { plyPath } to target a specific PLY instead of hair_modified.ply.
 */
export async function POST(req: NextRequest) {
  let body: { deltas?: Record<string, number>; plyPath?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { deltas, plyPath } = body;
  if (!deltas || Object.keys(deltas).length === 0) {
    return NextResponse.json({ error: 'deltas is required and must be non-empty' }, { status: 400 });
  }

  const { plyPath: resolvedPly, jsonPath, script } = getPaths(plyPath);

  if (!fs.existsSync(resolvedPly)) {
    return NextResponse.json(
      { error: `PLY not found: ${resolvedPly}. Generate hair_modified.ply first.` },
      { status: 404 },
    );
  }

  const deltasArg = JSON.stringify(deltas).replace(/"/g, '\\"');
  const cmd = `python "${script}" --ply "${resolvedPly}" --out "${resolvedPly}" --json "${jsonPath}" --deltas "${deltasArg}"`;

  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30_000 });
    if (stderr) console.warn('[edit-hair-measurements] python stderr:', stderr);

    const measurements = JSON.parse(stdout.trim());
    return NextResponse.json({ ok: true, measurements });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[edit-hair-measurements] script error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
