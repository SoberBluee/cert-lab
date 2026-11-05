import { createNs, nameField, nsField, requireLocalPath } from '../types';
import { courseDir, onCp, taskBuilder } from './tasks';

const PROVISIONER = 'rancher.io/local-path';

/** One line per PV of the team: name, capacity in MiB, capacity as written, phase. */
const pvRows = (team: string) => `kubectl get pv -l team=${team} -o jsonpath='{range .items[*]}{.metadata.name} {.spec.capacity.storage} {.status.phase}{"\\n"}{end}' | awk '{v=$2; m=v; if (v ~ /Gi$/) {sub(/Gi$/,"",m); m*=1024} else {sub(/Mi$/,"",m)} print $1, m+0, $2, $3}'`;

export const dynamicStorageBuilder = taskBuilder({
  id: 'dynamic-storage',
  name: 'Dynamic provisioning',
  description: 'Create a StorageClass for the local-path provisioner, make it the default, let a claim provision a volume where its Pod runs, and report on the volumes of a team.',
  domain: 'storage',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['storageclass', 'dynamic-provisioning', 'local-path', 'default-class', 'waitforfirstconsumer', 'pv', 'sort-by'],
  fields: [
    nsField(['cache-ns', 'data', 'scratch', 'build', 'artifacts', 'uploads', 'queue', 'media', 'search', 'feeds']),
    nameField('SC', 'StorageClass name', ['local-fast', 'node-local', 'fast-local', 'local-ssd', 'local-std', 'hostdisk', 'local-nvme', 'edge-local', 'local-tier', 'local-default']),
  ],
  tasks: {
    'default-class': {
      label: 'Create a default class and use it',
      make: ({ NS, SC }) => ({
        title: 'Default StorageClass with local-path',
        text: `The local-path provisioner (\`${PROVISIONER}\`) runs in this cluster.

1. Create StorageClass \`${SC}\` for that provisioner, with volume binding mode \`WaitForFirstConsumer\` and reclaim policy \`Delete\`. Make it the cluster's **only** default StorageClass.
2. In namespace \`${NS}\` (create it if needed), create PersistentVolumeClaim \`cache\` requesting \`1Gi\` with access mode \`ReadWriteOnce\`, without naming a StorageClass, and Pod \`cache-app\` (image \`busybox:1.36\`, command \`sleep 1d\`) that mounts it at \`/cache\`.

The volume must be provisioned for the node the Pod runs on.`,
        setup: [
          `${requireLocalPath}
kubectl delete storageclass "${SC}" --ignore-not-found >/dev/null
# Another default class, so that "only default" means something.
kubectl apply -f - <<EOF >/dev/null
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: standard-static
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
EOF`,
        ],
        checks: [
          {
            id: 'class',
            description: `StorageClass ${SC} uses ${PROVISIONER}, WaitForFirstConsumer and reclaim Delete`,
            type: 'kubectl',
            run: `kubectl get storageclass ${SC} -o jsonpath='{.provisioner} {.volumeBindingMode} {.reclaimPolicy}'`,
            expect: { equals: `${PROVISIONER} WaitForFirstConsumer Delete` },
            weight: 2,
          },
          {
            id: 'only-default',
            description: `${SC} is the only default StorageClass`,
            type: 'kubectl',
            run: `kubectl get storageclass -o jsonpath='{range .items[?(@.metadata.annotations.storageclass\\.kubernetes\\.io/is-default-class=="true")]}{.metadata.name}{"\\n"}{end}' | xargs`,
            expect: { equals: SC },
            weight: 1,
          },
          {
            id: 'claim',
            description: `PVC cache in ${NS} is Bound through ${SC}`,
            type: 'kubectl',
            run: `kubectl -n ${NS} get pvc cache -o jsonpath='{.status.phase} {.spec.storageClassName}'`,
            expect: { equals: `Bound ${SC}` },
            weight: 1,
            retrySeconds: 60,
          },
          {
            id: 'pod',
            description: 'Pod cache-app runs with the claim at /cache',
            type: 'kubectl',
            run: `kubectl -n ${NS} get pod cache-app -o jsonpath='{.status.phase} {.spec.volumes[*].persistentVolumeClaim.claimName} {.spec.containers[0].volumeMounts[*].mountPath}'`,
            expect: { matches: '^Running cache .*/cache' },
            weight: 1,
            retrySeconds: 60,
          },
          {
            id: 'local',
            description: 'the volume was provisioned on the node the Pod runs on',
            type: 'kubectl',
            run: `pv=$(kubectl -n ${NS} get pvc cache -o jsonpath='{.spec.volumeName}'); [ -n "$pv" ] && [ "$(kubectl get pv "$pv" -o jsonpath='{.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].values[0]}')" = "$(kubectl -n ${NS} get pod cache-app -o jsonpath='{.spec.nodeName}')" ] && echo local || echo elsewhere`,
            expect: { equals: 'local' },
            weight: 1,
            retrySeconds: 60,
          },
        ],
        solution: [
          `kubectl annotate storageclass standard-static storageclass.kubernetes.io/is-default-class- >/dev/null
kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${SC}
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ${PROVISIONER}
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
EOF
${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: cache
  namespace: ${NS}
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: cache-app
  namespace: ${NS}
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "1d"]
      volumeMounts: [{ name: cache, mountPath: /cache }]
  volumes:
    - name: cache
      persistentVolumeClaim: { claimName: cache }
EOF
kubectl -n ${NS} wait --for=condition=Ready pod/cache-app --timeout=180s`,
        ],
        hints: [
          'kubectl get storageclass marks the default class with (default); the annotation storageclass.kubernetes.io/is-default-class decides it.',
          'A claim without storageClassName gets the default class when it is created, not later: make the class the default first.',
          'With WaitForFirstConsumer a claim stays Pending until a Pod that uses it is scheduled; then the volume is created for that Pod\'s node.',
        ],
      }),
    },
    'pv-report': {
      label: 'Report a team\'s PersistentVolumes by size and find the Released ones',
      make: ({ NS }) => ({
        title: `PersistentVolumes of team ${NS}`,
        text: `The PersistentVolumes of team \`${NS}\` carry the label \`team=${NS}\`. On \`controlplane\`, using \`kubectl\`:

1. Write them to \`/opt/course/storage/pvs.txt\`, largest capacity first, one line per volume with its name, capacity and phase in that order.
2. Write the names of the ones whose claim was deleted and that still hold data, one per line, to \`/opt/course/storage/released.txt\`.`,
        setup: [
          `${courseDir('storage')}
kubectl delete pv -l team="${NS}" --ignore-not-found --wait=false >/dev/null
sizes=($(shuf -e 300Mi 750Mi 1Gi 2Gi 5Gi 10Gi))
names=(archive-a archive-b scratch-a scratch-b media-a media-b)
${createNs(NS)}
for i in 0 1 2 3 4 5; do
  kubectl apply -f - <<EOF >/dev/null
apiVersion: v1
kind: PersistentVolume
metadata:
  name: ${NS}-\${names[$i]}
  labels: { team: ${NS} }
spec:
  capacity: { storage: \${sizes[$i]} }
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: ${NS}-static
  hostPath: { path: /mnt/${NS}/\${names[$i]} }
EOF
done
# A claim that binds and goes away leaves its volume Released; one that stays leaves it Bound.
for i in 1 3 4; do
  kubectl -n "${NS}" apply -f - <<EOF >/dev/null
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: claim-$i
spec:
  storageClassName: ${NS}-static
  volumeName: ${NS}-\${names[$i]}
  accessModes: [ReadWriteOnce]
  resources:
    requests: { storage: \${sizes[$i]} }
EOF
done
kubectl -n "${NS}" wait --for=jsonpath='{.status.phase}'=Bound pvc/claim-1 pvc/claim-3 pvc/claim-4 --timeout=60s >/dev/null
kubectl -n "${NS}" delete pvc claim-1 claim-4 --wait=true >/dev/null
for _ in $(seq 1 30); do
  [[ "$(kubectl get pv -l team="${NS}" -o jsonpath='{range .items[*]}{.status.phase}{"\\n"}{end}' | grep -c Released)" == 2 ]] && break
  sleep 1
done`,
        ],
        checks: [
          onCp({
            id: 'order',
            description: 'pvs.txt lists every volume of the team, largest first',
            run: `want=$(${pvRows(NS)} | sort -k2 -n -r | awk '{print $1}' | xargs); have=$(awk 'NF && $1 != "NAME" {print $1}' /opt/course/storage/pvs.txt 2>/dev/null | xargs); [ -n "$want" ] && [ "$have" = "$want" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 3,
          }),
          onCp({
            id: 'columns',
            description: 'each line of pvs.txt gives the volume\'s capacity and phase',
            run: `want=$(${pvRows(NS)} | awk '{print $1, $3, $4}' | sort); have=$(awk 'NF && $1 != "NAME" {print $1, $2, $3}' /opt/course/storage/pvs.txt 2>/dev/null | sort); [ -n "$want" ] && [ "$have" = "$want" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 1,
          }),
          onCp({
            id: 'released',
            description: 'released.txt lists exactly the Released volumes of the team',
            run: `want=$(${pvRows(NS)} | awk '$4 == "Released" {print $1}' | sort | xargs); have=$(awk 'NF {print $1}' /opt/course/storage/released.txt 2>/dev/null | sort | xargs); [ -n "$want" ] && [ "$have" = "$want" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 2,
          }),
        ],
        solution: [
          `kubectl get pv -l team=${NS} --sort-by=.spec.capacity.storage --no-headers -o custom-columns=NAME:.metadata.name,CAPACITY:.spec.capacity.storage,PHASE:.status.phase | tac > /opt/course/storage/pvs.txt
kubectl get pv -l team=${NS} --no-headers -o custom-columns=NAME:.metadata.name,PHASE:.status.phase | awk '$2 == "Released" {print $1}' > /opt/course/storage/released.txt`,
        ],
        hints: [
          'kubectl get pv -l <label> narrows the list; -o custom-columns picks the columns, with .spec.capacity.storage and .status.phase.',
          'Capacities mix Mi and Gi, so a text sort puts 10Gi before 2Gi. kubectl get --sort-by understands quantities, smallest first; tac reverses the lines.',
          'A PV keeps its data after its claim is deleted when its reclaim policy is Retain, and its phase shows it.',
        ],
      }),
    },
  },
});
