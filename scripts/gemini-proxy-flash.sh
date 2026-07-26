#!/bin/bash
# Gemini 2.5 Flash via OAuth (gemini-openai-proxy)
# Port: 11436

cd "$(dirname "$0")/.."

AUTH_TYPE=oauth-personal \
MODEL=gemini-2.5-flash \
PORT=11445 \
npm start
