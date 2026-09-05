<# Cache generation only. Does not persist/sync notes or restart the tutor.
   Default: hidden, 4 workers, entire freshly snapshotted deck. No auto restart.
   -DryRun exports/checks the queue without calling Luna.
   -Status / -Stop are read-only status / graceful stop requests.
   After fixing a stop cause: -Resume clears a stop request; -RetryFailed resets
   per-pair exhausted budgets explicitly. Dead process lock: node worker --recover-lock.
#>
param(
    [ValidateRange(1,20)][int]$Workers = 4,
    [ValidateRange(1,2147483647)][int]$Limit = 2147483647,
    [string]$Python = (Join-Path $PSScriptRoot '.venv\Scripts\python.exe'),
    [string]$Node = (Get-Command node -ErrorAction Stop).Source,
    [switch]$Foreground,
    [switch]$DryRun,
    [switch]$Status,
    [switch]$Stop,
    [switch]$Resume,
    [switch]$RetryFailed
)
$ErrorActionPreference = 'Stop'
$colorRoot = $PSScriptRoot
$workerPath = Join-Path $colorRoot 'process-batch-colors.mjs'
if ($Status) { & $Node $workerPath --status; exit $LASTEXITCODE }
if ($Stop) { & $Node $workerPath --stop; exit $LASTEXITCODE }
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) { throw 'Task Python is missing; supply -Python with the Anki-capable environment.' }
if (-not (Test-Path -LiteralPath $Node -PathType Leaf)) { throw 'Node is missing; supply -Node.' }
if (Test-Path -LiteralPath (Join-Path $colorRoot 'coloring.lock')) { throw 'A worker lock exists; inspect -Status first.' }
if (-not $Foreground -and -not $DryRun) {
    # No execution-policy override, scheduled task, login or power-setting changes.
    $shellPath = (Get-Process -Id $PID).Path
    $launchArgs = @('-NoProfile', '-File', ('"' + $PSCommandPath + '"'), '-Foreground',
        '-Workers', $Workers, '-Limit', $Limit, '-Python', ('"' + $Python + '"'), '-Node', ('"' + $Node + '"'))
    if ($Resume) { $launchArgs += '-Resume' }
    if ($RetryFailed) { $launchArgs += '-RetryFailed' }
    $launchId = [Guid]::NewGuid().ToString('N')
    $child = Start-Process -FilePath $shellPath -ArgumentList $launchArgs -WorkingDirectory $colorRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $colorRoot "coloring-$launchId.log") `
        -RedirectStandardError (Join-Path $colorRoot "coloring-$launchId.error.log")
    Write-Output "Started coloring launcher PID $($child.Id). Check -Status and coloring-$launchId.error.log."
    exit
}
$stopPath = Join-Path $colorRoot 'coloring.stop'
if (Test-Path -LiteralPath $stopPath) {
    if (-not $Resume) { throw 'A stop request remains. Use -Resume explicitly after checking the cause.' }
    Remove-Item -LiteralPath $stopPath
}
& $Python (Join-Path $colorRoot 'export-upcoming-colors.py')
if ($LASTEXITCODE -ne 0) { throw 'Snapshot export failed; no provider requests started.' }
$workerArgs = @($workerPath, $Workers, $Limit)
if ($DryRun) { $workerArgs += '--dry-run' }
if ($RetryFailed) { $workerArgs += '--retry-failed' }
& $Node @workerArgs
exit $LASTEXITCODE
