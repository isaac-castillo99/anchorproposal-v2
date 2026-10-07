using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("AnchorProposal")]
[assembly: AssemblyProduct("AnchorProposal")]
[assembly: AssemblyDescription("AnchorProposal portable desktop workspace")]
[assembly: AssemblyVersion("__APP_VERSION__")]
[assembly: AssemblyFileVersion("__APP_VERSION__")]

// The distributed portable app is one EXE. Its immutable runtime is extracted once
// per build; account credentials and generated documents are never stored here.
internal static class PortableLauncher {
    private const string BuildHash = "__BUILD_HASH__";
    private const string ExecutableHash = "__EXE_HASH__";
    private const string AppHash = "__APP_HASH__";
    private static readonly long StartedAt = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;

    [STAThread]
    private static void Main(string[] args) {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool probe = args.Any(arg => arg.StartsWith("--startup-probe="));
        string basePath = Environment.GetEnvironmentVariable("ANCHOR_PORTABLE_CACHE");
        if (String.IsNullOrWhiteSpace(basePath)) basePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AnchorProposal", "PortableRuntime");
        string cacheRoot = Path.GetFullPath(basePath);
        string runtime = Path.Combine(cacheRoot, BuildHash);
        try {
            if (IsReady(runtime)) { Launch(runtime, args, 0); return; }
            if (probe) { Prepare(runtime, cacheRoot, null); Launch(runtime, args, (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds - StartedAt); return; }
            using (var splash = new StartupWindow()) {
                splash.Shown += async (sender, e) => {
                    try {
                        await Task.Run(() => Prepare(runtime, cacheRoot, percentage => splash.Report(percentage)));
                        Launch(runtime, args, (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds - StartedAt);
                        splash.Close();
                    } catch (Exception error) { splash.Hide(); ShowError(error); splash.Close(); }
                };
                Application.Run(splash);
            }
        } catch (Exception error) {
            if (probe) { Console.Error.WriteLine(error.Message); Environment.ExitCode = 1; }
            else ShowError(error);
        }
    }

    private static bool IsReady(string directory) {
        try {
            // Check the two executable entry points on each launch before reusing a cache.
            return File.ReadAllText(Path.Combine(directory, ".complete")) == BuildHash
                && Hash(Path.Combine(directory, "AnchorProposal.exe")) == ExecutableHash
                && Hash(Path.Combine(directory, "resources", "app.asar")) == AppHash;
        } catch { return false; }
    }

    private static string Hash(string file) {
        using (var source = File.OpenRead(file)) using (var hash = SHA256.Create())
            return BitConverter.ToString(hash.ComputeHash(source)).Replace("-", "").ToLowerInvariant();
    }

    private static void Prepare(string runtime, string cacheRoot, Action<int> progress) {
        Directory.CreateDirectory(cacheRoot);
        using (var mutex = new Mutex(false, "Local\\AnchorProposalPortable-" + BuildHash)) {
            bool acquired = false;
            try {
                try { acquired = mutex.WaitOne(TimeSpan.FromMinutes(3)); } catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new IOException("Another copy is preparing the app. Please try again in a moment.");
                if (IsReady(runtime)) return;
                string staging = Path.Combine(cacheRoot, BuildHash + ".preparing-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(staging);
                try {
                    using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("AnchorPayload"))
                    using (var archive = new ZipArchive(payload, ZipArchiveMode.Read)) {
                        long total = archive.Entries.Sum(entry => entry.Length), written = 0;
                        foreach (var entry in archive.Entries) {
                            string destination = Path.GetFullPath(Path.Combine(staging, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                            if (!destination.StartsWith(staging + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("The app package contains an invalid path.");
                            if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(destination); continue; }
                            Directory.CreateDirectory(Path.GetDirectoryName(destination));
                            using (var source = entry.Open()) using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 131072)) source.CopyTo(output, 131072);
                            written += entry.Length;
                            if (progress != null) progress((int)(written * 100 / Math.Max(1, total)));
                        }
                    }
                    if (Hash(Path.Combine(staging, "AnchorProposal.exe")) != ExecutableHash || Hash(Path.Combine(staging, "resources", "app.asar")) != AppHash) throw new IOException("The downloaded app is incomplete. Please download it again.");
                    File.WriteAllText(Path.Combine(staging, ".complete"), BuildHash);
                    if (Directory.Exists(runtime)) {
                        // Preserve a broken or interrupted cache rather than deleting a running app.
                        Directory.Move(runtime, Path.Combine(cacheRoot, BuildHash + ".previous-" + Guid.NewGuid().ToString("N")));
                    }
                    Directory.Move(staging, runtime);
                } catch {
                    // Only the newly created, contained staging directory is removed.
                    if (Path.GetFullPath(staging).StartsWith(cacheRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && Directory.Exists(staging)) Directory.Delete(staging, true);
                    throw;
                }
            } finally { if (acquired) mutex.ReleaseMutex(); }
        }
    }

    private static void Launch(string runtime, string[] args, long extractionMs) {
        string executable = Assembly.GetExecutingAssembly().Location;
        var info = new ProcessStartInfo(Path.Combine(runtime, "AnchorProposal.exe")) {
            UseShellExecute = false, WorkingDirectory = runtime,
            Arguments = String.Join(" ", args.Select(Quote)),
        };
        info.EnvironmentVariables["PORTABLE_EXECUTABLE_FILE"] = executable;
        info.EnvironmentVariables["PORTABLE_EXECUTABLE_DIR"] = Path.GetDirectoryName(executable);
        info.EnvironmentVariables["ANCHOR_LAUNCHER_STARTED_AT"] = StartedAt.ToString();
        info.EnvironmentVariables["ANCHOR_EXTRACT_MS"] = extractionMs.ToString();
        using (Process process = Process.Start(info)) { }
    }

    private static string Quote(string value) {
        // Windows command-line escaping, including quotes and trailing backslashes.
        var result = new System.Text.StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); }
            else { result.Append('\\', slashes); result.Append(c); }
            slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
    }
    private static void ShowError(Exception error) { MessageBox.Show("AnchorProposal could not open.\n\n" + error.Message, "AnchorProposal", MessageBoxButtons.OK, MessageBoxIcon.Error); }
}

internal sealed class StartupWindow : Form {
    private readonly ProgressBar progress;
    private readonly Label detail;
    public StartupWindow() {
        Text = "Opening AnchorProposal"; ClientSize = new Size(430, 168); FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = false; StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(13, 21, 32); ForeColor = Color.FromArgb(226, 239, 249);
        Font = new Font("Segoe UI", 10); ShowIcon = false;
        Controls.Add(new Label { Text = "Preparing your workspace", AutoSize = true, Location = new Point(25, 23), Font = new Font("Segoe UI", 15, FontStyle.Bold) });
        detail = new Label { Text = "Setting up this version for a faster start next time…", AutoSize = true, Location = new Point(27, 64), ForeColor = Color.FromArgb(148, 174, 193) };
        Controls.Add(detail);
        progress = new ProgressBar { Location = new Point(28, 109), Size = new Size(373, 9), Style = ProgressBarStyle.Continuous };
        Controls.Add(progress);
    }
    public void Report(int value) { if (!IsDisposed && IsHandleCreated) BeginInvoke(new Action(() => { progress.Value = Math.Min(100, value); detail.Text = "Preparing your workspace · " + value + "%"; })); }
}
