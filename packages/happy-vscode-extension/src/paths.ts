import os from 'os';
import path from 'path';

function isInsidersApp(appName?: string): boolean {
  return typeof appName === 'string' && appName.toLowerCase().includes('insider');
}

export function getHappyHomeDir(): string {
  const override = process.env.HAPPY_HOME_DIR;
  if (override && override.trim().length > 0) {
    if (override.startsWith('~')) {
      return path.join(os.homedir(), override.slice(1));
    }
    return override;
  }
  return path.join(os.homedir(), '.happy');
}

export function getDefaultDaemonStatePath(): string {
  return path.join(getHappyHomeDir(), 'daemon.state.json');
}

export function getDefaultWorkspaceStorageRoots(appName?: string): string[] {
  const home = os.homedir();
  const platform = process.platform;
  const insiders = isInsidersApp(appName);

  if (platform === 'darwin') {
    return insiders
      ? [path.join(home, 'Library/Application Support/Code - Insiders/User/workspaceStorage')]
      : [path.join(home, 'Library/Application Support/Code/User/workspaceStorage')];
  }

  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData/Roaming');
    return insiders
      ? [path.join(appData, 'Code - Insiders/User/workspaceStorage')]
      : [path.join(appData, 'Code/User/workspaceStorage')];
  }

  return insiders
    ? [path.join(home, '.config/Code - Insiders/User/workspaceStorage')]
    : [path.join(home, '.config/Code/User/workspaceStorage')];
}

export function getDefaultGlobalStorageRoots(appName?: string): string[] {
  const home = os.homedir();
  const platform = process.platform;
  const insiders = isInsidersApp(appName);

  if (platform === 'darwin') {
    return insiders
      ? [path.join(home, 'Library/Application Support/Code - Insiders/User/globalStorage')]
      : [path.join(home, 'Library/Application Support/Code/User/globalStorage')];
  }

  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData/Roaming');
    return insiders
      ? [path.join(appData, 'Code - Insiders/User/globalStorage')]
      : [path.join(appData, 'Code/User/globalStorage')];
  }

  return insiders
    ? [path.join(home, '.config/Code - Insiders/User/globalStorage')]
    : [path.join(home, '.config/Code/User/globalStorage')];
}
