# Launches the local paid-door test rig in one command (`npm run paydoor:up`):
#   window 1: npm run dev                  (the app)
#   window 2: npm run paydoor:bridge       (webhook stand-in; prints your sign-in link)
#   browser:  Edge InPrivate on the landing page (signed-out, like a stranger)
# Pay with 4242 4242 4242 4242 or promo code JRC-TESTER ($0, no card). Within ~5s the
# bridge window prints a single-use sign-in link - open it in the SAME InPrivate window.
# Close the two PowerShell windows to stop. If port 3000 is already in use, window 1
# will say so - close the older server first.
$repo = Split-Path -Parent $PSScriptRoot

Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$repo'; npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$repo'; npm run paydoor:bridge"

Write-Host 'Waiting for the dev server on http://localhost:3000 ...'
for ($i = 0; $i -lt 30; $i++) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/welcome' -TimeoutSec 3
        if ($r.StatusCode -eq 200) { break }
    } catch {}
    Start-Sleep -Seconds 2
}

Start-Process msedge -ArgumentList '-inprivate', 'http://localhost:3000'
Write-Host ''
Write-Host 'Rig up. Buy with 4242... or code JRC-TESTER; your sign-in link prints in the bridge window.'
Write-Host 'Cleanup afterwards: npm run onboarding:cleanup'
