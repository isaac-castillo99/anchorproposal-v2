import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'AnchorProposal Web',
    short_name: 'AnchorProposal',
    description: 'Your workspace for resumes, applications, and application answers.',
    start_url: '/login',
    scope: '/',
    display: 'standalone',
    background_color: '#f3f8f8',
    theme_color: '#095d63',
    lang: 'en',
    prefer_related_applications: false,
    icons: [
      { src: '/icons/app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/app-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
