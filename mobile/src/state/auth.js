// Auth context — resolves the stored token on boot so a returning user lands
// on the dashboard rather than the sign-in screen.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, setToken, clearToken, getToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (token) {
          const { user: me } = await api.me();
          if (!cancelled) setUser(me);
        }
      } catch {
        // Expired or revoked token — drop it and show sign-in.
        await clearToken();
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const value = useMemo(() => ({
    user,
    booting,
    async signIn(email, password) {
      const { user: me, token } = await api.login({ email, password });
      await setToken(token);
      setUser(me);
    },
    async signUp(email, password, fullName) {
      const { user: me, token } = await api.register({ email, password, fullName });
      await setToken(token);
      setUser(me);
    },
    async signOut() {
      await clearToken();
      setUser(null);
    },
  }), [user, booting]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
