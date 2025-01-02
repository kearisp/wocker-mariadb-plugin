import {Config, ConfigProperties, EnvConfig} from "@wocker/core";


export const STORAGE_FILESYSTEM = "filesystem";
export const STORAGE_VOLUME = "volume";

export type ServiceStorageType = typeof STORAGE_FILESYSTEM | typeof STORAGE_VOLUME;

export type ServiceProps = ConfigProperties & {
    host?: string;
    user?: string;
    username?: string;
    password?: string;
    passwordHash?: string;
    rootPassword?: string;
    storage?: ServiceStorageType;
    volume?: string;
    image?: string;
    imageVersion?: string;
    env?: EnvConfig;
};

export class Service extends Config<ServiceProps> {
    public host?: string;
    public username?: string;
    public password?: string;
    public passwordHash?: string;
    public rootPassword?: string;
    public storage?: ServiceStorageType;
    public volume?: string;
    public image: string;
    public imageVersion: string;
    public env?: EnvConfig;

    public constructor(data: ServiceProps) {
        super(data);

        const {
            host,
            user,
            username,
            password,
            passwordHash,
            rootPassword,
            storage,
            volume,
            image = "mariadb",
            imageVersion = "latest",
            env
        } = data;

        this.host = host;
        this.username = username || user;
        this.password = password;
        this.passwordHash = passwordHash;
        this.rootPassword = rootPassword || password;
        this.storage = storage;
        this.volume = volume;
        this.image = image;
        this.imageVersion = imageVersion;
        this.env = env;

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
