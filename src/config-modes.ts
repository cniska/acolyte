import { z } from "zod";

export const permissionModeSchema = z.enum(["read", "write"]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const logFormatSchema = z.enum(["logfmt", "json"]);
export type LogFormat = z.infer<typeof logFormatSchema>;

export const transportModeSchema = z.enum(["auto", "http", "rpc"]);
export type TransportMode = z.infer<typeof transportModeSchema>;

export const scopeSchema = z.enum(["user", "project"]);
export type ConfigScope = z.infer<typeof scopeSchema>;
