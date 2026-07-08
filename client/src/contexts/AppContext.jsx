import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiBaseUrl } from '../utils';

const AppContext = createContext(null);

const DEFAULT_SETTINGS = {
  save_input_files: true,
  expression_restore_enabled: true,
};

export function AppProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [authError, setAuthError] = useState('');
  const [tab, setTab] = useState('model');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [inferenceStatus, setInferenceStatus] = useState('unknown');
  const [inferenceModelsLoaded, setInferenceModelsLoaded] = useState(false);
  const wakePollRef = useRef(null);

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

  // Load per-user settings once authenticated.
  useEffect(() => {
    if (!token) {
      setSettings(DEFAULT_SETTINGS);
      setSettingsLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          if (!cancelled) {
            setSettings({ ...DEFAULT_SETTINGS, ...data });
          }
        }
      } catch (_err) {
        // keep defaults on failure
      } finally {
        if (!cancelled) setSettingsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const updateSettings = useCallback(
    async (patch) => {
      const previous = settings;
      const optimistic = { ...settings, ...patch };
      setSettings(optimistic);
      try {
        const response = await fetch(`${apiBaseUrl}/settings`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(patch),
        });
        if (!response.ok) {
          throw new Error('Failed to update settings');
        }
        const data = await response.json();
        setSettings({ ...DEFAULT_SETTINGS, ...data });
        return true;
      } catch (error) {
        setSettings(previous); // rollback
        throw error;
      }
    },
    [settings, token]
  );

  const checkInferenceStatus = useCallback(async () => {
    if (!token) return 'unknown';
    try {
      const response = await fetch(`${apiBaseUrl}/inference/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        setInferenceStatus('offline');
        return 'offline';
      }
      const data = await response.json();
      const status = data?.status || 'offline';
      setInferenceStatus(status);
      setInferenceModelsLoaded(Boolean(data?.models_loaded));
      return status;
    } catch (_err) {
      setInferenceStatus('offline');
      return 'offline';
    }
  }, [token]);

  const wakeInference = useCallback(async () => {
    if (!token) return;
    setInferenceStatus('waking');
    try {
      await fetch(`${apiBaseUrl}/inference/wake`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (_err) {
      // proceed to poll regardless
    }
    // Poll until it comes online (cap the attempts so we don't loop forever).
    if (wakePollRef.current) {
      clearInterval(wakePollRef.current);
    }
    let attempts = 0;
    wakePollRef.current = setInterval(async () => {
      attempts += 1;
      const status = await checkInferenceStatus();
      if (status === 'online' || attempts >= 40) {
        clearInterval(wakePollRef.current);
        wakePollRef.current = null;
      } else {
        setInferenceStatus('waking');
      }
    }, 5000);
  }, [token, checkInferenceStatus]);

  // Probe inference availability on landing.
  useEffect(() => {
    if (!token) {
      setInferenceStatus('unknown');
      return;
    }
    setInferenceStatus('checking');
    checkInferenceStatus();
  }, [token, checkInferenceStatus]);

  useEffect(() => {
    return () => {
      if (wakePollRef.current) {
        clearInterval(wakePollRef.current);
      }
    };
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
      settings,
      settingsLoaded,
      updateSettings,
      inferenceStatus,
      inferenceModelsLoaded,
      checkInferenceStatus,
      wakeInference,
    }),
    [
      token,
      authError,
      tab,
      settings,
      settingsLoaded,
      updateSettings,
      inferenceStatus,
      inferenceModelsLoaded,
      checkInferenceStatus,
      wakeInference,
    ]
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
