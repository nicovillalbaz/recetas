param(
  [string]$AutoFirmaPath,
  [switch]$CheckOnly,
  [switch]$OpenTest
)

$ErrorActionPreference = "Stop"

$candidates = New-Object System.Collections.Generic.List[object]

function Add-AutoFirmaCandidate {
  param(
    [string]$Path,
    [string]$Source
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return
  }

  $cleanPath = [Environment]::ExpandEnvironmentVariables($Path.Trim())
  $cleanPath = $cleanPath.Trim('"')

  if (-not (Test-Path -LiteralPath $cleanPath -PathType Leaf)) {
    return
  }

  $resolvedPath = (Get-Item -LiteralPath $cleanPath).FullName
  $alreadyAdded = $candidates | Where-Object { $_.Path -ieq $resolvedPath } | Select-Object -First 1

  if ($alreadyAdded) {
    return
  }

  $candidates.Add([PSCustomObject]@{
    Path = $resolvedPath
    Source = $Source
  }) | Out-Null
}

function Get-DefaultRegistryValue {
  param([string]$LiteralPath)

  try {
    return (Get-ItemProperty -LiteralPath $LiteralPath -ErrorAction Stop)."(default)"
  } catch {
    return ""
  }
}

function Convert-CommandToExePath {
  param([string]$Command)

  if ([string]::IsNullOrWhiteSpace($Command)) {
    return ""
  }

  $trimmed = $Command.Trim()

  if ($trimmed -match '^"([^"]+\.exe)"') {
    return $matches[1]
  }

  if ($trimmed -match '^(.*?\.exe)') {
    return $matches[1].Trim()
  }

  return ""
}

function Convert-DisplayIconToExePath {
  param([string]$DisplayIcon)

  if ([string]::IsNullOrWhiteSpace($DisplayIcon)) {
    return ""
  }

  $path = Convert-CommandToExePath $DisplayIcon

  if ($path) {
    return $path
  }

  return ($DisplayIcon -replace ',\d+$', '').Trim('"')
}

if ($AutoFirmaPath) {
  Add-AutoFirmaCandidate -Path $AutoFirmaPath -Source "ruta indicada manualmente"
}

$registryCommandPaths = @(
  "HKCU:\Software\Classes\afirma\shell\open\command",
  "HKLM:\Software\Classes\afirma\shell\open\command",
  "Registry::HKEY_CLASSES_ROOT\afirma\shell\open\command"
)

$currentCommands = @()

foreach ($registryCommandPath in $registryCommandPaths) {
  $command = Get-DefaultRegistryValue -LiteralPath $registryCommandPath

  if ($command) {
    $currentCommands += [PSCustomObject]@{
      Path = $registryCommandPath
      Command = $command
    }
    Add-AutoFirmaCandidate -Path (Convert-CommandToExePath $command) -Source "registro: $registryCommandPath"
  }
}

$programFilesX86 = ${env:ProgramFiles(x86)}
$commonPaths = @(
  "$env:ProgramFiles\Autofirma\Autofirma\Autofirma.exe",
  "$env:ProgramFiles\AutoFirma\AutoFirma.exe",
  "$env:ProgramFiles\AutoFirma\Autofirma.exe",
  $(if ($programFilesX86) { "$programFilesX86\Autofirma\Autofirma\Autofirma.exe" }),
  $(if ($programFilesX86) { "$programFilesX86\AutoFirma\AutoFirma.exe" }),
  "$env:LOCALAPPDATA\Programs\Autofirma\Autofirma.exe",
  "$env:LOCALAPPDATA\Programs\Autofirma\Autofirma\Autofirma.exe",
  "$env:LOCALAPPDATA\Programs\AutoFirma\AutoFirma.exe",
  "$env:ProgramData\Autofirma\Autofirma.exe"
)

foreach ($path in $commonPaths) {
  Add-AutoFirmaCandidate -Path $path -Source "ruta comun"
}

foreach ($commandName in @("Autofirma.exe", "AutoFirma.exe")) {
  $command = Get-Command $commandName -ErrorAction SilentlyContinue | Select-Object -First 1

  if ($command -and $command.Source) {
    Add-AutoFirmaCandidate -Path $command.Source -Source "PATH: $commandName"
  }
}

$uninstallRoots = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

foreach ($uninstallRoot in $uninstallRoots) {
  $items = Get-ItemProperty -Path $uninstallRoot -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "*AutoFirma*" -or $_.DisplayName -like "*Autofirma*" }

  foreach ($item in $items) {
    if ($item.DisplayIcon) {
      Add-AutoFirmaCandidate -Path (Convert-DisplayIconToExePath $item.DisplayIcon) -Source "desinstalador: DisplayIcon"
    }

    if ($item.InstallLocation) {
      Add-AutoFirmaCandidate -Path (Join-Path $item.InstallLocation "Autofirma.exe") -Source "desinstalador: InstallLocation"
      Add-AutoFirmaCandidate -Path (Join-Path $item.InstallLocation "AutoFirma.exe") -Source "desinstalador: InstallLocation"
      Add-AutoFirmaCandidate -Path (Join-Path $item.InstallLocation "Autofirma\Autofirma.exe") -Source "desinstalador: InstallLocation"
      Add-AutoFirmaCandidate -Path (Join-Path $item.InstallLocation "AutoFirma\AutoFirma.exe") -Source "desinstalador: InstallLocation"
    }
  }
}

if (-not $candidates -or $candidates.Count -eq 0) {
  throw "No se encontro Autofirma.exe. Ejecuta de nuevo indicando la ruta: -AutoFirmaPath `"C:\ruta\Autofirma.exe`""
}

$autoFirmaExe = $candidates[0].Path
$desiredCommand = "`"$autoFirmaExe`" `"%1`""
$protocolRoot = "HKCU:\Software\Classes\afirma"
$commandKey = "$protocolRoot\shell\open\command"

Write-Host "AutoFirma encontrado:"
Write-Host "  $autoFirmaExe"
Write-Host "  origen: $($candidates[0].Source)"
Write-Host ""

if ($candidates.Count -gt 1) {
  Write-Host "Otras ubicaciones detectadas:"
  $candidates | Select-Object -Skip 1 | ForEach-Object {
    Write-Host "  $($_.Path) ($($_.Source))"
  }
  Write-Host ""
}

Write-Host "Comandos actuales registrados en Windows:"
if ($currentCommands.Count -gt 0) {
  $currentCommands | ForEach-Object {
    Write-Host "  $($_.Path)"
    Write-Host "    $($_.Command)"
  }
} else {
  Write-Host "  Sin protocolo afirma:// registrado"
}
Write-Host ""
Write-Host "Comando recomendado:"
Write-Host "  $desiredCommand"
Write-Host ""

if ($CheckOnly) {
  Write-Host "Modo CheckOnly: no se hicieron cambios."
  exit 0
}

New-Item -Path $protocolRoot -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:Afirma Protocol"
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null

New-Item -Path "$protocolRoot\shell" -Force | Out-Null
New-Item -Path "$protocolRoot\shell\open" -Force | Out-Null
New-Item -Path $commandKey -Force | Out-Null
Set-Item -Path $commandKey -Value $desiredCommand

Write-Host "Protocolo afirma:// reparado para el usuario actual."
Write-Host "Cierra Chrome completamente y vuelve a abrirlo antes de probar la firma."

if ($OpenTest) {
  Write-Host ""
  Write-Host "Abriendo prueba de protocolo afirma://..."
  Start-Process "afirma://websocket?ports=49152,49153&v=4&jvc=4&idsession=duran-test"

  Start-Sleep -Seconds 6
  $process = Get-Process -Name "Autofirma" -ErrorAction SilentlyContinue | Select-Object -First 1

  if ($process) {
    Write-Host "AutoFirma esta en ejecucion. PID: $($process.Id)"
  } else {
    Write-Host "No se detecto el proceso Autofirma tras la prueba. Si viste una ventana o aviso de AutoFirma, puede haberse cerrado despues de la prueba."
  }
}
