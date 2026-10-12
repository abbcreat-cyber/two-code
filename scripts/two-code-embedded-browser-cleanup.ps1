param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
$target=[IO.Path]::GetFullPath($Root).TrimEnd('\')
if($target -notmatch '^D:\\Apps\\TwoCode\\qa\\(embedded-browser|glm-coordination|role-swap|three-harness|step-plan-harness)-\d+$'){throw '不是所属QA目录'}
$expectedKind=if($target -match '\\step-plan-harness-\d+$'){'two-code-step-plan-harness-qa'}elseif($target -match '\\three-harness-\d+$'){'two-code-three-harness-qa'}elseif($target -match '\\role-swap-\d+$'){'two-code-role-swap-qa'}elseif($target -match '\\glm-coordination-\d+$'){'two-code-glm-coordination-qa'}else{'two-code-embedded-browser-qa'}
$owner=Get-Content -LiteralPath (Join-Path $target 'owner.json') -Raw|ConvertFrom-Json
if($owner.kind -ne $expectedKind -or [IO.Path]::GetFullPath($owner.root).TrimEnd('\') -ne $target){throw '所有权不一致'}
if(-not(Test-Path -LiteralPath (Join-Path $target 'closed.json'))){throw '测试应用未确认关闭'}
$closed=Get-Content -LiteralPath (Join-Path $target 'closed.json') -Raw|ConvertFrom-Json
$report=Join-Path 'D:\Apps\TwoCode\reports' ([IO.Path]::GetFileName($target))
New-Item -ItemType Directory -Path $report -Force|Out-Null
Get-ChildItem -LiteralPath $target -File|Where-Object {$_.Name -in @('results.json','initial-results.json','continuations.json','comparison.json','comparison.md','native-browser-evidence.json','native-model-evidence.json','artifacts.json','adjudication.json','ui-result.json','desktop-restart.json') -or $_.Extension -eq '.png'}|ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $report}
$tasks=@(Get-ChildItem -LiteralPath (Join-Path $target 'data\tasks') -Filter '*.json'|ForEach-Object {Get-Content -LiteralPath $_.FullName -Raw|ConvertFrom-Json})
foreach($task in $tasks){
  if($task.status -eq 'running'){throw '测试任务尚未结束'}
  if($expectedKind -ne 'two-code-embedded-browser-qa' -and $task.id -notin $closed.taskIds){throw '任务不属于已结束的本轮验收'}
  if(-not([IO.Path]::GetFullPath($task.workspacePath).StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase))){throw '任务工作区越界'}
  @{id=$task.id;status=$task.status;lead=$task.lead.lastReport;sidekick=$task.sidekick.lastReport;events=@($task.events|Where-Object {$_.kind -in @('tool','tool_end','verification','handoff','handoff_report','error')})}|ConvertTo-Json -Depth 15|Set-Content -LiteralPath (Join-Path $report ($task.id+'-evidence.json')) -Encoding utf8
  $nativeBase=[IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.claude\projects')).TrimEnd('\')
  $native=[IO.Path]::GetFullPath((Join-Path $nativeBase ($task.workspacePath -replace '[^a-zA-Z0-9]','-')))
  if(-not $native.StartsWith($nativeBase+'\',[StringComparison]::OrdinalIgnoreCase)){throw '原生目录越界'}
  if(Test-Path -LiteralPath $native){
    $sessions=@(Get-ChildItem -LiteralPath $native -Filter '*.jsonl')
    $ownedIds=@($tasks|Where-Object workspacePath -eq $task.workspacePath|ForEach-Object {foreach($actor in @($_.lead,$_.sidekick)){if($actor.selection.harness -eq 'claude-code'){$actor.sessionId}}})
    if(@($sessions|Where-Object {$_.BaseName -notin $ownedIds}).Count){throw '原生目录含未确认会话'}
    Remove-Item -LiteralPath $native -Recurse -Force
  }
}
Remove-Item -LiteralPath $target -Recurse -Force
@{root=$target;removed=(-not(Test-Path -LiteralPath $target));taskCount=$tasks.Count;at=[DateTimeOffset]::Now.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $report 'cleanup.json') -Encoding utf8
Write-Output $report
