## Solution

Block Public Access is the guard rail that overrides ACLs and policies, but it leaves the old grant in place; removing the grant too means nothing becomes public if someone later turns the guard rail off. SSE-KMS with a customer managed key gives you key policy control, rotation and an audit trail of key use; the Bucket Key cuts KMS requests (and their cost) by caching a bucket-level data key.

### Question 1: Close public access

```bash
aws s3api put-public-access-block --bucket records-${SUFFIX} \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-acl --bucket records-${SUFFIX} --acl private
```

### Question 2: Encrypt with your own KMS key

```bash
key=$(aws kms create-key --description "Records bucket" --query KeyMetadata.KeyId --output text)
aws kms create-alias --alias-name ${KEY_ALIAS} --target-key-id $key
aws kms enable-key-rotation --key-id $key
aws s3api put-bucket-encryption --bucket records-${SUFFIX} --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms","KMSMasterKeyID":"${KEY_ALIAS}"},"BucketKeyEnabled":true}]}'
```

### Question 3: Versioning and TLS only

```bash
aws s3api put-bucket-versioning --bucket records-${SUFFIX} --versioning-configuration Status=Enabled
cat > policy.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyInsecureTransport",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": ["arn:aws:s3:::records-${SUFFIX}", "arn:aws:s3:::records-${SUFFIX}/*"],
    "Condition": {"Bool": {"aws:SecureTransport": "false"}}
  }]
}
JSON
aws s3api put-bucket-policy --bucket records-${SUFFIX} --policy file://policy.json
```
