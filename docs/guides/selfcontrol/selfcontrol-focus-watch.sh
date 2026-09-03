#!/bin/bash
#
# selfcontrol-focus-watch.sh
#
# Long-running background watcher, kept alive by launchd. Polls
# `selfcontrol-cli is-running` and reacts to state transitions, regardless
# of how a block was started (the SelfControl GUI, selfcontrol-focus.sh, a
# reminder click, anything) -- this is the ONLY thing that sends start/finish
# notifications or bumps the streak, so however a block gets started, you
# get exactly one set of notifications, never duplicated.
#
# Never calls `selfcontrol-cli start` and never tries to stop a block --
# purely observes and notifies.
#
# Invoked by: ~/Library/LaunchAgents/local.selfcontrol-focus-watch.plist
# (KeepAlive + RunAtLoad -- launchd restarts it if it ever exits)

set -u

STREAK_FILE="$HOME/Library/Application Support/selfcontrol-focus/streak.conf"
TEST_MARKER="/tmp/local.selfcontrol-focus.test-marker"
LOG_FILE="$HOME/Library/Logs/selfcontrol-focus.log"
ERROR_LOG_FILE="$HOME/Library/Logs/selfcontrol-focus-error.log"

SELFCONTROL_CLI="selfcontrol-cli"
SELFCONTROL_BUNDLE_ID="org.eyebeam.SelfControl"
POLL_INTERVAL=30

log() {
    printf '%s  [watch]  %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$1" >> "$LOG_FILE"
}

err() {
    local msg="$1"
    printf '%s  [watch]  ERROR  %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$msg" >> "$ERROR_LOG_FILE"
    printf '%s  [watch]  ERROR  %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$msg" >> "$LOG_FILE"
}

notify() {
    local message="$1"
    local sound_clause="${2:-}"
    local activate="${3:-}"
    local sent=1

    if command -v terminal-notifier >/dev/null 2>&1; then
        local args=(-title "SelfControl" -message "$message")
        [ -n "$sound_clause" ] && args+=(-sound "$sound_clause")
        [ -n "$activate" ] && args+=(-activate "$activate")
        if terminal-notifier "${args[@]}" >/dev/null 2>&1; then
            sent=0
        else
            log "terminal-notifier failed (not authorized yet? run 'terminal-notifier -diagnose'). Falling back to osascript."
        fi
    fi

    if [ "$sent" != "0" ]; then
        if [ -n "$sound_clause" ]; then
            osascript -e "display notification \"$message\" with title \"SelfControl\" sound name \"$sound_clause\"" >/dev/null 2>&1
        else
            osascript -e "display notification \"$message\" with title \"SelfControl\"" >/dev/null 2>&1
        fi
    fi
}

# Counts as consecutive if the last successful day was within 3 calendar
# days ago (covers weekend gaps on a Mon-Fri schedule); otherwise resets
# to 1. Running twice in the same day doesn't double-count.
bump_streak() {
    local STREAK_COUNT=0 LAST_SUCCESS_DATE="" new_count today
    today="$(date '+%Y-%m-%d')"
    if [ -f "$STREAK_FILE" ]; then
        # shellcheck disable=SC1090
        source "$STREAK_FILE"
    fi
    if [[ "$LAST_SUCCESS_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        local today_epoch last_epoch diff_days
        today_epoch="$(date -j -f "%Y-%m-%d" "$today" "+%s" 2>/dev/null)"
        last_epoch="$(date -j -f "%Y-%m-%d" "$LAST_SUCCESS_DATE" "+%s" 2>/dev/null)"
        if [ -n "$today_epoch" ] && [ -n "$last_epoch" ]; then
            diff_days=$(( (today_epoch - last_epoch) / 86400 ))
        else
            diff_days=99
        fi
    else
        diff_days=99
    fi

    if [ "$diff_days" -eq 0 ]; then
        new_count="$STREAK_COUNT"
    elif [ "$diff_days" -ge 1 ] && [ "$diff_days" -le 3 ]; then
        new_count=$(( STREAK_COUNT + 1 ))
    else
        new_count=1
    fi

    mkdir -p "$(dirname "$STREAK_FILE")"
    printf 'STREAK_COUNT=%d\nLAST_SUCCESS_DATE=%s\n' "$new_count" "$today" > "$STREAK_FILE"
    echo "$new_count"
}

is_block_running() {
    local output
    output="$("$SELFCONTROL_CLI" is-running 2>&1)"
    if echo "$output" | grep -qw YES; then
        return 0
    elif echo "$output" | grep -qw NO; then
        return 1
    else
        err "Unexpected output from 'is-running': $output"
        return 1
    fi
}

if ! command -v "$SELFCONTROL_CLI" >/dev/null 2>&1; then
    err "selfcontrol-cli not found on PATH ($PATH). Watcher exiting; launchd will retry."
    exit 1
fi

log "=== selfcontrol-focus-watch.sh starting (pid $$) ==="

# Seed initial state without firing a notification for a block that was
# already running before the watcher started.
if is_block_running; then
    was_running=1
    log "Startup: a block is already active."
else
    was_running=0
fi

while :; do
    sleep "$POLL_INTERVAL"

    if is_block_running; then
        now_running=1
    else
        now_running=0
    fi

    if [ "$now_running" = "1" ] && [ "$was_running" = "0" ]; then
        log "Block started (detected)."
        notify "Focus block started." "" "$SELFCONTROL_BUNDLE_ID"
    elif [ "$now_running" = "0" ] && [ "$was_running" = "1" ]; then
        if [ -f "$TEST_MARKER" ]; then
            rm -f "$TEST_MARKER"
            log "Block finished (detected) -- was a --test run, not bumping streak."
            notify "Your focus block has finished." "Glass" "$SELFCONTROL_BUNDLE_ID"
        else
            streak="$(bump_streak)"
            log "Block finished (detected). Streak: ${streak} consecutive day(s)."
            notify "Your focus block has finished. 🔥 ${streak}-day streak" "Glass" "$SELFCONTROL_BUNDLE_ID"
        fi
    fi

    was_running="$now_running"
done
