# Ciphertext fixtures

`sample.age` is a rage-produced ciphertext of `sample.plaintext.txt` for the
identity in `sample.identity`. The PWA `age-encryption` decrypt path must
recover the original bytes from this file. If it cannot, the two
implementations have drifted.

The identity is pinned for reproducibility. To rotate it (or regenerate the
ciphertext after any age format change), run from the repo root:

```sh
scripts/generate-ciphertext-fixtures.sh
```

The script pins the same identity by default. To use a fresh one, replace the
IDENTITY and RECIPIENT constants at the top of the script.
