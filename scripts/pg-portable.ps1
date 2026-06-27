param(
  [ValidateSet('install', 'up', 'down', 'status', 'logs')]
  [string]$Command = 'status'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RootDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$LocalDir = Join-Path $RootDir '.local'
$DownloadsDir = Join-Path $LocalDir 'downloads'
$ArchivePath = Join-Path $DownloadsDir 'postgresql-17.10-windows-x64-binaries.zip'
$ExtractDir = Join-Path $LocalDir 'postgresql-17.10-extract'
$PgHome = Join-Path $LocalDir 'postgresql-17.10'
$DataDir = Join-Path $LocalDir 'pgdata'
$LogFile = Join-Path $LocalDir 'postgres.log'
$PasswordFile = Join-Path $LocalDir 'pg-password.txt'
$ArchiveUrl = 'https://sbp.enterprisedb.com/getfile.jsp?fileid=1260307'

$DbName = $env:POSTGRES_DB
if ([string]::IsNullOrWhiteSpace($DbName)) {
  $DbName = 'nothing_chat'
}

$DbUser = $env:POSTGRES_USER
if ([string]::IsNullOrWhiteSpace($DbUser)) {
  $DbUser = 'nothing_chat'
}

$DbPassword = $env:POSTGRES_PASSWORD
if ([string]::IsNullOrWhiteSpace($DbPassword)) {
  $DbPassword = 'nothing_chat'
}

$DbPort = $env:POSTGRES_PORT
if ([string]::IsNullOrWhiteSpace($DbPort)) {
  $DbPort = '5432'
}

function Resolve-PgBin {
  <#
    Locates the portable PostgreSQL binaries used by all database commands.
  #>
  $binDir = Join-Path $PgHome 'bin'
  if (-not (Test-Path (Join-Path $binDir 'pg_ctl.exe'))) {
    throw "Portable PostgreSQL is not installed. Run 'npm run db:install' or 'npm run db:up'."
  }

  return $binDir
}

function Assert-LocalPath {
  <#
    Prevents cleanup code from deleting anything outside the project-local runtime folder.
  #>
  param([string]$Path)

  $localFullPath = [System.IO.Path]::GetFullPath($LocalDir)
  $targetFullPath = [System.IO.Path]::GetFullPath($Path)
  if (-not $targetFullPath.StartsWith($localFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside .local: $targetFullPath"
  }
}

function Remove-LocalPath {
  <#
    Deletes generated PostgreSQL runtime files only after the path is verified.
  #>
  param([string]$Path)

  if (Test-Path $Path) {
    Assert-LocalPath $Path
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Install-Postgres {
  <#
    Downloads and extracts the official EDB PostgreSQL Windows x86-64 archive.
  #>
  New-Item -ItemType Directory -Force -Path $DownloadsDir, $LocalDir | Out-Null

  if (Test-Path (Join-Path $PgHome 'bin\pg_ctl.exe')) {
    Write-Host "Portable PostgreSQL already installed at $PgHome"
    return
  }

  if (-not (Test-Path $ArchivePath)) {
    Write-Host "Downloading PostgreSQL 17.10 Windows x86-64 binaries..."
    Invoke-WebRequest -Uri $ArchiveUrl -OutFile $ArchivePath -UseBasicParsing
  }

  Write-Host "Extracting PostgreSQL archive..."
  Remove-LocalPath $ExtractDir
  New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractDir -Force

  $pgCtl = Get-ChildItem -Path $ExtractDir -Recurse -Filter 'pg_ctl.exe' | Select-Object -First 1
  if ($null -eq $pgCtl) {
    throw 'Could not find pg_ctl.exe in the PostgreSQL archive.'
  }

  $extractedPgHome = Split-Path (Split-Path $pgCtl.FullName -Parent) -Parent
  Remove-LocalPath $PgHome
  Move-Item -LiteralPath $extractedPgHome -Destination $PgHome
  Remove-LocalPath $ExtractDir

  Write-Host "Portable PostgreSQL installed at $PgHome"
}

function Initialize-DataDir {
  <#
    Creates a local database cluster with the same credentials as the dev DATABASE_URL.
  #>
  if (Test-Path (Join-Path $DataDir 'PG_VERSION')) {
    return
  }

  $binDir = Resolve-PgBin
  New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null
  Set-Content -LiteralPath $PasswordFile -Value $DbPassword -NoNewline

  Write-Host "Initializing PostgreSQL data directory..."
  & (Join-Path $binDir 'initdb.exe') -D $DataDir -U $DbUser -A scram-sha-256 --pwfile=$PasswordFile -E UTF8 --locale=C
}

function Get-ServerStatus {
  <#
    Returns whether PostgreSQL accepts TCP connections for the project database user.
  #>
  if (-not (Test-Path (Join-Path $DataDir 'PG_VERSION'))) {
    return $false
  }

  $binDir = Resolve-PgBin
  & (Join-Path $binDir 'pg_isready.exe') -h 127.0.0.1 -p $DbPort -U $DbUser -d postgres | Out-Null
  return $LASTEXITCODE -eq 0
}

function Start-Postgres {
  <#
    Starts the local PostgreSQL server and ensures the application database exists.
  #>
  Install-Postgres
  Initialize-DataDir
  $binDir = Resolve-PgBin

  if (Get-ServerStatus) {
    Write-Host "Portable PostgreSQL is already running on 127.0.0.1:$DbPort"
  } else {
    Write-Host "Starting portable PostgreSQL on 127.0.0.1:$DbPort..."
    & (Join-Path $binDir 'pg_ctl.exe') -D $DataDir -l $LogFile -o "-h 127.0.0.1 -p $DbPort" -w start
    if ($LASTEXITCODE -ne 0 -and -not (Get-ServerStatus)) {
      throw 'PostgreSQL did not start. Run npm run db:logs for details.'
    }
  }

  Ensure-Database
}

function Ensure-Database {
  <#
    Creates the application database after the cluster is available.
  #>
  $binDir = Resolve-PgBin
  $oldPassword = $env:PGPASSWORD
  $env:PGPASSWORD = $DbPassword

  try {
    $exists = (& (Join-Path $binDir 'psql.exe') -h 127.0.0.1 -p $DbPort -U $DbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName';") -join ''
    if ($LASTEXITCODE -ne 0) {
      throw "Could not check whether database $DbName exists."
    }

    if ($exists.Trim() -ne '1') {
      Write-Host "Creating database $DbName..."
      & (Join-Path $binDir 'createdb.exe') -h 127.0.0.1 -p $DbPort -U $DbUser $DbName
      if ($LASTEXITCODE -ne 0) {
        throw "Could not create database $DbName."
      }
    } else {
      Write-Host "Database $DbName already exists."
    }
  } finally {
    $env:PGPASSWORD = $oldPassword
  }
}

function Stop-Postgres {
  <#
    Stops the portable PostgreSQL server without removing data.
  #>
  if (-not (Test-Path (Join-Path $DataDir 'PG_VERSION'))) {
    Write-Host 'Portable PostgreSQL data directory does not exist.'
    return
  }

  $binDir = Resolve-PgBin
  if (Get-ServerStatus) {
    & (Join-Path $binDir 'pg_ctl.exe') -D $DataDir -w -m fast stop
    if ($LASTEXITCODE -ne 0) {
      throw 'Could not stop PostgreSQL with pg_ctl.'
    }
  } else {
    Write-Host 'Portable PostgreSQL is not running.'
  }
}

function Show-Status {
  <#
    Prints the current state and connection string for the local database.
  #>
  if (-not (Test-Path (Join-Path $PgHome 'bin\pg_ctl.exe'))) {
    Write-Host 'Portable PostgreSQL is not installed.'
    return
  }

  if (Get-ServerStatus) {
    Write-Host "Portable PostgreSQL is running on 127.0.0.1:$DbPort"
  } else {
    Write-Host 'Portable PostgreSQL is installed but not running.'
  }

  Write-Host "DATABASE_URL=postgres://$DbUser`:***@127.0.0.1:$DbPort/$DbName"
}

function Show-Logs {
  <#
    Shows recent PostgreSQL logs for quick local diagnostics.
  #>
  if (Test-Path $LogFile) {
    Get-Content -LiteralPath $LogFile -Tail 120
  } else {
    Write-Host 'PostgreSQL log file does not exist yet.'
  }
}

switch ($Command) {
  'install' { Install-Postgres }
  'up' { Start-Postgres }
  'down' { Stop-Postgres }
  'status' { Show-Status }
  'logs' { Show-Logs }
}
