#!/usr/bin/env bash
# Central payload/envelope release blocklist.
# Source this file from release packagers, auditors, verifiers, and CI gates.

RELEASE_PAYLOAD_RSYNC_EXCLUDES=(
  '.claude/'
  '.codex'
  '.codex/'
  '.env'
  '.env.*'
  '**/.env'
  '**/.env.*'
  '.token.env'
  '**/.token.env'
  '.tmp-*'
  '**/.tmp-*'
  '**/rpa-token.json'
  'core/rpa/config/rpa-token.json'
  'tests/rpa/config/rpa-token.json'
  'rpa/config/rpa-token.json'
  '**/*.bkp'
  '**/*.bak'
  '**/*.backup'
  'node_modules/'
  '**/node_modules/'
  'dumps/'
  '**/dumps/'
  'dump/'
  '**/dump/'
  'remote-dumps/'
  'remote-dumps2/'
  'backups/'
  '**/backups/'
  'backup/'
  '**/backup/'
  'tmp/'
  '**/tmp/'
  'tmp_*'
  '**/tmp_*'
  'playwright-report/'
  '**/playwright-report/'
  'test-results/'
  '**/test-results/'
  'videos/'
  '**/videos/'
  'traces/'
  '**/traces/'
  '.wwebjs_auth/'
  '.wwebjs_cache/'
  'api/data/wa_sessions/'
)

RELEASE_PAYLOAD_IMAGE_ALLOWED_PREFIXES=(
  'public/'
  'frontend/public/'
  'src/assets/'
  'frontend/src/assets/'
  'docs/'
  'branding/'
  'assets/release-approved/'
)

RELEASE_PAYLOAD_FORBIDDEN_REGEX=(
  '(^|/)rpa-token\.json$'
  '(^|/)\.env($|[./])'
  '(^|/)\.env\.[^/]+$'
  '(^|/)\.token\.env$'
  '(^|/)\.tmp-[^/]+$'
  '(^|/)\.claude($|/)'
  '(^|/)\.claude/settings\.local\.json$'
  '(^|/)\.claude/settings\.local\.json\.bkp$'
  '(^|/)\.claude/[^/]+\.bkp$'
  '(^|/)\.codex($|/)'
  '(^|/)node_modules/'
  '(^|/)(remote-)?dumps?($|/)'
  '(^|/)backups?($|/)'
  '(^|/)tmp($|/)'
  '(^|/)tmp_[^/]*($|/)'
  '(^|/)playwright-report/'
  '(^|/)test-results/'
  '(^|/)videos/'
  '(^|/)traces/'
  '\.trace\.zip$'
  '\.webm$'
  '\.har$'
  '\.(bkp|bak|backup)$'
  '(^|/)\.wwebjs_auth/'
  '(^|/)\.wwebjs_cache/'
  '(^|/)api/data/wa_sessions/'
  '(^|/)artifacts($|/)'
  '(^|/)debug($|/)'
  '(^|/)\.tmp($|/)'
  '(^|/)cache($|/)'
  '(^|/)caches($|/)'
)

release_payload_print_rsync_excludes() {
  printf '%s\n' "${RELEASE_PAYLOAD_RSYNC_EXCLUDES[@]}"
}

release_payload_scan_list() {
  local list_file="$1"
  local found=false
  local pattern matches
  local entry

  for pattern in "${RELEASE_PAYLOAD_FORBIDDEN_REGEX[@]}"; do
    matches="$(grep -E "$pattern" "$list_file" || true)"
    if [[ -n "$matches" ]]; then
      found=true
      printf 'FORBIDDEN_PATTERN=%s\n' "$pattern"
      printf '%s\n' "$matches"
    fi
  done

  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    if release_payload_is_runtime_image "$entry"; then
      found=true
      printf 'FORBIDDEN_CONTEXT=runtime-image-outside-approved-assets\n'
      printf '%s\n' "$entry"
    fi
  done < <(grep -Ei '\.(png|jpe?g|webp)$' "$list_file" || true)

  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    if release_payload_is_forbidden_runtime_dir_entry "$entry"; then
      found=true
      printf 'FORBIDDEN_CONTEXT=runtime-evidence-directory\n'
      printf '%s\n' "$entry"
    fi
  done < "$list_file"

  [[ "$found" == false ]]
}

release_payload_normalize_entry() {
  local entry="$1"
  entry="${entry#./}"
  entry="${entry#r-agent2/}"
  printf '%s\n' "$entry"
}

release_payload_is_allowed_image_asset() {
  local entry
  local prefix
  entry="$(release_payload_normalize_entry "$1")"
  for prefix in "${RELEASE_PAYLOAD_IMAGE_ALLOWED_PREFIXES[@]}"; do
    [[ "$entry" == "$prefix"* ]] && return 0
  done
  return 1
}

release_payload_is_runtime_image() {
  local entry="$1"
  [[ "$entry" =~ \.(png|PNG|jpe?g|JPE?G|webp|WEBP)$ ]] || return 1
  release_payload_is_allowed_image_asset "$entry" && return 1
  return 0
}

release_payload_is_forbidden_runtime_dir_entry() {
  local entry
  entry="$(release_payload_normalize_entry "$1")"

  case "$entry" in
    docs/*)
      return 1
      ;;
    screenshots/*|*/screenshots/*|screenshots|*/screenshots)
      return 0
      ;;
    playwright-report/*|*/playwright-report/*|playwright-report|*/playwright-report|\
    test-results/*|*/test-results/*|test-results|*/test-results|\
    traces/*|*/traces/*|traces|*/traces|\
    videos/*|*/videos/*|videos|*/videos|\
    artifacts/*|*/artifacts/*|artifacts|*/artifacts|\
    debug/*|*/debug/*|debug|*/debug|\
    tmp/*|*/tmp/*|tmp|*/tmp|\
    .tmp/*|*/.tmp/*|.tmp|*/.tmp|\
    cache/*|*/cache/*|cache|*/cache|\
    caches/*|*/caches/*|caches|*/caches)
      return 0
      ;;
  esac

  return 1
}

release_payload_remove_forbidden_from_tree() {
  local tree_root="$1"
  local rel
  local removed=0

  [[ -d "$tree_root" ]] || return 0

  while IFS= read -r -d '' file; do
    rel="${file#$tree_root/}"
    if release_payload_is_runtime_image "$rel"; then
      rm -f "$file"
      removed=$((removed + 1))
    fi
  done < <(find "$tree_root" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) -print0)

  while IFS= read -r -d '' dir; do
    rel="${dir#$tree_root/}"
    if release_payload_is_forbidden_runtime_dir_entry "$rel/"; then
      rm -rf "$dir"
      removed=$((removed + 1))
    fi
  done < <(find "$tree_root" -depth -type d \( \
    -name screenshots -o -name playwright-report -o -name test-results -o \
    -name traces -o -name videos -o -name artifacts -o -name debug -o \
    -name tmp -o -name .tmp -o -name cache -o -name caches \
  \) -print0)

  return 0
}

release_payload_validate_zip() {
  local zip_path="$1"
  local label="${2:-payload}"
  local list_file

  if [[ -z "$zip_path" || ! -f "$zip_path" ]]; then
    echo "Payload validation failed: $label zip not found: $zip_path" >&2
    return 1
  fi

  list_file="$(mktemp -t r-agent2-payload-list.XXXXXX)"
  unzip -Z1 "$zip_path" > "$list_file"

  if release_payload_scan_list "$list_file"; then
    rm -f "$list_file"
    return 0
  fi

  echo "Payload validation failed: forbidden entries in $label ($zip_path)" >&2
  rm -f "$list_file"
  return 1
}

release_envelope_validate_zip() {
  local zip_path="$1"
  local list_file
  local bad

  if [[ -z "$zip_path" || ! -f "$zip_path" ]]; then
    echo "Envelope validation failed: zip not found: $zip_path" >&2
    return 1
  fi

  list_file="$(mktemp -t r-agent2-envelope-list.XXXXXX)"
  unzip -Z1 "$zip_path" > "$list_file"

  bad="$(grep -Ev '^((r-agent2/)?$|(r-agent2/)?dist/$|(r-agent2/)?dist/(release|governance|signatures|verifier)/$|(r-agent2/)?dist/(release/[^/]+\.(payload\.zip|manifest\.json|zip)|governance/[^/]+\.json|signatures/[^/]+\.sig|verifier/[^/]+\.sh|verifier/verify-result\.json))$' "$list_file" || true)"
  if [[ -n "$bad" ]]; then
    echo "Envelope validation failed: unexpected entries:" >&2
    printf '%s\n' "$bad" | head -50 >&2
    rm -f "$list_file"
    return 1
  fi

  rm -f "$list_file"
  return 0
}
