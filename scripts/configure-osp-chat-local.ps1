param(
  [string]$OspRoot = 'C:\Games\OSPanel',
  [string]$ProjectRoot = 'C:\Games\MySandbox\nothing-chat',
  [string]$Domain = 'chat.local',
  [string]$NginxModule = 'Nginx-1.26',
  [string]$NginxIp = '127.127.126.55',
  [int]$WebPort = 5173,
  [int]$ServerPort = 3000
)

$ErrorActionPreference = 'Stop'

# Converts Windows paths to the slash format expected by Nginx configs.
function Convert-ToNginxPath {
  param([string]$Path)

  return $Path.Replace('\', '/')
}

# Writes config files in UTF-8 without BOM so Nginx can parse them reliably.
function Set-FileContent {
  param(
    [string]$Path,
    [string]$Content
  )

  $directory = Split-Path -Parent $Path
  if ($directory -and -not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content.TrimEnd() + "`r`n", $utf8NoBom)
}

# Adds or replaces an owned text block without disturbing surrounding file content.
function Add-TextBlock {
  param(
    [string]$Path,
    [string]$StartMarker,
    [string]$EndMarker,
    [string]$Block
  )

  $content = Get-Content -LiteralPath $Path -Raw
  $escapedStart = [regex]::Escape($StartMarker)
  $escapedEnd = [regex]::Escape($EndMarker)
  $pattern = "(?s)$escapedStart.*?$escapedEnd"

  if ($content -match $pattern) {
    $content = [regex]::Replace($content, $pattern, $Block.TrimEnd())
  } else {
    $content = $content.TrimEnd() + "`r`n`r`n" + $Block.TrimEnd()
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $content.TrimEnd() + "`r`n", $utf8NoBom)
}

# Registers the custom project include in either an active Nginx config or an OSP template.
function Add-NginxInclude {
  param(
    [string]$NginxConfigPath,
    [string]$IncludePath
  )

  $content = Get-Content -LiteralPath $NginxConfigPath -Raw
  if ($content.Contains($IncludePath)) {
    return
  }

  $includeLine = "include                          '$IncludePath';"
  $nginxHostsToken = '{nginx_hosts}'
  $virtualHostsPattern = "(?m)^(#-{32}\r?\n# Virtual Hosts\r?\n#-{32}\r?\n)"

  if ($content.Contains($nginxHostsToken)) {
    $content = $content.Replace($nginxHostsToken, "$includeLine`r`n`r`n$nginxHostsToken")
  } elseif ($content -match $virtualHostsPattern) {
    $content = [regex]::Replace($content, $virtualHostsPattern, "`$1`r`n$includeLine`r`n", 1)
  } else {
    $defaultServerIndex = $content.IndexOf("server {")
    if ($defaultServerIndex -ge 0) {
      $content = $content.Insert($defaultServerIndex, "$includeLine`r`n`r`n")
    } else {
      $lastBraceIndex = $content.LastIndexOf('}')
      if ($lastBraceIndex -lt 0) {
        throw "Cannot find closing http block in $NginxConfigPath"
      }

      $content = $content.Insert($lastBraceIndex, "    $includeLine`r`n`r`n")
    }
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($NginxConfigPath, $content, $utf8NoBom)
}

# Ensures OSP has a local TLS certificate for the selected project domain.
function Ensure-ProjectCertificate {
  param(
    [string]$Root,
    [string]$Name,
    [string]$IpAddress
  )

  $certificateDirectory = Join-Path $Root "data\ssl\projects\$Name"
  $certificatePath = Join-Path $certificateDirectory 'cert.crt'
  $keyPath = Join-Path $certificateDirectory 'cert.key'
  if ((Test-Path -LiteralPath $certificatePath) -and (Test-Path -LiteralPath $keyPath)) {
    return
  }

  $tempV3Path = Join-Path $Root "temp\projects_${Name}_v3.txt"
  $v3Content = @"
[trust_cert]
authorityKeyIdentifier = keyid,issuer
basicConstraints       = CA:FALSE
keyUsage               = digitalSignature,nonRepudiation,keyEncipherment,dataEncipherment
extendedKeyUsage       = serverAuth,clientAuth,emailProtection
subjectAltName         = @alt_names

[alt_names]
DNS.1 = $Name
DNS.2 = www.$Name
IP.1 = $IpAddress
"@

  Set-FileContent -Path $tempV3Path -Content $v3Content

  $generatorPath = Join-Path $Root 'system\ssl\gen_cert.bat'
  & $generatorPath projects $Name
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to generate certificate for $Name"
  }
}

$projectDirectory = Join-Path $OspRoot "home\$Domain"
$projectOspDirectory = Join-Path $projectDirectory '.osp'
$projectPublicDirectory = Join-Path $projectDirectory 'public'
$nginxUserDirectory = Join-Path $OspRoot 'user\nginx'
$nginxIncludePath = Join-Path $nginxUserDirectory "$Domain.conf"
$nginxConfigPath = Join-Path $OspRoot "modules\$NginxModule\conf\nginx.conf"
$nginxTemplatePath = Join-Path $OspRoot "config\$NginxModule\default\templates\nginx.conf"
$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'

New-Item -ItemType Directory -Force -Path $projectOspDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $projectPublicDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $nginxUserDirectory | Out-Null

$projectIni = @"
[$Domain]

project_url = https://$Domain
public_dir = {base_dir}\public
nginx_engine = $NginxModule
aliases = www.$Domain
"@

Set-FileContent -Path (Join-Path $projectOspDirectory 'project.ini') -Content $projectIni

$placeholderHtml = @"
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <title>Nothing Shhh proxy</title>
  </head>
  <body>
    <p>Nothing Shhh is proxied from $ProjectRoot.</p>
  </body>
</html>
"@

Set-FileContent -Path (Join-Path $projectPublicDirectory 'index.html') -Content $placeholderHtml
Ensure-ProjectCertificate -Root $OspRoot -Name $Domain -IpAddress $NginxIp

$certificatePath = Convert-ToNginxPath (Join-Path $OspRoot "data\ssl\projects\$Domain\cert.crt")
$keyPath = Convert-ToNginxPath (Join-Path $OspRoot "data\ssl\projects\$Domain\cert.key")
$accessLogPath = Convert-ToNginxPath (Join-Path $OspRoot "logs\domains\${Domain}_nginx_access.log")
$errorLogPath = Convert-ToNginxPath (Join-Path $OspRoot "logs\domains\${Domain}_nginx_error.log")

$nginxConfig = @"
server {
    listen                       ${NginxIp}:80;
    listen                       ${NginxIp}:443 ssl;
    server_name                  $Domain www.$Domain;

    ssl_certificate              '$certificatePath';
    ssl_certificate_key          '$keyPath';

    access_log                   '$accessLogPath' combined;
    error_log                    '$errorLogPath' error;

    location /ws {
        proxy_cache_bypass       `$http_upgrade;
        proxy_http_version       1.1;
        proxy_pass               http://127.0.0.1:$ServerPort/ws;
        proxy_set_header         Connection `$connection_upgrade;
        proxy_set_header         Host `$host;
        proxy_set_header         Upgrade `$http_upgrade;
        proxy_set_header         X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_set_header         X-Forwarded-Proto `$scheme;
        proxy_set_header         X-Real-IP `$remote_addr;
    }

    location /api/ {
        proxy_http_version       1.1;
        proxy_pass               http://127.0.0.1:$ServerPort/api/;
        proxy_set_header         Host `$host;
        proxy_set_header         X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_set_header         X-Forwarded-Proto `$scheme;
        proxy_set_header         X-Real-IP `$remote_addr;
    }

    location /health {
        proxy_http_version       1.1;
        proxy_pass               http://127.0.0.1:$ServerPort/health;
        proxy_set_header         Host `$host;
        proxy_set_header         X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_set_header         X-Forwarded-Proto `$scheme;
        proxy_set_header         X-Real-IP `$remote_addr;
    }

    location / {
        proxy_cache_bypass       `$http_upgrade;
        proxy_http_version       1.1;
        proxy_pass               http://127.0.0.1:$WebPort;
        proxy_set_header         Connection `$connection_upgrade;
        proxy_set_header         Host `$host;
        proxy_set_header         Upgrade `$http_upgrade;
        proxy_set_header         X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_set_header         X-Forwarded-Proto `$scheme;
        proxy_set_header         X-Real-IP `$remote_addr;
    }
}
"@

Set-FileContent -Path $nginxIncludePath -Content $nginxConfig
Add-NginxInclude -NginxConfigPath $nginxTemplatePath -IncludePath (Convert-ToNginxPath $nginxIncludePath)
Add-NginxInclude -NginxConfigPath $nginxConfigPath -IncludePath (Convert-ToNginxPath $nginxIncludePath)

$hostsBlock = @"
# NOTHING CHAT: START
$NginxIp $Domain www.$Domain
# NOTHING CHAT: END
"@

Add-TextBlock -Path $hostsPath -StartMarker '# NOTHING CHAT: START' -EndMarker '# NOTHING CHAT: END' -Block $hostsBlock

Write-Host "Configured $Domain for OSP/Nginx proxy."
Write-Host "Project: $projectDirectory"
Write-Host "Nginx include: $nginxIncludePath"
Write-Host "Nginx template: $nginxTemplatePath"
