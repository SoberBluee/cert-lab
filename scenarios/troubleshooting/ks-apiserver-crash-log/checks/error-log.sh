#!/usr/bin/env bash
# Prints "found" when the saved log line is the kube-apiserver's startup error for the rolled fault.
case "$API_FAULT" in
  authz-mode) word=RBACC ;;
  admission-plugin) word=PodNodeSelectors ;;
  unknown-flag) word=enable-bootstrap-token-authn ;;
esac
grep -qi -- "$word" /opt/course/1/apiserver-error.log 2>/dev/null && echo found || echo missing
