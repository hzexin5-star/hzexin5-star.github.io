# ============================================================
#  AI 会员价格雷达 - GitHub 自动化工具（国内可用，走 API 不走 git）
#  用法：
#    .\github.ps1 push      上传代码改动（改完 build.mjs 等文件后执行）
#    .\github.ps1 rebuild   立即重新抓取上游价格并部署
#    .\github.ps1 status    查看部署状态、最近一次构建、线上是否正常
# ============================================================
param(
  [Parameter(Position = 0)]
  [ValidateSet('push', 'rebuild', 'status', 'open')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$owner = 'hzexin5-star'
$repo  = 'hzexin5-star.github.io'
$api   = "https://api.github.com/repos/$owner/$repo"
$site  = "https://$owner.github.io"

# 从 Windows 凭据管理器取 GitHub Token（不显示、不落地）
function Get-GitHubToken {
  $cred = ("protocol=https`nhost=github.com`n`n" | & git credential fill 2>$null)
  $tok = (($cred | Select-String '^password=').Line -replace '^password=', '')
  if (-not $tok) { throw '没找到 GitHub 凭据，请确认本机 Git 已登录过 GitHub。' }
  return $tok
}

$token = Get-GitHubToken
$H = @{
  'Authorization' = "token $token"
  'User-Agent'    = 'dsh-agent'
  'Accept'        = 'application/vnd.github+json'
}

function Api($method, $uri, $body) {
  $p = @{ Method = $method; Uri = $uri; Headers = $H; TimeoutSec = 60 }
  if ($body) {
    $p.Body = ($body | ConvertTo-Json -Compress)
    $p.ContentType = 'application/json'
  }
  return Invoke-RestMethod @p
}

switch ($Action) {

  'push' {
    Write-Host ''
    Write-Host '=== 上传代码改动 ===' -ForegroundColor Cyan
    $files = @(
      'build.mjs',
      'package.json',
      'build.bat',
      'README.md',
      'github.ps1',
      '1-查看部署状态.bat',
      '2-立即刷新价格.bat',
      '3-上传代码改动.bat',
      '.github/workflows/deploy.yml'
    )
    $msg = "update: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    $ok = 0
    foreach ($f in $files) {
      if (-not (Test-Path $f)) { continue }
      $sha = $null
      try { $r = Api 'GET' "$api/contents/$f" $null; $sha = $r.sha } catch { }
      $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $f)))
      $body = @{ message = $msg; content = $b64; branch = 'main' }
      if ($sha) { $body.sha = $sha }
      try {
        Api 'PUT' "$api/contents/$f" $body | Out-Null
        Write-Host "  OK  $f" -ForegroundColor Green
        $ok++
      } catch {
        Write-Host "  FAIL $f -> $($_.Exception.Message)" -ForegroundColor Red
      }
    }
    Write-Host ""
    Write-Host "已上传 $ok 个文件，GitHub 会自动重新构建部署（约 1 分钟）。" -ForegroundColor Yellow
    Write-Host "稍后用  .\github.ps1 status  查看结果。"
  }

  'rebuild' {
    Write-Host ''
    Write-Host '=== 触发重新抓取价格 ===' -ForegroundColor Cyan
    Api 'POST' "$api/actions/workflows/deploy.yml/dispatches" @{ ref = 'main' } | Out-Null
    Write-Host '  已触发，约 1 分钟后自动上线。' -ForegroundColor Green
    Write-Host ''
    for ($i = 1; $i -le 30; $i++) {
      Start-Sleep -Seconds 6
      $runs = Api 'GET' "$api/actions/runs?per_page=3" $null
      $run = $runs.workflow_runs | Where-Object { $_.name -eq 'Build & Deploy' } | Select-Object -First 1
      if ($run) {
        if ($run.status -eq 'completed') {
          if ($run.conclusion -eq 'success') {
            Write-Host "  ✓ 构建部署成功（第 $($run.run_number) 次）" -ForegroundColor Green
          } else {
            Write-Host "  ✗ 构建失败：$($run.conclusion)" -ForegroundColor Red
          }
          break
        } else {
          Write-Host "  … 进行中（$($run.status)）"
        }
      }
    }
    Write-Host "  线上地址：$site"
  }

  'status' {
    Write-Host ''
    Write-Host '=== 部署状态 ===' -ForegroundColor Cyan
    try {
      $pg = Api 'GET' "$api/pages" $null
      Write-Host "  Pages: $($pg.status) / $($pg.build_type) / $($pg.html_url)"
    } catch { Write-Host "  Pages 查询失败：$($_.Exception.Message)" -ForegroundColor Red }

    try {
      $runs = Api 'GET' "$api/actions/runs?per_page=5" $null
      $run = $runs.workflow_runs | Where-Object { $_.name -eq 'Build & Deploy' } | Select-Object -First 1
      if ($run) {
        Write-Host "  最近构建：第 $($run.run_number) 次 / $($run.status) / $($run.conclusion) / $($run.created_at)"
      } else { Write-Host '  还没有构建记录' }
    } catch { }

    Write-Host ''
    Write-Host '=== 线上检查 ===' -ForegroundColor Cyan
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    foreach ($p in @('/', '/guide.html', '/robots.txt')) {
      $u = "$site$p" + "?v=$ts"
      try {
        $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 20 -Headers @{ 'User-Agent' = 'Mozilla/5.0'; 'Cache-Control' = 'no-cache' }
        Write-Host "  $p -> $($r.StatusCode)  $([math]::Round($r.RawContentLength / 1KB, 1))KB" -ForegroundColor Green
      } catch {
        Write-Host "  $p -> 访问失败" -ForegroundColor Red
      }
    }
    Write-Host ''
    Write-Host "  网站地址：$site"
  }

  'open' {
    Start-Process $site
  }
}
