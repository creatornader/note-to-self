#!/usr/bin/env bash
# Regenerates rage-produced ciphertext fixtures for the PWA crypto tests.
# Run from the repo root: scripts/generate-ciphertext-fixtures.sh
#
# The identity is pinned so the fixtures are reproducible. To rotate it,
# run `rage-keygen` and replace the IDENTITY and RECIPIENT constants below,
# then re-run this script.
set -euo pipefail

FIX="$(cd "$(dirname "$0")/.." && pwd)/web/test/fixtures/ciphertext"
mkdir -p "$FIX"

IDENTITY="AGE-SECRET-KEY-165DD2KMPNETXTLP8A7S7GUHDPFGXQR47UJFTKJXQ39KMWX09YJFQTT7WTE"
RECIPIENT="age125se5v8yqnpk20gvnflc9mcf4ncxt032e38qy8mf2q0wmtf2eayqqv0708"

cat > "$FIX/sample.identity" <<EOF
# created: pinned fixture for PWA crypto round-trip tests
# public key: $RECIPIENT
$IDENTITY
EOF

printf 'hello from rage fixtures, intended for PWA round-trip tests.\n' \
  > "$FIX/sample.plaintext.txt"

rage -r "$RECIPIENT" -o "$FIX/sample.age" "$FIX/sample.plaintext.txt"

echo "Wrote: $FIX/sample.identity sample.plaintext.txt sample.age"
