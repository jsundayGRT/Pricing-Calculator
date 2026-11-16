import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // files read at run time, so Vercel bundles them with the routes that use them
  outputFileTracingIncludes: {
    '/api/quotes/[id]/proposal': ['./content/proposal-template.docx'],
    '/api/proposal/draft': ['./content/proposal-template.docx'],
    // the HubSpot sync draws the proposal PDF, with the template's pictures
    '/api/admin/quotes/[id]': ['./content/proposal-template.docx'],
    '/api/slack/interactions': ['./content/proposal-template.docx'],
    '/api/quotes': ['./content/proposal-template.docx'],
  },
};

export default nextConfig;
