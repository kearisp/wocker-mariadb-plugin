import {AppConfigService, DockerService, FileSystem, Injectable, PluginConfigService, ProxyService} from "@wocker/core";
import {promptInput, promptConfirm, promptSelect} from "@wocker/utils";
import * as Path from "path";
import CliTable from "cli-table3";
import {format as dateFormat} from "date-fns/format";
import {Config, ConfigProps} from "../makes/Config";
import {Service, ServiceProps, ServiceStorageType, STORAGE_FILESYSTEM, STORAGE_VOLUME} from "../makes/Service";


@Injectable()
export class MariadbService {
    protected _config?: Config;

    public constructor(
        protected readonly appConfigService: AppConfigService,
        protected readonly pluginConfigService: PluginConfigService,
        protected readonly dockerService: DockerService,
        protected readonly proxyService: ProxyService
    ) {}

    public get configPath(): string {
        return "config.json";
    }

    public get config(): Config {
        if(!this._config) {
            const _this = this,
                fs = this.fs,
                data: ConfigProps = fs.exists(this.configPath) ? fs.readJSON(this.configPath) : {};

            this._config = new class extends Config {
                public save(): void {
                    fs.writeJSON(_this.configPath, this.toObject());
                }
            }(data);
        }

        return this._config;
    }

    public get fs(): FileSystem {
        return this.pluginConfigService.fs;
    }

    public get dbFs(): FileSystem {
        return new FileSystem(this.appConfigService.dataPath("db/mariadb"));
    }

    public get dataFs(): FileSystem {
        return new FileSystem(Path.join(__dirname, "../../data"));
    }

    protected async query(service: Service, query: string): Promise<string | null> {
        const container = await this.dockerService.getContainer(service.containerName);

        if(!container) {
            return null;
        }

        const exec = await container.exec({
            Cmd: ["mariadb", ...service.auth, "-e", query],
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await exec.start({});

        return new Promise<string>((resolve, reject) => {
            let result = "";

            stream.on("data", (data: any) => {
                result += data.toString();
            });

            stream.on("end", () => {
                resolve(result);
            });

            stream.on("error", reject);
        });
    }

    public async getDatabases(service: Service): Promise<string[]> {
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
        if(!this.fs.exists(`dump/${service.name}`)) {
            return [];
        }

        return this.fs.readdir(`dump/${service.name}`);
    }

    protected async getFiles(service: Service, database: string): Promise<string[]> {
        if(!this.fs.exists(`dump/${service.name}/${database}`)) {
            return [];
        }

        return this.fs.readdir(`dump/${service.name}/${database}`);
    }

    public async init(adminHostname?: string): Promise<void> {
        const config = this.config;

        if(!adminHostname) {
            adminHostname = await promptInput({
                message: "Admin hostname",
                required: true,
                default: config.adminHostname
            }) as string;
        }

        config.adminHostname = adminHostname;

        config.save();
    }

    public async list(): Promise<string> {
        const config = this.config;

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
                service.username,
                !!service.host,
                !service.host ? service.storage : "",
                ip || "-"
            ]);
        }

        return table.toString();
    }

    public getServices(): string[] {
        return (this.config.services || []).map((service) => {
            return service.name;
        });
    }

    public async start(name?: string, restart?: boolean): Promise<void> {
        if(!name && !this.config.hasDefaultService()) {
            await this.create();
        }

        const service = this.config.getServiceOrDefault(name);

        if(service.host) {
            throw new Error("Service is external");
        }

        await this.dockerService.pullImage(service.imageTag);

        if(restart) {
            await this.dockerService.removeContainer(service.containerName);
        }

        let container = await this.dockerService.getContainer(service.containerName);

        if(!container) {
            console.info(`Starting ${service.name} service...`);

            const volumes: string[] = [];

            switch(service.storage) {
                case STORAGE_VOLUME: {
                    if(!this.pluginConfigService.isVersionGTE("1.0.19")) {
                        throw new Error("Please update wocker for using volume storage");
                    }

                    if(!await this.dockerService.hasVolume(service.volume)) {
                        await this.dockerService.createVolume(service.volume);
                    }

                    volumes.push(`${service.volume}:/var/lib/mysql`);
                    break;
                }

                case STORAGE_FILESYSTEM:
                default: {
                    if(!this.dbFs.exists(service.name)) {
                        this.dbFs.mkdir(service.name, {
                            recursive: true
                        });
                    }

                    volumes.push(`${this.dbFs.path(service.name)}:/var/lib/mysql`);
                    break;
                }
            }

            container = await this.dockerService.createContainer({
                name: service.containerName,
                image: service.imageTag,
                restart: "always",
                env: {
                    ...service.username ? {
                        MARIADB_USER: service.username
                    } : {},
                    ...service.password ? {
                        MARIADB_PASSWORD: service.password
                    } : {},
                    ...service.passwordHash ? {
                        MARIADB_ROOT_PASSWORD_HASH: service.passwordHash
                    } : {},
                    ...service.rootPassword ? {
                        MARIADB_ROOT_PASSWORD: service.rootPassword
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

        const config = this.config;

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

        await this.dockerService.removeContainer(config.adminHostname);

        if(servers.length === 0) {
            return;
        }

        for(const service of config.services) {
            if(!service.host) {
                continue;
            }

            servers.push(service);
        }

        let conf = this.dataFs.readFile("conf/config.user.inc.php");
        let file = conf.toString() + servers.map((service, index) => {
            const host = service.host || service.containerName;

            const user = service.host ? service.username : "root";
            const password = service.host ? service.password : service.rootPassword;

            const res = [
                index !== 0 ? `$i++;` : "",
                `$cfg['Servers'][$i]['host'] = '${host}';`
            ];

            if(user && password) {
                res.push(`$cfg['Servers'][$i]['auth_type'] = 'config';`);
                res.push(`$cfg['Servers'][$i]['user'] = '${user}';`);
                res.push(`$cfg['Servers'][$i]['password'] = '${password}';`);
            }
            else if(user) {
                res.push(`$cfg['Servers'][$i]['auth_type'] = 'cookie';`);
                res.push(`$cfg['Servers'][$i]['user'] = '${user}';`);
            }

            return res.join("\n");
        }).join("\n");

        this.fs.writeFile("config.user.inc.php", file);
        this.fs.mkdir("dump", {recursive: true});
        this.fs.mkdir("save", {recursive: true});
        this.fs.mkdir("upload", {recursive: true});

        let container = await this.dockerService.getContainer(config.adminHostname);

        if(!container) {
            await this.dockerService.pullImage("phpmyadmin/phpmyadmin:latest");

            container = await this.dockerService.createContainer({
                name: config.adminHostname,
                image: "phpmyadmin/phpmyadmin:latest",
                restart: "always",
                env: {
                    VIRTUAL_HOST: config.adminHostname,
                    VIRTUAL_PORT: "80"
                },
                volumes: [
                    `${this.fs.path("config.user.inc.php")}:/etc/phpmyadmin/config.user.inc.php`,
                    `${this.fs.path("save")}:/etc/phpmyadmin/save`,
                    `${this.fs.path("upload")}:/etc/phpmyadmin/upload`
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
            await this.dockerService.exec(config.adminHostname, [
                "bash", "-c",
                [
                    "apt-get update",
                    "apt-get install acl",
                    "setfacl -R -m u:www-data:rwx /etc/phpmyadmin/save"
                ].join(" && ")
            ]);

            await this.proxyService.start();
        }
    }

    public async stop(name?: string): Promise<void> {
        const config = this.config;
        const service = name
            ? config.getService(name)
            : config.getDefaultService();

        if(!service) {
            throw new Error("Service not found");
        }

        console.info("Mariadb stopping...");

        await this.dockerService.removeContainer(service.containerName);
    }

    public async create(serviceProps: Partial<ServiceProps> = {}): Promise<void> {
        if(serviceProps.name && this.config.hasService(serviceProps.name)) {
            console.info(`Service "${serviceProps.name}" is already exists`);
            delete serviceProps.name;
        }

        if(!serviceProps.name) {
            serviceProps.name = await promptInput({
                message: "Service name",
                required: "Service name is required",
                validate: (value?: string) => {
                    if(value && this.config.hasService(value)) {
                        return `Service "${value}" is already exists`;
                    }

                    return true;
                }
            });
        }

        if(!serviceProps.username) {
            serviceProps.username = await promptInput({
                message: "User",
                required: true
            });
        }

        if(!serviceProps.password) {
            serviceProps.password = await promptInput({
                message: "Password",
                type: "password",
                required: true
            });

            const confirmPassword = await promptInput({
                message: "Confirm password",
                type: "password"
            });

            if(serviceProps.password !== confirmPassword) {
                throw new Error("Password didn't match");
            }
        }

        if(!serviceProps.host) {
            if(!serviceProps.rootPassword && serviceProps.username !== "root") {
                serviceProps.rootPassword = await promptInput({
                    message: "Root password",
                    type: "password",
                    required: true
                });

                const confirmPassword = await promptInput({
                    message: "Confirm root password",
                    type: "password",
                    required: true
                });

                if(serviceProps.rootPassword !== confirmPassword) {
                    throw new Error("Password didn't match");
                }
            }

            if(!serviceProps.storage || ![STORAGE_VOLUME, STORAGE_FILESYSTEM].includes(serviceProps.storage)) {
                serviceProps.storage = await promptSelect<ServiceStorageType>({
                    message: "Storage:",
                    options: [STORAGE_VOLUME, STORAGE_FILESYSTEM]
                });
            }
        }

        this.config.setService(new Service(serviceProps as ServiceProps));
        this.config.save();
    }

    public async upgrade(serviceProps: Partial<ServiceProps> = {}): Promise<void> {
        const service = this.config.getServiceOrDefault(serviceProps.name);

        if(serviceProps.storage) {
            if(![STORAGE_FILESYSTEM, STORAGE_VOLUME].includes(serviceProps.storage)) {
                throw new Error("Invalid storage type");
            }

            service.storage = serviceProps.storage;
        }

        if(serviceProps.volume) {
            service.volume = serviceProps.volume;
        }

        if(serviceProps.imageName) {
            service.imageName = serviceProps.imageName;
        }

        if(serviceProps.imageVersion) {
            service.imageVersion = serviceProps.imageVersion;
        }

        this.config.setService(service);
        this.config.save();
    }

    public async destroy(name?: string, yes?: boolean, force?: boolean): Promise<void> {
        if(!name) {
            throw new Error("Service name required");
        }

        const service = this.config.getService(name);

        if(this.config.default === service.name) {
            if(!force) {
                throw new Error("Can't destroy default service");
            }
        }

        if(!yes) {
            const confirm = await promptConfirm({
                message: `Are you sure you want to delete the "${name}" database? This action cannot be undone and all data will be lost.`,
                default: false
            });

            if(!confirm) {
                throw new Error("Aborted");
            }
        }

        if(!service.host) {
            await this.dockerService.removeContainer(service.containerName);

            switch(service.storage) {
                case STORAGE_VOLUME: {
                    if(service.volume !== service.defaultVolume) {
                        console.info(`Deletion of custom volume "${service.volume}" skipped.`);
                        break;
                    }

                    if(!this.pluginConfigService.isVersionGTE("1.0.19")) {
                        throw new Error("Please update wocker for using volume storage");
                    }

                    if(await this.dockerService.hasVolume(service.volume)) {
                        await this.dockerService.rmVolume(service.volume);
                    }
                    break;
                }

                case STORAGE_FILESYSTEM:
                default: {
                    this.dbFs.rm(service.name, {
                        recursive: true,
                        force: true
                    });
                    break;
                }
            }
        }

        this.config.unsetService(name);
        this.config.save();
    }

    public async setDefault(name: string): Promise<void> {
        const service = this.config.getService(name);

        this.config.default = service.name;
        this.config.save();
    }

    public async mariadb(name?: string, database?: string): Promise<void> {
        const service = this.config.getServiceOrDefault(name);
        const container = await this.dockerService.getContainer(service.containerName);

        if(!container) {
            throw new Error(`Service "${service.name}" is not started`);
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

        const exec = await container.exec({
            Cmd: ["mariadb", ...service.auth, database],
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

    public async backup(name?: string, database?: string, filename?: string): Promise<void> {
        const service = this.config.getServiceOrDefault(name);

        const container = await this.dockerService.getContainer(service.containerName);

        if(!container) {
            throw new Error("Service not running");
        }

        if(!database) {
            const databases = await this.getDatabases(service);

            database = await promptSelect({
                message: "Database:",
                options: databases
            }) as string;
        }

        if(!filename) {
            const date = dateFormat(new Date(), "yyyy-MM-dd HH-mm");

            filename = await promptInput({
                message: "File",
                default: date,
                suffix: ".sql"
            });
            filename += ".sql";
        }

        this.pluginConfigService.fs.mkdir(`dump/${service.name}/${database}`, {
            recursive: true
        });

        const file = this.fs.createWriteStream(`dump/${service.name}/${database}/${filename}`);

        const exec = await container.exec({
            Cmd: ["mariadb-dump", ...service.auth, database as string, "--add-drop-table", "--hex-blob"],
            Tty: true,
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await exec.start({
            Tty: true,
            stdin: true,
            hijack: true
        });

        await new Promise((resolve, reject) => {
            stream.on("data", (data: Buffer): void => {
                file.write(data.toString("utf-8"));
            });

            stream.on("end", resolve);
            stream.on("error", reject);
        });
    }

    public async deleteBackup(name?: string, database?: string, filename?: string, confirm?: boolean): Promise<void> {
        const service = this.config.getServiceOrDefault(name);

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

        if(!this.fs.exists(path)) {
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

        this.fs.rm(path);

        console.info(`File "${filename}" deleted`);

        return;
    }

    public async restore(name?: string, database?: string, filename?: string): Promise<void> {
        const service = this.config.getServiceOrDefault(name);

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

        const exec = await container.exec({
            Cmd: ["mariadb", ...service.auth, database as string],
            AttachStdin: true,
            AttachStderr: true,
            AttachStdout: true
        });

        const stream = await exec.start({
            hijack: true,
            stdin: true
        });

        await new Promise((resolve, reject) => {
            const file = this.fs.createReadStream(`dump/${service.name}/${database}/${filename}`);

            file.on("data", (data) => {
                stream.write(data);
            });

            file.on("error", reject);
            file.on("end", () => resolve(undefined));

            stream.on("data", (data: any): void => {
                process.stdout.write(data);
            });

            stream.on("error", (err: Error): void => {
                file.close();
                reject(err);
            });
        });

        stream.write("exit\n");
    }

    public async dump(name?: string, database?: string): Promise<void> {
        const service = this.config.getServiceOrDefault(name);
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

        const exec = await container.exec({
            Cmd: ["mariadb-dump", ...service.auth, database as string, "--add-drop-table"],
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await exec.start({
            Tty: process.stdin.isTTY,
            hijack: true
        });

        stream.pipe(process.stdout);
    }
}
