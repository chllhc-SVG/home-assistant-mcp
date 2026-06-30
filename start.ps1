$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$envPath = Join-Path $root '.env'
$envExamplePath = Join-Path $root '.env.example'
$frontUrl = 'http://127.0.0.1:5173'
$apiUrl = 'http://127.0.0.1:4000/healthz'

if (-not (Test-Path -LiteralPath $envPath)) {
  if (Test-Path -LiteralPath $envExamplePath) {
    Copy-Item -LiteralPath $envExamplePath -Destination $envPath
    Write-Host '[info] 已从 .env.example 复制生成 .env，请先填写 Home Assistant token 和地址后再重新运行。' -ForegroundColor Yellow
    Start-Process 'https://github.com/chllhc-SVG/home-assistant-mcp#readme'
    exit 0
  }

  Write-Host '[error] 缺少 .env，请创建后再启动。' -ForegroundColor Red
  exit 1
}

Write-Host '[info] 启动 Docker Compose...' -ForegroundColor Cyan
& docker compose up -d --build

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-WebRequest -Uri $frontUrl -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
      $ready = $true
      break
    }
  } catch {
    continue
  }
}

Write-Host ''
Write-Host ("[info] 系统页面: {0}" -f $frontUrl) -ForegroundColor Green
Write-Host ("[info] MCP API:   {0}" -f $apiUrl) -ForegroundColor Green
Write-Host ''

if ($ready) {
  try {
    Start-Process $frontUrl
  } catch {
    Write-Host ("[warn] 无法自动打开浏览器，请手动访问 {0}" -f $frontUrl) -ForegroundColor Yellow
  }
} else {
  Write-Host ("[warn] 页面暂时未就绪，请稍后手动访问 {0}" -f $frontUrl) -ForegroundColor Yellow
}
