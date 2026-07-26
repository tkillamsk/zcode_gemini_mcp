#!/bin/bash
# Gemini 2.5 Pro via OAuth (gemini-openai-proxy)
# Port: 11435

cd "$(dirname "$0")/.."

AUTH_TYPE=oauth-personal \
MODEL=gemini-2.5-pro \
PORT=11444 \
npm start
