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

/** Compares the names in a file, one per line with any <namespace>/ prefix dropped, with the names `want` prints. */
const namesMatch = (file: string, want: string) =>
  `want=$(${want} | sort -u | xargs); have=$(awk 'NF {print $1}' ${file} 2>/dev/null | sed 's|.*/||' | sort -u | xargs); [ -n "$want" ] && [ "$have" = "$want" ] && echo match || echo differs`;

/** Compares a file's lines, blanks squeezed, with the lines `want` prints, both sorted. */
const linesMatch = (file: string, want: string) =>
  `want=$(${want} | sort -u); have=$(${squeeze} ${file} 2>/dev/null | sed '/^$/d' | sort -u); [ -n "$want" ] && [ "$have" = "$want" ] && echo match || echo differs`;

/** A namespace of the task's own, started from scratch, so that nothing an earlier run left changes the answer. */
const freshNs = (ns: string) => `kubectl delete namespace "${ns}" --ignore-not-found --wait=true >/dev/null
${createNs(ns)}`;

const podsJson = (ns: string) => `kubectl -n ${ns} get pods -o json`;

/** Pods with a container, init containers included, that runs privileged. */
const privilegedPods = (ns: string) =>
  `${podsJson(ns)} | jq -r '.items[] | select([((.spec.initContainers // []) + .spec.containers)[] | .securityContext.privileged // false] | any) | .metadata.name'`;
const hostNetworkPods = (ns: string) => `${podsJson(ns)} | jq -r '.items[] | select(.spec.hostNetwork == true) | .metadata.name'`;
const hostPathPods = (ns: string) => `${podsJson(ns)} | jq -r '.items[] | select([.spec.volumes[]? | has("hostPath")] | any) | .metadata.name'`;

/** Pods with a container that sets no memory limit. */
const noMemoryLimit = (ns: string) => `${podsJson(ns)} | jq -r '.items[] | select([.spec.containers[].resources.limits.memory] | any(. == null)) | .metadata.name'`;
/** The 3 Pods whose containers request the most CPU together, highest first. The task's requests are all in millicores. */
const topCpu = (ns: string) =>
  `${podsJson(ns)} | jq -r '[.items[] | {n: .metadata.name, m: ([.spec.containers[].resources.requests.cpu // "0m" | rtrimstr("m") | tonumber] | add)}] | sort_by(-.m) | .[:3][] | .n'`;

/** Pods that are not ready, leaving out those that ran to completion. */
const notReady = (ns: string) =>
  `${podsJson(ns)} | jq -r '.items[] | select(.status.phase != "Succeeded") | select(([.status.conditions[]? | select(.type == "Ready") | .status] | first) != "True") | .metadata.name'`;
const unscheduled = (ns: string) => `${podsJson(ns)} | jq -r '.items[] | select([.status.conditions[]? | select(.type == "PodScheduled" and .status == "False")] | length > 0) | .metadata.name'`;
/** The images, as the Pod spec names them, of Pods with a container stuck pulling. */
const unpullable = (ns: string) =>
  `${podsJson(ns)} | jq -r '.items[] | select([.status.containerStatuses[]? | .state.waiting.reason // ""] | any(test("ErrImagePull|ImagePullBackOff"))) | .spec.containers[].image'`;

/** Services with a selector that matches no Pod of their namespace. */
const emptyServices = (ns: string) =>
  `for s in $(kubectl -n ${ns} get services -o json | jq -r '.items[] | select(.spec.selector) | .metadata.name + "=" + (.spec.selector | to_entries | map("\\(.key)=\\(.value)") | join(","))'); do if [ -z "$(kubectl -n ${ns} get pods -l "\${s#*=}" -o name)" ]; then echo "\${s%%=*}"; fi; done`;
/** ServiceAccounts of a namespace, other than default, that no Pod runs as. Grouped, so that a pipe or redirect after it takes all of its output. */
const unusedServiceAccounts = (ns: string) =>
  `{ used=$(${podsJson(ns)} | jq -r '.items[].spec.serviceAccountName' | sort -u); kubectl -n ${ns} get serviceaccounts -o jsonpath='{range .items[*]}{.metadata.name}{"\\n"}{end}' | grep -vx default | grep -vxF "$used" || true; }`;

/** Every path of the Ingresses in namespaces starting with `${prefix}-`: <host> <path> <service>:<port>. */
const ingressRules = (prefix: string) =>
  `kubectl get ingress -A -o json | jq -r --arg p "${prefix}-" '.items[] | select(.metadata.namespace | startswith($p)) | .spec.rules[] as $r | $r.http.paths[] | "\\($r.host) \\(.path) \\(.backend.service.name):\\(.backend.service.port.number // .backend.service.port.name)"'`;
/** The Services those Ingresses route to that do not exist, as <namespace>/<service>. */
const missingBackends = (prefix: string) =>
  `kubectl get ingress -A -o json | jq -r --arg p "${prefix}-" '.items[] | select(.metadata.namespace | startswith($p)) | .metadata.namespace as $ns | .spec.rules[].http.paths[].backend.service.name | $ns + " " + .' | sort -u | while read -r ns svc; do kubectl -n "$ns" get service "$svc" >/dev/null 2>&1 || echo "$ns/$svc"; done`;

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
    'security-context': {
      label: 'Find privileged Pods, and Pods that use the host network or host paths',
      make: ({ NS }) => {
        const ns = `${NS}-apps`;
        return {
          title: `Hardening review of ${ns}`,
          text: `A hardening review of namespace \`${ns}\` looks for Pods that reach into their node. On \`controlplane\`, write the names of the Pods of \`${ns}\`, one per line:

1. to \`/opt/course/audit/privileged.txt\`: Pods with a container that runs privileged, init containers included
2. to \`/opt/course/audit/host-network.txt\`: Pods that use the node's network namespace
3. to \`/opt/course/audit/host-path.txt\`: Pods that mount a directory of the node`,
          setup: [
            `${courseDir('audit')}
${freshNs(ns)}
# Which Pod does what changes on every run.
names=($(shuf -e api-gateway log-forwarder metrics-agent node-tuner backup-runner cache-warmer -n 6))
kubectl apply -f - <<EOF >/dev/null
apiVersion: v1
kind: Pod
metadata: { name: \${names[0]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  containers:
${bareContainer('app', 'busybox:1.36', '\n      securityContext: { privileged: true }')}
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[1]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  initContainers:
    - name: tune-sysctls
      image: busybox:1.36
      command: ["sh", "-c", "echo tuned"]
      securityContext: { privileged: true }
  containers:
${bareContainer('app', 'busybox:1.36')}
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[2]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  hostNetwork: true
  containers:
${bareContainer('app', 'busybox:1.36')}
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[3]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  containers:
${bareContainer('app', 'busybox:1.36', '\n      volumeMounts: [{ name: logs, mountPath: /host/log, readOnly: true }]')}
  volumes:
    - name: logs
      hostPath: { path: /var/log, type: Directory }
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[4]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  containers:
${bareContainer('app', 'busybox:1.36', '\n      securityContext: { privileged: false, allowPrivilegeEscalation: false }\n      volumeMounts: [{ name: scratch, mountPath: /scratch }]')}
  volumes:
    - name: scratch
      emptyDir: {}
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[5]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  containers:
${bareContainer('app', 'busybox:1.36')}
EOF
kubectl -n "${ns}" wait --for=condition=Ready pod --all --timeout=180s >/dev/null`,
          ],
          checks: [
            onCp({ id: 'privileged', description: 'privileged.txt lists the Pods with a privileged container', run: namesMatch('/opt/course/audit/privileged.txt', privilegedPods(ns)), expect: { equals: 'match' }, weight: 2 }),
            onCp({ id: 'host-network', description: "host-network.txt lists the Pods on the node's network", run: namesMatch('/opt/course/audit/host-network.txt', hostNetworkPods(ns)), expect: { equals: 'match' }, weight: 2 }),
            onCp({ id: 'host-path', description: 'host-path.txt lists the Pods that mount a hostPath', run: namesMatch('/opt/course/audit/host-path.txt', hostPathPods(ns)), expect: { equals: 'match' }, weight: 2 }),
          ],
          solution: [
            `${privilegedPods(ns)} > /opt/course/audit/privileged.txt
${hostNetworkPods(ns)} > /opt/course/audit/host-network.txt
${hostPathPods(ns)} > /opt/course/audit/host-path.txt`,
          ],
          hints: [
            'privileged sits in each container\'s securityContext, and init containers have their own: check .spec.initContainers as well as .spec.containers.',
            'hostNetwork is a field of the Pod spec; hostPath is a kind of volume, in .spec.volumes.',
            `kubectl -n ${ns} get pods -o json | jq can filter on all three. A container that says privileged: false does not count.`,
          ],
        };
      },
    },
    'resource-audit': {
      label: 'Find containers without a memory limit, and the Pods that request the most CPU',
      make: ({ NS }) => {
        const ns = `${NS}-compute`;
        return {
          title: `Resource review of ${ns}`,
          text: `A capacity review of namespace \`${ns}\` asks two questions. On \`controlplane\`:

1. Which Pods of \`${ns}\` have a container without a memory limit? Write their names, one per line, to \`/opt/course/audit/no-memory-limit.txt\`.
2. Which 3 Pods of \`${ns}\` request the most CPU, adding up all their containers? Write their names to \`/opt/course/audit/top-cpu.txt\`, one per line, the highest first.`,
          setup: [
            `${courseDir('audit')}
${freshNs(ns)}
# Requests in tens of millicores, and sidecars of 5m, so that no two Pods tie.
names=($(shuf -e ingest-api report-builder thumbnailer search-indexer mail-relay csv-export -n 6))
cpus=($(shuf -e 10 20 30 40 50 60 70 80 90 -n 6))
limited=($(shuf -e yes yes yes no no no))
for i in 0 1 2 3 4 5; do
  limit=''
  [[ \${limited[$i]} == yes ]] && limit=', limits: { memory: 64Mi }'
  sidecar=''
  if (( i == 4 )); then
    sidecar='    - { name: sidecar, image: busybox:1.36, command: [sleep, infinity], resources: { requests: { cpu: 5m }, limits: { memory: 32Mi } } }'
  elif (( i == 5 )); then
    sidecar='    - { name: sidecar, image: busybox:1.36, command: [sleep, infinity], resources: { requests: { cpu: 5m } } }'
  fi
  kubectl apply -f - <<EOF >/dev/null
apiVersion: v1
kind: Pod
metadata: { name: \${names[$i]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  containers:
    - { name: main, image: busybox:1.36, command: [sleep, infinity], resources: { requests: { cpu: \${cpus[$i]}m }$limit } }
$sidecar
EOF
done
kubectl -n "${ns}" wait --for=condition=Ready pod --all --timeout=180s >/dev/null`,
          ],
          checks: [
            onCp({
              id: 'no-memory-limit',
              description: 'no-memory-limit.txt lists the Pods with a container that has no memory limit',
              run: namesMatch('/opt/course/audit/no-memory-limit.txt', noMemoryLimit(ns)),
              expect: { equals: 'match' },
              weight: 3,
            }),
            onCp({
              id: 'top-cpu',
              description: 'top-cpu.txt names the 3 Pods that request the most CPU, highest first',
              run: `want=$(${topCpu(ns)} | xargs); have=$(awk 'NF {print $1}' /opt/course/audit/top-cpu.txt 2>/dev/null | sed 's|.*/||' | xargs); [ -n "$want" ] && [ "$have" = "$want" ] && echo match || echo differs`,
              expect: { equals: 'match' },
              weight: 3,
            }),
          ],
          solution: [
            `${noMemoryLimit(ns)} > /opt/course/audit/no-memory-limit.txt
${topCpu(ns)} > /opt/course/audit/top-cpu.txt`,
          ],
          hints: [
            `kubectl -n ${ns} get pods -o custom-columns=NAME:.metadata.name,CPU:.spec.containers[*].resources.requests.cpu,MEM_LIMIT:.spec.containers[*].resources.limits.memory shows every container; <none> marks a missing value.`,
            'A Pod with two containers counts if either one has no memory limit, and its CPU request is the sum of both.',
            'jq can add up the requests and sort: sort_by(-.cpu) puts the highest first.',
          ],
        };
      },
    },
    'unhealthy-pods': {
      label: 'Find the Pods that are not ready, the one no node takes, and the image that cannot be pulled',
      make: ({ NS }) => {
        const ns = `${NS}-ops`;
        return {
          title: `Unhealthy Pods in ${ns}`,
          text: `Before a release, the on-call engineer wants to know what is broken in namespace \`${ns}\`. On \`controlplane\`:

1. Write the names of the Pods of \`${ns}\` that are not ready, one per line, to \`/opt/course/audit/unhealthy.txt\`. Leave out Pods that ran to completion.
2. Write the name of the Pod that no node will run to \`/opt/course/audit/unscheduled.txt\`.
3. Write the image that cannot be pulled to \`/opt/course/audit/bad-image.txt\`.`,
          setup: [
            `${courseDir('audit')}
${freshNs(ns)}
names=($(shuf -e checkout-api pricing-sync email-worker search-api fraud-check audit-export nightly-report -n 7))
bad=$(shuf -e nginx:1.27-alpinee registry.lab.internal/payments/api:2.4 httpd:2.4-alpne -n 1)
kubectl apply -f - <<EOF >/dev/null
apiVersion: v1
kind: Pod
metadata: { name: \${names[0]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  containers:
${bareContainer('app', 'busybox:1.36')}
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[1]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  containers:
${bareContainer('app', 'busybox:1.36')}
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[2]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  containers:
    - name: app
      image: $bad
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[3]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo missing DATABASE_URL; exit 1"]
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[4]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  nodeSelector: { disktype: nvme }
  containers:
${bareContainer('app', 'busybox:1.36')}
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[5]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  initContainers:
    - name: wait-for-db
      image: busybox:1.36
      command: ["sh", "-c", "until nslookup db; do sleep 5; done"]
  containers:
${bareContainer('app', 'busybox:1.36')}
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[6]}, namespace: ${ns} }
spec:
  terminationGracePeriodSeconds: 1
  restartPolicy: Never
  containers:
    - name: report
      image: busybox:1.36
      command: ["sh", "-c", "echo report done"]
EOF
kubectl -n "${ns}" wait --for=condition=Ready "pod/\${names[0]}" "pod/\${names[1]}" --timeout=180s >/dev/null
kubectl -n "${ns}" wait --for=jsonpath='{.status.phase}'=Succeeded "pod/\${names[6]}" --timeout=180s >/dev/null
# Start from a settled state: the pull has failed and the scheduler has given up on the Pending Pod.
for _ in $(seq 1 60); do
  [[ -n "$(${unpullable(ns)})" && -n "$(${unscheduled(ns)})" ]] && break
  sleep 2
done`,
          ],
          checks: [
            onCp({ id: 'unhealthy', description: 'unhealthy.txt lists the Pods that are not ready, without completed ones', run: namesMatch('/opt/course/audit/unhealthy.txt', notReady(ns)), expect: { equals: 'match' }, weight: 3 }),
            onCp({ id: 'unscheduled', description: 'unscheduled.txt names the Pod that no node runs', run: namesMatch('/opt/course/audit/unscheduled.txt', unscheduled(ns)), expect: { equals: 'match' }, weight: 2 }),
            onCp({
              id: 'bad-image',
              description: 'bad-image.txt holds the image that cannot be pulled',
              run: `want=$(${unpullable(ns)} | sort -u); [ -n "$want" ] && [ "$(tr -d '[:space:]' < /opt/course/audit/bad-image.txt 2>/dev/null)" = "$want" ] && echo match || echo differs`,
              expect: { equals: 'match' },
              weight: 1,
              retrySeconds: 30,
            }),
          ],
          solution: [
            `${notReady(ns)} > /opt/course/audit/unhealthy.txt
${unscheduled(ns)} > /opt/course/audit/unscheduled.txt
${unpullable(ns)} | sort -u > /opt/course/audit/bad-image.txt`,
          ],
          hints: [
            `kubectl -n ${ns} get pods: READY 0/1 marks the ones that are not ready. STATUS Completed is a Pod that ran to completion, which is not a problem.`,
            'Pending with no node in kubectl get pods -o wide means the scheduler found none: kubectl describe pod shows why.',
            'ErrImagePull or ImagePullBackOff names the Pod; its image is in .spec.containers[].image, or in kubectl describe pod.',
          ],
        };
      },
    },
    orphans: {
      label: 'Find Services that select no Pod, and ServiceAccounts no Pod uses',
      make: ({ NS }) => {
        const ns = `${NS}-svc`;
        return {
          title: `Leftovers in ${ns}`,
          text: `Namespace \`${ns}\` has collected leftovers from earlier releases. On \`controlplane\`:

1. Write the names of the Services of \`${ns}\` that have a selector but select no Pod, one per line, to \`/opt/course/audit/empty-services.txt\`.
2. Write the names of the ServiceAccounts of \`${ns}\` that no Pod runs as, one per line, to \`/opt/course/audit/unused-serviceaccounts.txt\`. Leave out \`default\`.`,
          setup: [
            `${courseDir('audit')}
${freshNs(ns)}
apps=($(shuf -e cart catalog payments search reviews -n 3))
sas=($(shuf -e ci-deployer cart-runtime metrics-reader legacy-sync backup-agent -n 5))
# The Pods run as the first two ServiceAccounts, and as default; the other three are unused. Two Services select nothing.
for sa in "\${sas[@]}"; do kubectl -n "${ns}" create serviceaccount "$sa" >/dev/null; done
kubectl apply -f - <<EOF >/dev/null
apiVersion: apps/v1
kind: Deployment
metadata: { name: \${apps[0]}, namespace: ${ns} }
spec:
  replicas: 1
  selector: { matchLabels: { app: \${apps[0]} } }
  template:
    metadata: { labels: { app: \${apps[0]}, tier: backend } }
    spec:
      serviceAccountName: \${sas[0]}
      terminationGracePeriodSeconds: 1
      containers:
${bareContainer('app', 'busybox:1.36').replace(/^/gm, '    ')}
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: \${apps[1]}, namespace: ${ns} }
spec:
  replicas: 1
  selector: { matchLabels: { app: \${apps[1]} } }
  template:
    metadata: { labels: { app: \${apps[1]} } }
    spec:
      serviceAccountName: \${sas[1]}
      terminationGracePeriodSeconds: 1
      containers:
${bareContainer('app', 'busybox:1.36').replace(/^/gm, '    ')}
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: \${apps[2]}, namespace: ${ns} }
spec:
  replicas: 1
  selector: { matchLabels: { app: \${apps[2]} } }
  template:
    metadata: { labels: { app: \${apps[2]} } }
    spec:
      terminationGracePeriodSeconds: 1
      containers:
${bareContainer('app', 'busybox:1.36').replace(/^/gm, '    ')}
---
apiVersion: v1
kind: Service
metadata: { name: \${apps[0]}, namespace: ${ns} }
spec: { selector: { app: \${apps[0]} }, ports: [{ port: 80 }] }
---
apiVersion: v1
kind: Service
metadata: { name: \${apps[1]}, namespace: ${ns} }
spec: { selector: { app: \${apps[1]} }, ports: [{ port: 80 }] }
---
apiVersion: v1
kind: Service
metadata: { name: backends, namespace: ${ns} }
spec: { selector: { tier: backend }, ports: [{ port: 80 }] }
---
apiVersion: v1
kind: Service
metadata: { name: \${apps[2]}-v1, namespace: ${ns} }
spec: { selector: { app: \${apps[2]}, version: v1 }, ports: [{ port: 80 }] }
---
apiVersion: v1
kind: Service
metadata: { name: legacy-gateway, namespace: ${ns} }
spec: { selector: { app: legacy-gateway }, ports: [{ port: 80 }] }
---
apiVersion: v1
kind: Service
metadata: { name: partner-api, namespace: ${ns} }
spec: { type: ExternalName, externalName: api.partner.example }
EOF
kubectl -n "${ns}" wait --for=condition=Available deployment --all --timeout=180s >/dev/null`,
          ],
          checks: [
            onCp({ id: 'empty-services', description: 'empty-services.txt lists the Services whose selector matches no Pod', run: namesMatch('/opt/course/audit/empty-services.txt', emptyServices(ns)), expect: { equals: 'match' }, weight: 3 }),
            onCp({
              id: 'unused-serviceaccounts',
              description: 'unused-serviceaccounts.txt lists the ServiceAccounts no Pod runs as, without default',
              run: namesMatch('/opt/course/audit/unused-serviceaccounts.txt', unusedServiceAccounts(ns)),
              expect: { equals: 'match' },
              weight: 3,
            }),
          ],
          solution: [
            `${emptyServices(ns)} > /opt/course/audit/empty-services.txt
${unusedServiceAccounts(ns)} > /opt/course/audit/unused-serviceaccounts.txt`,
          ],
          hints: [
            `kubectl -n ${ns} get endpointslices shows which Services have endpoints. A Service without a selector, such as an ExternalName one, has none by design and does not count.`,
            'A selector matches only Pods that carry every one of its labels: kubectl get pods -l <key>=<value>,<key>=<value> tries it.',
            `kubectl -n ${ns} get pods -o custom-columns=NAME:.metadata.name,SA:.spec.serviceAccountName shows which ServiceAccount each Pod runs as.`,
          ],
        };
      },
    },
    'ingress-map': {
      label: "Map every Ingress path to its backend, and find backends that do not exist",
      make: ({ NS }) => ({
        title: `Ingress routes of ${NS}`,
        text: `Team \`${NS}\` publishes its sites through Ingresses in the namespaces whose names start with \`${NS}-\`. On \`controlplane\`:

1. Write one line per path of every one of those Ingresses to \`/opt/course/audit/ingress-rules.txt\`, as \`<host> <path> <service>:<port>\`, with the port as the Ingress gives it, a number or a name.
2. Some paths route to a Service that does not exist. Write each such Service once, as \`<namespace>/<service>\`, to \`/opt/course/audit/missing-backends.txt\`.`,
        setup: [
          `${courseDir('audit')}
${freshNs(`${NS}-shop`)}
${freshNs(`${NS}-blog`)}
region=$(shuf -e eu us apac -n 1)
missing=$(shuf -e shop-api admin-ui blog -n 1)
kubectl apply -f - <<EOF >/dev/null
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: storefront, namespace: ${NS}-shop }
spec:
  rules:
    - host: shop-$region.lab
      http:
        paths:
          - { path: /, pathType: Prefix, backend: { service: { name: storefront, port: { number: 80 } } } }
          - { path: /api, pathType: Prefix, backend: { service: { name: shop-api, port: { number: 8080 } } } }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: admin, namespace: ${NS}-shop }
spec:
  rules:
    - host: admin-$region.lab
      http:
        paths:
          - { path: /, pathType: Prefix, backend: { service: { name: admin-ui, port: { name: http } } } }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: blog, namespace: ${NS}-blog }
spec:
  rules:
    - host: blog-$region.lab
      http:
        paths:
          - { path: /, pathType: Prefix, backend: { service: { name: blog, port: { number: 80 } } } }
    - host: www.blog-$region.lab
      http:
        paths:
          - { path: /, pathType: Prefix, backend: { service: { name: blog, port: { number: 80 } } } }
EOF
# Every backend Service exists, except one.
for s in shop/storefront:80 shop/shop-api:8080 shop/admin-ui:80 blog/blog:80; do
  ns="${NS}-\${s%%/*}" rest=\${s#*/}
  name=\${rest%%:*} port=\${rest#*:}
  [[ "$name" == "$missing" ]] && continue
  kubectl -n "$ns" create service clusterip "$name" --tcp="$port:$port" >/dev/null
done`,
        ],
        checks: [
          onCp({ id: 'rules', description: 'ingress-rules.txt has one line per path of every Ingress of the team', run: linesMatch('/opt/course/audit/ingress-rules.txt', ingressRules(NS)), expect: { equals: 'match' }, weight: 4 }),
          onCp({ id: 'missing', description: 'missing-backends.txt lists the Services that paths route to but that do not exist', run: linesMatch('/opt/course/audit/missing-backends.txt', missingBackends(NS)), expect: { equals: 'match' }, weight: 2 }),
        ],
        solution: [
          `${ingressRules(NS)} > /opt/course/audit/ingress-rules.txt
${missingBackends(NS)} > /opt/course/audit/missing-backends.txt`,
        ],
        hints: [
          'kubectl get ingress -A shows the hosts, and kubectl describe ingress each path with its backend.',
          'In the spec, each rule has a host and a list of paths; each path has a backend.service with a name and a port.number or port.name. jq can walk both lists at once.',
          'kubectl -n <namespace> get service <name> fails for a Service that does not exist.',
        ],
      }),
    },
  },
});
