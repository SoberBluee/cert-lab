# Add a logging sidecar

Update `/opt/course/${POD}.yaml`: add container `busybox` with `tail -f /var/log/elastic-app.log`, share an `emptyDir` at `/var/log` with `elastic-app`. `kubectl replace -f ... --force`.
