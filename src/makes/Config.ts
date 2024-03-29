import {PickProperties} from "@wocker/core";

import {Service} from "../types";


export abstract class Config {
    default?: string;
    rootPassword?: string;
    services: Service[];

    protected constructor(data: PickProperties<Config>) {
        const {
            default: defaultService,
            rootPassword,
            services
        } = data;

        this.default = defaultService;
        this.rootPassword = rootPassword;
        this.services = services;
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

    public setService(name: string, service: Omit<Service, "name">): void {
        this.services = [
            ...this.services.filter((service) => {
                return service.name !== name;
            }),
            {
                name,
                ...service
            }
        ];
    }

    public unsetService(name: string): void {
        this.services = this.services.filter((service) => {
            return service.name !== name;
        });
    }

    public abstract save(): Promise<void>;

    public static getContainerName(name: string): string {
        return `mariadb-${name}.ws`;
    }
}
