# Fix Pod memory request above limit

Edit `/opt/course/app-wl/${POD}.yaml`: set `requests.memory` to `100Mi` (or less). Keep `limits.memory: 100Mi`. Apply.
