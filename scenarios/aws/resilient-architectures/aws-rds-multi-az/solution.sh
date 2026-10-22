#!/usr/bin/env bash
set -euo pipefail
vpc=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=data-vpc --query 'Vpcs[0].VpcId' --output text)
app=$(aws ec2 describe-security-groups --filters Name=vpc-id,Values="$vpc" Name=group-name,Values=app-sg --query 'SecurityGroups[0].GroupId' --output text)
db=$(aws ec2 create-security-group --vpc-id "$vpc" --group-name db-sg --description "MySQL from the app tier" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$db" --protocol tcp --port 3306 --source-group "$app" >/dev/null

subnet() { aws ec2 describe-subnets --filters Name=vpc-id,Values="$vpc" Name=tag:Name,Values="$1" --query 'Subnets[0].SubnetId' --output text; }
aws rds create-db-subnet-group --db-subnet-group-name db-subnets --db-subnet-group-description "Database subnets" \
  --subnet-ids "$(subnet db-a)" "$(subnet db-b)" >/dev/null

aws rds create-db-instance --db-instance-identifier "${DB_ID}" \
  --engine mysql --db-instance-class db.t3.micro --allocated-storage 20 \
  --master-username admin --master-user-password 'Choose-a-password-1' \
  --multi-az --db-subnet-group-name db-subnets --vpc-security-group-ids "$db" --no-publicly-accessible >/dev/null
