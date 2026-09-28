// Filamap Agent launcher (substitui run-agent.vbs + wscript.exe).
//
// Por que existe: o filamap-agent.exe (pkg/Node) e um executavel de console
// -- iniciado direto pelo Agendador de Tarefas ele abre uma janela preta.
// Antes isso era resolvido com um VBScript, que o Windows esta descontinuando
// e que antivirus tratam com desconfianca. Este launcher e um executavel
// /target:winexe (sem janela) compilado com o csc.exe do .NET Framework 4,
// presente em todo Windows 10/11.
//
// Mesmo contrato do run-agent.vbs (homologado em 2026-09-28):
// - Nunca duplica: mutex nomeado por sessao + checagem de filamap-agent.exe
//   do mesmo caminho ja rodando (ex.: iniciado a mao).
// - Codigo 0 = encerramento intencional -> launcher termina.
// - Codigo <> 0 = crash -> relanca com espera de 30s dobrando ate 10min;
//   volta a 30s se o Agent rodou pelo menos 10min.
// - Diretorio de trabalho e log em %APPDATA%\Filamap (agent.log, UTF-8).
// Extra: agent.log acima de 20 MB vira agent.log.1 antes de cada inicio.
//
// Compilar: launcher\build-launcher.ps1 (C# 5, sem dependencias).

using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

internal static class FilamapLauncher
{
    private const string MutexName = "Local\\FilamapAgentLauncher";
    private const long MaxLogBytes = 20L * 1024 * 1024;

    private static readonly object LogLock = new object();
    private static StreamWriter log;

    [STAThread]
    private static int Main()
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string exePath = Path.Combine(baseDir, "filamap-agent.exe");
        if (!File.Exists(exePath)) return 1;

        string appData = Environment.GetEnvironmentVariable("APPDATA");
        if (string.IsNullOrEmpty(appData)) return 1;
        string runtimeDir = Path.Combine(appData, "Filamap");
        Directory.CreateDirectory(runtimeDir);
        string logPath = Path.Combine(runtimeDir, "agent.log");

        bool createdNew;
        using (Mutex mutex = new Mutex(true, MutexName, out createdNew))
        {
            if (!createdNew) return 0; // outro launcher desta sessao ja cuida do Agent

            int baseDelaySec = ReadIntEnv("FILAMAP_LAUNCHER_BASE_DELAY_SEC", 30);
            int maxDelaySec = ReadIntEnv("FILAMAP_LAUNCHER_MAX_DELAY_SEC", 600);
            int healthyRunSec = ReadIntEnv("FILAMAP_LAUNCHER_HEALTHY_RUN_SEC", 600);
            int delaySec = baseDelaySec;
            int rc = 0;

            while (true)
            {
                if (AgentAlreadyRunning(exePath)) return 0;

                RotateLogIfNeeded(logPath);
                Stopwatch runTime = Stopwatch.StartNew();
                rc = RunAgentOnce(exePath, runtimeDir, logPath);
                runTime.Stop();

                if (rc == 0) break;

                if (runTime.Elapsed.TotalSeconds >= healthyRunSec) delaySec = baseDelaySec;
                WriteLauncherLine(logPath, string.Format(
                    "Agent saiu com codigo {0} apos {1:0}s. Relancando em {2}s.",
                    rc, runTime.Elapsed.TotalSeconds, delaySec));
                Thread.Sleep(TimeSpan.FromSeconds(delaySec));
                delaySec = Math.Min(delaySec * 2, maxDelaySec);
            }
            return rc;
        }
    }

    private static int RunAgentOnce(string exePath, string runtimeDir, string logPath)
    {
        ProcessStartInfo psi = new ProcessStartInfo(exePath);
        psi.WorkingDirectory = runtimeDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;

        lock (LogLock)
        {
            FileStream fs = new FileStream(logPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
            log = new StreamWriter(fs, new UTF8Encoding(false));
            log.AutoFlush = true;
        }
        try
        {
            using (Process p = new Process())
            {
                p.StartInfo = psi;
                p.OutputDataReceived += OnOutput;
                p.ErrorDataReceived += OnOutput;
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                p.WaitForExit(); // sem timeout: tambem espera o fim das leituras assincronas
                return p.ExitCode;
            }
        }
        catch (Exception e)
        {
            WriteLine("[launcher] Falha ao iniciar o Agent: " + e.Message);
            return 1;
        }
        finally
        {
            lock (LogLock)
            {
                log.Dispose();
                log = null;
            }
        }
    }

    private static void OnOutput(object sender, DataReceivedEventArgs e)
    {
        if (e.Data != null) WriteLine(e.Data);
    }

    private static void WriteLine(string line)
    {
        lock (LogLock)
        {
            if (log != null) log.WriteLine(line);
        }
    }

    private static void WriteLauncherLine(string logPath, string message)
    {
        try
        {
            string line = string.Format("[{0}] [launcher] {1}{2}",
                DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), message, Environment.NewLine);
            File.AppendAllText(logPath, line, new UTF8Encoding(false));
        }
        catch { }
    }

    private static bool AgentAlreadyRunning(string exePath)
    {
        foreach (Process p in Process.GetProcessesByName("filamap-agent"))
        {
            try
            {
                if (string.Equals(p.MainModule.FileName, exePath, StringComparison.OrdinalIgnoreCase)) return true;
            }
            catch { } // processo de outro usuario/elevado: nao da para ler o caminho
            finally { p.Dispose(); }
        }
        return false;
    }

    private static void RotateLogIfNeeded(string logPath)
    {
        try
        {
            FileInfo info = new FileInfo(logPath);
            if (!info.Exists || info.Length < MaxLogBytes) return;
            string previous = logPath + ".1";
            if (File.Exists(previous)) File.Delete(previous);
            File.Move(logPath, previous);
        }
        catch { } // log em uso ou sem permissao: segue anexando no atual
    }

    private static int ReadIntEnv(string name, int fallback)
    {
        int value;
        string raw = Environment.GetEnvironmentVariable(name);
        return int.TryParse(raw, out value) && value > 0 ? value : fallback;
    }
}
