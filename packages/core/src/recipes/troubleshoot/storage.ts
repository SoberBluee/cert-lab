import { createNs, nameField, nsField } from '../types';
import type { FaultCategory } from './types';

const MOUNT = '/data';

/**
 * Claim and Pod as one single-quoted JSON line, so fault snippets can re-create them without a heredoc.
 * sc, mode and size are pasted inside that quoting: a shell variable must be passed as '"$var"'.
 */
const claimAndPod = (ns: string, claim: string, sc: string, mode: string, size: string) =>
  `'{"apiVersion":"v1","kind":"List","items":[` +
  `{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${claim}"'","namespace":"'"${ns}"'"},"spec":{"storageClassName":"${sc}","accessModes":["${mode}"],"resources":{"requests":{"storage":"${size}"}}}},` +
  `{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${claim}"'-app","namespace":"'"${ns}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"${MOUNT}"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${claim}"'"}}]}}` +
  `]}'`;

const recreate = (ns: string, claim: string) => `kubectl -n "${ns}" delete pod "${claim}-app" --wait=true
kubectl -n "${ns}" delete pvc "${claim}" --wait=true
kubectl apply -f - <<< ${claimAndPod(ns, claim, 'manual', 'ReadWriteOnce', '500Mi')}
kubectl -n "${ns}" wait --for=condition=Ready "pod/${claim}-app" --timeout=180s`;

export const storageCategory: FaultCategory = {
  id: 'storage',
  name: 'Storage',
  description: 'A Pod is stuck because its PersistentVolumeClaim never binds.',
  domain: 'storage',
  difficulty: 2,
  minutes: 8,
  points: 5,
  tags: ['troubleshooting', 'pvc', 'pv', 'storageclass'],
  fields: [
    nsField(['files', 'backups', 'media-store']),
    nameField('CLAIM', 'Claim name', ['archive', 'assets', 'cache-data'], 'The PV is <claim>-pv and the Pod <claim>-app.'),
  ],
  shell: ({ NS, CLAIM }) => ({
    title: `Pod ${CLAIM}-app stuck`,
    text: `Pod \`${CLAIM}-app\` in namespace \`${NS}\` has been \`Pending\` since it was created.

Get it running. The intended setup is:

- PersistentVolume \`${CLAIM}-pv\` (StorageClass \`manual\`, \`1Gi\`, \`ReadWriteOnce\`, reclaim \`Retain\`) already exists; keep its capacity, class and access mode
- PersistentVolumeClaim \`${CLAIM}\` requests \`500Mi\` with StorageClass \`manual\` and access mode \`ReadWriteOnce\`, and binds to \`${CLAIM}-pv\`
- Pod \`${CLAIM}-app\` (image \`busybox:1.36\`, command \`sleep 1d\`) mounts the claim at \`${MOUNT}\`

You may delete and re-create the claim and the Pod. If the volume is stuck \`Released\`, clear its stale \`claimRef\` so a new claim can bind.`,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: ${CLAIM}-pv
spec:
  capacity: { storage: 1Gi }
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /srv/${CLAIM}
    type: DirectoryOrCreate
EOF
sc=manual mode=ReadWriteOnce size=500Mi`,
    after: `kubectl apply -f - <<< ${claimAndPod(NS, CLAIM, `'"$sc"'`, `'"$mode"'`, `'"$size"'`)}
sleep 10
[[ "$(kubectl -n "${NS}" get pvc "${CLAIM}" -o jsonpath='{.status.phase}')" == Pending ]]`,
    checks: [
      {
        id: 'bound',
        description: `PVC ${CLAIM} is Bound to ${CLAIM}-pv`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get pvc ${CLAIM} -o jsonpath='{.status.phase}/{.spec.volumeName}'`,
        expect: { equals: `Bound/${CLAIM}-pv` },
        weight: 2,
        retrySeconds: 30,
      },
      {
        id: 'spec-claim',
        description: `PVC ${CLAIM} matches the spec`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get pvc ${CLAIM} -o jsonpath='{.spec.storageClassName} {.spec.accessModes[0]} {.spec.resources.requests.storage}'`,
        expect: { equals: 'manual ReadWriteOnce 500Mi' },
        weight: 1,
      },
      {
        id: 'pod-running',
        description: `Pod ${CLAIM}-app is Running with the claim at ${MOUNT}`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get pod ${CLAIM}-app -o jsonpath='{.status.phase} {.spec.volumes[*].persistentVolumeClaim.claimName} {.spec.containers[0].volumeMounts[*].mountPath}'`,
        expect: { matches: `^Running ${CLAIM} .*${MOUNT}` },
        weight: 1,
        retrySeconds: 60,
      },
      {
        id: 'pv-kept',
        description: `PV ${CLAIM}-pv is unchanged`,
        type: 'kubectl',
        run: `kubectl get pv ${CLAIM}-pv -o jsonpath='{.spec.storageClassName} {.spec.capacity.storage} {.spec.accessModes[0]}'`,
        expect: { equals: 'manual 1Gi ReadWriteOnce' },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} describe pod ${CLAIM}-app, then kubectl -n ${NS} describe pvc ${CLAIM}: what are the Events waiting for?`,
      `Put kubectl get pv ${CLAIM}-pv next to kubectl -n ${NS} get pvc ${CLAIM} -o yaml: class, access mode and size must all fit.`,
      "Most of a claim's spec cannot be edited: delete the Pod and the claim, then create them again.",
    ],
  }),
  faults: ({ NS, CLAIM }) => [
    {
      id: 'storageclass-mismatch',
      label: 'Claim asks for another StorageClass',
      break: 'sc=fast',
      fix: recreate(NS, CLAIM),
      explain: `The claim asks for StorageClass \`fast\`, which neither exists nor matches \`${CLAIM}-pv\` (\`manual\`), so it stays \`Pending\`. Re-create it with \`storageClassName: manual\`.`,
    },
    {
      id: 'access-mode-mismatch',
      label: 'Claim asks for ReadWriteMany',
      break: 'mode=ReadWriteMany',
      fix: recreate(NS, CLAIM),
      explain: `The claim asks for \`ReadWriteMany\`, but \`${CLAIM}-pv\` only offers \`ReadWriteOnce\`, so nothing binds. Re-create it with \`ReadWriteOnce\`.`,
    },
    {
      id: 'claim-too-large',
      label: 'Claim larger than the volume',
      break: 'size=2Gi',
      fix: recreate(NS, CLAIM),
      explain: `The claim requests \`2Gi\` and \`${CLAIM}-pv\` holds only \`1Gi\`, so it can never bind. Re-create it requesting \`500Mi\`.`,
    },
    {
      id: 'pv-released-claimref',
      label: 'PV stuck Released with a stale claimRef',
      break: `kubectl apply -f - <<< ${claimAndPod(NS, CLAIM, 'manual', 'ReadWriteOnce', '500Mi')}
kubectl -n "${NS}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${CLAIM}" --timeout=60s
kubectl -n "${NS}" delete pod "${CLAIM}-app" --wait=true
kubectl -n "${NS}" delete pvc "${CLAIM}" --wait=true
for _ in $(seq 1 30); do
  [[ "$(kubectl get pv "${CLAIM}-pv" -o jsonpath='{.status.phase}')" == Released ]] && break
  sleep 1
done
[[ "$(kubectl get pv "${CLAIM}-pv" -o jsonpath='{.status.phase}')" == Released ]] || { echo "PV is not Released" >&2; exit 1; }
sc=manual mode=ReadWriteOnce size=500Mi`,
      fix: `kubectl patch pv "${CLAIM}-pv" --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'
for _ in $(seq 1 30); do
  [[ "$(kubectl -n "${NS}" get pvc "${CLAIM}" -o jsonpath='{.status.phase}')" == Bound ]] && break
  sleep 2
done
kubectl -n "${NS}" wait --for=condition=Ready "pod/${CLAIM}-app" --timeout=180s`,
      explain: `PersistentVolume \`${CLAIM}-pv\` is \`Released\` with reclaim policy \`Retain\` and still holds a \`claimRef\` to a deleted PVC. The new claim matches the volume but cannot bind until that \`claimRef\` is removed (\`kubectl patch pv ${CLAIM}-pv --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'\`).`,
    },
  ],
};
