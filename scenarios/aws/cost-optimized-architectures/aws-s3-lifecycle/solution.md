## Solution

Lifecycle rules move data to cheaper storage classes as it cools and delete it when it is no longer needed. In a versioned bucket, noncurrent versions and incomplete multipart uploads are easy to forget and cost the same as live data. `put-bucket-lifecycle-configuration` replaces the entire configuration, so both rules go in one document.

```bash
cat > lifecycle.json <<'JSON'
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
aws s3api put-bucket-lifecycle-configuration --bucket logs-${SUFFIX} --lifecycle-configuration file://lifecycle.json
aws s3api get-bucket-lifecycle-configuration --bucket logs-${SUFFIX}
```
