## Solution

A role has two policies: the trust policy (who may assume it) and permission policies (what it may do). EC2 instances use a role through an instance profile, and the SDKs on the instance pick up temporary credentials from the instance metadata service, so no access keys ever sit on disk. Least privilege means naming the exact actions and resources: object actions on `bucket/prefix/*`, `s3:ListBucket` on the bucket itself.

### Question 1: A role that EC2 can assume

```bash
cat > trust.json <<'JSON'
{"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole"}]}
JSON
aws iam create-role --role-name ${ROLE} --assume-role-policy-document file://trust.json
```

### Question 2: Read one prefix, nothing more

```bash
cat > policy.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::app-${SUFFIX}/${PREFIX}/*"},
    {"Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::app-${SUFFIX}"}
  ]
}
JSON
aws iam put-role-policy --role-name ${ROLE} --policy-name read-${PREFIX} --policy-document file://policy.json
aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::$AWS_ACCOUNT_ID:role/${ROLE} \
  --action-names s3:GetObject s3:PutObject --resource-arns arn:aws:s3:::app-${SUFFIX}/${PREFIX}/a.csv
```

To go further, add a `Condition` on `s3:prefix` to the `s3:ListBucket` statement so the role can only list `${PREFIX}/`.

### Question 3: Instance profile

```bash
aws iam create-instance-profile --instance-profile-name ${ROLE}-profile
aws iam add-role-to-instance-profile --instance-profile-name ${ROLE}-profile --role-name ${ROLE}
```
