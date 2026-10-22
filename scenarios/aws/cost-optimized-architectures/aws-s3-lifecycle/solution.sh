#!/usr/bin/env bash
set -euo pipefail
cat > lifecycle.json <<JSON
{
  "Rules": [
    {
      "ID": "logs-tiering",
      "Status": "Enabled",
      "Filter": {"Prefix": "logs/"},
      "Transitions": [
        {"Days": ${IA_DAYS}, "StorageClass": "STANDARD_IA"},
        {"Days": ${GLACIER_DAYS}, "StorageClass": "GLACIER"}
      ],
      "Expiration": {"Days": ${EXPIRE_DAYS}}
    },
    {
      "ID": "cleanup",
      "Status": "Enabled",
      "Filter": {},
      "NoncurrentVersionExpiration": {"NoncurrentDays": 30},
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}
    }
  ]
}
JSON
aws s3api put-bucket-lifecycle-configuration --bucket "logs-${SUFFIX}" --lifecycle-configuration file://lifecycle.json >/dev/null
