#!/usr/bin/env bash
set -euo pipefail
rm -rf "${DATADIR}"
etcdutl snapshot restore "${SNAPSHOT}" --data-dir "${DATADIR}"
