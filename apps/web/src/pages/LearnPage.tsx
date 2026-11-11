import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type { LessonSummary, LessonTopic, LessonTrack, QuizTopic } from '@cka/schema';
import { api } from '../api';
import { ErrorBanner, linkClass, Notice, PageHeader, Section, tileAction, tileClass } from '../components/ui';
import { sessionKey, useSession } from '../hooks';
import { SECTIONS } from '../section';

type Topics = Partial<Record<LessonTopic, { name: string; blurb: string }>>;

const QUIZ_TOPIC_META: Record<QuizTopic, { name: string; blurb: string }> = {
  'quiz-errors': { name: 'Error messages', blurb: 'kubectl / API failures → what to check next' },
  'quiz-paths': { name: 'Paths and directories', blurb: 'CNI, kubelet, manifests, etcd, certs' },
  'quiz-workloads': { name: 'Workloads', blurb: 'probes, rollouts, Jobs and scheduling' },
  'quiz-jobs': { name: 'Jobs and CronJobs', blurb: 'a scenario, five options: pick the field, schedule or command that does exactly that' },
  'quiz-networking': { name: 'Services and networking', blurb: 'Service, DNS, NetworkPolicy, Ingress and HTTPRoute' },
  'quiz-storage-rbac': { name: 'Storage and RBAC', blurb: 'PVC binding, access modes, reclaim, Role versus ClusterRole' },
  'quiz-cluster': { name: 'Cluster architecture', blurb: 'Highly available control planes, etcd quorum, upgrades and version skew' },
  'quiz-linux-openssl': { name: 'openssl Q&A', blurb: 'Near-identical commands: pick the one flag or subcommand that makes it right' },
};

const TRACKS: Record<LessonTrack, { intro: string; how: string; topics: Topics }> = {
  cka: {
    intro: 'Guided drills for the commands you type again and again, and quick quizzes.',
    how: 'Pick a lesson: the steps are on the left, a terminal on a fresh cluster on the right, and each step turns green once you have run it. Turn on Drill to hide the commands and type them from memory. Quick drills are offline multiple choice, with no cluster.',
    topics: {
      certificates: { name: 'Certificates', blurb: 'openssl, kubeadm certs and CertificateSigningRequests' },
      etcd: { name: 'etcd', blurb: 'etcdctl and etcdutl: back up and restore the cluster state' },
      cluster: { name: 'Cluster', blurb: 'kubeadm, CoreDNS and control plane chores' },
      jobs: { name: 'Jobs and CronJobs', blurb: 'run work to completion and on a schedule, then find out why it did not' },
      admission: { name: 'Admission control', blurb: 'quotas, LimitRanges, Pod Security and webhooks: what refuses a Pod, and how to tell' },
      troubleshooting: {
        name: 'Debugging, step by step',
        blurb: 'several faults at once: work through the checks in order until every layer is fixed',
      },
    },
  },
  linux: {
    intro: 'The Linux commands the CKA expects you to know cold, on the nodes of a real cluster.',
    how: 'Pick a lesson: the steps are on the left, a terminal on the right, and each step turns green once you have run it. Turn on Drill to hide the commands and type them from memory. Quick drills are offline multiple choice: near-identical options, pick the one that is exactly right, then read why the others miss.',
    topics: {
      openssl: { name: 'openssl', blurb: 'keys, CSRs, signing and reading certificates' },
      firewall: { name: 'Firewall', blurb: 'ufw and iptables: open ports, block traffic, and drill the everyday commands' },
      systemd: { name: 'systemd and logs', blurb: 'systemctl, drop-ins and journalctl' },
      networking: { name: 'Networking', blurb: 'ip, ss, curl, nc, DNS lookups and sysctl' },
      files: { name: 'Files and text', blurb: 'find, grep, sed, awk, base64, tar and permissions' },
    },
  },
  // AWS Labs has scenarios only so far; this keeps the record complete.
  aws: { intro: 'AWS lessons are not written yet. Practise with the scenarios instead.', how: '', topics: {} },
};

export function LearnPage({ track }: { track: LessonTrack }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const session = useSession().data;
  const sessionPath = `${SECTIONS[track].base}/session`;
  const { intro, how, topics: TOPICS } = TRACKS[track];
  const lessons = useQuery({ queryKey: ['lessons', track], queryFn: () => api.lessons(track) });
  const quizList = useQuery({ queryKey: ['quizzes', track], queryFn: () => api.quizzes(track) });
  const start = useMutation({
    mutationFn: api.startLesson,
    onSuccess: (view) => {
      qc.setQueryData(sessionKey, view);
      navigate(sessionPath);
    },
  });
  const byTopic = new Map<LessonTopic, LessonSummary[]>();
  for (const l of lessons.data?.lessons ?? []) byTopic.set(l.topic, [...(byTopic.get(l.topic) ?? []), l]);
  const quizzes = quizList.data?.quizzes ?? [];

  const topicsShown = (Object.keys(TOPICS) as LessonTopic[]).filter((t) => byTopic.has(t));
  const loadErrors = [...(lessons.data?.errors ?? []), ...(quizList.data?.errors ?? [])];

  return (
    <div className="mx-auto max-w-6xl space-y-14 pb-10">
      <PageHeader title="Learn" intro={intro} />

      {session && (
        <div className="-mt-8">
          <Notice
            action={
              <Link to={sessionPath} className={linkClass}>
                Go to session →
              </Link>
            }
          >
            {session.mode === 'learn' ? (
              <>
                Lesson open: <span className="font-medium text-zinc-100">{session.scenarioTitle}</span>
              </>
            ) : (
              <>
                <span className="font-medium text-zinc-100">{session.scenarioTitle}</span> is open. End it to start a lesson.
              </>
            )}
          </Notice>
        </div>
      )}

      {(lessons.error || start.error || quizList.error || loadErrors.length > 0) && (
        <div className="space-y-3">
          <ErrorBanner error={lessons.error ?? start.error ?? quizList.error} />
          {loadErrors.map((e) => (
            <ErrorBanner key={e.file} error={new Error(`${e.file}: ${e.messages.join('; ')}`)} />
          ))}
        </div>
      )}

      {topicsShown.length > 0 && (
        <Section title="Lessons" note="step by step on a live cluster">
          <div className="space-y-8">
            {topicsShown.map((topic) => (
              <div key={topic}>
                <h3 className="mb-3 text-base font-semibold text-zinc-200">
                  {TOPICS[topic]!.name} <span className="ml-1 text-sm font-normal text-zinc-500">{TOPICS[topic]!.blurb}</span>
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {byTopic.get(topic)!.map((l) => (
                    <button
                      key={l.id}
                      disabled={!!session || start.isPending}
                      onClick={() => start.mutate(l.id)}
                      title={l.summary}
                      className={`${tileClass} disabled:cursor-not-allowed disabled:hover:bg-zinc-900/70`}
                    >
                      <span className="line-clamp-2 text-[15px] font-medium text-zinc-100 group-disabled:text-zinc-400">{l.title}</span>
                      <span className="mt-auto flex items-baseline justify-between gap-3 pt-4 text-sm">
                        <span className="text-zinc-500 tabular-nums">
                          {l.stepCount} steps · ~{l.estimatedMinutes} min
                        </span>
                        <span className={`${tileAction} group-disabled:text-zinc-700`}>{start.isPending && start.variables === l.id ? 'Starting…' : 'Start →'}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {lessons.data && !lessons.data.lessons.length && <p className="text-sm text-zinc-500">No {track} lessons found in lessons/.</p>}

      {quizzes.length > 0 && (
        <Section title="Quick drills" note="multiple choice, no cluster">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quizzes.map((q) => (
              <Link
                key={q.id}
                to={`${SECTIONS[track].base}/learn/quiz/${q.id}`}
                title={`${QUIZ_TOPIC_META[q.topic]?.name ?? q.topic}: ${q.summary}`}
                className={tileClass}
              >
                <span className="line-clamp-2 text-[15px] font-medium text-zinc-100">{q.title}</span>
                <span className="mt-auto flex items-baseline justify-between gap-3 pt-4 text-sm">
                  <span className="text-zinc-500 tabular-nums">
                    {q.questionCount} questions · ~{q.estimatedMinutes} min
                  </span>
                  <span className={tileAction}>Start →</span>
                </span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {how && (
        <details className="text-sm text-zinc-400">
          <summary className="cursor-pointer font-medium text-zinc-300 hover:text-zinc-100">How lessons work</summary>
          <p className="mt-3 max-w-3xl leading-relaxed">{how}</p>
        </details>
      )}
    </div>
  );
}
