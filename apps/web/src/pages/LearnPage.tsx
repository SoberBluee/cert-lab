import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type { LessonSummary, LessonTopic, LessonTrack } from '@cka/schema';
import { api } from '../api';
import { buttonClass, ErrorBanner } from '../components/ui';
import { sessionKey, useSession } from '../hooks';
import { SECTIONS } from '../section';

type Topics = Partial<Record<LessonTopic, { name: string; blurb: string }>>;

const TRACKS: Record<LessonTrack, { intro: string; topics: Topics }> = {
  cka: {
    intro:
      'Guided drills for the commands you type again and again. Pick a lesson: the steps are on the left, a terminal on a fresh cluster on the right, and each step turns green once you have run it. Turn on Drill to hide the commands and type them from memory.',
    topics: {
      certificates: { name: 'Certificates', blurb: 'openssl, kubeadm certs and CertificateSigningRequests' },
      etcd: { name: 'etcd', blurb: 'etcdctl and etcdutl: back up and restore the cluster state' },
      cluster: { name: 'Cluster', blurb: 'kubeadm and control plane chores' },
    },
  },
  linux: {
    intro:
      'The Linux commands the CKA expects you to know cold, practised on the nodes of a real cluster. Each step turns green once you have run it; turn on Drill to hide the commands and type them from memory.',
    topics: {
      openssl: { name: 'openssl', blurb: 'keys, CSRs, signing and reading certificates' },
      firewall: { name: 'Firewall', blurb: 'ufw and iptables: open, block and inspect ports' },
      systemd: { name: 'systemd and logs', blurb: 'systemctl, drop-ins and journalctl' },
      networking: { name: 'Networking', blurb: 'ip, ss, curl, nc, DNS lookups and sysctl' },
      files: { name: 'Files and text', blurb: 'find, grep, sed, awk, base64, tar and permissions' },
    },
  },
};

export function LearnPage({ track }: { track: LessonTrack }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const session = useSession().data;
  const sessionPath = `${SECTIONS[track].base}/session`;
  const { intro, topics: TOPICS } = TRACKS[track];
  const lessons = useQuery({ queryKey: ['lessons', track], queryFn: () => api.lessons(track) });
  const start = useMutation({
    mutationFn: api.startLesson,
    onSuccess: (view) => {
      qc.setQueryData(sessionKey, view);
      navigate(sessionPath);
    },
  });
  const byTopic = new Map<LessonTopic, LessonSummary[]>();
  for (const l of lessons.data?.lessons ?? []) byTopic.set(l.topic, [...(byTopic.get(l.topic) ?? []), l]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Learn</h1>
        <p className="mt-1 text-sm text-zinc-400">{intro}</p>
      </div>

      {session && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm">
          <span className="text-zinc-300">
            {session.mode === 'learn'
              ? `The lesson "${session.scenarioTitle}" is open.`
              : `A session for "${session.scenarioTitle}" is open. End it to start a lesson.`}
          </span>
          <Link to={sessionPath} className={`${buttonClass('primary')} ml-auto`}>
            Go to session
          </Link>
        </div>
      )}

      <ErrorBanner error={lessons.error ?? start.error} />
      {lessons.data?.errors.map((e) => (
        <div key={e.file} className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-xs text-red-200">
          {e.file}: {e.messages.join('; ')}
        </div>
      ))}

      {(Object.keys(TOPICS) as LessonTopic[])
        .filter((t) => byTopic.has(t))
        .map((topic) => (
          <section key={topic} className="space-y-2">
            <div className="flex items-baseline gap-3">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">{TOPICS[topic]!.name}</h2>
              <span className="text-xs text-zinc-500">{TOPICS[topic]!.blurb}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {byTopic.get(topic)!.map((l) => (
                <button
                  key={l.id}
                  disabled={!!session || start.isPending}
                  onClick={() => start.mutate(l.id)}
                  className="group rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-left transition enabled:hover:border-sky-700 enabled:hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="font-semibold text-zinc-100 group-enabled:group-hover:text-sky-200">{l.title}</div>
                  <p className="mt-1 text-sm text-zinc-400">{l.summary}</p>
                  <div className="mt-3 text-xs text-zinc-500">
                    {l.stepCount} steps · ~{l.estimatedMinutes} min
                    {start.isPending && start.variables === l.id && <span className="ml-2 text-sky-300">starting…</span>}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      {lessons.data && !lessons.data.lessons.length && <p className="text-sm text-zinc-500">No {track} lessons found in lessons/.</p>}
    </div>
  );
}
