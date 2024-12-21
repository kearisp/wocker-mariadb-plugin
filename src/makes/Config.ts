import {PickProperties} from "@wocker/core";

import {Service, ServiceProps} from "./Service";


export type ConfigProps = Omit<PickProperties<Config>, "adminHostname" | "services"> & {
    adminHostname?: string;
    services?: ServiceProps[];
};

export abstract class Config {
    public adminHostname: string;
    public default?: string;
    public services: Service[];

    public constructor(data: ConfigProps) {
        const {
            adminHostname,
            default: defaultService,
            services = []
        } = data;

        this.adminHostname = adminHostname || "dbadmin-mariadb.workspace";
        this.default = defaultService;
        this.services = services.map((s) => {
            return new Service(s);
        });
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

    public setService(name: string, service: Omit<ServiceProps, "name">): void {
        this.services = [
            ...this.services.filter((service) => {
                return service.name !== name;
            }),
            new Service({
                ...service,
                name
            })
        ];
    }

    public unsetService(name: string): void {
        this.services = this.services.filter((service) => {
            return service.name !== name;
        });
    }

    public abstract save(): void;

    public toJSON(): ConfigProps {
        return {
            adminHostname: this.adminHostname,
            default: this.default,
            services: this.services.length > 0 ? this.services.map((service) => {
                return service.toObject();
            }) : undefined
        };
    }
}
