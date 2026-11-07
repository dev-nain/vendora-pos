#!/usr/bin/env bash
# Screenshot capture and hosting for ticket-loop PRs.
#
#   screenshots.sh capture <out_dir> <shots_file>
#       Builds the app, launches Electron against a throwaway profile with
#       remote debugging, captures every shot over CDP, then quits.
#       shots_file lines: name|route|WIDTHxHEIGHT|light|dark[|as=<user>][|fixture=sale][|pdf=<file>][|js=<expr>]
#         login|/|1366x768|light
#         shell-dark|/|1366x768|dark|as=owner
#         approval|/|1366x768|light|as=cashier|js=<renderer expression>
#       route is applied as location.hash; "/" leaves the start screen.
#       as= signs in as a dev fixture user from src/main/db/dev-users.ts (its
#       password is looked up there); a shot without as= is taken signed out.
#       js= is evaluated in the page (awaited) before the capture, e.g. to click
#       a button; it can't contain "|".
#       fixture=sale (needs as=) creates once per run, through the app API, store
#       settings, two products, an open shift, a completed sale T1-000001 with
#       buyer details and split payments, and an open bill with one line.
#       pdf=<file> rasterises page 1 of <file> from the save folder (written by
#       js=, e.g. invoices.savePdf) to <name>.png at the shot size, instead of
#       capturing the window. Needs pdftoppm; a 794x1123 shot is A4 at 96 dpi.
#       The fixture users are seeded only when some shot uses as=, so a
#       signed-out run still starts from a fresh, empty database.
#
#   screenshots.sh publish <pr_branch> <dir>
#       Commits <dir>/*.png to the orphan `pr-screenshots` branch under
#       <pr_branch>/ and pushes it. Prints the image URL prefix to stdout.
set -euo pipefail

REPO=dev-nain/vendora-pos
PORT=${SCREENSHOT_PORT:-9229}
HOST_BRANCH=pr-screenshots
HERE=$(cd "$(dirname "$0")" && pwd)

capture() {
	local out shots
	out=$(realpath -m "$1")
	shots=$(realpath "$2")
	mkdir -p "$out"

	pnpm build >"$out/build.log" 2>&1 || { echo "build failed; see $out/build.log" >&2; exit 1; }

	# Electron derives userData from these on Linux/macOS, so the capture never
	# touches the developer's real Vendora database.
	local profile
	profile=$(mktemp -d)
	local run=()
	[[ -z ${DISPLAY:-} && -z ${WAYLAND_DISPLAY:-} ]] && run=(xvfb-run -a)
	local dev_users=0
	grep -q '|as=' "$shots" && dev_users=1

	local save_dir=""
	if grep -q '|pdf=' "$shots"; then
		save_dir=$out/files
		mkdir -p "$save_dir"
	fi

	# setsid gives Electron its own process group, so one kill stops it and its
	# helper processes without matching this script.
	VENDORA_DEV_USERS=$dev_users VENDORA_DEV_SAVE_DIR=$save_dir XDG_CONFIG_HOME=$profile HOME=$profile setsid "${run[@]}" pnpm exec electron . \
		--remote-debugging-port="$PORT" --user-data-dir="$profile/chromium" \
		--force-prefers-reduced-motion >"$out/electron.log" 2>&1 &
	local pgid=$!
	trap 'kill -- -'"$pgid"' 2>/dev/null || true; rm -rf "'"$profile"'"' EXIT

	for _ in $(seq 1 60); do
		curl -sf "http://127.0.0.1:$PORT/json/list" | grep -q '"type": *"page"' && break
		sleep 1
	done
	curl -sf "http://127.0.0.1:$PORT/json/list" | grep -q '"type": *"page"' ||
		{ echo "app window did not open; see $out/electron.log" >&2; exit 1; }

	node "$HERE/cdp-shot.mjs" "$PORT" "$out" "$shots" "$save_dir"
}

publish() {
	local pr_branch=$1 dir=$2
	local wt
	wt=$(mktemp -d)
	trap 'git worktree remove --force "'"$wt"'" 2>/dev/null || true' EXIT

	git worktree add --detach "$wt" >/dev/null 2>&1
	if git ls-remote --exit-code --heads origin "$HOST_BRANCH" >/dev/null; then
		# A named ref, not FETCH_HEAD: FETCH_HEAD is per-worktree, so the
		# temporary worktree can't see a fetch made from the main checkout.
		git fetch -q origin "$HOST_BRANCH:refs/remotes/origin/$HOST_BRANCH"
		git -C "$wt" checkout -q --detach "origin/$HOST_BRANCH"
	else
		git -C "$wt" checkout -q --orphan "$HOST_BRANCH-tmp"
		git -C "$wt" rm -rfq . >/dev/null
	fi

	mkdir -p "$wt/$pr_branch"
	cp "$dir"/*.png "$wt/$pr_branch/"
	git -C "$wt" add "$pr_branch"
	git -C "$wt" commit -q -m "chore: screenshots for $pr_branch"
	git -C "$wt" push -q origin "HEAD:refs/heads/$HOST_BRANCH"

	# Pinned to the commit so later pushes can't change what an old PR shows;
	# github.com/.../raw/ because raw.githubusercontent.com 404s on private repos.
	echo "https://github.com/$REPO/raw/$(git -C "$wt" rev-parse HEAD)/$pr_branch"
}

case ${1:-} in
capture) capture "$2" "$3" ;;
publish) publish "$2" "$3" ;;
*) sed -n '2,27p' "$0"; exit 1 ;;
esac
