import { createNs, nameField, nsField, sq } from '../types';
import type { FaultCategory } from './types';
import { waitUnhealthy } from './wait';

const IMAGE = 'nginx:1.27-alpine';

const jsonPatch = (ns: string, app: string, ops: string) => `kubectl -n "${ns}" patch deployment "${app}" --type=json -p ${sq(ops)}`;

const rollout = (ns: string, app: string) => `kubectl -n "${ns}" rollout status "deployment/${app}" --timeout=240s`;

const dropSecurityContext = (ns: string, app: string) =>
  `${jsonPatch(ns, app, '[{"op":"remove","path":"/spec/template/spec/containers/0/securityContext"}]')}\n${rollout(ns, app)}`;

export const podConfigCategory: FaultCategory = {
  id: 'podconfig',
  name: 'Pod configuration',
  description: 'A Deployment that serves its page from a ConfigMap and reads a Secret no longer comes up healthy.',
  domain: 'workloads',
  difficulty: 1,
  minutes: 7,
  points: 6,
  tags: ['troubleshooting', 'configmap', 'secret', 'volumes', 'security-context'],
  settleSeconds: 30,
  fields: [
    nsField(['brochure', 'docs', 'landing', 'marketing', 'cms', 'pages', 'publish', 'content', 'static', 'www']),
    nameField('APP', 'Deployment name', ['site', 'welcome', 'promo', 'home', 'docs-web', 'landing-page', 'brochure-app', 'cms', 'blog', 'press']),
  ],
  shell: ({ NS, APP }) => ({
    title: `Deployment ${APP} does not serve its page`,
    text: `Deployment \`${APP}\` in namespace \`${NS}\` was just reconfigured and is no longer healthy. Fix it so that it matches this spec and both Pods are ready:

- \`2\` replicas of image \`${IMAGE}\`, container \`web\` serving on port \`80\`, with a readiness probe doing an HTTP GET of \`/\`
- the page \`index.html\` from ConfigMap \`${APP}-content\`, mounted at \`/usr/share/nginx/html\`
- key \`token\` of Secret \`${APP}-secret\`, mounted as the file \`/etc/${APP}/token\`

Do not delete or recreate the Deployment. Prefer fixing mounts and securityContext on the Pod template; replace the ConfigMap or Secret only if they cannot be patched (for example when marked immutable).`,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${APP}-content
  namespace: ${NS}
data:
  index.html: "<h1>${APP} is up</h1>"
---
apiVersion: v1
kind: Secret
metadata:
  name: ${APP}-secret
  namespace: ${NS}
stringData:
  token: s3cr3t-${APP}
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
      containers:
        - name: web
          image: ${IMAGE}
          ports: [{ containerPort: 80 }]
          readinessProbe:
            httpGet: { path: /, port: 80 }
            periodSeconds: 5
          volumeMounts:
            - { name: content, mountPath: /usr/share/nginx/html }
            - { name: secret, mountPath: /etc/${APP}, readOnly: true }
      volumes:
        - name: content
          configMap: { name: ${APP}-content }
        - name: secret
          secret:
            secretName: ${APP}-secret
            items: [{ key: token, path: token }]
EOF`,
    after: `kubectl -n "${NS}" scale "deployment/${APP}" --replicas=2
${waitUnhealthy(NS, `app=${APP}`)}
[[ "$(kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.status.readyReplicas}')" != 2 ]] || { echo "${APP} is still healthy" >&2; exit 1; }`,
    checks: [
      {
        id: 'ready',
        description: `${APP} has 2 ready replicas`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.status.readyReplicas}/{.status.updatedReplicas}/{.status.replicas}'`,
        expect: { equals: '2/2/2' },
        weight: 2,
        retrySeconds: 60,
      },
      {
        id: 'page',
        description: `${APP} serves the page from ${APP}-content`,
        type: 'kubectl',
        run: `kubectl -n ${NS} exec deployment/${APP} -- wget -qO- -T 3 http://localhost:80/`,
        expect: { contains: `${APP} is up` },
        weight: 2,
        retrySeconds: 30,
      },
      {
        id: 'token',
        description: `the token from ${APP}-secret is readable at /etc/${APP}/token`,
        type: 'kubectl',
        run: `kubectl -n ${NS} exec deployment/${APP} -- cat /etc/${APP}/token`,
        expect: { equals: `s3cr3t-${APP}` },
        weight: 1,
        retrySeconds: 30,
      },
      {
        id: 'spec-volumes',
        description: 'the volumes still come from a ConfigMap and the Secret',
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.template.spec.containers[0].image} {.spec.template.spec.volumes[?(@.configMap)].configMap.name} {.spec.template.spec.volumes[?(@.secret)].secret.secretName}'`,
        expect: { matches: `^${IMAGE} \\S+ ${APP}-secret$` },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} get pods -l app=${APP}: are the Pods Pending, ContainerCreating, crashing, or running but not ready?`,
      `kubectl -n ${NS} describe pod <pod>: the Events name mount failures and container config errors.`,
      `kubectl -n ${NS} logs <pod> (or --previous) shows why nginx exits or what it cannot find.`,
      `Compare the volumes, volumeMounts and securityContext in kubectl -n ${NS} get deployment ${APP} -o yaml with the spec and with the ConfigMap and Secret keys.`,
    ],
  }),
  faults: ({ NS, APP }) => [
    {
      id: 'configmap-volume-missing',
      label: 'Volume names a ConfigMap that does not exist',
      break: jsonPatch(NS, APP, `[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"${APP}-contents"}]`),
      fix: `${jsonPatch(NS, APP, `[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"${APP}-content"}]`)}\n${rollout(NS, APP)}`,
      explain: `The \`content\` volume refers to ConfigMap \`${APP}-contents\`, which does not exist, so the Pods stay in \`ContainerCreating\` and the Events show \`FailedMount ... configmap "${APP}-contents" not found\`. Point the volume back at \`${APP}-content\`.`,
    },
    {
      id: 'secret-items-key',
      label: 'Secret volume asks for a key the Secret does not have',
      break: jsonPatch(NS, APP, '[{"op":"replace","path":"/spec/template/spec/volumes/1/secret/items/0/key","value":"api-token"}]'),
      fix: `${jsonPatch(NS, APP, '[{"op":"replace","path":"/spec/template/spec/volumes/1/secret/items/0/key","value":"token"}]')}\n${rollout(NS, APP)}`,
      explain: `The \`secret\` volume projects key \`api-token\`, but Secret \`${APP}-secret\` only has \`token\`. The mount fails (\`references non-existent secret key: api-token\` in the Events) and the Pods stay in \`ContainerCreating\`. Set the item key back to \`token\`.`,
    },
    {
      id: 'mount-path',
      label: 'ConfigMap mounted one directory too high',
      break: jsonPatch(NS, APP, '[{"op":"replace","path":"/spec/template/spec/containers/0/volumeMounts/0/mountPath","value":"/usr/share/nginx"}]'),
      fix: `${jsonPatch(NS, APP, '[{"op":"replace","path":"/spec/template/spec/containers/0/volumeMounts/0/mountPath","value":"/usr/share/nginx/html"}]')}\n${rollout(NS, APP)}`,
      explain:
        'The ConfigMap is mounted at `/usr/share/nginx`, which hides the `html` directory nginx serves from. nginx runs, but `/` returns 404, so the readiness probe fails and the Pods stay `0/1`. `kubectl exec` and `ls /usr/share/nginx` show `index.html` in the wrong place. Mount it at `/usr/share/nginx/html`.',
    },
    {
      id: 'run-as-non-root',
      label: 'runAsNonRoot on an image that runs as root',
      break: jsonPatch(NS, APP, '[{"op":"add","path":"/spec/template/spec/containers/0/securityContext","value":{"runAsNonRoot":true}}]'),
      fix: dropSecurityContext(NS, APP),
      explain:
        'The container sets `runAsNonRoot: true`, but the nginx image starts as root, so the kubelet refuses to start it: `CreateContainerConfigError` with `container has runAsNonRoot and image will run as root`. Remove the securityContext (or run an image built for a non-root user).',
    },
    {
      id: 'readonly-root',
      label: 'Read-only root filesystem',
      break: jsonPatch(NS, APP, '[{"op":"add","path":"/spec/template/spec/containers/0/securityContext","value":{"readOnlyRootFilesystem":true}}]'),
      fix: dropSecurityContext(NS, APP),
      explain:
        'The container sets `readOnlyRootFilesystem: true`. nginx needs to write its cache and pid files, so it exits at startup and the Pods go into `CrashLoopBackOff`; `kubectl logs --previous` shows `Read-only file system`. Remove the securityContext, or mount writable `emptyDir` volumes where nginx writes.',
    },
    {
      id: 'immutable-configmap',
      label: 'Immutable ConfigMap has the wrong page',
      break: `kubectl -n "${NS}" delete configmap "${APP}-content" --wait=true
kubectl -n "${NS}" apply -f - <<< '{"apiVersion":"v1","kind":"ConfigMap","metadata":{"name":"'"${APP}"'-content","namespace":"'"${NS}"'"},"immutable":true,"data":{"index.html":"<h1>wrong page</h1>"}}'`,
      fix: `kubectl -n "${NS}" create configmap "${APP}-content-fixed" --from-literal=index.html="<h1>${APP} is up</h1>"
${jsonPatch(NS, APP, `[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"${APP}-content-fixed"}]`)}
${rollout(NS, APP)}
kubectl -n "${NS}" delete configmap "${APP}-content" --ignore-not-found`,
      explain: `ConfigMap \`${APP}-content\` is \`immutable: true\` and serves the wrong \`index.html\`. Edits are rejected, and recreating it under the same name often leaves the kubelet serving the cached immutable object. Create a new ConfigMap with the correct page, point the Deployment volume at it, then delete the old ConfigMap.`,
    },
  ],
};
