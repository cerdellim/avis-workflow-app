import { useQuery } from '@tanstack/react-query';
import type { SessionProfile } from '../shared/account';
import { api } from './api';

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api<SessionProfile>('/api/auth/me'),
    retry: false,
  });
}
