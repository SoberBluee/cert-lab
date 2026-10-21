import { nameField } from '../types';
import { CHARTREPO_SCRIPT } from './helm';
import { courseDir, onCp, taskBuilder } from './tasks';

const HELM = 'runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm';
const chartRepo = `(\n${CHARTREPO_SCRIPT.replace(/^#!.*\n/, '')}) || exit 1`;

/** A CRD with a real schema, so kubectl explain has something to say. */
const crd = (plural: string, kind: string, group: string, extra = '') => `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: ${plural}.${group}
spec:
  group: ${group}
  scope: Namespaced
  names:
    plural: ${plural}
    singular: ${kind.toLowerCase()}
    kind: ${kind}
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                replicas:
                  type: integer
                  description: Number of database instances.${extra}`;

const backupSchema = (token: string) => `
                backup:
                  type: object
                  description: When and where the operator takes backups.
                  properties:
                    schedule:
                      type: string
                      description: Cron schedule of the backups. Lab reference ${token}.
                    retention:
                      type: integer
                      description: How many backups to keep.`;

export const crdsBuilder = taskBuilder({
  id: 'crds',
  name: 'CRDs and operators',
  description: 'Inspect CustomResourceDefinitions, read a custom field with kubectl explain, or install an operator chart without its CRDs.',
  domain: 'cluster-architecture',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['crd', 'operator', 'kubectl-explain', 'helm'],
  track: 'cluster',
  fields: [nameField('NS', 'Namespace for the custom objects', ['shop', 'orders', 'billing', 'inventory', 'crm', 'ledger', 'payments', 'sales', 'reports', 'catalog'])],
  tasks: {
    'list-crds': {
      label: 'Inspect the CRDs of an API group',
      make: () => ({
        title: 'Inspect custom resource definitions',
        text: `An operator installed several CustomResourceDefinitions in this cluster. On \`controlplane\`, write:

1. \`/opt/course/crd/names.txt\`: the names of every CRD in API group \`db.example.lab\`, one per line, and nothing else.
2. \`/opt/course/crd/scope.txt\`: whether objects of kind \`Database\` are \`Namespaced\` or \`Cluster\` scoped.
3. \`/opt/course/crd/version.txt\`: the version of the \`Database\` API that is stored in etcd.`,
        setup: [
          `${courseDir('crd')}
kubectl delete crd databases.db.example.lab --ignore-not-found --wait=true >/dev/null
kubectl apply -f - <<EOF >/dev/null
${crd('databases', 'Database', 'db.example.lab').replace('    - name: v1\n      served: true\n      storage: true', '    - name: v1alpha1\n      served: true\n      storage: false\n      schema:\n        openAPIV3Schema:\n          type: object\n          x-kubernetes-preserve-unknown-fields: true\n    - name: v1beta1\n      served: true\n      storage: true')}
---
${crd('backups', 'Backup', 'db.example.lab')}
---
${crd('users', 'User', 'db.example.lab').replace('scope: Namespaced', 'scope: Cluster')}
---
${crd('caches', 'Cache', 'cache.example.lab')}
---
${crd('dbsnapshots', 'DbSnapshot', 'storage.example.lab')}
EOF
kubectl wait --for=condition=Established crd --all --timeout=60s >/dev/null`,
        ],
        checks: [
          onCp({
            id: 'names',
            description: 'names.txt lists exactly the CRDs of group db.example.lab',
            run: `[ "$(sort /opt/course/crd/names.txt 2>/dev/null | grep -v '^$' | xargs)" = "$(kubectl get crd -o jsonpath='{range .items[?(@.spec.group=="db.example.lab")]}{.metadata.name}{"\\n"}{end}' | sort | xargs)" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 3,
          }),
          onCp({
            id: 'scope',
            description: 'scope.txt says Database is Namespaced',
            run: `tr -d ' \\n' < /opt/course/crd/scope.txt 2>/dev/null`,
            expect: { equals: 'Namespaced' },
            weight: 1,
          }),
          onCp({
            id: 'version',
            description: 'version.txt names the storage version of Database, v1beta1',
            run: `tr -d ' \\n' < /opt/course/crd/version.txt 2>/dev/null`,
            expect: { matches: '^(db\\.example\\.lab/)?v1beta1$' },
            weight: 2,
          }),
        ],
        solution: [
          `kubectl get crd -o jsonpath='{range .items[?(@.spec.group=="db.example.lab")]}{.metadata.name}{"\\n"}{end}' > /opt/course/crd/names.txt
kubectl get crd databases.db.example.lab -o jsonpath='{.spec.scope}' > /opt/course/crd/scope.txt
kubectl get crd databases.db.example.lab -o jsonpath='{.spec.versions[?(@.storage==true)].name}' > /opt/course/crd/version.txt`,
        ],
        hints: [
          'kubectl get crd lists every CRD; its name is <plural>.<group>.',
          'kubectl get crd <name> -o yaml shows spec.group, spec.scope and, per version, served and storage.',
          'kubectl api-resources --api-group=db.example.lab is another view of the same group.',
        ],
      }),
    },
    'explain-field': {
      label: 'Read a custom field with kubectl explain, then use it',
      make: ({ NS }) => {
        const token = 'cka-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d " \\n")';
        return {
          title: 'Document and use a custom field',
          text: `The CRD \`databases.db.example.lab\` is installed. On \`controlplane\`:

1. Write the documentation of field \`spec.backup.schedule\` of kind \`Database\`, as \`kubectl explain\` prints it, to \`/opt/course/crd/schedule.txt\`.
2. In namespace \`${NS}\` (create it if needed), create a \`Database\` named \`reports\` with \`3\` replicas and backups every day at 02:00 (\`0 2 * * *\`).`,
          setup: [
            `${courseDir('crd')}
token="${token}"
echo "$token" > /root/.cka-crd-token
kubectl delete crd databases.db.example.lab --ignore-not-found --wait=true >/dev/null
kubectl apply -f - <<EOF >/dev/null
${crd('databases', 'Database', 'db.example.lab', backupSchema('$token'))}
EOF
kubectl wait --for=condition=Established crd/databases.db.example.lab --timeout=60s >/dev/null`,
          ],
          checks: [
            onCp({
              id: 'explain',
              description: 'schedule.txt holds the kubectl explain output of spec.backup.schedule',
              run: `grep -q "$(cat /root/.cka-crd-token)" /opt/course/crd/schedule.txt 2>/dev/null && grep -qi 'schedule' /opt/course/crd/schedule.txt && echo ok || echo missing`,
              expect: { equals: 'ok' },
              weight: 3,
            }),
            {
              id: 'database',
              description: `Database reports in ${NS} has 3 replicas and backs up at 0 2 * * *`,
              type: 'kubectl',
              run: `kubectl -n ${NS} get databases.db.example.lab reports -o jsonpath='{.spec.replicas}|{.spec.backup.schedule}'`,
              expect: { equals: '3|0 2 * * *' },
              weight: 3,
            },
          ],
          solution: [
            `kubectl explain databases.spec.backup.schedule > /opt/course/crd/schedule.txt
kubectl create namespace ${NS} --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f - <<EOF
apiVersion: db.example.lab/v1
kind: Database
metadata:
  name: reports
  namespace: ${NS}
spec:
  replicas: 3
  backup:
    schedule: "0 2 * * *"
EOF`,
          ],
          hints: [
            'kubectl explain works for custom resources too, using the plural name or the kind: kubectl explain databases.spec.',
            'kubectl explain <resource>.<field>.<field> drills down one level at a time; --recursive shows the whole tree.',
            'The apiVersion of a custom object is <group>/<version>, as the CRD names them.',
          ],
        };
      },
    },
    'operator-chart': {
      label: 'Install an operator chart without its CRDs',
      make: ({ NS }) => ({
        title: 'Install an operator without its CRDs',
        text: `A Helm repository is served at \`http://controlplane:8879\`. Work on \`controlplane\` as user \`ubuntu\`.

1. Install chart \`db-operator\` version \`1.2.0\` from that repository as release \`db-operator\` in namespace \`operators\`, which does not exist yet. The cluster team manages CRDs separately: install the chart **without** its CRDs. CRD \`databases.db.example.lab\` is already installed.
2. Create a \`Database\` named \`orders\` in namespace \`${NS}\` (create it if needed) with \`spec.replicas: 2\`.`,
        setup: [
          `${chartRepo}
kubectl delete namespace operators --ignore-not-found --wait=true >/dev/null
kubectl delete crd backups.db.example.lab --ignore-not-found --wait=true >/dev/null
kubectl delete crd databases.db.example.lab --ignore-not-found --wait=true >/dev/null
kubectl apply -f - <<EOF >/dev/null
${crd('databases', 'Database', 'db.example.lab')}
EOF
kubectl wait --for=condition=Established crd/databases.db.example.lab --timeout=60s >/dev/null`,
        ],
        checks: [
          {
            id: 'release',
            description: 'release db-operator runs chart db-operator-1.2.0 in namespace operators',
            type: 'kubectl',
            run: `helm -n operators list -o json | jq -r '.[] | select(.name == "db-operator") | .status + "/" + .chart'`,
            expect: { equals: 'deployed/db-operator-1.2.0' },
            weight: 2,
          },
          {
            id: 'operator-ready',
            description: 'the operator Deployment is ready',
            type: 'kubectl',
            run: `kubectl -n operators get deployment db-operator -o jsonpath='{.status.readyReplicas}'`,
            expect: { equals: '1' },
            weight: 1,
            retrySeconds: 60,
          },
          {
            id: 'no-crds',
            description: 'the chart installed no CRD of its own (no backups.db.example.lab)',
            type: 'kubectl',
            run: `kubectl get crd backups.db.example.lab >/dev/null 2>&1 && echo installed || echo skipped`,
            expect: { equals: 'skipped' },
            weight: 1,
          },
          {
            id: 'database',
            description: `Database orders in ${NS} has 2 replicas`,
            type: 'kubectl',
            run: `kubectl -n ${NS} get databases.db.example.lab orders -o jsonpath='{.spec.replicas}'`,
            expect: { equals: '2' },
            weight: 2,
          },
        ],
        solution: [
          `${HELM} repo add lab http://controlplane:8879
${HELM} repo update lab
${HELM} install db-operator lab/db-operator --version 1.2.0 -n operators --create-namespace --skip-crds --wait --timeout 3m
kubectl create namespace ${NS} --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f - <<EOF
apiVersion: db.example.lab/v1
kind: Database
metadata:
  name: orders
  namespace: ${NS}
spec:
  replicas: 2
EOF`,
        ],
        hints: [
          'helm repo add <name> <url>, then helm search repo <name>/db-operator --versions.',
          'helm show chart and helm pull --untar let you look inside a chart before installing it; CRDs live in its crds/ directory.',
          'helm install has a flag that leaves the crds/ directory out.',
        ],
      }),
    },
  },
});
