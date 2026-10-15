#!/usr/bin/env bash
# Usage: cause.sh egress|api|service. Prints "found" when causes.txt names the fault rolled for that hop.
f=/opt/course/chain/causes.txt
[ -f "$f" ] || { echo missing; exit 0; }

case "$1" in
  egress)
    case "$DNS_FAULT" in
      no-dns | dns-port) re='(networkpolicy|netpol|egress).*(dns|53)|(dns|53).*(networkpolicy|netpol|egress)' ;;
      api-port) re='(networkpolicy|netpol|egress).*(8080|port)|(8080|port).*(networkpolicy|netpol|egress)' ;;
    esac ;;
  api)
    case "$API_FAULT" in
      secret-key) re='secretkeyref|api-token|secret.*key|key.*secret' ;;
      secret-name) re='secretkeyref|credentials|secret.*name|name.*secret' ;;
      image-tag) re='image|tag|1\.366|pull' ;;
    esac ;;
  service)
    case "$SVC_FAULT" in
      target-port) re='targetport|target port|api-http' ;;
      selector) re='selector|label|endpoint' ;;
      port) re='service.*(port|8080)|(port|8080).*service' ;;
    esac ;;
esac
grep -Eiq "$re" "$f" && echo found || echo missing
