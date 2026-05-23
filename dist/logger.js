"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
const isProd = process.env.NODE_ENV === 'production';
const logger = winston_1.default.createLogger({
    level: isProd ? 'info' : 'debug',
    format: isProd
        ? winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.json())
        : winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'HH:mm:ss' }), winston_1.default.format.colorize(), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `[${timestamp}] ${level}: ${message}${metaStr}`;
        })),
    transports: [new winston_1.default.transports.Console()],
});
exports.default = logger;
