#!/usr/bin/env bash
set -euo pipefail
vpc=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=shop-vpc --query 'Vpcs[0].VpcId' --output text)
sg() { aws ec2 describe-security-groups --filters Name=vpc-id,Values="$vpc" Name=group-name,Values="$1" --query 'SecurityGroups[0].GroupId' --output text; }
web=$(sg web-sg); app=$(sg app-sg); db=$(sg db-sg)
aws ec2 revoke-security-group-ingress --group-id "$web" --protocol tcp --port 22 --cidr 0.0.0.0/0 >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$web" --protocol tcp --port 443 --cidr 0.0.0.0/0 >/dev/null
aws ec2 revoke-security-group-ingress --group-id "$app" --protocol tcp --port "${APP_PORT}" --cidr 0.0.0.0/0 >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$app" --protocol tcp --port "${APP_PORT}" --source-group "$web" >/dev/null
aws ec2 revoke-security-group-ingress --group-id "$db" --protocol tcp --port "${DB_PORT}" --cidr 10.30.0.0/16 >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$db" --protocol tcp --port "${DB_PORT}" --source-group "$app" >/dev/null
