import {Config, ConfigProperties} from "@wocker/core";


export const STORAGE_FILESYSTEM = "filesystem";
export const STORAGE_VOLUME = "volume";

export type ServiceStorageType = typeof STORAGE_FILESYSTEM | typeof STORAGE_VOLUME;

export type ServiceProps = ConfigProperties & {
    host?: string;
    user?: string;
    username?: string;
    password?: string;
    passwordHash?: string;
    storage?: ServiceStorageType;
    volume?: string;
};

export class Service extends Config<ServiceProps> {
    public host?: string;
    public username?: string;
    public password?: string;
    public passwordHash?: string;
    public storage?: ServiceStorageType;
    public volume?: string;

    public constructor(data: ServiceProps) {
        super(data);

        const {
            host,
            user,
            username,
            password,
            passwordHash,
            storage,
            volume
        } = data;

        this.host = host;
        this.username = username || user;
        this.password = password;
        this.passwordHash = passwordHash;
        this.storage = storage;
        this.volume = volume;

        if(!host && !storage) {
            this.storage = STORAGE_FILESYSTEM;
        }
    }

    public get containerName(): string {
        return `mariadb-${this.name}.ws`;
    }

    public get volumeName(): string {
        if(!this.volume) {
            return this.defaultVolume;
        }

        return this.volume;
    }

    public get defaultVolume(): string {
        return `wocker-mariadb-${this.name}`;
    }
}
