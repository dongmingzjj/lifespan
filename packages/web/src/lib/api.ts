const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api/v1';

// Generic fetch wrapper with error handling
async function fetchAPI<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const config: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: 'unknown_error',
        message: response.statusText,
      }));
      throw new Error(error.message || 'API request failed');
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Unknown error occurred');
  }
}

// Auth API
export const authAPI = {
  register: (data: { email: string; password: string; name?: string }) =>
    fetchAPI<{ access_token: string; refresh_token: string; user: { id: string; email: string; username: string } }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then(response => ({
      token: response.access_token,
      refreshToken: response.refresh_token,
      user: {
        id: response.user.id,
        email: response.user.email,
        name: response.user.username,
      },
    })),

  login: (email: string, password: string) =>
    fetchAPI<{ access_token: string; refresh_token: string; user: { id: string; email: string; username: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }).then(response => ({
      token: response.access_token,
      refreshToken: response.refresh_token,
      user: {
        id: response.user.id,
        email: response.user.email,
        name: response.user.username,
      },
    })),
};

// Sync API
export const syncAPI = {
  getEvents: (token: string, since?: number, limit = 100) =>
    fetchAPI<{
      events: Array<{
        id: string;
        type: string;
        timestamp: number;
        deviceId: string;
        [key: string]: any;
      }>;
      has_more: boolean;
      latest_timestamp: number;
    }>(
      `/sync/events?since=${since || 0}&limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    ),

  getStatus: (token: string) =>
    fetchAPI<{
      device_id: string;
      last_sync_at: number;
      pending_count: number;
      synced_count: number;
    }>('/sync/status', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }),

  uploadEvents: (token: string, data: { events: any[]; lastSyncAt: number }) =>
    fetchAPI<{
      synced_at: number;
      processed_count: number;
      conflicts: any[];
    }>('/sync/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    }),
};

// Analysis API (placeholder for future implementation)
export const analysisAPI = {
  getPortrait: (token: string) =>
    fetchAPI<any>('/analysis/portrait', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }),

  getInsights: (token: string, dateRange?: { start: Date; end: Date }) =>
    fetchAPI<any>('/analysis/insights', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(dateRange ? { dateRange } : {}),
    }),
};
