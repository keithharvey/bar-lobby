import axios from "axios";
import * as fs from "fs";
import * as glob from "glob-promise";
import { removeFromArray } from "$/jaz-ts-utils/object";
import * as path from "path";
import { EngineAI, EngineVersion } from "@main/content/engine/engine-version";
import { DownloadInfo } from "../downloads";
import { parseLuaTable } from "@main/utils/parse-lua-table";
import { parseLuaOptions } from "@main/utils/parse-lua-options";
import { logger } from "@main/utils/logger";
import { extract7z } from "@main/utils/extract-7z";
import { configManager } from "@main/config/config-manager";
import { AbstractContentAPI } from "@main/content/abstract-content";
import { CONTENT_PATH } from "@main/config/app";
import { DownloadEngine } from "@main/content/game/type";
import { PrDownloaderAPI } from "@main/content/pr-downloader";

const log = logger("engine-content.ts");

// TODO: add support for old engine version tag naming scheme, careful it is not string sortable (!)
// Regex matching engine version tags - accepting any format since we use it directly in the URL
const compatibleVersionRegex = /^.+$/;

export class EngineContentAPI extends PrDownloaderAPI<string, EngineVersion> {
    protected readonly engineDirs = path.join(CONTENT_PATH, "engine");

    public override async init() {
        try {
            log.info("Initializing engine content API");
            await fs.promises.mkdir(this.engineDirs, { recursive: true });
            const files = await fs.promises.readdir(this.engineDirs, { withFileTypes: true });
            const dirs = files
                .filter((file) => file.isDirectory() || file.isSymbolicLink())
                .map((dir) => dir.name)
                .filter((dir) => compatibleVersionRegex.test(dir) || dir.includes("local"));
            log.info(`Found ${dirs.length} installed engine versions`);
            for (const dir of dirs) {
                log.info(`-- Engine ${dir}`);
                const ais = await this.parseAis(dir);
                this.availableVersions.set(dir, { id: dir, ais, installed: true });
            }

            // Add the configured engine version to available versions
            try {
                const config = configManager.getConfig();

                // Extract the engine version from the URL prefix
                // We'll use the last part of the URL that contains version information
                const urlPrefix = config.versions.engine_download_url_prefix;
                const urlParts = urlPrefix.split("/");
                const lastPart = urlParts[urlParts.length - 1];

                // Extract the version identifier - typically after "spring_bar_." or the whole string if not found
                let engineVersion = lastPart;
                if (lastPart.includes("spring_bar_.")) {
                    engineVersion = lastPart.split("spring_bar_.")[1];
                } else if (lastPart.includes("rel")) {
                    engineVersion = lastPart;
                }

                log.info(`Using engine version from URL prefix: ${engineVersion}`);

                if (compatibleVersionRegex.test(engineVersion) && !this.availableVersions.has(engineVersion)) {
                    this.availableVersions.set(engineVersion, {
                        id: engineVersion,
                        ais: [],
                        installed: false,
                    });
                    log.info(`Added configured engine version: ${engineVersion}`);
                }

                // Log available versions
                const availableVersions = Array.from(this.availableVersions.keys())
                    .filter((version) => !this.availableVersions.get(version)?.installed)
                    .sort((a, b) => a.localeCompare(b));

                if (availableVersions.length > 0) {
                    log.info("Engine versions available for download:");
                    for (const version of availableVersions) {
                        log.info(`-- Available: ${version}`);
                    }
                }
            } catch (err) {
                log.error(`Failed to process configured engine version: ${err}`);
            }

            log.info(`Found ${this.availableVersions.size} engine versions total.`);
        } catch (err) {
            log.error(err);
        }
        return this;
    }

    public isVersionInstalled(id: string): boolean {
        return this.availableVersions.get(id)?.installed ?? false;
    }

    public getLatestInstalledVersion() {
        // Get the engine version from the configuration
        try {
            const config = configManager.getConfig();
            const urlPrefix = config.versions.engine_download_url_prefix;
            const urlParts = urlPrefix.split("/");
            const lastPart = urlParts[urlParts.length - 1];

            // Extract the version identifier
            let configuredEngineVersion = lastPart;
            if (lastPart.includes("spring_bar_.")) {
                configuredEngineVersion = lastPart.split("spring_bar_.")[1];
            } else if (lastPart.includes("rel")) {
                configuredEngineVersion = lastPart;
            }

            // Check if the configured engine version is installed
            if (this.isVersionInstalled(configuredEngineVersion)) {
                const configuredVersion = this.availableVersions.get(configuredEngineVersion);
                if (configuredVersion) {
                    log.info(`Using configured engine version: ${configuredEngineVersion}`);
                    return configuredVersion;
                }
            }
        } catch (err) {
            log.error(`Failed to get configured engine version: ${err}`);
        }

        // Fall back to the alphabetically latest installed version
        const latestVersion = this.availableVersions
            .values()
            .filter((version) => version.installed)
            .toArray()
            .sort((a, b) => a.id.localeCompare(b.id))
            .at(-1);

        if (latestVersion) {
            log.info(`Using latest installed engine version: ${latestVersion.id}`);
        } else {
            log.warn("No installed engine versions found");
        }

        return latestVersion;
    }

    async downloadEngine(): Promise<string> {
        try {
            const config = configManager.getConfig();
            if (!config.versions?.engine_download_url_prefix) {
                throw new Error("Engine download URL prefix not configured");
            }

            const urlPrefix = config.versions.engine_download_url_prefix;
            const platform = process.platform === "win32" ? "windows" : "linux";
            const downloadUrl = `${urlPrefix}_amd64-${platform}.7z`;

            // Extract version from URL prefix
            const urlParts = urlPrefix.split("/");
            const lastPart = urlParts[urlParts.length - 1];
            let version = lastPart;

            // Clean up version identifier for directory name
            if (version.includes("spring_bar_")) {
                version = version.split("spring_bar_")[1];
            } else if (version.includes("rel")) {
                version = version.split("rel")[1];
            }

            const downloadInfo = {
                url: downloadUrl,
                destination: path.join(this.engineDirs, version),
                totalBytes: 1, // Size is unknown at this point
                assetName: `engine_${version}`,
            };

            log.info(`Starting engine download from: ${downloadUrl}`);
            log.info(`Destination: ${downloadInfo.destination}`);

            // Create download directory if it doesn't exist
            await fs.promises.mkdir(downloadInfo.destination, { recursive: true });

            // Download the engine
            const downloadResult = await this.downloadFile(downloadInfo);
            log.info(`Engine download completed: ${downloadResult}`);

            // Add to available versions if not already present
            if (!this.availableVersions.has(version)) {
                this.availableVersions.set(version, {
                    id: version,
                    ais: [],
                    installed: true,
                });
            }

            return version;
        } catch (error) {
            log.error("Failed to download engine:", error);
            throw error;
        }
    }

    public async uninstallVersion(version: EngineVersion | string) {
        if (typeof version === "object") {
            version = version.id;
        }
        const engineDir = path.join(this.engineDirs, version);
        await fs.promises.rm(engineDir, { force: true, recursive: true });
        this.availableVersions.delete(version);
    }

    protected override async downloadComplete(downloadInfo: DownloadInfo) {
        log.debug(`Download complete: ${downloadInfo.name}`);
        this.availableVersions.set(downloadInfo.name, { id: downloadInfo.name, ais: [], installed: true });
        super.downloadComplete(downloadInfo);
    }

    protected async parseAis(engineVersion: string): Promise<EngineAI[]> {
        const ais: EngineAI[] = [];
        const aisPath = path.join(this.engineDirs, engineVersion, "AI", "Skirmish");
        const aiDirs = await fs.promises.readdir(aisPath);
        for (const aiDir of aiDirs) {
            try {
                const ai = await this.parseAi(path.join(aisPath, aiDir));
                ais.push(ai);
            } catch (err) {
                console.error(`Error parsing AI: ${aiDir}`, err);
            }
        }
        return ais;
    }

    protected async parseAi(aiPath: string): Promise<EngineAI> {
        const aiDefinitions = await glob.promise(`${aiPath}/**/{AIInfo.lua,AIOptions.lua}`, { windowsPathsNoEscape: true });
        const aiInfoPath = aiDefinitions.find((filePath) => filePath.endsWith("AIInfo.lua"));
        const aiOptionsPath = aiDefinitions.find((filePath) => filePath.endsWith("AIOptions.lua"));
        if (aiInfoPath === undefined) {
            throw new Error(`AIInfo.lua not found in ${aiPath}`);
        }
        if (aiOptionsPath === undefined) {
            throw new Error(`AIOptions.lua not found in ${aiPath}`);
        }
        const aiInfoFile = await fs.promises.readFile(aiInfoPath);
        const aiInfoFields = parseLuaTable(aiInfoFile);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const aiInfo: Record<string, any> = {};
        for (const field of aiInfoFields) {
            aiInfo[field.key] = field.value;
        }
        const aiOptionsFile = await fs.promises.readFile(aiOptionsPath);
        const aiOptions = parseLuaOptions(aiOptionsFile);
        return {
            shortName: aiInfo.shortName,
            name: aiInfo.name,
            description: aiInfo.description,
            version: aiInfo.version,
            options: aiOptions,
        };
    }

    //TODO move this check to front
    // protected async cleanupOldVersions() {
    //     log.info("Cleaning up old engine versions");
    //     const maxDays = 90;
    //     const oldestDate = new Date();
    //     oldestDate.setDate(oldestDate.getDate() - maxDays);
    //     const versionsToRemove = await cacheDb.selectFrom("engineVersion").where("lastLaunched", "<", oldestDate).select("id").execute();
    //     for (const version of versionsToRemove) {
    //         await this.uninstallVersion(version.id);
    //     }
    // }
}

export const engineContentAPI = new EngineContentAPI();
