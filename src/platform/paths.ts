import path from "node:path";

export type SupportedPlatform = "linux" | "darwin" | "win32";

export interface PathEnvironment {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory: string;
}

function pathApi(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

export function resolveStateHome(input: PathEnvironment): string {
  const paths = pathApi(input.platform);
  const override = input.env.BONES_STATE_HOME?.trim();
  if (override) return paths.resolve(override);

  if (input.platform === "win32") {
    const localAppData = input.env.LOCALAPPDATA?.trim();
    if (localAppData) return paths.join(localAppData, "Bones");
    const appData = input.env.APPDATA?.trim();
    if (appData) return paths.join(appData, "Bones");
    return paths.join(input.homeDirectory, "AppData", "Local", "Bones");
  }

  if (input.platform === "darwin") {
    return paths.join(input.homeDirectory, "Library", "Application Support", "Bones");
  }

  const xdgStateHome = input.env.XDG_STATE_HOME?.trim();
  if (xdgStateHome) return paths.join(xdgStateHome, "bones");
  return paths.join(input.homeDirectory, ".local", "state", "bones");
}

export function isSupportedPlatform(platform: NodeJS.Platform): platform is SupportedPlatform {
  return platform === "linux" || platform === "darwin" || platform === "win32";
}
