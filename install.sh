#!/bin/sh
# Interstage installer: a thin wrapper around `omp plugin`.
# Adds the Interstage marketplace, then installs the core plugin and any
# chosen packs at user scope. It writes only through omp (under ~/.omp) and
# does no network access of its own.
set -eu

MARKETPLACE=interstage
DEFAULT_SOURCE=junkert/interstage
KNOWN_PACKS="observability web data ops forge"
DEVELOPED_AGAINST=18.11.3

usage() {
  cat <<'EOF'
Usage: install.sh [options] [SOURCE]

Installs the Interstage core plugin (and optional packs) into OMP.

SOURCE is where the marketplace comes from:
  owner/repo   a GitHub repository (default: junkert/interstage)
  PATH         a local clone (relative paths are made absolute), works offline

Options:
  --packs a,b    also install packs: observability, web, data, ops, forge
  --all-packs    install every pack
  --dry-run      show what would happen; changes nothing
  --uninstall    remove the core plugin, all installed packs and the marketplace
  -h, --help     show this help

Re-running is safe: an existing marketplace is refreshed and installed
plugins are upgraded.
EOF
}

die() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

say() {
  printf '%s\n' "$*"
}

packs=""
source_arg=""
dry_run=0
uninstall=0

while [ $# -gt 0 ]; do
  case $1 in
    -h | --help)
      usage
      exit 0
      ;;
    --dry-run) dry_run=1 ;;
    --uninstall) uninstall=1 ;;
    --all-packs) packs=$KNOWN_PACKS ;;
    --packs)
      [ $# -ge 2 ] || die "--packs needs a comma-separated list"
      packs=$(printf '%s' "$2" | tr ',' ' ')
      shift
      ;;
    --packs=*) packs=$(printf '%s' "${1#--packs=}" | tr ',' ' ') ;;
    -*) die "unknown option: $1 (see --help)" ;;
    *)
      [ -z "$source_arg" ] || die "only one SOURCE may be given"
      source_arg=$1
      ;;
  esac
  shift
done

for pack in $packs; do
  case " $KNOWN_PACKS " in
    *" $pack "*) ;;
    *) die "unknown pack: $pack (known: $KNOWN_PACKS)" ;;
  esac
done

command -v omp >/dev/null 2>&1 || die "omp is not on PATH; install OMP first"

omp_version=$(omp --version 2>/dev/null | sed -n 's|^omp/||p')
[ -n "$omp_version" ] || die "could not read the omp version from 'omp --version'"
say "omp $omp_version found (Interstage was developed against $DEVELOPED_AGAINST)"

# Older than the development version: warn only, never block.
oldest=$(printf '%s\n%s\n' "$DEVELOPED_AGAINST" "$omp_version" | sort -t. -k1,1n -k2,2n -k3,3n | sed -n 1p)
if [ "$oldest" != "$DEVELOPED_AGAINST" ]; then
  say "note: this omp is older than $DEVELOPED_AGAINST; that combination is untested"
fi

# A path that exists locally is a local source and must be absolute for omp.
source=${source_arg:-$DEFAULT_SOURCE}
if [ -d "$source" ]; then
  source=$(cd "$source" && pwd)
fi

marketplace_present() {
  omp plugin marketplace list 2>/dev/null | grep -q "^  $MARKETPLACE  "
}

plugin_installed() {
  omp plugin list 2>/dev/null | grep -q "^  $1@$MARKETPLACE "
}

# omp's marketplace add ignores --dry-run, so it is only ever printed.
add_marketplace() {
  if marketplace_present; then
    say "marketplace '$MARKETPLACE' already added; refreshing"
    if [ "$dry_run" -eq 1 ]; then
      say "[dry-run] Would run: omp plugin marketplace update"
    else
      omp plugin marketplace update
    fi
  elif [ "$dry_run" -eq 1 ]; then
    say "[dry-run] Would run: omp plugin marketplace add $source"
  else
    omp plugin marketplace add "$source"
  fi
}

install_plugin() {
  id=$1@$MARKETPLACE
  if plugin_installed "$1"; then
    say "$id already installed; upgrading"
    if [ "$dry_run" -eq 1 ]; then
      omp plugin upgrade --dry-run "$id"
    else
      omp plugin upgrade "$id"
    fi
  elif [ "$dry_run" -eq 1 ] && ! marketplace_present; then
    say "[dry-run] Would install $id"
  elif [ "$dry_run" -eq 1 ]; then
    omp plugin install --dry-run "$id"
  else
    omp plugin install "$id"
  fi
}

uninstall_all() {
  names=interstage
  for pack in $KNOWN_PACKS; do
    names="$names interstage-$pack"
  done
  for name in $names; do
    if plugin_installed "$name"; then
      if [ "$dry_run" -eq 1 ]; then
        omp plugin uninstall --dry-run "$name@$MARKETPLACE"
      else
        omp plugin uninstall "$name@$MARKETPLACE"
      fi
    else
      say "$name@$MARKETPLACE not installed; skipping"
    fi
  done
  if marketplace_present; then
    if [ "$dry_run" -eq 1 ]; then
      say "[dry-run] Would run: omp plugin marketplace remove $MARKETPLACE"
    else
      omp plugin marketplace remove "$MARKETPLACE"
    fi
  else
    say "marketplace '$MARKETPLACE' not configured; skipping"
  fi
}

if [ "$uninstall" -eq 1 ]; then
  uninstall_all
  if [ "$dry_run" -eq 1 ]; then
    say "Dry run complete; nothing was changed."
  else
    say "Interstage uninstalled."
  fi
  exit 0
fi

add_marketplace
install_plugin interstage
for pack in $packs; do
  install_plugin "interstage-$pack"
done

if [ "$dry_run" -eq 1 ]; then
  say "Dry run complete; nothing was changed."
  exit 0
fi

cat <<'EOF'

Interstage is installed. Next steps:
  omp --interstage      start OMP with the Interstage persona and agents
  /interstage:init      run inside that session to set up the project
EOF
