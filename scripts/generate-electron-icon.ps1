$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot "src\app\icon.svg"
$target = Join-Path $repoRoot "electron\icon.png"
$chromeCandidates = @(@(
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })

if (-not $chromeCandidates) {
  throw "Google Chrome is required to render the canonical SVG into the Electron PNG icon."
}

$sourceUri = [System.Uri]::new($source).AbsoluteUri
if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target
}
& $chromeCandidates[0] `
  "--headless=new" `
  "--disable-gpu" `
  "--hide-scrollbars" `
  "--force-device-scale-factor=1" `
  "--window-size=512,512" `
  "--screenshot=$target" `
  $sourceUri

for ($attempt = 0; $attempt -lt 30 -and -not (Test-Path -LiteralPath $target); $attempt++) {
  Start-Sleep -Milliseconds 100
}
if (-not (Test-Path -LiteralPath $target)) {
  throw "Electron icon generation did not produce $target."
}
