$ErrorActionPreference = "Stop"

$source = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class DesktopIconProbe {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr hObject);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr VirtualAllocEx(IntPtr hProcess, IntPtr lpAddress, uint dwSize, uint flAllocationType, uint flProtect);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool VirtualFreeEx(IntPtr hProcess, IntPtr lpAddress, uint dwSize, uint dwFreeType);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] lpBuffer, uint nSize, out UIntPtr lpNumberOfBytesWritten);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] lpBuffer, uint nSize, out UIntPtr lpNumberOfBytesRead);

  const int LVM_FIRST = 0x1000;
  const int LVM_GETITEMCOUNT = LVM_FIRST + 4;
  const int LVM_GETITEMRECT = LVM_FIRST + 14;
  const int LVIR_BOUNDS = 0;
  const uint PROCESS_VM_OPERATION = 0x0008;
  const uint PROCESS_VM_READ = 0x0010;
  const uint PROCESS_VM_WRITE = 0x0020;
  const uint MEM_COMMIT = 0x1000;
  const uint MEM_RESERVE = 0x2000;
  const uint MEM_RELEASE = 0x8000;
  const uint PAGE_READWRITE = 0x04;

  public static IntPtr FindDesktopListView() {
    IntPtr progman = FindWindow("Progman", "Program Manager");
    IntPtr shell = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
    IntPtr list = shell == IntPtr.Zero ? IntPtr.Zero : FindWindowEx(shell, IntPtr.Zero, "SysListView32", null);
    if (list != IntPtr.Zero) return list;

    IntPtr result = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hwnd, IntPtr lParam) {
      IntPtr workerShell = FindWindowEx(hwnd, IntPtr.Zero, "SHELLDLL_DefView", null);
      if (workerShell != IntPtr.Zero) {
        IntPtr workerList = FindWindowEx(workerShell, IntPtr.Zero, "SysListView32", null);
        if (workerList != IntPtr.Zero) {
          result = workerList;
          return false;
        }
      }
      return true;
    }, IntPtr.Zero);
    return result;
  }

  public static List<RECT> GetIconRects() {
    var rects = new List<RECT>();
    IntPtr list = FindDesktopListView();
    if (list == IntPtr.Zero) return rects;

    uint pid;
    GetWindowThreadProcessId(list, out pid);
    IntPtr process = OpenProcess(PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE, false, pid);
    if (process == IntPtr.Zero) return rects;

    IntPtr remote = IntPtr.Zero;
    try {
      int count = SendMessage(list, LVM_GETITEMCOUNT, IntPtr.Zero, IntPtr.Zero).ToInt32();
      remote = VirtualAllocEx(process, IntPtr.Zero, 16, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
      if (remote == IntPtr.Zero) return rects;

      POINT origin = new POINT { X = 0, Y = 0 };
      ClientToScreen(list, ref origin);

      for (int i = 0; i < count; i++) {
        byte[] input = new byte[16];
        BitConverter.GetBytes(LVIR_BOUNDS).CopyTo(input, 0);
        UIntPtr written;
        WriteProcessMemory(process, remote, input, 16, out written);
        IntPtr ok = SendMessage(list, LVM_GETITEMRECT, new IntPtr(i), remote);
        if (ok == IntPtr.Zero) continue;

        byte[] output = new byte[16];
        UIntPtr read;
        ReadProcessMemory(process, remote, output, 16, out read);
        RECT rect = new RECT {
          Left = BitConverter.ToInt32(output, 0) + origin.X,
          Top = BitConverter.ToInt32(output, 4) + origin.Y,
          Right = BitConverter.ToInt32(output, 8) + origin.X,
          Bottom = BitConverter.ToInt32(output, 12) + origin.Y
        };
        if (rect.Right > rect.Left && rect.Bottom > rect.Top) rects.Add(rect);
      }
    } finally {
      if (remote != IntPtr.Zero) VirtualFreeEx(process, remote, 0, MEM_RELEASE);
      CloseHandle(process);
    }
    return rects;
  }
}
"@

try {
  Add-Type -TypeDefinition $source -Language CSharp
  $rects = [DesktopIconProbe]::GetIconRects() | ForEach-Object {
    [PSCustomObject]@{
      left = $_.Left
      top = $_.Top
      right = $_.Right
      bottom = $_.Bottom
    }
  }
  if ($null -eq $rects) {
    "[]"
  } else {
    @($rects) | ConvertTo-Json -Compress
  }
} catch {
  "[]"
}
