/**
 * Server 命令行参数解析。
 *
 * 由**薄入口** `./main` 在解析数据根之前 import：`-h` / `-v` 必须早于任何
 * 数据根校验生效（配置坏掉时也要能看到帮助），所以不能等到 `./app` 加载。
 */
import { version } from "../../package.json";

export interface ServerCli {
  port?: number;
  token?: string;
}

const USAGE = `
Fello Server — standalone headless server without Electron

Usage: node out/server/main.js [options]

Options:
  -p, --port <number>     HTTP server port (default: random available port)
  -t, --token <string>    Authentication token (default: auto-generated)
  -v, --version           Show version number
  -h, --help              Show this help

Environment:
  FELLO_DATA_ROOT         Data root directory
                          Takes precedence over ~/.fellorc; default: ~/.fello
`;

function parse(argv: string[]): ServerCli {
  let port: number | undefined;
  let token: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" || argv[i] === "-p") {
      port = parseInt(argv[++i], 10);
    } else if (argv[i] === "--token" || argv[i] === "-t") {
      token = argv[++i];
    } else if (argv[i] === "--version" || argv[i] === "-v") {
      console.log(version);
      process.exit(0);
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(USAGE);
      process.exit(0);
    }
  }

  return { port, token };
}

export const cli: ServerCli = parse(process.argv.slice(2));
