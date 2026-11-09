# Pods Pending on a zone topology spread

The Pod template sets a topology spread constraint on `topology.kubernetes.io/zone` with `whenUnsatisfiable: DoNotSchedule`, but no node carries that label, so Pods stay Pending. Remove `topologySpreadConstraints` (or switch `topologyKey` to a label that exists, such as `kubernetes.io/hostname`). Labelling the nodes would get the Pods running too, but the task says not to change any node, and a zone label should say where a node really is.
