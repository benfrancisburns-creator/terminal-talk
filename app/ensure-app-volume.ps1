# ensure-app-volume.ps1 -- self-heal Terminal Talk's OWN per-app mixer volume.
#
# Symptom this exists for (2026-08-15, laptop Bengalroger): after a Windows
# Update reboot the toolbar was running, the OS default output was fine and
# clips were logged as played, but nothing was audible. The Windows Volume
# Mixer session for terminal-talk was sitting at 0 (not muted -- volume 0).
# Windows persists per-app session volume by app path, so it survives
# restarts and recurs every few weeks. Nothing in TT ever writes that
# slider, so it can only be restored, never caused, from here.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File ensure-app-volume.ps1
#          -ProcessName terminal-talk [-MinVolume 0.05] [-Restore 1.0]
# Prints exactly one line:
#   RESTORED name=<proc> from_vol=<v> from_mute=<m> to_vol=<v>
#   OK name=<proc> vol=<v> mute=<m>
#   NOSESSION name=<proc>            (app has never opened an audio session yet)
#   ERROR <message>
# ASCII only -- PowerShell 5.1 parses em-dashes badly in .ps1 files.
param(
  [string]$ProcessName = 'terminal-talk',
  [double]$MinVolume = 0.05,
  [double]$Restore = 1.0
)
$ErrorActionPreference = 'Stop'
try {
  $src = @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
namespace TTVol {
 [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}
 [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IMMDeviceEnumerator { int EnumAudioEndpoints(int f, int s, out IntPtr c); int GetDefaultAudioEndpoint(int f, int r, out IMMDevice d); }
 [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
 [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IAudioSessionManager2 { int GetAudioSessionControl(IntPtr g, int f, out IntPtr c); int GetSimpleAudioVolume(IntPtr g, int f, out IntPtr v); int GetSessionEnumerator(out IAudioSessionEnumerator e); }
 [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IAudioSessionEnumerator { int GetCount(out int c); int GetSession(int i, out IAudioSessionControl s); }
 [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IAudioSessionControl { int GetState(out int s); int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string n); int SetDisplayName(IntPtr a, IntPtr b); int GetIconPath(IntPtr a); int SetIconPath(IntPtr a, IntPtr b); int GetGroupingParam(IntPtr a); int SetGroupingParam(IntPtr a, IntPtr b); int RegisterAudioSessionNotification(IntPtr a); int UnregisterAudioSessionNotification(IntPtr a); }
 [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IAudioSessionControl2 { int GetState(out int s); int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string n); int SetDisplayName(IntPtr a, IntPtr b); int GetIconPath(IntPtr a); int SetIconPath(IntPtr a, IntPtr b); int GetGroupingParam(IntPtr a); int SetGroupingParam(IntPtr a, IntPtr b); int RegisterAudioSessionNotification(IntPtr a); int UnregisterAudioSessionNotification(IntPtr a); int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s); int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s); int GetProcessId(out uint p); int IsSystemSoundsSession(); int SetDuckingPreference(bool b); }
 [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface ISimpleAudioVolume { int SetMasterVolume(float l, IntPtr g); int GetMasterVolume(out float l); int SetMute(bool m, IntPtr g); int GetMute(out bool m); }
 public class Result { public bool Found; public bool Restored; public float FromVol; public bool FromMute; public float ToVol; }
 public static class Fix {
  public static Result Run(string procName, double minVol, double restore) {
   var r = new Result();
   var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
   IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
   Guid iid = typeof(IAudioSessionManager2).GUID; object o; dev.Activate(ref iid, 23, IntPtr.Zero, out o);
   var mgr = (IAudioSessionManager2)o; IAudioSessionEnumerator se; mgr.GetSessionEnumerator(out se);
   int n; se.GetCount(out n);
   for (int i = 0; i < n; i++) {
     IAudioSessionControl c; se.GetSession(i, out c);
     var c2 = (IAudioSessionControl2)c; var v = (ISimpleAudioVolume)c;
     uint pid; c2.GetProcessId(out pid);
     string pn = ""; try { pn = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
     if (!string.Equals(pn, procName, StringComparison.OrdinalIgnoreCase)) continue;
     float vol; v.GetMasterVolume(out vol); bool mu; v.GetMute(out mu);
     if (!r.Found) { r.Found = true; r.FromVol = vol; r.FromMute = mu; r.ToVol = vol; }
     if (mu || vol < minVol) {
       if (mu) v.SetMute(false, IntPtr.Zero);
       if (vol < minVol) v.SetMasterVolume((float)restore, IntPtr.Zero);
       v.GetMasterVolume(out vol); r.ToVol = vol; r.Restored = true;
     }
   }
   return r;
  }
 }
}
'@
  if (-not ([System.Management.Automation.PSTypeName]'TTVol.Fix').Type) {
    Add-Type -TypeDefinition $src
  }
  $r = [TTVol.Fix]::Run($ProcessName, $MinVolume, $Restore)
  if (-not $r.Found) { Write-Output ("NOSESSION name={0}" -f $ProcessName); exit 0 }
  $fv = [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", $r.FromVol)
  $tv = [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", $r.ToVol)
  if ($r.Restored) {
    Write-Output ("RESTORED name={0} from_vol={1} from_mute={2} to_vol={3}" -f $ProcessName, $fv, $r.FromMute, $tv)
  } else {
    Write-Output ("OK name={0} vol={1} mute={2}" -f $ProcessName, $fv, $r.FromMute)
  }
  exit 0
} catch {
  Write-Output ("ERROR " + $_.Exception.Message)
  exit 1
}
