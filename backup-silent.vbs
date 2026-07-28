' Runs the Puppy Tracker backup with no visible window.
' Used by the "Puppy Tracker Backup" scheduled task.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "node """ & dir & "\scripts\backup.mjs""", 0, False
