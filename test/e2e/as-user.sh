#!/bin/sh
# Runs Electron as an unprivileged user so Chromium's sandbox is on (it refuses to run as root).
exec runuser -u "${FERNA_TEST_USER:-tester}" -- "$(dirname "$0")/../../node_modules/electron/dist/electron" "$@"
