## Solution

A subnet is "public" only because its route table sends `0.0.0.0/0` to an internet gateway. A NAT gateway gives private subnets outbound access, and it must itself sit in a public subnet. One NAT gateway is enough here; for zone resilience in production you would run one per Availability Zone, each private subnet routing to the NAT gateway in its own zone.

### Question 1: VPC and subnets

```bash
vpc=$(aws ec2 create-vpc --cidr-block ${NET}.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=${VPC_NAME}}]' --query Vpc.VpcId --output text)
aws ec2 modify-vpc-attribute --vpc-id $vpc --enable-dns-hostnames '{"Value":true}'

subnet() {
  aws ec2 create-subnet --vpc-id $vpc --cidr-block $2 --availability-zone $3 \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$1}]" --query Subnet.SubnetId --output text
}
pa=$(subnet public-a ${NET}.1.0/24 us-east-1a)
pb=$(subnet public-b ${NET}.2.0/24 us-east-1b)
xa=$(subnet private-a ${NET}.11.0/24 us-east-1a)
xb=$(subnet private-b ${NET}.12.0/24 us-east-1b)
```

### Question 2: Internet access for the public subnets

```bash
igw=$(aws ec2 create-internet-gateway \
  --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=${VPC_NAME}-igw}]' \
  --query InternetGateway.InternetGatewayId --output text)
aws ec2 attach-internet-gateway --internet-gateway-id $igw --vpc-id $vpc

rt=$(aws ec2 create-route-table --vpc-id $vpc \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=public-rt}]' --query RouteTable.RouteTableId --output text)
aws ec2 create-route --route-table-id $rt --destination-cidr-block 0.0.0.0/0 --gateway-id $igw
aws ec2 associate-route-table --route-table-id $rt --subnet-id $pa
aws ec2 associate-route-table --route-table-id $rt --subnet-id $pb
aws ec2 modify-subnet-attribute --subnet-id $pa --map-public-ip-on-launch
aws ec2 modify-subnet-attribute --subnet-id $pb --map-public-ip-on-launch
```

### Question 3: Outbound-only internet for the private subnets

```bash
eip=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
nat=$(aws ec2 create-nat-gateway --subnet-id $pa --allocation-id $eip \
  --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=${VPC_NAME}-nat}]' --query NatGateway.NatGatewayId --output text)

prt=$(aws ec2 create-route-table --vpc-id $vpc \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=private-rt}]' --query RouteTable.RouteTableId --output text)
aws ec2 create-route --route-table-id $prt --destination-cidr-block 0.0.0.0/0 --nat-gateway-id $nat
aws ec2 associate-route-table --route-table-id $prt --subnet-id $xa
aws ec2 associate-route-table --route-table-id $prt --subnet-id $xb
```
