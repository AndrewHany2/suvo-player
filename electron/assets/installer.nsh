# Custom NSIS include, auto-picked up by electron-builder because it lives in the
# buildResources dir (electron/assets) under the default name `installer.nsh`.
#
# Why this exists: electron-builder already uninstalls a previous install of the
# *same* app before installing (see uninstallOldVersion in installUtil.nsh), keyed
# on a GUID derived from `appId`. But this app's appId changed across rebrands, so a
# machine that still has one of the older-branded builds would otherwise end up with
# a second, separate app instead of an in-place upgrade. Here we detect those legacy
# installs by their (now-frozen) uninstall GUIDs and remove them during .onInit,
# before the new install runs.
#
# GUID = uuid5(appId, "50e065bc-3134-11e6-9bab-38c9862bdaf3")  (electron-builder ns).
# Keep these in sync with electron/nsisLegacyUninstall.test.js, which recomputes them.
#   com.andrew1h1.lumenplayer -> 516d011f-17ac-52cd-a195-03a6931576e5  (Lumen Player)
#   com.andrew1h1.iptvplayer  -> 095a198e-a88f-582e-a051-a5549b82fd37  (Lumen IPTV Player)
#   com.iptv.player           -> fa9aea92-567a-5295-91f7-3c77707f03fd  (IPTV Player)
# The current appId (com.andrew1h1.suvo -> 338ecf7f-...) is intentionally absent:
# electron-builder handles same-appId upgrades on its own.

!define LEGACY_UNINSTALL_ROOT "Software\Microsoft\Windows\CurrentVersion\Uninstall"

# Silently remove one legacy install identified by its uninstall registry key.
# Best-effort and non-fatal: a failure (e.g. an elevation-requiring per-machine
# install under a non-elevated installer) must never block the new install.
!macro uninstallLegacyProduct ROOT KEYPATH
  Push $0 ; UninstallString / uninstaller exe path
  Push $1 ; InstallLocation
  Push $2 ; scratch
  Push $3 ; ExecWait exit code

  ClearErrors
  ReadRegStr $0 ${ROOT} "${KEYPATH}" "UninstallString"
  ${If} $0 != ""
    ReadRegStr $1 ${ROOT} "${KEYPATH}" "InstallLocation"

    # UninstallString is the quoted path to the uninstaller; strip the quotes.
    StrCpy $2 $0 1
    ${If} $2 == '"'
      StrCpy $0 $0 "" 1
      StrCpy $0 $0 -1
    ${EndIf}

    ${If} ${FileExists} "$0"
      ${If} $1 != ""
        # _?=<dir> keeps the uninstaller from self-copying so ExecWait truly waits.
        ExecWait '"$0" /S _?=$1' $3
      ${Else}
        ExecWait '"$0" /S' $3
      ${EndIf}
      Sleep 300
    ${EndIf}

    # Sweep up any leftovers (the uninstaller leaves its own exe and the dir behind
    # when run with _?=) and drop the stale registry entry.
    ${If} $1 != ""
      RMDir /r "$1"
    ${EndIf}
    DeleteRegKey ${ROOT} "${KEYPATH}"
  ${EndIf}

  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

# Inserted from .onInit, after check64BitAndSetRegView (so the 64-bit registry view
# is already active on x64) and initMultiUser.
!macro customInit
  # per-user installs live under HKCU, per-machine under HKLM; try both.
  !insertmacro uninstallLegacyProduct HKCU "${LEGACY_UNINSTALL_ROOT}\516d011f-17ac-52cd-a195-03a6931576e5"
  !insertmacro uninstallLegacyProduct HKCU "${LEGACY_UNINSTALL_ROOT}\095a198e-a88f-582e-a051-a5549b82fd37"
  !insertmacro uninstallLegacyProduct HKCU "${LEGACY_UNINSTALL_ROOT}\fa9aea92-567a-5295-91f7-3c77707f03fd"
  !insertmacro uninstallLegacyProduct HKLM "${LEGACY_UNINSTALL_ROOT}\516d011f-17ac-52cd-a195-03a6931576e5"
  !insertmacro uninstallLegacyProduct HKLM "${LEGACY_UNINSTALL_ROOT}\095a198e-a88f-582e-a051-a5549b82fd37"
  !insertmacro uninstallLegacyProduct HKLM "${LEGACY_UNINSTALL_ROOT}\fa9aea92-567a-5295-91f7-3c77707f03fd"
!macroend
