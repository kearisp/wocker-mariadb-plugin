import {PickProperties} from "@wocker/core";


export type ServiceProps = Omit<PickProperties<Service>, "containerName" | "volumeName">;

export class Service {
    public name: string;
    public user?: string;
    public password?: string;
    public passwordHash?: string;
    public host?: string;
    public storage?: "filesystem" | "volume";

    public constructor(data: ServiceProps) {
        const {
            name,
            user,
            password,
            passwordHash,
            storage,
            host
        } = data;

        this.name = name;
        this.user = user;
        this.password = password;
        this.passwordHash = passwordHash;
        this.storage = storage;
        this.host = host;

        if(!storage && !host) {
            this.storage = "filesystem";
        }
    }

    public get containerName(): string {
        return `mariadb-${this.name}.ws`;
    }

    public get volumeName(): string {
        return `wocker-mariadb-${this.name}`;
    }

    public toJSON(): ServiceProps {
        return {
            name: this.name,
            user: this.user,
            password: this.password,
            passwordHash: this.passwordHash,
            storage: this.storage,
            host: this.host
        };
    }
}
