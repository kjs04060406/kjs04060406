$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$git = (Get-Command git -ErrorAction Stop).Source
$node = (Get-Command node -ErrorAction Stop).Source
$safe = "safe.directory=$($repo.Replace('\', '/'))"

& $node (Join-Path $PSScriptRoot 'render-codex-activity.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Codex 활동 그래프 생성 실패' }

& $git -c $safe -C $repo add README.md assets/codex-activity.svg data/codex-daily.csv
if ($LASTEXITCODE -ne 0) { throw 'Git staging 실패' }
& $git -c $safe -C $repo diff --cached --quiet
if ($LASTEXITCODE -eq 0) { exit 0 }
& $git -c $safe -c 'user.name=kjs04060406' -c 'user.email=221166851+kjs04060406@users.noreply.github.com' -C $repo commit -m 'Update Codex token activity'
if ($LASTEXITCODE -ne 0) { throw 'Git commit 실패' }
& $git -c $safe -C $repo push origin main
if ($LASTEXITCODE -ne 0) { throw 'Git push 실패' }
