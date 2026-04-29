#!/bin/sh
set -eu
export SONOL_WORKSPACE_ROOT='/mnt/c/Users/User/projects/check_server/check_server_site'
export SONOL_DB_PATH='/mnt/c/Users/User/projects/check_server/check_server_site/C:\Users\User\projects\check_server\check_server_site\.sonol\data\sonol-multi-agent.sqlite'
export SONOL_RUNTIME_ROOT='/mnt/c/Users/User/projects/check_server/check_server_site/C:\Users\User\projects\check_server\check_server_site\.sonol\runtime'
export SONOL_DASHBOARD_URL='http://127.0.0.1:31539'
exec '/home/chpark/.nvm/versions/node/v22.22.2/bin/node' '/home/chpark/.claude/skills/sonol-multi-agent/scripts/start-dashboard.mjs' '--workspace-root' '/mnt/c/Users/User/projects/check_server/check_server_site' '--db' '/mnt/c/Users/User/projects/check_server/check_server_site/C:\Users\User\projects\check_server\check_server_site\.sonol\data\sonol-multi-agent.sqlite' '--dashboard-url' 'http://127.0.0.1:31539' >> '/mnt/c/Users/User/projects/check_server/check_server_site/C:\Users\User\projects\check_server\check_server_site\.sonol\runtime/dashboard-launch/dashboard-szvhb9.log' 2>&1
