#!/usr/bin/env bash
set -euo pipefail

kubectl -n "$NS" create serviceaccount "$SA"
kubectl -n "$NS" create role "$SA-role" --verb=get,list,watch --resource="$RESOURCE"
kubectl -n "$NS" create rolebinding "$SA-binding" --role="$SA-role" --serviceaccount="$NS:$SA"
