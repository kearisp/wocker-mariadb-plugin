import {PickProperties} from "@wocker/core";

import {Service, ServiceProps} from "./Service";


export type ConfigProps = Omit<PickProperties<Config>, "services"> & {
    services?: ServiceProps[];
};

export abstract class Config {
    public default?: string;
    public rootPassword?: string;
    public services: Service[];

    public constructor(data: ConfigProps) {
        const {
            default: defaultService,
            rootPassword,
            services = []
        } = data;

        this.default = defaultService;
        this.rootPassword = rootPassword;
        this.services = services.map((s) => {
            return new Service(s);
        });
    }

    public getService(name: string): Service | null {
        return this.services.find((service) => {
            return service.name === name;
        }) || null;
    }

    public getDefaultService(): Service | null {
        if(!this.default) {
            return null;
        }

        return this.getService(this.default);
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

    public abstract save(): Promise<void>;

    public toJSON(): ConfigProps {
        return {
            default: this.default,
            rootPassword: this.rootPassword,
            services: this.services.length > 0 ? this.services.map((service) => {
                return service.toJSON();
            }) : undefined
        };
    }
}
