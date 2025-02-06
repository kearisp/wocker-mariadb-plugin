import {
    Controller,
    Command,
    Description,
    Completion,
    Option,
    Param
} from "@wocker/core";
import {
    AppConfigService,
    DockerService
} from "@wocker/core";

import {ServiceStorageType} from "../makes/Service";
import {MariadbService} from "../services/MariadbService";


@Controller()
export class MariadbController {
    public constructor(
        protected readonly appConfigService: AppConfigService,
        protected readonly dockerService: DockerService,
        protected readonly mariadbService: MariadbService
    ) {}

    @Command("mariadb [service]")
    @Description("Interacts with a specified MariaDB service, optionally targeting a specific database within that service.")
    public async mariadb(
        @Param("service")
        service?: string,
        @Option("database", {
            type: "string",
            alias: "d",
            description: "<name> Specify the database to target within the service"
        })
        database?: string
    ): Promise<void> {
        await this.mariadbService.mariadb(service, database);
    }

    @Command("mariadb:init")
    public async init(
        @Option("admin-hostname", {
            type: "string",
            alias: "A"
        })
        adminHostname?: string
    ): Promise<void> {
        await this.mariadbService.init(adminHostname);
    }

    @Command("mariadb:create [service]")
    @Description("Creates a MariaDB service with configurable credentials, host, and storage options.")
    public async create(
        @Param("service")
        name?: string,
        @Option("username", {
            type: "string",
            alias: "u",
            description: "User name"
        })
        username?: string,
        @Option("password", {
            type: "string",
            alias: "p",
            description: "Password"
        })
        password?: string,
        @Option("root-password", {
            type: "string",
            alias: "P",
            description: "Root password"
        })
        rootPassword?: string,
        @Option("host", {
            type: "string",
            alias: "h",
            description: "External host"
        })
        host?: string,
        @Option("storage", {
            type: "string",
            alias: "s",
            description: "Storage type"
        })
        storage?: ServiceStorageType,
        @Option("image", {
            type: "string",
            alias: "i",
            description: "The image name to start the service with"
        })
        imageName?: string,
        @Option("image-version", {
            type: "string",
            alias: "I",
            description: "The image version to start the service with"
        })
        imageVersion?: string,
        @Option("volume", {
            type: "string",
            alias: "v",
            description: "Specify volume name"
        })
        volume?: string
    ): Promise<void> {
        await this.mariadbService.create({
            name,
            username,
            password,
            rootPassword,
            host,
            storage,
            imageName,
            imageVersion,
            volume
        });

        if(host) {
            await this.mariadbService.startAdmin();
        }
    }

    @Command("mariadb:destroy [service]")
    @Description("Destroys a specified MariaDB service instance with an option to force deletion.")
    public async destroy(
        @Param("service")
        service?: string,
        @Option("force", {
            type: "boolean",
            alias: "f",
            description: "Force deletion"
        })
        force?: boolean,
        @Option("yes", {
            type: "boolean",
            alias: "y",
            description: "Skip confirmation"
        })
        yes?: boolean
    ): Promise<void> {
        await this.mariadbService.destroy(service, yes, force);
        await this.mariadbService.startAdmin();
    }

    @Command("mariadb:upgrade [name]")
    public async upgrade(
        @Param("name")
        name?: string,
        @Option("storage", {
            type: "string",
            alias: "s",
            description: "Specify storage type"
        })
        storage?: ServiceStorageType,
        @Option("volume", {
            type: "string",
            alias: "v",
            description: "Specify volume name"
        })
        volume?: string,
        @Option("image", {
            type: "string",
            alias: "i"
        })
        imageName?: string,
        @Option("image-version", {
            type: "string",
            alias: "I"
        })
        imageVersion?: string
    ): Promise<void> {
        await this.mariadbService.upgrade({
            name,
            storage,
            volume,
            imageName,
            imageVersion
        });
    }

    @Command("mariadb:use [service]")
    @Description("Sets a specified MariaDB service as the default or retrieves the current default service name if no service is specified.")
    public async default(
        @Param("service")
        service?: string
    ): Promise<string | undefined> {
        if(!service) {
            const data = this.mariadbService.config.getDefaultService();

            return `${data.name}\n`;
        }

        await this.mariadbService.setDefault(service);
    }

    @Command("mariadb:start [service]")
    @Description("Starts a specified MariaDB service and optionally restarts it if already running.")
    public async start(
        @Param("service")
        service?: string,
        @Option("restart", {
            type: "boolean",
            alias: "r",
            description: "Restart the service if already running"
        })
        restart?: boolean
    ): Promise<void> {
        await this.mariadbService.start(service, restart);
        await this.mariadbService.startAdmin();
    }

    @Command("mariadb:stop [service]")
    @Description("Stops a specified MariaDB service instance.")
    public async stop(
        @Param("service")
        service?: string
    ): Promise<void> {
        await this.mariadbService.stop(service);
        await this.mariadbService.startAdmin();
    }

    @Command("mariadb:dump [service]")
    @Description("Creates a dump of the specified MariaDB service with an optional database selection.")
    public async dump(
        @Param("service")
        service?: string,
        @Option("database", {
            type: "string",
            alias: "d",
            description: "Name of the database to dump"
        })
        database?: string
    ): Promise<void> {
        await this.mariadbService.dump(service, database);
    }

    @Command("mariadb:backup [service]")
    @Description("Creates or deletes a database backup for a MariaDB service.")
    public async backup(
        @Param("service")
        service?: string,
        @Option("yes", {
            type: "boolean",
            alias: "y",
            description: "Auto confirm file deletion"
        })
        yes?: boolean,
        @Option("delete", {
            type: "boolean",
            alias: "D",
            description: "Delete the specified backup file"
        })
        del?: boolean,
        @Option("database", {
            type: "string",
            alias: "d",
            description: "Database name to back up"
        })
        database?: string,
        @Option("filename", {
            type: "string",
            alias: "f",
            description: "Name of the backup file"
        })
        filename?: string
    ): Promise<void> {
        if(del) {
            await this.mariadbService.deleteBackup(service, database, filename, yes);
            return;
        }

        await this.mariadbService.backup(service, database, filename);
    }

    @Command("mariadb:restore [service]")
    public async restore(
        @Param("service")
        service?: string,
        @Option("database", {
            type: "string",
            alias: "d",
            description: "Database name"
        })
        database?: string,
        @Option("filename", {
            type: "string",
            alias: "f",
            description: "File name"
        })
        filename?: string
    ): Promise<void> {
        await this.mariadbService.restore(service, database, filename);
    }

    @Command("mariadb:ls")
    @Command("mariadb:list")
    public async list(): Promise<string> {
        return this.mariadbService.list();
    }

    @Completion("service", "mariadb:create [service]")
    public getEmp(): string[] {
        return [];
    }

    @Completion("database", "mariadb:backup [service]")
    public async getDatabases(
        @Param("service")
        name?: string
    ): Promise<string[]> {
        try {
            const service = this.mariadbService.config.getServiceOrDefault(name);

            return await this.mariadbService.getDatabases(service);
        }
        catch(err) {
            return [];
        }
    }

    @Completion("filename")
    public async getFilename(
        @Param("service")
        service?: string,
        @Option("database")
        database?: string
    ): Promise<string[]> {
        if(!service || !database) {
            return [];
        }

        return [];
    }

    @Completion("service")
    public getExistsServices(): string[] {
        return this.mariadbService.getServices();
    }
}
