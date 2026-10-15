#!/usr/bin/env bash
# Prints "ok" when the Deployment runs the image of the security-approved revision ($Q2_TARGET) and is rolled out.
set -uo pipefail

want="nginx:1.2$((4 + Q2_TARGET))-alpine"
have="$(kubectl -n "$Q2_NS" get deployment "$Q2_DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].image}')"
status="$(kubectl -n "$Q2_NS" get deployment "$Q2_DEPLOY" -o jsonpath='{.status.updatedReplicas}/{.status.readyReplicas}/{.status.replicas}')"

if [[ "$have" == "$want" && "$status" == 3/3/3 ]]; then echo ok; else echo "image=$have status=$status"; fi
