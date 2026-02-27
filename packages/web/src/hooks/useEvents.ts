import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { syncAPI } from '@/lib/api';
import { useUserStore } from '@/stores/useUserStore';

interface UseEventsOptions {
  since?: number;
  limit?: number;
  enabled?: boolean;
}

export function useEvents({ since, limit = 100, enabled = true }: UseEventsOptions = {}) {
  const { token } = useUserStore();

  return useQuery({
    queryKey: ['events', since, limit],
    queryFn: () => syncAPI.getEvents(token || '', since, limit),
    enabled: enabled && !!token,
    staleTime: 60000, // 1 minute
  });
}

export function useSyncStatus() {
  const { token } = useUserStore();

  return useQuery({
    queryKey: ['sync-status'],
    queryFn: () => syncAPI.getStatus(token || ''),
    enabled: !!token,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every minute
  });
}

export function useUploadEvents() {
  const queryClient = useQueryClient();
  const { token } = useUserStore();

  return useMutation({
    mutationFn: (data: { events: any[]; lastSyncAt: number }) =>
      syncAPI.uploadEvents(token || '', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['sync-status'] });
    },
  });
}
