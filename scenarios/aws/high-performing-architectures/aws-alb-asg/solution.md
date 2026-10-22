## Solution

The load balancer sits in the public subnets and the instances in the private application subnets, one of each per Availability Zone. The ELB health check type makes the Auto Scaling group replace an instance that is running but not serving; the grace period gives a new instance time to boot first. Target tracking is the simplest policy for "keep CPU around 50%": it adds and removes instances for you, with no alarms to manage.

```bash
vpc=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=web-vpc --query 'Vpcs[0].VpcId' --output text)
subnet() { aws ec2 describe-subnets --filters Name=vpc-id,Values=$vpc Name=tag:Name,Values=$1 --query 'Subnets[0].SubnetId' --output text; }
sg() { aws ec2 describe-security-groups --filters Name=vpc-id,Values=$vpc Name=group-name,Values=$1 --query 'SecurityGroups[0].GroupId' --output text; }
```

### Question 1: Load balancer

```bash
tg=$(aws elbv2 create-target-group --name app-tg --protocol HTTP --port ${APP_PORT} --target-type instance --vpc-id $vpc \
  --health-check-path ${HEALTH_PATH} --health-check-interval-seconds 15 --healthy-threshold-count 2 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
alb=$(aws elbv2 create-load-balancer --name web-alb --type application --scheme internet-facing \
  --subnets $(subnet public-a) $(subnet public-b) --security-groups $(sg alb-sg) \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
aws elbv2 create-listener --load-balancer-arn $alb --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=$tg
```

### Question 2: Auto Scaling group

```bash
aws ec2 create-launch-template --launch-template-name app-lt \
  --launch-template-data "{\"ImageId\":\"ami-0abcdef1234567891\",\"InstanceType\":\"t3.micro\",\"SecurityGroupIds\":[\"$(sg app-sg)\"]}"
aws autoscaling create-auto-scaling-group --auto-scaling-group-name app-asg \
  --launch-template LaunchTemplateName=app-lt,Version='$Default' \
  --min-size 2 --max-size 6 --desired-capacity 2 \
  --vpc-zone-identifier "$(subnet app-a),$(subnet app-b)" --target-group-arns $tg \
  --health-check-type ELB --health-check-grace-period 120
aws autoscaling put-scaling-policy --auto-scaling-group-name app-asg --policy-name cpu-50 \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{"PredefinedMetricSpecification":{"PredefinedMetricType":"ASGAverageCPUUtilization"},"TargetValue":50}'
```
