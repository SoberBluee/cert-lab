import { createNs, nsField, selectField } from '../types';
import { courseDir, onCp, taskBuilder } from './tasks';

/** Every Pod of the namespaces that start with `${prefix}-`, one line per container: <namespace>/<pod> <image>. */
const teamImages = (prefix: string) =>
  `kubectl get pods -A -o json | jq -r --arg p "${prefix}-" '.items[] | select(.metadata.namespace | startswith($p)) | . as $pod | ((.spec.initContainers // []) + .spec.containers)[] | "\\($pod.metadata.namespace)/\\($pod.metadata.name) \\(.image)"'`;

const NODE_COLUMNS = `NAME:.metadata.name,INTERNAL_IP:.status.addresses[?(@.type=="InternalIP")].address,KUBELET:.status.nodeInfo.kubeletVersion,RUNTIME:.status.nodeInfo.containerRuntimeVersion,POD_CIDR:.spec.podCIDR`;

/** Squeezes runs of blanks to one, so column widths do not matter. */
const squeeze = `awk '{$1=$1};1'`;

/** The ServiceAccounts of a namespace that may delete its Secrets. */
const secretDeleters = (ns: string) =>
  `for sa in $(kubectl -n ${ns} get serviceaccounts -o jsonpath='{.items[*].metadata.name}'); do [ "$(kubectl auth can-i delete secrets -n ${ns} --as="system:serviceaccount:${ns}:$sa")" = yes ] && echo "$sa"; done`;

/** Subjects bound to cluster-admin cluster-wide, without the ones the cluster made for itself. */
const clusterAdmins = `kubectl get clusterrolebindings -o json | jq -r '.items[] | select(.roleRef.name == "cluster-admin") | .subjects[]? | "\\(.kind) \\(.name)"' | grep -vE ' (system|kubeadm):' | sort -u`;

/** Names the Pods of a namespace that use a Secret through an env reference, envFrom or a volume. */
const secretConsumers = (ns: string, secret: string) =>
  `kubectl -n ${ns} get pods -o json | jq -r --arg s ${secret} '.items[] | select(([.spec.containers[].env[]?.valueFrom.secretKeyRef.name?] + [.spec.containers[].envFrom[]?.secretRef.name?] + [.spec.volumes[]?.secret.secretName?]) | index($s)) | .metadata.name' | sort -u`;

const KUBELET_CONFIG = '/var/lib/kubelet/config.yaml';

/** Reads one fact on a worker, as root. The script may not hold a single quote. */
const onNode = (node: string, script: string) => `$(runuser -u ubuntu -- ssh -o StrictHostKeyChecking=accept-new ${node} sudo bash -s <<< '${script}')`;

const FACTS = {
  'config-file': `systemctl cat kubelet | grep -oE -- "--config=[^ \\"]+" | cut -d= -f2`,
  'cgroup-driver': `grep "^cgroupDriver:" ${KUBELET_CONFIG} | cut -d" " -f2`,
  'cluster-dns': `grep -A1 "^clusterDNS:" ${KUBELET_CONFIG} | tail -1 | cut -d" " -f2`,
  'static-pod-path': `grep "^staticPodPath:" ${KUBELET_CONFIG} | cut -d" " -f2`,
  'runtime-endpoint': `grep "^containerRuntimeEndpoint:" ${KUBELET_CONFIG} | cut -d" " -f2`,
};

/** A file's content without blanks, compared to `want`, with /var/run and /run taken as the same place. */
const factCheck = (file: string, want: string) =>
  `want=$(echo ${want} | sed 's|/var/run/|/run/|'); [ -n "$want" ] && [ "$(tr -d '[:space:]' < ${file} 2>/dev/null | sed 's|/var/run/|/run/|')" = "$want" ] && echo ok || echo "want $want"`;

const bareContainer = (name: string, image: string, extra = '') => `    - name: ${name}
      image: ${image}
      command: ["sleep", "infinity"]${extra}`;

export const auditBuilder = taskBuilder({
  id: 'audit',
  name: 'Cluster audit',
  description: 'Answer what an auditor asks: a table of the nodes, the images in use, who may delete Secrets or holds cluster-admin, who reads a Secret, and how a kubelet is set up.',
  domain: 'cluster-architecture',
  difficulty: 2,
  minutes: 7,
  points: 6,
  tags: ['custom-columns', 'jsonpath', 'images', 'rbac', 'auth-can-i', 'secret', 'kubelet-config'],
  fields: [
    nsField(['acme', 'northwind', 'initech', 'umbrella', 'globex', 'hooli', 'stark', 'wayne', 'wonka', 'tyrell']),
    selectField('NODE', 'Worker', ['worker-1', 'worker-2'], { randomizeByDefault: true }),
  ],
  tasks: {
    'node-table': {
      label: 'Print a table of the nodes and script it',
      make: () => ({
        title: 'Table of the nodes',
        text: `An auditor wants an inventory of the nodes. On \`controlplane\`, using \`kubectl\`:

1. Write a table of all nodes to \`/opt/course/audit/nodes.txt\`, with a header line and these columns, in this order: \`NAME\`, \`INTERNAL_IP\`, \`KUBELET\`, \`RUNTIME\`, \`POD_CIDR\`. \`KUBELET\` is the kubelet version, and \`RUNTIME\` the container runtime with its version.
2. Write a script \`/opt/course/audit/nodes.sh\` that prints the same table. It must keep working when the nodes change, so it cannot just print the file.`,
        setup: [courseDir('audit')],
        checks: [
          onCp({
            id: 'table',
            description: 'nodes.txt is the table of the nodes, with its header',
            run: `want=$(kubectl get nodes -o custom-columns='${NODE_COLUMNS}' | ${squeeze} | sort); have=$(${squeeze} /opt/course/audit/nodes.txt 2>/dev/null | sort); [ -n "$want" ] && [ "$have" = "$want" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 4,
          }),
          onCp({
            id: 'script',
            description: 'nodes.sh prints that table from the live cluster',
            run: `f=/opt/course/audit/nodes.sh; want=$(kubectl get nodes -o custom-columns='${NODE_COLUMNS}' | ${squeeze} | sort); have=$(sudo -u ubuntu -H bash "$f" 2>/dev/null | ${squeeze} | sort); grep -q kubectl "$f" 2>/dev/null && [ "$have" = "$want" ] && echo works || echo broken`,
            expect: { equals: 'works' },
            weight: 2,
          }),
        ],
        solution: [
          `cat > /opt/course/audit/nodes.sh <<'EOF'
#!/usr/bin/env bash
kubectl get nodes -o custom-columns='${NODE_COLUMNS}'
EOF
chown ubuntu:ubuntu /opt/course/audit/nodes.sh
bash /opt/course/audit/nodes.sh > /opt/course/audit/nodes.txt`,
        ],
        hints: [
          'kubectl get nodes -o custom-columns=HEADER:.path,HEADER:.path prints any columns you name.',
          'kubectl get node <name> -o yaml shows the paths: .status.nodeInfo has the versions, and .spec.podCIDR the Pod range.',
          '.status.addresses is a list. A JSONPath filter picks one entry: .status.addresses[?(@.type=="InternalIP")].address, single-quoted for the shell.',
        ],
      }),
    },
    'image-inventory': {
      label: 'List the images of a team\'s Pods, init containers included',
      make: ({ NS }) => ({
        title: `Images used by ${NS}`,
        text: `A vulnerability report names \`busybox:1.37\`. The workloads of team \`${NS}\` run in the namespaces whose names start with \`${NS}-\`. On \`controlplane\`:

1. Write every distinct image their Pods use, init containers included, sorted and one per line, to \`/opt/course/audit/images.txt\`.
2. Write the Pods that use \`busybox:1.37\`, as \`<namespace>/<pod>\` and one per line, to \`/opt/course/audit/pods-using.txt\`.`,
        setup: [
          `${courseDir('audit')}
${createNs(`${NS}-web`)}
${createNs(`${NS}-batch`)}
${createNs(`${NS}-edge`)}
kubectl apply -f - <<EOF >/dev/null
apiVersion: apps/v1
kind: Deployment
metadata:
  name: storefront
  namespace: ${NS}-web
spec:
  replicas: 2
  selector:
    matchLabels: { app: storefront }
  template:
    metadata:
      labels: { app: storefront }
    spec:
      terminationGracePeriodSeconds: 1
      initContainers:
        - name: migrate
          image: alpine:3.20
          command: ["sh", "-c", "echo migrated"]
      containers:
        - name: web
          image: nginx:1.27-alpine
---
apiVersion: v1
kind: Pod
metadata:
  name: nightly
  namespace: ${NS}-batch
spec:
  terminationGracePeriodSeconds: 1
  containers:
${bareContainer('job', 'busybox:1.36')}
---
apiVersion: v1
kind: Pod
metadata:
  name: sync-agent
  namespace: ${NS}-batch
spec:
  terminationGracePeriodSeconds: 1
  containers:
${bareContainer('agent', 'alpine:3.21')}
${bareContainer('shipper', 'busybox:1.37')}
---
apiVersion: v1
kind: Pod
metadata:
  name: gateway
  namespace: ${NS}-edge
spec:
  terminationGracePeriodSeconds: 1
  initContainers:
    - name: fetch-certs
      image: busybox:1.37
      command: ["sh", "-c", "echo fetched"]
  containers:
    - name: gateway
      image: httpd:2.4-alpine
EOF
kubectl -n "${NS}-web" rollout status deployment/storefront --timeout=180s >/dev/null
kubectl -n "${NS}-batch" wait --for=condition=Ready pod/nightly pod/sync-agent --timeout=180s >/dev/null
kubectl -n "${NS}-edge" wait --for=condition=Ready pod/gateway --timeout=180s >/dev/null`,
        ],
        checks: [
          onCp({
            id: 'images',
            description: 'images.txt lists every image of the team, init containers included, sorted',
            run: `want=$(${teamImages(NS)} | awk '{print $2}' | sort -u); have=$(awk 'NF {print $1}' /opt/course/audit/images.txt 2>/dev/null); [ -n "$want" ] && [ "$have" = "$want" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 3,
          }),
          onCp({
            id: 'pods-using',
            description: 'pods-using.txt lists the Pods that use busybox:1.37',
            run: `want=$(${teamImages(NS)} | awk '$2 == "busybox:1.37" {print $1}' | sort -u | xargs); have=$(awk 'NF {print $1}' /opt/course/audit/pods-using.txt 2>/dev/null | sort -u | xargs); [ -n "$want" ] && [ "$have" = "$want" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 3,
          }),
        ],
        solution: [
          `${teamImages(NS)} > /tmp/team-images
awk '{print $2}' /tmp/team-images | sort -u > /opt/course/audit/images.txt
awk '$2 == "busybox:1.37" {print $1}' /tmp/team-images | sort -u > /opt/course/audit/pods-using.txt`,
        ],
        hints: [
          'kubectl get pods -A prints the namespace first, so grep can narrow it down; -o json with jq reaches every container.',
          'A Pod lists its images in .spec.containers and in .spec.initContainers. One JSONPath or jq expression can walk both.',
          'sort -u leaves each image once.',
        ],
      }),
    },
    'who-can': {
      label: 'Find who may delete Secrets and who holds cluster-admin',
      make: ({ NS }) => ({
        title: `Who can do what in ${NS}`,
        text: `A security review of namespace \`${NS}\` asks two questions. On \`controlplane\`:

1. Which ServiceAccounts of namespace \`${NS}\` may delete Secrets in that namespace? Write their names, one per line, to \`/opt/course/audit/secret-deleters.txt\`.
2. Who holds \`cluster-admin\` across the whole cluster through a ClusterRoleBinding? Write each subject as \`<kind> <name>\`, one per line, to \`/opt/course/audit/cluster-admins.txt\`. Leave out subjects whose names start with \`system:\` or \`kubeadm:\`.`,
        setup: [
          `${courseDir('audit')}
${createNs(NS)}
${createNs(`${NS}-sandbox`)}
kubectl delete clusterrolebinding "${NS}-break-glass" "${NS}-oncall" "${NS}-viewers" --ignore-not-found >/dev/null
kubectl delete clusterrole "${NS}-secret-cleaner" --ignore-not-found >/dev/null
kubectl -n "${NS}" delete rolebinding,role --all >/dev/null
kubectl -n "${NS}-sandbox" delete rolebinding,role --all >/dev/null
for sa in deployer scanner builder reporter auditor janitor; do
  kubectl -n "${NS}" create serviceaccount "$sa" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
done
# Two that may delete Secrets here, one through a Role and one through a ClusterRole.
kubectl -n "${NS}" create role secret-admin --verb=get,list,delete --resource=secrets >/dev/null
kubectl -n "${NS}" create rolebinding deployer-secrets --role=secret-admin --serviceaccount="${NS}:deployer" >/dev/null
kubectl create clusterrole "${NS}-secret-cleaner" --verb=delete,deletecollection --resource=secrets >/dev/null
kubectl -n "${NS}" create rolebinding scanner-secrets --clusterrole="${NS}-secret-cleaner" --serviceaccount="${NS}:scanner" >/dev/null
# Near misses: another verb, another resource, another namespace.
kubectl -n "${NS}" create role secret-reader --verb=get,list,watch --resource=secrets >/dev/null
kubectl -n "${NS}" create rolebinding reporter-secrets --role=secret-reader --serviceaccount="${NS}:reporter" >/dev/null
kubectl -n "${NS}" create role pod-cleaner --verb=delete --resource=pods >/dev/null
kubectl -n "${NS}" create rolebinding builder-pods --role=pod-cleaner --serviceaccount="${NS}:builder" >/dev/null
kubectl -n "${NS}" create rolebinding auditor-view --clusterrole=view --serviceaccount="${NS}:auditor" >/dev/null
kubectl -n "${NS}-sandbox" create rolebinding janitor-secrets --clusterrole="${NS}-secret-cleaner" --serviceaccount="${NS}:janitor" >/dev/null
# Cluster-wide: a user and a group hold cluster-admin; a binding to another role and a namespaced one do not count.
user=$(shuf -e alice-ops dana-sre ravi-admin mei-platform -n 1)
group=$(shuf -e oncall-admins platform-leads incident-team -n 1)
kubectl create clusterrolebinding "${NS}-break-glass" --clusterrole=cluster-admin --user="$user" >/dev/null
kubectl create clusterrolebinding "${NS}-oncall" --clusterrole=cluster-admin --group="$group" >/dev/null
kubectl create clusterrolebinding "${NS}-viewers" --clusterrole=view --user=compliance-bot >/dev/null
kubectl -n "${NS}" create rolebinding team-lead-admin --clusterrole=cluster-admin --user=team-lead >/dev/null`,
        ],
        checks: [
          onCp({
            id: 'deleters',
            description: `secret-deleters.txt lists exactly the ServiceAccounts that may delete Secrets in ${NS}`,
            run: `want=$(${secretDeleters(NS)} | sort | xargs); have=$(awk 'NF {print $1}' /opt/course/audit/secret-deleters.txt 2>/dev/null | sed 's/.*://' | sort -u | xargs); [ -n "$want" ] && [ "$have" = "$want" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 3,
          }),
          onCp({
            id: 'admins',
            description: 'cluster-admins.txt lists exactly the non-system subjects bound to cluster-admin',
            run: `want=$(${clusterAdmins}); have=$(sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//; /^$/d' /opt/course/audit/cluster-admins.txt 2>/dev/null | sort -u); [ -n "$want" ] && [ "$have" = "$want" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 3,
          }),
        ],
        solution: [
          `${secretDeleters(NS)} > /opt/course/audit/secret-deleters.txt
${clusterAdmins} > /opt/course/audit/cluster-admins.txt`,
        ],
        hints: [
          'kubectl auth can-i <verb> <resource> -n <namespace> --as=system:serviceaccount:<namespace>:<name> answers for any ServiceAccount, whichever bindings give it the right. Loop over them.',
          'kubectl get clusterrolebindings -o wide prints the role and the subjects of each binding; -o json with jq filters on .roleRef.name.',
          'A RoleBinding to cluster-admin only gives admin inside its own namespace.',
        ],
      }),
    },
    'secret-usage': {
      label: 'Decode a Secret and find every Pod that uses it',
      make: ({ NS }) => ({
        title: 'Who uses Secret db-credentials',
        text: `The password in Secret \`db-credentials\` in namespace \`${NS}\` is about to be rotated. On \`controlplane\`:

1. Write the decoded value of its key \`password\`, and nothing else, to \`/opt/course/secrets/password.txt\`.
2. Write the names of all Pods in \`${NS}\` that use this Secret in any way, one per line, to \`/opt/course/secrets/consumers.txt\`.`,
        setup: [
          `${courseDir('secrets')}
${createNs(NS)}
kubectl -n "${NS}" delete pod --all --wait=true >/dev/null 2>&1 || true
pass=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \\n')
kubectl -n "${NS}" create secret generic db-credentials --from-literal=username=app --from-literal=password="$pass" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${NS}" create secret generic db-credentials-old --from-literal=username=app --from-literal=password=expired --dry-run=client -o yaml | kubectl apply -f - >/dev/null
names=($(shuf -e api-gateway order-worker nightly-backup report-gen static-web))
kubectl apply -f - <<EOF >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: \${names[0]}
  namespace: ${NS}
spec:
  terminationGracePeriodSeconds: 1
  containers:
${bareContainer(
  'app',
  'busybox:1.36',
  `
      env:
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef: { name: db-credentials, key: password }`,
)}
---
apiVersion: v1
kind: Pod
metadata:
  name: \${names[1]}
  namespace: ${NS}
spec:
  terminationGracePeriodSeconds: 1
  containers:
${bareContainer(
  'app',
  'busybox:1.36',
  `
      envFrom:
        - secretRef: { name: db-credentials }`,
)}
---
apiVersion: v1
kind: Pod
metadata:
  name: \${names[2]}
  namespace: ${NS}
spec:
  terminationGracePeriodSeconds: 1
  containers:
${bareContainer(
  'app',
  'busybox:1.36',
  `
      volumeMounts: [{ name: creds, mountPath: /etc/db, readOnly: true }]`,
)}
  volumes:
    - name: creds
      secret: { secretName: db-credentials }
---
apiVersion: v1
kind: Pod
metadata:
  name: \${names[3]}
  namespace: ${NS}
spec:
  terminationGracePeriodSeconds: 1
  containers:
${bareContainer(
  'app',
  'busybox:1.36',
  `
      env:
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef: { name: db-credentials-old, key: password }`,
)}
---
apiVersion: v1
kind: Pod
metadata:
  name: \${names[4]}
  namespace: ${NS}
spec:
  terminationGracePeriodSeconds: 1
  containers:
${bareContainer('app', 'busybox:1.36')}
EOF
kubectl -n "${NS}" wait --for=condition=Ready pod --all --timeout=180s >/dev/null`,
        ],
        checks: [
          onCp({
            id: 'password',
            description: 'password.txt holds the decoded password',
            run: `want=$(kubectl -n ${NS} get secret db-credentials -o jsonpath='{.data.password}' | base64 -d); [ -n "$want" ] && [ "$(tr -d '[:space:]' < /opt/course/secrets/password.txt 2>/dev/null)" = "$want" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 2,
          }),
          onCp({
            id: 'consumers',
            description: 'consumers.txt lists exactly the Pods that use db-credentials',
            run: `want=$(${secretConsumers(NS, 'db-credentials')} | xargs); have=$(awk 'NF {print $1}' /opt/course/secrets/consumers.txt 2>/dev/null | sort -u | xargs); [ -n "$want" ] && [ "$have" = "$want" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 4,
          }),
        ],
        solution: [
          `kubectl -n ${NS} get secret db-credentials -o jsonpath='{.data.password}' | base64 -d > /opt/course/secrets/password.txt
${secretConsumers(NS, 'db-credentials')} > /opt/course/secrets/consumers.txt`,
        ],
        hints: [
          'kubectl get secret <name> -o jsonpath=\'{.data.password}\' prints the base64 value; base64 -d decodes it.',
          'A Pod can take a Secret three ways: env[].valueFrom.secretKeyRef, envFrom[].secretRef and volumes[].secret. kubectl get pods -o yaml shows them all.',
          'kubectl get pods -o yaml | grep -n db-credentials also finds other names that start the same way, so look at the whole name.',
        ],
      }),
    },
    'kubelet-facts': {
      label: 'Find how a worker\'s kubelet and runtime are set up',
      make: ({ NODE }) => ({
        title: `Kubelet facts of ${NODE}`,
        text: `Find out how the kubelet on \`${NODE}\` is set up. Write each answer, and nothing else, to a file in \`/opt/course/node-facts/\` on \`controlplane\`:

1. \`config-file\`: the full path of the configuration file the kubelet loads
2. \`cgroup-driver\`: the cgroup driver it uses
3. \`cluster-dns\`: the DNS server it gives to Pods
4. \`static-pod-path\`: the directory it watches for static Pods
5. \`runtime-endpoint\`: the socket it uses to reach the container runtime
6. \`containerd-version\`: the version of containerd on the node, such as \`1.2.3\``,
        setup: [courseDir('node-facts')],
        checks: [
          ...Object.entries(FACTS).map(([file, script]) =>
            onCp({
              id: file,
              description: `${file} holds the value the kubelet on ${NODE} uses`,
              run: factCheck(`/opt/course/node-facts/${file}`, `"${onNode(NODE, script)}"`),
              expect: { equals: 'ok' },
              weight: 1,
            }),
          ),
          onCp({
            id: 'containerd-version',
            description: `containerd-version holds the containerd version of ${NODE}`,
            run: factCheck('/opt/course/node-facts/containerd-version', `"$(kubectl get node ${NODE} -o jsonpath='{.status.nodeInfo.containerRuntimeVersion}' | sed 's|.*//||')"`),
            expect: { equals: 'ok' },
            weight: 1,
          }),
        ],
        solution: [
          `${Object.entries(FACTS)
            .map(([file, script]) => `echo "${onNode(NODE, script)}" > /opt/course/node-facts/${file}`)
            .join('\n')}
kubectl get node ${NODE} -o jsonpath='{.status.nodeInfo.containerRuntimeVersion}' | sed 's|.*//||' > /opt/course/node-facts/containerd-version`,
        ],
        hints: [
          'systemctl cat kubelet shows the unit and its drop-ins, and so the flags the kubelet starts with.',
          'The file that --config names holds the rest, in YAML.',
          'kubectl get nodes -o wide shows the runtime and its version without leaving controlplane.',
        ],
      }),
    },
  },
});
