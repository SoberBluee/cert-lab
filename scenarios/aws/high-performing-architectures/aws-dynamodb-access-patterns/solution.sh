#!/usr/bin/env bash
set -euo pipefail
aws dynamodb create-table --table-name "${TABLE}" \
  --attribute-definitions AttributeName=orderId,AttributeType=S AttributeName=customerId,AttributeType=S AttributeName=createdAt,AttributeType=S \
  --key-schema AttributeName=orderId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes 'IndexName=by-customer,KeySchema=[{AttributeName=customerId,KeyType=HASH},{AttributeName=createdAt,KeyType=RANGE}],Projection={ProjectionType=ALL}' >/dev/null
aws dynamodb wait table-exists --table-name "${TABLE}"
aws dynamodb update-time-to-live --table-name "${TABLE}" --time-to-live-specification Enabled=true,AttributeName=expiresAt >/dev/null
aws dynamodb update-continuous-backups --table-name "${TABLE}" --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null
