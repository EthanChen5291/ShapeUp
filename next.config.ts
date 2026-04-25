import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['firebase-admin', 'three', '@react-three/fiber', '@react-three/drei'],
};

export default nextConfig;
