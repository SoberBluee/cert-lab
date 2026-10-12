import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { SessionView } from '@cka/schema';
import { api } from './api';

export const sessionKey = ['session'] as const;

export function useSession() {
  return useQuery({ queryKey: sessionKey, queryFn: api.current });
}

/** Keeps the session query in sync with the server-sent event stream. Mount once. */
export function useSessionStream() {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource('/api/sessions/current/events');
    es.addEventListener('session', (e) => {
      const { session } = JSON.parse((e as MessageEvent).data) as { session: SessionView | null };
      const prev = qc.getQueryData<SessionView | null>(sessionKey);
      qc.setQueryData(sessionKey, session);
      if (prev?.state !== session?.state) {
        qc.invalidateQueries({ queryKey: ['scenarios'] });
        qc.invalidateQueries({ queryKey: ['history'] });
      }
    });
    return () => es.close();
  }, [qc]);
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const isActive = (s?: SessionView | null) =>
  !!s && (s.state === 'provisioning' || s.state === 'running' || s.state === 'grading');
