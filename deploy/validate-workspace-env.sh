#!/bin/sh

set -eu

mode="${1:-}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
base_file="${script_dir}/.env"
mode_file="${script_dir}/.env.${mode}"

fail() {
    printf 'environment validation failed: %s\n' "$1" >&2
    exit 1
}

read_value() {
    file=$1
    key=$2
    awk -v wanted="$key" '
        index($0, "=") > 0 {
            current = substr($0, 1, index($0, "=") - 1)
            if (current == wanted) {
                print substr($0, index($0, "=") + 1)
                exit
            }
        }
    ' "$file"
}

require_value() {
    file=$1
    key=$2
    value=$(read_value "$file" "$key")
    [ -n "$value" ] || fail "$key must be set in $file"
}

case "$mode" in
    dev|prod) ;;
    *) fail "mode must be dev or prod" ;;
esac

[ -f "$base_file" ] || fail "missing $base_file"
[ -f "$mode_file" ] || fail "missing $mode_file"

# Mode presets are committed and must never become a second secret store.
if grep -Eq '^[A-Z0-9_]*(PASSWORD|SECRET|TOKEN|CREDENTIAL)[A-Z0-9_]*=' "$mode_file"; then
    fail "$mode_file must not contain secrets"
fi

require_value "$mode_file" SUB2API_WORKSPACE_MODE
require_value "$mode_file" SUB2API_WORKSPACE_IMAGE_TAG
require_value "$mode_file" SUB2API_WORKSPACE_BIND_HOST
require_value "$mode_file" SUB2API_WORKSPACE_SERVER_MODE
require_value "$mode_file" SUB2API_WORKSPACE_LOG_ENV
require_value "$mode_file" SUB2API_WORKSPACE_LOG_FORMAT
require_value "$mode_file" SUB2API_WORKSPACE_LOG_CALLER
require_value "$mode_file" SUB2API_WORKSPACE_FRONTEND_READ_ONLY

[ "$(read_value "$mode_file" SUB2API_WORKSPACE_MODE)" = "$mode" ] || fail "SUB2API_WORKSPACE_MODE must match $mode"

if [ "$mode" = "dev" ]; then
    [ "$(read_value "$mode_file" SUB2API_WORKSPACE_SERVER_MODE)" = "debug" ] || fail "dev server mode must be debug"
    [ "$(read_value "$mode_file" SUB2API_WORKSPACE_FRONTEND_READ_ONLY)" = "false" ] || fail "dev frontend read-only mode must be false"
    exit 0
fi

[ "$(read_value "$mode_file" SUB2API_WORKSPACE_BIND_HOST)" = "127.0.0.1" ] || fail "prod bind host must be 127.0.0.1"
[ "$(read_value "$mode_file" SUB2API_WORKSPACE_SERVER_MODE)" = "release" ] || fail "prod server mode must be release"
[ "$(read_value "$mode_file" SUB2API_WORKSPACE_LOG_ENV)" = "production" ] || fail "prod log environment must be production"
[ "$(read_value "$mode_file" SUB2API_WORKSPACE_LOG_FORMAT)" = "json" ] || fail "prod log format must be json"
[ "$(read_value "$mode_file" SUB2API_WORKSPACE_LOG_CALLER)" = "false" ] || fail "prod log caller must be false"
[ "$(read_value "$mode_file" SUB2API_WORKSPACE_FRONTEND_READ_ONLY)" = "true" ] || fail "prod frontend read-only mode must be true"

image_tag=$(read_value "$mode_file" SUB2API_WORKSPACE_IMAGE_TAG)
case "$image_tag" in
    latest|local|dev|prod) fail "prod IMAGE_TAG must be an immutable release identifier" ;;
esac

for key in DATABASE_PASSWORD REDIS_PASSWORD ADMIN_PASSWORD JWT_SECRET TOTP_ENCRYPTION_KEY; do
    require_value "$base_file" "$key"
done

database_password=$(read_value "$base_file" DATABASE_PASSWORD)
redis_password=$(read_value "$base_file" REDIS_PASSWORD)
admin_password=$(read_value "$base_file" ADMIN_PASSWORD)
jwt_secret=$(read_value "$base_file" JWT_SECRET)
totp_key=$(read_value "$base_file" TOTP_ENCRYPTION_KEY)

case "$database_password" in
    sub2api|password|123456|change_this_secure_password) fail "DATABASE_PASSWORD still uses a weak default" ;;
esac
case "$redis_password" in
    sub2api|password|123456|change_this_secure_password) fail "REDIS_PASSWORD still uses a weak default" ;;
esac
case "$admin_password" in
    admin|password|123456|change_this_secure_password) fail "ADMIN_PASSWORD still uses a weak default" ;;
esac

[ "${#admin_password}" -ge 16 ] || fail "ADMIN_PASSWORD must be at least 16 characters"
[ "${#jwt_secret}" -ge 64 ] || fail "JWT_SECRET must be at least 64 characters"
[ "${#totp_key}" -ge 64 ] || fail "TOTP_ENCRYPTION_KEY must be at least 64 characters"

if permission=$(stat -c '%a' "$base_file" 2>/dev/null); then
    : # GNU stat (Linux)
elif permission=$(stat -f '%Lp' "$base_file" 2>/dev/null); then
    : # BSD stat (macOS)
else
    fail "cannot determine $base_file permissions"
fi
[ "$permission" = "600" ] || fail "$base_file permissions must be 600"
