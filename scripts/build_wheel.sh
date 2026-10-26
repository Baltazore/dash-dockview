#!/usr/bin/env bash
# Build the JavaScript bundle, the Dash component files, and the Python wheel.
# PYTHON must point at a Python that has dash, pyyaml, setuptools and build installed.
# The wheel lands in dist/.
set -euo pipefail

PYTHON="${PYTHON:-python3}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PYTHON_PATH="$(command -v "$PYTHON")"
# dash-generate-components lives next to the Python that has dash installed.
export PATH="$(dirname "$PYTHON_PATH"):$PATH"

cd "$ROOT"
npm ci
npm run build

rm -rf dist build ./*.egg-info
"$PYTHON_PATH" -m build --wheel --outdir dist

WHEEL="$(ls dist/dash_dockview-*-py3-none-any.whl | head -n 1)"
echo "wheel: $WHEEL"
shasum -a 256 "$WHEEL"
