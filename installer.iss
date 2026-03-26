; Inno Setup 6 — DataAuditor installer
; Usage: ISCC installer.iss
; Output: dist\installer\DataAuditor_Setup_v3.6.0.exe

#define AppName      "DataAuditor"
#define AppVersion   "3.29.0"
#define AppPublisher "DataAuditor"
#define AppURL       "https://github.com/your-org/data_auditor"
#define AppExeName   "DataAuditor.exe"
#define SourceDir    "dist\DataAuditor"
#define OutputDir    "dist\installer"

[Setup]
; ---- Identity ---------------------------------------------------------------
AppId={{8F3A2C1D-4B5E-6F7A-8B9C-0D1E2F3A4B5C}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} v{#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}

; ---- Install destination ----------------------------------------------------
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes

; ---- Platform ---------------------------------------------------------------
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0

; ---- Output -----------------------------------------------------------------
OutputDir={#OutputDir}
OutputBaseFilename=DataAuditor_Setup_v{#AppVersion}

; ---- Compression ------------------------------------------------------------
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=4

; ---- UI style ---------------------------------------------------------------
WizardStyle=modern
WizardResizable=yes

; ---- Misc -------------------------------------------------------------------
; No elevation required if user installs under their own autopf
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName} v{#AppVersion}
VersionInfoVersion={#AppVersion}
VersionInfoDescription={#AppName} Setup
VersionInfoProductName={#AppName}
ShowLanguageDialog=auto

; Icône de l'installeur (générée par tools/make_icon.py)
SetupIconFile=tools\DataAuditor.ico

[Languages]
Name: "french";  MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
; Desktop shortcut — checked by default
Name: "desktopicon";  Description: "{cm:CreateDesktopIcon}";  GroupDescription: "{cm:AdditionalIcons}";  Flags: checkedonce
; Startup entry — unchecked by default
Name: "startupentry"; Description: "Lancer {#AppName} au démarrage de Windows"; GroupDescription: "Options de démarrage :"; Flags: unchecked

[Files]
; --- Main application bundle (onedir output) ---------------------------------
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Start Menu
Name: "{group}\{#AppName}";            Filename: "{app}\{#AppExeName}";  WorkingDir: "{app}"
Name: "{group}\Désinstaller {#AppName}"; Filename: "{uninstallexe}"

; Desktop (conditional on task)
Name: "{autodesktop}\{#AppName}";      Filename: "{app}\{#AppExeName}";  WorkingDir: "{app}";  Tasks: desktopicon

; Startup (conditional on task)
Name: "{autostartup}\{#AppName}";      Filename: "{app}\{#AppExeName}";  WorkingDir: "{app}";  Tasks: startupentry

[Run]
; Offer to launch the app at the end of the installer
Filename: "{app}\{#AppExeName}"; \
  Description: "Lancer {#AppName}"; \
  Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Remove the reports directory only if the user consents (handled in [Code])
; Nothing here — deletion is managed programmatically below.

; =============================================================================
[Code]
// ---------------------------------------------------------------------------
// Uninstall: ask whether to delete generated reports
// ---------------------------------------------------------------------------

var
  DeleteReportsPage: TOutputMsgWizardPage;

// Called when the uninstaller wizard is about to show each step.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ReportsDir: String;
  Answer: Integer;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    ReportsDir := ExpandConstant('{app}\reports');

    if DirExists(ReportsDir) then
    begin
      Answer := MsgBox(
        'Le dossier des rapports générés existe encore :' + #13#10 +
        ReportsDir + #13#10#13#10 +
        'Voulez-vous supprimer ces rapports ?' + #13#10 +
        '(Cliquez Non pour les conserver.)',
        mbConfirmation,
        MB_YESNO or MB_DEFBUTTON2   // "Non" par défaut
      );

      if Answer = IDYES then
        DelTree(ReportsDir, True, True, True);
    end;
  end;
end;

// ---------------------------------------------------------------------------
// Install: prevent installation on 32-bit OS (belt-and-suspenders)
// ---------------------------------------------------------------------------
function InitializeSetup(): Boolean;
begin
  Result := True;
  if not Is64BitInstallMode then
  begin
    MsgBox(
      '{#AppName} nécessite Windows 64 bits.' + #13#10 +
      'L''installation ne peut pas continuer.',
      mbError,
      MB_OK
    );
    Result := False;
  end;
end;
