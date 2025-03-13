import { configManager } from "@main/config/config-manager";
import envPaths from "env-paths";
import path from "path";
import { env } from "process";

export const APP_NAME = "Beyond All Reason";

const paths = envPaths(APP_NAME, { suffix: env.APP_NAME_SUFFIX || "" });
export const CONTENT_PATH = paths.data;
export const CONFIG_PATH = paths.config;

export const REPLAYS_PATH = path.join(CONTENT_PATH, "demos");
export const MAPS_PATH = path.join(CONTENT_PATH, "maps");

// This function should be called after configManager is initialized
export function getGameVersionsGzPath(): string {
    const config = configManager.getConfig();
    return path.join(CONTENT_PATH, "rapid", config.contentSources.rapid.host, config.contentSources.rapid.game, "versions.gz");
}
