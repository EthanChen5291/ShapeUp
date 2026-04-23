import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['three', '@react-three/fiber', '@react-three/drei'],
  serverExternalPackages: ['firebase-admin'],
};

export default nextConfig;
