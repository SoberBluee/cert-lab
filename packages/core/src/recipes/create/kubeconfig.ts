import { createNs, nameField, nsField } from '../types';
import { courseDir, onCp, taskBuilder } from './tasks';

const PKI = '/etc/kubernetes/pki';
/** Common Names the client certificates are made out to. */
const PEOPLE = 'alex.kim jo.park sam.ruiz lee.chen ana.silva mia.wong raj.patel tom.berg';

/** The task's folder on controlplane, as killer.sh gives each question its own. */
const dir = (task: string) => `/opt/course/kc/${task}`;
/** A root-only copy of a kubeconfig as set up: checks read their answers from it, whatever the learner did to the original. */
const pristine = (task: string, file = 'kubeconfig') => `/var/tmp/cka-kc-${task}-${file}`;

/**
 * Setup preamble: `sign <name> <subject> <days>` writes $work/<name>.crt and .key, signed by the
 * cluster CA; `kc <file> <args>` runs kubectl config on a kubeconfig file; $server is the real API server.
 */
const preamble = (task: string) => `${courseDir(`kc/${task}`)}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
sign() {
  openssl genrsa -out "$work/$1.key" 2048 2>/dev/null
  openssl req -new -key "$work/$1.key" -subj "$2" -out "$work/$1.csr" 2>/dev/null
  openssl x509 -req -in "$work/$1.csr" -CA ${PKI}/ca.crt -CAkey ${PKI}/ca.key -CAserial "$work/ca.srl" -CAcreateserial -days "$3" -out "$work/$1.crt" 2>/dev/null
}
kc() { local f=$1; shift; kubectl --kubeconfig "$f" config "$@" >/dev/null; }
server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')`;

/** Keeps root-only copies of the task's kubeconfig files and hands the folder to the learner. */
const finish = (task: string, files = ['kubeconfig']) => `${files.map((f) => `cp "${dir(task)}/${f}" "${pristine(task, f)}"\nchmod 600 "${pristine(task, f)}"`).join('\n')}
chown -R ubuntu:ubuntu /opt/course/kc`;

/** Embeds a cluster and a client certificate user signed by its CA, kubeadm style. */
const certUser = (file: string, user: string, cert: string) =>
  `kc "${file}" set-credentials "${user}" --client-certificate="$work/${cert}.crt" --client-key="$work/${cert}.key" --embed-certs=true`;
const realCluster = (file: string, name = 'kubernetes') => `kc "${file}" set-cluster ${name} --server="$server" --certificate-authority=${PKI}/ca.crt --embed-certs=true`;

/** A file's content without blanks, compared to `want`, a shell expression that must not be empty. */
const fileIs = (file: string, want: string) => `want=${want}; [ -n "$want" ] && [ "$(tr -d '[:space:]' < ${file} 2>/dev/null)" = "$want" ] && echo ok || echo "want $want"`;

/** A file's non-empty lines, blanks squeezed, compared as a set to the output lines of `want`. */
const linesAre = (file: string, want: string) =>
  `want=$(${want} | sort); have=$(sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//; /^$/d' ${file} 2>/dev/null | sort); [ -n "$want" ] && [ "$have" = "$want" ] && echo same || echo different`;

/** The user name the API server sees for a kubeconfig. */
const whoami = (args: string) => `kubectl ${args} auth whoami -o jsonpath='{.status.userInfo.username}' 2>/dev/null`;

/** Runs a kubeconfig as a copy in an empty folder, so it cannot lean on files next to it. */
const alone = (file: string, args = '') =>
  `t=$(mktemp -d); cp ${file} "$t/config" 2>/dev/null; have=$(cd "$t" && ${whoami(`--kubeconfig "$t/config" ${args}`.trim())}); rm -rf "$t"`;

/** Matches kubeconfig keys that point at a file instead of embedding its data. */
const FILE_KEYS = `'^[[:space:]]*(certificate-authority|client-certificate|client-key):'`;

const certOf = (cfg: string, user: string) =>
  `kubectl --kubeconfig ${cfg} config view --raw -o jsonpath='{.users[?(@.name=="${user}")].user.client-certificate-data}' | base64 -d`;

/** One attribute (CN, O) of a user's client certificate subject, one value per line. */
const subjectOf = (cfg: string, user: string, attr: string) =>
  `${certOf(cfg, user)} | openssl x509 -noout -subject -nameopt RFC2253 | sed 's/^subject=//' | tr ',' '\\n' | sed -n 's/^${attr}=//p'`;

/** The contexts of a kubeconfig whose user may delete Secrets in `ns`, one per line. */
const secretAdmins = (cfg: string, ns: string) =>
  `for c in $(kubectl --kubeconfig ${cfg} config get-contexts -o name); do if [ "$(kubectl --kubeconfig ${cfg} --context "$c" auth can-i delete secrets -n ${ns} 2>/dev/null)" = yes ]; then echo "$c"; fi; done`;

export const kubeconfigBuilder = taskBuilder({
  id: 'kubeconfig',
  name: 'Kubeconfig extraction',
  description:
    'Read servers, namespaces, identities, tokens and permissions out of a kubeconfig file, cut one context out of it, or merge two into one self-contained file.',
  domain: 'cluster-architecture',
  difficulty: 2,
  minutes: 6,
  points: 6,
  tags: ['kubeconfig', 'contexts', 'certificates', 'openssl', 'jsonpath', 'auth-can-i', 'auth-whoami'],
  track: 'cluster',
  fields: [
    nameField('USER', 'Kubeconfig user', ['dev-laptop', 'oncall', 'audit-bot', 'release-mgr', 'qa-runner', 'data-pipeline', 'sre-jump', 'billing-svc']),
    nameField('CTX', 'Context', ['prod-eu', 'prod-us', 'dev-sandbox', 'perf-lab', 'dr-east', 'edge-west', 'blue-team', 'research']),
    nsField(['payments', 'billing', 'checkout', 'inventory', 'reporting', 'identity', 'search', 'ledger']),
  ],
  tasks: {
    export: {
      label: "Read a context's server and namespace, and export it to its own kubeconfig",
      make: ({ USER, CTX, NS }) => {
        const d = dir('export');
        const o = pristine('export');
        return {
          title: `Export context ${CTX} from a kubeconfig`,
          text: `The kubeconfig file \`${d}/kubeconfig\` on \`controlplane\` holds several clusters, users and contexts. Do not change it.

1. Write the URL of the API server that context \`${CTX}\` connects to into \`${d}/server\`.
2. Write the namespace that context \`${CTX}\` works in by default into \`${d}/namespace\`.
3. Create \`${d}/${CTX}.conf\`: a kubeconfig that holds context \`${CTX}\` and nothing else but the cluster and user it needs, has it as its current context, and works on its own, every certificate and key embedded rather than read from a file.`,
          setup: [
            `${preamble('export')}
f=${d}/kubeconfig
sign target "/CN=$(shuf -e ${PEOPLE} -n 1)/O=developers" "$(shuf -i 90-400 -n 1)"
sign bot "/CN=deploy-bot/O=ci" 365
${realCluster('$f')}
kc "$f" set-cluster staging --server="https://192.0.2.$(shuf -i 10-250 -n 1):6443" --certificate-authority=${PKI}/ca.crt --embed-certs=true
kc "$f" set-cluster legacy --server="https://10.40.0.$(shuf -i 10-250 -n 1):$(shuf -e 443 8443 -n 1)" --insecure-skip-tls-verify=true
${certUser('$f', USER, 'target')}
${certUser('$f', 'deploy-bot', 'bot')}
kc "$f" set-credentials legacy-ops --token="$(openssl rand -hex 24)"
kc "$f" set-context staging-deploy --cluster=staging --user=deploy-bot --namespace=default
kc "$f" set-context "${CTX}" --cluster=kubernetes --user="${USER}" --namespace="${NS}"
kc "$f" set-context legacy-admin --cluster=legacy --user=legacy-ops --namespace=kube-system
kc "$f" set-context ci-deploy --cluster=kubernetes --user=deploy-bot --namespace=ci
kc "$f" use-context staging-deploy
${finish('export')}`,
          ],
          checks: [
            onCp({
              id: 'server',
              description: `server holds the API server URL of context ${CTX}`,
              run: fileIs(`${d}/server`, `$(kubectl --kubeconfig ${o} config view -o jsonpath='{.clusters[?(@.name=="kubernetes")].cluster.server}')`),
              expect: { equals: 'ok' },
              weight: 1,
            }),
            onCp({
              id: 'namespace',
              description: `namespace holds the default namespace of context ${CTX}`,
              run: fileIs(`${d}/namespace`, `$(kubectl --kubeconfig ${o} config view -o jsonpath='{.contexts[?(@.name=="${CTX}")].context.namespace}')`),
              expect: { equals: 'ok' },
              weight: 1,
            }),
            onCp({
              id: 'exported',
              description: `${CTX}.conf holds only context ${CTX}, current, with its cluster and user embedded`,
              run: `g=${d}/${CTX}.conf; echo "$(kubectl --kubeconfig $g config get-contexts -o name 2>/dev/null | xargs)|$(kubectl --kubeconfig $g config current-context 2>/dev/null)|$(kubectl --kubeconfig $g config view -o jsonpath='{range .clusters[*]}{.name},{end}{range .users[*]}{.name},{end}' 2>/dev/null)|$(grep -cE ${FILE_KEYS} $g 2>/dev/null)"`,
              expect: { equals: `${CTX}|${CTX}|kubernetes,${USER},|0` },
              weight: 2,
            }),
            onCp({
              id: 'works',
              description: `${CTX}.conf authenticates as the user of ${CTX}, copied away from every other file`,
              run: `${alone(`${d}/${CTX}.conf`)}; want=$(${whoami(`--kubeconfig ${o} --context ${CTX}`)}); [ -n "$want" ] && [ "$have" = "$want" ] && echo works || echo "is $have, want $want"`,
              expect: { equals: 'works' },
              weight: 2,
            }),
          ],
          solution: [
            `f=${d}/kubeconfig
# The context names its cluster; the cluster has the server.
cluster=$(kubectl --kubeconfig $f config view -o jsonpath="{.contexts[?(@.name==\\"${CTX}\\")].context.cluster}")
kubectl --kubeconfig $f config view -o jsonpath="{.clusters[?(@.name==\\"$cluster\\")].cluster.server}" > ${d}/server
kubectl --kubeconfig $f config view -o jsonpath="{.contexts[?(@.name==\\"${CTX}\\")].context.namespace}" > ${d}/namespace
kubectl --kubeconfig $f config view --minify --flatten --context ${CTX} > ${d}/${CTX}.conf
chown -R ubuntu:ubuntu ${d}`,
          ],
          hints: [
            'kubectl --kubeconfig <file> config get-contexts lists each context with its CLUSTER, AUTHINFO (user) and NAMESPACE. The server URL is in the clusters list.',
            'kubectl config view --minify keeps only the current context, its cluster and its user; --context picks which context that is.',
            'kubectl config view hides certificate data; --flatten embeds it, along with any certificate and key read from a file.',
          ],
        };
      },
    },
    identity: {
      label: "Read a user's identity, groups and expiry from its certificate, and decode its key",
      make: ({ USER, CTX, NS }) => {
        const d = dir('identity');
        const o = pristine('identity');
        return {
          title: `Identity of kubeconfig user ${USER}`,
          text: `The kubeconfig file \`${d}/kubeconfig\` on \`controlplane\` holds several users. Do not change it. For its user \`${USER}\`:

1. Write the user name the API server knows it by, the Common Name of its client certificate, into \`${d}/username\`.
2. Write the groups its client certificate puts it in, one per line, into \`${d}/groups\`.
3. Write the date and time its client certificate expires, as \`openssl\` prints it, into \`${d}/expiry\`.
4. Write its client key, decoded to PEM, into \`${d}/${USER}.key\`.`,
          setup: [
            `${preamble('identity')}
f=${d}/kubeconfig
read -r g1 g2 < <(shuf -e developers auditors on-call platform release-managers -n 2 | xargs)
sign target "/CN=$(shuf -e ${PEOPLE} -n 1)/O=$g1/O=$g2" "$(shuf -i 30-400 -n 1)"
sign bot "/CN=deploy-bot/O=ci" 365
sign viewer "/CN=$(shuf -e ${PEOPLE} -n 1)/O=readonly" "$(shuf -i 30-400 -n 1)"
${realCluster('$f')}
${certUser('$f', 'deploy-bot', 'bot')}
${certUser('$f', USER, 'target')}
${certUser('$f', 'viewer', 'viewer')}
kc "$f" set-context ci-deploy --cluster=kubernetes --user=deploy-bot --namespace=ci
kc "$f" set-context "${CTX}" --cluster=kubernetes --user="${USER}" --namespace="${NS}"
kc "$f" set-context read-only --cluster=kubernetes --user=viewer
kc "$f" use-context ci-deploy
${finish('identity')}`,
          ],
          checks: [
            onCp({
              id: 'username',
              description: `username holds the Common Name of ${USER}'s client certificate`,
              run: fileIs(`${d}/username`, `$(${subjectOf(o, USER, 'CN')})`),
              expect: { equals: 'ok' },
              weight: 1,
            }),
            onCp({
              id: 'groups',
              description: `groups lists the Organizations of ${USER}'s client certificate`,
              run: linesAre(`${d}/groups`, subjectOf(o, USER, 'O')),
              expect: { equals: 'same' },
              weight: 2,
            }),
            onCp({
              id: 'expiry',
              description: `expiry holds the date ${USER}'s client certificate expires`,
              run: `want=$(${certOf(o, USER)} | openssl x509 -noout -enddate | cut -d= -f2); [ -n "$want" ] && grep -qF "$want" ${d}/expiry 2>/dev/null && echo ok || echo "want $want"`,
              expect: { equals: 'ok' },
              weight: 1,
            }),
            onCp({
              id: 'key',
              description: `${USER}.key is the private key of ${USER}'s client certificate`,
              run: `k=$(openssl pkey -in ${d}/${USER}.key -pubout 2>/dev/null); c=$(${certOf(o, USER)} | openssl x509 -noout -pubkey 2>/dev/null); [ -n "$k" ] && [ "$k" = "$c" ] && echo matches || echo different`,
              expect: { equals: 'matches' },
              weight: 2,
            }),
          ],
          solution: [
            `f=${d}/kubeconfig
kubectl --kubeconfig $f config view --raw -o jsonpath="{.users[?(@.name==\\"${USER}\\")].user.client-certificate-data}" | base64 -d > ${d}/${USER}.crt
# RFC2253 prints the subject as O=...,O=...,CN=...: the CN is the user name, each O a group.
subject=$(openssl x509 -in ${d}/${USER}.crt -noout -subject -nameopt RFC2253 | sed 's/^subject=//' | tr ',' '\\n')
sed -n 's/^CN=//p' <<< "$subject" > ${d}/username
sed -n 's/^O=//p' <<< "$subject" > ${d}/groups
openssl x509 -in ${d}/${USER}.crt -noout -enddate | cut -d= -f2 > ${d}/expiry
kubectl --kubeconfig $f config view --raw -o jsonpath="{.users[?(@.name==\\"${USER}\\")].user.client-key-data}" | base64 -d > ${d}/${USER}.key
chown -R ubuntu:ubuntu ${d}`,
          ],
          hints: [
            'kubectl config view hides certificates and keys; --raw shows client-certificate-data and client-key-data, which base64 -d turns into PEM.',
            'openssl x509 -in <cert> -noout -subject -enddate: the subject\'s CN is the user name the API server sees, each O one of its groups.',
            'kubectl --context <context> auth whoami shows the user name and groups the API server derives from the certificate.',
          ],
        };
      },
    },
    'can-i': {
      label: "Find the context whose user may do something, and make it current",
      make: ({ NS }) => {
        const d = dir('can-i');
        const o = pristine('can-i');
        return {
          title: `Which context may delete Secrets in ${NS}`,
          text: `The kubeconfig file \`${d}/kubeconfig\` on \`controlplane\` has several contexts for namespace \`${NS}\`, each with its own user.

1. Write the name of the one context whose user may delete Secrets in namespace \`${NS}\` into \`${d}/context\`.
2. Write the user name the API server knows that context's user by into \`${d}/username\`.
3. Make that context the current context of \`${d}/kubeconfig\`. Change nothing else in the file, and do not change any RBAC object.`,
          setup: [
            `${preamble('can-i')}
${createNs(NS)}
f=${d}/kubeconfig
kubectl -n "${NS}" delete rolebinding secret-admin secret-reader viewer --ignore-not-found >/dev/null
kubectl -n "${NS}" delete role secret-admin secret-reader --ignore-not-found >/dev/null
read -r admin reader viewer < <(shuf -e amber cobalt jade -n 3 | xargs)
kubectl -n "${NS}" create role secret-admin --verb=get,list,delete --resource=secrets >/dev/null
kubectl -n "${NS}" create rolebinding secret-admin --role=secret-admin --user="$admin" >/dev/null
kubectl -n "${NS}" create role secret-reader --verb=get,list --resource=secrets >/dev/null
kubectl -n "${NS}" create rolebinding secret-reader --role=secret-reader --user="$reader" >/dev/null
kubectl -n "${NS}" create rolebinding viewer --clusterrole=view --user="$viewer" >/dev/null
${realCluster('$f')}
for c in amber cobalt jade; do
  sign "$c" "/CN=$c/O=${NS}-team" "$(shuf -i 90-400 -n 1)"
  kc "$f" set-credentials "$c" --client-certificate="$work/$c.crt" --client-key="$work/$c.key" --embed-certs=true
  kc "$f" set-context "${NS}-$c" --cluster=kubernetes --user="$c" --namespace="${NS}"
done
kc "$f" use-context "${NS}-$viewer"
${finish('can-i')}`,
          ],
          checks: [
            onCp({
              id: 'context',
              description: `context names the one context that may delete Secrets in ${NS}`,
              run: fileIs(`${d}/context`, `$(${secretAdmins(o, NS)})`),
              expect: { equals: 'ok' },
              weight: 3,
            }),
            onCp({
              id: 'username',
              description: "username holds the user name the API server sees for that context's user",
              run: `c=$(${secretAdmins(o, NS)}); ${fileIs(`${d}/username`, `$(${whoami(`--kubeconfig ${o} --context "$c"`)})`)}`,
              expect: { equals: 'ok' },
              weight: 1,
            }),
            onCp({
              id: 'current',
              description: 'that context is the current context of the kubeconfig',
              run: `c=$(${secretAdmins(o, NS)}); [ -n "$c" ] && [ "$(kubectl --kubeconfig ${d}/kubeconfig config current-context 2>/dev/null)" = "$c" ] && echo ok || echo "want $c"`,
              expect: { equals: 'ok' },
              weight: 1,
            }),
            onCp({
              id: 'unchanged',
              description: 'nothing else in the kubeconfig changed',
              run: `v() { kubectl --kubeconfig "$1" config view --raw -o json 2>/dev/null | jq -S 'del(."current-context")'; }; a=$(v ${d}/kubeconfig); [ -n "$a" ] && [ "$a" = "$(v ${o})" ] && echo same || echo changed`,
              expect: { equals: 'same' },
              weight: 1,
            }),
          ],
          solution: [
            `f=${d}/kubeconfig
# auth can-i asks as the user of the context given.
c=$(for c in $(kubectl --kubeconfig $f config get-contexts -o name); do
  if [ "$(kubectl --kubeconfig $f --context "$c" auth can-i delete secrets -n "${NS}")" = yes ]; then echo "$c"; fi
done)
echo "$c" > ${d}/context
kubectl --kubeconfig $f --context "$c" auth whoami -o jsonpath='{.status.userInfo.username}' > ${d}/username
kubectl --kubeconfig $f config use-context "$c"
chown -R ubuntu:ubuntu ${d}`,
          ],
          hints: [
            'kubectl --kubeconfig <file> --context <context> runs a command as that context\'s user.',
            `kubectl auth can-i delete secrets -n ${NS} answers yes or no for the user doing the asking; try it with every context.`,
            'kubectl auth whoami shows the user name the API server sees; kubectl config use-context changes the file\'s current-context.',
          ],
        };
      },
    },
    report: {
      label: 'Tabulate every context, and find the users that authenticate with a token',
      make: ({ USER, CTX, NS }) => {
        const d = dir('report');
        const o = pristine('report');
        return {
          title: 'Kubeconfig contexts and token users',
          text: `The kubeconfig file \`${d}/kubeconfig\` on \`controlplane\` holds several clusters, users and contexts. Do not change it.

1. Write one line per context into \`${d}/contexts.txt\`, as \`<context> <cluster> <user> <namespace>\`. Write \`default\` as the namespace of a context that sets none.
2. Write the names of the users that authenticate with a bearer token, one per line, into \`${d}/token-users\`.
3. Write the token of user \`${USER}\`, exactly as it is, into \`${d}/${USER}.token\`.`,
          setup: [
            `${preamble('report')}
f=${d}/kubeconfig
legacy=$(shuf -e legacy-ops monitoring-ro backup-svc -n 1)
sign bot "/CN=deploy-bot/O=ci" 365
sign viewer "/CN=$(shuf -e ${PEOPLE} -n 1)/O=readonly" 180
${realCluster('$f')}
kc "$f" set-cluster staging --server="https://192.0.2.$(shuf -i 10-250 -n 1):6443" --insecure-skip-tls-verify=true
kc "$f" set-cluster dr --server="https://10.50.$(shuf -i 1-200 -n 1).10:6443" --insecure-skip-tls-verify=true
kc "$f" set-credentials "${USER}" --token="$(openssl rand -hex 24)"
${certUser('$f', 'deploy-bot', 'bot')}
kc "$f" set-credentials "$legacy" --token="$(openssl rand -hex 24)"
${certUser('$f', 'viewer', 'viewer')}
kc "$f" set-context staging-deploy --cluster=staging --user=deploy-bot --namespace=default
kc "$f" set-context "${CTX}" --cluster=kubernetes --user="${USER}" --namespace="${NS}"
kc "$f" set-context dr-ops --cluster=dr --user="$legacy"
kc "$f" set-context read-only --cluster=kubernetes --user=viewer --namespace=kube-system
kc "$f" set-context ci-deploy --cluster=kubernetes --user=deploy-bot
kc "$f" use-context read-only
${finish('report')}`,
          ],
          checks: [
            onCp({
              id: 'contexts',
              description: 'contexts.txt gives the cluster, user and namespace of every context',
              run: linesAre(
                `${d}/contexts.txt`,
                `kubectl --kubeconfig ${o} config view -o jsonpath='{range .contexts[*]}{.name} {.context.cluster} {.context.user} {.context.namespace}{"\\n"}{end}' | awk '{print $1, $2, $3, (NF < 4 ? "default" : $4)}'`,
              ),
              expect: { equals: 'same' },
              weight: 3,
            }),
            onCp({
              id: 'token-users',
              description: 'token-users lists the users that authenticate with a token',
              run: linesAre(`${d}/token-users`, `kubectl --kubeconfig ${o} config view --raw -o jsonpath='{range .users[*]}{.name} {.user.token}{"\\n"}{end}' | awk 'NF == 2 {print $1}'`),
              expect: { equals: 'same' },
              weight: 2,
            }),
            onCp({
              id: 'token',
              description: `${USER}.token holds the token of user ${USER}`,
              run: fileIs(`${d}/${USER}.token`, `$(kubectl --kubeconfig ${o} config view --raw -o jsonpath='{.users[?(@.name=="${USER}")].user.token}')`),
              expect: { equals: 'ok' },
              weight: 1,
            }),
          ],
          solution: [
            `f=${d}/kubeconfig
kubectl --kubeconfig $f config view -o jsonpath='{range .contexts[*]}{.name} {.context.cluster} {.context.user} {.context.namespace}{"\\n"}{end}' | awk '{print $1, $2, $3, (NF < 4 ? "default" : $4)}' > ${d}/contexts.txt
# Without --raw, tokens show as REDACTED: still enough to tell token users apart.
kubectl --kubeconfig $f config view --raw -o jsonpath='{range .users[*]}{.name} {.user.token}{"\\n"}{end}' | awk 'NF == 2 {print $1}' > ${d}/token-users
kubectl --kubeconfig $f config view --raw -o jsonpath="{.users[?(@.name==\\"${USER}\\")].user.token}" > ${d}/${USER}.token
chown -R ubuntu:ubuntu ${d}`,
          ],
          hints: [
            'kubectl --kubeconfig <file> config get-contexts already prints NAME, CLUSTER, AUTHINFO and NAMESPACE columns; awk can reorder them.',
            'A token user has user.token; a certificate user has client-certificate-data. kubectl config view hides both, --raw shows them.',
            "jsonpath with range loops over a list: '{range .users[*]}{.name}{\"\\n\"}{end}'.",
          ],
        };
      },
    },
    merge: {
      label: 'Merge two kubeconfig files into one self-contained file',
      make: ({ USER, CTX, NS }) => {
        const d = dir('merge');
        const oa = pristine('merge', 'team-a.conf');
        const ob = pristine('merge', 'team-b.conf');
        return {
          title: 'Merge two kubeconfig files',
          text: `Two teams handed in kubeconfig files on \`controlplane\`: \`${d}/team-a.conf\` and \`${d}/team-b.conf\`.

1. Create \`${d}/merged.conf\`, a kubeconfig with every cluster, user and context of both files, and \`${CTX}\` as its current context.
2. \`merged.conf\` must work on its own: every certificate and key embedded in it, none read from another file.

Do not change anything else in \`${d}\`.`,
          setup: [
            `${preamble('merge')}
a=${d}/team-a.conf
b=${d}/team-b.conf
sign dev "/CN=$(shuf -e ${PEOPLE} -n 1)/O=developers" "$(shuf -i 90-400 -n 1)"
sign build "/CN=build-bot/O=ci" 365
# Team B points at certificate files instead of embedding them.
mkdir -p ${d}/certs
cp ${PKI}/ca.crt "$work/build.crt" "$work/build.key" ${d}/certs/
${realCluster('$a', 'prod')}
${certUser('$a', USER, 'dev')}
kc "$a" set-context team-a --cluster=prod --user="${USER}" --namespace=team-a
kc "$a" use-context team-a
kc "$b" set-cluster shared --server="$server" --certificate-authority=${d}/certs/ca.crt
kc "$b" set-cluster backup --server="https://192.0.2.$(shuf -i 10-250 -n 1):6443" --insecure-skip-tls-verify=true
kc "$b" set-credentials build-bot --client-certificate=${d}/certs/build.crt --client-key=${d}/certs/build.key
kc "$b" set-context team-b --cluster=shared --user=build-bot --namespace=team-b
# Its user is only defined in team A's file.
kc "$b" set-context "${CTX}" --cluster=shared --user="${USER}" --namespace="${NS}"
kc "$b" set-context backup --cluster=backup --user=build-bot
kc "$b" use-context team-b
${finish('merge', ['team-a.conf', 'team-b.conf'])}`,
          ],
          checks: [
            onCp({
              id: 'entries',
              description: 'merged.conf has every cluster, user and context of both files',
              run: `n='{range .clusters[*]}cluster/{.name}{"\\n"}{end}{range .users[*]}user/{.name}{"\\n"}{end}{range .contexts[*]}context/{.name}{"\\n"}{end}'; want=$(KUBECONFIG=${oa}:${ob} kubectl config view -o jsonpath="$n" | sort); have=$(kubectl --kubeconfig ${d}/merged.conf config view -o jsonpath="$n" 2>/dev/null | sort); [ -n "$want" ] && [ "$have" = "$want" ] && echo same || echo different`,
              expect: { equals: 'same' },
              weight: 2,
            }),
            onCp({
              id: 'current',
              description: `${CTX} is the current context of merged.conf`,
              run: `kubectl --kubeconfig ${d}/merged.conf config current-context 2>/dev/null`,
              expect: { equals: CTX },
              weight: 1,
            }),
            onCp({
              id: 'embedded',
              description: 'merged.conf reads no certificate or key from a file',
              run: `[ -s ${d}/merged.conf ] && ! grep -qE ${FILE_KEYS} ${d}/merged.conf && echo embedded || echo "reads files"`,
              expect: { equals: 'embedded' },
              weight: 1,
            }),
            onCp({
              id: 'works',
              description: `merged.conf authenticates through ${CTX}, copied away from every other file`,
              run: `${alone(`${d}/merged.conf`)}; want=$(KUBECONFIG=${oa}:${ob} ${whoami(`--context ${CTX}`)}); [ -n "$want" ] && [ "$have" = "$want" ] && echo works || echo "is $have, want $want"`,
              expect: { equals: 'works' },
              weight: 2,
            }),
          ],
          solution: [
            `# KUBECONFIG merges the files listed; --flatten embeds every file they point at.
KUBECONFIG=${d}/team-a.conf:${d}/team-b.conf kubectl config view --flatten > ${d}/merged.conf
kubectl --kubeconfig ${d}/merged.conf config use-context ${CTX}
chown -R ubuntu:ubuntu ${d}`,
          ],
          hints: [
            'KUBECONFIG takes a colon-separated list of files, which kubectl merges; kubectl config view shows the result.',
            'kubectl config view --flatten embeds certificate-authority, client-certificate and client-key files as their -data fields. Without --raw or --flatten, kubectl hides certificate data.',
            'A context can name a user from another file: once merged, it works.',
          ],
        };
      },
    },
  },
});
