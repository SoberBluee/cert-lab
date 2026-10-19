# Pod keeps crashing on busybox

Events show `exec: "/bin/bash": no such file`. busybox has `/bin/sh`. Recreate the Pod with `command: ["/bin/sh", "-c"]`.
