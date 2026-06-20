#!/usr/bin/env node
// Apply the CORS policy the splat/PLY loaders need.
//
// /api/proxy-ply now 302-redirects the browser straight to S3 instead of
// streaming the bytes through the Vercel function. That makes the splat download
// a cross-origin fetch (app origin -> S3), so the bucket must answer GET/HEAD
// with Access-Control-Allow-Origin or the browser blocks the response and
// drei's SplatLoader fails with "Could not load ...".
//
//   node scripts/apply-s3-cors.mjs          # apply the policy
//   node scripts/apply-s3-cors.mjs --show   # print current bucket CORS, no change
//
// Reads AWS creds + bucket/region from .env and .env.local (.env.local wins,
// matching how Next.js layers them), or from the real process env.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from '@aws-sdk/client-s3';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function readEnvFile(name) {
  const p = join(ROOT, name);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}
// .env.local takes precedence over .env, like Next.js.
const ENV_TEXT = readEnvFile('.env') + '\n' + readEnvFile('.env.local');

function getValue(text, key) {
  // Last match wins, so a .env.local value overrides the .env one.
  const matches = [...text.matchAll(new RegExp(`^${key}=(.*)$`, 'gm'))];
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1][1].trim().replace(/^["']|["']$/g, '');
}

const region = process.env.AWS_REGION || getValue(ENV_TEXT, 'AWS_REGION') || 'us-east-1';
const bucket = process.env.AWS_S3_BUCKET_NAME || getValue(ENV_TEXT, 'AWS_S3_BUCKET_NAME');
const accessKeyId = process.env.AWS_ACCESS_KEY_ID || getValue(ENV_TEXT, 'AWS_ACCESS_KEY_ID');
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || getValue(ENV_TEXT, 'AWS_SECRET_ACCESS_KEY');

if (!bucket) {
  console.error('AWS_S3_BUCKET_NAME not found in env or .env.local');
  process.exit(1);
}
if (!accessKeyId || !secretAccessKey) {
  console.error('AWS credentials not found in env or .env.local');
  process.exit(1);
}

const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });

// Origins allowed to fetch splats/PLYs directly from S3.
const ALLOWED_ORIGINS = [
  'https://tryshapeup.cc',
  'https://www.tryshapeup.cc',
  'http://localhost:3000',
];

const CORS_CONFIGURATION = {
  CORSRules: [
    {
      AllowedMethods: ['GET', 'HEAD'],
      AllowedOrigins: ALLOWED_ORIGINS,
      AllowedHeaders: ['*'],
      // drei reads Content-Length; range support helps chunked loading.
      ExposeHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag'],
      MaxAgeSeconds: 3600,
    },
  ],
};

async function show() {
  try {
    const res = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
    console.log(`Current CORS for ${bucket}:`);
    console.log(JSON.stringify(res.CORSRules, null, 2));
  } catch (err) {
    if (err?.name === 'NoSuchCORSConfiguration') {
      console.log(`Bucket ${bucket} has no CORS configuration set.`);
    } else {
      throw err;
    }
  }
}

async function apply() {
  await s3.send(
    new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: CORS_CONFIGURATION }),
  );
  console.log(`Applied CORS to ${bucket} (region ${region}):`);
  console.log(JSON.stringify(CORS_CONFIGURATION.CORSRules, null, 2));
}

const run = process.argv.includes('--show') ? show : apply;
run().catch((err) => {
  console.error('Failed:', err?.message ?? err);
  process.exit(1);
});
