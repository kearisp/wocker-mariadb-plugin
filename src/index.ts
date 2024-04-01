import {Plugin, PluginConfigService} from "@wocker/core";

import {MariadbController} from "./controllers/MariadbController";
import {MariadbService} from "./services/MariadbService";
import {DumpService} from "./services/DumpService";


@Plugin({
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
export default class MariadbPlugin {}
