import {EnvConfig} from "@wocker/core";
import {Image} from "@wocker/utils";


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
    /** @deprecated */
    imageName?: string;
    /** @deprecated */
    imageVersion?: string;
    env?: EnvConfig;
    containerPort?: number;
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
    protected _image?: string;
    public env?: EnvConfig;
    public containerPort?: number;

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
            env,
            containerPort
        } = data;

        this.name = name;
        this.host = host;
        this.username = username || user;
        this.password = password;
        this.passwordHash = passwordHash;
        this.rootPassword = rootPassword || password;
        this.storage = storage;
        this._volume = volume;
        this._image = image ? image : imageName ? new Image(imageName, imageVersion).toString() : undefined;
        this.env = env;
        this.containerPort = containerPort;

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

    public get containerName(): string {
        return `mariadb-${this.name}.ws`;
    }

    public get image(): string {
        if(!this._image) {
            return "mariadb:latest";
        }

        return this._image;
    }

    public set image(image: string | undefined) {
        if(!image) {
            delete this._image;
            return;
        }

        if(!Image.isValid(image)) {
            throw new Error(`Invalid image ${image}`);
        }

        this._image = image;
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
            passwordHash: this.passwordHash,
            rootPassword: this.rootPassword,
            storage: this.storage,
            volume: this._volume,
            image: this._image,
            env: this.env,
            containerPort: this.containerPort
        };
    }
}
