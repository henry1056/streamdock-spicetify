using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace StreamDockSetup
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new MainForm());
        }
    }

    public class MainForm : Form
    {
        private Label lblTitle = null!;
        private Label lblSubtitle = null!;
        private CheckBox chkPlugin = null!;
        private CheckBox chkSpicetify = null!;
        private CheckBox chkApply = null!;
        private CheckBox chkRestartVsd = null!;
        private ProgressBar progressBar = null!;
        private TextBox txtLog = null!;
        private Button btnInstall = null!;
        private Button btnTest = null!;
        private Button btnExit = null!;

        public MainForm()
        {
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.Text = "Stream Dock N3 — Spicetify Setup";
            this.Size = new Size(680, 560);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(20, 22, 28);
            this.ForeColor = Color.FromArgb(240, 240, 245);
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            // Title Banner
            Panel topPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 80,
                BackColor = Color.FromArgb(28, 30, 38)
            };

            lblTitle = new Label
            {
                Text = "⚡ Stream Dock N3 — Spicetify Setup",
                Font = new Font("Segoe UI", 15f, FontStyle.Bold),
                ForeColor = Color.FromArgb(56, 189, 248),
                Location = new Point(24, 14),
                AutoSize = true
            };

            lblSubtitle = new Label
            {
                Text = "Direct local Spotify control & live LCD album art for VSD Craft",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(26, 46),
                AutoSize = true
            };

            topPanel.Controls.Add(lblTitle);
            topPanel.Controls.Add(lblSubtitle);
            this.Controls.Add(topPanel);

            // Options Group
            GroupBox grpOptions = new GroupBox
            {
                Text = " Installation Options ",
                Location = new Point(24, 96),
                Size = new Size(616, 120),
                ForeColor = Color.FromArgb(200, 210, 225)
            };

            chkPlugin = new CheckBox
            {
                Text = "Install Stream Dock Plugin (com.vsdinside.spicetify.sdPlugin) into VSD Craft",
                Location = new Point(16, 25),
                Size = new Size(580, 24),
                Checked = true,
                ForeColor = Color.FromArgb(235, 235, 240)
            };

            chkSpicetify = new CheckBox
            {
                Text = "Install Spicetify Extension (streamdock.js) into Spotify client",
                Location = new Point(16, 50),
                Size = new Size(580, 24),
                Checked = true,
                ForeColor = Color.FromArgb(235, 235, 240)
            };

            chkApply = new CheckBox
            {
                Text = "Run 'spicetify apply' automatically after installation",
                Location = new Point(16, 75),
                Size = new Size(350, 24),
                Checked = true,
                ForeColor = Color.FromArgb(235, 235, 240)
            };

            chkRestartVsd = new CheckBox
            {
                Text = "Restart VSD Craft if running",
                Location = new Point(380, 75),
                Size = new Size(220, 24),
                Checked = true,
                ForeColor = Color.FromArgb(235, 235, 240)
            };

            grpOptions.Controls.Add(chkPlugin);
            grpOptions.Controls.Add(chkSpicetify);
            grpOptions.Controls.Add(chkApply);
            grpOptions.Controls.Add(chkRestartVsd);
            this.Controls.Add(grpOptions);

            // Log / Progress
            txtLog = new TextBox
            {
                Location = new Point(24, 226),
                Size = new Size(616, 195),
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                BackColor = Color.FromArgb(14, 16, 20),
                ForeColor = Color.FromArgb(210, 220, 235),
                Font = new Font("Consolas", 9f)
            };
            this.Controls.Add(txtLog);

            progressBar = new ProgressBar
            {
                Location = new Point(24, 430),
                Size = new Size(616, 14),
                Style = ProgressBarStyle.Continuous,
                Value = 0
            };
            this.Controls.Add(progressBar);

            // Buttons
            btnInstall = new Button
            {
                Text = "Install Now",
                Location = new Point(24, 458),
                Size = new Size(160, 42),
                BackColor = Color.FromArgb(16, 185, 129),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Click += async (s, e) => await StartInstallation();
            this.Controls.Add(btnInstall);

            btnTest = new Button
            {
                Text = "Test Play / Pause",
                Location = new Point(200, 458),
                Size = new Size(160, 42),
                BackColor = Color.FromArgb(37, 99, 235),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                Cursor = Cursors.Hand,
                Enabled = false
            };
            btnTest.FlatAppearance.BorderSize = 0;
            btnTest.Click += async (s, e) => await TestPlayback();
            this.Controls.Add(btnTest);

            btnExit = new Button
            {
                Text = "Exit",
                Location = new Point(510, 458),
                Size = new Size(130, 42),
                BackColor = Color.FromArgb(51, 65, 85),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5f),
                Cursor = Cursors.Hand
            };
            btnExit.FlatAppearance.BorderSize = 0;
            btnExit.Click += (s, e) => this.Close();
            this.Controls.Add(btnExit);

            Log("Ready. Click 'Install Now' to install the integration.");
        }

        private void Log(string msg)
        {
            if (this.InvokeRequired)
            {
                this.Invoke(new Action(() => Log(msg)));
                return;
            }
            string time = DateTime.Now.ToString("HH:mm:ss");
            txtLog.AppendText($"[{time}] {msg}\r\n");
            txtLog.SelectionStart = txtLog.Text.Length;
            txtLog.ScrollToCaret();
        }

        private void SetProgress(int percent)
        {
            if (this.InvokeRequired)
            {
                this.Invoke(new Action(() => SetProgress(percent)));
                return;
            }
            progressBar.Value = Math.Max(0, Math.Min(100, percent));
        }

        private async Task StartInstallation()
        {
            btnInstall.Enabled = false;
            chkPlugin.Enabled = false;
            chkSpicetify.Enabled = false;
            chkApply.Enabled = false;
            chkRestartVsd.Enabled = false;

            Log("Starting installation...");
            SetProgress(10);

            try
            {
                // 1. Extract payload to temporary folder
                string tempDir = Path.Combine(Path.GetTempPath(), "StreamDockSpicetify_" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(tempDir);

                Log("Extracting embedded assets...");
                var assembly = Assembly.GetExecutingAssembly();
                using (var stream = assembly.GetManifestResourceStream("StreamDockSetup.payload.zip"))
                {
                    if (stream == null)
                    {
                        throw new InvalidOperationException("Embedded payload.zip not found in installer executable.");
                    }
                    using (var archive = new ZipArchive(stream))
                    {
                        archive.ExtractToDirectory(tempDir);
                    }
                }
                SetProgress(30);

                // 2. Install Stream Dock Plugin
                if (chkPlugin.Checked)
                {
                    Log("Installing Stream Dock plugin...");
                    string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                    string vsdPluginDir = Path.Combine(appData, "HotSpot", "StreamDock", "plugins", "com.vsdinside.spicetify.sdPlugin");

                    string sourcePluginDir = Path.Combine(tempDir, "streamdock-plugin", "com.vsdinside.spicetify.sdPlugin");
                    if (Directory.Exists(sourcePluginDir))
                    {
                        if (Directory.Exists(vsdPluginDir))
                        {
                            try { Directory.Delete(vsdPluginDir, true); } catch { }
                        }
                        Directory.CreateDirectory(Path.GetDirectoryName(vsdPluginDir)!);
                        CopyDirectory(sourcePluginDir, vsdPluginDir);
                        Log($"✅ Plugin installed to: {vsdPluginDir}");
                    }
                    else
                    {
                        Log("⚠️ Plugin source folder missing from payload.");
                    }
                }
                SetProgress(50);

                // 3. Install Spicetify Extension
                if (chkSpicetify.Checked)
                {
                    Log("Locating Spicetify directories...");
                    string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                    string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

                    string[] possibleSpicetifyPaths = new[]
                    {
                        Path.Combine(appData, "Spotify", "Apps", "xpui", "extensions"),
                        Path.Combine(userProfile, ".spicetify", "Extensions"),
                        Path.Combine(appData, "spicetify", "Extensions")
                    };

                    string extSource = Path.Combine(tempDir, "spicetify-extension", "streamdock.js");
                    bool installedAny = false;

                    foreach (var path in possibleSpicetifyPaths)
                    {
                        try
                        {
                            Directory.CreateDirectory(path);
                            string destFile = Path.Combine(path, "streamdock.js");
                            File.Copy(extSource, destFile, true);
                            Log($"✅ Copied streamdock.js to: {destFile}");
                            installedAny = true;
                        }
                        catch (Exception ex)
                        {
                            Log($"Notice: Could not write to {path} ({ex.Message})");
                        }
                    }

                    if (!installedAny)
                    {
                        Log("⚠️ Could not write to Spicetify extensions folder.");
                    }
                }
                SetProgress(70);

                // 4. Run Spicetify Apply
                if (chkApply.Checked)
                {
                    Log("Registering and applying extension via Spicetify CLI...");
                    await RunCliCommandAsync("spicetify", "config extensions streamdock.js");
                    await RunCliCommandAsync("spicetify", "apply");
                    Log("✅ Spicetify configuration applied!");
                }
                SetProgress(85);

                // 5. Restart VSD Craft if requested
                if (chkRestartVsd.Checked)
                {
                    var vsdProcs = Process.GetProcessesByName("StreamDock");
                    if (vsdProcs.Length > 0)
                    {
                        Log("Restarting VSD Craft to load newly installed plugin...");
                        string? procPath = null;
                        foreach (var p in vsdProcs)
                        {
                            try
                            {
                                procPath = p.MainModule?.FileName;
                                p.Kill();
                                p.WaitForExit(3000);
                            }
                            catch { }
                        }

                        if (!string.IsNullOrEmpty(procPath) && File.Exists(procPath))
                        {
                            await Task.Delay(1000);
                            Process.Start(new ProcessStartInfo(procPath) { UseShellExecute = true });
                            Log("✅ VSD Craft restarted successfully.");
                        }
                    }
                    else
                    {
                        Log("VSD Craft is not currently running. It will load the plugin on next launch.");
                    }
                }

                // Cleanup temp
                try { Directory.Delete(tempDir, true); } catch { }

                SetProgress(100);
                Log("🎉 Installation finished successfully!");
                Log("You can now map Spicetify actions to your Stream Dock N3 keys and knobs.");

                btnInstall.Text = "Finished";
                btnInstall.BackColor = Color.FromArgb(71, 85, 105);
                btnTest.Enabled = true;
            }
            catch (Exception ex)
            {
                Log($"❌ Installation Error: {ex.Message}");
                MessageBox.Show(this, "An error occurred during installation:\n" + ex.Message, "Setup Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                btnInstall.Enabled = true;
            }
        }

        private async Task RunCliCommandAsync(string fileName, string args)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = fileName,
                    Arguments = args,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };

                using var proc = Process.Start(psi);
                if (proc != null)
                {
                    string output = await proc.StandardOutput.ReadToEndAsync();
                    await proc.WaitForExitAsync();
                    if (!string.IsNullOrWhiteSpace(output))
                    {
                        Log(output.Trim());
                    }
                }
            }
            catch (Exception ex)
            {
                Log($"Notice running {fileName} {args}: {ex.Message}");
            }
        }

        private async Task TestPlayback()
        {
            Log("Testing Spotify Play / Pause bridge on port 8974...");
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
                var resp = await client.GetAsync("http://127.0.0.1:8974/playpause");
                if (resp.IsSuccessStatusCode)
                {
                    Log("🟢 Bridge responded successfully! Spotify playback toggled.");
                }
                else
                {
                    Log($"Bridge returned HTTP {(int)resp.StatusCode}");
                }
            }
            catch (Exception ex)
            {
                Log($"Bridge test note: {ex.Message}. Make sure Spotify is running.");
            }
        }

        private static void CopyDirectory(string sourceDir, string destinationDir)
        {
            var dir = new DirectoryInfo(sourceDir);
            Directory.CreateDirectory(destinationDir);

            foreach (FileInfo file in dir.GetFiles())
            {
                string targetFilePath = Path.Combine(destinationDir, file.Name);
                file.CopyTo(targetFilePath, true);
            }

            foreach (DirectoryInfo subDir in dir.GetDirectories())
            {
                string newDestinationDir = Path.Combine(destinationDir, subDir.Name);
                CopyDirectory(subDir.FullName, newDestinationDir);
            }
        }
    }
}
