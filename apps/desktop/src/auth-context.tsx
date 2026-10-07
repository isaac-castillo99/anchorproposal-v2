import React, { createContext, useContext } from 'react';
import type { User } from '../../web/src/lib/api';
type Auth = { user: User | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; isMaster: boolean; isAdmin: boolean; canBid: boolean };
export const DesktopAuthContext = createContext<Auth | null>(null);
export function useAuth() { const auth = useContext(DesktopAuthContext); if (!auth) throw new Error('Sign-in context is unavailable'); return auth; }
