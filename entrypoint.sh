#!/bin/sh
if [ "$1" = "--auth" ]; then
  # Run auth command
  exec bun --use-system-ca run dist/main.js auth
else
  # Default command. The GitHub token is read from the GH_TOKEN environment
  # variable by the server itself, rather than being passed on the command
  # line, so it does not appear in the process table (/proc/<pid>/cmdline).
  exec bun --use-system-ca run dist/main.js start "$@"
fi
