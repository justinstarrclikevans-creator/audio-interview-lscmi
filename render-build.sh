#!/usr/bin/env bash
# exit on error
set -o errexit

npm install

# Store/pull Puppeteer cache with build cache
PUPPETEER_CACHE_DIR=/opt/render/project/puppeteer
export PUPPETEER_CACHE_DIR

# Install Puppeteer and download Chrome
npm rebuild
npx puppeteer browsers install chrome
