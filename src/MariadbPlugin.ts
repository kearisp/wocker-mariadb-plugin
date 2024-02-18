import {
    Injectable,
    Cli,
    FSManager
} from "@wocker/core";
import {
    Plugin,
    AppConfigService,
    DockerService
} from "@wocker/ws";
import {demuxOutput, promptConfirm, promptSelect, promptText} from "@wocker/utils";
import * as Path from "path";
import dateFormat from "date-fns/format";


type BackupOptions = {
    yes?: boolean;
    delete?: boolean;
};

@Injectable()
export class MariadbPlugin extends Plugin {
    protected passwordKey = "MARIADB_PASSWORD";
    protected defaultPassword = "toor";
    protected containerName = "mariadb.workspace";
    protected containerAdminName = "dbadmin-mariadb.workspace";
    protected dbDir: string;
    protected fs: FSManager;

    public constructor(
        protected appConfigService: AppConfigService,
        protected dockerService: DockerService
    ) {
        super("mariadb");

        this.dbDir = this.appConfigService.dataPath("db/mariadb");
        this.fs = new FSManager(
            Path.join(__dirname, "..", "data"),
            this.appConfigService.dataPath("plugins", "mariadb")
        );
    }

    public install(cli: Cli) {
        super.install(cli);

        cli.command("mariadb:init")
            .action(() => this.init());

        cli.command("mariadb:start")
            .action(() => this.start());

        cli.command("mariadb:stop")
            .action(() => this.stop());

        cli.command("mariadb [database]")
            .completion("database", () => this.getDatabases())
            .action((options, database) => this.mysql(database as string));

        cli.command("mariadb:dump [database]")
            .completion("database", () => this.getDatabases())
            .action((options, database) => this.dump(database as string));

        cli.command("mariadb:backup [database] [filename]")
            .option("yes", {
                type: "boolean",
                alias: "y",
                description: "Auto confirm file deletion"
            })
            .option("delete", {
                type: "boolean",
                alias: "d",
                description: "Delete backup file"
            })
            .completion("database", (options: BackupOptions) => {
                if(options.delete) {
                    return this.getDumps();
                }

                return this.getDatabases();
            })
            .completion("filename", (options, database) => this.getDumpFiles(database as string))
            .action((options: BackupOptions, database, filename) => this.backup(options, database as string, filename as string));

        cli.command("mariadb:restore [database] [filename]")
            .completion("database", () => this.getDumps())
            .completion("filename", (options, database) => this.getDumpFiles(database as string))
            .action((options, database, filename) => this.restore(database as string, filename as string));
    }

    protected async query(query: string): Promise<string|null> {
        const container = await this.dockerService.getContainer(this.containerName);

        if(!container) {
            return null;
        }

        const exec = await container.exec({
            Cmd: ["mysql", `-uroot`, `-p${await this.getPassword()}`, "-e", `${query}`],
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await exec.start({});

        return await new Promise((resolve, reject) => {
            let result = "";

            stream.on("data", (data) => {
                result += demuxOutput(data).toString();
            });

            stream.on("end", () => {
                resolve(result);
            });

            stream.on("error", (err) => {
                reject(err);
            });
        });
    }

    protected async getDatabases() {
        const res = await this.query("SHOW DATABASES;");

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

    protected getDumps() {
        return this.fs.readdir("dump");
    }

    protected async getPassword() {
        return await this.appConfigService.getMeta(this.passwordKey, this.defaultPassword) as string;
    }

    protected async getDumpFiles(database?: string): Promise<string[]> {
        if(!database) {
            return [];
        }

        if(!this.fs.exists(`dump/${database}`)) {
            return [];
        }

        return this.fs.readdir(`dump/${database}`);
    }

    public async init() {
        const password = await promptText({
            required: true,
            message: "Password:",
            type: "string",
            default: await this.getPassword()
        });

        await this.appConfigService.setMeta(this.passwordKey, password);
    }

    public async start() {
        const password = await this.appConfigService.getMeta(this.passwordKey);

        if(!password) {
            await this.init();
        }

        await this.startMariadb();
        await this.startAdmin();
    }

    protected async startMariadb() {
        console.info("Mariadb starting...");

        await this.dockerService.pullImage("mariadb:10.5");

        let container = await this.dockerService.getContainer(this.containerName);

        if(!container) {
            container = await this.dockerService.createContainer({
                name: this.containerName,
                image: "mariadb:10.5",
                restart: "always",
                env: {
                    MYSQL_ROOT_PASSWORD: await this.getPassword()
                },
                volumes: [
                    `${this.dbDir}:/var/lib/mysql`
                ],
                ports: ["3306:3306"]
            });
        }

        const {
            State: {
                Status
            }
        } = await container.inspect();

        if(Status === "created" || Status === "exited") {
            await container.start();
        }
    }

    protected async startAdmin() {
        console.info("Phpmyadmin starting...");

        await this.fs.mkdir("conf", {recursive: true});
        await this.fs.mkdir("dump", {recursive: true});
        await this.fs.mkdir("save", {recursive: true});
        await this.fs.mkdir("upload", {recursive: true});

        await this.fs.copy("conf/config.user.inc.php");

        await this.dockerService.pullImage("phpmyadmin/phpmyadmin:latest");

        let container = await this.dockerService.getContainer(this.containerAdminName);

        if(!container) {
            container = await this.dockerService.createContainer({
                name: this.containerAdminName,
                image: "phpmyadmin/phpmyadmin:latest",
                restart: "always",
                env: {
                    PMA_USER: "root",
                    PMA_PASSWORD: await this.getPassword(),
                    VIRTUAL_HOST: this.containerAdminName,
                    VIRTUAL_PORT: "80"
                },
                volumes: [
                    `${this.fs.path("conf/config.user.inc.php")}:/etc/phpmyadmin/config.user.inc.php`,
                    `${this.fs.path("save")}:/etc/phpmyadmin/save`,
                    `${this.fs.path("upload")}:/etc/phpmyadmin/upload`
                ],
                links: [
                    `${this.containerName}:db`
                ]
            });
        }

        const {
            State: {
                Status
            }
        } = await container.inspect();

        if(Status === "created" || Status === "exited") {
            await container.start();
        }
    }

    public async stop() {
        console.info("Mariadb stopping...");

        await this.dockerService.removeContainer(this.containerName);

        console.info("Phpmyadmin stopping...");

        await this.dockerService.removeContainer(this.containerAdminName);
    }

    public async mysql(database?: string) {
        const container = await this.dockerService.getContainer(this.containerName);

        if(!container) {
            return;
        }

        if(!database) {
            if(!process.stdin.isTTY) {
                throw new Error("Database name missing");
            }

            database = await promptSelect({
                options: await this.getDatabases(),
                message: "Database:"
            });
        }

        const exec = await container.exec({
            Cmd: ["mysql", `-uroot`, `-p${await this.getPassword()}`, database as string],
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

    public async dump(database?: string) {
        const container = await this.dockerService.getContainer(this.containerName);

        if(!container) {
            return;
        }

        if(!database) {
            if(process.stdin.isTTY) {
                database = await promptSelect({
                    options: await this.getDatabases(),
                    message: "Database"
                });
            }
        }

        if(!database) {
            throw new Error("Database is missing");
        }

        const exec = await container.exec({
            Cmd: ["mysqldump", `-uroot`, `-p${await this.getPassword()}`, database],
            AttachStdout: true
        });

        const steam = await exec.start({
            Tty: process.stdin.isTTY,
            hijack: true
        });

        steam.pipe(process.stdout);
    }

    public async backup(options: BackupOptions, database?: string, filename?: string) {
        const {
            yes,
            delete: del
        } = options;

        if(del) {
            if(!database) {
                database = await promptSelect({
                    message: "Database: ",
                    options: await this.getDumps()
                });
            }

            if(!filename) {
                filename = await promptSelect({
                    message: "File:",
                    options: await this.getDumpFiles(database)
                });
            }

            if(!yes) {
                const confirm = await promptConfirm({
                    message: `Delete ${filename}?`,
                    default: false
                });

                if(!confirm) {
                    return "";
                }
            }

            const path = `dump/${database}/${filename}`;

            if(!this.fs.exists(path)) {
                throw new Error(`File ${filename} does not exists.`)
            }

            await this.fs.rm(path);

            return "deleted\n";
        }

        if(!database) {
            database = await promptSelect({
                message: "Database: ",
                options: await this.getDatabases()
            });
        }

        const container = await this.dockerService.getContainer(this.containerName);

        if(!container) {
            return;
        }

        const exec = await container.exec({
            Cmd: ["mysqldump", "--add-drop-table", `-uroot`, `-p${await this.getPassword()}`, database],
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await exec.start({});

        const date = dateFormat(new Date(), "yyyy-MM-dd HH-mm")

        if(!filename) {
            filename = await promptText({
                message: "Filename:",
                default: date,
                suffix: ".sql"
            });
        }

        await this.fs.mkdir(`dump/${database}`, {recursive: true});

        const file = this.fs.createWriteStream(`dump/${database}/${filename}.sql`);

        await new Promise((resolve, reject) => {
            stream.on("data", (data) => {
                file.write(demuxOutput(data));
            });

            stream.on("end", resolve);
            stream.on("error", reject);
        });
    }

    public async restore(database?: string, filename?: string) {
        if(!database) {
            const dumps = await this.fs.readdir("dump");

            if(dumps.length === 0) {
                throw new Error("No dumps found");
            }

            database = await promptSelect({
                message: "Database: ",
                options: dumps
            });
        }

        if(!database) {
            throw new Error("Need database name");
        }

        if(!filename) {
            const files = await this.fs.readdir(`dump/${database}`);

            filename = await promptSelect({
                message: "File: ",
                options: files
            });
        }

        const container = await this.dockerService.getContainer(this.containerName);

        if(!container) {
            return;
        }

        const exec = await container.exec({
            Cmd: ["mysql", `-uroot`, `-p${await this.getPassword()}`, database],
            AttachStdin: true,
            AttachStderr: true,
            AttachStdout: true
        });

        const stream = await exec.start({
            hijack: true,
            stdin: true
        });

        await new Promise((resolve, reject) => {
            const file = this.fs.createReadStream(`dump/${database}/${filename}`);

            file.on("data", (data) => {
                stream.write(data);
            });

            file.on("end", resolve);

            stream.on("error", (err) => {
                file.close();

                reject(err);
            });
        });

        stream.write("exit\n");

        console.info("Imported");
    }
}
