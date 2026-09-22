/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // A receipt photo or PDF is sent to a server action (src/actions/upload.ts),
    // up to 4 MB; the default limit is 1 MB.
    serverActions: { bodySizeLimit: '5mb' },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'themoak.com',
      },
    ],
  },
};

export default nextConfig;
