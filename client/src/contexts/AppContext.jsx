import React, { createContext, useContext, useMemo, useState } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [tab, setTab] = useState('model');

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
  };

  const value = useMemo(
    () => ({
      token,
      setToken,
      tab,
      setTab,
      logout,
    }),
    [token, tab]
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
