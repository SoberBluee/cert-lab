#!/usr/bin/env bash
# A shop VPC whose security groups were opened up "temporarily" during a launch.
set -euo pipefail
vpc=$(aws ec2 create-vpc --cidr-block 10.30.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=shop-vpc}]' --query Vpc.VpcId --output text)
sg() {
  aws ec2 create-security-group --vpc-id "$vpc" --group-name "$1" --description "$2" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$1}]" --query GroupId --output text
}
web=$(sg web-sg "Load balancer")
app=$(sg app-sg "Application servers")
db=$(sg db-sg "Database")
aws ec2 authorize-security-group-ingress --group-id "$web" --protocol tcp --port 22 --cidr 0.0.0.0/0 >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$app" --protocol tcp --port "$APP_PORT" --cidr 0.0.0.0/0 >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$db" --protocol tcp --port "$DB_PORT" --cidr 10.30.0.0/16 >/dev/null
