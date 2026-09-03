#!/bin/bash
#
# selfcontrol-focus.sh
#
# Manual/instant-start utility: starts a SelfControl block right now using
# either the test blocklist or your saved config, and confirms it actually
# came up. Does NOT wait for it to finish and does NOT send notifications
# itself -- that's selfcontrol-focus-watch.sh's job, so a block started here,
# from the GUI, or any other way all get exactly one set of notifications
# and one streak bump, never duplicated.
#
# This script is not on the daily schedule. selfcontrol-focus-reminder.sh is
# what fires at your scheduled time, and it only sends a reminder -- it does
# not call this script or start anything itself. Use this script yourself
# for a quick test, or as a shortcut to start a block without opening the
# SelfControl GUI.
#
# Usage:
#   selfcontrol-focus.sh            starts a block using CONF_FILE's saved settings
#   selfcontrol-focus.sh --test     forces the test blocklist + a 2 minute block
#   selfcontrol-focus.sh --status   read-only: streak, current state, next scheduled reminder
#
# Exit codes:
#   0  block confirmed active
#   1  configuration / dependency error (missing CLI, missing blocklist, bad conf)
#   2  skipped -- a SelfControl block was already active (no overlap created)
#   3  selfcontrol-cli start did not result in a running block
#   5  another instance of this script is already running (lock held)

set -u

CONF_FILE="$HOME/.config/selfcontrol-focus/selfcontrol-focus.conf"
TEST_BLOCKLIST="$HOME/.config/selfcontrol-focus/test.selfcontrol"
TEST_DURATION_MINUTES=2

LOG_FILE="$HOME/Library/Logs/selfcontrol-focus.log"
ERROR_LOG_FILE="$HOME/Library/Logs/selfcontrol-focus-error.log"
LOCK_FILE="/tmp/local.selfcontrol-focus.lock"
STREAK_FILE="$HOME/Library/Application Support/selfcontrol-focus/streak.conf"
# Tells selfcontrol-focus-watch.sh the block it's about to see start was a
# test, so it doesn't bump the streak for it. The watcher can't otherwise
# tell a --test block from a real one -- it only ever sees is-running flip.
TEST_MARKER="/tmp/local.selfcontrol-focus.test-marker"

SELFCONTROL_CLI="selfcontrol-cli"

log() {
    printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$1" >> "$LOG_FILE"
}

err() {
    local msg="$1"
    printf '%s  ERROR  %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$msg" >> "$ERROR_LOG_FILE"
    printf '%s  ERROR  %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$msg" >> "$LOG_FILE"
}

cleanup() {
    rm -f "$LOCK_FILE"
}

# selfcontrol-cli writes YES/NO via NSLog to stderr, not stdout -- capture
# both streams and grep for the word, rather than relying on stdout alone.
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

# Prints current streak, whether a block is active right now, the
# configured schedule, and the next scheduled reminder time. Read-only --
# doesn't touch the lock file, doesn't require selfcontrol-cli to exist.
DAY_NAMES=(Sun Mon Tue Wed Thu Fri Sat)

print_status() {
    echo "SelfControl focus-block status"
    echo "-------------------------------"

    if command -v "$SELFCONTROL_CLI" >/dev/null 2>&1 && is_block_running; then
        echo "Right now:      block ACTIVE"
    elif command -v "$SELFCONTROL_CLI" >/dev/null 2>&1; then
        echo "Right now:      no block running"
    else
        echo "Right now:      unknown (selfcontrol-cli not found on PATH)"
    fi

    if [ -f "$STREAK_FILE" ]; then
        local STREAK_COUNT=0 LAST_SUCCESS_DATE=""
        # shellcheck disable=SC1090
        source "$STREAK_FILE"
        echo "Streak:         ${STREAK_COUNT} consecutive day(s), last completed ${LAST_SUCCESS_DATE}"
    else
        echo "Streak:         none yet -- no real (non-test) block has completed"
    fi

    if [ -f "$CONF_FILE" ]; then
        # shellcheck disable=SC1090
        source "$CONF_FILE"
        local names="" w
        for w in $SCHEDULE_WEEKDAYS; do
            names+="${DAY_NAMES[$w]} "
        done
        printf 'Schedule:       reminder %sat %02d:%02d (suggested %dh %02dm block)\n' \
            "$names" "$START_HOUR" "$START_MINUTE" "$((DURATION_MINUTES/60))" "$((DURATION_MINUTES%60))"

        local now_epoch target_epoch candidate_date candidate_epoch wday offset found=0
        now_epoch=$(date +%s)
        for offset in 0 1 2 3 4 5 6 7; do
            candidate_epoch=$(( now_epoch + offset*86400 ))
            candidate_date=$(date -j -r "$candidate_epoch" "+%Y-%m-%d")
            wday=$(date -j -f "%Y-%m-%d" "$candidate_date" "+%w")
            for w in $SCHEDULE_WEEKDAYS; do
                if [ "$w" = "$wday" ]; then
                    target_epoch=$(date -j -f "%Y-%m-%d %H:%M:%S" "$candidate_date $(printf '%02d:%02d:00' "$START_HOUR" "$START_MINUTE")" "+%s" 2>/dev/null)
                    if [ -n "$target_epoch" ] && [ "$target_epoch" -gt "$now_epoch" ]; then
                        # Use the loop's own day offset for the "today"/"tomorrow"
                        # label, not (target_epoch - now_epoch)/86400 -- that's a
                        # raw duration, not a calendar-day count, so it truncates
                        # wrong whenever the reminder time has already passed
                        # today (e.g. 17h from 5pm today to 10am tomorrow is < 24h
                        # but is very much "tomorrow", not "today").
                        local when="in ${offset}d"
                        [ "$offset" -eq 0 ] && when="today"
                        [ "$offset" -eq 1 ] && when="tomorrow"
                        printf 'Next reminder:  %s %s %02d:%02d (%s)\n' "${DAY_NAMES[$wday]}" "$candidate_date" "$START_HOUR" "$START_MINUTE" "$when"
                        found=1
                        break 2
                    fi
                fi
            done
        done
        [ "$found" = "0" ] && echo "Next reminder:  couldn't compute (check SCHEDULE_WEEKDAYS in conf)"
    else
        echo "Schedule:       not set up yet -- run selfcontrol-focus-setup.sh"
    fi

    echo "Logs:           ~/Library/Logs/selfcontrol-focus.log"
}

if [ "${1:-}" = "--status" ]; then
    print_status
    exit 0
fi

# --- duplicate-launch protection -------------------------------------------
if [ -f "$LOCK_FILE" ]; then
    existing_pid="$(cat "$LOCK_FILE" 2>/dev/null || true)"
    if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
        err "Another instance is already running (pid $existing_pid). Exiting to avoid a duplicate run."
        exit 5
    else
        log "Found stale lock file (pid $existing_pid not running). Removing it."
        rm -f "$LOCK_FILE"
    fi
fi
echo $$ > "$LOCK_FILE"
trap cleanup EXIT

log "=== selfcontrol-focus.sh starting (pid $$) ==="

# --- dependency check --------------------------------------------------------
if ! command -v "$SELFCONTROL_CLI" >/dev/null 2>&1; then
    err "selfcontrol-cli not found on PATH ($PATH). Is SelfControl installed and the CLI symlinked?"
    exit 1
fi

# --- resolve config -----------------------------------------------------------
TEST_MODE=0
if [ "${1:-}" = "--test" ]; then
    TEST_MODE=1
fi

if [ "$TEST_MODE" = "1" ]; then
    BLOCKLIST_PATH="$TEST_BLOCKLIST"
    DURATION_MINUTES="$TEST_DURATION_MINUTES"
    log "Running in --test mode: blocklist=$BLOCKLIST_PATH duration=${DURATION_MINUTES}m"
else
    if [ ! -f "$CONF_FILE" ]; then
        err "Config file not found: $CONF_FILE. Run selfcontrol-focus-setup.sh first."
        exit 1
    fi
    # shellcheck disable=SC1090
    source "$CONF_FILE"
    if [ -z "${BLOCKLIST_PATH:-}" ] || [ -z "${DURATION_MINUTES:-}" ]; then
        err "Config file $CONF_FILE is missing BLOCKLIST_PATH or DURATION_MINUTES."
        exit 1
    fi
    log "Using config: blocklist=$BLOCKLIST_PATH duration=${DURATION_MINUTES}m"
fi

if [ ! -f "$BLOCKLIST_PATH" ]; then
    err "Blocklist file not found: $BLOCKLIST_PATH"
    exit 1
fi

if ! [[ "$DURATION_MINUTES" =~ ^[0-9]+$ ]] || [ "$DURATION_MINUTES" -le 0 ]; then
    err "DURATION_MINUTES must be a positive integer, got: $DURATION_MINUTES"
    exit 1
fi

# --- avoid overlapping/duplicate SelfControl blocks --------------------------
if is_block_running; then
    log "SelfControl block already active. Skipping this start to avoid overlap."
    exit 2
fi

# --- start the block -----------------------------------------------------------
enddate="$(date -u -v +"${DURATION_MINUTES}"M '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)"
if [ -z "$enddate" ]; then
    # GNU date fallback (not expected on macOS, kept for safety)
    enddate="$(date -u -d "+${DURATION_MINUTES} minutes" '+%Y-%m-%dT%H:%M:%SZ')"
fi

log "Starting SelfControl block: blocklist=$BLOCKLIST_PATH enddate=$enddate"
start_output="$("$SELFCONTROL_CLI" start --blocklist "$BLOCKLIST_PATH" --enddate "$enddate" 2>&1)"
log "start output: $start_output"

# give the privileged helper a moment to apply the block, then confirm
started=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
    if is_block_running; then
        started=1
        break
    fi
    sleep 1
done

if [ "$started" != "1" ]; then
    err "selfcontrol-cli start was issued but is-running never reported YES. start output was: $start_output"
    exit 3
fi

if [ "$TEST_MODE" = "1" ]; then
    touch "$TEST_MARKER"
else
    rm -f "$TEST_MARKER"
fi

log "Block confirmed active. selfcontrol-focus-watch.sh will handle the start/finish notifications."
log "=== selfcontrol-focus.sh completed successfully ==="
exit 0
