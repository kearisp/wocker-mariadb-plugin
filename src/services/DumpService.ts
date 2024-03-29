import {Injectable, PluginConfigService} from "@wocker/core";


@Injectable()
export class DumpService {
    public constructor(
        protected readonly configService: PluginConfigService
    ) {}

    public async dumps() {
        //
    }
}
