#!/usr/bin/env bash
# The application bucket, with data the role should and should not see, and an audit bucket.
set -euo pipefail
aws s3api create-bucket --bucket "app-${SUFFIX}" >/dev/null
aws s3api create-bucket --bucket "audit-${SUFFIX}" >/dev/null
printf 'month,total\n2026-09,48210\n' | aws s3 cp - "s3://app-${SUFFIX}/${PREFIX}/2026/summary.csv" >/dev/null
printf 'do not share\n' | aws s3 cp - "s3://app-${SUFFIX}/private/keys.txt" >/dev/null
printf 'audit entry\n' | aws s3 cp - "s3://audit-${SUFFIX}/2026/10/log.txt" >/dev/null
