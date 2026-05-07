import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [authError, setAuthError] = useState('');
  const [tab, setTab] = useState('model');

  useEffect(() => {
    if (!window.location.hash) {
      return;
    }
    const params = new URLSearchParams(window.location.hash.slice(1));
    const oauthToken = params.get('token');
    const oauthError = params.get('auth_error');

    if (oauthToken) {
      localStorage.setItem('token', oauthToken);
      setToken(oauthToken);
      setAuthError('');
    } else if (oauthError) {
      setAuthError(oauthError);
    }

    if (oauthToken || oauthError) {
      const cleanUrl = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(null, '', cleanUrl);
    }
  }, []);

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
  };

  const value = useMemo(
    () => ({
      token,
      setToken,
      authError,
      setAuthError,
      tab,
      setTab,
      logout,
    }),
    [token, authError, tab]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within AppProvider');
  }
  return ctx;
}
