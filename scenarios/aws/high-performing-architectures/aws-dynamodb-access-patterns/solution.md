## Solution

Design the keys from the queries: `orderId` alone serves "get by id"; a global secondary index keyed by `customerId` with `createdAt` as sort key serves "a customer's orders, newest first" (`--no-scan-index-forward`). On-demand capacity suits spiky, unpredictable traffic. TTL deletes expired items without consuming write capacity, and point-in-time recovery restores the table to any second in the last 35 days.

### Question 1: Table and index

```bash
aws dynamodb create-table --table-name ${TABLE} \
  --attribute-definitions AttributeName=orderId,AttributeType=S AttributeName=customerId,AttributeType=S AttributeName=createdAt,AttributeType=S \
  --key-schema AttributeName=orderId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes 'IndexName=by-customer,KeySchema=[{AttributeName=customerId,KeyType=HASH},{AttributeName=createdAt,KeyType=RANGE}],Projection={ProjectionType=ALL}'
```

Query it the second way:

```bash
aws dynamodb query --table-name ${TABLE} --index-name by-customer \
  --key-condition-expression 'customerId = :c' --expression-attribute-values '{":c":{"S":"c-42"}}' --no-scan-index-forward
```

### Question 2: Expire old orders and allow recovery

```bash
aws dynamodb update-time-to-live --table-name ${TABLE} --time-to-live-specification Enabled=true,AttributeName=expiresAt
aws dynamodb update-continuous-backups --table-name ${TABLE} --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true
```
