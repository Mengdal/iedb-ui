import { useCallback, useMemo, useRef, useState } from 'react';
import { useServers } from '../contexts/ServerContext';
import { serverBaseUrl, serverFetch } from '../utils/server';

interface FeatureGate {
  noLicense: boolean;
  featureNotEnabled: boolean;
}

interface ApiFetchOptions {
  /** Treat 403/503 as noLicense (default: true) */
  handleLicense?: boolean;
  /** Treat 404 as featureNotEnabled (default: true) */
  handleFeature?: boolean;
}

/**
 * Shared hook that provides an authenticated fetch function and feature gate state.
 * Returns { apiFetch, baseUrl, noLicense, featureNotEnabled, resetGate }.
 */
export function useApiFetch(options: ApiFetchOptions = {}) {
  const { handleLicense = true, handleFeature = true } = options;
  const { activeServer } = useServers();

  const [gate, setGate] = useState<FeatureGate>({ noLicense: false, featureNotEnabled: false });
  const gateRef = useRef(gate);
  gateRef.current = gate;

  const baseUrl = useMemo(() => {
    if (!activeServer) return '';
    return serverBaseUrl(activeServer.protocol, activeServer.host);
  }, [activeServer]);

  const apiFetch = useCallback(async (path: string, init?: RequestInit & { raw?: boolean }) => {
    if (!activeServer) throw new Error('No active server');

    const res = await serverFetch(baseUrl, path, init, activeServer.token);

    if (handleLicense && (res.status === 403 || res.status === 503)) {
      const newGate = { noLicense: true, featureNotEnabled: false };
      setGate(newGate);
      gateRef.current = newGate;
      return null;
    }
    if (handleFeature && res.status === 404) {
      const newGate = { noLicense: false, featureNotEnabled: true };
      setGate(newGate);
      gateRef.current = newGate;
      return null;
    }
    if (init?.raw) return res;
    if (res.status === 204) return null;

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as any)?.error || `Request failed: ${res.status}`);
    }
    return data;
  }, [baseUrl, activeServer, handleLicense, handleFeature]);

  const apiJson = useCallback(async (path: string, init?: RequestInit) => {
    const data = await apiFetch(path, init);
    if (data === null) {
      return null;
    }
    return data;
  }, [apiFetch]);

  const resetGate = useCallback(() => setGate({ noLicense: false, featureNotEnabled: false }), []);

  return { apiFetch, apiJson, baseUrl, activeServer, ...gate, resetGate };
}
