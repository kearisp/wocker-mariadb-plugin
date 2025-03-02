import {EnvConfig} from "@wocker/core";


export const STORAGE_FILESYSTEM = "filesystem";
export const STORAGE_VOLUME = "volume";

export type ServiceStorageType = typeof STORAGE_FILESYSTEM | typeof STORAGE_VOLUME;

export type ServiceProps = {
    name: string;
    host?: string;
    user?: string;
    username?: string;
    password?: string;
    passwordHash?: string;
    rootPassword?: string;
    storage?: ServiceStorageType;
    volume?: string;
    image?: string;
    imageName?: string;
    imageVersion?: string;
    env?: EnvConfig;
};

export class Service {
    public name: string;
    public host?: string;
    public username?: string;
    public password?: string;
    public passwordHash?: string;
    public rootPassword?: string;
    public storage?: ServiceStorageType;
    public _volume?: string;
    public imageName: string;
    public imageVersion: string;
    public env?: EnvConfig;

    public constructor(data: ServiceProps) {
        const {
            name,
            host,
            user,
            username,
            password,
            passwordHash,
            rootPassword,
            storage,
            volume,
            image,
            imageName = image || "mariadb",
            imageVersion = "latest",
            env
        } = data;

        this.name = name;
        this.host = host;
        this.username = username || user;
        this.password = password;
        this.passwordHash = passwordHash;
        this.rootPassword = rootPassword || password;
        this.storage = storage;
        this._volume = volume;
        this.imageName = imageName;
        this.imageVersion = imageVersion;
        this.env = env;

        if(!host && !storage) {
            this.storage = STORAGE_FILESYSTEM;
        }
    }

    public get auth(): string[] {
        const cmd: string[] = [];

        if(!this.host) {
            cmd.push("-uroot");

            if(this.rootPassword) {
                cmd.push(`-p${this.rootPassword}`);
            }
        }
        else {
            if(this.username) {
                cmd.push(`-u${this.username}`);
            }

            if(this.password) {
                cmd.push(`-p${this.password}`);
            }
        }

        return cmd;
    }

    public get imageTag(): string {
        return `${this.imageName}:${this.imageVersion}`;
    }

    public get containerName(): string {
        return `mariadb-${this.name}.ws`;
    }

    public get volume(): string {
        if(!this._volume) {
            this._volume = this.defaultVolume;
        }

        return this._volume;
    }

    public set volume(volume: string) {
        this._volume = volume;
    }

    public get defaultVolume(): string {
        return `wocker-mariadb-${this.name}`;
    }

    public toObject(): ServiceProps {
        return {
            name: this.name,
            host: this.host,
            username: this.username,
            password: this.password,
            rootPassword: this.rootPassword,
            storage: this.storage,
            volume: this._volume,
            imageName: this.imageName,
            imageVersion: this.imageVersion,
            env: this.env
        };
    }
}
