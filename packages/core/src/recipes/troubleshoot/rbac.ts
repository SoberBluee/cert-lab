import { createNs, nameField, nsField, sq } from '../types';
import type { FaultCategory } from './types';

const lastLine = (ns: string, app: string) => `kubectl -n "${ns}" logs "deployment/${app}" --tail=1 2>/dev/null`;

/** Each loop of the reporter takes about 5s; wait for a fresh line after a change. */
const waitStatus = (ns: string, app: string) => `for _ in $(seq 1 60); do
  [[ "$(${lastLine(ns, app)})" == 200 ]] && break
  sleep 3
done`;

const rollout = (ns: string, app: string) => `kubectl -n "${ns}" rollout status "deployment/${app}" --timeout=240s`;

const patchRole = (ns: string, app: string, path: string, value: string) =>
  `kubectl -n "${ns}" patch role "${app}-reader" --type=json -p ${sq(`[{"op":"replace","path":"${path}","value":${value}}]`)}`;

const patchSubjectNs = (ns: string, app: string, value: string) =>
  `kubectl -n "${ns}" patch rolebinding "${app}-reader" --type=json -p ${sq(`[{"op":"replace","path":"/subjects/0/namespace","value":"${value}"}]`)}`;

const bindTo = (ns: string, app: string, role: string) => `kubectl -n "${ns}" delete rolebinding "${app}-reader"
kubectl -n "${ns}" create rolebinding "${app}-reader" --role="${role}" --serviceaccount="${ns}:${app}-sa"`;

const sa = (ns: string, app: string) => `system:serviceaccount:${ns}:${app}-sa`;

export const rbacCategory: FaultCategory = {
  id: 'rbac',
  name: 'RBAC and ServiceAccounts',
  description: 'A Pod that lists Pods through the API with its ServiceAccount token gets refused.',
  domain: 'cluster-architecture',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['troubleshooting', 'rbac', 'serviceaccount', 'role', 'rolebinding'],
  settleSeconds: 30,
  fields: [
    nsField(['monitoring', 'audit', 'reports', 'observe', 'security', 'compliance', 'metrics', 'logging', 'ops', 'sre']),
    nameField('APP', 'Deployment name', ['inventory', 'watcher', 'auditor', 'scanner', 'collector', 'reporter', 'agent', 'probe', 'sentinel', 'inspector']),
  ],
  shell: ({ NS, APP }) => ({
    title: `${APP} cannot list Pods`,
    text: `Deployment \`${APP}\` in namespace \`${NS}\` calls the Kubernetes API every few seconds to list the Pods of its namespace, and logs the HTTP status of each call. It used to log \`200\`; now it does not.

Fix it so that \`${APP}\` logs \`200\` again. The intended setup is:

- Deployment \`${APP}\` runs as ServiceAccount \`${APP}-sa\`, using the token Kubernetes mounts into the Pod
- Role \`${APP}-reader\` allows \`get\` and \`list\` on \`pods\` in \`${NS}\`, and nothing else
- RoleBinding \`${APP}-reader\` grants that Role to \`${APP}-sa\`

Do not grant \`${APP}-sa\` any other permission.`,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${APP}-sa
  namespace: ${NS}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${APP}-reader
  namespace: ${NS}
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${APP}-reader
  namespace: ${NS}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: ${APP}-reader
subjects:
  - kind: ServiceAccount
    name: ${APP}-sa
    namespace: ${NS}
---
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
      serviceAccountName: ${APP}-sa
      containers:
        - name: reporter
          image: alpine:3.21
          env:
            - name: NS
              valueFrom: { fieldRef: { fieldPath: metadata.namespace } }
          command:
            - sh
            - -c
            - |
              D=/var/run/secrets/kubernetes.io/serviceaccount
              while true; do
                if [ ! -r \\$D/token ]; then
                  echo "no token at \\$D/token"
                elif out=\\$(wget -q -O /dev/null --no-check-certificate --header "Authorization: Bearer \\$(cat \\$D/token)" https://kubernetes.default.svc/api/v1/namespaces/\\$NS/pods 2>&1); then
                  echo 200
                else
                  echo "\\$out"
                fi
                sleep 5
              done
EOF`,
    after: `kubectl -n "${NS}" scale "deployment/${APP}" --replicas=1
${rollout(NS, APP)}
for _ in $(seq 1 30); do
  line="$(${lastLine(NS, APP)})"
  [[ -n "$line" && "$line" != 200 ]] && break
  sleep 2
done
[[ "$(${lastLine(NS, APP)})" != 200 ]] || { echo "${APP} still lists Pods" >&2; exit 1; }`,
    checks: [
      {
        id: 'can-list',
        description: `${APP}-sa may list Pods in ${NS}`,
        type: 'kubectl',
        run: `kubectl auth can-i list pods -n ${NS} --as=${sa(NS, APP)}`,
        expect: { equals: 'yes' },
        weight: 2,
      },
      {
        id: 'logs-200',
        description: `${APP}'s latest call returned 200`,
        type: 'kubectl',
        run: `kubectl -n ${NS} logs deployment/${APP} --tail=1`,
        expect: { equals: '200' },
        weight: 2,
        retrySeconds: 60,
      },
      {
        id: 'spec',
        description: `${APP} runs as ${APP}-sa, and RoleBinding ${APP}-reader grants Role ${APP}-reader to it`,
        type: 'kubectl',
        run: `echo "$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.template.spec.serviceAccountName}') $(kubectl -n ${NS} get rolebinding ${APP}-reader -o jsonpath='{.roleRef.kind}/{.roleRef.name} {.subjects[*].namespace}/{.subjects[*].name}')"`,
        expect: { equals: `${APP}-sa Role/${APP}-reader ${NS}/${APP}-sa` },
        weight: 1,
      },
      {
        id: 'least-privilege',
        description: `${APP}-sa cannot delete Pods or read Secrets`,
        type: 'kubectl',
        run: `echo "$(kubectl auth can-i delete pods -n ${NS} --as=${sa(NS, APP)}) $(kubectl auth can-i get secrets -n ${NS} --as=${sa(NS, APP)})"`,
        expect: { equals: 'no no' },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} logs deployment/${APP}: 401, 403 or a missing token point at different problems.`,
      `kubectl auth can-i list pods -n ${NS} --as=${sa(NS, APP)} tells you whether RBAC allows the call at all.`,
      `kubectl -n ${NS} get role,rolebinding -o yaml: check the verbs, the resource names, the roleRef and the subject's namespace.`,
      `kubectl -n ${NS} get pod -l app=${APP} -o yaml | grep -i serviceaccount, and kubectl -n ${NS} get sa ${APP}-sa -o yaml.`,
    ],
  }),
  faults: ({ NS, APP }) => [
    {
      id: 'role-verb',
      label: 'Role grants get but not list',
      break: patchRole(NS, APP, '/rules/0/verbs', '["get"]'),
      fix: patchRole(NS, APP, '/rules/0/verbs', '["get","list"]'),
      wait: waitStatus(NS, APP),
      explain: `Role \`${APP}-reader\` only allows \`get\`. Listing Pods is the \`list\` verb, so the API answers 403 Forbidden. Add \`list\` to the verbs.`,
    },
    {
      id: 'role-resource',
      label: 'Role names the resource "pod"',
      break: patchRole(NS, APP, '/rules/0/resources', '["pod"]'),
      fix: patchRole(NS, APP, '/rules/0/resources', '["pods"]'),
      wait: waitStatus(NS, APP),
      explain: `Role \`${APP}-reader\` grants access to \`pod\`. RBAC resources are the plural API names, so \`pod\` matches nothing and the call gets 403. Use \`pods\`.`,
    },
    {
      id: 'binding-subject-ns',
      label: 'RoleBinding subject in the wrong namespace',
      break: patchSubjectNs(NS, APP, 'default'),
      fix: patchSubjectNs(NS, APP, NS),
      wait: waitStatus(NS, APP),
      explain: `RoleBinding \`${APP}-reader\` grants the Role to ServiceAccount \`${APP}-sa\` in namespace \`default\`, a different account from the one the Pod uses. Set the subject's namespace to \`${NS}\`.`,
    },
    {
      id: 'binding-role-ref',
      label: 'RoleBinding refers to a Role that does not exist',
      break: bindTo(NS, APP, `${APP}-viewer`),
      fix: bindTo(NS, APP, `${APP}-reader`),
      wait: waitStatus(NS, APP),
      explain: `RoleBinding \`${APP}-reader\` refers to Role \`${APP}-viewer\`, which does not exist, so it grants nothing. \`roleRef\` cannot be edited: delete the RoleBinding and create it again for Role \`${APP}-reader\`.`,
    },
    {
      id: 'wrong-sa',
      label: 'Deployment runs as the default ServiceAccount',
      break: `kubectl -n "${NS}" set serviceaccount "deployment/${APP}" default`,
      fix: `kubectl -n "${NS}" set serviceaccount "deployment/${APP}" "${APP}-sa"\n${rollout(NS, APP)}`,
      wait: waitStatus(NS, APP),
      explain: `The Deployment runs as ServiceAccount \`default\`, which has no Role, so the call gets 403 for \`system:serviceaccount:${NS}:default\` (the logs and \`kubectl get pod -o yaml\` show the account). Set \`serviceAccountName: ${APP}-sa\`.`,
    },
    {
      id: 'automount-off',
      label: 'ServiceAccount token not mounted',
      break: `kubectl -n "${NS}" patch serviceaccount "${APP}-sa" -p '{"automountServiceAccountToken":false}'`,
      fix: `kubectl -n "${NS}" patch serviceaccount "${APP}-sa" -p '{"automountServiceAccountToken":true}'
kubectl -n "${NS}" rollout restart "deployment/${APP}"
${rollout(NS, APP)}`,
      wait: waitStatus(NS, APP),
      explain: `ServiceAccount \`${APP}-sa\` sets \`automountServiceAccountToken: false\`, so no token is mounted and the Pod logs \`no token\`. RBAC is fine. Allow the automount (on the ServiceAccount or the Pod spec) and restart the Deployment so new Pods get the token.`,
    },
  ],
};
