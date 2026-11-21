<#
.SYNOPSIS
  AX_AIDD 저장소를 GitHub(origin/main)에 올립니다.

.DESCRIPTION
  1. 커밋하지 않은 변경이 있으면 보여 주고, -Message를 주면 커밋합니다.
  2. origin main으로 push합니다.
  3. 403(권한 없음)으로 실패하면 해결 방법을 안내합니다.
     -ResetCredential을 주면 저장된 GitHub 로그인 정보를 지우고 다시 시도합니다
     (다시 시도할 때 브라우저 로그인 창이 뜹니다).

.EXAMPLE
  .\scripts\git-push.ps1
  .\scripts\git-push.ps1 -ResetCredential
  .\scripts\git-push.ps1 -Message "P3: PRD 생성"
#>
param(
  [string]$Message,
  [switch]$ResetCredential
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "== 저장소: $(Get-Location)" -ForegroundColor Cyan
git remote -v | Select-Object -First 1

# 1. 커밋하지 않은 변경
$changes = git status --porcelain
if ($changes) {
  Write-Host "`n== 커밋하지 않은 변경" -ForegroundColor Yellow
  git status --short
  if ($Message) {
    # .env 파일이 섞여 들어가지 않았는지 확인
    if ($changes | Where-Object { $_ -match '\.env' -and $_ -notmatch 'env\.example' }) {
      Write-Host "`n.env 파일이 변경 목록에 있습니다. 비밀값이 커밋되지 않도록 중단합니다." -ForegroundColor Red
      exit 1
    }
    git add -A
    git commit -m $Message
  } else {
    Write-Host "`n(-Message `"커밋 메시지`"를 주면 함께 커밋합니다. 지금은 커밋된 내용만 push합니다.)" -ForegroundColor DarkGray
  }
}

# 2. 저장된 로그인 정보 초기화 (선택)
if ($ResetCredential) {
  Write-Host "`n== 저장된 GitHub 로그인 정보 삭제" -ForegroundColor Cyan
  cmdkey /delete:git:https://github.com 2>$null | Out-Null
  "protocol=https`nhost=github.com`n" | git credential reject
  Write-Host "삭제했습니다. push할 때 로그인 창이 뜨면 저장소 소유 계정으로 로그인하세요."
}

# 3. push
Write-Host "`n== 올릴 커밋" -ForegroundColor Cyan
git fetch origin main 2>$null
git log --oneline origin/main..HEAD

Write-Host "`n== push" -ForegroundColor Cyan
$out = git push origin main 2>&1
$code = $LASTEXITCODE
$out | ForEach-Object { Write-Host $_ }

if ($code -eq 0) {
  Write-Host "`n완료했습니다." -ForegroundColor Green
  exit 0
}

if ("$out" -match "403|Permission .* denied") {
  Write-Host @"

push 권한이 없습니다(403). 이 PC에 저장된 GitHub 로그인 정보가 이 저장소에 쓸 수 없는 토큰입니다.
  방법 1) .\scripts\git-push.ps1 -ResetCredential  (저장된 정보를 지우고 브라우저로 다시 로그인)
  방법 2) GitHub → Settings → Developer settings → Personal access tokens 에서
          이 저장소에 Contents: Read and write 권한이 있는 토큰을 만들고, 로그인 창에서 비밀번호 대신 입력
"@ -ForegroundColor Yellow
} elseif ("$out" -match "rejected|fetch first|non-fast-forward") {
  Write-Host "`n원격에 로컬에 없는 커밋이 있습니다. 'git pull --rebase origin main' 후 다시 실행하세요." -ForegroundColor Yellow
}
exit $code
