import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  // Allow streaming large responses
  experimental: {
    serverActions: {
      bodySizeLimit: '35mb',
    },
  },
}

export default nextConfig
