param(
    [string]$BaseUrl = "http://127.0.0.1:8000",
    [string]$Email = "admin@trading-ia.com",
    [string]$Password = "Admin!ChangeMe2026",
    [string]$DepositAmount = "50.00",
    [string]$AllocateAmount = "25.00"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Step-Ok {
    param([string]$Message)
    Write-Host ("[OK] " + $Message) -ForegroundColor Green
}

function Step-Fail {
    param([string]$Message)
    Write-Host ("[KO] " + $Message) -ForegroundColor Red
}

$failures = @()

try {
    $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/health" -TimeoutSec 5
    if ($health.status -eq "ok") {
        Step-Ok "API health"
    }
    else {
        throw "Unexpected status: $($health.status)"
    }
}
catch {
    $msg = "API health failed: $($_.Exception.Message)"
    Step-Fail $msg
    $failures += $msg
}

$token = $null
$userId = $null
try {
    $loginBody = @{
        email = $Email
        password = $Password
    } | ConvertTo-Json

    $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -ContentType "application/json" -Body $loginBody
    $token = $login.access_token
    $userId = $login.user.id

    if (-not $token) { throw "Missing token in login response" }
    if (-not $userId) { throw "Missing user id in login response" }
    Step-Ok "Login and token retrieval"
}
catch {
    $msg = "Login failed: $($_.Exception.Message)"
    Step-Fail $msg
    $failures += $msg
}

if ($token -and $userId) {
    $headers = @{ Authorization = "Bearer $token" }

    try {
        $me = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/auth/me" -Headers $headers
        if ($me.id -eq $userId) {
            Step-Ok "Bearer token validation (/auth/me)"
        }
        else {
            throw "User mismatch in /auth/me"
        }
    }
    catch {
        $msg = "Token validation failed: $($_.Exception.Message)"
        Step-Fail $msg
        $failures += $msg
    }

    try {
        $depositBody = @{
            amount = $DepositAmount
            payment_method = "pm_card_visa"
        } | ConvertTo-Json

        $deposit = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/wallets/$userId/deposit" -Headers $headers -ContentType "application/json" -Body $depositBody
        if ($deposit.wallet.solde_total) {
            Step-Ok "Wallet deposit"
        }
        else {
            throw "Deposit response missing wallet"
        }
    }
    catch {
        $msg = "Deposit failed: $($_.Exception.Message)"
        Step-Fail $msg
        $failures += $msg
    }

    try {
        $allocateBody = @{
            amount = $AllocateAmount
        } | ConvertTo-Json

        $allocate = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/wallets/$userId/allocate" -Headers $headers -ContentType "application/json" -Body $allocateBody
        if ($allocate.wallet.solde_engage) {
            Step-Ok "Wallet allocation"
        }
        else {
            throw "Allocation response missing wallet"
        }
    }
    catch {
        $msg = "Allocation failed: $($_.Exception.Message)"
        Step-Fail $msg
        $failures += $msg
    }
}

if ($failures.Count -eq 0) {
    Write-Host "[RESULT] ALL CHECKS PASSED" -ForegroundColor Green
    exit 0
}

Write-Host "[RESULT] SOME CHECKS FAILED:" -ForegroundColor Red
foreach ($failure in $failures) {
    Write-Host (" - " + $failure) -ForegroundColor Red
}
exit 1
