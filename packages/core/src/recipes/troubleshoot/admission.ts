import { createNs, nameField, nsField } from '../types';
import type { FaultCategory } from './types';

const IMAGE = 'nginx:1.27-alpine';

const applyObject = (ns: string, json: string) => `kubectl -n "${ns}" apply -f - <<< '${json}'`;

const rollout = (ns: string, app: string) => `kubectl -n "${ns}" rollout restart "deployment/${app}" >/dev/null
kubectl -n "${ns}" rollout status "deployment/${app}" --timeout=240s`;

/**
 * A symptom-only question: new Pods in one namespace are refused at admission. What refuses them
 * (a quota, a LimitRange, Pod Security, a webhook) is for the FailedCreate event to tell.
 */
export const admissionCategory: FaultCategory = {
  id: 'admission',
  name: 'Rejected Pods',
  description: 'New Pods in a namespace are refused at admission. Only the symptom is given; the FailedCreate events say what refuses them.',
  domain: 'workloads',
  difficulty: 2,
  minutes: 8,
  points: 5,
  tags: ['troubleshooting', 'admission', 'resourcequota', 'limitrange', 'pod-security', 'webhook'],
  settleSeconds: 30,
  fields: [
    nsField(['batch', 'tenant-a', 'tenant-b', 'sandbox', 'staging', 'analytics', 'reports', 'ingest', 'team-blue', 'team-red']),
    nameField('APP', 'Deployment name', ['worker', 'ingest', 'reporter', 'indexer', 'exporter', 'crawler', 'mailer', 'resizer', 'uploader', 'digest']),
  ],
  shell: ({ NS, APP }, state) => ({
    title: `New Pods rejected in ${NS}`,
    text: `Since this morning, new Pods in namespace \`${NS}\` are rejected, so Deployment \`${APP}\` cannot reach its \`2\` replicas. Find what rejects them and fix it, so that \`${APP}\` runs \`2\` ready replicas.

Do not change, delete or recreate Deployment \`${APP}\`: fix whatever rejects its Pods instead.`,
    spec: `- Deployment \`${APP}\`: \`2\` replicas of \`${IMAGE}\`, requesting \`100m\` CPU and \`64Mi\` memory, no limits, running as the image's default user
- namespace \`${NS}\` has no ResourceQuota or LimitRange that refuses those Pods, no restrictive Pod Security label, and no admission webhook applies to it`,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
  labels: { app: ${APP} }
spec:
  replicas: 0
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      containers:
        - name: web
          image: ${IMAGE}
          ports: [{ containerPort: 80 }]
          resources:
            requests: { cpu: 100m, memory: 64Mi }
EOF`,
    after: `kubectl -n "${NS}" scale "deployment/${APP}" --replicas=2
# What "do not change the Deployment" means: this object, replica count and Pod spec. A rollout
# restart only annotates the template, so it stays allowed.
kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.metadata.uid} {.spec.replicas} {.spec.template.spec}' > "${state}.deploy"
chmod 644 "${state}.deploy"
sleep 15
[[ "$(kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.status.readyReplicas}')" != 2 ]] || { echo "${APP} still runs 2 replicas" >&2; exit 1; }`,
    checks: [
      {
        id: 'ready',
        description: `${APP} runs 2 ready replicas`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.status.readyReplicas}/{.status.replicas}'`,
        expect: { equals: '2/2' },
        weight: 4,
        retrySeconds: 90,
      },
      {
        id: 'unchanged',
        description: `Deployment ${APP} was not changed or recreated`,
        type: 'kubectl',
        run: `[ "$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.metadata.uid} {.spec.replicas} {.spec.template.spec}')" = "$(cat ${state}.deploy)" ] && echo unchanged || echo changed`,
        expect: { equals: 'unchanged' },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} get deployment,replicaset,pods: no Pods at all, or fewer than wanted, means they were refused before they existed.`,
      `kubectl -n ${NS} describe replicaset -l app=${APP}: the FailedCreate event quotes the refusal word for word.`,
      'That message names whatever refused the Pod. Find that object, whether it lives in the namespace, on the namespace or cluster-wide, and read what it enforces.',
    ],
  }),
  faults: ({ NS, APP }) => [
    {
      id: 'quota-pods',
      label: 'ResourceQuota allows a single Pod',
      break: applyObject(NS, '{"apiVersion":"v1","kind":"ResourceQuota","metadata":{"name":"tenant-quota"},"spec":{"hard":{"pods":"1"}}}'),
      fix: `kubectl -n "${NS}" delete resourcequota tenant-quota`,
      wait: rollout(NS, APP),
      explain: `ResourceQuota \`tenant-quota\` caps the namespace at \`1\` Pod, so the ReplicaSet's second create fails with "exceeded quota: tenant-quota". Delete the quota, or raise \`pods\` to at least \`2\`.`,
    },
    {
      id: 'quota-limits',
      label: 'ResourceQuota requires CPU limits the Pods do not set',
      break: applyObject(NS, '{"apiVersion":"v1","kind":"ResourceQuota","metadata":{"name":"compute-quota"},"spec":{"hard":{"requests.cpu":"2","limits.cpu":"4"}}}'),
      fix: `kubectl -n "${NS}" delete resourcequota compute-quota`,
      wait: rollout(NS, APP),
      explain:
        'ResourceQuota `compute-quota` tracks `limits.cpu`, so every Pod in the namespace must declare a CPU limit. The Deployment sets none and may not be changed, so its Pods fail with "must specify limits.cpu". Delete the quota, or add a LimitRange that gives containers a default CPU limit.',
    },
    {
      id: 'limitrange-max',
      label: 'LimitRange maximum below the request',
      break: applyObject(NS, '{"apiVersion":"v1","kind":"LimitRange","metadata":{"name":"container-limits"},"spec":{"limits":[{"type":"Container","max":{"cpu":"50m"}}]}}'),
      fix: `kubectl -n "${NS}" delete limitrange container-limits`,
      wait: rollout(NS, APP),
      explain:
        'LimitRange `container-limits` caps containers at `50m` CPU. That max also becomes the default limit, which is below the `100m` request, so every Pod is refused at admission. Delete the LimitRange or raise its max to at least `100m`.',
    },
    {
      id: 'limitrange-min',
      label: 'LimitRange minimum above the request',
      break: applyObject(NS, '{"apiVersion":"v1","kind":"LimitRange","metadata":{"name":"container-floor"},"spec":{"limits":[{"type":"Container","min":{"memory":"128Mi"}}]}}'),
      fix: `kubectl -n "${NS}" delete limitrange container-floor`,
      wait: rollout(NS, APP),
      explain:
        'LimitRange `container-floor` requires every container to request at least `128Mi` of memory, and the Pods request `64Mi`, so they fail with "minimum memory usage per Container is 128Mi". Delete the LimitRange or lower its minimum to `64Mi` or less.',
    },
    {
      id: 'pod-security',
      label: 'Namespace enforces the restricted Pod Security standard',
      break: `kubectl label namespace "${NS}" pod-security.kubernetes.io/enforce=restricted --overwrite`,
      fix: `kubectl label namespace "${NS}" pod-security.kubernetes.io/enforce-`,
      wait: rollout(NS, APP),
      explain: `Namespace \`${NS}\` carries the label \`pod-security.kubernetes.io/enforce=restricted\`. The nginx Pods run as root, allow privilege escalation and keep their capabilities, so Pod Security admission refuses them ("violates PodSecurity restricted:latest"); \`kubectl get ns ${NS} --show-labels\` shows the label. The Deployment may not change, so relax the namespace: remove the label, or enforce \`baseline\` instead.`,
    },
    {
      id: 'webhook',
      label: 'Validating webhook with a missing Service fails closed',
      break: `kubectl label namespace "${NS}" policy.cka.lab/checked=true --overwrite
kubectl apply -f - <<< '{"apiVersion":"admissionregistration.k8s.io/v1","kind":"ValidatingWebhookConfiguration","metadata":{"name":"'"${NS}"'-pod-policy"},"webhooks":[{"name":"pods.policy.cka.lab","failurePolicy":"Fail","sideEffects":"None","timeoutSeconds":3,"admissionReviewVersions":["v1"],"clientConfig":{"service":{"name":"pod-policy","namespace":"'"${NS}"'","path":"/validate"},"caBundle":"LS0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0t"},"rules":[{"apiGroups":[""],"apiVersions":["v1"],"operations":["CREATE"],"resources":["pods"],"scope":"Namespaced"}],"namespaceSelector":{"matchLabels":{"policy.cka.lab/checked":"true"}}}]}'`,
      fix: `kubectl delete validatingwebhookconfiguration "${NS}-pod-policy"`,
      wait: rollout(NS, APP),
      explain: `ValidatingWebhookConfiguration \`${NS}-pod-policy\` sends every Pod create in \`${NS}\` to Service \`${NS}/pod-policy\`, which does not exist. With \`failurePolicy: Fail\`, every create fails ("failed calling webhook ... service \\"pod-policy\\" not found"). Delete the webhook, or set its \`failurePolicy\` to \`Ignore\` if it must stay.`,
    },
  ],
};
