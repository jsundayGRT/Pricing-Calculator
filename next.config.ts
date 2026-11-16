import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // files read at run time, so Vercel bundles them with the routes that use them
  outputFileTracingIncludes: {
    '/api/quotes/[id]/proposal': ['./content/proposal-template.docx'],
  },
};

export default nextConfig;
