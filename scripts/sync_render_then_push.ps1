param(
  [string]$BaseUrl = "https://booklet-planner.onrender.com",
  [string]$Branch = "main",
  [string]$Remote = "origin",
  [string]$CommitMessage = "Sync live Render state before code push",
  [switch]$SkipPush
)

$ErrorActionPreference = "Stop"

Write-Host "[1/4] Snapshot live state from Render..."
& "$PSScriptRoot\snapshot_state_from_render.ps1" -BaseUrl $BaseUrl -OutputPath "state.json"

Write-Host "[2/4] Stage state.json..."
git add state.json

$hasChanges = (git diff --cached --name-only | Select-String -Pattern '^state\.json$') -ne $null
if (-not $hasChanges) {
  Write-Host "No state.json changes to commit."
} else {
  Write-Host "[3/4] Commit snapshot..."
  git commit -m $CommitMessage
}

if ($SkipPush) {
  Write-Host "SkipPush enabled. Snapshot committed (if needed), but not pushed."
  exit 0
}

Write-Host "[4/4] Push branch '$Branch' to '$Remote'..."
git push $Remote $Branch
Write-Host "Done. Render snapshot is now in Git before your code push."
