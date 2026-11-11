#!/usr/bin/env bash
# context-insight 安装/更新脚本（macOS / Linux / WSL / git-bash）
#   bash <(curl -fsSL https://raw.githubusercontent.com/REPO/main/install.sh)
#   大陆网络下 raw.githubusercontent.com 常被重置，可加镜像：
#   GH_PROXY=https://gh-proxy.com/ bash install.sh
set -euo pipefail

REPO="${REPO:-saqinghui-huaian/context-insight}"
BRANCH="${BRANCH:-main}"
if [ -z "${HERMES_HOME:-}" ]; then
  case "$(uname -s 2>/dev/null || echo Unknown)" in
    MINGW*|MSYS*|CYGWIN*) HERMES_HOME="$(cygpath -u "${LOCALAPPDATA:-$HOME}/hermes")" ;;
    *) HERMES_HOME="$HOME/.hermes" ;;
  esac
fi
DEST="$HERMES_HOME/desktop-plugins/context-insight"

# 临时目录：Windows 上的 curl 是原生程序，写不了 MSYS 的 /tmp，需要 Windows 风格路径
case "$(uname -s 2>/dev/null || echo Unknown)" in
  MINGW*|MSYS*|CYGWIN*)
    TMP="$(cygpath -m "${TEMP:-${TMPDIR:-.}}")/context-insight-$$"
    mkdir -p "$TMP"
    trap 'rm -rf "$TMP"' EXIT ;;
  *)
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT ;;
esac

candidates=()
[ -n "${GH_BASE:-}" ] && candidates+=("$GH_BASE")
[ -n "${GH_PROXY:-}" ] && candidates+=("${GH_PROXY%/}/https://raw.githubusercontent.com/$REPO/$BRANCH")
candidates+=("https://raw.githubusercontent.com/$REPO/$BRANCH")
candidates+=("https://cdn.jsdelivr.net/gh/$REPO@$BRANCH")
[ -n "${GH_MIRROR:-}" ] && candidates+=("${GH_MIRROR%/}/$REPO/$BRANCH")

BASE=""
for b in "${candidates[@]}"; do
  printf '· 尝试 %s\n' "$b"
  if curl -fsSL --connect-timeout 8 --max-time 30 "$b/plugin.js.sha256" -o "$TMP/expect" 2>/dev/null; then BASE="$b"; break; fi
done
if [ -z "$BASE" ]; then
  echo "所有候选源都取不到 plugin.js.sha256。请手动安装："
  echo "  1) 浏览器打开 https://github.com/$REPO/releases 下载 plugin.js"
  echo "  2) 放到 $DEST/plugin.js"
  echo "  大陆网络可加镜像重试：GH_PROXY=https://gh-proxy.com/ bash install.sh"
  exit 1
fi
echo "· 使用源 $BASE"
curl -fsSL --max-time 60 "$BASE/plugin.js" -o "$TMP/plugin.js"

EXPECT="$(awk '{print $1}' "$TMP/expect" | tr -d '[:space:]')"
if command -v sha256sum >/dev/null 2>&1; then ACTUAL="$(sha256sum "$TMP/plugin.js" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then ACTUAL="$(shasum -a 256 "$TMP/plugin.js" | awk '{print $1}')"
else echo "· 无 sha256 工具，跳过校验"; ACTUAL="$EXPECT"; fi
if [ "$ACTUAL" != "$EXPECT" ]; then
  echo "校验失败：期望 $EXPECT 实得 $ACTUAL —— 已中止，未写入任何文件"
  exit 1
fi
echo "· sha256 校验通过 $ACTUAL"

mkdir -p "$DEST"
cp "$TMP/plugin.js" "$DEST/plugin.js"
echo "· 已安装 -> $DEST/plugin.js ($(wc -c < "$DEST/plugin.js" | tr -d ' ') 字节)"
if command -v node >/dev/null 2>&1; then
  NPATH="$DEST/plugin.js"
  case "$(uname -s 2>/dev/null || echo Unknown)" in
    MINGW*|MSYS*|CYGWIN*) NPATH="$(cygpath -w "$NPATH")" ;;
  esac
  if node --check "$NPATH" 2>/dev/null; then echo "· 语法检查通过"; else echo "· 语法检查未通过（请核对下载完整性或 Node 版本）"; fi
fi
echo
echo "完成。回到 Hermes 桌面端几秒内自动加载；没反应就 Ctrl+K → Reload desktop plugins。"
echo "侧边栏出现「上下文洞察」，快捷键 Ctrl/Cmd+Shift+C。卸载 = 删除 $DEST 目录。"
