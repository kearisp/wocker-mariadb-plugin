import {PickProperties} from "@wocker/core";


export type ServiceProps = Omit<PickProperties<Service>, "containerName">;

export class Service {
    public name: string;
    public user?: string;
    public password?: string;
    public host?: string;

    public constructor(data: ServiceProps) {
        const {
            name,
            user,
            password,
            host
        } = data;

        this.name = name;
        this.user = user;
        this.password = password;
        this.host = host;
    }

    public get containerName(): string {
        return `mariadb-${this.name}.ws`;
    }

    public toJSON(): ServiceProps {
        return {
            name: this.name,
            user: this.user,
            password: this.password,
            host: this.host
        };
    }
}
