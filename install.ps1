# context-insight 安装/更新（Windows PowerShell）
#   iex (iwr -UseBasicParsing https://raw.githubusercontent.com/saqinghui-huaian/context-insight/main/install.ps1)
#   大陆网络 raw.githubusercontent.com 常被重置，可先设镜像：
#   $env:GH_PROXY = "https://gh-proxy.com/"; iex (iwr -UseBasicParsing ...)
$ErrorActionPreference = "Stop"
$repo = if ($env:REPO) { $env:REPO } else { "saqinghui-huaian/context-insight" }
$branch = if ($env:BRANCH) { $env:BRANCH } else { "main" }
$hermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { "$env:LOCALAPPDATA\hermes" }
$dest = Join-Path $hermesHome "desktop-plugins\context-insight"
$tmp = Join-Path $env:TEMP ("ci-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$urls = @()
if ($env:GH_PROXY) { $urls += ($env:GH_PROXY.TrimEnd('/') + "/https://raw.githubusercontent.com/$repo/$branch") }
if ($env:GH_BASE) { $urls = @($env:GH_BASE) + $urls }
$urls += "https://raw.githubusercontent.com/$repo/$branch"
$urls += "https://cdn.jsdelivr.net/gh/$repo@$branch"

$base = $null
foreach ($u in $urls) {
  Write-Host "· 尝试 $u"
  try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 25 -Uri "$u/plugin.js.sha256" -OutFile (Join-Path $tmp "expect.txt")
    $base = $u; break
  } catch { }
}
if (-not $base) {
  Write-Host "所有候选源都取不到 plugin.js.sha256。请手动安装：" -ForegroundColor Yellow
  Write-Host "  1) 打开 https://github.com/$repo/releases 下载 plugin.js"
  Write-Host "  2) 放到 $dest\plugin.js"
  throw "安装中止"
}
Write-Host "· 使用源 $base"
Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri "$base/plugin.js" -OutFile (Join-Path $tmp "plugin.js")

$expect = ((Get-Content (Join-Path $tmp "expect.txt") -Raw) -split '\s+')[0].Trim()
$actual = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp "plugin.js")).Hash.ToLower()
if ($actual -ne $expect.ToLower()) {
  Remove-Item -Recurse -Force $tmp
  throw "校验失败：期望 $expect 实得 $actual —— 未写入任何文件"
}
Write-Host "· sha256 校验通过 $actual"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $tmp "plugin.js") (Join-Path $dest "plugin.js") -Force
Remove-Item -Recurse -Force $tmp
$size = (Get-Item (Join-Path $dest "plugin.js")).Length
Write-Host "· 已安装 -> $dest\plugin.js ($size 字节)"
if (Get-Command node -ErrorAction SilentlyContinue) {
  node --check (Join-Path $dest "plugin.js") 2>$null
  if ($LASTEXITCODE -eq 0) { Write-Host "· 语法检查通过" } else { Write-Host "· node --check 未通过（多半 Node 版本过旧），App 自身仍会加载" }
}
Write-Host ""
Write-Host "完成。回到 Hermes 桌面端几秒内自动加载；没反应就按 Ctrl+K 执行 Reload desktop plugins。"
Write-Host "侧边栏出现「上下文洞察」，快捷键 Ctrl+Shift+C。卸载 = 删除 $dest 目录。"
