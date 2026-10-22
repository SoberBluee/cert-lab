#!/usr/bin/env bash
set -euo pipefail
vpc=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=analytics-vpc --query 'Vpcs[0].VpcId' --output text)
rt=$(aws ec2 describe-route-tables --filters Name=vpc-id,Values="$vpc" Name=tag:Name,Values=private-rt --query 'RouteTables[0].RouteTableId' --output text)
for svc in s3 dynamodb; do
  aws ec2 create-vpc-endpoint --vpc-id "$vpc" --vpc-endpoint-type Gateway \
    --service-name "com.amazonaws.us-east-1.$svc" --route-table-ids "$rt" >/dev/null
done
