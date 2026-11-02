import { createNs, nameField, nsField, requireLocalPathClass, sq } from '../types';
import type { FaultCategory } from './types';
import { waitUnhealthy } from './wait';

const IMAGE = 'nginx:1.27-alpine';
const CLASS = 'local-path';
const MOUNT = '/data';

/**
 * `kubectl apply` of a manifest as a JSON here-string: fault snippets are indented inside a `case`, where
 * a heredoc would never end. Shell variables like `$class` in its values expand, as do the question's references.
 */
const applyJson = (m: object) => `kubectl apply -f - <<< ${sq(JSON.stringify(m)).replace(/\$[a-z]+/g, (v) => `'"${v}"'`)}`;

/** `clusterIP` None makes it headless; an empty one gets a cluster IP. */
const service = (ns: string, sts: string, clusterIP: string, app: string) => ({
  apiVersion: 'v1',
  kind: 'Service',
  metadata: { name: `${sts}-hl`, namespace: ns },
  spec: { clusterIP, selector: { app }, ports: [{ name: 'web', port: 80 }] },
});

const statefulSet = (ns: string, sts: string, serviceName: string, storageClassName: string, probePath: string) => ({
  apiVersion: 'apps/v1',
  kind: 'StatefulSet',
  metadata: { name: sts, namespace: ns },
  spec: {
    serviceName,
    replicas: 3,
    selector: { matchLabels: { app: sts } },
    template: {
      metadata: { labels: { app: sts } },
      spec: {
        containers: [
          {
            name: 'nginx',
            image: IMAGE,
            ports: [{ name: 'web', containerPort: 80 }],
            readinessProbe: { httpGet: { path: probePath, port: 80 }, periodSeconds: 5 },
            volumeMounts: [{ name: 'data', mountPath: MOUNT }],
          },
        ],
      },
    },
    volumeClaimTemplates: [
      {
        metadata: { name: 'data' },
        spec: { accessModes: ['ReadWriteOnce'], storageClassName, resources: { requests: { storage: '100Mi' } } },
      },
    ],
  },
});

const healthyStatefulSet = (ns: string, sts: string) => applyJson(statefulSet(ns, sts, `${sts}-hl`, CLASS, '/'));

/** Deletes the StatefulSet and waits for its Pods to go; its claims stay. */
const deleteStatefulSet = (ns: string, sts: string) => `kubectl -n "${ns}" delete statefulset "${sts}" --cascade=foreground --wait=true`;

const rollout = (ns: string, sts: string) => `kubectl -n "${ns}" rollout status "statefulset/${sts}" --timeout=300s`;

/**
 * A StatefulSet with per-Pod DNS and storage. Faults sit in its headless Service, or in what the
 * StatefulSet itself asks for, much of which cannot be changed once it exists.
 */
export const statefulSetsCategory: FaultCategory = {
  id: 'statefulsets',
  name: 'StatefulSets',
  description: 'A StatefulSet whose Pods should each be ready, with their own volume and their own DNS name, is not.',
  domain: 'troubleshooting',
  difficulty: 2,
  minutes: 9,
  points: 8,
  tags: ['troubleshooting', 'statefulset', 'headless', 'dns', 'volumeclaimtemplates'],
  fields: [
    nsField(['databases', 'data', 'state', 'persistence', 'brokers', 'storage-tier', 'backend-data', 'clusters', 'replicas', 'ledger-ns']),
    nameField('STS', 'StatefulSet name', ['pg', 'redis', 'kafka', 'zk', 'mongo', 'rabbit', 'elastic', 'cassandra', 'consul', 'minio']),
  ],
  shell: ({ NS, STS }, state) => ({
    title: `StatefulSet ${STS} is not healthy`,
    text: `StatefulSet \`${STS}\` in namespace \`${NS}\` should run \`3\` ready replicas. Each Pod has its own volume from claim template \`data\`, of StorageClass \`${CLASS}\`, mounted at \`${MOUNT}\`, and its own DNS name \`<pod>.${STS}-hl.${NS}.svc.cluster.local\` through the headless Service \`${STS}-hl\`. Fix it so that this all holds.

Keep the image \`${IMAGE}\` and the readiness probe. You may delete and re-create the StatefulSet and the Service under the same names, but do not delete a PersistentVolumeClaim that is \`Bound\`.`,
    spec: `- Service \`${STS}-hl\`: headless (\`clusterIP: None\`), selecting \`app=${STS}\`, port \`80\`
- StatefulSet \`${STS}\`: \`serviceName: ${STS}-hl\`, \`3\` replicas, default \`OrderedReady\` Pod management and \`RollingUpdate\` strategy
- container \`nginx\`: image \`${IMAGE}\`, a readiness probe doing an HTTP GET of \`/\` on port \`80\`, claim template \`data\` mounted at \`${MOUNT}\`
- claim template \`data\`: \`100Mi\`, \`ReadWriteOnce\`, StorageClass \`${CLASS}\``,
    before: `${requireLocalPathClass}
${createNs(NS)}
kubectl -n "${NS}" delete statefulset "${STS}" --ignore-not-found --wait=true >/dev/null
kubectl -n "${NS}" delete service "${STS}-hl" --ignore-not-found >/dev/null
kubectl -n "${NS}" wait --for=delete pod -l app="${STS}" --timeout=90s >/dev/null 2>&1 || true
kubectl -n "${NS}" delete pvc -l app="${STS}" --ignore-not-found --wait=true >/dev/null
# Faults append assignments here (class=..., probe=...), read back after the break: a file,
# because a layered question runs each fault in its own subshell.
: > "${state}.sts"`,
    after: `cip=None selector=${STS} service=${STS}-hl class=${CLASS} probe=/
. "${state}.sts"
${applyJson(service(NS, STS, '$cip', '$selector'))} >/dev/null
${applyJson(statefulSet(NS, STS, '$service', '$class', '$probe'))} >/dev/null
if [[ "$class" == ${CLASS} && "$probe" == / ]]; then
  kubectl -n "${NS}" rollout status "statefulset/${STS}" --timeout=240s >/dev/null 2>&1 || true
fi
# Pod 0's claim holds data once it is Bound: record it, so that deleting it shows.
uid=''
if [[ "$class" == ${CLASS} ]]; then
  for _ in $(seq 1 60); do
    if [[ "$(kubectl -n "${NS}" get pvc "data-${STS}-0" -o jsonpath='{.status.phase}' 2>/dev/null)" == Bound ]]; then
      uid=$(kubectl -n "${NS}" get pvc "data-${STS}-0" -o jsonpath='{.metadata.uid}')
      break
    fi
    sleep 2
  done
fi
[[ -n "$uid" ]] || uid=none
echo "$uid" > "${state}.uid"
chmod 644 "${state}.uid"`,
    checks: [
      {
        id: 'ready',
        description: `${STS} runs 3 of 3 ready replicas, governed by ${STS}-hl`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get statefulset ${STS} -o jsonpath='{.spec.serviceName}/{.spec.replicas}/{.status.readyReplicas}'`,
        expect: { equals: `${STS}-hl/3/3` },
        weight: 2,
        retrySeconds: 120,
      },
      {
        id: 'headless',
        description: `Service ${STS}-hl is headless and selects the StatefulSet's Pods`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get service ${STS}-hl -o jsonpath='{.spec.clusterIP}/{.spec.selector.app}'`,
        expect: { equals: `None/${STS}` },
        weight: 1,
      },
      {
        id: 'dns',
        description: `${STS}-2.${STS}-hl.${NS}.svc.cluster.local resolves to the IP of Pod ${STS}-2`,
        type: 'kubectl',
        run: `ip=$(kubectl -n ${NS} get pod ${STS}-2 -o jsonpath='{.status.podIP}'); [ -n "$ip" ] && kubectl -n ${NS} exec ${STS}-0 -- nslookup ${STS}-2.${STS}-hl.${NS}.svc.cluster.local 2>/dev/null | grep -qw "$ip" && echo resolved || echo unresolved`,
        expect: { equals: 'resolved' },
        weight: 2,
        retrySeconds: 60,
      },
      {
        id: 'claims',
        description: `every Pod has its own Bound claim of StorageClass ${CLASS}, mounted at ${MOUNT}`,
        type: 'kubectl',
        run: `echo "$(kubectl -n ${NS} get pvc data-${STS}-0 data-${STS}-1 data-${STS}-2 -o jsonpath='{range .items[*]}{.status.phase}/{.spec.storageClassName} {end}' 2>/dev/null)$(kubectl -n ${NS} get statefulset ${STS} -o jsonpath='{.spec.template.spec.containers[0].volumeMounts[?(@.name=="data")].mountPath}')"`,
        expect: { equals: `Bound/${CLASS} Bound/${CLASS} Bound/${CLASS} ${MOUNT}` },
        weight: 1,
        retrySeconds: 60,
      },
      {
        id: 'spec',
        description: `${STS} keeps image ${IMAGE} and a readiness probe`,
        type: 'kubectl',
        run: `c='{.spec.template.spec.containers[0]'; echo "$(kubectl -n ${NS} get statefulset ${STS} -o jsonpath="$c.image}") $([ -n "$(kubectl -n ${NS} get statefulset ${STS} -o jsonpath="$c.readinessProbe}")" ] && echo readiness)"`,
        expect: { equals: `${IMAGE} readiness` },
        weight: 1,
      },
      {
        id: 'data-kept',
        description: `claim data-${STS}-0 was not deleted once Bound`,
        type: 'kubectl',
        run: `r=$(cat ${state}.uid); { [ "$r" = none ] || [ "$(kubectl -n ${NS} get pvc data-${STS}-0 -o jsonpath='{.metadata.uid}' 2>/dev/null)" = "$r" ]; } && echo kept || echo deleted`,
        expect: { equals: 'kept' },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} get statefulset,pods,pvc -o wide: how many Pods exist, are they ready, and are their claims Bound? A StatefulSet creates its Pods one at a time, each only once the one before it is ready.`,
      `kubectl -n ${NS} describe pod <pod> and kubectl -n ${NS} describe pvc <claim>: the Events say why a Pod is Pending or not ready, or why a claim waits.`,
      `From inside a Pod: kubectl -n ${NS} exec ${STS}-0 -- nslookup ${STS}-0.${STS}-hl.${NS}.svc.cluster.local. Per-Pod names need a headless Service with endpoints, named by the StatefulSet's spec.serviceName.`,
      'kubectl explain statefulset.spec: serviceName, podManagementPolicy and volumeClaimTemplates cannot be changed on an existing StatefulSet. Delete it (its claims stay) and create it again.',
    ],
  }),
  layers: [
    { name: 'the Service', faults: ['headless-clusterip', 'service-selector'] },
    { name: 'the StatefulSet', faults: ['servicename-mismatch', 'claim-class-typo', 'readiness-forced-rollback'] },
  ],
  faults: ({ NS, STS }, state) => [
    {
      id: 'headless-clusterip',
      label: 'Service is not headless',
      break: `echo cip= >> "${state}.sts"`,
      fix: `kubectl -n "${NS}" delete service "${STS}-hl"
${applyJson(service(NS, STS, 'None', STS))}`,
      wait: rollout(NS, STS),
      explain: `Service \`${STS}-hl\` has a cluster IP, so it is not headless: DNS answers its name with that one virtual IP, and creates no record \`<pod>.${STS}-hl\` for the Pods, so \`nslookup ${STS}-0.${STS}-hl.${NS}.svc.cluster.local\` fails from any Pod. \`kubectl -n ${NS} get service ${STS}-hl\` shows the CLUSTER-IP. \`spec.clusterIP\` cannot be changed: delete the Service and create it again with \`clusterIP: None\`, the same selector and port.`,
    },
    {
      id: 'service-selector',
      label: "Service selects none of the StatefulSet's Pods",
      break: `echo "selector=${STS}-db" >> "${state}.sts"`,
      fix: `kubectl -n "${NS}" patch service "${STS}-hl" -p ${sq(`{"spec":{"selector":{"app":"${STS}"}}}`)}`,
      wait: rollout(NS, STS),
      explain: `Service \`${STS}-hl\` selects \`app=${STS}-db\`, a label no Pod has, so it has no endpoints (\`kubectl -n ${NS} get endpointslices -l kubernetes.io/service-name=${STS}-hl\`) and DNS has no records for the Pods. Set its selector to \`app=${STS}\`.`,
    },
    {
      id: 'servicename-mismatch',
      label: 'StatefulSet names a governing Service that does not exist',
      break: `echo "service=${STS}-headless" >> "${state}.sts"`,
      fix: `${deleteStatefulSet(NS, STS)}
${healthyStatefulSet(NS, STS)}`,
      wait: rollout(NS, STS),
      explain: `The StatefulSet's \`serviceName\` is \`${STS}-headless\`, a Service that does not exist. Each Pod takes its DNS subdomain from it (\`kubectl -n ${NS} get pod ${STS}-0 -o jsonpath='{.spec.subdomain}'\`), so no name under \`${STS}-hl\` resolves, although that Service is right. \`serviceName\` cannot be changed on an existing StatefulSet: delete it, which keeps its claims, and create it again with \`serviceName: ${STS}-hl\`. The new Pods get the same claims back.`,
    },
    {
      id: 'claim-class-typo',
      label: 'Claim template names a StorageClass that does not exist',
      break: `echo class=local-storage >> "${state}.sts"`,
      settle: `for _ in $(seq 1 15); do
  [[ "$(kubectl -n "${NS}" get pvc "data-${STS}-0" -o jsonpath='{.status.phase}' 2>/dev/null)" == Pending ]] && break
  sleep 2
done`,
      // No claim was ever Bound, so none holds data.
      fix: `${deleteStatefulSet(NS, STS)}
kubectl -n "${NS}" delete pvc -l app="${STS}" --wait=true
${healthyStatefulSet(NS, STS)}`,
      wait: rollout(NS, STS),
      explain: `Pod \`${STS}-0\` stays \`Pending\`, and with \`OrderedReady\` Pod management the StatefulSet creates no further Pod until it is ready. Its claim \`data-${STS}-0\` is \`Pending\` too: the claim template asks for StorageClass \`local-storage\`, which does not exist (\`kubectl get storageclass\`, and the claim's Events). Neither a StatefulSet's claim templates nor a claim's class can be changed: delete the StatefulSet and its \`Pending\` claim, and create the StatefulSet again with \`storageClassName: ${CLASS}\`.`,
    },
    {
      id: 'readiness-forced-rollback',
      label: 'Broken readiness probe, and a Pod the fix never replaces',
      break: `echo probe=/healthz >> "${state}.sts"`,
      settle: waitUnhealthy(NS, `app=${STS}`),
      fix: `kubectl -n "${NS}" patch statefulset "${STS}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
# Once the controller has seen the new template, re-create the Pod it waits on.
for _ in $(seq 1 15); do
  [[ "$(kubectl -n "${NS}" get statefulset "${STS}" -o jsonpath='{.status.updateRevision}')" != "$(kubectl -n "${NS}" get pod "${STS}-0" -o jsonpath='{.metadata.labels.controller-revision-hash}')" ]] && break
  sleep 1
done
kubectl -n "${NS}" delete pod "${STS}-0"`,
      wait: rollout(NS, STS),
      explain: `The readiness probe asks for \`/healthz\`, which nginx answers with 404, so \`${STS}-0\` runs but is never ready, and with \`OrderedReady\` Pod management \`${STS}-1\` and \`${STS}-2\` are never created. Set the probe's path back to \`/\`. That alone is not enough: the controller waits for \`${STS}-0\` to become ready before it replaces it, which it never does, so the Pod keeps the broken probe (Kubernetes documents this under "Forced rollback"). Delete \`${STS}-0\` once the template is fixed; it comes back with the new probe and keeps its claim.`,
    },
  ],
};
