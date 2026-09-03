#!/bin/bash
#
# selfcontrol-focus-reminder.sh
#
# Fires at the scheduled time and does exactly one thing: sends a reminder
# notification. It never calls `selfcontrol-cli start` and never touches
# SelfControl at all -- starting the block is entirely up to you, either by
# clicking the notification (opens SelfControl.app) or opening it yourself.
# Time triggers the reminder; you trigger the block.
#
# If a block is already active (e.g. you started one manually earlier),
# it skips silently -- no point reminding you to start something that's
# already running.
#
# Invoked by: ~/Library/LaunchAgents/local.selfcontrol-focus-reminder.plist
# Config:     see CONF_FILE below (generated/edited by selfcontrol-focus-setup.sh)

set -u

CONF_FILE="$HOME/.config/selfcontrol-focus/selfcontrol-focus.conf"
LOG_FILE="$HOME/Library/Logs/selfcontrol-focus.log"
ERROR_LOG_FILE="$HOME/Library/Logs/selfcontrol-focus-error.log"
STREAK_FILE="$HOME/Library/Application Support/selfcontrol-focus/streak.conf"

SELFCONTROL_CLI="selfcontrol-cli"
SELFCONTROL_BUNDLE_ID="org.eyebeam.SelfControl"

log() {
    printf '%s  [reminder]  %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$1" >> "$LOG_FILE"
}

err() {
    local msg="$1"
    printf '%s  [reminder]  ERROR  %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$msg" >> "$ERROR_LOG_FILE"
    printf '%s  [reminder]  ERROR  %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$msg" >> "$LOG_FILE"
}

notify() {
    local message="$1"
    local activate="${2:-}"
    local sent=1
    if command -v terminal-notifier >/dev/null 2>&1; then
        local args=(-title "SelfControl" -message "$message")
        [ -n "$activate" ] && args+=(-activate "$activate")
        if terminal-notifier "${args[@]}" >/dev/null 2>&1; then
            sent=0
        fi
    fi
    if [ "$sent" != "0" ]; then
        osascript -e "display notification \"$message\" with title \"SelfControl\"" >/dev/null 2>&1
    fi
}

log "=== selfcontrol-focus-reminder.sh fired ==="

if ! command -v "$SELFCONTROL_CLI" >/dev/null 2>&1; then
    err "selfcontrol-cli not found on PATH ($PATH)."
    exit 1
fi

if "$SELFCONTROL_CLI" is-running 2>&1 | grep -qw YES; then
    log "A block is already active. Skipping reminder."
    exit 0
fi

message="Time for your focus block."
if [ -f "$STREAK_FILE" ]; then
    STREAK_COUNT=0
    # shellcheck disable=SC1090
    source "$STREAK_FILE"
    [ "$STREAK_COUNT" -gt 0 ] 2>/dev/null && message="Time for your focus block. 🔥 ${STREAK_COUNT}-day streak so far."
fi

log "Sending reminder: $message"
notify "$message" "$SELFCONTROL_BUNDLE_ID"
