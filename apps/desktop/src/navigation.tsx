import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';

type Navigation = { path: string; push: (url: string) => void; replace: (url: string) => void; back: () => void; refresh: () => void };
const Context = createContext<Navigation | null>(null);
export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const read = () => location.hash.startsWith('#/') ? location.hash.slice(1) : '/dashboard';
  const [path, setPath] = useState(read);
  const [, setRevision] = useState(0);
  useEffect(() => { const update = () => setPath(read()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  const navigation = useMemo(() => ({ path,
    push: (url: string) => { if (url.startsWith('/') && !url.startsWith('//')) { location.hash = url; setPath(url); } },
    replace: (url: string) => { if (url.startsWith('/') && !url.startsWith('//')) { history.replaceState(null, '', `#${url}`); setPath(url); } },
    back: () => history.back(), refresh: () => setRevision(value => value + 1),
  }), [path]);
  return <Context.Provider value={navigation}>{children}</Context.Provider>;
}
export function useRouter() { const value = useContext(Context); if (!value) throw new Error('Navigation is unavailable'); return value; }
export function usePathname() { return useRouter().path.split('?')[0].split('#')[0]; }
export function useSearchParams() { const path = useRouter().path; return useMemo(() => new URLSearchParams(path.split('?')[1]?.split('#')[0] || ''), [path]); }
export function useParams<T extends Record<string, string>>() { const parts = usePathname().split('/'); return { id: parts[2] } as unknown as T; }
export default function Link({ href, children, onClick, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) {
  const router = useRouter();
  const { prefetch, ...rest } = props;
  return <a {...rest} href={href.startsWith('/') ? `#${href}` : href} onClick={event => {
    onClick?.(event); if (event.defaultPrevented) return;
    event.preventDefault();
    if (href.startsWith('/') && !href.startsWith('//')) router.push(href);
    else void window.anchor.external(href);
  }}>{children}</a>;
}
