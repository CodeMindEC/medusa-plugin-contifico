import { Module } from "@medusajs/framework/utils"
import ContificoModuleService from "./service"
import createDefaultConfigLoader from "./loaders/create-default-config"

export const CONTIFICO_MODULE = "contificoModuleService"

export default Module(CONTIFICO_MODULE, {
    service: ContificoModuleService,
    loaders: [createDefaultConfigLoader],
})
