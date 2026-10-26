$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
Push-Location $taskRepo
$previousTaskTemp = $env:TEMP
$previousTaskTmp = $env:TMP
$previousTaskBackend = $env:RSF_OS_BACKEND_FILE
try {
  $taskTemp = Join-Path $taskRepo '.local-test-tmp'
  New-Item -ItemType Directory -Force -Path $taskTemp | Out-Null
  $env:TEMP = $taskTemp
  $env:TMP = $taskTemp
  node tests/build-compatible-backend.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Compatible backend generation failed' }
  $env:RSF_OS_BACKEND_FILE = 'integration/Code.production-compatible.gs'
  node --test tests/os-ledger.test.cjs tests/os-independent.test.cjs tests/frontend.test.cjs
  if ($LASTEXITCODE -ne 0) { throw 'OS/API/UI checks failed' }
  node node_modules/typescript/bin/tsc --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'TypeScript failed' }
  node node_modules/vite/bin/vite.js build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
  node node_modules/vitest/vitest.mjs run
  if ($LASTEXITCODE -ne 0) { throw 'Root Vitest suite failed' }
  Write-Output 'Local checks passed. This does not deploy or validate live Google Sheets/WhatsApp.'
} finally {
  $env:TEMP = $previousTaskTemp
  $env:TMP = $previousTaskTmp
  $env:RSF_OS_BACKEND_FILE = $previousTaskBackend
  Pop-Location
}
