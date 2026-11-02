#!/usr/bin/env node
'use strict';
// Builds a standard Windows Installer package (.msi) from dist/win-unpacked with msitools'
// wixl on Linux. On Windows, `npm run dist` builds the MSI with electron-builder (WiX).
//   node tools/make-msi.js            → dist/FernaSundaree-<version>-x64.msi
//
// The MSI installs per machine into Program Files, adds Start-menu and desktop shortcuts,
// registers Ferna Sundaree as a browser and PDF viewer (Windows Settings → Default apps),
// shows the icon in Apps & features, and upgrades older versions in place (same UpgradeCode).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const SRC = path.join(ROOT, 'dist', 'win-unpacked');
const OUT = path.join(ROOT, 'dist', `FernaSundaree-${pkg.version}-x64.msi`);
const UPGRADE_CODE = (pkg.build.msi && pkg.build.msi.upgradeCode) || '6f1e6b8e-4c1a-4b55-9b9e-5a0f2c3d8e71';
const EXE = 'Ferna Sundaree.exe';

if (!fs.existsSync(path.join(SRC, EXE))) {
  console.error('Build dist/win-unpacked first (npm run dist or electron-builder --win dir).');
  process.exit(1);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const work = path.join(ROOT, 'dist', '.msi');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

// 1. File components for everything in win-unpacked.
const files = [];
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p); else files.push(p);
  }
})(SRC);
const heat = execFileSync('wixl-heat', ['--prefix', `${SRC}/`, '--directory-ref', 'INSTALLDIR', '--var', 'var.SourceDir', '--component-group', 'AppFiles', '--win64'],
  { input: files.join('\n') + '\n', maxBuffer: 64 * 1024 * 1024 }).toString();
fs.writeFileSync(path.join(work, 'files.wxs'), heat);

// 2. Product: directories, shortcuts, browser registration, upgrade rules.
const reg = (key, name, value) => `<RegistryValue Root="HKLM" Key="${esc(key)}"${name === null ? '' : ` Name="${esc(name)}"`} Type="string" Value="${esc(value)}"/>`;
const K = 'Software\\Clients\\StartMenuInternet\\FernaSundaree';
const exeRef = `[INSTALLDIR]${EXE}`;
const product = `<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="Ferna Sundaree" Language="1033" Version="${esc(pkg.version)}.0" Manufacturer="Ferna Software Solutions" UpgradeCode="${UPGRADE_CODE}">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine"
      Description="Ferna Sundaree ${esc(pkg.version)} — security-hardened browser" Comments="${esc(pkg.description)}" Manufacturer="Ferna Software Solutions"/>
    <Media Id="1" Cabinet="app.cab" EmbedCab="yes"/>
    <MajorUpgrade DowngradeErrorMessage="A newer version of Ferna Sundaree is already installed."/>
    <Icon Id="FernaIcon" SourceFile="${esc(path.join(ROOT, 'build', 'icon.ico'))}"/>
    <Property Id="ARPPRODUCTICON" Value="FernaIcon"/>
    <Property Id="ARPHELPLINK" Value="${esc(pkg.homepage)}"/>
    <Property Id="ARPURLINFOABOUT" Value="https://tgi25.github.io/ferna-software/"/>
    <Property Id="ARPCONTACT" Value="Ferna Software Solutions"/>

    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="INSTALLDIR" Name="Ferna Sundaree"/>
      </Directory>
      <Directory Id="ProgramMenuFolder"/>
      <Directory Id="DesktopFolder"/>
    </Directory>

    <DirectoryRef Id="ProgramMenuFolder">
      <Component Id="StartMenuShortcut" Guid="1c1d2b54-5a32-4cf0-9a3e-2d64b7b1f001" Win64="yes">
        <Shortcut Id="StartMenuLnk" Name="Ferna Sundaree" Description="Security-hardened browser" Target="${exeRef}" WorkingDirectory="INSTALLDIR" Icon="FernaIcon"/>
        <RegistryValue Root="HKLM" Key="Software\\Ferna Software Solutions\\Ferna Sundaree" Name="StartMenuShortcut" Type="integer" Value="1" KeyPath="yes"/>
      </Component>
    </DirectoryRef>
    <DirectoryRef Id="DesktopFolder">
      <Component Id="DesktopShortcut" Guid="1c1d2b54-5a32-4cf0-9a3e-2d64b7b1f002" Win64="yes">
        <Shortcut Id="DesktopLnk" Name="Ferna Sundaree" Description="Security-hardened browser" Target="${exeRef}" WorkingDirectory="INSTALLDIR" Icon="FernaIcon"/>
        <RegistryValue Root="HKLM" Key="Software\\Ferna Software Solutions\\Ferna Sundaree" Name="DesktopShortcut" Type="integer" Value="1" KeyPath="yes"/>
      </Component>
    </DirectoryRef>
    <DirectoryRef Id="INSTALLDIR">
      <Component Id="BrowserRegistration" Guid="1c1d2b54-5a32-4cf0-9a3e-2d64b7b1f003" Win64="yes">
        <RegistryValue Root="HKLM" Key="Software\\Ferna Software Solutions\\Ferna Sundaree" Name="InstallDir" Type="string" Value="[INSTALLDIR]" KeyPath="yes"/>
        ${reg(K, null, 'Ferna Sundaree')}
        ${reg(`${K}\\DefaultIcon`, null, `${exeRef},0`)}
        ${reg(`${K}\\shell\\open\\command`, null, `"${exeRef}"`)}
        ${reg(`${K}\\Capabilities`, 'ApplicationName', 'Ferna Sundaree')}
        ${reg(`${K}\\Capabilities`, 'ApplicationDescription', 'Security-hardened browser with Ferna Tabs, Ferna PDF Reader and Ferna Screenshots built in.')}
        ${reg(`${K}\\Capabilities`, 'ApplicationIcon', `${exeRef},0`)}
        ${reg(`${K}\\Capabilities\\URLAssociations`, 'http', 'FernaSundareeURL')}
        ${reg(`${K}\\Capabilities\\URLAssociations`, 'https', 'FernaSundareeURL')}
        ${reg(`${K}\\Capabilities\\FileAssociations`, '.htm', 'FernaSundareeHTML')}
        ${reg(`${K}\\Capabilities\\FileAssociations`, '.html', 'FernaSundareeHTML')}
        ${reg(`${K}\\Capabilities\\FileAssociations`, '.pdf', 'FernaSundareePDF')}
        ${reg(`${K}\\Capabilities\\StartMenu`, 'StartMenuInternet', 'FernaSundaree')}
        ${reg('Software\\RegisteredApplications', 'Ferna Sundaree', `${K}\\Capabilities`)}
        ${reg('Software\\Classes\\FernaSundareeURL', null, 'Ferna Sundaree URL')}
        ${reg('Software\\Classes\\FernaSundareeURL', 'URL Protocol', '')}
        ${reg('Software\\Classes\\FernaSundareeURL\\DefaultIcon', null, `${exeRef},0`)}
        ${reg('Software\\Classes\\FernaSundareeURL\\shell\\open\\command', null, `"${exeRef}" "%1"`)}
        ${reg('Software\\Classes\\FernaSundareeHTML', null, 'Ferna Sundaree HTML document')}
        ${reg('Software\\Classes\\FernaSundareeHTML\\DefaultIcon', null, `${exeRef},0`)}
        ${reg('Software\\Classes\\FernaSundareeHTML\\shell\\open\\command', null, `"${exeRef}" "%1"`)}
        ${reg('Software\\Classes\\FernaSundareePDF', null, 'PDF document (Ferna PDF Reader)')}
        ${reg('Software\\Classes\\FernaSundareePDF\\DefaultIcon', null, `${exeRef},0`)}
        ${reg('Software\\Classes\\FernaSundareePDF\\shell\\open\\command', null, `"${exeRef}" "%1"`)}
        ${reg(`Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${EXE}`, null, exeRef)}
      </Component>
    </DirectoryRef>

    <Feature Id="Main" Title="Ferna Sundaree" Level="1">
      <ComponentGroupRef Id="AppFiles"/>
      <ComponentRef Id="StartMenuShortcut"/>
      <ComponentRef Id="DesktopShortcut"/>
      <ComponentRef Id="BrowserRegistration"/>
    </Feature>
  </Product>
</Wix>
`;
fs.writeFileSync(path.join(work, 'product.wxs'), product);

execFileSync('wixl', ['-v', '-a', 'x64', '-D', `SourceDir=${SRC}`, '-D', 'Win64=yes', '-o', OUT, path.join(work, 'product.wxs'), path.join(work, 'files.wxs')], { stdio: 'inherit' });
fs.rmSync(work, { recursive: true, force: true });
console.log(`${OUT} (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`);
