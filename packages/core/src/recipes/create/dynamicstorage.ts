import { createNs, nameField, nsField, requireLocalPath } from '../types';
import { taskBuilder } from './tasks';

const PROVISIONER = 'rancher.io/local-path';

export const dynamicStorageBuilder = taskBuilder({
  id: 'dynamic-storage',
  name: 'Dynamic provisioning',
  description: 'Create a StorageClass for the local-path provisioner, make it the default, and let a claim provision a volume where its Pod runs.',
  domain: 'storage',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['storageclass', 'dynamic-provisioning', 'local-path', 'default-class', 'waitforfirstconsumer'],
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
  },
});
