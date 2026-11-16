#!/usr/bin/env bash
# Regenerates the TLS fixtures used by the fake MySQL server's TLS tests.
# Needs OpenSSL >= 3.2 for `req -x509v1`; macOS /usr/bin/openssl is LibreSSL and cannot do it.
set -euo pipefail

OPENSSL="${OPENSSL:-/opt/homebrew/opt/openssl@3/bin/openssl}"
VALIDITY_DAYS=36500
RSA_KEY_BITS=2048
REQUIRED_OPENSSL_MAJOR=3
REQUIRED_OPENSSL_MINOR=2
SERVER_NAME_THAT_NEVER_MATCHES="not-this-host.invalid"

FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sqllumen-tls.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

fail() {
  echo "generate.sh: $1" >&2
  exit 1
}

require_openssl_with_x509v1() {
  local version_line
  version_line="$("$OPENSSL" version)" || fail "cannot run $OPENSSL"
  local version
  version="$(echo "$version_line" | awk '{print $2}')"
  local major="${version%%.*}"
  local rest="${version#*.}"
  local minor="${rest%%.*}"
  case "$version_line" in
    OpenSSL*) ;;
    *) fail "$OPENSSL is not OpenSSL ($version_line)" ;;
  esac
  if [ "$major" -lt "$REQUIRED_OPENSSL_MAJOR" ]; then
    fail "OpenSSL $REQUIRED_OPENSSL_MAJOR.$REQUIRED_OPENSSL_MINOR or newer is required, found $version"
  fi
  if [ "$major" -eq "$REQUIRED_OPENSSL_MAJOR" ] && [ "$minor" -lt "$REQUIRED_OPENSSL_MINOR" ]; then
    fail "OpenSSL $REQUIRED_OPENSSL_MAJOR.$REQUIRED_OPENSSL_MINOR or newer is required, found $version"
  fi
}

new_rsa_key() {
  "$OPENSSL" genpkey -algorithm RSA -pkeyopt "rsa_keygen_bits:$RSA_KEY_BITS" -out "$1" 2>/dev/null
}

write_config() {
  local config_path="$1"
  local common_name="$2"
  local extensions="$3"
  {
    echo "[req]"
    echo "distinguished_name = subject"
    echo "prompt = no"
    if [ -n "$extensions" ]; then
      echo "x509_extensions = certificate_extensions"
    fi
    echo "[subject]"
    echo "CN = $common_name"
    if [ -n "$extensions" ]; then
      echo "[certificate_extensions]"
      printf '%b\n' "$extensions"
    fi
  } > "$config_path"
}

CA_EXTENSIONS="basicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash"
SERVER_EXTENSIONS="basicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = DNS:$SERVER_NAME_THAT_NEVER_MATCHES\nsubjectKeyIdentifier = hash\nauthorityKeyIdentifier = keyid"
CLIENT_EXTENSIONS="basicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = clientAuth\nsubjectKeyIdentifier = hash\nauthorityKeyIdentifier = keyid"

make_certificate_authority() {
  local name="$1"
  local common_name="$2"
  write_config "$WORK_DIR/$name.cnf" "$common_name" "$CA_EXTENSIONS"
  new_rsa_key "$WORK_DIR/$name-key.pem"
  "$OPENSSL" req -x509 -new -config "$WORK_DIR/$name.cnf" -key "$WORK_DIR/$name-key.pem" \
    -days "$VALIDITY_DAYS" -out "$FIXTURE_DIR/$name.pem"
}

make_signed_certificate() {
  local name="$1"
  local authority="$2"
  local common_name="$3"
  local extensions="$4"
  write_config "$WORK_DIR/$name.cnf" "$common_name" "$extensions"
  new_rsa_key "$FIXTURE_DIR/$name-key.pem"
  "$OPENSSL" req -x509 -new -config "$WORK_DIR/$name.cnf" -key "$FIXTURE_DIR/$name-key.pem" \
    -CA "$FIXTURE_DIR/$authority.pem" -CAkey "$WORK_DIR/$authority-key.pem" \
    -days "$VALIDITY_DAYS" -out "$FIXTURE_DIR/$name.pem"
}

make_self_signed_v1_certificate() {
  local name="$1"
  write_config "$WORK_DIR/$name.cnf" "SqlLumen self-signed v1 server" ""
  new_rsa_key "$FIXTURE_DIR/$name-key.pem"
  "$OPENSSL" req -x509 -x509v1 -new -config "$WORK_DIR/$name.cnf" \
    -key "$FIXTURE_DIR/$name-key.pem" -days "$VALIDITY_DAYS" -out "$FIXTURE_DIR/$name.pem"
  if ! "$OPENSSL" x509 -noout -text -in "$FIXTURE_DIR/$name.pem" | grep -q "Version: 1 "; then
    fail "$name.pem is not an X.509 v1 certificate"
  fi
}

require_openssl_with_x509v1
make_certificate_authority "ca" "SqlLumen test CA"
make_signed_certificate "server" "ca" "SqlLumen test server" "$SERVER_EXTENSIONS"
make_signed_certificate "client" "ca" "SqlLumen test client" "$CLIENT_EXTENSIONS"
make_certificate_authority "other-ca" "SqlLumen unrelated CA"
make_signed_certificate "other-server" "other-ca" "SqlLumen unrelated server" "$SERVER_EXTENSIONS"
make_self_signed_v1_certificate "self-signed-v1"
echo "TLS fixtures written to $FIXTURE_DIR"
