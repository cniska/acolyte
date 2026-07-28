#!/usr/bin/env bash
set -euo pipefail

# Validate a commit identity against project conventions.
# Usage: check-commit-author.sh <name> <email> [role]
#
# Rules:
#   - Name and email must be non-empty and not placeholders
#   - Email must not use a reserved placeholder domain (RFC 2606, RFC 6761):
#     example.com/.net/.org, *.example, *.invalid, *.test, *.localhost, localhost
#   - Email must look like local@domain.tld

name="${1:-}"
email="${2:-}"
role="${3:-author}"

if [ "$#" -lt 2 ]; then
  echo "usage: check-commit-author.sh <name> <email> [role]" >&2
  exit 2
fi

if [ -z "$name" ]; then
  echo "error: commit $role name is empty." >&2
  exit 1
fi

lower_name=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')
case "$lower_name" in
  "your name" | "yourname" | "test user")
    echo "error: commit $role name is a placeholder: $name" >&2
    echo "  set a real identity: git config user.name / git config user.email" >&2
    exit 1
    ;;
esac

if [ -z "$email" ]; then
  echo "error: commit $role email is empty." >&2
  exit 1
fi

lower_email=$(printf '%s' "$email" | tr '[:upper:]' '[:lower:]')
domain="${lower_email##*@}"

if ! [[ "$lower_email" =~ ^[^@[:space:]]+@([[:alnum:]]([[:alnum:]-]*[[:alnum:]])?\.)+[[:alnum:]]([[:alnum:]-]*[[:alnum:]])?$ ]] && [ "$domain" != "localhost" ]; then
  echo "error: commit $role email is not a valid address: $email" >&2
  exit 1
fi

if [[ "$domain" == *"xn--"* ]] && ! bun -e 'import { domainToUnicode } from "node:url"; if (!domainToUnicode(process.argv[1])) process.exit(1)' "$domain"; then
  echo "error: commit $role email is not a valid address: $email" >&2
  exit 1
fi

placeholder=0
case "$domain" in
  example.com | example.net | example.org | localhost) placeholder=1 ;;
  *.example.com | *.example.net | *.example.org) placeholder=1 ;;
  *.example | *.invalid | *.test | *.localhost) placeholder=1 ;;
esac

if [ "$placeholder" -eq 1 ]; then
  echo "error: commit $role email uses a reserved placeholder domain: $email" >&2
  echo "  set a real identity: git config user.name / git config user.email" >&2
  exit 1
fi
