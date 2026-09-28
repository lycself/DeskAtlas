; Inno Setup script for DeskAtlas (per-user install, tray app, optional autostart).
; It never elevates: Windows asks about firewall access itself the first time DeskAtlas listens on the LAN.
; Build: iscc /DMyAppVersion=1.2.3 installer\DeskAtlas.iss   (after PyInstaller produced dist\DeskAtlas)

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppName "DeskAtlas"
#define MyAppExeName "DeskAtlas.exe"
#define MyAppPublisher "DeskAtlas"
#define MyAppURL "https://github.com/lycself/DeskAtlas"

[Setup]
AppId={{8E1C4D0B-6F1E-4C8A-9D6B-2F1A7C3E9B54}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DisableDirPage=no
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
OutputDir=..\dist
OutputBaseFilename=DeskAtlas-Setup-{#MyAppVersion}
SetupIconFile=deskatlas.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ArchitecturesInstallIn64BitMode=x64compatible
ShowLanguageDialog=no

[Languages]
; Inno Setup does not ship the Simplified Chinese translation; it is vendored from the official
; unofficial-translations folder into installer\languages.
Name: "chinesesimplified"; MessagesFile: "languages\ChineseSimplified.isl"

[Tasks]
Name: "autostart"; Description: "登录 Windows 后自动启动 DeskAtlas 并对外提供服务"; GroupDescription: "开机启动："; Flags: unchecked; Check: IsFirstInstall
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: unchecked

[Files]
Source: "..\dist\DeskAtlas\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; Same value the app writes from its autostart switch (desktop\hostos.py).
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#MyAppName}"; ValueData: """{app}\{#MyAppExeName}"""; Tasks: autostart

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall

[Code]
const
  RunKey = 'Software\Microsoft\Windows\CurrentVersion\Run';

{ Autostart is offered on the first install only; afterwards the in-app switch owns it, so an update
  (including a silent one) never re-enables autostart the user turned off. }
function IsFirstInstall(): Boolean;
begin
  Result := not RegKeyExists(HKA, ExpandConstant('Software\Microsoft\Windows\CurrentVersion\Uninstall\{#SetupSetting("AppId")}_is1'));
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    { The app may have enabled autostart itself, so these are not in the uninstall log. }
    RegDeleteValue(HKCU, RunKey, '{#MyAppName}');
    DeleteFile(ExpandConstant('{userstartup}\{#MyAppName}.lnk'));
    DataDir := ExpandConstant('{localappdata}\DeskAtlas');
    if DirExists(DataDir) then
      MsgBox('DeskAtlas 已卸载。数据目录已保留，位于：' + #13#10 + DataDir + #13#10 + #13#10 + '其中包含数据库、上传文件和备份。如不再需要可手动删除。', mbInformation, MB_OK);
  end;
end;
