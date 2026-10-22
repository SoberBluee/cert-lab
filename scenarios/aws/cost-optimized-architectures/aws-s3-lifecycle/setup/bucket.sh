#!/usr/bin/env bash
# A versioned log bucket that has only ever grown.
set -euo pipefail
b="logs-${SUFFIX}"
aws s3api create-bucket --bucket "$b" >/dev/null
aws s3api put-bucket-versioning --bucket "$b" --versioning-configuration Status=Enabled
for d in 2026-08-01 2026-09-01 2026-10-01; do
  printf '%s GET /checkout 200\n' "$d" | aws s3 cp - "s3://$b/logs/app/$d.log" >/dev/null
done
printf 'month,requests\n2026-09,1820450\n' | aws s3 cp - "s3://$b/reports/2026-09.csv" >/dev/null
