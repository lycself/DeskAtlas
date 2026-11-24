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
  { Both names must match desktop\hostos.py. }
  InstanceMutex = 'Local\{#MyAppName}.SingleInstance';
  QuitEvent = 'Local\{#MyAppName}.Quit';
  EVENT_MODIFY_STATE = $0002;

function OpenEvent(dwDesiredAccess: Cardinal; bInheritHandle: Integer; lpName: String): THandle;
  external 'OpenEventW@kernel32.dll stdcall';
function SetEvent(hEvent: THandle): Integer;
  external 'SetEvent@kernel32.dll stdcall';
function CloseHandle(hObject: THandle): Integer;
  external 'CloseHandle@kernel32.dll stdcall';

function AppRunning(): Boolean;
begin
  Result := CheckForMutexes(InstanceMutex);
end;

function WaitForAppExit(Seconds: Integer): Boolean;
var
  I: Integer;
begin
  for I := 1 to Seconds * 4 do
  begin
    if not AppRunning() then
    begin
      Result := True;
      Exit;
    end;
    Sleep(250);
  end;
  Result := not AppRunning();
end;

{ 1.6.1 and later wait on this event and quit cleanly (tray, server, database). }
function AskAppToQuit(): Boolean;
var
  Handle: THandle;
begin
  Result := False;
  Handle := OpenEvent(EVENT_MODIFY_STATE, 0, QuitEvent);
  if Handle <> 0 then
  begin
    Result := SetEvent(Handle) <> 0;
    CloseHandle(Handle);
  end;
end;

{ Windows refuses to overwrite DeskAtlas.exe while it runs (MoveFile error 5), and the tray app does not
  answer Restart Manager's close request, so CloseApplications alone does not free the files. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Signalled: Boolean;
  ResultCode: Integer;
begin
  Result := '';
  if not AppRunning() then
    Exit;
  if not WizardSilent() then
    if SuppressibleMsgBox('DeskAtlas 正在运行。安装前需要先关闭它，局域网内的访问会短暂中断。' + #13#10 + #13#10 + '现在关闭 DeskAtlas 并继续安装吗？', mbConfirmation, MB_OKCANCEL, IDOK) <> IDOK then
    begin
      Result := '请先从任务栏右下角的托盘图标退出 DeskAtlas，再重新运行安装程序。';
      Exit;
    end;
  Signalled := AskAppToQuit();
  { A silent run is usually the in-app updater, which quits DeskAtlas by itself right after starting this. }
  if (Signalled or WizardSilent()) and WaitForAppExit(30) then
    Exit;
  { Older versions do not listen for the quit event; end them so their files can be replaced. }
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM {#MyAppExeName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if WaitForAppExit(10) then
    Exit;
  Result := 'DeskAtlas 仍在运行，无法替换程序文件。请从任务栏右下角的托盘图标退出 DeskAtlas（或在任务管理器中结束 DeskAtlas.exe），再重新运行安装程序。';
end;

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
