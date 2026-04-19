' Launch the Terminal Talk toolbar silently (no console window).
' Dropped into Startup folder by install.ps1 so it auto-starts on login.
Set sh = CreateObject("WScript.Shell")
home = sh.ExpandEnvironmentStrings("%USERPROFILE%")
toolbar = home & "\.terminal-talk\app"
electron = toolbar & "\node_modules\electron\dist\electron.exe"
sh.CurrentDirectory = toolbar
sh.Run """" & electron & """ """ & toolbar & """", 0, False
