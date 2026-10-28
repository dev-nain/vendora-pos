#!/usr/bin/env bash
# Screenshot capture and hosting for ticket-loop PRs.
#
#   screenshots.sh capture <out_dir> <shots_file>
#       Builds the app, launches Electron against a throwaway profile with
#       remote debugging, captures every shot over CDP, then quits.
#       shots_file lines: name|route|WIDTHxHEIGHT|light|dark  e.g.
#         checkout|/|1366x768|light
#         checkout-dark|/|1366x768|dark
#         reports|/reports|1920x1080|light
#       route is applied as location.hash; "/" leaves the start screen.
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

	# setsid gives Electron its own process group, so one kill stops it and its
	# helper processes without matching this script.
	XDG_CONFIG_HOME=$profile HOME=$profile setsid "${run[@]}" pnpm exec electron . \
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

	node "$HERE/cdp-shot.mjs" "$PORT" "$out" "$shots"
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
*) sed -n '2,17p' "$0"; exit 1 ;;
esac
