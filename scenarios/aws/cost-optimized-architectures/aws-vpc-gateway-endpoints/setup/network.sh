#!/usr/bin/env bash
# An analytics VPC whose private subnets reach everything, S3 and DynamoDB included, through a NAT gateway.
set -euo pipefail
vpc=$(aws ec2 create-vpc --cidr-block 10.50.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=analytics-vpc}]' --query Vpc.VpcId --output text)
subnet() {
  aws ec2 create-subnet --vpc-id "$vpc" --cidr-block "$2" --availability-zone "$3" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$1}]" --query Subnet.SubnetId --output text
}
pa=$(subnet public-a 10.50.1.0/24 us-east-1a)
xa=$(subnet private-a 10.50.11.0/24 us-east-1a)
xb=$(subnet private-b 10.50.12.0/24 us-east-1b)
igw=$(aws ec2 create-internet-gateway --query InternetGateway.InternetGatewayId --output text)
aws ec2 attach-internet-gateway --internet-gateway-id "$igw" --vpc-id "$vpc"
rt=$(aws ec2 create-route-table --vpc-id "$vpc" \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=public-rt}]' --query RouteTable.RouteTableId --output text)
aws ec2 create-route --route-table-id "$rt" --destination-cidr-block 0.0.0.0/0 --gateway-id "$igw" >/dev/null
aws ec2 associate-route-table --route-table-id "$rt" --subnet-id "$pa" >/dev/null
eip=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
nat=$(aws ec2 create-nat-gateway --subnet-id "$pa" --allocation-id "$eip" --query NatGateway.NatGatewayId --output text)
prt=$(aws ec2 create-route-table --vpc-id "$vpc" \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=private-rt}]' --query RouteTable.RouteTableId --output text)
aws ec2 create-route --route-table-id "$prt" --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "$nat" >/dev/null
for s in "$xa" "$xb"; do aws ec2 associate-route-table --route-table-id "$prt" --subnet-id "$s" >/dev/null; done
