import { createNs, nameField, nsField, requireLocalPath } from '../types';
import type { FaultCategory } from './types';

const PROVISIONER = 'rancher.io/local-path';
const MOUNT = '/data';

/** The healthy StorageClass of the question; cluster-scoped, so named after the claim. */
const scJson = (sc: string, provisioner: string) =>
  `'{"apiVersion":"storage.k8s.io/v1","kind":"StorageClass","metadata":{"name":"'"${sc}"'"},"provisioner":"${provisioner}","volumeBindingMode":"WaitForFirstConsumer","reclaimPolicy":"Delete"}'`;

/** Claim JSON for a here-string; `extra` is spliced into its spec and may be empty. */
const claimJson = (ns: string, name: string, extra: string, mode = 'ReadWriteOnce') =>
  `'{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${name}"'","namespace":"'"${ns}"'"},"spec":{${extra}"accessModes":["${mode}"],"resources":{"requests":{"storage":"500Mi"}}}}'`;

/** A Pod that mounts claim `claim` at /data, plus any extra volume JSON (starting with a comma). */
const podJson = (ns: string, name: string, claim: string, extraVolume = '', extraMount = '') =>
  `'{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${name}"'","namespace":"'"${ns}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"${MOUNT}"}${extraMount}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${claim}"'"}}${extraVolume}]}}'`;

const waitRunning = (ns: string, pod: string) => `kubectl -n "${ns}" wait --for=condition=Ready "pod/${pod}" --timeout=180s`;

/**
 * Faults of dynamic provisioning with the local-path provisioner: the class, the claim, or the Pod
 * keeps a dynamically provisioned volume from reaching its Pod.
 */
export const provisioningCategory: FaultCategory = {
  id: 'provisioning',
  name: 'Dynamic provisioning',
  description: 'A Pod never starts because its dynamically provisioned volume never reaches it: the class, the claim or the Pod is at fault.',
  domain: 'storage',
  difficulty: 2,
  minutes: 8,
  points: 5,
  tags: ['troubleshooting', 'storageclass', 'dynamic-provisioning', 'pvc', 'local-path'],
  settleSeconds: 30,
  fields: [
    nsField(['assets', 'thumbnails', 'exports', 'imports', 'archive-ns', 'renders', 'logs-ns', 'mail', 'images', 'staging-data']),
    nameField('CLAIM', 'Claim name', ['assets', 'renders', 'exports', 'store', 'blobs', 'cache', 'spool', 'drafts', 'outbox', 'vault'], 'The Pod is <claim>-app and the StorageClass <claim>-local.'),
  ],
  shell: ({ NS, CLAIM }, state) => ({
    title: `Pod ${CLAIM}-app never starts`,
    text: `Pod \`${CLAIM}-app\` in namespace \`${NS}\` never starts. Get it \`Running\` with PersistentVolumeClaim \`${CLAIM}\` mounted at \`${MOUNT}\`, and that claim's volume provisioned by StorageClass \`${CLAIM}-local\`.

You may delete and re-create the Pod, the claim and the StorageClass, keeping their names and the Pod's image and command. Do not make any StorageClass the cluster default.`,
    spec: `- StorageClass \`${CLAIM}-local\`: provisioner \`${PROVISIONER}\`, \`WaitForFirstConsumer\`, reclaim \`Delete\`
- PVC \`${CLAIM}\` in \`${NS}\`: \`500Mi\`, \`ReadWriteOnce\`, \`storageClassName: ${CLAIM}-local\`
- Pod \`${CLAIM}-app\` (\`busybox:1.36\`, \`sleep 1d\`) mounts only that claim, at \`${MOUNT}\`, and no other Pod uses it`,
    before: `${requireLocalPath}
${createNs(NS)}
kubectl -n "${NS}" delete pod --all --wait=true >/dev/null 2>&1 || true
kubectl -n "${NS}" delete pvc --all --wait=true >/dev/null 2>&1 || true
kubectl delete storageclass "${CLAIM}-local" --ignore-not-found >/dev/null
# Faults append assignments here (provisioner=..., class=...), read back after the break: a file,
# because a layered question runs each fault in its own subshell.
: > "${state}.prov"`,
    after: `provisioner=${PROVISIONER} class=yes mode=ReadWriteOnce hostdir= skipclaim=
. "${state}.prov"
kubectl apply -f - <<< ${scJson(`${CLAIM}-local`, `'"$provisioner"'`)} >/dev/null
extra=''
[[ "$class" == yes ]] && extra='"storageClassName":"'"${CLAIM}"'-local",'
[[ "$skipclaim" == yes ]] || kubectl apply -f - <<< ${claimJson(NS, CLAIM, `'"$extra"'`, `'"$mode"'`)} >/dev/null
vol='' mnt=''
if [[ -n "$hostdir" ]]; then
  vol=',{"name":"logs","hostPath":{"path":"'"$hostdir"'","type":"Directory"}}'
  mnt=',{"name":"logs","mountPath":"/logs"}'
fi
kubectl apply -f - <<< ${podJson(NS, `${CLAIM}-app`, CLAIM, `'"$vol"'`, `'"$mnt"'`)} >/dev/null
sleep 20
[[ "$(kubectl -n "${NS}" get pod "${CLAIM}-app" -o jsonpath='{.status.phase}')" != Running ]] || { echo "${CLAIM}-app runs" >&2; exit 1; }`,
    checks: [
      {
        id: 'bound',
        description: `PVC ${CLAIM} is Bound through StorageClass ${CLAIM}-local`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get pvc ${CLAIM} -o jsonpath='{.status.phase} {.spec.storageClassName}'`,
        expect: { equals: `Bound ${CLAIM}-local` },
        weight: 2,
        retrySeconds: 60,
      },
      {
        id: 'running',
        description: `Pod ${CLAIM}-app runs with claim ${CLAIM} at ${MOUNT}`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get pod ${CLAIM}-app -o jsonpath='{.status.phase} {.spec.volumes[?(@.persistentVolumeClaim)].persistentVolumeClaim.claimName} {.spec.containers[0].volumeMounts[*].mountPath}'`,
        expect: { matches: `^Running ${CLAIM} .*${MOUNT}` },
        weight: 2,
        retrySeconds: 60,
      },
      {
        id: 'provisioned',
        description: `the volume was provisioned by ${PROVISIONER}`,
        type: 'kubectl',
        run: `pv=$(kubectl -n ${NS} get pvc ${CLAIM} -o jsonpath='{.spec.volumeName}'); [ -n "$pv" ] && kubectl get pv "$pv" -o jsonpath='{.metadata.annotations.pv\\.kubernetes\\.io/provisioned-by}' || echo none`,
        expect: { equals: PROVISIONER },
        weight: 1,
        retrySeconds: 60,
      },
    ],
    hints: [
      `kubectl -n ${NS} describe pod ${CLAIM}-app: is it waiting to be scheduled, waiting for its claim, or failing to mount? The Events say which.`,
      `kubectl -n ${NS} describe pvc ${CLAIM}: the Events of a Pending claim say who is supposed to provision it, and what they are waiting for.`,
      `Compare the claim and the StorageClass with what the provisioner really offers: kubectl get storageclass, kubectl -n local-path-storage logs deploy/local-path-provisioner.`,
      'Many fields of StorageClasses, claims and Pods cannot be edited: delete and re-create them with the same names.',
    ],
  }),
  faults: ({ NS, CLAIM }, state) => [
    {
      id: 'provisioner-typo',
      label: 'StorageClass names a provisioner that does not exist',
      break: `echo 'provisioner=rancher.io/localpath' >> "${state}.prov"`,
      fix: `kubectl -n "${NS}" delete pod "${CLAIM}-app" --wait=true
kubectl -n "${NS}" delete pvc "${CLAIM}" --wait=true
kubectl delete storageclass "${CLAIM}-local"
kubectl apply -f - <<< ${scJson(`${CLAIM}-local`, PROVISIONER)}
kubectl apply -f - <<< ${claimJson(NS, CLAIM, `"storageClassName":"'"${CLAIM}"'-local",`)}
kubectl apply -f - <<< ${podJson(NS, `${CLAIM}-app`, CLAIM)}`,
      wait: waitRunning(NS, `${CLAIM}-app`),
      explain: `StorageClass \`${CLAIM}-local\` names provisioner \`rancher.io/localpath\`. Nothing serves that name, so the claim stays \`Pending\` with "waiting for a volume to be created either by the external provisioner 'rancher.io/localpath'". The provisioner field cannot be changed: re-create the class with \`${PROVISIONER}\` (the name the running provisioner and the built-in \`local-path\` class use), then re-create the claim and the Pod.`,
    },
    {
      id: 'no-class',
      label: 'Claim names no StorageClass and there is no default',
      break: `echo 'class=no' >> "${state}.prov"`,
      fix: `kubectl -n "${NS}" delete pod "${CLAIM}-app" --wait=true
kubectl -n "${NS}" delete pvc "${CLAIM}" --wait=true
kubectl apply -f - <<< ${claimJson(NS, CLAIM, `"storageClassName":"'"${CLAIM}"'-local",`)}
kubectl apply -f - <<< ${podJson(NS, `${CLAIM}-app`, CLAIM)}`,
      wait: waitRunning(NS, `${CLAIM}-app`),
      explain: `The claim names no \`storageClassName\` and the cluster has no default class, so nothing provisions it: it waits for a static PV that never comes ("no persistent volumes available for this claim and no storage class is set"). The task rules out a default class, so re-create the claim with \`storageClassName: ${CLAIM}-local\`, then the Pod.`,
    },
    {
      id: 'rwop-taken',
      label: 'ReadWriteOncePod claim already used by another Pod',
      break: `echo 'mode=ReadWriteOncePod' >> "${state}.prov"
kubectl apply -f - <<< ${claimJson(NS, CLAIM, `"storageClassName":"'"${CLAIM}"'-local",`, 'ReadWriteOncePod')} >/dev/null 2>&1 || true
kubectl apply -f - <<< ${scJson(`${CLAIM}-local`, PROVISIONER)} >/dev/null
kubectl apply -f - <<< ${podJson(NS, `${CLAIM}-backup`, CLAIM)}
${waitRunning(NS, `${CLAIM}-backup`)}`,
      fix: `kubectl -n "${NS}" delete pod "${CLAIM}-backup" --wait=true`,
      wait: waitRunning(NS, `${CLAIM}-app`),
      explain: `The claim's access mode is \`ReadWriteOncePod\`: only one Pod in the whole cluster may use it, and Pod \`${CLAIM}-backup\` already does. \`${CLAIM}-app\` stays \`Pending\`; the scheduler says "node has pod using PersistentVolumeClaim with the same name and ReadWriteOncePod access mode". Remove \`${CLAIM}-backup\` (a leftover), or re-create the claim with \`ReadWriteOnce\` if both Pods must share it on one node.`,
    },
    {
      id: 'hostpath-missing',
      label: 'Extra hostPath volume requires a directory that does not exist',
      break: `echo 'hostdir=/var/log/${CLAIM}-app' >> "${state}.prov"`,
      fix: `kubectl -n "${NS}" delete pod "${CLAIM}-app" --wait=true
kubectl apply -f - <<< ${podJson(NS, `${CLAIM}-app`, CLAIM, `,{"name":"logs","hostPath":{"path":"/var/log/'"${CLAIM}"'-app","type":"DirectoryOrCreate"}}`, ',{"name":"logs","mountPath":"/logs"}')}`,
      wait: waitRunning(NS, `${CLAIM}-app`),
      explain: `Besides its claim, the Pod mounts hostPath \`/var/log/${CLAIM}-app\` with \`type: Directory\`, which requires the directory to exist on the node. It does not, so the Pod stays in \`ContainerCreating\` with "hostPath type check failed: ... is not a directory" under Events, although the claim is Bound. Re-create the Pod with \`type: DirectoryOrCreate\` (or create the directory on the node).`,
    },
    {
      id: 'claim-elsewhere',
      label: 'The claim exists only in another namespace',
      break: `${createNs(`${NS}-shared`)}
kubectl apply -f - <<< ${claimJson(`${NS}-shared`, CLAIM, `"storageClassName":"'"${CLAIM}"'-local",`)} >/dev/null
echo "skipclaim=yes" >> "${state}.prov"`,
      fix: `kubectl -n "${NS}" delete pod "${CLAIM}-app" --wait=true
kubectl apply -f - <<< ${claimJson(NS, CLAIM, `"storageClassName":"'"${CLAIM}"'-local",`)}
kubectl apply -f - <<< ${podJson(NS, `${CLAIM}-app`, CLAIM)}`,
      wait: waitRunning(NS, `${CLAIM}-app`),
      explain: `Claim \`${CLAIM}\` was created in namespace \`${NS}-shared\`, not \`${NS}\`. A Pod can only use claims of its own namespace, so \`${CLAIM}-app\` stays \`Pending\` with "persistentvolumeclaim \\"${CLAIM}\\" not found". A claim cannot be moved: create \`${CLAIM}\` in \`${NS}\` (the volume behind the other claim stays there), then re-create the Pod.`,
    },
  ],
};
