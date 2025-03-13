import { logger } from "@main/utils/logger";
import Ajv, { ValidateFunction } from "ajv";
import fs from "fs";
import path from "path";
import axios from "axios";
import { LATEST_GAME_VERSION } from "./constants";
// Import the schema and defaults directly
import schemaJson from "./schema.json";
import defaultsJson from "./defaults.json";

const log = logger("config-manager");

// Default remote config URL
export const DEFAULT_CONFIG_URL = "https://config.beyondallreason.dev/config.json";

// Configuration types
export interface Config {
    versions: {
        /**
         * Complete URL prefix for engine downloads.
         * This is combined with architecture-specific suffix to form the complete download URL.
         * Example: "https://github.com/beyond-all-reason/spring/releases/download/2025.01.6/spring_bar_.rel2501.2025.01.6"
         * The architecture suffix (e.g., "_windows-64-minimal-portable.7z") will be appended to this.
         */
        engine_download_url_prefix: string;

        game: string;
    };
    contentSources: {
        rapid: {
            host: string;
            game: string;
        };
        gameGithub: {
            owner: string;
            repo: string;
        };
        engineGitHub: {
            owner: string;
            repo: string;
        };
    };
    defaultMaps: string[];
    mapParsing: {
        mipmapSize: number;
    };
    server: {
        hostname: string;
        oauth: {
            authorizationUrl: string;
            wellKnownUrl: string;
            clientId: string;
            scope: string;
        };
        wsUrl: string;
    };
}

// Configuration specification parameter type
export type ConfigSpecification = string | undefined;

class ConfigManager {
    private static instance: ConfigManager;
    private config: Config | null = null;
    private schema: object | null = null;
    private validator: ValidateFunction | null = null;
    private verbose: boolean = true; // Enable verbose logging by default
    private initialized: boolean = false;
    private initializationPromise: Promise<void> | null = null;

    // Private constructor to prevent direct instantiation
    private constructor() {}

    /**
     * Get the singleton instance of ConfigManager
     */
    public static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    /**
     * Set verbose logging mode
     * @param verbose Whether to enable verbose logging
     */
    public setVerboseLogging(verbose: boolean): void {
        this.verbose = verbose;
        log.info(`Verbose logging ${verbose ? "enabled" : "disabled"}`);
    }

    /**
     * Initialize the configuration manager
     * @param configSpec Optional file path or URL to load configuration from
     */
    public async initialize(configSpec?: ConfigSpecification): Promise<void> {
        // If already initialized, return immediately
        if (this.initialized) {
            if (this.verbose) log.info("Config manager already initialized, skipping initialization");
            return;
        }

        // If initialization is in progress, wait for it to complete
        if (this.initializationPromise) {
            if (this.verbose) log.info("Config manager initialization already in progress, waiting for completion");
            return this.initializationPromise;
        }

        // Start initialization
        this.initializationPromise = this.doInitialize(configSpec);

        try {
            await this.initializationPromise;
            this.initialized = true;
        } catch (error) {
            this.initializationPromise = null;
            throw error;
        }
    }

    /**
     * Actual initialization implementation
     * @param configSpec Optional file path or URL to load configuration from
     */
    private async doInitialize(configSpec?: ConfigSpecification): Promise<void> {
        try {
            log.info("Initializing configuration manager");
            if (this.verbose) log.info(`Config specification: ${configSpec || "none (using defaults)"}`);

            // Load schema from imported JSON
            if (this.verbose) log.info("Loading schema from imported JSON");
            try {
                this.schema = schemaJson;
                if (this.verbose) log.info("Schema loaded successfully");
            } catch (error) {
                log.error("Failed to load schema from imported JSON", error);
                throw new Error(`Failed to load schema: ${error instanceof Error ? error.message : String(error)}`);
            }

            // Create validator
            if (this.verbose) log.info("Creating schema validator");
            const ajv = new Ajv({
                allErrors: true,
                coerceTypes: true,
            });
            this.validator = ajv.compile(this.schema as object);

            // Load default configuration
            if (this.verbose) log.info("Loading default configuration");

            // Use the imported defaults.json
            const defaultConfig = defaultsJson as Config;

            // Validate the default configuration
            if (!this.validator(defaultConfig)) {
                const errors = this.validator.errors;
                log.error("Default configuration validation failed", errors);
                throw new Error(`Default configuration validation failed: ${JSON.stringify(errors)}`);
            }

            if (this.verbose) log.info("Default configuration validated successfully");

            // Set default configuration
            this.config = defaultConfig;
            if (this.verbose) {
                log.info("Default configuration set");
                log.info(`Engine download URL prefix: ${this.config.versions.engine_download_url_prefix}`);
                log.info(`Game version: ${this.config.versions.game}`);
                log.info(`Default maps: ${this.config.defaultMaps.join(", ")}`);
            }

            // Load configuration from specification if provided
            if (configSpec) {
                await this.loadFromSpecification(configSpec);
            } else {
                if (this.verbose) log.info("Using default configuration");
            }

            log.info("Configuration manager initialized successfully");
        } catch (error) {
            log.error("Failed to initialize configuration manager", error);
            throw error;
        }
    }

    /**
     * Load configuration from a file path or URL
     * @param configSpec File path or URL to load configuration from
     */
    private async loadFromSpecification(configSpec: string): Promise<void> {
        try {
            let configData: string;

            // Check if the specification is a URL
            if (configSpec.startsWith("http://") || configSpec.startsWith("https://")) {
                // Load from URL
                if (this.verbose) log.info(`Loading configuration from URL: ${configSpec}`);
                try {
                    const response = await axios.get(configSpec);
                    configData = JSON.stringify(response.data);
                    if (this.verbose) log.info("Configuration loaded successfully from URL");
                } catch (error) {
                    log.error(`Failed to fetch configuration from URL: ${configSpec}`, error);
                    throw new Error(`Failed to fetch configuration from URL: ${error instanceof Error ? error.message : String(error)}`);
                }
            } else {
                // Load from file - assume path is absolute
                const configPath = configSpec;

                if (this.verbose) log.info(`Loading configuration from file: ${configPath}`);
                try {
                    configData = fs.readFileSync(configPath, "utf8");
                    if (this.verbose) log.info("Configuration loaded successfully from file");
                } catch (error) {
                    log.error(`Failed to read configuration file: ${configPath}`, error);
                    throw new Error(`Failed to read configuration file: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

            // Parse the configuration
            let loadedConfig: Config;
            try {
                if (this.verbose) log.info("Parsing configuration data");
                loadedConfig = JSON.parse(configData) as Config;
                if (this.verbose) log.info("Configuration data parsed successfully");
            } catch (error) {
                log.error("Failed to parse configuration data", error);
                throw new Error(`Failed to parse configuration data: ${error instanceof Error ? error.message : String(error)}`);
            }

            // Validate the configuration
            if (this.verbose) log.info("Validating loaded configuration against schema");
            if (!this.validator || !this.validator(loadedConfig)) {
                log.error("Loaded configuration does not conform to schema", this.validator?.errors);
                throw new Error("Configuration validation failed");
            }
            if (this.verbose) log.info("Loaded configuration validated successfully");

            // Update the configuration
            this.config = loadedConfig;
            if (this.verbose) {
                log.info("Loaded configuration set as current configuration");
                log.info(`Engine download URL prefix: ${this.config.versions.engine_download_url_prefix}`);
                log.info(`Game version: ${this.config.versions.game}`);
                log.info(`Default maps: ${this.config.defaultMaps.join(", ")}`);
            }

            log.info("Configuration loaded successfully from specification");
        } catch (error) {
            log.error("Failed to load configuration from specification", error);
            throw error;
        }
    }

    /**
     * Get the current configuration
     * @returns The current configuration
     * @throws Error if the configuration manager is not initialized
     */
    public getConfig(): Config {
        if (!this.initialized && !this.config) {
            log.error("Configuration manager not initialized");
            throw new Error("Configuration manager not initialized");
        }
        return this.config as Config;
    }

    /**
     * Get a string representation of the current configuration for debugging
     */
    public getConfigSummary(): string {
        if (!this.config) {
            return "Configuration not initialized";
        }

        return `Configuration Summary:
- Engine Download URL Prefix: ${this.config.versions.engine_download_url_prefix}
- Game Version: ${this.config.versions.game}
- Content Sources:
  - Rapid: ${this.config.contentSources.rapid.host}/${this.config.contentSources.rapid.game}
  - Game GitHub: ${this.config.contentSources.gameGithub.owner}/${this.config.contentSources.gameGithub.repo}
  - Engine GitHub: ${this.config.contentSources.engineGitHub.owner}/${this.config.contentSources.engineGitHub.repo}
- Default Maps: ${this.config.defaultMaps.join(", ")}
- Map Parsing:
  - Mipmap Size: ${this.config.mapParsing.mipmapSize}
- Server:
  - Hostname: ${this.config.server.hostname}
  - WebSocket URL: ${this.config.server.wsUrl}
  - OAuth:
    - Client ID: ${this.config.server.oauth.clientId}
    - Scope: ${this.config.server.oauth.scope}`;
    }
}

// Export a singleton instance
export const configManager = ConfigManager.getInstance();
