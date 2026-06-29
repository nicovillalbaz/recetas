param(
  [int[]]$Ports = @(54580, 54581, 54582),
  [int]$WaitSeconds = 20
)

$ErrorActionPreference = "Stop"

function Test-TcpPort {
  param([int]$Port)

  $client = [System.Net.Sockets.TcpClient]::new()

  try {
    $task = $client.ConnectAsync("127.0.0.1", $Port)

    if (-not $task.Wait(1200)) {
      return $false
    }

    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Test-TlsPort {
  param([int]$Port)

  $client = [System.Net.Sockets.TcpClient]::new()
  $errorsText = ""
  $remoteSubject = ""
  $remoteIssuer = ""

  try {
    $client.Connect("127.0.0.1", $Port)
    $sslStream = [System.Net.Security.SslStream]::new(
      $client.GetStream(),
      $false,
      {
        param($sender, $certificate, $chain, $sslPolicyErrors)

        $script:autofirmaTlsErrors = $sslPolicyErrors.ToString()

        if ($certificate) {
          $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificate)
          $script:autofirmaTlsSubject = $cert.Subject
          $script:autofirmaTlsIssuer = $cert.Issuer
        }

        return $sslPolicyErrors -eq [System.Net.Security.SslPolicyErrors]::None
      }
    )

    try {
      $sslStream.AuthenticateAsClient("127.0.0.1")
    } catch {
      $errorsText = $_.Exception.Message
    }

    $remoteSubject = $script:autofirmaTlsSubject
    $remoteIssuer = $script:autofirmaTlsIssuer

    return [PSCustomObject]@{
      Port = $Port
      TlsHandshakeAccepted = [string]::IsNullOrWhiteSpace($errorsText)
      PolicyErrors = $script:autofirmaTlsErrors
      Subject = $remoteSubject
      Issuer = $remoteIssuer
      Error = $errorsText
    }
  } catch {
    return [PSCustomObject]@{
      Port = $Port
      TlsHandshakeAccepted = $false
      PolicyErrors = ""
      Subject = ""
      Issuer = ""
      Error = $_.Exception.Message
    }
  } finally {
    $client.Dispose()
  }
}

$portsText = ($Ports -join ",")
$uri = "afirma://websocket?ports=$portsText&v=4&jvc=4&idsession=duran-diagnostic&dlgload=false"

Write-Host "Lanzando AutoFirma en modo WebSocket:"
Write-Host "  $uri"
Start-Process $uri

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$openPorts = @()

while ((Get-Date) -lt $deadline -and $openPorts.Count -eq 0) {
  Start-Sleep -Milliseconds 600
  $openPorts = @($Ports | Where-Object { Test-TcpPort -Port $_ })
}

if ($openPorts.Count -eq 0) {
  Write-Host ""
  Write-Host "No se detecto ningun puerto WebSocket abierto por AutoFirma."
  exit 2
}

Write-Host ""
Write-Host "Puertos TCP abiertos detectados:"
$openPorts | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "Resultado TLS:"
$openPorts | ForEach-Object { Test-TlsPort -Port $_ } | Format-List
