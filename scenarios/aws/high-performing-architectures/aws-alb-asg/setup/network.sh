#!/usr/bin/env bash
# The web VPC: public subnets for the load balancer, app subnets for the instances, and their security groups.
set -euo pipefail
vpc=$(aws ec2 create-vpc --cidr-block 10.40.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=web-vpc}]' --query Vpc.VpcId --output text)
subnet() {
  aws ec2 create-subnet --vpc-id "$vpc" --cidr-block "$2" --availability-zone "$3" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$1}]" --query Subnet.SubnetId --output text
}
pa=$(subnet public-a 10.40.1.0/24 us-east-1a)
pb=$(subnet public-b 10.40.2.0/24 us-east-1b)
subnet app-a 10.40.11.0/24 us-east-1a >/dev/null
subnet app-b 10.40.12.0/24 us-east-1b >/dev/null
igw=$(aws ec2 create-internet-gateway --query InternetGateway.InternetGatewayId --output text)
aws ec2 attach-internet-gateway --internet-gateway-id "$igw" --vpc-id "$vpc"
rt=$(aws ec2 create-route-table --vpc-id "$vpc" --query RouteTable.RouteTableId --output text)
aws ec2 create-route --route-table-id "$rt" --destination-cidr-block 0.0.0.0/0 --gateway-id "$igw" >/dev/null
for s in "$pa" "$pb"; do aws ec2 associate-route-table --route-table-id "$rt" --subnet-id "$s" >/dev/null; done
alb=$(aws ec2 create-security-group --vpc-id "$vpc" --group-name alb-sg --description "Load balancer" --query GroupId --output text)
app=$(aws ec2 create-security-group --vpc-id "$vpc" --group-name app-sg --description "Application servers" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$alb" --protocol tcp --port 80 --cidr 0.0.0.0/0 >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$app" --protocol tcp --port "$APP_PORT" --source-group "$alb" >/dev/null
