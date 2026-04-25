import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['firebase-admin'],
  outputFileTracingExcludes: {
    '*': [
      './node_modules/three/**',
      './node_modules/@react-three/**',
      './node_modules/leva/**',
      './node_modules/@elevenlabs/**',
      './node_modules/delaunator/**',
      './server/**',
      './public/hair/**',
    ],
  },
};

export default nextConfig;
