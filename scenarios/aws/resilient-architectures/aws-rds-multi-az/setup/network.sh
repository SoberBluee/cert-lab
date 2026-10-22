#!/usr/bin/env bash
# The application network already exists: a VPC with app and database subnets in two zones, and app-sg.
set -euo pipefail
vpc=$(aws ec2 create-vpc --cidr-block 10.60.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=data-vpc}]' --query Vpc.VpcId --output text)
subnet() {
  aws ec2 create-subnet --vpc-id "$vpc" --cidr-block "$2" --availability-zone "$3" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$1}]" >/dev/null
}
subnet app-a 10.60.1.0/24 us-east-1a
subnet app-b 10.60.2.0/24 us-east-1b
subnet db-a 10.60.21.0/24 us-east-1a
subnet db-b 10.60.22.0/24 us-east-1b
aws ec2 create-security-group --vpc-id "$vpc" --group-name app-sg --description "Application servers" \
  --tag-specifications 'ResourceType=security-group,Tags=[{Key=Name,Value=app-sg}]' >/dev/null
