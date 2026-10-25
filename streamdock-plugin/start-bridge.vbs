Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\henry\AppData\Roaming\HotSpot\StreamDock\plugins\com.vsdinside.spicetify.sdPlugin"
WshShell.Run """C:\Program Files\nodejs\node.exe"" plugin\index.js", 0, False
