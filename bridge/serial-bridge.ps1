# dsh-zf-assistant serial bridge (persistent process)
# usage: powershell -NoProfile -ExecutionPolicy Bypass -File serial-bridge.ps1 <COM> <baud> [dataBits] [parity] [stopBits] [handshake]
# bidirectional: serial received bytes -> stdout ; stdin bytes -> serial
param(
  [string]$com,
  [int]$baud = 115200,
  [int]$dataBits = 8,
  [string]$parity = 'None',     # None|Odd|Even|Mark|Space
  [string]$stopBits = 'One',    # One|OnePointFive|Two
  [string]$handshake = 'None'   # None|XOnXOff|RequestToSend|RequestToSendXOnXOff
)
$ErrorActionPreference = 'Stop'
if (-not $com) { [Console]::Error.WriteLine('ZF-ERR missing com'); exit 2 }

$csharp = @'
using System;
using System.IO;
using System.IO.Ports;
using System.Threading;
public static class ZFSerialBridge {
  public static void Run(string com, int baud, int dataBits, string parityName, string stopName, string hsName) {
    Parity parity = Parity.None;
    if (!Enum.TryParse(parityName, true, out parity)) parity = Parity.None;
    StopBits stop = StopBits.One;
    if (!Enum.TryParse(stopName, true, out stop)) stop = StopBits.One;
    Handshake hs = Handshake.None;
    if (!Enum.TryParse(hsName, true, out hs)) hs = Handshake.None;
    var sp = new SerialPort(com, baud, parity, dataBits, stop) { Handshake = hs, ReadTimeout = 30 };
    try { sp.Open(); }
    catch (Exception e) { Console.Error.WriteLine("ZF-ERR open: " + e.Message); Environment.Exit(1); }
    Console.Error.WriteLine("ZF-READY");
    var stdout = Console.OpenStandardOutput();
    var stdin = Console.OpenStandardInput();
    int running = 1;
    var toSerial = new Thread(() => {
      var b = new byte[4096];
      while (Volatile.Read(ref running) == 1) {
        int n = 0;
        try { n = stdin.Read(b, 0, b.Length); } catch { break; }
        if (n > 0) { try { sp.Write(b, 0, n); } catch (Exception) { Volatile.Write(ref running, 0); } }
      }
    });
    toSerial.IsBackground = true;
    toSerial.Start();
    var buf = new byte[4096];
    while (Volatile.Read(ref running) == 1) {
      int n = 0;
      try { n = sp.Read(buf, 0, buf.Length); }
      catch (TimeoutException) { continue; }
      catch (Exception) { break; }
      if (n > 0) { stdout.Write(buf, 0, n); stdout.Flush(); }
    }
    Volatile.Write(ref running, 0);
    sp.Close();
  }
}
'@
try {
  Add-Type -TypeDefinition $csharp
} catch {
  [Console]::Error.WriteLine('ZF-ERR addtype: ' + $_.Exception.Message)
  exit 3
}
try {
  [ZFSerialBridge]::Run($com, $baud, $dataBits, $parity, $stopBits, $handshake)
} catch {
  [Console]::Error.WriteLine('ZF-ERR run: ' + $_.Exception.Message)
  exit 4
}
