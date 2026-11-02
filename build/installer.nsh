; Ferna Sundaree — per-user registration as a web browser and PDF viewer, so it appears in
; Windows Settings → Apps → Default apps. Windows 10/11 never lets an app make itself the
; default silently; the user picks it there (Settings → "Make default…" opens that page).

!macro customInstall
  !define FS_KEY "Software\Clients\StartMenuInternet\FernaSundaree"
  WriteRegStr HKCU "${FS_KEY}" "" "Ferna Sundaree"
  WriteRegStr HKCU "${FS_KEY}\DefaultIcon" "" "$INSTDIR\Ferna Sundaree.exe,0"
  WriteRegStr HKCU "${FS_KEY}\shell\open\command" "" '"$INSTDIR\Ferna Sundaree.exe"'
  WriteRegStr HKCU "${FS_KEY}\Capabilities" "ApplicationName" "Ferna Sundaree"
  WriteRegStr HKCU "${FS_KEY}\Capabilities" "ApplicationDescription" "Security-hardened browser with Ferna Tabs, Ferna PDF Reader and Ferna Screenshots built in."
  WriteRegStr HKCU "${FS_KEY}\Capabilities" "ApplicationIcon" "$INSTDIR\Ferna Sundaree.exe,0"
  WriteRegStr HKCU "${FS_KEY}\Capabilities\URLAssociations" "http" "FernaSundareeURL"
  WriteRegStr HKCU "${FS_KEY}\Capabilities\URLAssociations" "https" "FernaSundareeURL"
  WriteRegStr HKCU "${FS_KEY}\Capabilities\FileAssociations" ".htm" "FernaSundareeHTML"
  WriteRegStr HKCU "${FS_KEY}\Capabilities\FileAssociations" ".html" "FernaSundareeHTML"
  WriteRegStr HKCU "${FS_KEY}\Capabilities\FileAssociations" ".pdf" "FernaSundareePDF"
  WriteRegStr HKCU "${FS_KEY}\Capabilities\StartMenu" "StartMenuInternet" "FernaSundaree"
  WriteRegStr HKCU "Software\RegisteredApplications" "Ferna Sundaree" "${FS_KEY}\Capabilities"

  WriteRegStr HKCU "Software\Classes\FernaSundareeURL" "" "Ferna Sundaree URL"
  WriteRegStr HKCU "Software\Classes\FernaSundareeURL" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\FernaSundareeURL\DefaultIcon" "" "$INSTDIR\Ferna Sundaree.exe,0"
  WriteRegStr HKCU "Software\Classes\FernaSundareeURL\shell\open\command" "" '"$INSTDIR\Ferna Sundaree.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\FernaSundareeHTML" "" "Ferna Sundaree HTML document"
  WriteRegStr HKCU "Software\Classes\FernaSundareeHTML\DefaultIcon" "" "$INSTDIR\Ferna Sundaree.exe,0"
  WriteRegStr HKCU "Software\Classes\FernaSundareeHTML\shell\open\command" "" '"$INSTDIR\Ferna Sundaree.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\FernaSundareePDF" "" "PDF document (Ferna PDF Reader)"
  WriteRegStr HKCU "Software\Classes\FernaSundareePDF\DefaultIcon" "" "$INSTDIR\Ferna Sundaree.exe,0"
  WriteRegStr HKCU "Software\Classes\FernaSundareePDF\shell\open\command" "" '"$INSTDIR\Ferna Sundaree.exe" "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\FernaSundaree"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Ferna Sundaree"
  DeleteRegKey HKCU "Software\Classes\FernaSundareeURL"
  DeleteRegKey HKCU "Software\Classes\FernaSundareeHTML"
  DeleteRegKey HKCU "Software\Classes\FernaSundareePDF"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
