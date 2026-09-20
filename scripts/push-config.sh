#!/usr/bin/env bash
# Push supabase/config.toml to the linked hosted project.
#
# One thing in the local config still cannot go to a free-tier project:
#
#   [storage.vector]         Vector buckets are a Pro feature. The CLI ships
#                            `enabled = true` as a LOCAL default, so pushing
#                            the file unchanged asks a free-tier project to
#                            turn on something it cannot have and the whole
#                            push ends on a 402 — after the auth half has
#                            already been applied, which makes it look like
#                            nothing worked when in fact half of it did.
#
# [auth.email.template.*] used to be stripped here too, because Supabase
# refuses template changes while a project uses the default email provider.
# Custom SMTP via Resend was enabled on 2026-09-20, which is exactly what
# lifts that refusal, so the templates now push and hosted sign-in email
# carries the six-digit code rather than only a link.
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP="$(mktemp)"
cp supabase/config.toml "$BACKUP"
trap 'cp "$BACKUP" supabase/config.toml; rm -f "$BACKUP"' EXIT

python3 - <<'PY'
import re
path = "supabase/config.toml"
text = open(path, encoding="utf-8").read()
# And turn vector buckets off for the push. Local keeps them on; a free-tier
# project refuses them with a 402 and aborts the rest of the push.
text = re.sub(
    r"^(\[storage\.vector\]\n(?:(?!^\[).*\n)*?enabled = )true$",
    r"\1false",
    text,
    flags=re.M,
)
open(path, "w", encoding="utf-8").write(text)
PY

supabase config push "$@"
