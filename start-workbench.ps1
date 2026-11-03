$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$node = (Get-Command node -ErrorAction Stop).Source
$server = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden -PassThru
try {
  $url = 'http://127.0.0.1:4173'
  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    try {
      Invoke-RestMethod "$url/api/health" -TimeoutSec 1 | Out-Null
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $ready) { throw '工作台未能启动，请检查 Node.js 和 4173 端口。' }
  Start-Process $url
  Write-Host "StarMemory 工作台已启动：$url"
  Write-Host '关闭此窗口或按 Ctrl+C 停止服务。'
  Wait-Process -Id $server.Id
} finally {
  if (-not $server.HasExited) { Stop-Process -Id $server.Id }
}