import os from 'os';
import path from 'path';

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

export function getDefaultWorkspaceStorageRoots(): string[] {
  const home = os.homedir();
  const platform = process.platform;

  if (platform === 'darwin') {
    return [
      path.join(home, 'Library/Application Support/Code/User/workspaceStorage'),
      path.join(home, 'Library/Application Support/Code - Insiders/User/workspaceStorage')
    ];
  }

  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData/Roaming');
    return [
      path.join(appData, 'Code/User/workspaceStorage'),
      path.join(appData, 'Code - Insiders/User/workspaceStorage')
    ];
  }

  return [
    path.join(home, '.config/Code/User/workspaceStorage'),
    path.join(home, '.config/Code - Insiders/User/workspaceStorage')
  ];
}

export function getDefaultGlobalStorageRoots(): string[] {
  const home = os.homedir();
  const platform = process.platform;

  if (platform === 'darwin') {
    return [
      path.join(home, 'Library/Application Support/Code/User/globalStorage'),
      path.join(home, 'Library/Application Support/Code - Insiders/User/globalStorage')
    ];
  }

  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData/Roaming');
    return [
      path.join(appData, 'Code/User/globalStorage'),
      path.join(appData, 'Code - Insiders/User/globalStorage')
    ];
  }

  return [
    path.join(home, '.config/Code/User/globalStorage'),
    path.join(home, '.config/Code - Insiders/User/globalStorage')
  ];
}
