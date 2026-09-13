#!/usr/bin/env bash
# Push supabase/config.toml to the linked hosted project.
#
# Two things in the local config cannot go to a free-tier project:
#
#   [auth.email.template.*]  Supabase rejects template changes while the
#                            project uses the default email provider. Local
#                            keeps the template — that is how development gets
#                            a six-digit code instead of only a link.
#
#   [storage.vector]         Vector buckets are a Pro feature. The CLI ships
#                            `enabled = true` as a LOCAL default, so pushing
#                            the file unchanged asks a free-tier project to
#                            turn on something it cannot have and the whole
#                            push ends on a 402 — after the auth half has
#                            already been applied, which makes it look like
#                            nothing worked when in fact half of it did.
#
# Once custom SMTP is configured (which is needed anyway: the built-in sender
# allows a couple of emails an hour and is not meant for real use), delete the
# stripping below and push the config directly.
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP="$(mktemp)"
cp supabase/config.toml "$BACKUP"
trap 'cp "$BACKUP" supabase/config.toml; rm -f "$BACKUP"' EXIT

python3 - <<'PY'
import re
path = "supabase/config.toml"
text = open(path, encoding="utf-8").read()
# Drop every [auth.email.template.*] block up to the next top-level table.
text = re.sub(
    r"^\[auth\.email\.template\.[^\]]+\]\n(?:(?!^\[).*\n)*",
    "",
    text,
    flags=re.M,
)
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
