## Solution

Gateway endpoints are free and add a route for the service's prefix list to the chosen route tables, so traffic to S3 and DynamoDB stays on the AWS network and never touches the NAT gateway. The more specific prefix-list route wins over the `0.0.0.0/0` route to the NAT gateway, which keeps serving everything else. Every other service needs an interface endpoint (PrivateLink), which is billed per hour and per gigabyte.

```bash
vpc=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=analytics-vpc --query 'Vpcs[0].VpcId' --output text)
rt=$(aws ec2 describe-route-tables --filters Name=vpc-id,Values=$vpc Name=tag:Name,Values=private-rt --query 'RouteTables[0].RouteTableId' --output text)
for svc in s3 dynamodb; do
  aws ec2 create-vpc-endpoint --vpc-id $vpc --vpc-endpoint-type Gateway \
    --service-name com.amazonaws.us-east-1.$svc --route-table-ids $rt
done
```
