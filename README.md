+++
markdown = 3000.0
+++

# discobeaver-3000 🏳️‍🌈

This public repository distributes encrypted secrets in one JSON file. Secret names are cleartext. Every value in `secrets.json` begins with `:` followed by Base64-encoded age ciphertext. Each value is encrypted independently for its approved recipients and an owner recovery key. Downloading the file does not grant decryption access.

## Decrypt an assigned value

Install age and Python 3. Obtain your private age key through a protected channel and keep it outside Git with mode `0600`. Download or clone this branch, then run the following from the checkout. Replace the key path and secret name with your assigned identity and an approved entry. Decrypted output goes into an owner-only file outside the checkout.

```sh
secret_name=GROK_REAL_NAME_3000
identity_file="${XDG_CONFIG_HOME:-$HOME/.config}/3000.amort.berlin/keys/GROK.agekey"
secret_dir="${XDG_CONFIG_HOME:-$HOME/.config}/3000.amort.berlin/retrieved"
(umask 077; mkdir -p "$secret_dir")
chmod 700 "$secret_dir"
export secret_name
set -o pipefail
python3 - <<'PYTHON' | (umask 077; age --decrypt -i "$identity_file" -o "$secret_dir/$secret_name")
import base64
import json
import os
import sys
with open("secrets.json") as source:
   value = json.load(source)[os.environ["secret_name"]]
if not isinstance(value, str) or not value.startswith(":"):
   raise SystemExit("Expected colon-prefixed encrypted value")
sys.stdout.buffer.write(base64.b64decode(value[1:], validate=True))
PYTHON
```

The consuming application should read the resulting credential file. Do not print decrypted values or commit private keys or plaintext output.

## GROK

GROK's public encryption key is `age18e5057elyprlt2p97uk4akyd8p9zyud33xlj0fs6fz6arsglkg3q8pcqve`. This public key can encrypt values for GROK; it cannot decrypt them. GROK's private key is distributed separately and is never published here.

GROK is a logical agent identity, not a Linux account. Its private key decrypts only these entries in this snapshot:

- `GROK_REAL_NAME_3000`
- `CLANKER_VON_WANKER_CLAIN_TO_FAME_300`
- `CLANKER_VON_WANKER_GERMAN_POSITION_TOKEN`

## Scopes and approval

Other keys are separated by credential scope within the `inference`, `books`, `wikidata`, `infrastructure`, `publishing`, and `terminal` groups. Distinct Wikidata accounts have separate keys. Unclassified and other identity entries are encrypted only for the owner recovery key. Group names and agent names confer no access; possession of a recipient's private key permits decryption of that recipient's values.

An agent requests access by giving its descriptive name, exact resource URI, required operations, and duration. After the owner's explicit approval, the owner encrypts the approved value for the agent's public key and publishes the updated file. A new agent key must be delivered through an authenticated protected channel. Approval popups, expiring grants, and automated key delivery are not implemented by this repository. Private keys currently remain in the owner's external local store; delivery to other environments requires their identities and assigned scopes. Agents sharing a Linux user can read keys accessible to that user unless isolated.

## Updating and revoking access

Keep source values, private keys, and the private scope catalog outside Git. To update an entry, encrypt its source bytes with age for its approved public keys, Base64-encode the ciphertext, prefix it with `:`, and replace that JSON value. A private key must never appear in this repository. The initial snapshot covers the 42 files in the owner's canonical secret directory; provider-managed browser and OAuth stores are not included.

Removing a recipient protects future versions only. Old ciphertext remains downloadable through Git history or saved copies. To revoke use of an existing credential, rotate or revoke it at its provider and publish its replacement for the remaining recipients. Static age keys and ciphertext do not enforce expiration or provide retrieval audits. Public filenames disclose credential names.

## Legacy code

The previous video analysis and extension branches were archived in the private `KarlAmort/berlin` repository under `legacy/`. This branch starts a new history containing only this README and the encrypted JSON file. Removing old branches does not erase previously downloaded code, GitHub caches, or pull-request references.

## Format

```json
{
   "SECRET_NAME": ":BASE64_AGE_CIPHERTEXT"
}
```

The colon is a format marker. Base64 is transport encoding. age provides recipient encryption. See the [age documentation](https://github.com/FiloSottile/age).
