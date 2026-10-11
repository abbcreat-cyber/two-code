param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference = 'Stop'
$qaBase = [IO.Path]::GetFullPath('D:\Apps\TwoCode\qa').TrimEnd('\')
$target = [IO.Path]::GetFullPath($Root).TrimEnd('\')
if ($target -notmatch '^D:\\Apps\\TwoCode\\qa\\environment-coding-\d+$' -or -not $target.StartsWith($qaBase + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '不是本验收拥有的根目录' }
$owner = Get-Content -LiteralPath (Join-Path $target 'owner.json') -Raw | ConvertFrom-Json
if ($owner.kind -ne 'two-code-environment-qa' -or [IO.Path]::GetFullPath($owner.root).TrimEnd('\') -ne $target) { throw '所有权标记不一致' }
$disposed = Get-Content -LiteralPath (Join-Path $target 'disposed.json') -Raw | ConvertFrom-Json
$report = Join-Path 'D:\Apps\TwoCode\reports' ([IO.Path]::GetFileName($target))
New-Item -ItemType Directory -Path $report -Force | Out-Null
$tasks = @(Get-ChildItem -LiteralPath (Join-Path $target 'data\tasks') -Filter '*.json' | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json })
foreach ($task in $tasks) {
  if ($task.status -eq 'running' -or $task.id -notin $disposed.taskIds) { throw '会话未退出或不属于本轮' }
  $workspace = [IO.Path]::GetFullPath($task.workspacePath).TrimEnd('\')
  if (-not $workspace.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '工作区越界' }
  $name = [IO.Path]::GetFileName($workspace)
  $evidence = [ordered]@{ id=$task.id; title=$task.title; status=$task.status; leadSession=$task.lead.sessionId; sidekickSession=$task.sidekick.sessionId; leadReport=$task.lead.lastReport; sidekickReport=$task.sidekick.lastReport; events=@($task.events | Where-Object { $_.kind -in @('verification','handoff','handoff_report','error') }) }
  $evidence | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath (Join-Path $report ($name + '-evidence.json')) -Encoding utf8
  foreach ($file in @('actual.png','screen.png','device-result.json','vm-result.json','.qa\ledger.jsonl')) {
    $source=Join-Path $workspace $file
    if(Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $report ($name+'-'+[IO.Path]::GetFileName($file))) }
  }
}
foreach ($file in @('results.json','android-resume.json','typecheck.log','lint.log','run.log','resume.log')) {
  if(Test-Path -LiteralPath (Join-Path $target $file)) { Copy-Item -LiteralPath (Join-Path $target $file) -Destination $report }
}
foreach($uiName in @('ui','ui-layout')) {
if (Test-Path -LiteralPath (Join-Path $target "$uiName\results.json")) {
  $uiReport=Join-Path $report $uiName
  New-Item -ItemType Directory -Path $uiReport -Force | Out-Null
  Get-ChildItem -LiteralPath (Join-Path $target $uiName) -File | Where-Object { $_.Name -eq 'results.json' -or $_.Extension -eq '.png' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $uiReport }
}
}
# 按专属 AVD 路径和端口确认进程，绝不关闭用户其他模拟器。
$emulators=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(emulator|qemu-system-x86_64).*\.exe$' -and $_.CommandLine -match 'two-code-qa' -and $_.CommandLine -match '5580' })
if ($emulators.Count -and (Test-Path -LiteralPath (Join-Path $target 'emulator.pid'))) {
  $ownedEmulatorPid=[int](Get-Content -LiteralPath (Join-Path $target 'emulator.pid'))
  if (@($emulators | Where-Object { $_.ProcessId -eq $ownedEmulatorPid -or $_.ParentProcessId -eq $ownedEmulatorPid }).Count -eq 0) { throw '模拟器PID不属于本轮，保留并退出' }
  & 'D:\dev\android-sdk\platform-tools\adb.exe' -s emulator-5580 emu kill | Out-Null
  foreach($proc in $emulators) { Wait-Process -Id $proc.ProcessId -Timeout 20 -ErrorAction SilentlyContinue }
}
$remaining=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(emulator|qemu-system-x86_64).*\.exe$' -and $_.CommandLine -match 'two-code-qa' -and $_.CommandLine -match '5580' })
if ($remaining.Count -and (Test-Path -LiteralPath (Join-Path $target 'emulator.pid'))) { throw '所属模拟器尚未退出，保留临时目录' }
$removedNative=@()
$claudeBase=[IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.claude\projects')).TrimEnd('\')
foreach($task in $tasks) {
  $projectName=$task.workspacePath -replace '[^a-zA-Z0-9]','-'
  $project=[IO.Path]::GetFullPath((Join-Path $claudeBase $projectName))
  if (-not $project.StartsWith($claudeBase+'\',[StringComparison]::OrdinalIgnoreCase)) { throw '原生目录越界' }
  if(Test-Path -LiteralPath $project) {
    $jsonls=@(Get-ChildItem -LiteralPath $project -Filter '*.jsonl')
    if($jsonls.Count -eq 1 -and $jsonls[0].BaseName -eq $task.sidekick.sessionId) {
      Remove-Item -LiteralPath $project -Recurse -Force
      $removedNative+=$project
    } else { throw "原生目录包含未确认会话，保留：$project" }
  }
}
# Emulator 的退出看门狗短暂继承日志句柄；等待它自然退出，不误杀共享进程。
for ($attempt=0; $attempt -lt 15; $attempt++) {
  try { Remove-Item -LiteralPath $target -Recurse -Force; break }
  catch { if ($attempt -eq 14) { throw }; Start-Sleep -Seconds 2 }
}
@{root=$target;removed=(-not(Test-Path -LiteralPath $target));nativeProjects=$removedNative;taskIds=$disposed.taskIds;at=[DateTimeOffset]::Now.ToString('o')} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $report 'cleanup.json') -Encoding utf8
Write-Output $report
