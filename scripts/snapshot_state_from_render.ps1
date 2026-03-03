param(
  [string]$BaseUrl = "https://booklet-planner.onrender.com",
  [string[]]$Booklets = @("mykonos", "santorini", "paros", "flying-to-greece", "best-destinations"),
  [string]$OutputPath = "state.json"
)

$ErrorActionPreference = "Stop"

function Get-BookletState {
  param([string]$Url, [string]$Booklet)

  $endpoint = "$Url/api/state?booklet=$([uri]::EscapeDataString($Booklet))"
  try {
    return Invoke-RestMethod -Method Get -Uri $endpoint
  }
  catch {
    Write-Warning "Could not fetch booklet '$Booklet' from $endpoint"
    return $null
  }
}

$store = [ordered]@{ booklets = [ordered]@{} }

foreach ($booklet in $Booklets) {
  $state = Get-BookletState -Url $BaseUrl -Booklet $booklet
  if ($null -ne $state) {
    $store.booklets[$booklet] = $state
    $filled = 0
    if ($state.assignments) {
      $filled = ($state.assignments.PSObject.Properties | Where-Object { $_.Value.Count -gt 0 }).Count
    }
    Write-Host "Fetched $booklet (pages=$($state.pages), names=$($state.names.Count), filledPages=$filled)"
  }
}

if ($store.booklets.Count -eq 0) {
  throw "No booklet states were fetched. Aborting snapshot write."
}

$json = $store | ConvertTo-Json -Depth 80
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Resolve-Path .\).Path + "\$OutputPath", $json, $utf8NoBom)

Write-Host "Snapshot saved to $OutputPath"
Write-Host "Next: git add state.json; git commit -m 'Snapshot live booklet state'; git push"
