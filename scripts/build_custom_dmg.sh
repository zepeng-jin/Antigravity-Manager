#!/bin/bash
set -e
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

VERSION=$(grep '"version":' package.json | head -n 1 | awk -F: '{ print $2 }' | sed 's/[", ]//g')

echo "=========================================="
echo "🚀 编译打包: 专属纯净增强版 (无中转站) v${VERSION}"
echo "=========================================="

echo "1. 构建前端..."
npm run build

echo "2. 构建 Tauri App (多核加速)..."
npm run tauri build -- --bundles app

echo "3. 生成发布 DMG 安装包..."
bash scripts/package_dmg.sh

if [ -f "Antigravity_Tools_${VERSION}_ManualFix.dmg" ]; then
    cp -f "Antigravity_Tools_${VERSION}_ManualFix.dmg" "Antigravity_Tools_${VERSION}_Custom_Pure.dmg"
fi

echo "=========================================="
echo "🎉 专属纯净增强版打包成功！"
echo "DMG 路径: $ROOT_DIR/Antigravity_Tools_${VERSION}_Custom_Pure.dmg"
echo "=========================================="
