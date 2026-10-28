# ============================================================
#  绑定自定义域名到 GitHub Pages
#  用法：先在阿里云加好 CNAME 记录，然后双击 4-绑定域名.bat
# ============================================================
param(
  [string]$Domain = 'price.ireliashop.com'
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$owner = 'hzexin5-star'
$repo  = 'hzexin5-star.github.io'
$api   = "https://api.github.com/repos/$owner/$repo"

function Get-Token {
  $cred = ("protocol=https`nhost=github.com`n`n" | & git credential fill 2>$null)
  $tok = (($cred | Select-String '^password=').Line -replace '^password=', '')
  if (-not $tok) { throw '没找到 GitHub 凭据' }
  return $tok
}

$H = @{
  'Authorization' = "token $(Get-Token)"
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

Write-Host ''
Write-Host "=== 1/5 检查 DNS 是否已生效（$Domain）===" -ForegroundColor Cyan
$ok = $false
try {
  $r = Resolve-DnsName -Name $Domain -Type CNAME -ErrorAction Stop
  $target = ($r | Where-Object { $_.NameHost } | Select-Object -First 1).NameHost
  if ($target) {
    Write-Host "  CNAME -> $target" -ForegroundColor Green
    $ok = $true
  }
} catch { }
if (-not $ok) {
  try {
    $r2 = Resolve-DnsName -Name $Domain -Type A -ErrorAction Stop
    $ip = ($r2 | Where-Object { $_.IPAddress } | Select-Object -First 1).IPAddress
    if ($ip) {
      Write-Host "  A -> $ip（GitHub Pages 的 IP 也可以）" -ForegroundColor Green
      $ok = $true
    }
  } catch { }
}
if (-not $ok) {
  Write-Host "  ✗ $Domain 还解析不到。" -ForegroundColor Red
  Write-Host ''
  Write-Host '  请先去阿里云添加这条记录：' -ForegroundColor Yellow
  Write-Host '    云解析 DNS -> ireliashop.com -> 解析设置 -> 添加记录'
  Write-Host '    记录类型: CNAME'
  Write-Host '    主机记录: price'
  Write-Host '    记录值:   hzexin5-star.github.io'
  Write-Host '    TTL:      600'
  Write-Host ''
  Write-Host '  加好后等 1-10 分钟，再双击本脚本。'
  exit 1
}

Write-Host ''
Write-Host '=== 2/5 上传最新代码（含 CNAME / siteUrl）===' -ForegroundColor Cyan
$files = @('build.mjs', 'README.md', 'github.ps1', 'bind-domain.ps1', '.github/workflows/deploy.yml')
foreach ($f in $files) {
  if (-not (Test-Path $f)) { continue }
  $sha = $null
  try { $x = Api 'GET' "$api/contents/$f" $null; $sha = $x.sha } catch { }
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $f)))
  $body = @{ message = "domain: 绑定 $Domain"; content = $b64; branch = 'main' }
  if ($sha) { $body.sha = $sha }
  try {
    Api 'PUT' "$api/contents/$f" $body | Out-Null
    Write-Host "  OK $f" -ForegroundColor Green
  } catch {
    Write-Host "  FAIL $f -> $($_.Exception.Message)" -ForegroundColor Red
  }
}

Write-Host ''
Write-Host '=== 3/5 设置 GitHub Pages 自定义域名 ===' -ForegroundColor Cyan
try {
  Api 'PUT' "$api/pages" @{ cname = $Domain } | Out-Null
  Write-Host "  ✓ 已设置为 $Domain" -ForegroundColor Green
} catch {
  Write-Host "  ! $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== 4/5 等待 GitHub 签发 HTTPS 证书（最多 5 分钟）===' -ForegroundColor Cyan
$approved = $false
for ($i = 1; $i -le 40; $i++) {
  Start-Sleep -Seconds 8
  try {
    $pg = Api 'GET' "$api/pages" $null
    $state = ''
    if ($pg.https_certificate) { $state = $pg.https_certificate.state }
    Write-Host "  [$($i*8)s] cname=$($pg.cname) cert=$state"
    if ($state -eq 'approved') { $approved = $true; break }
  } catch {
    Write-Host "  [$($i*8)s] 查询中…"
  }
}

if ($approved) {
  Write-Host '  ✓ 证书已签发' -ForegroundColor Green
  try { Api 'PUT' "$api/pages" @{ https_enforced = $true } | Out-Null; Write-Host '  ✓ 已开启强制 HTTPS' -ForegroundColor Green } catch { }
} else {
  Write-Host '  … 证书还在签发中（通常 10-60 分钟），稍后用 1-查看部署状态.bat 复查' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== 5/5 线上验证 ===' -ForegroundColor Cyan
foreach ($p in @('/', '/guide.html')) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -Uri "https://$Domain$p" -UseBasicParsing -TimeoutSec 25 -Headers @{ 'User-Agent' = 'Mozilla/5.0'; 'Cache-Control' = 'no-cache' }
    Write-Host "  https://$Domain$p -> $($r.StatusCode)  $([math]::Round($r.RawContentLength/1KB,1))KB" -ForegroundColor Green
  } catch {
    Write-Host "  https://$Domain$p -> 还未就绪" -ForegroundColor Yellow
  }
}
Write-Host ''
Write-Host "完成。你的工具站地址：https://$Domain" -ForegroundColor Cyan
