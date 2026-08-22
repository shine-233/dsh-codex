Write-Host 'cargo:' ([bool](Get-Command cargo -ErrorAction SilentlyContinue)); Write-Host 'rustc:' ((rustc --version 2>$null) -join '')
