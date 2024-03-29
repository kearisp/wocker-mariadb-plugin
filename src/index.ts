import {
    Module,
    PluginConfigService
} from "@wocker/core";

import {MariadbController} from "./controllers/MariadbController";
import {MariadbService} from "./services/MariadbService";
import {DumpService} from "./services/DumpService";


@Module({
    name: "mariadb",
    controllers: [
        MariadbController
    ],
    providers: [
        PluginConfigService,
        MariadbService,
        DumpService
    ]
})
export default class MariadbModule {}
