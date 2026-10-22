#!/usr/bin/env bash
set -euo pipefail
cat > trust.json <<'JSON'
{"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole"}]}
JSON
aws iam create-role --role-name "${ROLE}" --assume-role-policy-document file://trust.json >/dev/null
cat > policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::app-${SUFFIX}/${PREFIX}/*"},
    {"Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::app-${SUFFIX}"}
  ]
}
JSON
aws iam put-role-policy --role-name "${ROLE}" --policy-name "read-${PREFIX}" --policy-document file://policy.json
aws iam create-instance-profile --instance-profile-name "${ROLE}-profile" >/dev/null
aws iam add-role-to-instance-profile --instance-profile-name "${ROLE}-profile" --role-name "${ROLE}"
