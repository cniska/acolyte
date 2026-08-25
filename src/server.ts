#!/usr/bin/env bun
import { appConfig } from "./app-config";
import { setLocale } from "./i18n";
import { startServer } from "./server-app";

setLocale(appConfig.locale);
await startServer();
