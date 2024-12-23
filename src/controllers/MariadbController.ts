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
        @Option("root-password", {
            type: "string",
            alias: "p"
        })
        rootPassword?: string
    ): Promise<void> {
        await this.mariadbService.init(rootPassword);
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
        storage?: ServiceStorageType
    ): Promise<void> {
        await this.mariadbService.create({
            name,
            username,
            password,
            rootPassword,
            host,
            storage
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
        force?: boolean
    ): Promise<void> {
        await this.mariadbService.destroy(service, force);
        await this.mariadbService.startAdmin();
    }

    @Command("mariadb:use [service]")
    @Description("Sets a specified MariaDB service as the default or retrieves the current default service name if no service is specified.")
    public async default(
        @Param("service")
        service?: string
    ): Promise<string | undefined> {
        if(!service) {
            const data = await this.mariadbService.getDefault();

            if(!data) {
                throw new Error("Default service isn't set");
            }

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
    public async dump(
        @Param("service")
        service?: string,
        @Option("database", {
            type: "string",
            alias: "d"
        })
        database?: string
    ): Promise<void> {
        await this.mariadbService.dump(service, database);
    }

    @Command("mariadb:backup [service]")
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
            description: "Delete backup file"
        })
        del?: boolean,
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
            const service = await this.mariadbService.getService(name);

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
    public async getExistsServices(): Promise<string[]> {
        return this.mariadbService.getServices();
    }
}
