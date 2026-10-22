## Solution

SNS to SQS fan-out decouples the producer from each consumer: every queue gets its own copy and drains at its own pace. The dead-letter queue catches poison messages after `maxReceiveCount` attempts; keep its retention longer than the source queues' so nothing expires before you look at it.

### Question 1: Queues with a dead-letter queue

```bash
dlq=$(aws sqs create-queue --queue-name orders-dlq --attributes MessageRetentionPeriod=1209600 --query QueueUrl --output text)
dlq_arn=$(aws sqs get-queue-attributes --queue-url $dlq --attribute-names QueueArn --query Attributes.QueueArn --output text)

cat > attrs.json <<JSON
{
  "VisibilityTimeout": "60",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"$dlq_arn\",\"maxReceiveCount\":\"${MAX_RECEIVES}\"}"
}
JSON
aws sqs create-queue --queue-name billing --attributes file://attrs.json
aws sqs create-queue --queue-name shipping --attributes file://attrs.json
```

### Question 2: Fan out from one topic

```bash
topic=$(aws sns create-topic --name ${TOPIC} --query TopicArn --output text)
for q in billing shipping; do
  url=$(aws sqs get-queue-url --queue-name $q --query QueueUrl --output text)
  arn=$(aws sqs get-queue-attributes --queue-url $url --attribute-names QueueArn --query Attributes.QueueArn --output text)
  policy=$(printf '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"sns.amazonaws.com"},"Action":"sqs:SendMessage","Resource":"%s","Condition":{"ArnEquals":{"aws:SourceArn":"%s"}}}]}' $arn $topic)
  python3 -c 'import json, sys; print(json.dumps({"Policy": sys.argv[1]}))' "$policy" > policy-attrs.json
  aws sqs set-queue-attributes --queue-url $url --attributes file://policy-attrs.json
  aws sns subscribe --topic-arn $topic --protocol sqs --notification-endpoint $arn --attributes RawMessageDelivery=true
done
```
