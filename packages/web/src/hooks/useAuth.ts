import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authAPI } from '@/lib/api';
import { useUserStore } from '@/stores/useUserStore';

export function useLogin() {
  const queryClient = useQueryClient();
  const { login } = useUserStore();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authAPI.login(email, password),
    onSuccess: (data) => {
      login(data.user, data.token);
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  const { login } = useUserStore();

  return useMutation({
    mutationFn: (data: { email: string; password: string; name?: string }) =>
      authAPI.register(data),
    onSuccess: (data) => {
      login(data.user, data.token);
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}
