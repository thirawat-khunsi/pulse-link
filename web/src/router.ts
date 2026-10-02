import { useEffect, useState } from 'react';

// Hash routing (SPEC §1/§6): the server only serves "/" and "/assets/*", every other
// single-segment path belongs to the redirect (D-006).

export type Route =
  | { name: 'create' }
  | { name: 'history' }
  | { name: 'dashboard'; id: number }
  | { name: 'notFound' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '') || '/';
  if (path === '/') return { name: 'create' };
  if (path === '/history') return { name: 'history' };
  const match = /^\/links\/([1-9]\d{0,15})$/.exec(path);
  if (match?.[1]) return { name: 'dashboard', id: Number(match[1]) };
  return { name: 'notFound' };
}

export const href = {
  create: () => '#/',
  history: () => '#/history',
  dashboard: (id: number) => `#/links/${id}`,
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);
  return route;
}
