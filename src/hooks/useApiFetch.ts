import { useMemo, useState } from 'react';
import { useServers } from '../contexts/ServerContext';
import { serverBaseUrl } from '../utils/server';

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

  const baseUrl = useMemo(() => {
    if (!activeServer) return '';
    return serverBaseUrl(activeServer.protocol, activeServer.host);
  }, [activeServer]);

  const apiFetch = async (path: string, init?: RequestInit) => {
    if (!activeServer) throw new Error('No active server');

    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${activeServer.token}`,
        ...(init?.headers || {}),
      },
    });

    if (handleLicense && (res.status === 403 || res.status === 503)) {
      setGate({ noLicense: true, featureNotEnabled: false });
      return null;
    }
    if (handleFeature && res.status === 404) {
      setGate({ noLicense: false, featureNotEnabled: true });
      return null;
    }
    if (res.status === 204) return null;

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as any)?.error || `Request failed: ${res.status}`);
    }
    return data;
  };

  const resetGate = () => setGate({ noLicense: false, featureNotEnabled: false });

  return { apiFetch, baseUrl, activeServer, ...gate, resetGate };
}
