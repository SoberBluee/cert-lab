const WAITING = 'ErrImagePull|ImagePullBackOff|CrashLoopBackOff|CreateContainerConfigError|CreateContainerError|RunContainerError';

/** One line per Pod: phase, Ready, PodScheduled, waiting reason, restart count. */
const podStates = (ns: string, selector: string) =>
  `kubectl -n "${ns}" get pods -l "${selector}" -o jsonpath='{range .items[*]}{.status.phase} {.status.conditions[?(@.type=="Ready")].status} {.status.conditions[?(@.type=="PodScheduled")].status} {.status.containerStatuses[0].state.waiting.reason} {.status.containerStatuses[0].restartCount}{"\\n"}{end}' 2>/dev/null`;

/**
 * Waits until a Pod matching the selector shows a symptom: a container error, a restart, a
 * scheduling failure, a failed mount, or Running without being Ready on three polls in a row.
 * Gives up quietly after maxS seconds; the caller then asserts the workload is still unhealthy.
 */
export const waitUnhealthy = (ns: string, selector: string, maxS = 20) => `notready=0
for _ in $(seq 1 ${Math.ceil(maxS / 2)}); do
  states="$(${podStates(ns, selector)})"
  if grep -qE '(${WAITING})|[1-9][0-9]*$|^[A-Za-z]+ [A-Za-z]* False' <<< "$states"; then break; fi
  if kubectl -n "${ns}" get events --field-selector reason=FailedMount -o name 2>/dev/null | grep -q .; then break; fi
  if grep -qE '^Running False' <<< "$states"; then
    notready=$((notready + 1))
    (( notready >= 3 )) && break
  else
    notready=0
  fi
  sleep 2
done`;
