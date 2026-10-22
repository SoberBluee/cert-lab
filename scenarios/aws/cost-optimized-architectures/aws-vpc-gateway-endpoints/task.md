Batch jobs in the private subnets of `analytics-vpc` move terabytes a day to and from S3 and DynamoDB. All of it goes through the NAT gateway, which charges for every gigabyte it processes.

- Create **gateway VPC endpoints** for **S3** and **DynamoDB** in `analytics-vpc`, both attached to the route table `private-rt` that the private subnets use.
- Leave the route to the NAT gateway in place for the rest of the internet traffic.
