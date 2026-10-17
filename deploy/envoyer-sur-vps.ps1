# Envoie le projet sur ton VPS et lance l'installation (ou la mise à jour).
# À lancer depuis Windows (PowerShell), dans le dossier du projet :
#
#   powershell -ExecutionPolicy Bypass -File deploy\envoyer-sur-vps.ps1 -Serveur utilisateur@ip-du-vps -Domaine dashboard.mon-domaine.fr -Email moi@exemple.fr
#
# Prérequis : OpenSSH (inclus dans Windows 10/11 : commandes ssh et scp) et un
# compte sur le VPS qui peut utiliser sudo.
param(
    [Parameter(Mandatory = $true)][string]$Serveur,
    [Parameter(Mandatory = $true)][string]$Domaine,
    [string]$Email = "",
    [int]$Port = 22
)
$ErrorActionPreference = "Stop"

$projet = Split-Path -Parent $PSScriptRoot
$parent = Split-Path -Parent $projet
$nom = Split-Path -Leaf $projet
$archive = Join-Path $env:TEMP "smart-dashboard.tgz"

Write-Host "==> Préparation de l'archive (sans node_modules ni fichiers compilés)" -ForegroundColor Cyan
if (Test-Path $archive) { Remove-Item $archive }
# tar.exe de Windows (bsdtar) : un autre « tar » dans le PATH (Git, MSYS) comprendrait mal « C:\… ».
$tar = Join-Path $env:SystemRoot "System32\tar.exe"
& $tar -czf $archive -C $parent `
    --exclude "node_modules" --exclude "$nom/server/dist" --exclude "$nom/web/dist" `
    --exclude "$nom/server/data" --exclude "$nom/server/.env" --exclude "$nom/firmware" --exclude "$nom/.git" `
    $nom
if ($LASTEXITCODE -ne 0) { throw "tar a échoué" }
$taille = [math]::Round((Get-Item $archive).Length / 1MB, 1)
Write-Host "    $archive ($taille Mo)"

Write-Host "==> Envoi sur $Serveur" -ForegroundColor Cyan
scp -P $Port $archive "${Serveur}:/tmp/smart-dashboard.tgz"
if ($LASTEXITCODE -ne 0) { throw "scp a échoué (vérifie l'adresse et ton accès SSH)" }

Write-Host "==> Installation sur le VPS (le mot de passe sudo peut être demandé)" -ForegroundColor Cyan
$src = "/tmp/smart-dashboard-src/$nom"
$cmd = "rm -rf /tmp/smart-dashboard-src && mkdir -p /tmp/smart-dashboard-src && " +
       "tar -xzf /tmp/smart-dashboard.tgz -C /tmp/smart-dashboard-src && " +
       "sed -i 's/\r`$//' '$src/deploy/install.sh' && " +
       "sudo bash '$src/deploy/install.sh' '$Domaine' '$Email'"
ssh -t -p $Port $Serveur $cmd
if ($LASTEXITCODE -ne 0) { throw "l'installation a échoué (voir les messages ci-dessus)" }

Write-Host "==> Terminé : https://$Domaine" -ForegroundColor Green
