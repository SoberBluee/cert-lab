import { createNs, nameField, nsField } from '../types';
import type { FaultCategory } from './types';

const MOUNT = '/data';
/** The volume's data lives on this worker; its PV is pinned there. */
const DATA_NODE = 'worker-1';
const OTHER_NODE = 'worker-2';

/**
 * Claim and Pod as one single-quoted JSON line, so fault snippets can re-create them without a heredoc.
 * sc, mode, size, sel and podClaim are pasted inside that quoting: a shell variable must be passed as '"$var"'.
 * `sel` is extra Pod spec JSON, starting with a comma, or empty; `podClaim` is the claim the Pod mounts.
 */
const claimAndPod = (ns: string, claim: string, sc: string, mode: string, size: string, sel = '', podClaim = `'"${claim}"'`) =>
  `'{"apiVersion":"v1","kind":"List","items":[` +
  `{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${claim}"'","namespace":"'"${ns}"'"},"spec":{"storageClassName":"${sc}","accessModes":["${mode}"],"resources":{"requests":{"storage":"${size}"}}}},` +
  podJson(ns, claim, sel, podClaim) +
  `]}'`;

const podJson = (ns: string, claim: string, sel = '', podClaim = `'"${claim}"'`) =>
  `{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${claim}"'-app","namespace":"'"${ns}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"${MOUNT}"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"${podClaim}"}}]${sel}}}`;

/** The node label the volume requires; one key per claim, so two storage questions never share it. */
const dataLabel = (claim: string) => `storage.cka.lab/${claim}`;

/** Fixes only change objects; the wait for the Pod comes after every fix, so stacked faults cannot block each other. */
const recreate = (ns: string, claim: string) => `kubectl -n "${ns}" delete pod "${claim}-app" --ignore-not-found --wait=true
kubectl -n "${ns}" delete pvc "${claim}" --ignore-not-found --wait=true
kubectl apply -f - <<< ${claimAndPod(ns, claim, 'manual', 'ReadWriteOnce', '500Mi')}`;

const waitRunning = (ns: string, claim: string) => `kubectl -n "${ns}" wait --for=condition=Ready "pod/${claim}-app" --timeout=180s`;

export const storageCategory: FaultCategory = {
  id: 'storage',
  name: 'Storage',
  description: 'A Pod is stuck because of its volume: the claim never binds, or the bound volume cannot be used where the Pod runs.',
  domain: 'storage',
  difficulty: 2,
  minutes: 8,
  points: 5,
  tags: ['troubleshooting', 'pvc', 'pv', 'storageclass'],
  fields: [
    nsField(['files', 'backups', 'media-store', 'storage', 'volumes', 'data-lab', 'persist', 'blobs', 'objects', 'disk']),
    nameField('CLAIM', 'Claim name', ['archive', 'assets', 'cache-data', 'uploads', 'snapshots', 'media', 'logs-vol', 'db-data', 'scratch', 'shared'], 'The PV is <claim>-pv and the Pod <claim>-app.'),
  ],
  layers: [
    { name: 'the claim', faults: ['storageclass-mismatch', 'access-mode-mismatch', 'claim-too-large'] },
    { name: 'the volume', faults: ['pv-released-claimref', 'pv-node-label-lost'] },
    { name: 'the Pod', faults: ['pod-node-pin', 'pod-claim-name'] },
  ],
  shell: ({ NS, CLAIM }, state) => ({
    title: `Pod ${CLAIM}-app stuck`,
    text: `Pod \`${CLAIM}-app\` in namespace \`${NS}\` has been \`Pending\` since it was created. Get it \`Running\` with claim \`${CLAIM}\` mounted at \`${MOUNT}\`.

Its data lives on PersistentVolume \`${CLAIM}-pv\`: do not delete that volume or change its capacity, class, access modes or node affinity. You may delete and re-create the claim and the Pod, keeping their names and the Pod's image and command.`,
    spec: `- PersistentVolume \`${CLAIM}-pv\`: StorageClass \`manual\`, \`1Gi\`, \`ReadWriteOnce\`, reclaim \`Retain\`, hostPath \`/srv/${CLAIM}\` on \`${DATA_NODE}\`, with required node affinity for the label \`${dataLabel(CLAIM)}=data\` that \`${DATA_NODE}\` carries; \`Available\` with no stale \`claimRef\`
- PersistentVolumeClaim \`${CLAIM}\` requests \`500Mi\` with StorageClass \`manual\` and access mode \`ReadWriteOnce\`, and binds to \`${CLAIM}-pv\`
- Pod \`${CLAIM}-app\` (image \`busybox:1.36\`, command \`sleep 1d\`) mounts claim \`${CLAIM}\` at \`${MOUNT}\`, with no nodeSelector: the scheduler follows the volume to \`${DATA_NODE}\``,
    before: `${createNs(NS)}
kubectl label node ${DATA_NODE} "${dataLabel(CLAIM)}=data" --overwrite >/dev/null
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
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - { key: ${dataLabel(CLAIM)}, operator: In, values: [data] }
EOF
# Faults append shell assignments here (sc=..., pin=...); after reads them back. A file rather than
# shell variables, because a layered question runs every fault in its own subshell.
: > "${state}.claim"`,
    after: `sc=manual mode=ReadWriteOnce size=500Mi pin= podclaim="${CLAIM}"
. "${state}.claim"
sel=''
[[ -z "$pin" ]] || sel=',"nodeSelector":{"kubernetes.io/hostname":"'"$pin"'"}'
kubectl apply -f - <<< ${claimAndPod(NS, CLAIM, `'"$sc"'`, `'"$mode"'`, `'"$size"'`, `'"$sel"'`, `'"$podclaim"'`)}
sleep 10
[[ "$(kubectl -n "${NS}" get pod "${CLAIM}-app" -o jsonpath='{.status.phase}')" == Pending ]] || { echo "${CLAIM}-app is not Pending" >&2; exit 1; }`,
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
        id: 'pod-running',
        description: `Pod ${CLAIM}-app is Running with the claim at ${MOUNT}`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get pod ${CLAIM}-app -o jsonpath='{.status.phase} {.spec.volumes[*].persistentVolumeClaim.claimName} {.spec.containers[0].volumeMounts[*].mountPath}'`,
        expect: { matches: `^Running ${CLAIM} .*${MOUNT}` },
        weight: 2,
        retrySeconds: 60,
      },
      {
        id: 'pv-kept',
        description: `PV ${CLAIM}-pv keeps its class, capacity and access mode`,
        type: 'kubectl',
        run: `kubectl get pv ${CLAIM}-pv -o jsonpath='{.spec.storageClassName} {.spec.capacity.storage} {.spec.accessModes[0]}'`,
        expect: { equals: 'manual 1Gi ReadWriteOnce' },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} describe pod ${CLAIM}-app: is the Pod waiting for its claim to bind, or for a node it can run on? The Events say which.`,
      `kubectl -n ${NS} describe pvc ${CLAIM} and kubectl get pv ${CLAIM}-pv -o yaml: class, access modes, size and the volume's status (and any claimRef) must all fit.`,
      `A bound volume can still pin its Pod: compare the volume's node affinity with where the Pod is allowed to run (kubectl get pod ${CLAIM}-app -o yaml).`,
      "Most of a claim's spec cannot be edited: delete the Pod and the claim, then create them again.",
    ],
  }),
  faults: ({ NS, CLAIM }, state) => [
    {
      id: 'storageclass-mismatch',
      label: 'Claim asks for another StorageClass',
      break: `echo 'sc=fast' >> "${state}.claim"`,
      fix: recreate(NS, CLAIM),
      wait: waitRunning(NS, CLAIM),
      explain: `The claim asks for StorageClass \`fast\`, which neither exists nor matches \`${CLAIM}-pv\` (\`manual\`), so it stays \`Pending\`. Re-create it with \`storageClassName: manual\`.`,
    },
    {
      id: 'access-mode-mismatch',
      label: 'Claim asks for ReadWriteMany',
      break: `echo 'mode=ReadWriteMany' >> "${state}.claim"`,
      fix: recreate(NS, CLAIM),
      wait: waitRunning(NS, CLAIM),
      explain: `The claim asks for \`ReadWriteMany\`, but \`${CLAIM}-pv\` only offers \`ReadWriteOnce\`, so nothing binds. Re-create it with \`ReadWriteOnce\`.`,
    },
    {
      id: 'claim-too-large',
      label: 'Claim larger than the volume',
      break: `echo 'size=2Gi' >> "${state}.claim"`,
      fix: recreate(NS, CLAIM),
      wait: waitRunning(NS, CLAIM),
      explain: `The claim requests \`2Gi\` and \`${CLAIM}-pv\` holds only \`1Gi\`, so it can never bind. Re-create it requesting \`500Mi\` (or anything up to \`1Gi\`).`,
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
[[ "$(kubectl get pv "${CLAIM}-pv" -o jsonpath='{.status.phase}')" == Released ]] || { echo "PV is not Released" >&2; exit 1; }`,
      fix: `kubectl patch pv "${CLAIM}-pv" --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'`,
      wait: waitRunning(NS, CLAIM),
      explain: `PersistentVolume \`${CLAIM}-pv\` is \`Released\` with reclaim policy \`Retain\` and still holds a \`claimRef\` to a deleted PVC. The new claim matches the volume but cannot bind until that \`claimRef\` is removed (\`kubectl patch pv ${CLAIM}-pv --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'\`).`,
    },
    {
      id: 'pod-node-pin',
      label: 'Pod pinned away from the node that holds the volume',
      break: `echo 'pin=${OTHER_NODE}' >> "${state}.claim"`,
      fix: `kubectl -n "${NS}" delete pod "${CLAIM}-app" --wait=true
kubectl apply -f - <<< '${podJson(NS, CLAIM)}'`,
      wait: waitRunning(NS, CLAIM),
      explain: `The claim is \`Bound\`, but \`${CLAIM}-pv\` is a local volume whose required node affinity only \`${DATA_NODE}\` satisfies, while the Pod has \`nodeSelector: kubernetes.io/hostname=${OTHER_NODE}\`. No node satisfies both, so the Pod stays \`Pending\` with \`volume node affinity conflict\` in its Events. Re-create the Pod without the nodeSelector (or pinned to \`${DATA_NODE}\`); the volume cannot move.`,
    },
    {
      id: 'pv-node-label-lost',
      label: 'The node that holds the data lost the label the volume requires',
      break: `kubectl label node ${DATA_NODE} "${dataLabel(CLAIM)}-" >/dev/null`,
      fix: `kubectl label node ${DATA_NODE} "${dataLabel(CLAIM)}=data" --overwrite`,
      wait: waitRunning(NS, CLAIM),
      explain: `The claim is \`Bound\`, but \`${CLAIM}-pv\` may only be used on a node labelled \`${dataLabel(CLAIM)}=data\`, and no node carries that label any more: the Pod stays \`Pending\` with \`volume node affinity conflict\`. The volume's affinity must not change, so put the label back on the node that really holds the data. Which one is that? The volume is a hostPath, \`/srv/${CLAIM}\`: look for it on the workers (\`ssh worker-1 ls /srv\`), and you find it on \`${DATA_NODE}\`. \`kubectl label node ${DATA_NODE} ${dataLabel(CLAIM)}=data\`.`,
    },
    {
      id: 'pod-claim-name',
      label: 'The Pod mounts a claim name that does not exist',
      break: `echo 'podclaim=${CLAIM}-data' >> "${state}.claim"`,
      fix: `kubectl -n "${NS}" delete pod "${CLAIM}-app" --wait=true
kubectl apply -f - <<< '${podJson(NS, CLAIM)}'`,
      wait: waitRunning(NS, CLAIM),
      explain: `The claim and the volume are fine and \`Bound\`, but the Pod's volume refers to claim \`${CLAIM}-data\`, which does not exist: the Pod stays \`Pending\` with "persistentvolumeclaim \\"${CLAIM}-data\\" not found". A Pod's volumes cannot be edited: re-create the Pod with \`claimName: ${CLAIM}\`.`,
    },
  ],
};
