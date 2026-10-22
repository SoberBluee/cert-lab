#!/usr/bin/env bash
# A records bucket that someone made public to share a report.
set -euo pipefail
b="records-${SUFFIX}"
aws s3api create-bucket --bucket "$b" >/dev/null
printf 'patient,visit,amount\n1042,2026-07-01,180.00\n' | aws s3 cp - "s3://$b/reports/2026-q3.csv" >/dev/null
aws s3api put-bucket-acl --bucket "$b" --acl public-read
