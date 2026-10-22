#!/usr/bin/env bash
set -euo pipefail
b="records-${SUFFIX}"
aws s3api put-public-access-block --bucket "$b" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-acl --bucket "$b" --acl private

key=$(aws kms create-key --description "Records bucket" --query KeyMetadata.KeyId --output text)
aws kms create-alias --alias-name "${KEY_ALIAS}" --target-key-id "$key"
aws kms enable-key-rotation --key-id "$key"
aws s3api put-bucket-encryption --bucket "$b" --server-side-encryption-configuration \
  "{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":{\"SSEAlgorithm\":\"aws:kms\",\"KMSMasterKeyID\":\"${KEY_ALIAS}\"},\"BucketKeyEnabled\":true}]}"

aws s3api put-bucket-versioning --bucket "$b" --versioning-configuration Status=Enabled
cat > policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyInsecureTransport",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": ["arn:aws:s3:::$b", "arn:aws:s3:::$b/*"],
    "Condition": {"Bool": {"aws:SecureTransport": "false"}}
  }]
}
JSON
aws s3api put-bucket-policy --bucket "$b" --policy file://policy.json
