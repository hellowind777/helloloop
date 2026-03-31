using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using Microsoft.Win32.SafeHandles;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

namespace HelloLoopHiddenShellProxy
{
    internal static class Program
    {
        private const string RealPwshEnv = "HELLOLOOP_REAL_PWSH";
        private const string RealPowerShellEnv = "HELLOLOOP_REAL_POWERSHELL";
        private const string OriginalPathEnv = "HELLOLOOP_ORIGINAL_PATH";
        private const string ProxyEnabledEnv = "HELLOLOOP_HIDDEN_SHELL_PROXY_ENABLED";
        private const string ProxyTargetExeEnv = "HELLOLOOP_PROXY_TARGET_EXE";

        private static readonly IntPtr InvalidHandleValue = new IntPtr(-1);

        private const int StdInputHandle = -10;
        private const int StdOutputHandle = -11;
        private const int StdErrorHandle = -12;

        private const uint DuplicateSameAccess = 0x00000002;
        private const uint CreateNoWindow = 0x08000000;
        private const uint CreateUnicodeEnvironment = 0x00000400;

        private const int StartfUseShowWindow = 0x00000001;
        private const int StartfUseStdHandles = 0x00000100;
        private const short SwHide = 0;
        private const uint Infinite = 0xFFFFFFFF;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        private sealed class LaunchRequest
        {
            public LaunchRequest(string executable, IDictionary<string, string> environmentVariables)
            {
                Executable = executable ?? string.Empty;
                EnvironmentVariables = environmentVariables ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            }

            public string Executable { get; private set; }

            public IDictionary<string, string> EnvironmentVariables { get; private set; }
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GetStdHandle(int handleId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DuplicateHandle(
            IntPtr hSourceProcessHandle,
            IntPtr hSourceHandle,
            IntPtr hTargetProcessHandle,
            out IntPtr lpTargetHandle,
            uint dwDesiredAccess,
            [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle,
            uint dwOptions);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateProcessW(
            string lpApplicationName,
            StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            [MarshalAs(UnmanagedType.Bool)] bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr hObject);

        private static int Main(string[] args)
        {
            try
            {
                var request = ResolveLaunchRequest();
                if (string.IsNullOrWhiteSpace(request.Executable) || !File.Exists(request.Executable))
                {
                    WriteErrorLine("[HelloLoop hidden-shell-proxy] 未找到真实可执行文件，可检查 HELLOLOOP_PROXY_TARGET_EXE / HELLOLOOP_REAL_PWSH / HELLOLOOP_REAL_POWERSHELL。");
                    return 127;
                }

                return LaunchHiddenProcess(request, args ?? new string[0]);
            }
            catch (Exception ex)
            {
                WriteErrorLine(string.Format("[HelloLoop hidden-shell-proxy] {0}", ex.Message));
                return 1;
            }
        }

        private static int LaunchHiddenProcess(LaunchRequest request, string[] args)
        {
            var startupInfo = new STARTUPINFO();
            startupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            startupInfo.dwFlags = StartfUseShowWindow;
            startupInfo.wShowWindow = SwHide;

            var duplicatedHandles = new List<IntPtr>();
            ConfigureStandardHandles(ref startupInfo, duplicatedHandles);

            var processInfo = new PROCESS_INFORMATION();
            var environmentBlock = BuildEnvironmentBlock(request.EnvironmentVariables);
            GCHandle pinnedEnvironment = default(GCHandle);
            IntPtr environmentPointer = IntPtr.Zero;

            try
            {
                if (environmentBlock != null && environmentBlock.Length > 0)
                {
                    pinnedEnvironment = GCHandle.Alloc(environmentBlock, GCHandleType.Pinned);
                    environmentPointer = pinnedEnvironment.AddrOfPinnedObject();
                }

                var commandLine = new StringBuilder(BuildCommandLine(request.Executable, args));
                var shouldInheritHandles = (startupInfo.dwFlags & StartfUseStdHandles) == StartfUseStdHandles;
                var created = CreateProcessW(
                    request.Executable,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    shouldInheritHandles,
                    CreateNoWindow | CreateUnicodeEnvironment,
                    environmentPointer,
                    null,
                    ref startupInfo,
                    out processInfo);

                if (!created)
                {
                    throw new InvalidOperationException(
                        string.Format("启动真实进程失败：{0}（Win32Error={1}）", request.Executable, Marshal.GetLastWin32Error()));
                }

                WaitForSingleObject(processInfo.hProcess, Infinite);

                uint exitCode;
                if (!GetExitCodeProcess(processInfo.hProcess, out exitCode))
                {
                    throw new InvalidOperationException(
                        string.Format("读取真实进程退出码失败（Win32Error={0}）。", Marshal.GetLastWin32Error()));
                }

                return unchecked((int)exitCode);
            }
            finally
            {
                if (pinnedEnvironment.IsAllocated)
                {
                    pinnedEnvironment.Free();
                }

                CloseHandleIfNeeded(processInfo.hThread);
                CloseHandleIfNeeded(processInfo.hProcess);

                foreach (var handle in duplicatedHandles)
                {
                    CloseHandleIfNeeded(handle);
                }
            }
        }

        private static void ConfigureStandardHandles(ref STARTUPINFO startupInfo, ICollection<IntPtr> duplicatedHandles)
        {
            var stdin = DuplicateStandardHandle(StdInputHandle);
            var stdout = DuplicateStandardHandle(StdOutputHandle);
            var stderr = DuplicateStandardHandle(StdErrorHandle);

            if (IsValidHandle(stdin) && IsValidHandle(stdout) && IsValidHandle(stderr))
            {
                startupInfo.dwFlags |= StartfUseStdHandles;
                startupInfo.hStdInput = stdin;
                startupInfo.hStdOutput = stdout;
                startupInfo.hStdError = stderr;
                duplicatedHandles.Add(stdin);
                duplicatedHandles.Add(stdout);
                duplicatedHandles.Add(stderr);
                return;
            }

            CloseHandleIfNeeded(stdin);
            CloseHandleIfNeeded(stdout);
            CloseHandleIfNeeded(stderr);
        }

        private static IntPtr DuplicateStandardHandle(int handleId)
        {
            var source = GetStdHandle(handleId);
            if (!IsValidHandle(source))
            {
                return IntPtr.Zero;
            }

            IntPtr duplicated;
            var duplicatedOk = DuplicateHandle(
                GetCurrentProcess(),
                source,
                GetCurrentProcess(),
                out duplicated,
                0,
                true,
                DuplicateSameAccess);

            return duplicatedOk ? duplicated : IntPtr.Zero;
        }

        private static bool IsValidHandle(IntPtr handle)
        {
            return handle != IntPtr.Zero && handle != InvalidHandleValue;
        }

        private static void CloseHandleIfNeeded(IntPtr handle)
        {
            if (IsValidHandle(handle))
            {
                CloseHandle(handle);
            }
        }

        private static LaunchRequest ResolveLaunchRequest()
        {
            var explicitTarget = Environment.GetEnvironmentVariable(ProxyTargetExeEnv);
            if (IsUsableExecutable(explicitTarget))
            {
                return new LaunchRequest(Path.GetFullPath(explicitTarget), BuildLaunchEnvironment());
            }

            var targetShell = ResolveTargetShell();
            return new LaunchRequest(targetShell, BuildLaunchEnvironment());
        }

        private static IDictionary<string, string> BuildLaunchEnvironment()
        {
            var environment = CaptureCurrentEnvironment();
            var originalPath = Environment.GetEnvironmentVariable(OriginalPathEnv);
            if (!string.IsNullOrWhiteSpace(originalPath))
            {
                environment["PATH"] = originalPath;
            }

            environment.Remove(RealPwshEnv);
            environment.Remove(RealPowerShellEnv);
            environment.Remove(OriginalPathEnv);
            environment.Remove(ProxyEnabledEnv);
            environment.Remove(ProxyTargetExeEnv);
            return environment;
        }

        private static Dictionary<string, string> CaptureCurrentEnvironment()
        {
            var environment = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
            {
                var key = Convert.ToString(entry.Key);
                if (string.IsNullOrWhiteSpace(key))
                {
                    continue;
                }

                environment[key] = Convert.ToString(entry.Value) ?? string.Empty;
            }
            return environment;
        }

        private static byte[] BuildEnvironmentBlock(IDictionary<string, string> environment)
        {
            if (environment == null || environment.Count == 0)
            {
                return null;
            }

            var keys = new List<string>(environment.Keys);
            keys.Sort(StringComparer.OrdinalIgnoreCase);

            var builder = new StringBuilder();
            foreach (var key in keys)
            {
                builder.Append(key);
                builder.Append('=');
                builder.Append(environment[key] ?? string.Empty);
                builder.Append('\0');
            }
            builder.Append('\0');
            return Encoding.Unicode.GetBytes(builder.ToString());
        }

        private static string BuildCommandLine(string executable, IEnumerable<string> args)
        {
            var builder = new StringBuilder();
            builder.Append(QuoteArgument(executable));

            foreach (var arg in args)
            {
                builder.Append(' ');
                builder.Append(QuoteArgument(arg ?? string.Empty));
            }

            return builder.ToString();
        }

        private static string QuoteArgument(string argument)
        {
            if (string.IsNullOrEmpty(argument))
            {
                return "\"\"";
            }

            var needsQuotes = argument.IndexOfAny(new[] { ' ', '\t', '"' }) >= 0;
            if (!needsQuotes)
            {
                return argument;
            }

            var builder = new StringBuilder();
            builder.Append('"');
            var backslashCount = 0;

            foreach (var character in argument)
            {
                if (character == '\\')
                {
                    backslashCount++;
                    continue;
                }

                if (character == '"')
                {
                    builder.Append('\\', (backslashCount * 2) + 1);
                    builder.Append('"');
                    backslashCount = 0;
                    continue;
                }

                if (backslashCount > 0)
                {
                    builder.Append('\\', backslashCount);
                    backslashCount = 0;
                }

                builder.Append(character);
            }

            if (backslashCount > 0)
            {
                builder.Append('\\', backslashCount * 2);
            }

            builder.Append('"');
            return builder.ToString();
        }

        private static string ResolveTargetShell()
        {
            var assemblyPath = Assembly.GetEntryAssembly() != null
                ? Assembly.GetEntryAssembly().Location
                : AppDomain.CurrentDomain.BaseDirectory;
            var requestedName = Path.GetFileName(assemblyPath).ToLowerInvariant();
            var wantsPwsh = requestedName.StartsWith("pwsh", StringComparison.OrdinalIgnoreCase);
            var explicitTarget = Environment.GetEnvironmentVariable(wantsPwsh ? RealPwshEnv : RealPowerShellEnv);

            if (IsUsableExecutable(explicitTarget))
            {
                return Path.GetFullPath(explicitTarget);
            }

            var searchName = wantsPwsh ? "pwsh.exe" : "powershell.exe";
            var fromOriginalPath = FindFromOriginalPath(searchName);
            if (IsUsableExecutable(fromOriginalPath))
            {
                return Path.GetFullPath(fromOriginalPath);
            }

            var fallback = wantsPwsh
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "PowerShell", "7", "pwsh.exe")
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            return IsUsableExecutable(fallback) ? Path.GetFullPath(fallback) : string.Empty;
        }

        private static bool IsUsableExecutable(string candidate)
        {
            if (string.IsNullOrWhiteSpace(candidate))
            {
                return false;
            }

            var fullCandidate = Path.GetFullPath(candidate);
            var selfPath = Assembly.GetEntryAssembly() != null
                ? Path.GetFullPath(Assembly.GetEntryAssembly().Location)
                : string.Empty;
            return !string.Equals(fullCandidate, selfPath, StringComparison.OrdinalIgnoreCase) && File.Exists(fullCandidate);
        }

        private static string FindFromOriginalPath(string executableName)
        {
            var originalPath = Environment.GetEnvironmentVariable(OriginalPathEnv);
            if (string.IsNullOrWhiteSpace(originalPath))
            {
                return null;
            }

            var directories = originalPath.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var directory in directories)
            {
                var cleanDirectory = directory.Trim().Trim('"');
                if (string.IsNullOrWhiteSpace(cleanDirectory))
                {
                    continue;
                }

                var candidate = Path.Combine(cleanDirectory, executableName);
                if (IsUsableExecutable(candidate))
                {
                    return candidate;
                }
            }

            return null;
        }

        private static Stream CreateStandardStream(int handleId, FileAccess access)
        {
            var handle = GetStdHandle(handleId);
            if (!IsValidHandle(handle))
            {
                return Stream.Null;
            }

            return new FileStream(new SafeFileHandle(handle, false), access);
        }

        private static void WriteErrorLine(string message)
        {
            using (var error = CreateStandardStream(StdErrorHandle, FileAccess.Write))
            {
                if (ReferenceEquals(error, Stream.Null))
                {
                    return;
                }

                using (var writer = new StreamWriter(error, Encoding.UTF8, 1024, true))
                {
                    writer.AutoFlush = true;
                    writer.WriteLine(message);
                }
            }
        }
    }
}
