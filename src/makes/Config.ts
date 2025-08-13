import {FileSystem, PickProperties} from "@wocker/core";
import {Service, ServiceProps} from "./Service";


type AdminConfig = {
    enabled?: boolean;
    hostname: string;
};

export type ConfigProps = Omit<PickProperties<Config>, "services"> & {
    enableAdmin?: boolean;
    adminHostname?: string;
    services?: ServiceProps[];
};

export abstract class Config {
    public default?: string;
    public admin: AdminConfig;
    public services: Service[];

    public constructor(data: ConfigProps) {
        const {
            default: defaultService,
            enableAdmin,
            adminHostname,
            admin = {
                enabled: enableAdmin,
                hostname: adminHostname || "dbadmin-mariadb.workspace"
            },
            services = []
        } = data;

        this.default = defaultService;
        this.admin = {
            enabled: admin.enabled ?? false,
            hostname: admin.hostname ?? "dbadmin-mariadb.workspace"
        };
        this.services = services.map((s) => {
            return new Service(s);
        });
    }

    public hasService(name: string): boolean {
        const service = this.services.find((service) => {
            return service.name === name;
        });

        return !!service;
    }

    public getService(name: string): Service {
        const service = this.services.find((service) => {
            return service.name === name;
        });

        if(!service) {
            throw new Error(`Mariadb "${name}" service not found`);
        }

        return service;
    }

    public hasDefaultService(): boolean {
        if(!this.default) {
            return false;
        }

        return this.hasService(this.default);
    }

    public getDefaultService(): Service {
        if(!this.default) {
            throw new Error("No services are installed by default");
        }

        return this.getService(this.default);
    }

    public getServiceOrDefault(name?: string): Service {
        if(!name) {
            return this.getDefaultService();
        }

        return this.getService(name);
    }

    public setService(service: Service): void {
        let exists = false;

        for(let i = 0; i < this.services.length; i++) {
            if(this.services[i].name === service.name) {
                exists = true;
                this.services[i] = service;
            }
        }

        if(!exists) {
            this.services.push(service);
        }

        if(!this.default) {
            this.default = service.name;
        }
    }

    public updateService(name: string, service: Partial<ServiceProps>): void {
        for(let i = 0; i < this.services.length; i++) {
            if(this.services[i].name === name) {
                this.services[i] = new Service({
                    ...this.services[i].toObject(),
                    ...service
                });
                break;
            }
        }
    }

    public unsetService(name: string): void {
        this.services = this.services.filter((service) => {
            return service.name !== name;
        });

        if(this.default === name) {
            delete this.default;
        }
    }

    public abstract save(): void;

    public toObject(): ConfigProps {
        return {
            default: this.default,
            admin: this.admin,
            services: this.services.length > 0 ? this.services.map((service) => {
                return service.toObject();
            }) : undefined
        };
    }

    public static make(fs: FileSystem, configPath: string): Config {
        const data: ConfigProps = fs.exists(configPath)
            ? fs.readJSON(configPath)
            : {
                admin: {
                    enabled: true
                }
            };

        return new class extends Config {
            public save(): void {
                fs.writeJSON(configPath, this.toObject());
            }
        }(data);
    }
}
