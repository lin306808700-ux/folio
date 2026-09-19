#!/bin/bash

# 获取脚本所在目录的父目录（即 ai-terminal 根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "脚本目录: $SCRIPT_DIR"
echo "项目根目录: $PROJECT_ROOT"

# 进入项目根目录
cd "$PROJECT_ROOT"

# 生成带时间戳的文件名
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE_NAME="ai-terminal-$TIMESTAMP.zip"

# 创建 zips 目录（如果不存在）
ZIPS_DIR="zips"
mkdir -p "$ZIPS_DIR"

# 完整的归档路径
ARCHIVE_PATH="$ZIPS_DIR/$ARCHIVE_NAME"

echo "正在创建归档: $ARCHIVE_NAME"
echo "保存位置: $ARCHIVE_PATH"

# 创建临时文件列表
TEMP_LIST="/tmp/archive-files-$$.txt"

# 使用 find 命令精确查找需要包含的文件
find . -type f \
  ! -path "./data/*" \
  ! -path "./tda_env/*" \
  ! -path "./work*" \
  ! -path "./build*" \
  ! -path "./rich-ui-demo.html" \
  ! -path "./node_modules*" \
  ! -path "*/node_modules/*" \
  ! -path "./dist*" \
  ! -path "*/dist/*" \
  ! -path "./release*" \
  ! -path "*/release/*" \
  ! -path "./.git*" \
  ! -path "*/.git/*" \
  ! -path "./.codewiz*" \
  ! -path "*/.codewiz/*" \
  ! -path "*/venv/*" \
  ! -path "*/.venv/*" \
  ! -path "*/__pycache__/*" \
  ! -path "*/.mypy_cache/*" \
  ! -path "*/.pytest_cache/*" \
  ! -path "*.egg-info/*" \
  ! -path "*/.qoder/*" \
  ! -path "*/arch-designer/*" \
  ! -path "*/__tests__/*" \
  ! -name ".DS_Store" \
  ! -name "bundle.js" \
  ! -name "bundle.js.LICENSE.txt" \
  ! -name "package-lock.json" \
  ! -name "*.zip" \
  ! -name "*.pyc" \
  ! -name "*.icns" \
  ! -path "./zips/*" \
  ! -path "./scripts*" > "$TEMP_LIST"

# 检查是否有文件要打包
if [ ! -s "$TEMP_LIST" ]; then
  echo "❌ 没有找到需要打包的文件"
  rm -f "$TEMP_LIST"
  exit 1
fi

echo "找到 $(wc -l < "$TEMP_LIST") 个文件"

# 使用文件列表进行打包
if zip -r "$ARCHIVE_PATH" -@ < "$TEMP_LIST"; then
  echo "✅ 归档创建成功: $ARCHIVE_NAME"
  echo "📦 文件大小: $(du -h "$ARCHIVE_PATH" | cut -f1)"
  echo "📁 保存位置: $(pwd)/$ARCHIVE_PATH"
else
  echo "❌ 归档创建失败"
  rm -f "$TEMP_LIST"
  exit 1
fi

# 清理临时文件
rm -f "$TEMP_LIST"