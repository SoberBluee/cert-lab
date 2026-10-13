import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
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

const EXAM_KEY = 'cka.exam';
const EXAM_EVENT = 'cka-exam-change';
const subscribeExam = (cb: () => void) => {
  window.addEventListener(EXAM_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EXAM_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
};

/** Whether the next session starts in exam mode; shared by every component and browser tab. */
export function useExamMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeExam, () => localStorage.getItem(EXAM_KEY) === '1');
  const set = (v: boolean) => {
    localStorage.setItem(EXAM_KEY, v ? '1' : '0');
    window.dispatchEvent(new Event(EXAM_EVENT));
  };
  return [on, set];
}

export const isActive = (s?: SessionView | null) =>
  !!s && (s.state === 'provisioning' || s.state === 'running' || s.state === 'grading');
