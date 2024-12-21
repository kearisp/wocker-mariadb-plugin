import {
    Injectable,
    AppConfigService,
    ProxyService,
    PluginConfigService,
    DockerService,
    FS,
    FileSystem
} from "@wocker/core";
import {promptConfirm, promptSelect, promptText} from "@wocker/utils";
import * as Path from "path";
import CliTable from "cli-table3";
import dateFormat from "date-fns/format";

import {Config, ConfigProps} from "../makes/Config";
import {Service, ServiceProps, ServiceStorageType, STORAGE_VOLUME, STORAGE_FILESYSTEM} from "../makes/Service";


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
                    fs.writeJSON(_this.configPath, this.toJSON());
                }
            }(data);
        }

        return this._config;
    }

    public get fs(): FileSystem {
        let fs = this.pluginConfigService.fs;

        if(!fs) {
            fs = new FileSystem(this.pluginConfigService.dataPath());
        }

        return fs;
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

        const cmd = ["mariadb", "-e", query];

        if(!service.host) {
            cmd.push(`-uroot`);

            if(service.rootPassword) {
                cmd.push(`-p${service.rootPassword}`);
            }
        }
        else {
            if(service.username) {
                cmd.push(`-u${service.username}`);
            }

            if(service.password) {
                cmd.push(`-p${service.password}`);
            }
        }

        const exec = await container.exec({
            Cmd: cmd,
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
            adminHostname = await promptText({
                message: "Admin hostname:",
                required: true,
                default: config.adminHostname
            }) as string;
        }

        config.adminHostname = adminHostname;

        await config.save();
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

    public async services(): Promise<void> {
        //
    }

    public async start(name?: string, restart?: boolean): Promise<void> {
        const service = this.config.getServiceOrDefault(name);

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
                image: "mariadb:latest",
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
                volumes,
                // aliases: [
                //     service.containerName
                // ]
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

        let file = await FS.readFile(Path.join(__dirname, "../../data/conf/config.user.inc.php"));

        file = file.toString() + servers.map((service) => {
            const host = service.host || service.containerName;

            const user = service.host ? service.username : "root";
            const password = service.host ? service.password : service.rootPassword;

            const res = [
                `$i++;`,
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

        await this.fs.writeFile("config.user.inc.php", file);
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

    public async create(service: Partial<ServiceProps>): Promise<void> {
        const config = this.config;

        if(service.name && config.getService(service.name)) {
            console.info(`Service "${service.name}" is already exists`);
            delete service.name;
        }

        if(!service.name) {
            service.name = await promptText({
                message: "Service name:",
                validate(value) {
                    if(!value) {
                        return "Service name is required";
                    }

                    if(config.getService(value)) {
                        return `Service ${value} is already exists`;
                    }

                    return true;
                }
            });
        }

        if(!service.username) {
            service.username = await promptText({
                message: "User:",
                required: true
            });
        }

        if(!service.password) {
            service.password = await promptText({
                message: "Password:",
                type: "password",
                required: true
            });

            const confirmPassword = await promptText({
                message: "Confirm password:",
                type: "password"
            });

            if(service.password !== confirmPassword) {
                throw new Error("Password didn't match");
            }
        }

        if(!service.host) {
            if(!service.rootPassword && service.username !== "root") {
                service.rootPassword = await promptText({
                    message: "Root password:",
                    type: "password",
                    required: true
                });

                const confirmPassword = await promptText({
                    message: "Confirm root password:",
                    type: "password",
                    required: true
                });

                if(service.rootPassword !== confirmPassword) {
                    throw new Error("Password didn't match");
                }
            }

            if(!service.storage || ![STORAGE_VOLUME, STORAGE_FILESYSTEM].includes(service.storage)) {
                service.storage = await promptSelect<ServiceStorageType>({
                    message: "Storage:",
                    options: [STORAGE_VOLUME, STORAGE_FILESYSTEM]
                });
            }
        }

        config.setService(service.name as string, service);

        if(!config.default) {
            config.default = service.name;
        }

        await config.save();
    }

    public async upgrade(name?: string, image?: string, imageVersion?: string): Promise<void> {
        const service = this.config.getServiceOrDefault(name);

        // service.
    }

    public async destroy(name?: string, force?: boolean): Promise<void> {
        if(!name) {
            throw new Error("Service name required");
        }

        const config = this.config;

        const service = config.getService(name);

        if(!service) {
            throw new Error(`Service ${name} not found`);
        }

        if(config.default === service.name) {
            if(!force) {
                throw new Error("Can't destroy default service");
            }

            const confirm = await promptConfirm({
                message: `Are you sure you want to delete the "${name}" database? This action cannot be undone and all data will be lost.`,
                default: false
            });

            if(!confirm) {
                throw new Error("Aborted");
            }

            delete config.default;
        }

        if(!service.host) {
            await this.dockerService.removeContainer(service.containerName);

            switch(service.storage) {
                case "volume": {
                    if(service.volumeName !== service.defaultVolume) {
                        console.info(`Deletion of custom volume "${service.volumeName}" skipped.`);
                        break;
                    }

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
                    await this.dbFs.rm(service.name, {
                        recursive: true,
                        force: true
                    });
                    break;
                }
            }
        }

        config.unsetService(name);

        await config.save();
    }

    public async setDefault(name: string): Promise<void> {
        const service = this.config.getService(name);

        this.config.default = service.name;

        await this.config.save();
    }

    public async mariadb(name?: string, database?: string): Promise<void> {
        const service = this.config.getServiceOrDefault(name);
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

        if(!service.host) {
            cmd.push(`-uroot`);

            if(service.rootPassword) {
                cmd.push(`-p${service.rootPassword}`);
            }
        }
        else {
            if(service.username) {
                cmd.push(`-u${service.username}`);
            }

            if(service.password) {
                cmd.push(`-p${service.password}`);
            }
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

    public async backup(name?: string, database?: string, filename?: string): Promise<void> {
        const service = this.config.getServiceOrDefault(name);

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
            filename += ".sql";
        }

        this.pluginConfigService.fs.mkdir(`dump/${service.name}/${database}`, {
            recursive: true
        });

        const file = this.fs.createWriteStream(`dump/${service.name}/${database}/${filename}`);

        const cmd = ["mariadb-dump", database as string, "--add-drop-table", "--hex-blob"];

        if(!service.host) {
            cmd.push(`-uroot`);

            if(service.rootPassword) {
                cmd.push(`-p${service.rootPassword}`);
            }
        }
        else {
            if(service.username) {
                cmd.push(`-u${service.username}`);
            }

            if(service.password) {
                cmd.push(`-p${service.password}`);
            }
        }

        const exec = await container.exec({
            Cmd: cmd,
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

        await this.fs.rm(path);

        console.info(`File "${filename}" deleted`);

        return;
    }

    public async restore(name?: string, database?: string, filename?: string): Promise<void> {
        const service = this.config.getServiceOrDefault(name);

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

        if(!service.host) {
            cmd.push(`-uroot`);

            if(service.rootPassword) {
                cmd.push(`-p${service.rootPassword}`);
            }
        }
        else {
            if(service.username) {
                cmd.push(`-u${service.username}`);
            }

            if(service.password) {
                cmd.push(`-p${service.password}`);
            }
        }

        const exec = await container.exec({
            Cmd: cmd,
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
            file.on("end", resolve);

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

        const cmd = ["mariadb-dump", database as string, "--add-drop-table"];

        if(!service.host) {
            cmd.push(`-uroot`);

            if(service.rootPassword) {
                cmd.push(`-p${service.rootPassword}`);
            }
        }
        else {
            if(service.username) {
                cmd.push(`-u${service.username}`);
            }

            if(service.password) {
                cmd.push(`-p${service.password}`);
            }
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
}
