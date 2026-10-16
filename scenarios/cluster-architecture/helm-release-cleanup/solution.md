## Solution

```bash
helm -n ${NS} list            # every release, in any status (Helm 4)
```

Helm 4 lists releases in every status by default; Helm 3 hid pending ones unless you passed `-a`, which Helm 4 removed.

### 1. Delete the old release

```bash
helm -n ${NS} uninstall ${OLD}
```

### 2. Upgrade to the newest chart

```bash
helm repo update
helm search repo lab/webapp --versions      # newest: 2.0.0
helm -n ${NS} upgrade ${UPG} lab/webapp     # no --version = newest
helm -n ${NS} list
```

### 3. Install with values

```bash
helm -n ${NS} install ${NEW} lab/webapp --version 1.0.0 --set replicaCount=2
```

### 4. Remove the stuck installs

```bash
helm -n ${NS} list            # look at the STATUS column
```

<!-- fault STUCK_KIND=pending-install -->
The installs were interrupted while Helm waited for their Pods. Helm had already stored the release as `pending-install`, so the record stays behind and blocks a new install under the same name.

```bash
helm -n ${NS} list --pending
# ${STUCK}     ... pending-install  webapp-1.0.0
# ${STUCK}-2   ... pending-install  webapp-1.0.0
```
<!-- /fault -->
<!-- fault STUCK_KIND=pending-upgrade -->
These releases installed fine, but an upgrade to 1.1.0 was interrupted while Helm waited for its Pods. The release record stays `pending-upgrade`, and every further `helm upgrade` fails with `another operation (install/upgrade/rollback) is in progress`.

```bash
helm -n ${NS} list --pending
# ${STUCK}     ... pending-upgrade  webapp-1.1.0
# ${STUCK}-2   ... pending-upgrade  webapp-1.1.0
```
<!-- /fault -->
<!-- fault STUCK_KIND=failed -->
These installs used `--wait` with a short timeout, and their image tag does not exist. The Pods never became ready, so Helm marked the releases `failed`. Read the STATUS column instead of just counting releases.

```bash
helm -n ${NS} list --failed
# ${STUCK}     ... failed  webapp-1.0.0
# ${STUCK}-2   ... failed  webapp-1.0.0
```
<!-- /fault -->

```bash
helm -n ${NS} uninstall ${STUCK} ${STUCK}-2
helm -n ${NS} list
```

Release records are Secrets of type `helm.sh/release.v1` in the release's namespace (`k -n ${NS} get secrets`). Uninstalling deletes them along with the objects the release created.
