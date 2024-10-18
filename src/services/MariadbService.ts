import {
    Injectable,
    AppConfigService,
    ProxyService,
    PluginConfigService,
    DockerService,
    FS,
    FileSystem,
    PickProperties
} from "@wocker/core";
import {demuxOutput, promptConfirm, promptSelect, promptText} from "@wocker/utils";
import {existsSync} from "fs";
import * as Path from "path";
import CliTable from "cli-table3";
import dateFormat from "date-fns/format";

import {Config} from "../makes/Config";
import {Service, ServiceProps} from "../makes/Service";


@Injectable()
export class MariadbService {
    protected containerAdminName = "dbadmin-mariadb.workspace";
    protected config?: Config;

    public constructor(
        protected readonly appConfigService: AppConfigService,
        protected readonly pluginConfigService: PluginConfigService,
        protected readonly dockerService: DockerService,
        protected readonly proxyService: ProxyService
    ) {}

    protected async query(service: Service, query: string): Promise<string | null> {
        const container = await this.dockerService.getContainer(service.containerName);

        if(!container) {
            return null;
        }

        const cmd = ["mariadb", "-e", query];

        if(service.user) {
            cmd.push(`-u${service.user}`);
        }

        if(service.password) {
            cmd.push(`-p${service.password}`);
        }

        const exec = await container.exec({
            Cmd: cmd,
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await exec.start({});

        return new Promise((resolve, reject) => {
            let result = "";

            stream.on("data", (data: any) => {
                result += demuxOutput(data).toString();
            });

            stream.on("end", () => {
                resolve(result);
            });

            stream.on("error", reject);
        });
    }

    protected async getDatabases(service: Service): Promise<string[]> {
        const res = await this.query(service, "SHOW DATABASES;");

        if(!res) {
            return [];
        }

        return res.split(/\r?\n/)
            .filter((database) => {
                return !!database && !/Database$/.test(database);
            })
            .filter((database) => {
                return database !== "mysql";
            })
            .filter((database) => {
                return !/_schema/.test(database);
            });
    }

    protected async getDumpsDatabases(service: Service): Promise<string[]> {
        if(!this.pluginConfigService.exists(`dump/${service.name}`)) {
            return [];
        }

        return this.pluginConfigService.readdir(`dump/${service.name}`);
    }

    protected async getFiles(service: Service, database: string): Promise<string[]> {
        if(!this.pluginConfigService.exists(`dump/${service.name}/${database}`)) {
            return [];
        }

        return this.pluginConfigService.readdir(`dump/${service.name}/${database}`);
    }

    public get configPath(): string {
        return "config.json";
    }

    protected getDbDir(service: string): string {
        return this.appConfigService.dataPath("db/mariadb", service);
    }

    public async init(rootPassword?: string): Promise<void> {
        const config = await this.getConfig();

        if(!rootPassword) {
            rootPassword = await promptText({
                message: "Root password:",
                default: config.rootPassword
            });
        }

        config.rootPassword = rootPassword;

        await config.save();
    }

    public async list(): Promise<string> {
        const config = await this.getConfig();

        const table = new CliTable({
            head: ["Name", "Host", "User", "External", "Storage", "IP"]
        });

        for(const service of config.services) {
            let ip = "";

            if(!service.host) {
                const container = await this.dockerService.getContainer(service.containerName);

                if(container) {
                    const {
                        NetworkSettings: {
                            // IPAddress,
                            Networks: {
                                workspace: {
                                    IPAddress
                                }
                            }
                        }
                    } = await container.inspect();

                    ip = `${IPAddress}`;
                }
            }

            table.push([
                service.name + (config.default === service.name ? " (default)" : ""),
                service.host ? service.host : service.containerName,
                service.user,
                !!service.host,
                !service.host ? service.storage : "",
                ip || "-"
            ]);
        }

        return table.toString();
    }

    public async getServices(): Promise<string[]> {
        const config = await this.getConfig();

        return (config.services || []).map((service) => {
            return service.name;
        });
    }

    public async services(): Promise<void> {
        //
    }

    public async start(name?: string, restart?: boolean): Promise<void> {
        const service = await this.getService(name);

        if(service.host) {
            throw new Error("Service is external");
        }

        await this.dockerService.pullImage("mariadb:latest");

        if(restart) {
            await this.dockerService.removeContainer(service.containerName);
        }

        let container = await this.dockerService.getContainer(service.containerName);

        if(!container) {
            console.info(`Starting ${service.name} service...`);

            const volumes: string[] = [];

            switch(service.storage) {
                case "volume": {
                    if(!this.appConfigService.isVersionGTE || !this.appConfigService.isVersionGTE("1.0.19")) {
                        throw new Error("Please update wocker for using volume storage");
                    }

                    if(!await this.dockerService.hasVolume(service.volumeName)) {
                        await this.dockerService.createVolume(service.volumeName);
                    }

                    volumes.push(`${service.volumeName}:/var/lib/mysql`);
                    break;
                }

                case "filesystem":
                default: {
                    const fs = new FileSystem(this.appConfigService.dataPath("db/mariadb"));

                    if(!fs.exists(service.name)) {
                        fs.mkdir(service.name, {
                            recursive: true
                        });
                    }

                    volumes.push(`${this.getDbDir(service.name)}:/var/lib/mysql`);
                    break;
                }
            }

            container = await this.dockerService.createContainer({
                name: service.containerName,
                image: "mariadb:latest",
                restart: "always",
                env: {
                    ...service.user ? {
                        MARIADB_USER: service.user
                    } : {},
                    ...service.password ? {
                        MARIADB_PASSWORD: service.password,
                        MARIADB_ROOT_PASSWORD: service.password
                    } : {},
                    ...service.passwordHash ? {
                        MARIADB_ROOT_PASSWORD_HASH: service.passwordHash
                    } : {}
                },
                volumes
            });
        }

        const {
            State: {
                Running
            }
        } = await container.inspect();

        if(!Running) {
            await container.start();
        }
    }

    public async startAdmin(): Promise<void> {
        console.info("Phpmyadmin starting...");

        const config = await this.getConfig();

        const servers: Service[] = [];

        for(const service of config.services) {
            if(service.host) {
                continue;
            }

            const container = await this.dockerService.getContainer(service.containerName);

            if(!container) {
                continue;
            }

            servers.push(service);
        }

        await this.dockerService.removeContainer(this.containerAdminName);

        if(servers.length === 0) {
            return;
        }

        for(const service of config.services) {
            if(!service.host) {
                continue;
            }

            servers.push(service);
        }

        let file = await FS.readFile(Path.join(__dirname, "../../data/conf/config.user.inc.php"));

        file = file.toString() + servers.map((service) => {
            const host = service.host || service.containerName;

            const res = [
                `$i++;`,
                `$cfg['Servers'][$i]['host'] = '${host}';`
            ];

            if(service.user && service.password) {
                res.push(`$cfg['Servers'][$i]['auth_type'] = 'config';`);
                res.push(`$cfg['Servers'][$i]['user'] = '${service.user}';`);
                res.push(`$cfg['Servers'][$i]['password'] = '${service.password}';`);
            }
            else if(service.user) {
                res.push(`$cfg['Servers'][$i]['auth_type'] = 'cookie';`);
                res.push(`$cfg['Servers'][$i]['user'] = '${service.user}';`);
            }

            return res.join("\n");
        }).join("\n");

        if(this.appConfigService.isVersionGTE && this.appConfigService.isVersionGTE("1.0.19")) {
            await this.pluginConfigService.fs.writeFile("config.user.inc.php", file);
            this.pluginConfigService.fs.mkdir("dump", {recursive: true});
            this.pluginConfigService.fs.mkdir("save", {recursive: true});
            this.pluginConfigService.fs.mkdir("upload", {recursive: true});
        }
        else {
            await this.pluginConfigService.writeFile("config.user.inc.php", file);
            await this.pluginConfigService.mkdir("dump", {recursive: true});
            await this.pluginConfigService.mkdir("save", {recursive: true});
            await this.pluginConfigService.mkdir("upload", {recursive: true});
        }

        let container = await this.dockerService.getContainer(this.containerAdminName);

        if(!container) {
            await this.dockerService.pullImage("phpmyadmin/phpmyadmin:latest");

            container = await this.dockerService.createContainer({
                name: this.containerAdminName,
                image: "phpmyadmin/phpmyadmin:latest",
                restart: "always",
                env: {
                    VIRTUAL_HOST: this.containerAdminName,
                    VIRTUAL_PORT: "80",
                    PMA_USER: "root",
                    PMA_PASSWORD: config.rootPassword || ""
                },
                volumes: [
                    `${this.pluginConfigService.dataPath("config.user.inc.php")}:/etc/phpmyadmin/config.user.inc.php`,
                    `${this.pluginConfigService.dataPath("save")}:/etc/phpmyadmin/save`,
                    `${this.pluginConfigService.dataPath("upload")}:/etc/phpmyadmin/upload`
                ]
            });
        }

        const {
            State: {
                Running
            }
        } = await container.inspect();

        if(!Running) {
            await container.start();
            await this.proxyService.start();
        }
    }

    public async stop(name?: string): Promise<void> {
        const config = await this.getConfig();
        const service = name
            ? config.getService(name)
            : config.getDefaultService();

        if(!service) {
            throw new Error("Service not found");
        }

        console.info("Mariadb stopping...");

        await this.dockerService.removeContainer(service.containerName);
    }

    public async create(service: {name: string} & Partial<ServiceProps>): Promise<void> {
        const config = await this.getConfig();

        if(!service.user) {
            service.user = await promptText({
                message: "User:"
            });
        }

        if(!service.password) {
            service.password = await promptText({
                message: "Password:",
                type: "password"
            });

            const confirmPassword = await promptText({
                message: "Confirm password:",
                type: "password"
            });

            if(service.password !== confirmPassword) {
                throw new Error("Password didn't match");
            }
        }

        if(!service.storage) {
            service.storage = await promptSelect<any>({
                message: "Storage:",
                options: ["volume", "filesystem"]
            });
        }

        config.setService(service.name, service);

        if(!config.default) {
            config.default = service.name;
        }

        await config.save();
    }

    public async destroy(name: string, force?: boolean): Promise<void> {
        const config = await this.getConfig();

        const service = config.getService(name);

        if(!service) {
            throw new Error(`Service ${name} not found`);
        }

        if(config.default === service.name && !force) {
            throw new Error("Can't destroy default service");
        }

        if(!service.host) {
            await this.dockerService.removeContainer(service.containerName);

            switch(service.storage) {
                case "volume": {
                    if(!this.appConfigService.isVersionGTE || !this.appConfigService.isVersionGTE("1.0.19")) {
                        throw new Error("Please update wocker for using volume storage");
                    }

                    if(await this.dockerService.hasVolume(service.volumeName)) {
                        await this.dockerService.rmVolume(service.volumeName);
                    }
                    break;
                }

                case "filesystem":
                default: {
                    await FS.rm(this.getDbDir(service.name), {
                        recursive: true,
                        force: true
                    });
                    break;
                }
            }
        }

        if(config.default === name) {
            config.default = undefined;
        }

        config.unsetService(name);

        await config.save();
    }

    public async getDefault(): Promise<Service | null> {
        const config = await this.getConfig();

        return config.getDefaultService();
    }

    public async setDefault(name: string): Promise<void> {
        const config = await this.getConfig();

        if(!config.getService(name)) {
            throw new Error(`Service "${name}" not found`);
        }

        config.default = name;

        await config.save();
    }

    public async mariadb(name?: string, database?: string): Promise<void> {
        const config = await this.getConfig();
        const service = name ? config.getService(name) : config.getDefaultService();

        if(!service) {
            throw new Error("Service not found");
        }

        const container = await this.dockerService.getContainer(service.containerName);

        if(!container) {
            throw new Error("Service not started");
        }

        if(!database) {
            if(!process.stdin.isTTY) {
                throw new Error("Database name missing");
            }

            database = await promptSelect({
                message: "Database:",
                options: await this.getDatabases(service)
            });
        }

        const cmd = ["mariadb"];

        if(service.user) {
            cmd.push(`-u${service.user}`);
        }

        if(service.password) {
            cmd.push(`-p${service.password}`);
        }

        if(database) {
            cmd.push(database);
        }

        const exec = await container.exec({
            Cmd: cmd,
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true,
            Tty: process.stdin.isTTY
        });

        const stream = await exec.start({
            hijack: true,
            stdin: true,
            Tty: process.stdin.isTTY
        });

        await this.dockerService.attachStream(stream);
    }

    public async backup(
        name?: string,
        database?: string,
        filename?: string
    ): Promise<void> {
        const config = await this.getConfig();
        const service = name
            ? config.getService(name)
            : config.getDefaultService();

        if(!service) {
            throw new Error("Service not found");
        }

        const container = await this.dockerService.getContainer(service.containerName);

        if(!container) {
            throw new Error("Service not running");
        }

        if(!database) {
            const databases = await this.getDatabases(service);

            database = await promptSelect({
                message: "Database:",
                options: databases
            });
        }

        if(!filename) {
            const date = dateFormat(new Date(), "yyyy-MM-dd HH-mm");

            filename = await promptText({
                message: "File:",
                default: date,
                suffix: ".sql"
            });
        }

        await this.pluginConfigService.mkdir(`dump/${service.name}/${database}`, {
            recursive: true
        });

        const file = this.pluginConfigService.createWriteSteam(`dump/${service.name}/${database}/${filename}.sql`);

        const cmd = ["mariadb-dump", database as string, "--add-drop-table"];

        if(service.user) {
            cmd.push(`-u${service.user}`);
        }

        if(service.password) {
            cmd.push(`-p${service.password}`);
        }

        const exec = await container.exec({
            Cmd: cmd,
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await exec.start({});
        await new Promise((resolve, reject) => {
            stream.on("data", (data: any) => {
                file.write(demuxOutput(data));
            });

            stream.on("end", resolve);
            stream.on("error", reject);
        });
    }

    public async deleteBackup(name?: string, database?: string, filename?: string, confirm?: boolean): Promise<void> {
        const config = await this.getConfig();
        const service = name
            ? config.getService(name)
            : config.getDefaultService();

        if(!service) {
            throw new Error("Service not found");
        }

        if(!database) {
            const databases = await this.getDumpsDatabases(service);

            database = await promptSelect({
                message: "Database:",
                options: databases
            });
        }

        if(!filename) {
            const files = await this.getFiles(service, database);

            filename = await promptSelect({
                message: "File:",
                options: files
            });
        }

        const path = `dump/${service.name}/${database}/${filename}`;

        if(!this.pluginConfigService.exists(path)) {
            throw new Error(`File "${filename}" does not exists.`)
        }

        if(!confirm) {
            confirm = await promptConfirm({
                message: "Are you sure you want to delete?",
                default: false
            });
        }

        if(!confirm) {
            throw new Error("Canceled");
        }

        await this.pluginConfigService.rm(path);

        console.info(`File "${filename}" deleted`);

        return;
    }

    public async restore(
        name?: string,
        database?: string,
        filename?: string
    ): Promise<void> {
        const config = await this.getConfig();
        const service = name
            ? config.getService(name)
            : config.getDefaultService();

        if(!service) {
            throw new Error("Service not found");
        }

        const container = await this.dockerService.getContainer(service.containerName);

        if(!container) {
            throw new Error("Mariadb instance isn't started");
        }

        if(!database) {
            database = await promptSelect({
                options: await this.getDumpsDatabases(service),
                message: "Database:"
            });
        }

        if(!filename) {
            filename = await promptSelect({
                options: await this.getFiles(service, database),
                message: "Filename:"
            });
        }

        const cmd = ["mariadb", database as string];

        if(service.user) {
            cmd.push(`-u${service.user}`);
        }

        if(service.password) {
            cmd.push(`-p${service.password}`);
        }

        const exec = await container.exec({
            Cmd: cmd,
            AttachStdin: true,
            AttachStderr: true,
            AttachStdout: true
        });

        const stream = await exec.start({
            hijack: true,
            stdin: true,

        });

        await new Promise((resolve, reject) => {
            const file = this.pluginConfigService.createReadStream(`dump/${service.name}/${database}/${filename}`);

            file.on("data", (data) => {
                stream.write(data);
            });

            file.on("error", reject);
            file.on("end", resolve);

            stream.on("data", (data) => {
                process.stdout.write(data);
            });

            stream.on("error", (err: Error) => {
                file.close();
                reject(err);
            });
        });

        stream.write("exit\n");
    }

    public async dump(name?: string, database?: string): Promise<void> {
        const service = await this.getService(name);
        const container = await this.dockerService.getContainer(service.containerName);

        if(!container) {
            throw new Error("Service isn't started");
        }

        if(!database) {
            if(!process.stdin.isTTY) {
                throw new Error("Database is missing");
            }

            const databases = await this.getDatabases(service);

            database = await promptSelect({
                message: "Database:",
                options: databases
            });
        }

        const cmd = ["mariadb-dump", database as string, "--add-drop-table"];

        if(service.user) {
            cmd.push(`-u${service.user}`);
        }

        if(service.password) {
            cmd.push(`-p${service.password}`);
        }

        const exec = await container.exec({
            Cmd: cmd,
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await exec.start({
            Tty: process.stdin.isTTY,
            hijack: true
        });

        stream.pipe(process.stdout);
    }

    public async getConfig(): Promise<Config> {
        if(!this.config) {
            let data: PickProperties<Config> = !existsSync(this.pluginConfigService.dataPath(this.configPath))
                ? {
                    default: "default",
                    services: [
                        {
                            name: "default",
                            user: "root",
                            password: "root",
                            storage: "volume"
                        }
                    ]
                }
                : await this.pluginConfigService.readJSON(this.configPath);

            const _this = this;

            this.config = new class extends Config {
                public async save(): Promise<void> {
                    await _this.pluginConfigService.writeJSON(_this.configPath, this.toJSON());
                }
            }(data);
        }

        return this.config;
    }

    public async getService(name?: string): Promise<Service> {
        const config = await this.getConfig();
        const service = name
            ? config.getService(name)
            : config.getDefaultService();

        if(!service) {
            throw new Error(
                name
                    ? `Service "${name}" not found`
                    : "Default service not found"
            );
        }

        return service;
    }
}
