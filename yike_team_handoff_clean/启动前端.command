#!/bin/zsh
set -e

cd "$(dirname "$0")/web"

if [ ! -d "node_modules" ]; then
  npm install
fi

npm run dev
