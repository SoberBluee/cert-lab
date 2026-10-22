## Solution

Referencing a security group instead of a CIDR is how the tiers are chained: membership, not IP addresses, decides who may connect, so the rule keeps working as instances come and go, and nothing outside the previous tier gets in. Remove a rule with `revoke-security-group-ingress` and the same arguments that created it.

```bash
vpc=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=shop-vpc --query 'Vpcs[0].VpcId' --output text)
sg() { aws ec2 describe-security-groups --filters Name=vpc-id,Values=$vpc Name=group-name,Values=$1 --query 'SecurityGroups[0].GroupId' --output text; }
web=$(sg web-sg); app=$(sg app-sg); db=$(sg db-sg)
```

### Question 1: Web tier

```bash
aws ec2 revoke-security-group-ingress --group-id $web --protocol tcp --port 22 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $web --protocol tcp --port 443 --cidr 0.0.0.0/0
```

### Question 2: Application tier

```bash
aws ec2 revoke-security-group-ingress --group-id $app --protocol tcp --port ${APP_PORT} --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $app --protocol tcp --port ${APP_PORT} --source-group $web
```

### Question 3: Database tier

```bash
aws ec2 revoke-security-group-ingress --group-id $db --protocol tcp --port ${DB_PORT} --cidr 10.30.0.0/16
aws ec2 authorize-security-group-ingress --group-id $db --protocol tcp --port ${DB_PORT} --source-group $app
```
