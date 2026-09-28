; Inno Setup script for DeskAtlas (per-user install, tray app, firewall rule, optional autostart).
; Build: iscc /DMyAppVersion=1.2.3 installer\DeskAtlas.iss   (after PyInstaller produced dist\DeskAtlas)

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppName "DeskAtlas"
#define MyAppExeName "DeskAtlas.exe"
#define MyAppPublisher "DeskAtlas"
#define MyAppURL "https://github.com/lycself/DeskAtlas"
#define FirewallRule "DeskAtlas"

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
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "autostart"; Description: "登录 Windows 后自动启动 DeskAtlas 并对外提供服务"; GroupDescription: "开机启动："
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: unchecked

[Files]
Source: "..\dist\DeskAtlas\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: autostart

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall

[Code]
var
  FirewallDone: Boolean;

function RuleMatchesInstall(): Boolean;
var
  ResultCode: Integer;
  Lines: TArrayOfString;
  I: Integer;
  Dump: String;
  ExePath: String;
begin
  Result := False;
  Dump := ExpandConstant('{tmp}\firewall-rule.txt');
  ExePath := ExpandConstant('{app}\{#MyAppExeName}');
  if not Exec(ExpandConstant('{cmd}'), '/C netsh advfirewall firewall show rule name="{#FirewallRule}" verbose > "' + Dump + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Exit;
  if ResultCode <> 0 then
    Exit;
  if not LoadStringsFromFile(Dump, Lines) then
    Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
    if Pos(Lowercase(ExePath), Lowercase(Lines[I])) > 0 then
    begin
      Result := True;
      Exit;
    end;
end;

function AddFirewallRule(): Boolean;
var
  ResultCode: Integer;
  ExePath: String;
  Command: String;
begin
  ExePath := ExpandConstant('{app}\{#MyAppExeName}');
  Command := '/C netsh advfirewall firewall delete rule name="{#FirewallRule}" & '
    + 'netsh advfirewall firewall add rule name="{#FirewallRule}" dir=in action=allow enable=yes profile=any protocol=TCP program="' + ExePath + '" description="DeskAtlas 工位地图服务"';
  { The 'runas' verb triggers one UAC prompt; everything else in this installer stays unprivileged. }
  Result := ShellExec('runas', ExpandConstant('{cmd}'), Command, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  FirewallDone := RuleMatchesInstall();
  while not FirewallDone do
  begin
    if AddFirewallRule() then
      FirewallDone := True
    else if MsgBox('DeskAtlas 需要在 Windows 防火墙中允许局域网访问，学生才能打开工位地图。' + #13#10 + #13#10
                   + '请在弹出的“用户帐户控制”窗口中选择“是”。是否重试？', mbConfirmation, MB_RETRYCANCEL) <> IDRETRY then
    begin
      Result := '未能添加防火墙规则，安装已取消。需要允许防火墙规则才能完成安装。';
      Exit;
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    ShellExec('runas', ExpandConstant('{cmd}'), '/C netsh advfirewall firewall delete rule name="{#FirewallRule}"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    DataDir := ExpandConstant('{localappdata}\DeskAtlas');
    if DirExists(DataDir) then
      MsgBox('DeskAtlas 已卸载。数据目录已保留，位于：' + #13#10 + DataDir + #13#10 + #13#10 + '其中包含数据库、上传文件和备份。如不再需要可手动删除。', mbInformation, MB_OK);
  end;
end;
