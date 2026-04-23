import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['three', '@react-three/fiber', '@react-three/drei'],
  serverExternalPackages: [
    'firebase',
    'firebase/app',
    'firebase/firestore',
    'firebase/storage',
    'firebase/auth',
    '@elevenlabs/elevenlabs-js',
    '@anthropic-ai/sdk',
  ],
};

export default nextConfig;
