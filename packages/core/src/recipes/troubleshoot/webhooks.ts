import { createNs, nameField, nsField } from '../types';
import type { FaultCategory } from './types';
import { waitUnhealthy } from './wait';

const IMAGE = 'nginx:1.27-alpine';
const WH = 'orphan-validate';

const waitReady = (ns: string, app: string) => `kubectl -n "${ns}" rollout status "deployment/${app}" --timeout=240s`;

export const webhooksCategory: FaultCategory = {
  id: 'webhooks',
  name: 'Admission webhooks',
  description: 'A leftover ValidatingWebhookConfiguration blocks Pod creates in a namespace.',
  domain: 'troubleshooting',
  difficulty: 3,
  minutes: 12,
  points: 7,
  tags: ['troubleshooting', 'webhook', 'admission'],
  settleSeconds: 40,
  fields: [
    nsField(['hooks', 'admit', 'gate', 'policy', 'validate', 'mutate', 'control', 'guard', 'policy-lab', 'admission']),
    nameField('APP', 'Deployment name', ['frontend', 'api', 'portal', 'web', 'gateway', 'admin', 'console', 'dashboard', 'app', 'service']),
  ],
  shell: ({ NS, APP }, state) => ({
    title: `Pods cannot be created in ${NS}`,
    text: `Deployment \`${APP}\` in namespace \`${NS}\` should run \`2\` ready replicas, but its new Pods never come up. Fix it so that \`${APP}\` runs \`2\` ready replicas and new Pods can be created in \`${NS}\` again.

Keep the image, and do not delete or recreate the Deployment.`,
    spec: `- no admission webhook rejects Pod creates in \`${NS}\`: \`${WH}\` is a leftover whose Service does not exist
- Deployment \`${APP}\`: \`2\` replicas of \`${IMAGE}\``,
    before: `${createNs(NS)}
kubectl label namespace "${NS}" webhook-lab=true --overwrite
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
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
          readinessProbe:
            httpGet: { path: /, port: 80 }
            periodSeconds: 5
EOF
kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.metadata.uid}' > "${state}.uid"
chmod 644 "${state}.uid"`,
    after: `kubectl -n "${NS}" scale "deployment/${APP}" --replicas=2
${waitUnhealthy(NS, `app=${APP}`, 30)}
[[ "$(kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.status.readyReplicas}')" != 2 ]] || { echo "${APP} is still healthy" >&2; exit 1; }`,
    checks: [
      {
        id: 'ready',
        description: `${APP} has 2 ready replicas`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.status.readyReplicas}/{.status.replicas}'`,
        expect: { equals: '2/2' },
        weight: 3,
        retrySeconds: 90,
      },
      {
        id: 'same-deployment',
        description: `${APP} was not deleted or recreated`,
        type: 'kubectl',
        run: `[ "$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.metadata.uid}')" = "$(cat ${state}.uid)" ] && echo same || echo recreated`,
        expect: { equals: 'same' },
        weight: 1,
      },
      {
        id: 'image',
        description: `${APP} still runs ${IMAGE}`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.template.spec.containers[0].image}'`,
        expect: { equals: IMAGE },
        weight: 1,
      },
      {
        id: 'can-create',
        description: `a new Pod can be created in ${NS}`,
        type: 'kubectl',
        run: `kubectl -n ${NS} delete pod webhook-probe --ignore-not-found --wait=false >/dev/null 2>&1; kubectl -n ${NS} run webhook-probe --image=busybox:1.36 --restart=Never --command -- true >/dev/null 2>&1 && kubectl -n ${NS} wait --for=jsonpath='{.status.phase}'=Succeeded pod/webhook-probe --timeout=60s >/dev/null 2>&1 && echo ok || echo fail`,
        expect: { equals: 'ok' },
        weight: 2,
        retrySeconds: 60,
      },
    ],
    hints: [
      `No Pods at all? The ReplicaSet could not create them: kubectl -n ${NS} describe rs -l app=${APP} shows the FailedCreate message.`,
      'Read the message word for word: it names whatever refused the request, whether that is a quota, a policy or a webhook.',
      'Admission webhooks are cluster-scoped: kubectl get validatingwebhookconfiguration,mutatingwebhookconfiguration, then -o yaml to see which namespaces and resources each one covers, which Service it calls, and what happens when that call fails.',
    ],
  }),
  faults: ({ NS, APP }) => [
    {
      id: 'webhook-orphan-fail',
      label: 'Orphan validating webhook fails closed',
      break: `kubectl apply -f - <<< '{"apiVersion":"admissionregistration.k8s.io/v1","kind":"ValidatingWebhookConfiguration","metadata":{"name":"${WH}"},"webhooks":[{"name":"orphan.cka.lab","failurePolicy":"Fail","sideEffects":"None","timeoutSeconds":3,"admissionReviewVersions":["v1"],"clientConfig":{"service":{"name":"missing-webhook-svc","namespace":"'"${NS}"'","path":"/validate"},"caBundle":"LS0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0t"},"rules":[{"apiGroups":[""],"apiVersions":["v1"],"operations":["CREATE"],"resources":["pods"],"scope":"Namespaced"}],"namespaceSelector":{"matchLabels":{"webhook-lab":"true"}}}]}'`,
      fix: `kubectl delete validatingwebhookconfiguration ${WH} --ignore-not-found`,
      wait: waitReady(NS, APP),
      explain: `ValidatingWebhookConfiguration \`${WH}\` selects namespaces labelled \`webhook-lab=true\` and calls Service \`${NS}/missing-webhook-svc\`, which does not exist. With \`failurePolicy: Fail\`, every Pod create times out and the ReplicaSet stays at 0 ready Pods (\`FailedCreate\` / webhook errors in the Events). Delete the orphan webhook (or point it at a working endpoint).`,
    },
  ],
};
