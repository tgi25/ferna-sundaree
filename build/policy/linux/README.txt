Ferna Sundaree managed policies on Linux
========================================

Administrators can enforce settings for every user of a computer, the same names as the
Windows Group Policy template (FernaSundaree.admx).

1. Create the folder (as root):
     sudo mkdir -p /etc/ferna-sundaree/policies/managed
2. Copy policy.example.json there, rename it (any name ending in .json) and edit it:
     sudo cp policy.example.json /etc/ferna-sundaree/policies/managed/school.json
3. The file must be owned by root and not writable by group or others, otherwise it is ignored:
     sudo chown root:root /etc/ferna-sundaree/policies/managed/*.json
     sudo chmod 644 /etc/ferna-sundaree/policies/managed/*.json

Files are read in name order; a later file overrides an earlier one. Settings set by policy
show a lock in Settings and cannot be changed by the user. Restart Ferna Sundaree to apply.

Settings: HttpsFirst, AdBlocker, SafeBrowsing, SearchEngine, DnsOverHttpsMode,
DnsOverHttpsProvider, BlockThirdPartyCookies, EnhancedSecurity, AutoUpdate, PasswordManager,
AutofillAddresses, AutofillCards, LookalikeWarnings, DefenderScan (ClamAV on Linux),
ExtensionGuard, FingerprintProtection, GlobalPrivacyControl, PopupBlocker, SleepingTabs,
HistoryDays (number), UpdateMirror (https:// address of your own folder with
update.json, update.json.sig and the installers; when set, updates come only from there).
Features (true = allowed): AssistantAllowed, SyncAllowed, PrivateWindowsAllowed,
TorWindowsAllowed, DeveloperToolsAllowed, ExtensionInstallAllowed, WebAppsAllowed,
ProfilesAllowed.
